/**
 * The `sglang-omni` provider plugin against a running SGLang-Omni server that serves Fish Audio Drama 3. It runs only
 * when `DV_SGLANG_OMNI_TEST_URL` names the server, such as `http://127.0.0.1:8000`, and speaks one clip. The case of
 * an entry pointed at the wrong server runs when `DV_SGLANG_DIFFUSION_TEST_URL` names a running SGLang diffusion server.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, RecordId } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { CANNOT, KEY, REFUSAL_END, UNAVAILABLE, UNAVAILABLE_END, failure, start, value, type Fixture } from './fixture.ts'

const SPEECH_SERVER = process.env['DV_SGLANG_OMNI_TEST_URL']
const IMAGE_SERVER = process.env['DV_SGLANG_DIFFUSION_TEST_URL']
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

const run = promisify(execFile)
const fixtures: Fixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})

async function boot(baseUrl: string): Promise<Fixture> {
  const fixture = await start(baseUrl)
  fixtures.push(fixture)
  return fixture
}

/** The duration of PCM WAV bytes with the 44-byte header that the server writes: the data size over the byte rate. */
function headerDuration(bytes: Buffer): number {
  return bytes.readUInt32LE(40) / bytes.readUInt32LE(28)
}

async function probedDuration(path: string): Promise<number | null> {
  try {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
    return Number(stdout.trim())
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

describe.skipIf(SPEECH_SERVER === undefined)('dv-sglang-omni against a running server', () => {
  it('speaks one clip as audio/wav with the duration of its header', async () => {
    const fixture = await boot(SPEECH_SERVER ?? '')
    const prompt = '<|speaker:0|> Welcome to DreamVerse, traveler. [laughs] Rest here tonight.'
    const take = value(await fixture.call('dv_audio_generate', { ...KEY, reason: 'greeting', prompt }))
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(take.record))
    const asset = record.outputs[0] as AssetId
    const bytes = fixture.ctx.dvAssetPool.read(asset)
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'audio/wav', duration_sec: headerDuration(bytes) })
    expect(record.report).toEqual({ model_id: 'fishaudio/drama-3', duration_sec: headerDuration(bytes) })
    expect(record.cost?.gpu_seconds).toBeGreaterThan(0)
    expect(record.cost?.gpu_seconds).not.toBe(3)
    const probed = await probedDuration(fixture.ctx.dvAssetPool.path(asset))
    if (probed !== null) expect(Math.abs(probed - headerDuration(bytes))).toBeLessThan(0.05)
    console.info(`clip ${String(headerDuration(bytes))} s, ffprobe ${String(probed)} s, wall ${String(record.cost?.gpu_seconds)} s`)
  }, 120_000)

  it('refuses a refused speaker tag, a prompt of tags only, and an unknown extra name before any record', async () => {
    const fixture = await boot(SPEECH_SERVER ?? '')
    const before = fixture.history()
    const refusal = async (prompt: string, extra: Record<string, unknown> = {}) =>
      failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'line', prompt, extra }))
    const speaker = 'This server speaks only <|speaker:0|>, and the prompt has <|speaker:1|>. Write one clip per character, each '
      + 'with <|speaker:0|> or no speaker tag.'
    const tagsOnly = 'The prompt has no text to speak besides its speaker tags; write the words to speak after the tag.'
    expect(await refusal('<|speaker:1|> Who goes there?')).toBe(`${CANNOT}${speaker} ${REFUSAL_END}`)
    expect(await refusal('<|speaker:0|>')).toBe(`${CANNOT}${tagsOnly} ${REFUSAL_END}`)
    expect(await refusal('<|speaker:1|>')).toBe(`${CANNOT}${speaker} ${tagsOnly} ${REFUSAL_END}`)
    expect(await refusal('Hello there.', { voice: 'alloy' }))
      .toBe(`${CANNOT}This model takes no extra parameter voice; it takes speed. ${REFUSAL_END}`)
    expect(fixture.history()).toBe(before)
  })

  it.skipIf(IMAGE_SERVER === undefined)('refuses a call before any record when the entry points at the image server', async () => {
    const fixture = await boot(IMAGE_SERVER ?? '')
    const before = fixture.history()
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'x', prompt: 'Hello.' }))).toBe(
      `${UNAVAILABLE}The server at ${IMAGE_SERVER ?? ''} serves Qwen/Qwen-Image-2.1-Turbo, not fishaudio/drama-3; the dv-sglang-omni `
        + `config points this model at the wrong server. ${UNAVAILABLE_END}`)
    expect(fixture.history()).toBe(before)
  })
})
