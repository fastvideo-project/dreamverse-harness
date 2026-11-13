// @vitest-environment jsdom
/**
 * The `dv.prompt` composer on the real slot runtime, with DSH's `conversation.prompt` Factory, the `@` trigger
 * pipeline outside any Session, and the real media plugins, over the fixture project.
 */
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PromptHostModel } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parsePromptCitations } from '@dv/project/grammar'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createRegistry, type MentionKind } from '@dv/ui-kit/registries.ts'
import type { OperationCheck, WireModelEntry, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { testRef } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import { fixtureState, MODELS, OPERATIONS, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { shotRenderBar } from '../../ui-shot-render/src/client/param-bar.ts'
import type { DvPromptProps, PromptCall, PromptHost } from '../src/client/contract/index.ts'
import { draftKey, readDraft, resetDrafts } from '../src/client/drafts.ts'
import { projectMentionSource } from '../src/client/mention.ts'
import { composerStack } from './composer-stack.client.ts'

const HERO = '@[Hero](dv:test_ref/hero)'

/** The bar of `shot.render` as the generation kit registers it from the shot render declaration. */
const SHOT_BAR = { ...shotRenderBar, operation: 'shot.render', owner: '@dv/ui-shot-render', copy: { ...shotRenderBar.copy, sending: ['渲染中…', 'Rendering…'] as const } }
const KEY = { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3' }

const STILL: WireOperation = {
  ...OPERATIONS[0]!, name: 'test_still.generate', label: { zh: '生成静帧', en: 'Generate still' },
  params: { prompt: { type: 'string', required: true, description: 'What to make.' }, seed: { type: 'integer', description: 'Seed.' } },
}

beforeEach(() => {
  resetDrafts()
  // jsdom has no layout: the menu scrolls its highlighted row into view, and the editor measures its selection.
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom has no ClipboardEvent, which the editor's cut and copy read.
  vi.stubGlobal('ClipboardEvent', class ClipboardEvent extends Event {})
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  document.documentElement.lang = 'en'
})
const runtimes: SlotTestRuntime[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

interface MountOptions {
  edit?: (state: WireState) => void
  models?: WireModelEntry[]
  holdSend?: boolean
  holdState?: boolean
  holdChecks?: boolean
  /** The model catalog waits until the test releases it. */
  holdModels?: boolean
  /** The model catalog read fails while `down` is true. */
  modelsDown?: { down: boolean }
  /** The host's send refuses with this message. */
  refuseSend?: string
  /** The host's import refuses with this message. */
  refuseImport?: string
  /** The surface that the host names; the canvas by default. */
  surface?: DvPromptProps['surface']
  /** The canvas and its version kinds arrive after the composer opens, when the test provides them. */
  lateCanvas?: boolean
  readOnly?: boolean
  noSend?: boolean
  noPicker?: boolean
  bare?: Partial<PromptHostModel>
  open?: string | null
  /** Edits the state that the host lends after the served state is set; the server never sees the edit. */
  lend?: (state: WireState) => void
  /** The operations that the server lists; the host lends the fixture's operations and STILL either way. */
  served?: WireOperation[]
}

interface Held<T> {
  answer: (body: T) => void
  fail: (error: Error) => void
}

/**
 * Mount the composer stack with its plugins, and render one `dv.prompt` occurrence of `call` beside one prompt
 * occurrence with no call that shows Hero's chip.
 */
async function mount(call: PromptCall, options: MountOptions = {}) {
  const state = withTestRef(fixtureState())
  options.edit?.(state)
  const lent = structuredClone(state)
  options.lend?.(lent)
  const scripted = scriptedFetch({ state, operations: options.served ?? [...OPERATIONS, STILL], models: options.models ?? MODELS })
  const requested: string[] = []
  const heldStates: Array<() => void> = []
  const heldModels: Array<() => void> = []
  const checks: Array<Held<OperationCheck>> = []
  const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host').pathname
    const answer = scripted.fetch(input, init)
    requested.push(path)
    if (options.holdState === true && path === '/api/dv/state') return new Promise((resolve) => { heldStates.push(() => { resolve(answer) }) })
    if (options.modelsDown?.down === true && path === '/api/dv/models') return Promise.resolve(new Response(JSON.stringify({ error: 'The model service is down.' }), { status: 503, headers: { 'content-type': 'application/json' } }))
    if (options.holdModels === true && path === '/api/dv/models') return new Promise((resolve) => { heldModels.push(() => { resolve(answer) }) })
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
  if (options.lateCanvas !== true) runtime.ctx.provide('dvCanvas', createDvCanvas())
  const mentions = { kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) }
  runtime.ctx.provide('dvMentions', mentions)
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  if (options.lateCanvas !== true) await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
  await runtime.mount(composerStack)
  runtime.ctx.effect(() => runtime.ctx.inputTriggers.registerSource(projectMentionSource(mentions, () => [])))
  runtime.ctx.effect(() => runtime.ctx.dvComposer.paramBars.register(SHOT_BAR))
  const sent: PromptCall[] = []
  const answers: Array<() => void> = []
  const host = {
    preview: vi.fn(), openNode: vi.fn(),
    ...options.noPicker === true
      ? {}
      : {
        pickAssets: vi.fn<NonNullable<PromptHost['pickAssets']>>(),
        importFiles: vi.fn<NonNullable<PromptHost['importFiles']>>(files => options.refuseImport === undefined
          ? Promise.resolve(files.map(file => file.name))
          : Promise.reject(new Error(options.refuseImport))),
      },
  }
  const onSubmit = (edited: PromptCall): Promise<void> => {
    sent.push(edited)
    if (options.refuseSend !== undefined) return Promise.reject(new Error(options.refuseSend))
    return options.holdSend === true ? new Promise<void>((resolve) => { answers.push(resolve) }) : Promise.resolve()
  }
  // The record the host lends the call from; a test changes it to open another take with an equal call.
  let draftId = 'r1'
  const props = (shown: PromptCall, state: WireState, projectId: string): DvPromptProps => ({
    projectId, draftId, call: shown, state, operations: [...OPERATIONS, STILL], readOnly: options.readOnly === true, host,
    surface: options.surface ?? 'canvas',
    ...options.noSend === true || options.readOnly === true ? {} : { onSubmit },
  })
  const bare: PromptHostModel = {
    content: { revision: 0, history: 'reset', text: HERO, chips: [{ source: 'dv-project', ref: HERO, label: 'Hero', offset: 0, length: HERO.length, clipboardText: HERO }] },
    readOnly: true, sources: [], sourceContext: null, faceContext: null, onChange: () => {}, placeholder: '', ariaLabel: 'bare',
    ...options.bare,
  }
  let setCall: (next: PromptCall) => void = () => {}
  let setLent: (next: WireState) => void = () => {}
  let setProject: (next: string) => void = () => {}
  await runtime.root.declare({}, ({ renderFactorySlot }: PropsRuntime<'root'> & PropsRenderFactories): ReactNode => {
    const [shown, update] = useState(call)
    const [state, lend] = useState<WireState>(lent)
    const [project, chooseProject] = useState('p1')
    setProject = chooseProject
    setCall = update
    setLent = lend
    return (
      <>
        <section data-testid="take">{renderFactorySlot('dv.prompt', props(shown, state, project))}</section>
        <section data-testid="bare">{renderFactorySlot('conversation.prompt', { model: bare })}</section>
      </>
    )
  })
  const view = runtime.renderRoot()
  const take = view.getByTestId('take')
  return {
    runtime, view, take, sent, answers, host, writes: scripted.writes, checks, requested,
    releaseState: () => { act(() => { heldStates.splice(0).forEach((release) => { release() }) }) },
    releaseModels: () => { act(() => { heldModels.splice(0).forEach((release) => { release() }) }) },
    setCall: (next: PromptCall) => { act(() => { setCall(next) }) },
    setProject: (next: string) => { act(() => { setProject(next) }) },
    /** Lend the next render's call from another record, as another take of an equal call does. */
    lendFrom: (id: string) => { draftId = id },
    /** Lend a new state object of the same project, as the host's next fetch does. */
    relend: () => { act(() => { setLent(structuredClone(lent)) }) },
  }
}

/** The chips of a prompt occurrence's content: one chip of the `dv-project` source per citation of the text. */
const chipsIn = (text: string): PromptHostModel['content']['chips'] => parsePromptCitations(text).map((citation) => {
  const cited = text.slice(citation.start, citation.end)
  return { source: 'dv-project', ref: cited, label: citation.label, offset: citation.start, length: cited.length, clipboardText: cited }
})

const box = (take: HTMLElement): HTMLElement => {
  const found = take.querySelector<HTMLElement>('[data-composer-input]')
  if (found === null) throw new Error('no editor box')
  return found
}

/** Press one key with Ctrl in the occurrence's editor, as the editor's keyboard commands read it. */
const press = (take: HTMLElement, key: string): void => {
  fireEvent.keyDown(box(take), { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ctrlKey: key.length === 1 })
}

/**
 * Select the whole prompt with Ctrl+A and cut it, as the editor's cut command does.
 * @returns the plain text that the cut puts on the clipboard.
 */
const cutAll = (take: HTMLElement): string => {
  press(take, 'a')
  const clipboard = new Map<string, string>()
  fireEvent.cut(box(take), { clipboardData: { setData: (type: string, text: string) => { clipboard.set(type, text) }, getData: () => '', items: [], types: [] } })
  return clipboard.get('text/plain') ?? ''
}

/** Paste plain text at the caret of the occurrence's editor. */
const pasteText = (take: HTMLElement, text: string): void => {
  fireEvent.paste(box(take), { clipboardData: { items: [], getData: (type: string) => type === 'text/plain' ? text : '' } })
}

const found = (root: HTMLElement, selector: string): Promise<HTMLElement> => waitFor(() => {
  const element = root.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`no ${selector}`)
  return element
})

const sendOf = (take: HTMLElement, name: string): Promise<HTMLButtonElement> => waitFor(() => {
  const button = within(take).getByRole<HTMLButtonElement>('button', { name })
  if (button.disabled) throw new Error('the call is not checked yet')
  return button
})

describe('dv.prompt on the real stack', () => {
  it('S4: shows the cited version with its image, inserts an @ pick, and sends the edited call', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs`, duration_sec: 5 }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, view, sent, writes } = await mount(stored)
    const chip = await waitFor(() => {
      const face = take.querySelector('[data-dv-chip="dv:test_ref/hero"]')
      expect(face?.querySelector('img')?.getAttribute('src')).toContain('ref.png')
      return face!
    })
    expect(chip.textContent).toBe('Herov1')
    expect(take.querySelector('[data-reference-tile="hero@1"]')?.getAttribute('data-cited')).toBe('true')
    fireEvent.change(within(take).getByTestId('dv-prompt-model'), { target: { value: 'fastvideo/fastt2v/t2v' } })
    fireEvent.change(within(take).getByTestId('dv-prompt-model'), { target: { value: 'fastvideo/fasth3/ref2v' } })
    fireEvent.change(take.querySelector('[data-param-chip="duration_sec"]')!, { target: { value: '2' } })
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
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]).toEqual({
      operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs with ${HERO} `, duration_sec: 2 }, inputs: [{ role: 'reference', ref: 'hero@1' }],
    })
    expect(writes.filter(write => write.path === '/api/dv/operation/check').at(-1)?.body).toMatchObject({ project: 'p1', params: { duration_sec: 2 } })
  })

  it('the round-trip law: an unedited send is the stored call, with its uncited input in its place', async () => {
    const stored: PromptCall = {
      operation: 'shot.render', params: { ...KEY, prompt: '@[Rain](dv:asset/shot1-last.png) falls on Hero', duration_sec: 3 },
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'shot1-last.png' }],
    }
    const { take, sent } = await mount(stored)
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@1"]')?.getAttribute('data-cited')).toBe('false') })
    fireEvent.click(await sendOf(take, 'Render new version'))
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
    fireEvent.keyDown(box(take), { key: 'z', code: 'KeyZ', ctrlKey: true })
    await waitFor(() => { expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"]')).not.toBeNull() })
    expect([...take.querySelectorAll('[data-reference-tile]')].map(tile => tile.getAttribute('data-reference-tile'))).toEqual(['hero@1', 'shot1-last.png'])
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })

  it('draws a chip of an occurrence with no call through the same face, at the element\'s newest version and with no sent version', async () => {
    const { view } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] })
    const bare = view.getByTestId('bare')
    await waitFor(() => { expect(bare.querySelector('[data-dv-chip="dv:test_ref/hero"] img')?.getAttribute('src')).toContain('ref.png') })
    expect(bare.querySelector('[data-dv-chip="dv:test_ref/hero"]')?.textContent).toBe('Hero')
  })
})

