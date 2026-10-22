// @vitest-environment jsdom
/**
 * The plan editor, the `dv.canvas.editor` entry of the plan node type, under the real slot runtime: its versions and
 * approval status, its shots and their reference assets, drawn through `dv.media` by the asset pool's media views, and
 * its registration and removal with the plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PlanId } from '@dv/shot-plan/types'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { ChainAnchor, DvCanvas, NodeType, EntryEditorHost, TakesInUse, VersionKind } from '@dv/ui-kit/registries.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { asset, fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { AudioView, ImageView, VideoView } from '../../ui-asset-pool/src/client/media.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { apply, planNodeType, planReferencesInUse } from '../src/client/index.ts'
import { shotReferences } from '../src/client/PlanEditor.tsx'

/** The chain anchor of the fixture's approval `a1`: it approved v1 of p1. */
const APPROVAL: ChainAnchor = {
  starter: 'plan.approve', anchor: record => `plan:${String(record.params['plan'])}`,
  approvedVersions: (_state, anchorId) => anchorId === 'plan:p1' ? [1] : [],
}

/** The character `hero` at version 1 (name Hero, reference ref.png) as a version kind, as the character UI half registers it. */
const CHARACTERS: VersionKind = {
  kind: 'character',
  label: () => '角色',
  node: id => `character:${id}`,
  latest: () => [],
  name: (_state, id, version) => id === 'hero' && version === 1 ? 'Hero' : null,
  assets: (_state, id, version) => id === 'hero' && version === 1 ? ['ref.png'] : [],
}

/** The canvas's writes, picker and preview, which the plan editor does not call. */
const HOST: EntryEditorHost = { run: vi.fn(), pickAssets: vi.fn(), preview: vi.fn() }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.lang = ''
})

/** The asset pool's media views, registered under `dv.media.view` by MIME top-level type as the asset pool plugin does. */
const mediaViews: Plugin = {
  inject: ['slots'],
  apply(ctx: Context) {
    for (const [key, view] of Object.entries({ image: ImageView, video: VideoView, audio: AudioView })) {
      ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key }, view)), `test: ${key} view`)
    }
  },
}

/** @returns empty canvas registries keyed as `DvCanvas` documents. */
function canvasRegistries(): DvCanvas {
  return {
    nodeTypes: createRegistry<NodeType>(kind => [kind.id]),
    chainAnchors: createRegistry<ChainAnchor>(anchor => [anchor.starter]),
    takesInUse: createRegistry<TakesInUse>(uses => [uses.id]),
    versionKinds: createRegistry<VersionKind>(kind => [kind.kind]),
  }
}

/**
 * Mount the `@dv/ui-media` plugin, the media views and the plan plugin under a root frame that declares
 * `dv.canvas.editor` and renders the entry of the plan node type for a plan entry, as the canvas does in an entry's
 * editor, in the Chinese interface.
 * @param state - the project state.
 * @param canvas - the `dvCanvas` registries the plugin reads.
 * @param entry - the edited node; by default the first plan entry of `state`.
 * @returns the runtime, the plugin fiber, and the frame.
 */
async function mount(state: WireState, canvas: DvCanvas, entry = planNodeType.entries(state)[0]) {
  document.documentElement.lang = 'zh-CN'
  vi.stubGlobal('fetch', scriptedFetch({ state }).fetch)
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('dvCanvas', canvas)
  if (entry === undefined) throw new Error('the state has no plan')
  const Frame = ({ renderSlot }: PropsRenderSlots<'dv.canvas.editor'>): ReactNode =>
    <section data-testid="editor">{renderSlot('dv.canvas.editor', { node: entry, state, host: HOST }, { entryKey: planNodeType.id })}</section>
  await runtime.root.declare({ 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } }, Frame)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount(mediaViews)
  const plugin = await runtime.mount({ apply })
  const { container } = runtime.renderRoot()
  const editor = within(container).getByTestId('editor')
  await waitFor(() => { expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(1) })
  return { runtime, plugin, editor }
}

/**
 * @param editor - the editor frame.
 * @param versions - the versions to choose, one after another.
 * @returns the approval status of each chosen version.
 */
function statuses(editor: HTMLElement, versions: readonly number[]): string[] {
  return versions.map((version) => {
    fireEvent.click(within(editor).getByRole('button', { name: `第 ${String(version)} 版` }))
    return within(editor).getByTestId('dv-canvas-plan-status').textContent ?? ''
  })
}

