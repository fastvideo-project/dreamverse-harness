// @vitest-environment jsdom
/**
 * The `dv.prompt` composer on the real slot runtime, with DSH's `conversation.prompt` Factory, the `@` trigger
 * pipeline outside any Session, and the real media plugins, over the fixture project: scenario S4 (a cited version with
 * its image, a model change that moves the cost, an `@` pick, a send), S6 (removing a reference tile turns its chips
 * into text, and one undo restores both), the round-trip law of an unedited send, a chip drawn with no call, and the
 * words of an occurrence, which name a kind only when the operation's parameter bar gives them.
 */
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PromptHostModel } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createRegistry, type MentionKind } from '@dv/ui-kit/registries.ts'
import type { OperationCheck, WireModelEntry, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { testRef } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import { fixtureState, MODELS, OPERATIONS, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { shotRenderBar } from '../../ui-shot-render/src/client/param-bar.ts'
import type { DvPromptProps, PromptCall } from '../src/client/contract/index.ts'
import { projectMentionSource } from '../src/client/mention.ts'
import { composerStack } from './composer-stack.client.ts'

const HERO = '@[Hero](dv:test_ref/hero)'
const KEY = { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3' }

/** An operation that no parameter bar describes: its default chips come from its declared params. */
const STILL: WireOperation = {
  ...OPERATIONS[0]!, name: 'test_still.generate', label: { zh: '生成静帧', en: 'Generate still' },
  params: { prompt: { type: 'string', required: true, description: 'What to make.' }, seed: { type: 'integer', description: 'Seed.' } },
}

beforeEach(() => {
  // jsdom has no layout: the menu scrolls its highlighted row into view, and the editor measures its selection.
  Element.prototype.scrollIntoView = vi.fn()
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  document.documentElement.lang = 'en'
})
const runtimes: SlotTestRuntime[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

/** How {@link mount} composes the occurrence and the server. */
interface MountOptions {
  /** Edits the served state. */
  edit?: (state: WireState) => void
  /** The served model catalog; the fixture's by default. */
  models?: WireModelEntry[]
  /** A send waits until the test answers it. */
  holdSend?: boolean
  /** The project state waits until the test releases it. */
  holdState?: boolean
  /** Each check waits until the test answers it. */
  holdChecks?: boolean
  /** The occurrence only shows the call. */
  readOnly?: boolean
  /** The host gives no send. */
  noSend?: boolean
  /** Changes to the prompt occurrence that shows Hero's chip with no call. */
  bare?: Partial<PromptHostModel>
  /** The project the shell has open; p1 by default. */
  open?: string | null
}

/** One held request of the server: the test answers it with a body or a failure. */
interface Held<T> {
  answer: (body: T) => void
  fail: (error: Error) => void
}

/**
 * Mount the composer stack with the reference noun, the media plugins, the `@` source and the `shot.render` bar, and
 * render one `dv.prompt` occurrence of `call` and one prompt occurrence with no call that shows Hero's chip.
 * @param call - the call the occurrence edits.
 * @param options - the state, the catalog, the held requests, the mode, and the bare occurrence.
 * @returns the runtime, the view, the sent calls, the held requests, the host spy, the occurrence's element, the server's
 *   writes, and a setter of the call.
 */
async function mount(call: PromptCall, options: MountOptions = {}) {
  const state = withTestRef(fixtureState())
  options.edit?.(state)
  const scripted = scriptedFetch({ state, operations: [...OPERATIONS, STILL], models: options.models ?? MODELS })
  const heldStates: Array<() => void> = []
  const checks: Array<Held<OperationCheck>> = []
  const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host').pathname
    const answer = scripted.fetch(input, init)
    if (options.holdState === true && path === '/api/dv/state') return new Promise((resolve) => { heldStates.push(() => { resolve(answer) }) })
    if (options.holdChecks === true && path === '/api/dv/operation/check') {
      return new Promise((resolve, reject) => { checks.push({ answer: (body) => { resolve(json(body)) }, fail: reject }) })
    }
    return answer
  })
  publishCurrentProject(options.open === undefined ? 'p1' : options.open)
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('dvCanvas', createDvCanvas())
  const mentions = { kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) }
  runtime.ctx.provide('dvMentions', mentions)
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
  await runtime.mount(composerStack)
  runtime.ctx.effect(() => runtime.ctx.inputTriggers.registerSource(projectMentionSource(mentions, () => [])))
  runtime.ctx.effect(() => runtime.ctx.dvComposer.paramBars.register(shotRenderBar))
  const sent: PromptCall[] = []
  const answers: Array<() => void> = []
  const host = { pickAssets: vi.fn(), preview: vi.fn(), openNode: vi.fn() }
  const onSubmit = (edited: PromptCall): Promise<void> => {
    sent.push(edited)
    return options.holdSend === true ? new Promise<void>((resolve) => { answers.push(resolve) }) : Promise.resolve()
  }
  const props = (shown: PromptCall): DvPromptProps => ({
    projectId: 'p1', call: shown, readOnly: options.readOnly === true, host, ...options.noSend === true || options.readOnly === true ? {} : { onSubmit },
  })
  // A prompt occurrence that gives its chips no call: its face names the element's newest version.
  const bare: PromptHostModel = {
    content: { revision: 0, text: HERO, chips: [{ source: 'dv-project', ref: HERO, label: 'Hero', offset: 0, length: HERO.length, clipboardText: HERO }] },
    readOnly: true, sources: [], sourceContext: null, faceContext: null, onChange: () => {}, placeholder: '', ariaLabel: 'bare',
    ...options.bare,
  }
  let setCall: (next: PromptCall) => void = () => {}
  await runtime.root.declare({}, ({ renderFactorySlot }: PropsRuntime<'root'> & PropsRenderFactories): ReactNode => {
    const [shown, update] = useState(call)
    setCall = update
    return (
      <>
        <section data-testid="take">{renderFactorySlot('dv.prompt', props(shown))}</section>
        <section data-testid="bare">{renderFactorySlot('conversation.prompt', { model: bare })}</section>
      </>
    )
  })
  const view = runtime.renderRoot()
  const take = view.getByTestId('take')
  return {
    runtime, view, take, sent, answers, host, writes: scripted.writes, checks,
    releaseState: () => { act(() => { heldStates.splice(0).forEach((release) => { release() }) }) },
    setCall: (next: PromptCall) => { act(() => { setCall(next) }) },
  }
}

/** The occurrence's editor box. */
const box = (take: HTMLElement): HTMLElement => {
  const found = take.querySelector<HTMLElement>('[data-composer-input]')
  if (found === null) throw new Error('no editor box')
  return found
}

/** The first element under `root` that `selector` names, once it renders. */
const found = (root: HTMLElement, selector: string): Promise<HTMLElement> => waitFor(() => {
  const element = root.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`no ${selector}`)
  return element
})