describe('references and the model catalog', () => {
  it('offers references for a model whose schema the catalog does not know, as no filter', async () => {
    const unknown: WireModelEntry = { ...MODELS[0]!, schema: null }
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] }, { models: [unknown] })
    await found(take, '[data-testid="dv-prompt-upload"]')
    expect(within(take).getByRole('button', { name: 'Add asset' })).toBeTruthy()
  })

  it('offers no references while the catalog loads, and offers them once it names a model that takes them', async () => {
    const { take, releaseModels } = await mount({ operation: 'shot.render', params: { ...KEY, task: 't2v', model: 'fastt2v', prompt: 'rain' }, inputs: [] }, { holdModels: true })
    await waitFor(() => { expect(box(take).textContent).toBe('rain') })
    await act(() => new Promise((resolve) => { setTimeout(resolve, 50) }))
    expect(within(take).queryByRole('button', { name: 'Add asset' })).toBeNull()
    releaseModels()
    await waitFor(() => { expect(within(take).getByTestId<HTMLSelectElement>('dv-prompt-model').value).toBe('fastvideo/fastt2v/t2v') })
    expect(within(take).queryByRole('button', { name: 'Add asset' })).toBeNull()
    fireEvent.change(within(take).getByTestId('dv-prompt-model'), { target: { value: 'fastvideo/fasth3/ref2v' } })
    await waitFor(() => { expect(within(take).getByRole('button', { name: 'Add asset' })).toBeTruthy() })
  })
})

