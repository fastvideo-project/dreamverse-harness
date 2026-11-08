// @vitest-environment jsdom
/**
 * The Voice tab: WAV encoding of a recording, the voice chip and `@` filter of `voice.convert`, and the Voice panel's
 * record, keep and convert gestures against a scripted API and a fake microphone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import { DvClient } from '@dv/ui-kit/api.ts'
import { asset, fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { voiceBar, schemaVoices } from '../src/client/voice-bar.ts'
import { VoicePanel, voiceChoices, type Recorder } from '../src/client/VoicePanel.tsx'
import { encodeWav, mixToMono } from '../src/client/wav.ts'

afterEach(() => { cleanup() })

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:take')
  URL.revokeObjectURL = vi.fn()
})

const SEED_VC = {
  modality: 'audio', task: 'a2a', provider: 'seed-vc', model: 'seed-vc-v1', description: 'Seed-VC v1',
  schema: { voices: [{ key: 'jk-simmons', label: 'J.K. Simmons' }, { key: 'narrator', label: 'The Narrator' }], extra: {} },
}

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clipped samples', () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 2, -0.5]), 22_050)
    const view = new DataView(bytes.buffer)
    const text = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4))
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    const header = [
      view.getUint32(4, true), view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint32(28, true),
    ]
    expect(header)
      .toEqual([46, 1, 1, 22_050, 44_100])
    expect([view.getUint16(32, true), view.getUint16(34, true), view.getUint32(40, true)]).toEqual([2, 16, 10])
    expect(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([0, 32_767, -32_768, 32_767, -16_384])
  })

  it('mixes channels to one by averaging, and keeps one channel as it is', () => {
    const left = new Float32Array([1, 0.5])
    expect(mixToMono([left])).toBe(left)
    expect(Array.from(mixToMono([left, new Float32Array([0, -0.5])]))).toEqual([0.5, 0])
    expect(mixToMono([])).toHaveLength(0)
  })
})

describe('the voice.convert bar', () => {
  const operation = { name: 'voice.convert' } as WireOperation
  it('offers the schema\'s voices as a menu chip and one audio recording to cite', () => {
    expect(voiceBar.chips({ schema: SEED_VC.schema, params: { voice: 'narrator' }, operation })).toEqual([{
      key: 'voice', label: ['音色', 'Voice'], kind: 'menu', value: 'The Narrator',
      options: [{ label: 'J.K. Simmons', patch: { voice: 'jk-simmons' } }, { label: 'The Narrator', patch: { voice: 'narrator' } }],
    }])
    expect(voiceBar.chips({ schema: SEED_VC.schema, params: {}, operation })[0]).toMatchObject({ value: '' })
    expect(voiceBar.candidates(SEED_VC.schema)).toEqual({ mediaTypes: ['audio'], maxReferences: 1 })
  })

  it('gives no chip and no filter for a schema without voices', () => {
    for (const schema of [null, [], {}, { voices: 'none' }]) {
      expect(voiceBar.chips({ schema, params: {}, operation })).toEqual([])
      expect(voiceBar.candidates(schema)).toBeNull()
    }
    expect(schemaVoices({ voices: [null, { key: 'a' }, { label: 'no key' }] })).toEqual([{ key: 'a', label: 'a' }])
  })

  it('lists the voices of every a2a model of the catalog', () => {
    expect(voiceChoices([SEED_VC, { ...SEED_VC, task: 't2a' }]).map(choice => choice.value)).toEqual(['seed-vc/seed-vc-v1/jk-simmons', 'seed-vc/seed-vc-v1/narrator'])
  })
})

interface HeldImport { query: string; answer(status: number, body: unknown): void }

/**
 * The scripted API with the fixture state plus one recorded line, the Seed-VC model, and imports held for the test.
 * @param models - the catalog the API answers.
 * @returns the fetch, the recorded writes and the held imports.
 */
function voiceServer(models = [SEED_VC]) {
  const state = fixtureState()
  state.assets.push(asset('line.wav', 'audio/wav', null, 13.1, 'asset.import'), asset('old-take.wav', 'audio/wav', null, 2, 'voice.convert'))
  const scripted = scriptedFetch({ state, models })
  const imports: HeldImport[] = []
  const serve: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://host')
    if (url.pathname !== '/api/dv/assets/import') return scripted.fetch(input, init)
    return new Promise((resolve) => {
      imports.push({ query: url.search, answer: (status, body) => { resolve(new Response(JSON.stringify(body), { status })) } })
    })
  }
  return { fetch: serve, writes: scripted.writes, imports }
}

/** A fake microphone whose recording is one WAV file; `failure` makes `start` reject. */
function fakeRecorder(failure: Error | null = null): Recorder & { file: File } {
  const file = new File(['RIFF'], 'line-20261104-103512.wav', { type: 'audio/wav' })
  return { file, start: () => failure === null ? Promise.resolve(() => Promise.resolve(file)) : Promise.reject(failure) }
}

const noScript = (): Promise<string> => Promise.reject(new Error('no script'))

