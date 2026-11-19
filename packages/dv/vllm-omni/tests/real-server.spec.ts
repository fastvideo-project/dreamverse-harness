/**
 * An opt-in spec of the `vllm-omni` provider plugin against running vLLM-Omni servers: `DV_VLLM_OMNI_IMAGE_URL` names
 * the server of Qwen-Image 2.1 Turbo and `DV_VLLM_OMNI_SPEECH_URL` the server of Qwen3-TTS CustomVoice. Each request
 * leaves the step count to the server, so the model renders with its default denoising steps.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { IMAGE_KEY, REFUSAL_END, SPEECH_KEY, UNAVAILABLE_END, failure, start, value, type Fixture } from './fixture.ts'

const IMAGE_URL = process.env['DV_VLLM_OMNI_IMAGE_URL']
const SPEECH_URL = process.env['DV_VLLM_OMNI_SPEECH_URL']

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function boot(servers: Record<string, string>): Promise<Fixture> {
  const fixture = await start(servers)
  cleanups.push(() => fixture.dispose())
  return fixture
}

/** The width and height that the IHDR chunk of a PNG states. */
function pngSize(bytes: Uint8Array): string {
  const view = Buffer.from(bytes)
  return `${String(view.readUInt32BE(16))}x${String(view.readUInt32BE(20))}`
}

describe.skipIf(IMAGE_URL === undefined)('dv-vllm-omni against a running image server', () => {
  it('renders the same PNG for the same seed and size, at the default size without one, and refuses an odd size', async () => {
    const fixture = await boot({ 'qwen-image-2.1-turbo': String(IMAGE_URL) })
    const args = { ...IMAGE_KEY, reason: 'lantern', prompt: 'a red paper lantern on a wooden table, soft morning light', size: '1024x768', seed: 1234 }
    const first = value(await fixture.tool('dv_image_generate', args))
    const second = value(await fixture.tool('dv_image_generate', args))
    expect(second.outputs[0]?.asset_id).toBe(first.outputs[0]?.asset_id)
    const asset = first.outputs[0]?.asset_id as never
    expect(pngSize(fixture.ctx.dvAssetPool.read(asset))).toBe('1024x768')
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'image/png', width: 1024, height: 768 })
    const square = value(await fixture.tool('dv_image_generate', { ...IMAGE_KEY, reason: 'square', prompt: args.prompt, seed: 1234 }))
    expect(pngSize(fixture.ctx.dvAssetPool.read(square.outputs[0]?.asset_id as never))).toBe('1024x1024')
    const before = fixture.records().length
    expect(failure(await fixture.tool('dv_image_generate', { ...args, size: '1000x1000' }))).toBe('Model image/t2i/vllm-omni/'
      + `qwen-image-2.1-turbo cannot generate this: Width and height must be multiples of 32; use 992x992 or 1024x1024 instead of 1000x1000. ${REFUSAL_END}`)
    expect(fixture.records()).toHaveLength(before)
  }, 600_000)
})

describe.skipIf(SPEECH_URL === undefined)('dv-vllm-omni against a running speech server', () => {
  it('speaks a WAV clip in a listed voice with its duration, and refuses a voice that the server lacks', async () => {
    const fixture = await boot({ 'qwen3-tts-customvoice': String(SPEECH_URL) })
    const { voices } = await fixture.speech().schema() as { voices: string[] }
    expect(voices).toContain('ryan')
    const spoken = value(await fixture.tool('dv_audio_generate', {
      ...SPEECH_KEY, reason: 'line', prompt: 'Welcome to DreamVerse, where every story becomes a film.',
      extra: { voice: 'ryan', language: 'English', instructions: 'Warm and calm, like a narrator.' },
    }))
    const asset = spoken.outputs[0]?.asset_id as never
    const bytes = Buffer.from(fixture.ctx.dvAssetPool.read(asset))
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
    const durationSec = fixture.ctx.dvAssetPool.get(asset)?.duration_sec ?? 0
    expect(durationSec).toBeGreaterThan(1)
    // A 24 kHz mono 16-bit clip: the 44-byte header, then 48,000 bytes per second.
    expect(Math.abs((bytes.length - 44) / 48_000 - durationSec)).toBeLessThan(0.01)
    expect(failure(await fixture.tool('dv_audio_generate', { ...SPEECH_KEY, reason: 'x', prompt: 'Hello.', extra: { voice: 'morgan' } })))
      .toBe('Model audio/t2a/vllm-omni/qwen3-tts-customvoice cannot generate this: The server has no voice "morgan"; it has '
        + `${voices.join(', ')}. ${REFUSAL_END}`)
  }, 600_000)

  it.skipIf(IMAGE_URL === undefined)('refuses a model whose config points at the server of another model', async () => {
    const fixture = await boot({ 'qwen3-tts-customvoice': String(IMAGE_URL) })
    expect(failure(await fixture.tool('dv_audio_generate', { ...SPEECH_KEY, reason: 'x', prompt: 'Hello.' }))).toBe(
      `Model audio/t2a/vllm-omni/qwen3-tts-customvoice is unavailable: The server at ${String(IMAGE_URL)} serves Qwen/Qwen-Image-2.1-Turbo, `
      + `not Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice; the dv-vllm-omni config points this model at the wrong server. ${UNAVAILABLE_END}`)
    expect(fixture.records()).toEqual([])
  })
})
