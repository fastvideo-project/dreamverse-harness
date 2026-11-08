// @vitest-environment jsdom
/**
 * Script recording in the Voice panel: the lines a script holds, the file names of their takes, and the teleprompter's
 * load, record, keep and move gestures against a scripted API and a fake microphone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, waitFor, within } from '@testing-library/react'
import { DvClient } from '@dv/ui-kit/api.ts'
import type { ProjectAsset } from '@dv/ui-kit/types.ts'
import { asset, fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { lineFileName, lineOfFile, parseScript, scriptStem } from '../src/client/script.ts'
import { useTake } from '../src/client/useTake.ts'
import { readAssetText, VoicePanel, type Recorder } from '../src/client/VoicePanel.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:take')
  URL.revokeObjectURL = vi.fn()
})

const SCRIPT = `INT. REHEARSAL ROOM - NIGHT

(The band freezes.)

FLETCHER
Not quite my tempo.

ANDREW: I was rushing?
FLETCHER (V.O.)
You were dragging.
Again.

[Silence.]
FLETCHER: One more time, from the top.
`

describe('parseScript', () => {
  it('reads NAME: lines, screenplay cues with their words, and other lines, and skips stage directions and scene headings', () => {
    expect(parseScript(SCRIPT)).toEqual([
      { index: 1, character: 'FLETCHER', text: 'Not quite my tempo.' },
      { index: 2, character: 'ANDREW', text: 'I was rushing?' },
      { index: 3, character: 'FLETCHER', text: 'You were dragging. Again.' },
      { index: 4, character: 'FLETCHER', text: 'One more time, from the top.' },
    ])
    expect(parseScript('EXT. ROOF - DAY\nINT./EXT. CAR - NIGHT\nHello there.')).toEqual([{ index: 1, character: null, text: 'Hello there.' }])
    expect(parseScript('MILES\n')).toEqual([])
    expect(parseScript('')).toEqual([])
  })

  it('reads a screenplay without blank lines: a cue ends the block before it, and action lines are skipped', () => {
    const unspaced = [
      'Fletcher nods, then slowly turns around.',
      'FLETCHER (CONT’D)',
      '(as though discussing the weather)',
      'Why do you suppose I just hurled a chair',
      'at your head, Neiman?',
      'ANDREW',
      'One-two-three-four...',
      'Fletcher SLAPS Andrew on his left cheek.',
      'One-two--three-fou-',
      'FLETCHER',
      'Count again.',
    ].join('\n')
    expect(parseScript(unspaced)).toEqual([
      { index: 1, character: 'FLETCHER', text: 'Why do you suppose I just hurled a chair at your head, Neiman?' },
      { index: 2, character: 'ANDREW', text: 'One-two-three-four... One-two--three-fou-' },
      { index: 3, character: 'FLETCHER', text: 'Count again.' },
    ])
    // A script that names no speaker keeps every line.
    expect(parseScript('Hello there.\nGeneral KENOBI waves.')).toEqual([
      { index: 1, character: null, text: 'Hello there.' }, { index: 2, character: null, text: 'General KENOBI waves.' },
    ])
  })

  it('names the takes of a script\'s lines and finds the line of a take', () => {
    expect(scriptStem('Rehearsal Scene (v2).txt')).toBe('rehearsal-scene-v2')
    expect(scriptStem('!!!.md')).toBe('script')
    expect(lineFileName('rehearsal-scene', 3)).toBe('rehearsal-scene-line-03.wav')
    expect(lineOfFile('rehearsal-scene', 'rehearsal-scene-line-12.wav')).toBe(12)
    expect(lineOfFile('rehearsal-scene', 'other-line-03.wav')).toBeNull()
    expect(lineOfFile('rehearsal-scene', 'take.wav')).toBeNull()
  })
})

describe('useTake', () => {
  it('stops nothing while the microphone is not recording', () => {
    const start = vi.fn<Recorder['start']>()
    const { result } = renderHook(() => useTake({ start }, () => {}))
    act(() => { result.current.stop() })
    expect([result.current.recording, result.current.take, start.mock.calls.length]).toEqual([false, null, 0])
  })
})

describe('readAssetText', () => {
  it('reads a text asset through /dv/assets and names a failed read', async () => {
    const fetch = vi.fn((url: string) => Promise.resolve(url.endsWith('/s.txt') ? new Response('FLETCHER: Again.') : new Response('', { status: 404 })))
    vi.stubGlobal('fetch', fetch)
    expect(await readAssetText('s.txt')).toBe('FLETCHER: Again.')
    expect(fetch).toHaveBeenCalledWith('/dv/assets/s.txt')
    await expect(readAssetText('gone.txt')).rejects.toThrow('The asset gone.txt cannot be read: HTTP 404.')
  })
})

interface HeldImport { query: URLSearchParams; file: File; answer(asset: string): void }

const SEED_VC = {
  modality: 'audio', task: 'a2a', provider: 'seed-vc', model: 'seed-vc-v1', description: 'Seed-VC v1',
  schema: { voices: [{ key: 'narrator', label: 'The Narrator' }], extra: {} },
}

/**
 * The scripted API over a state with the given extra assets, holding each import for the test.
 * @param extra - assets besides the fixture's.
 * @returns the fetch and the held imports.
 */