describe('the model list failure', () => {
  const FAILED = '[data-testid="dv-composer-models-failed"]'

  it('says the model list failed to load, and offers Try again, which shows the model control once the read succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const modelsDown = { down: true }
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] }, { modelsDown })
    const alert = await found(take, FAILED)
    expect(alert.textContent).toContain("Couldn't load the model list")
    expect(within(take).queryByRole('button', { name: 'Add asset' })).toBeNull()
    modelsDown.down = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(take.querySelector(FAILED)).toBeNull() })
    await waitFor(() => { expect(within(take).getByRole('button', { name: 'Add asset' })).toBeTruthy() })
  })

  it('takes the alert down while Try again loads, and shows it again when the read fails again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] }, { modelsDown: { down: true } })
    const alert = await found(take, FAILED)
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(take.querySelector(FAILED)).toBeNull()
    expect((await found(take, FAILED)).textContent).toContain("Couldn't load the model list")
  })

  it('never shows it when the first load succeeds', async () => {
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] })
    await waitFor(() => { expect(within(take).getByRole('button', { name: 'Add asset' })).toBeTruthy() })
    expect(take.querySelector(FAILED)).toBeNull()
  })
})

describe('what the host lends', () => {
  it('draws the tray and the chips from the state that the host lends while the server holds its own state back', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take } = await mount(stored, {
      holdState: true,
      lend: (state) => {
        state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['shot2-last.png'], created_by: 'e1' })
      },
    })
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@1"]')?.textContent).toBe('Herov1Use v2×') })
    expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"] img')?.getAttribute('src')).toContain('ref.png')
    expect(box(take).getAttribute('contenteditable')).toBe('true')
  })

  it('draws no parameter chip and offers no reference for a call whose operation the host does not declare', async () => {
    const { take } = await mount({ operation: 'test_gone.generate', params: { ...KEY, prompt: `${HERO} rain`, seed: 3 }, inputs: [{ role: 'reference', ref: 'hero@1' }] })
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@1"]')?.textContent).toBe('Herov1×') })
    expect([take.querySelectorAll('[data-param-chip]').length, within(take).queryByRole('button', { name: 'Add asset' })]).toEqual([0, null])
  })

  it('shows the chips of an operation that the host lends and the server does not list', async () => {
    const { take } = await mount({ operation: STILL.name, params: { prompt: 'rain', seed: 3 }, inputs: [] }, { served: OPERATIONS })
    await waitFor(() => { expect(take.querySelector<HTMLInputElement>('[data-param-chip="seed"]')?.value).toBe('3') })
  })
})

describe('chips that the editor\'s clipboard carries', () => {
  it('pastes a cut chip back as a chip, and the call gets its input back', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, sent } = await mount(stored)
    await found(take, '[data-dv-chip="dv:test_ref/hero"] img')
    act(() => { box(take).focus() })
    const clipboard = cutAll(take)
    expect(clipboard).toBe(`${HERO} runs`)
    await waitFor(() => { expect(take.querySelectorAll('[data-reference-tile]')).toHaveLength(0) })
    pasteText(take, clipboard)
    await found(take, '[data-dv-chip="dv:test_ref/hero"] img')
    expect([box(take).textContent, take.querySelector('[data-reference-tile]')?.getAttribute('data-reference-tile')]).toEqual(['Herov1 runs', 'hero@1'])
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })
})

describe('R3′ in the real composer', () => {
  it('removes both inputs that satisfy a deleted chip when no other chip cites them, and one undo brings both back', async () => {
    const stored: PromptCall = {
      operation: 'shot.render', params: { ...KEY, prompt: '@[Lamp](dv:asset/ref.png) glows' },
      inputs: [{ role: 'reference', ref: 'ref.png' }, { role: 'reference', ref: 'hero@1' }],
    }
    const { take, sent } = await mount(stored)
    await found(take, '[data-dv-chip="dv:asset/ref.png"] img')
    act(() => { box(take).focus() })
    press(take, 'a')
    press(take, 'Backspace')
    await waitFor(() => { expect(take.querySelector('[data-reference-tile]')).toBeNull() })
    press(take, 'z')
    await waitFor(() => { expect(take.querySelectorAll('[data-reference-tile]')).toHaveLength(2) })
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })
})