/** The send button once the call's check has answered. */
const sendOf = (take: HTMLElement, name: string): Promise<HTMLButtonElement> => waitFor(() => {
  const button = within(take).getByRole<HTMLButtonElement>('button', { name })
  if (button.disabled) throw new Error('the call is not checked yet')
  return button
})

describe('dv.prompt on the real stack', () => {
  it('S4: shows the cited version with its image, moves the cost with the model and duration, inserts an @ pick, and sends the edited call', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs`, duration_sec: 5 }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, view, sent, writes } = await mount(stored)
    const chip = await waitFor(() => {
      const face = take.querySelector('[data-dv-chip="dv:test_ref/hero"]')
      expect(face?.querySelector('img')?.getAttribute('src')).toContain('ref.png')
      return face!
    })
    expect(chip.textContent).toBe('Herov1')
    expect(take.querySelector('[data-reference-tile="hero@1"]')?.getAttribute('data-cited')).toBe('true')
    const cost = within(take).getByTestId('dv-prompt-cost')
    await waitFor(() => { expect(cost.textContent).toBe('≈ 20 GPU s') })
    fireEvent.change(within(take).getByTestId('dv-prompt-model'), { target: { value: 'fastvideo/fastt2v/t2v' } })
    await waitFor(() => { expect(cost.textContent).toBe('≈ 10 GPU s') })
    fireEvent.change(within(take).getByTestId('dv-prompt-model'), { target: { value: 'fastvideo/fasth3/ref2v' } })
    fireEvent.change(take.querySelector('[data-param-chip="duration_sec"]')!, { target: { value: '2' } })
    await waitFor(() => { expect(cost.textContent).toBe('≈ 8 GPU s') })
    // Typing @ at the end opens the menu of this occurrence; the pick inserts Hero's chip and keeps the one input.
    act(() => { box(take).focus() })
    // jsdom fires no beforeinput, so the text arrives through the editor's paste path, which `@` detection follows.
    fireEvent.paste(box(take), { clipboardData: { items: [], getData: () => ' with @' } })
    const option = await waitFor(() => {
      const found = view.container.querySelector('[role="option"]')
      expect(found?.textContent).toContain('Hero')
      return found!
    })
    fireEvent.mouseDown(option)
    await waitFor(() => { expect(take.querySelectorAll('[data-dv-chip="dv:test_ref/hero"]')).toHaveLength(2) })
    expect(take.querySelectorAll('[data-reference-tile]')).toHaveLength(1)
    fireEvent.click(await sendOf(take, 'Render new take'))
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]).toEqual({
      operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs with ${HERO} `, duration_sec: 2 }, inputs: [{ role: 'reference', ref: 'hero@1' }],
    })
    // Every check went to the kernel's check route with the call as edited at that moment.
    expect(writes.filter(write => write.path === '/api/dv/operation/check').at(-1)?.body).toMatchObject({ project: 'p1', params: { duration_sec: 2 } })
  })

  it('the round-trip law: an unedited send is the stored call, with its uncited input in its place', async () => {
    const stored: PromptCall = {
      operation: 'shot.render', params: { ...KEY, prompt: '@[Rain](dv:asset/shot1-last.png) falls on Hero', duration_sec: 3 },
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'shot1-last.png' }],
    }
    const { take, sent } = await mount(stored)
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@1"]')?.getAttribute('data-cited')).toBe('false') })
    fireEvent.click(await sendOf(take, 'Render new take'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })

  it('S6: removing a tile turns its chip into text, and one undo restores the chip and the input in its place', async () => {
    const stored: PromptCall = {
      operation: 'shot.render', params: { ...KEY, prompt: `${HERO} holds the lamp from @[Take](dv:asset/shot1-last.png)` },
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'shot1-last.png' }],
    }
    const { take, sent } = await mount(stored)
    await waitFor(() => { expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"] img')).not.toBeNull() })
    fireEvent.click(within(take).getByRole('button', { name: 'Remove Hero' }))
    await waitFor(() => { expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"]')).toBeNull() })
    expect(box(take).textContent).toBe('Hero holds the lamp from Take')
    expect([...take.querySelectorAll('[data-reference-tile]')].map(tile => tile.getAttribute('data-reference-tile'))).toEqual(['shot1-last.png'])
    // One Ctrl+Z in the editor undoes the tile removal: the chip comes back and so does its input, first again.
    fireEvent.keyDown(box(take), { key: 'z', code: 'KeyZ', ctrlKey: true })
    await waitFor(() => { expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"]')).not.toBeNull() })
    expect([...take.querySelectorAll('[data-reference-tile]')].map(tile => tile.getAttribute('data-reference-tile'))).toEqual(['hero@1', 'shot1-last.png'])
    fireEvent.click(await sendOf(take, 'Render new take'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })

  it('draws a chip of an occurrence with no call through the same face, at the element\'s newest version and with no sent version', async () => {
    const { view } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] })
    const bare = view.getByTestId('bare')
    await waitFor(() => { expect(bare.querySelector('[data-dv-chip="dv:test_ref/hero"] img')?.getAttribute('src')).toContain('ref.png') })
    expect(bare.querySelector('[data-dv-chip="dv:test_ref/hero"]')?.textContent).toBe('Hero')
  })
})

describe('the words of an occurrence', () => {
  it('names no kind for an operation whose parameter bar gives no words', async () => {
    const still = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { holdSend: true })
    const neutral = await sendOf(still.take, 'Generate a new version')
    expect(box(still.take).getAttribute('data-placeholder')).toBe('Describe what to generate')
    fireEvent.click(neutral)
    await waitFor(() => { expect(within(still.take).getByRole('button', { name: 'Generating…' }).hasAttribute('disabled')).toBe(true) })
    expect(still.take.textContent).not.toMatch(/shot|take|render/iu)
    act(() => { still.answers.splice(0).forEach((answer) => { answer() }) })
    await sendOf(still.take, 'Generate a new version')
  })

  it('names the shot where the shot.render bar gives its words', async () => {
    const shot = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] }, { holdSend: true })
    fireEvent.click(await sendOf(shot.take, 'Render new take'))
    expect(box(shot.take).getAttribute('data-placeholder')).toBe('Describe the shot; type @ to cite an item')
    await waitFor(() => { expect(within(shot.take).getByRole('button', { name: 'Rendering…' })).toBeTruthy() })
  })

  it('shows the error of a check that cannot reach the route as the problem, and blocks the send', async () => {
    const { take } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] })
    await sendOf(take, 'Generate a new version')
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    fireEvent.change(take.querySelector('[data-param-chip="seed"]')!, { target: { value: '7' } })
    fireEvent.blur(take.querySelector('[data-param-chip="seed"]')!)
    await waitFor(() => { expect(within(take).getByRole('alert').textContent).toBe('offline') })
    expect(within(take).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled).toBe(true)
  })
})