function server(extra: ProjectAsset[]) {
  const state = fixtureState()
  state.assets.push(...extra)
  const scripted = scriptedFetch({ state: () => state, models: [SEED_VC] })
  const imports: HeldImport[] = []
  const serve: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://host')
    if (url.pathname !== '/api/dv/assets/import') return scripted.fetch(input, init)
    return new Promise((resolve) => {
      imports.push({
        query: url.searchParams, file: init?.body as File,
        answer: (id) => {
          state.assets.push({ ...asset(id, url.searchParams.get('mime') ?? '', null, null, 'asset.import'), name: url.searchParams.get('name') ?? id })
          resolve(new Response(JSON.stringify({ asset: id, record: record({ id: `i-${id}`, operation: 'asset.import' }) })))
        },
      })
    })
  }
  return { fetch: serve, imports, writes: scripted.writes }
}

function microphone(): Recorder {
  return { start: () => Promise.resolve(() => Promise.resolve(new File(['RIFF'], 'line.wav', { type: 'audio/wav' }))) }
}

describe('the teleprompter', () => {
  it('loads a script, records its lines one at a time, and fills the words of a take to convert', async () => {
    const api = server([])
    const view = render(<VoicePanel projectId="p1" session="s5" client={new DvClient(api.fetch)} recorder={microphone()} readText={() => Promise.resolve(SCRIPT)} />)
    expect(await view.findByText(/^Load a \.txt or \.md script/)).toBeTruthy()
    fireEvent.change(view.getByTestId('dv-voice-script-upload'), { target: { files: [new File([SCRIPT], 'Scene 1.md')] } })
    await waitFor(() => { expect(api.imports).toHaveLength(1) })
    expect([api.imports[0]?.query.get('name'), api.imports[0]?.query.get('mime')]).toEqual(['Scene 1.md', 'text/plain'])
    api.imports[0]?.answer('scene.md')
    const line = await view.findByTestId('dv-voice-prompter-line')
    expect(line.textContent).toBe('Not quite my tempo.')
    const prompter = view.getByTestId('dv-voice-prompter')
    expect(within(prompter).getByText('Line 1 / 4')).toBeTruthy()
    expect(within(prompter).getByText('FLETCHER')).toBeTruthy()

    // The keys move between lines; Space starts and stops a take, Enter keeps it under the line's file name.
    fireEvent.keyDown(prompter, { key: 'ArrowRight' })
    expect(line.textContent).toBe('I was rushing?')
    fireEvent.keyDown(prompter, { key: 'ArrowLeft' })
    fireEvent.keyDown(prompter, { key: 'ArrowLeft' })
    expect(within(prompter).getByText('Line 1 / 4')).toBeTruthy()
    fireEvent.keyDown(prompter, { key: ' ' })
    expect(await view.findByText('Recording…')).toBeTruthy()
    fireEvent.keyDown(prompter, { key: ' ' })
    expect(await view.findByLabelText('scene-1-line-01.wav')).toBeTruthy()
    fireEvent.keyDown(prompter, { key: 'Enter' })
    await waitFor(() => { expect(api.imports).toHaveLength(2) })
    expect([api.imports[1]?.query.get('name'), api.imports[1]?.file.name]).toEqual(['scene-1-line-01.wav', 'scene-1-line-01.wav'])
    api.imports[1]?.answer('scene-1-line-01.wav')
    expect(await view.findByText('Kept line 1.')).toBeTruthy()
    expect(within(prompter).getByText('Line 2 / 4')).toBeTruthy()
    expect((view.getByLabelText('Words of the line') as HTMLTextAreaElement).value).toBe('Not quite my tempo.')

    // The buttons: Record line, Retake, Keep take; Previous and Next; a click on a listed line jumps to it.
    fireEvent.click(view.getByRole('button', { name: 'Record line' }))
    fireEvent.click(await view.findByRole('button', { name: 'Stop' }))
    fireEvent.click(await view.findByRole('button', { name: 'Retake' }))
    fireEvent.click(await view.findByRole('button', { name: 'Stop' }))
    fireEvent.click(await view.findByRole('button', { name: 'Keep take' }))
    await waitFor(() => { expect(api.imports).toHaveLength(3) })
    api.imports[2]?.answer('scene-1-line-02.wav')
    await waitFor(() => { expect(within(prompter).getByText('Line 3 / 4')).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: 'Next' }))
    fireEvent.click(view.getByRole('button', { name: 'Previous' }))
    fireEvent.click(view.getByRole('button', { name: /I was rushing\?$/ }))
    expect(await within(prompter).findByText(/^Line 2 \/ 4 · recorded ✓$/)).toBeTruthy()
    expect(view.getByRole('button', { name: '✓ ANDREW: I was rushing?' })).toBeTruthy()

    // Choosing a line's take in the convert form brings its words; another recording leaves the words.
    fireEvent.change(view.getByLabelText('Words of the line'), { target: { value: 'typed' } })
    fireEvent.change(view.getByLabelText('Recording'), { target: { value: 'scene-1-line-01.wav' } })
    expect((view.getByLabelText('Words of the line') as HTMLTextAreaElement).value).toBe('Not quite my tempo.')
    fireEvent.change(view.getByLabelText('Recording'), { target: { value: 'scene-1-line-02.wav' } })
    expect((view.getByLabelText('Words of the line') as HTMLTextAreaElement).value).toBe('I was rushing?')
  })

  it('ignores keys while a button has focus or a keep is running, and says when a script has no lines', async () => {
    const api = server([
      asset('empty.txt', 'text/plain', null, null, 'asset.import'), asset('plain.txt', 'text/plain', null, null, 'asset.import'),
      asset('scene.txt', 'text/plain', null, null, 'asset.import'),
    ])
    const texts: Record<string, string> = { 'empty.txt': '(Nothing.)\n', 'plain.txt': 'Hello there.', 'scene.txt': 'A: One.\nB: Two.' }
    const view = render(<VoicePanel projectId="p1" session={null} client={new DvClient(api.fetch)} recorder={microphone()} readText={id => Promise.resolve(texts[id] ?? '')} />)
    fireEvent.change(await view.findByLabelText('Script'), { target: { value: 'empty.txt' } })
    expect(await view.findByText('This script has no lines.')).toBeTruthy()
    // A script without speakers shows its lines without a name.
    fireEvent.change(view.getByLabelText('Script'), { target: { value: 'plain.txt' } })
    expect((await view.findByTestId('dv-voice-prompter-line')).textContent).toBe('Hello there.')
    expect(view.getByRole('button', { name: 'Hello there.' })).toBeTruthy()
    fireEvent.change(view.getByLabelText('Script'), { target: { value: 'scene.txt' } })
    const prompter = await view.findByTestId('dv-voice-prompter')
    fireEvent.keyDown(view.getByRole('button', { name: 'Next' }), { key: 'ArrowRight' })
    expect(within(prompter).getByText('Line 1 / 2')).toBeTruthy()
    fireEvent.keyDown(prompter, { key: 'Enter' })
    fireEvent.keyDown(prompter, { key: 'x' })
    expect(api.imports).toEqual([])
    fireEvent.keyDown(prompter, { key: ' ' })
    await view.findByText('Recording…')
    // A key on an element inside the teleprompter is not the teleprompter's.
    fireEvent.keyDown(within(prompter).getByText('Line 1 / 2'), { key: ' ' })
    fireEvent.keyDown(prompter, { key: ' ' })
    await view.findByRole('button', { name: 'Keep take' })
    fireEvent.keyDown(prompter, { key: 'Enter' })
    await waitFor(() => { expect(api.imports).toHaveLength(1) })
    fireEvent.keyDown(prompter, { key: 'ArrowRight' })
    expect(within(prompter).getByText('Line 1 / 2')).toBeTruthy()
    api.imports[0]?.answer('scene-line-01.wav')
    // The last line stays the current one after its keep.
    await waitFor(() => { expect(within(prompter).getByText('Line 2 / 2')).toBeTruthy() })
  })

  it('loads a typed script file from the Load script button, ignores an empty choice, and shows only the newest read', async () => {
    const api = server([asset('old.txt', 'text/plain', null, null, 'asset.import'), asset('new.txt', 'text/plain', null, null, 'asset.import')])
    const reads: Record<string, (text: string) => void> = {}
    const view = render(
      <VoicePanel
        projectId="p1" session={null} client={new DvClient(api.fetch)} recorder={microphone()}
        readText={id => new Promise((resolve) => { reads[id] = resolve })}
      />,
    )
    const upload = await view.findByTestId('dv-voice-script-upload') as HTMLInputElement
    const click = vi.spyOn(upload, 'click')
    fireEvent.click(view.getByRole('button', { name: 'Load script' }))
    expect(click).toHaveBeenCalled()
    fireEvent.change(upload, { target: { files: [] } })
    expect(api.imports).toEqual([])
    fireEvent.change(upload, { target: { files: [new File(['A: One.'], 'typed.txt', { type: 'text/plain' })] } })
    await waitFor(() => { expect(api.imports).toHaveLength(1) })
    expect(api.imports[0]?.file.type).toBe('text/plain')
    // The first script's text arrives after the choice moved on; only the chosen script's lines show.
    await waitFor(() => { expect(Object.keys(reads)).toContain('old.txt') })
    fireEvent.change(view.getByLabelText('Script'), { target: { value: 'new.txt' } })
    await waitFor(() => { expect(Object.keys(reads)).toContain('new.txt') })
    act(() => { reads['old.txt']?.('A: From the old script.') })
    act(() => { reads['new.txt']?.('A: From the new script.') })
    expect((await view.findByTestId('dv-voice-prompter-line')).textContent).toBe('From the new script.')
  })

  it('names a script that cannot be read', async () => {
    const api = server([asset('scene.txt', 'text/plain', null, null, 'asset.import')])
    const view = render(<VoicePanel projectId="p1" session={null} client={new DvClient(api.fetch)} recorder={microphone()} readText={() => Promise.reject(new Error('The asset scene.txt cannot be read: HTTP 404.'))} />)
    expect((await view.findByRole('alert')).textContent).toBe('The asset scene.txt cannot be read: HTTP 404.')
  })
})