describe('the undo memo', () => {
  it('removes the tile of a chip that Backspace deletes, and one Ctrl+Z brings back the chip and the tile in its place', async () => {
    const stored: PromptCall = {
      operation: 'shot.render', params: { ...KEY, prompt: `${HERO} holds the lamp from @[Take](dv:asset/shot1-last.png)` },
      inputs: [{ role: 'reference', ref: 'shot1-last.png' }, { role: 'reference', ref: 'hero@1' }],
    }
    const { take, sent } = await mount(stored)
    await found(take, '[data-dv-chip="dv:asset/shot1-last.png"] img')
    act(() => { box(take).focus() })
    press(take, 'Backspace')
    await waitFor(() => { expect(take.querySelector('[data-dv-chip="dv:asset/shot1-last.png"]')).toBeNull() })
    expect([...take.querySelectorAll('[data-reference-tile]')].map(tile => tile.getAttribute('data-reference-tile'))).toEqual(['hero@1'])
    press(take, 'z')
    await found(take, '[data-dv-chip="dv:asset/shot1-last.png"]')
    expect([...take.querySelectorAll('[data-reference-tile]')].map(tile => tile.getAttribute('data-reference-tile'))).toEqual(['shot1-last.png', 'hero@1'])
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })

  it('puts every input back in its stored place when one undo brings back the chips that one delete removed', async () => {
    const stored: PromptCall = {
      operation: 'shot.render', params: { ...KEY, prompt: `@[Rain](dv:asset/shot1-last.png) falls on ${HERO}` },
      inputs: [{ role: 'reference', ref: 'shot1-last.png' }, { role: 'reference', ref: 'hero@1' }],
    }
    const { take, sent } = await mount(stored)
    await found(take, '[data-dv-chip="dv:test_ref/hero"] img')
    act(() => { box(take).focus() })
    press(take, 'a')
    press(take, 'Backspace')
    await waitFor(() => { expect(take.querySelector('[data-reference-tile]')).toBeNull() })
    press(take, 'z')
    await waitFor(() => { expect(take.querySelectorAll('[data-reference-tile]')).toHaveLength(2) })
    expect([...take.querySelectorAll('[data-reference-tile]')].map(tile => tile.getAttribute('data-reference-tile'))).toEqual(['shot1-last.png', 'hero@1'])
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })

  it('adds the newest version for a fresh @ pick of an element whose chip the user deleted', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, view, sent } = await mount(stored, {
      edit: (state) => {
        state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['shot2-last.png'], created_by: 'e1' })
      },
    })
    await found(take, '[data-reference-tile="hero@1"]')
    act(() => { box(take).focus() })
    press(take, 'a')
    press(take, 'Backspace')
    await waitFor(() => { expect(take.querySelector('[data-reference-tile]')).toBeNull() })
    pasteText(take, 'rain @')
    const option = await waitFor(() => {
      const shown = view.container.querySelector('[role="option"]')
      expect(shown?.textContent).toContain('Hero')
      return shown!
    })
    fireEvent.mouseDown(option)
    await found(take, '[data-reference-tile="hero@2"]')
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent[0]?.inputs).toEqual([{ role: 'reference', ref: 'hero@2' }]) })
  })
})

describe('one draft per occurrence', () => {
  it('keeps an editor edit that the user makes while the picker is open when the pick arrives', async () => {
    const { take, host, sent } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] })
    await sendOf(take, 'Render new version')
    fireEvent.click(within(take).getByRole('button', { name: 'Add asset' }))
    const done = host.pickAssets?.mock.calls[0]?.[1]
    act(() => { box(take).focus() })
    fireEvent.paste(box(take), { clipboardData: { items: [], getData: () => ' falls' } })
    await waitFor(() => { expect(box(take).textContent).toBe('rain falls') })
    act(() => { done?.(['shot1-last.png']) })
    await found(take, '[data-reference-tile="shot1-last.png"]')
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => {
      expect(sent).toEqual([{ operation: 'shot.render', params: { ...KEY, prompt: 'rain falls' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }] }])
    })
  })

  it('takes no editor step for the removal of a tile that no chip cites, so one undo takes back the last edit', async () => {
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }] })
    await found(take, '[data-reference-tile="shot1-last.png"]')
    act(() => { box(take).focus() })
    fireEvent.paste(box(take), { clipboardData: { items: [], getData: () => ' falls' } })
    await waitFor(() => { expect(box(take).textContent).toBe('rain falls') })
    fireEvent.click(within(take).getByRole('button', { name: 'Remove shot1-last.png' }))
    await waitFor(() => { expect(take.querySelector('[data-reference-tile]')).toBeNull() })
    fireEvent.keyDown(box(take), { key: 'z', code: 'KeyZ', ctrlKey: true })
    await waitFor(() => { expect(box(take).textContent).toBe('rain') })
  })

  it('shows the words of a parameter bar that registers after the composer opens', async () => {
    const { take, runtime, checks } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { holdChecks: true })
    await waitFor(() => { expect(checks).toHaveLength(1) })
    expect(within(take).getByRole('button', { name: 'Generate a new version' })).toBeTruthy()
    act(() => { runtime.ctx.dvComposer.paramBars.register({ ...shotRenderBar, operation: STILL.name, owner: 'test', copy: { send: ['生成静帧', 'Make the still'] } }) })
    await waitFor(() => { expect(within(take).getByRole('button', { name: 'Make the still' })).toBeTruthy() })
  })
})

describe('the check of the edited call', () => {
  it('checks the call again when the host lends a new project state', async () => {
    const { take, checks, relend } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { holdChecks: true })
    await waitFor(() => { expect(checks).toHaveLength(1) })
    act(() => { checks[0]?.answer({ problems: ['The input g9#0 is not ready.'] }) })
    await waitFor(() => { expect(within(take).getByRole('alert').textContent).toBe('The input g9#0 is not ready.') })
    relend()
    await waitFor(() => { expect(checks).toHaveLength(2) })
    act(() => { checks[1]?.answer({ problems: [] }) })
    await sendOf(take, 'Generate a new version')
  })

  it('blocks the send of an edit until the check of that edit answers', async () => {
    const { take, checks } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { holdChecks: true })
    await waitFor(() => { expect(checks).toHaveLength(1) })
    act(() => { checks[0]?.answer({ problems: [] }) })
    await sendOf(take, 'Generate a new version')
    fireEvent.change(take.querySelector('[data-param-chip="seed"]')!, { target: { value: '5' } })
    expect(within(take).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled).toBe(true)
    await waitFor(() => { expect(checks).toHaveLength(2) })
    act(() => { checks[1]?.answer({ problems: [] }) })
    await sendOf(take, 'Generate a new version')
  })

  it('checks the call with the surface that the host names', async () => {
    const { writes } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { surface: 'timeline' })
    await waitFor(() => { expect(writes.find(write => write.path === '/api/dv/operation/check')?.body).toMatchObject({ surface: 'timeline' }) })
  })
})