describe('the modes of an occurrence', () => {
  it('shows the stored call in read mode: its tiles with nothing to remove or add, and no parameter bar, send or check', async () => {
    const { take, writes } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }, { readOnly: true })
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@1"]')?.textContent).toBe('Herov1') })
    expect([within(take).queryByRole('button', { name: 'Remove Hero' }), within(take).queryByRole('button', { name: 'Add asset' })]).toEqual([null, null])
    expect([within(take).queryByTestId('dv-prompt-model'), within(take).queryByRole('button', { name: 'Render new take' })]).toEqual([null, null])
    expect(box(take).getAttribute('contenteditable')).toBe('false')
    await act(() => new Promise((resolve) => { setTimeout(resolve, 300) }))
    expect(writes.filter(write => write.path === '/api/dv/operation/check')).toEqual([])
  })

  it('stays read-only until the project state loads, and starts over on a call that changes meanwhile', async () => {
    const first: PromptCall = { operation: STILL.name, params: { prompt: `${HERO} rain` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, sent, setCall, releaseState, host } = await mount(first, { holdState: true })
    await waitFor(() => { expect(box(take).textContent).toBe('Hero rain') })
    expect(box(take).getAttribute('contenteditable')).toBe('false')
    // A chip clicked before the state loads opens nothing.
    fireEvent.click(take.querySelector('[data-dv-chip]')!, { detail: 1 })
    const second: PromptCall = { ...first, params: { prompt: 'snow' }, inputs: [] }
    setCall(second)
    await waitFor(() => { expect(box(take).textContent).toBe('snow') })
    releaseState()
    await waitFor(() => { expect(box(take).getAttribute('contenteditable')).toBe('true') })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent).toEqual([second]) })
    expect([host.openNode.mock.calls, host.preview.mock.calls]).toEqual([[], []])
  })

  it('offers no send to an editable occurrence whose host gives none, by the button or by Enter', async () => {
    const { take, writes } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { noSend: true })
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation/check')).toBe(true) })
    expect(within(take).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled).toBe(true)
    fireEvent.keyDown(box(take), { key: 'Enter', code: 'Enter' })
    expect(writes.some(write => write.path === '/api/dv/operation')).toBe(false)
  })
})