describe('PlanEditor', () => {
  it('marks a version replaced before approval as 已被第 {n} 版取代, shows the version\'s title and each shot\'s reference images', async () => {
    const canvas = canvasRegistries()
    canvas.chainAnchors.register(APPROVAL)
    canvas.versionKinds.register(CHARACTERS)
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    if (v1 === undefined) throw new Error('fixture lacks plan p1')
    const v3 = {
      ...v1, version: 3, title: '雨夜', references: ['hero@1'],
      shots: [{ prompt: '<Picture 1> walks in the rain', modality: 'video' as const, task: 'ref2v' as const, provider: 'fastvideo', model: 'fasth3' }, { prompt: 'the sky clears', modality: 'video' as const, task: 't2v' as const, provider: 'fastvideo', model: 'fasth3' }],
    }
    state.components.plan.plans['p1' as PlanId] = [v1, { ...v1, version: 2 }, v3]
    const { runtime, editor } = await mount(state, canvas)
    expect(within(editor).getByRole('group', { name: '分镜计划版次' })).toBeTruthy()
    expect(statuses(editor, [1, 2, 3])).toEqual(['已批准', '已被第 3 版取代', '待批准'])
    // The version row shows v3's title; v1 has none.
    expect(within(editor).getByText('雨夜')).toBeTruthy()
    statuses(editor, [1])
    expect(within(editor).queryByText('雨夜')).toBeNull()
    statuses(editor, [3])
    // v3's shot renders from Hero's reference image: a "Picture 1 · Hero" chip, and the image in place of <Picture 1> and its brackets.
    const shot = editor.querySelector('li[data-shot="1"]')
    expect([...shot?.querySelectorAll('img') ?? []].map(image => [image.getAttribute('alt'), image.getAttribute('src')?.includes('ref.png')]))
      .toEqual([['', true], ['<Picture 1>', true]])
    expect(shot?.textContent).toContain('Picture 1 · Hero')
    expect(shot?.querySelector('p')?.textContent).toBe(' walks in the rain')
    expect(shot?.textContent).toContain('无 · 不接上一镜头')
    // A text shot shows its model and task by the catalog's task label, and no reference images.
    const textShot = editor.querySelector('li[data-shot="2"]')
    expect(textShot?.querySelectorAll('img')).toHaveLength(0)
    await waitFor(() => { expect(textShot?.querySelector('[data-testid="dv-canvas-shot-mode"]')?.textContent).toBe('fasth3 · 文字生成') })
    expect(textShot?.textContent).toContain('无（文字生成不用参考图）')
    await runtime.dispose()
  })

  it('reads approval status from the union of the chain anchors\' approved versions until an anchor\'s disposal', async () => {
    const canvas = canvasRegistries()
    const disposePlanAnchor = canvas.chainAnchors.register(APPROVAL)
    // A second anchor approves v2 of p1 from its own slice; the first approves only v1.
    const disposeTestAnchor = canvas.chainAnchors.register({
      starter: 'test.approve', anchor: () => 'plan:p1', approvedVersions: (_state, anchorId) => anchorId === 'plan:p1' ? [2] : [],
    })
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    if (v1 === undefined) throw new Error('fixture lacks plan p1')
    state.components.plan.plans['p1' as PlanId] = [v1, { ...v1, version: 2 }, { ...v1, version: 3 }]
    const { runtime, editor } = await mount(state, canvas)
    expect(statuses(editor, [1, 2, 3])).toEqual(['已批准', '已批准', '待批准'])
    act(() => { disposeTestAnchor() })
    expect(statuses(editor, [1, 2, 3])).toEqual(['已批准', '已被第 3 版取代', '待批准'])
    // With no anchor left, no version is approved.
    act(() => { disposePlanAnchor() })
    expect(statuses(editor, [1, 2, 3])).toEqual(['已被第 2 版取代', '已被第 3 版取代', '待批准'])
    await runtime.dispose()
  })

  it('shows reference assets of every media type, numbers only the images as Picture N, and names a version by its version kind', async () => {
    const canvas = canvasRegistries()
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    if (v1 === undefined) throw new Error('fixture lacks plan p1')
    state.assets.push(asset('score.wav', 'audio/wav', null))
    state.components.plan.plans['p1' as PlanId] = [{
      ...v1, references: ['shot1.mp4', 'hero@1'],
      shots: [{ prompt: '<Video 1> then <Picture 1>', modality: 'video' as const, task: 'ref2v' as const, provider: 'fastvideo', model: 'fasth3', references: ['shot1.mp4', 'hero@1', 'score.wav'] }],
    }]
    const { runtime, editor } = await mount(state, canvas)
    // Without a version kind, hero@1 stands for no asset.
    const header = within(editor).getByText('计划参考')
    expect(header.textContent).toBe('计划参考shot1.mp4')
    act(() => { canvas.versionKinds.register(CHARACTERS) })
    // The plan header lists the video by name and the image of hero@1 as Picture 1.
    await waitFor(() => { expect(header.textContent).toBe('计划参考shot1.mp4Picture 1 · Hero') })
    expect(header.querySelector('video')).not.toBeNull()
    // The shot lists the video, the image, and the audio in input order, each drawn by its media view as a thumbnail;
    // <Picture 1> draws Hero's image.
    const shot = editor.querySelector('li[data-shot="1"]')
    const chips = [...shot?.querySelector('dd > span')?.children ?? []]
    expect(chips.map(chip => [chip.textContent, chip.querySelector('img, video')?.getAttribute('src') ?? null])).toEqual([
      ['shot1.mp4', `${assetUrl('shot1.mp4')}#t=0.1`], ['Picture 1 · Hero', assetUrl('ref.png')], ['♪score.wav', null],
    ])
    expect(within(chips[2] as HTMLElement).getByLabelText('score.wav').textContent).toBe('♪')
    expect(shot?.querySelector('p')?.textContent).toBe('<Video 1> then ')
    expect(shot?.querySelector('p img')?.getAttribute('src')).toBe(assetUrl('ref.png'))
    await runtime.dispose()
  })

  it('shows the total duration and the aspect ratio in the version row, and each shot\'s duration on its card', async () => {
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    if (v1 === undefined) throw new Error('fixture lacks plan p1')
    state.components.plan.plans['p1' as PlanId] = [{ ...v1, aspect_ratio: '16:9', shots: v1.shots.map((shot, index) => ({ ...shot, duration_sec: index + 1 })) }]
    const { runtime, editor } = await mount(state, canvasRegistries())
    expect(within(editor).getByText('2 个镜头 · 0:03 · 16:9')).toBeTruthy()
    expect(editor.querySelector('li[data-shot="1"]')?.textContent).toContain('1 秒')
    expect(editor.querySelector('li[data-shot="2"]')?.textContent).toContain('2 秒')
    await runtime.dispose()
  })

  it('collapses only a prompt taller than 140 px under a fade, with a toggle that shows all of it and collapses it again', async () => {
    // jsdom lays out nothing; a prompt box reports a height of 10 px per prompt character.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return (this.textContent ?? '').length * 10 })
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    const [shot] = v1?.shots ?? []
    if (v1 === undefined || shot === undefined) throw new Error('fixture lacks plan p1')
    state.components.plan.plans['p1' as PlanId] = [{ ...v1, shots: [{ ...shot, prompt: 'hero walks through the rain' }, { ...shot, prompt: 'hero turns' }] }]
    const { runtime, editor } = await mount(state, canvasRegistries())
    const [longBox, shortBox] = [1, 2].map(number => editor.querySelector<HTMLElement>(`li[data-shot="${String(number)}"] dd:last-of-type > div`))
    expect(shortBox?.children).toHaveLength(1)
    expect(within(editor).getAllByRole('button', { name: '展开全部提示词' })).toHaveLength(1)
    const toggle = within(editor).getByRole('button', { name: '展开全部提示词' })
    expect([toggle.getAttribute('aria-expanded'), longBox?.style.maxHeight, longBox?.children.length]).toEqual(['false', '140px', 2])
    fireEvent.click(toggle)
    expect([toggle.textContent, toggle.getAttribute('aria-expanded'), longBox?.style.maxHeight, longBox?.children.length]).toEqual(['收起提示词', 'true', 'none', 1])
    fireEvent.click(toggle)
    expect([toggle.textContent, toggle.getAttribute('aria-expanded'), longBox?.style.maxHeight, longBox?.children.length]).toEqual(['展开全部提示词', 'false', '140px', 2])
    await runtime.dispose()
  })

  it('names a version written in a form that parseInputRef accepts, such as hero@1.0, by its version kind', async () => {
    const canvas = canvasRegistries()
    canvas.versionKinds.register(CHARACTERS)
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    if (v1 === undefined) throw new Error('fixture lacks plan p1')
    state.components.plan.plans['p1' as PlanId] = [{ ...v1, references: ['hero@1.0'] }]
    const { runtime, editor } = await mount(state, canvas)
    await waitFor(() => { expect(within(editor).getByText('计划参考').textContent).toBe('计划参考Picture 1 · Hero') })
    await runtime.dispose()
  })

  it('measures a shot prompt again when the chosen version shows a different prompt in the same shot', async () => {
    // jsdom lays out nothing; a prompt box reports a height of 10 px per prompt character.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return (this.textContent ?? '').length * 10 })
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    const [shot] = v1?.shots ?? []
    if (v1 === undefined || shot === undefined) throw new Error('fixture lacks plan p1')
    state.components.plan.plans['p1' as PlanId] = [
      { ...v1, shots: [{ ...shot, prompt: 'hero walks through the rain' }] },
      { ...v1, version: 2, shots: [{ ...shot, prompt: 'hero turns' }] },
    ]
    const { runtime, editor } = await mount(state, canvasRegistries())
    const toggles = (): HTMLElement[] => within(editor).queryAllByRole('button', { name: '展开全部提示词' })
    expect(toggles()).toHaveLength(0)
    fireEvent.click(within(editor).getByRole('button', { name: '第 1 版' }))
    expect(toggles()).toHaveLength(1)
    fireEvent.click(within(editor).getByRole('button', { name: '第 2 版' }))
    expect(toggles()).toHaveLength(0)
    await runtime.dispose()
  })

  it('measures a shot prompt again when a reference starts to resolve and its Picture N token turns into an image', async () => {
    // jsdom lays out nothing; a prompt box reports a height of 10 px per prompt character, and an image adds none.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return (this.textContent ?? '').length * 10 })
    const canvas = canvasRegistries()
    const state = fixtureState()
    const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
    if (v1 === undefined) throw new Error('fixture lacks plan p1')
    state.components.plan.plans['p1' as PlanId] = [{
      ...v1, references: ['hero@1'],
      shots: [{ prompt: '<Picture 1> walks', modality: 'video' as const, task: 'ref2v' as const, provider: 'fastvideo', model: 'fasth3' }],
    }]
    const { runtime, editor } = await mount(state, canvas)
    const toggles = (): HTMLElement[] => within(editor).queryAllByRole('button', { name: '展开全部提示词' })
    // Without a version kind, hero@1 resolves to nothing, and the 17-character token text overflows.
    expect(toggles()).toHaveLength(1)
    act(() => { canvas.versionKinds.register(CHARACTERS) })
    // After the registration, Hero's image stands for <Picture 1>; the remaining 6 characters fit.
    await waitFor(() => { expect(toggles()).toHaveLength(0) })
    await runtime.dispose()
  })

  it('shows nothing for an entry whose plan the state does not hold', async () => {
    const state = fixtureState()
    const [entry] = planNodeType.entries(state)
    if (entry === undefined) throw new Error('fixture lacks plan p1')
    const { runtime, editor } = await mount(state, canvasRegistries(), { ...entry, id: 'plan:p9' })
    // The registered editor entry renders inside its slot element and leaves it empty.
    expect(editor.querySelector('[data-slot="dv.canvas.editor"]')?.childElementCount).toBe(0)
    await runtime.dispose()
  })

  it('registers under the node type\'s id once dvCanvas and the slot are present, and the plugin disposal removes it', async () => {
    const canvas = canvasRegistries()
    const { runtime, plugin, editor } = await mount(fixtureState(), canvas)
    expect(runtime.slots.entries('dv.canvas.editor').map(entry => entry.options.key)).toEqual([planNodeType.id])
    expect(within(editor).getByTestId('dv-canvas-plan-status').textContent).toBe('待批准')
    expect(canvas.takesInUse.list()).toEqual([planReferencesInUse])
    await plugin.dispose()
    expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(0)
    await waitFor(() => { expect(within(editor).queryByTestId('dv-canvas-plan-status')).toBeNull() })
    expect(canvas.nodeTypes.list()).toEqual([])
    await runtime.dispose()
  })
})

describe('shotReferences', () => {
  it('uses the shot\'s own references, else the plan version\'s; a shot in task t2v has none', () => {
    expect(shotReferences({ references: ['hero@1'] }, { task: 'ref2v', references: ['a.png'] })).toEqual(['a.png'])
    expect(shotReferences({ references: ['hero@1'] }, { task: 'ref2v' })).toEqual(['hero@1'])
    expect(shotReferences({ references: ['hero@1'] }, { task: 'ref2v', references: [] })).toEqual([])
    expect(shotReferences({}, { task: 'ref2v' })).toEqual([])
    expect(shotReferences({ references: ['hero@1'] }, { task: 't2v' })).toEqual([])
  })
})