describe('the failures of the host', () => {
  it('shows a refused send as the one alert, offers the send again, and drops the alert when the call changes', async () => {
    const { take } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { refuseSend: 'The GPU queue is full.' })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(within(take).getAllByRole('alert').map(alert => alert.textContent)).toEqual(['Failed: The GPU queue is full.']) })
    await sendOf(take, 'Generate a new version')
    fireEvent.change(take.querySelector('[data-param-chip="seed"]')!, { target: { value: '5' } })
    expect(within(take).queryByRole('alert')).toBeNull()
  })

  it('shows a refused import as the alert', async () => {
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] }, { refuseImport: 'The file is too large.' })
    fireEvent.change(await found(take, '[data-testid="dv-prompt-upload"]'), { target: { files: [new File(['a'], 'big.png', { type: 'image/png' })] } })
    await waitFor(() => { expect(within(take).getByRole('alert').textContent).toBe('Failed: The file is too large.') })
  })
})

describe('the unsent draft of a take', () => {
  const STILL_CALL: PromptCall = { operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }
  const seedOf = (take: HTMLElement): string => take.querySelector<HTMLInputElement>('[data-param-chip="seed"]')?.value ?? ''
  const editSeed = (take: HTMLElement, value: string): void => { fireEvent.change(take.querySelector('[data-param-chip="seed"]')!, { target: { value } }) }
  /** Close the editor and open it again on the same stack, as the canvas does for Escape and a click on empty canvas. */
  const reopen = (mounted: Awaited<ReturnType<typeof mount>>): HTMLElement => {
    mounted.view.unmount()
    return mounted.runtime.renderRoot().getByTestId('take')
  }

  it('restores the typed prompt and parameters when the same take opens again, and starts another take clean', async () => {
    const mounted = await mount(STILL_CALL)
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '5')
    act(() => { box(mounted.take).focus() })
    pasteText(mounted.take, ' on a desk')
    await waitFor(() => { expect(box(mounted.take).textContent).toBe('a lamp on a desk') })
    const again = reopen(mounted)
    await waitFor(() => { expect(box(again).textContent).toBe('a lamp on a desk') })
    expect(seedOf(again)).toBe('5')
    mounted.setCall({ operation: STILL.name, params: { prompt: 'a chair' }, inputs: [] })
    await waitFor(() => { expect(box(again).textContent).toBe('a chair') })
    expect(seedOf(again)).toBe('')
    mounted.setCall(STILL_CALL)
    await waitFor(() => { expect(seedOf(again)).toBe('5') })
  })

  it('keeps identical calls in different projects in separate editor drafts', async () => {
    const mounted = await mount(STILL_CALL)
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '5')
    mounted.setProject('p2')
    await waitFor(() => { expect(seedOf(mounted.take)).toBe('') })
    editSeed(mounted.take, '7')
    mounted.setProject('p1')
    await waitFor(() => { expect(seedOf(mounted.take)).toBe('5') })
    mounted.setProject('p2')
    await waitFor(() => { expect(seedOf(mounted.take)).toBe('7') })
  })

  it('keeps a separate draft for another take whose call is equal', async () => {
    const mounted = await mount(STILL_CALL)
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '5')
    mounted.lendFrom('r2')
    mounted.view.unmount()
    const other = mounted.runtime.renderRoot()
    expect(seedOf(other.getByTestId('take'))).toBe('')
    mounted.lendFrom('r1')
    other.unmount()
    expect(seedOf(mounted.runtime.renderRoot().getByTestId('take'))).toBe('5')
  })

  it('drops the draft once its send succeeds', async () => {
    const mounted = await mount(STILL_CALL)
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '5')
    fireEvent.click(await sendOf(mounted.take, 'Generate a new version'))
    await waitFor(() => { expect(mounted.sent).toHaveLength(1) })
    await waitFor(() => { expect(mounted.take.querySelector('button[disabled]')).toBeNull() })
    expect(seedOf(reopen(mounted))).toBe('')
  })

  it('drops the draft when the edits are undone back to the lent call', async () => {
    const mounted = await mount(STILL_CALL)
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '7')
    expect(readDraft(draftKey('p1', 'r1', JSON.stringify(STILL_CALL)))).toBeDefined()
    editSeed(mounted.take, '')
    expect(readDraft(draftKey('p1', 'r1', JSON.stringify(STILL_CALL)))).toBeUndefined()
    expect(seedOf(reopen(mounted))).toBe('')
  })

  it('drops the draft when a typed value is edited back to the lent call\'s value', async () => {
    const seeded: PromptCall = { operation: STILL.name, params: { seed: 5, prompt: 'a lamp' }, inputs: [] }
    const mounted = await mount(seeded)
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '6')
    expect(readDraft(draftKey('p1', 'r1', JSON.stringify(seeded)))).toBeDefined()
    editSeed(mounted.take, '5')
    expect(readDraft(draftKey('p1', 'r1', JSON.stringify(seeded)))).toBeUndefined()
  })

  it('restores a draft that was mid-send as an ordinary draft, never as sending, whose send waits for a new check', async () => {
    const mounted = await mount(STILL_CALL, { holdSend: true, holdChecks: true })
    await waitFor(() => { expect(mounted.checks).toHaveLength(1) })
    act(() => { mounted.checks[0]?.answer({ problems: [] }) })
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '5')
    await waitFor(() => { expect(mounted.checks).toHaveLength(2) })
    act(() => { mounted.checks[1]?.answer({ problems: [] }) })
    fireEvent.click(await sendOf(mounted.take, 'Generate a new version'))
    await waitFor(() => { expect(mounted.sent).toHaveLength(1) })
    const again = reopen(mounted)
    expect(seedOf(again)).toBe('5')
    expect(within(again).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled).toBe(true)
    await waitFor(() => { expect(mounted.checks).toHaveLength(3) })
    act(() => { mounted.checks[2]?.answer({ problems: [] }) })
    const button = await sendOf(again, 'Generate a new version')
    expect(button.disabled).toBe(false)
  })

  it('keeps the edits of a reopened editor when a send from the closed editor succeeds later', async () => {
    const mounted = await mount(STILL_CALL, { holdSend: true })
    await sendOf(mounted.take, 'Generate a new version')
    editSeed(mounted.take, '5')
    fireEvent.click(await sendOf(mounted.take, 'Generate a new version'))
    await waitFor(() => { expect(mounted.sent).toHaveLength(1) })
    mounted.view.unmount()
    const again = mounted.runtime.renderRoot()
    editSeed(again.getByTestId('take'), '7')
    await act(async () => { mounted.answers.splice(0).forEach((answer) => { answer() }) })
    again.unmount()
    expect(seedOf(mounted.runtime.renderRoot().getByTestId('take'))).toBe('7')
  })

  it('checks a restored draft again before its send, and shows no failure from before the editor closed', async () => {
    const mounted = await mount(STILL_CALL, { holdChecks: true, refuseSend: 'The GPU queue is full.' })
    await waitFor(() => { expect(mounted.checks).toHaveLength(1) })
    editSeed(mounted.take, '5')
    await waitFor(() => { expect(mounted.checks).toHaveLength(2) })
    act(() => { mounted.checks[1]?.answer({ problems: [] }) })
    fireEvent.click(await sendOf(mounted.take, 'Generate a new version'))
    await waitFor(() => { expect(within(mounted.take).getByRole('alert').textContent).toBe('Failed: The GPU queue is full.') })
    const again = reopen(mounted)
    expect(seedOf(again)).toBe('5')
    expect(within(again).queryByRole('alert')).toBeNull()
    expect(within(again).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled).toBe(true)
    await waitFor(() => { expect(mounted.checks).toHaveLength(3) })
    act(() => { mounted.checks[2]?.answer({ problems: [] }) })
    await sendOf(again, 'Generate a new version')
  })
})