describe('the check and the send', () => {
  it('shows the answer of the latest check only, and drops a late answer or failure of an earlier one', async () => {
    const { take, checks } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { holdChecks: true })
    await waitFor(() => { expect(checks).toHaveLength(1) })
    const seed = (): HTMLInputElement => take.querySelector('[data-param-chip="seed"]')!
    fireEvent.blur(seed(), { target: { value: '2' } })
    await waitFor(() => { expect(checks).toHaveLength(2) })
    fireEvent.blur(seed(), { target: { value: '3' } })
    await waitFor(() => { expect(checks).toHaveLength(3) })
    act(() => {
      checks[0]?.answer({ problems: [], gpu_seconds: 99 })
      checks[1]?.fail(new Error('offline'))
    })
    await act(() => new Promise((resolve) => { setTimeout(resolve, 20) }))
    expect([within(take).getByTestId('dv-prompt-cost').textContent, within(take).queryByRole('alert')]).toEqual(['', null])
    act(() => { checks[2]?.answer({ problems: [], gpu_seconds: 7 }) })
    await waitFor(() => { expect(within(take).getByTestId('dv-prompt-cost').textContent).toBe('≈ 7 GPU s') })
  })

  it('sends on Enter once the check has answered, and not again while the send runs', async () => {
    const { take, sent, checks, answers } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { holdChecks: true, holdSend: true })
    await waitFor(() => { expect(checks).toHaveLength(1) })
    fireEvent.keyDown(box(take), { key: 'Enter', code: 'Enter' })
    expect(sent).toEqual([])
    act(() => { checks[0]?.answer({ problems: [], gpu_seconds: null }) })
    await sendOf(take, 'Generate a new version')
    fireEvent.keyDown(box(take), { key: 'Enter', code: 'Enter' })
    await waitFor(() => { expect(sent).toHaveLength(1) })
    fireEvent.keyDown(box(take), { key: 'Enter', code: 'Enter' })
    expect(sent).toHaveLength(1)
    act(() => { answers.splice(0).forEach((answer) => { answer() }) })
    expect(within(take).getByTestId('dv-prompt-cost').textContent).toBe('')
  })
})