describe('VoicePanel', () => {
  it('records a line, keeps it in the asset pool beside the chat session, and converts it into the chosen voice', async () => {
    const server = voiceServer()
    const view = render(<VoicePanel projectId="p1" session="s5" client={new DvClient(server.fetch)} recorder={fakeRecorder()} readText={noScript} />)
    fireEvent.click(view.getByRole('button', { name: 'Record' }))
    fireEvent.click(await view.findByRole('button', { name: 'Stop' }))
    expect(await view.findByLabelText('line-20261104-103512.wav')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Keep recording' }))
    await waitFor(() => { expect(server.imports).toHaveLength(1) })
    expect(new URLSearchParams(server.imports[0]?.query).toString())
      .toBe('project=p1&name=line-20261104-103512.wav&mime=audio%2Fwav&surface=asset_pool&session=s5')
    server.imports[0]?.answer(200, { asset: 'line.wav', record: record({ id: 'i1', operation: 'asset.import' }) })
    expect(await view.findByText('Kept the recording "line-20261104-103512.wav".')).toBeTruthy()

    fireEvent.change(view.getByLabelText('Recording'), { target: { value: 'old-take.wav' } })
    fireEvent.change(view.getByLabelText('Recording'), { target: { value: 'line.wav' } })
    fireEvent.change(view.getByLabelText('Voice'), { target: { value: 'seed-vc/seed-vc-v1/narrator' } })
    fireEvent.change(view.getByLabelText('Words of the line'), { target: { value: '  One. Mistake.  ' } })
    fireEvent.click(view.getByRole('button', { name: 'Convert' }))
    expect(await view.findByText('Converting "line.wav" to The Narrator; the take appears in the asset pool and on the canvas.')).toBeTruthy()
    expect(server.writes.filter(write => write.path === '/api/dv/operation').map(write => write.body)).toEqual([{
      project: 'p1', operation: 'voice.convert', surface: 'asset_pool', session: 's5',
      inputs: [{ role: 'reference', ref: 'line.wav' }],
      params: { modality: 'audio', task: 'a2a', provider: 'seed-vc', model: 'seed-vc-v1', prompt: 'One. Mistake.', voice: 'narrator' },
      intent: 'convert line.wav to The Narrator',
    }])
  })

  it('discards a recording, and names a microphone that fails', async () => {
    const server = voiceServer()
    const view = render(<VoicePanel projectId="p1" session={null} client={new DvClient(server.fetch)} recorder={fakeRecorder()} readText={noScript} />)
    fireEvent.click(view.getByRole('button', { name: 'Record' }))
    fireEvent.click(await view.findByRole('button', { name: 'Stop' }))
    fireEvent.click(await view.findByRole('button', { name: 'Discard' }))
    expect(view.queryByLabelText('line-20261104-103512.wav')).toBeNull()
    expect(server.imports).toEqual([])
    cleanup()
    const denied = render(<VoicePanel projectId="p1" session={null} client={new DvClient(server.fetch)} recorder={fakeRecorder(new Error('Permission denied'))} readText={noScript} />)
    fireEvent.click(denied.getByRole('button', { name: 'Record' }))
    expect((await denied.findByRole('alert')).textContent).toBe('Permission denied')

  })

  it('waits for a recording before it converts, and reads an unreachable catalog as no voice model', async () => {
    const silent = scriptedFetch({ models: [SEED_VC] })
    const view = render(<VoicePanel projectId="p1" session={null} client={new DvClient(silent.fetch)} recorder={fakeRecorder()} readText={noScript} />)
    expect(await view.findByText('Record or import a line first.')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Convert' })).toBeNull()
    cleanup()
    const down: typeof fetch = (input, init) => (typeof input === 'string' && input.startsWith('/api/dv/models'))
      ? Promise.resolve(new Response('{"error":"down"}', { status: 500 })) : silent.fetch(input, init)
    const offline = render(<VoicePanel projectId="p1" session={null} client={new DvClient(down)} recorder={fakeRecorder()} readText={noScript} />)
    expect(await offline.findByText('No voice model is available; enable dv-seed-vc in the config and list the allowed voices.')).toBeTruthy()
  })

  it('says so when no voice model is available, and names a refused conversion', async () => {
    const empty = voiceServer([])
    const view = render(<VoicePanel projectId="p1" session={null} client={new DvClient(empty.fetch)} recorder={fakeRecorder()} readText={noScript} />)
    expect(await view.findByText('No voice model is available; enable dv-seed-vc in the config and list the allowed voices.')).toBeTruthy()
    cleanup()
    const refused = scriptedFetch({
      state: { ...fixtureState(), assets: [asset('line.wav', 'audio/wav', null, 13.1, 'asset.import')] }, models: [SEED_VC],
      post: () => ({ status: 409, body: { error: 'This model has no voice "x".' } }),
    })
    const panel = render(<VoicePanel projectId="p1" session={null} client={new DvClient(refused.fetch)} recorder={fakeRecorder()} readText={noScript} />)
    fireEvent.click(await panel.findByRole('button', { name: 'Convert' }))
    expect((await panel.findByRole('alert')).textContent).toBe('This model has no voice "x".')
    expect(refused.writes[0]?.body).toMatchObject({ params: { voice: 'jk-simmons', prompt: '' } })
  })
})