describe('the version kinds of the canvas', () => {
  it('keeps the editor read-only until the composer knows the canvas\'s version kinds', async () => {
    const { take, runtime } = await mount({ operation: STILL.name, params: { prompt: 'rain' }, inputs: [] }, { lateCanvas: true })
    await waitFor(() => { expect(box(take).textContent).toBe('rain') })
    expect(box(take).getAttribute('contenteditable')).toBe('false')
    act(() => { runtime.ctx.provide('dvCanvas', createDvCanvas()) })
    await waitFor(() => { expect(box(take).getAttribute('contenteditable')).toBe('true') })
  })

  it('shows the call in read mode before the canvas\'s version kinds are known, with each citation as its label', async () => {
    const { take } = await mount({ operation: STILL.name, params: { prompt: `${HERO} rain` }, inputs: [] }, { lateCanvas: true, readOnly: true })
    await waitFor(() => { expect(box(take).textContent).toBe('Hero rain') })
    expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"]')?.getAttribute('data-invalid')).toBe('true')
  })
})

describe('the @ menu of an occurrence', () => {
  it('offers the assets and the items of a kind that a version kind reads, and no other item', async () => {
    const { take, view, runtime } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] })
    runtime.ctx.dvMentions.kinds.register({
      id: 'test_clip', kind: 'test_clip', order: 0, section: () => 'Clips', items: () => [{ uri: 'dv:test_clip/c1', label: 'Clip 1' }],
    })
    await sendOf(take, 'Render new version')
    act(() => { box(take).focus() })
    pasteText(take, ' @')
    await waitFor(() => { expect(view.container.querySelectorAll('[role="option"]').length).toBeGreaterThan(1) })
    const names = [...view.container.querySelectorAll('[role="option"]')].map(option => option.textContent).join('|')
    expect([names.includes('Hero'), names.includes('Clip 1')]).toEqual([true, false])
  })
})

describe('what the editor shows and takes', () => {
  it('shows the placeholder while the prompt is empty, and hides it once the user types', async () => {
    const { take } = await mount({ operation: STILL.name, params: { prompt: '' }, inputs: [] })
    const placeholder = await found(take, '[data-composer-placeholder]')
    expect(placeholder.textContent).toBe('Describe what to generate')
    act(() => { box(take).focus() })
    pasteText(take, 'rain')
    await waitFor(() => { expect(take.querySelector('[data-composer-placeholder]')).toBeNull() })
  })

  it('imports an image that the user pastes into the editor, and sends it as a reference', async () => {
    const { take, host, sent } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] })
    await sendOf(take, 'Render new version')
    const image = new File(['a'], 'ref.png', { type: 'image/png' })
    act(() => { box(take).focus() })
    fireEvent.paste(box(take), { clipboardData: { items: [{ kind: 'file', getAsFile: () => image }], getData: () => '' } })
    await found(take, '[data-reference-tile="ref.png"]')
    expect(host.importFiles?.mock.calls).toEqual([[[image]]])
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent[0]?.inputs).toEqual([{ role: 'reference', ref: 'ref.png' }]) })
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
    fireEvent.click(await sendOf(shot.take, 'Render new version'))
    expect(box(shot.take).getAttribute('data-placeholder')).toBe('Describe the shot; type @ to cite an item')
    await waitFor(() => { expect(within(shot.take).getByRole('button', { name: 'Rendering…' })).toBeTruthy() })
  })

  it('shows the error of a check that cannot reach the route as the problem, and blocks the send', async () => {
    const { take } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] })
    await sendOf(take, 'Generate a new version')
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    fireEvent.change(take.querySelector('[data-param-chip="seed"]')!, { target: { value: '7' } })
    await waitFor(() => { expect(within(take).getByRole('alert').textContent).toBe('offline') })
    expect(within(take).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled).toBe(true)
  })
})