describe('what the references open', () => {
  it('opens the node of a clicked element chip and the preview of a clicked asset chip, and nothing for a chip it cannot resolve', async () => {
    const stored: PromptCall = {
      operation: 'shot.render', params: { ...KEY, prompt: `${HERO} by @[Rain](dv:asset/shot1-last.png) and @[Prop](dv:test_prop/p1)` },
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'shot1-last.png' }],
    }
    const { take, host } = await mount(stored)
    fireEvent.click(await found(take, '[data-dv-chip="dv:test_ref/hero"] img'), { detail: 1 })
    fireEvent.click(await found(take, '[data-dv-chip="dv:asset/shot1-last.png"] img'), { detail: 1 })
    fireEvent.click(await found(take, '[data-dv-chip="dv:test_prop/p1"]'), { detail: 1 })
    expect([host.openNode.mock.calls, host.preview.mock.calls]).toEqual([[['test_ref:hero']], [['shot1-last.png', null]]])
  })

  it('previews an asset tile from the tile, and opens nothing for a tile of an asset that the project lacks', async () => {
    const { take, host } = await mount({ operation: STILL.name, params: { prompt: 'rain' }, inputs: [{ role: 'reference', ref: 'gone.png' }, { role: 'reference', ref: 'ref.png' }] })
    fireEvent.click(await found(take, '[data-reference-tile="gone.png"] button'))
    const shown = await found(take, '[data-reference-tile="ref.png"] button')
    fireEvent.click(shown)
    expect([host.preview.mock.calls, host.openNode.mock.calls]).toEqual([[['ref.png', shown]], []])
  })

  it('pins the version a call sends: Use v2 rewrites the input, and the tile, the chip and the send follow it', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, sent } = await mount(stored, {
      edit: (state) => {
        state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['shot2-last.png'], created_by: 'e1' })
      },
    })
    const tile = await waitFor(() => {
      const found = take.querySelector<HTMLElement>('[data-reference-tile="hero@1"]')
      expect(found?.textContent).toContain('Use v2')
      return found!
    })
    fireEvent.click(within(tile).getByRole('button', { name: 'Use v2' }))
    // The tile reads Hero v2 with its remove button, and offers no newer version.
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@2"]')?.textContent).toBe('Herov2×') })
    await waitFor(() => { expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"]')?.textContent).toBe('Herov2') })
    expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"] img')?.getAttribute('src')).toContain('shot2-last.png')
    fireEvent.click(await sendOf(take, 'Render new take'))
    await waitFor(() => { expect(sent).toEqual([{ ...stored, inputs: [{ role: 'reference', ref: 'hero@2' }] }]) })
  })
})