describe('the modes of an occurrence', () => {
  it('shows the stored call in read mode: its tiles with nothing to remove or add, and no parameter bar, send, check or catalog', async () => {
    const { take, writes, requested } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: `${HERO} runs` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }, { readOnly: true })
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@1"]')?.textContent).toBe('Herov1') })
    expect([within(take).queryByRole('button', { name: 'Remove Hero' }), within(take).queryByRole('button', { name: 'Add asset' })]).toEqual([null, null])
    expect([within(take).queryByTestId('dv-prompt-model'), within(take).queryByRole('button', { name: 'Render new version' })]).toEqual([null, null])
    expect(box(take).getAttribute('contenteditable')).toBe('false')
    await act(() => new Promise((resolve) => { setTimeout(resolve, 300) }))
    expect([writes.filter(write => write.path === '/api/dv/operation/check'), requested.filter(path => path === '/api/dv/models')]).toEqual([[], []])
  })

  it('starts over on a call that the host lends in place of the shown one', async () => {
    const first: PromptCall = { operation: STILL.name, params: { prompt: `${HERO} rain` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, sent, setCall } = await mount(first)
    await waitFor(() => { expect(box(take).textContent).toBe('Herov1 rain') })
    const second: PromptCall = { ...first, params: { prompt: 'snow' }, inputs: [] }
    setCall(second)
    await waitFor(() => { expect(box(take).textContent).toBe('snow') })
    expect(take.querySelectorAll('[data-reference-tile]')).toHaveLength(0)
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent).toEqual([second]) })
  })

  it('starts the editor\'s history over on a call that the host lends, so an undo cannot bring back the shown call', async () => {
    const first: PromptCall = { operation: STILL.name, params: { prompt: `${HERO} rain` }, inputs: [{ role: 'reference', ref: 'hero@1' }] }
    const { take, sent, setCall } = await mount(first)
    await waitFor(() => { expect(box(take).textContent).toBe('Herov1 rain') })
    const second: PromptCall = { ...first, params: { prompt: 'snow' }, inputs: [] }
    setCall(second)
    await waitFor(() => { expect(box(take).textContent).toBe('snow') })
    fireEvent.keyDown(box(take), { key: 'z', code: 'KeyZ', ctrlKey: true })
    await act(() => new Promise((resolve) => { setTimeout(resolve, 50) }))
    expect([box(take).textContent, take.querySelectorAll('[data-reference-tile]').length]).toEqual(['snow', 0])
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent).toEqual([second]) })
  })

  it('offers no add and no upload to an occurrence whose host lends neither, and keeps its prompt editable', async () => {
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] }, { noPicker: true })
    await sendOf(take, 'Render new version')
    expect([within(take).queryByRole('button', { name: 'Add asset' }), within(take).queryByTestId('dv-prompt-upload')]).toEqual([null, null])
    expect(box(take).getAttribute('contenteditable')).toBe('true')
  })

  it('imports uploaded files through the host and sends each as a reference in file order; a change without files imports nothing', async () => {
    const { take, host, sent } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs: [] })
    const upload = await found(take, '[data-testid="dv-prompt-upload"]')
    fireEvent.change(upload, { target: { files: null } })
    expect(host.importFiles).not.toHaveBeenCalled()
    fireEvent.change(upload, { target: { files: [new File(['a'], 'ref.png', { type: 'image/png' }), new File(['b'], 'shot1-last.png', { type: 'image/png' })] } })
    await found(take, '[data-reference-tile="shot1-last.png"]')
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent[0]?.inputs).toEqual([{ role: 'reference', ref: 'ref.png' }, { role: 'reference', ref: 'shot1-last.png' }]) })
  })

  it('dims each reference tile past the selected model\'s count of references', async () => {
    const inputs = ['ref.png', 'shot1-last.png', 'export-last.png'].map(ref => ({ role: 'reference', ref }))
    const { take } = await mount({ operation: 'shot.render', params: { ...KEY, prompt: 'rain' }, inputs })
    const last = await found(take, '[data-reference-tile="export-last.png"]')
    await waitFor(() => { expect(last.style.opacity).toBe('0.5') })
    expect(take.querySelector<HTMLElement>('[data-reference-tile="shot1-last.png"]')?.style.opacity).toBe('1')
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
    fireEvent.change(seed(), { target: { value: '2' } })
    await waitFor(() => { expect(checks).toHaveLength(2) })
    fireEvent.change(seed(), { target: { value: '3' } })
    await waitFor(() => { expect(checks).toHaveLength(3) })
    act(() => {
      checks[0]?.answer({ problems: [] })
      checks[1]?.fail(new Error('offline'))
    })
    await act(() => new Promise((resolve) => { setTimeout(resolve, 20) }))
    expect([within(take).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled, within(take).queryByRole('alert')]).toEqual([true, null])
    act(() => { checks[2]?.answer({ problems: [] }) })
    await sendOf(take, 'Generate a new version')
  })

  it('sends on Enter once the check has answered, and not again while the send runs', async () => {
    const { take, sent, checks, answers } = await mount({ operation: STILL.name, params: { prompt: 'a lamp' }, inputs: [] }, { holdChecks: true, holdSend: true })
    await waitFor(() => { expect(checks).toHaveLength(1) })
    fireEvent.keyDown(box(take), { key: 'Enter', code: 'Enter' })
    expect(sent).toEqual([])
    act(() => { checks[0]?.answer({ problems: [] }) })
    await sendOf(take, 'Generate a new version')
    fireEvent.keyDown(box(take), { key: 'Enter', code: 'Enter' })
    await waitFor(() => { expect(sent).toHaveLength(1) })
    fireEvent.keyDown(box(take), { key: 'Enter', code: 'Enter' })
    expect(sent).toHaveLength(1)
    act(() => { answers.splice(0).forEach((answer) => { answer() }) })
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
    expect([host.openNode.mock.calls, host.preview.mock.calls]).toEqual([[['e1']], [['shot1-last.png', null]]])
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
    await waitFor(() => { expect(take.querySelector('[data-reference-tile="hero@2"]')?.textContent).toBe('Herov2×') })
    await waitFor(() => { expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"]')?.textContent).toBe('Herov2') })
    expect(take.querySelector('[data-dv-chip="dv:test_ref/hero"] img')?.getAttribute('src')).toContain('shot2-last.png')
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([{ ...stored, inputs: [{ role: 'reference', ref: 'hero@2' }] }]) })
  })
})

describe('the chips of the parameter bar', () => {
  it('shows the text of a free-text chip that its param cannot take as a problem, and blocks the send until it can', async () => {
    const { take, sent } = await mount({ operation: STILL.name, params: { prompt: 'rain', seed: 3 }, inputs: [] })
    await sendOf(take, 'Generate a new version')
    const seed = take.querySelector<HTMLInputElement>('[data-param-chip="seed"]')!
    fireEvent.change(seed, { target: { value: '12a' } })
    await waitFor(() => { expect(within(take).getByRole('alert').textContent).toBe('seed must be a number.') })
    expect([seed.value, within(take).getByRole<HTMLButtonElement>('button', { name: 'Generate a new version' }).disabled]).toEqual(['12a', true])
    fireEvent.change(seed, { target: { value: '12' } })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent).toEqual([{ operation: STILL.name, params: { prompt: 'rain', seed: 12 }, inputs: [] }]) })
  })

  it('draws a chip for every declared param that the bar does not give: the seed, a boolean as a checkbox, and extra as JSON', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: 'rain', extra: { camera: 'slow' } }, inputs: [] }
    const { take, sent } = await mount(stored)
    const seed = await found(take, 'input[data-param-chip="seed"]')
    expect([seed.closest('label')?.textContent, seed.getAttribute('placeholder')]).toEqual(['Seed', 'random'])
    expect(take.querySelector<HTMLInputElement>('[data-param-chip="extra"]')?.value).toBe('{"camera":"slow"}')
    const loop = take.querySelector<HTMLInputElement>('input[type="checkbox"][data-param-chip="loop"]')!
    fireEvent.click(loop)
    fireEvent.change(take.querySelector('[data-param-chip="extra"]')!, { target: { value: '{"camera":"fast"}' } })
    fireEvent.change(seed, { target: { value: '4' } })
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent[0]?.params).toEqual({ ...KEY, prompt: 'rain', extra: { camera: 'fast' }, loop: true, seed: 4 }) })
  })

  it('keeps the params when the stored model, which the catalog lacks, stays picked, and shows only the declared chips for it', async () => {
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, model: 'gone', prompt: 'rain' }, inputs: [] }
    const { take, sent } = await mount(stored)
    const model = await waitFor(() => within(take).getByTestId<HTMLSelectElement>('dv-prompt-model'))
    expect(model.value).toBe('')
    fireEvent.change(model, { target: { value: '' } })
    expect([...take.querySelectorAll('[data-param-chip]')].map(chip => chip.getAttribute('data-param-chip'))).toEqual(['seed', 'aspect', 'loop', 'extra'])
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([stored]) })
  })

  it('types a free-text chip by its declaration: a number, and nothing for an emptied field', async () => {
    const { take, sent } = await mount({ operation: STILL.name, params: { prompt: 'rain', seed: 3 }, inputs: [] })
    const seed = (): HTMLInputElement => take.querySelector('[data-param-chip="seed"]')!
    await waitFor(() => { expect(seed().value).toBe('3') })
    fireEvent.change(seed(), { target: { value: '9' } })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent.at(-1)?.params).toEqual({ prompt: 'rain', seed: 9 }) })
    fireEvent.change(seed(), { target: { value: '' } })
    fireEvent.click(await sendOf(take, 'Generate a new version'))
    await waitFor(() => { expect(sent.at(-1)?.params).toEqual({ prompt: 'rain' }) })
  })

  it('sends the text of a bar chip of a param that the operation does not declare as it is, and changes nothing for the current value outside its choices', async () => {
    const bare: WireModelEntry = { ...MODELS[0]!, schema: { duration_sec: { min: 1, max: 5 }, aspect_ratios: ['16:9'], inputs: {} } }
    const stored: PromptCall = { operation: 'shot.render', params: { ...KEY, prompt: 'rain', duration_sec: 9 }, inputs: [] }
    const { take, sent } = await mount(stored, { models: [bare] })
    fireEvent.change(await found(take, 'input[data-param-chip="resolution"]'), { target: { value: '4k' } })
    fireEvent.change(take.querySelector('[data-param-chip="duration_sec"]')!, { target: { value: '9' } })
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent).toEqual([{ ...stored, params: { ...stored.params, resolution: '4k' } }]) })
    fireEvent.change(take.querySelector('[data-param-chip="resolution"]')!, { target: { value: '' } })
    fireEvent.click(await sendOf(take, 'Render new version'))
    await waitFor(() => { expect(sent.at(-1)).toEqual(stored) })
  })
})

describe('the chip face', () => {
  it('draws a chip of an occurrence from the face that the occurrence resolved, and skips a face of another shape', async () => {
    const rain = '@[Rain](dv:asset/shot1-last.png)'
    const lamp = '@[Lamp](dv:asset/lamp.png)'
    const text = `${HERO} ${rain} ${lamp}`
    const { view } = await mount({ operation: STILL.name, params: { prompt: 'rain' }, inputs: [] }, {
      bare: {
        content: { revision: 0, history: 'reset', text, chips: chipsIn(text) },
        faceContext: {
          faces: {
            'dv:test_ref/hero': { preview: { id: 'ref.png', mime: 'image/png', name: 'ref.png' }, sent: 1, satisfied: true },
            'dv:asset/shot1-last.png': { preview: { id: 'shot1-last.png' }, sent: null, satisfied: false },
            'dv:asset/lamp.png': { preview: null, sent: 'v1', satisfied: true },
            'dv:asset/other.png': 7,
          },
        },
      },
    })
    const bare = view.getByTestId('bare')
    await waitFor(() => { expect(bare.querySelector('[data-dv-chip="dv:test_ref/hero"] img')?.getAttribute('src')).toContain('ref.png') })
    expect([...bare.querySelectorAll('[data-dv-chip]')].map(face => [face.textContent, face.getAttribute('data-invalid')]))
      .toEqual([['Herov1', null], ['Rain', 'true'], ['Lamp', null]])
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
          revision: 0, history: 'reset', text: `${HERO} ${plain}`,
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