describe('the chips of the parameter bar', () => {
  it('keeps the params when the stored model, which the catalog lacks, stays picked, and shows no chip of the bar for it', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, model: 'gone', prompt: 'rain' }, inputs: [] }
    const { take, sent } = await mount(stored)
    const model = await waitFor(() => within(take).getByTestId<HTMLSelectElement>('dv-prompt-model'))
    expect(model.value).toBe('')
    fireEvent.change(model, { target: { value: '' } })
    expect(take.querySelectorAll('[data-param-chip]')).toHaveLength(0)
    fireEvent.click(await sendOf(take, 'Render new take'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })

  it('types a free-text chip by its declaration: a number, nothing for an emptied field, and the old value for text it cannot take', async () => {
    const { take, sent } = await mount({ operation: STILL.name, params: { prompt: 'rain', seed: 3 }, inputs: [] })
    const seed = (): HTMLInputElement => take.querySelector('[data-param-chip="seed"]')!
    await waitFor(() => { expect(seed().value).toBe('3') })
    fireEvent.blur(seed(), { target: { value: 'abc' } })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent.at(-1)?.params).toEqual({ prompt: 'rain', seed: 3 }) })
    fireEvent.blur(seed(), { target: { value: '9' } })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent.at(-1)?.params).toEqual({ prompt: 'rain', seed: 9 }) })
    fireEvent.blur(seed(), { target: { value: '' } })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent.at(-1)?.params).toEqual({ prompt: 'rain' }) })
  })

  it('changes nothing for a bar chip of a param that the operation does not declare, or for the current value outside its choices', async () => {
    const bare: WireModelEntry = { ...MODELS[0]!, schema: { duration_sec: { min: 1, max: 5 }, aspect_ratios: ['16:9'], inputs: {} } }
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: 'rain', duration_sec: 9 }, inputs: [] }
    const { take, sent } = await mount(stored, { models: [bare] })
    fireEvent.blur(await found(take, 'input[data-param-chip="resolution"]'), { target: { value: '4k' } })
    fireEvent.change(take.querySelector('[data-param-chip="duration_sec"]')!, { target: { value: '9' } })
    fireEvent.click(await sendOf(take, 'Render new take'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })
})

describe('the chip face', () => {
  it('reads the open project for a chip whose face context names no project, and skips context inputs that are not inputs', async () => {
    const { view } = await mount({ operation: STILL.name, params: { prompt: 'rain' }, inputs: [] }, {
      bare: { faceContext: { projectId: 'p1', inputs: [7, { role: 'reference', ref: 'hero@1' }], filter: { mediaTypes: ['image'], maxReferences: 'x' } } },
    })
    const bare = view.getByTestId('bare')
    await waitFor(() => { expect(bare.querySelector('[data-dv-chip="dv:test_ref/hero"]')?.textContent).toBe('Herov1') })
  })

  it('draws a chat chip at the open project\'s newest version when its face context is not a call\'s', async () => {
    const { view } = await mount({ operation: STILL.name, params: { prompt: 'rain' }, inputs: [] }, { bare: { faceContext: { inputs: [] } } })
    await waitFor(() => { expect(view.getByTestId('bare').querySelector('[data-dv-chip="dv:test_ref/hero"]')?.textContent).toBe('Hero') })
  })

  it('draws the label alone while no project is open, and for a chip whose reference is no citation', async () => {
    const plain = 'cat'
    const { view } = await mount({ operation: STILL.name, params: { prompt: 'rain' }, inputs: [] }, {
      open: null,
      bare: {
        content: {
          revision: 0, text: `${HERO} ${plain}`,
          chips: [
            { source: 'dv-project', ref: HERO, label: 'Hero', offset: 0, length: HERO.length, clipboardText: HERO },
            { source: 'dv-project', ref: plain, label: 'Cat', offset: HERO.length + 1, length: plain.length, clipboardText: plain },
          ],
        },
      },
    })
    const bare = view.getByTestId('bare')
    await waitFor(() => { expect(bare.querySelectorAll('[data-dv-chip]')).toHaveLength(2) })
    await act(() => new Promise((resolve) => { setTimeout(resolve, 50) }))
    expect([...bare.querySelectorAll('[data-dv-chip]')].map(face => [face.getAttribute('data-dv-chip'), face.textContent, face.querySelector('img')]))
      .toEqual([['dv:test_ref/hero', 'Hero', null], ['', 'Cat', null]])
  })
})
