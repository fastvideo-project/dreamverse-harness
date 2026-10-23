// @vitest-environment jsdom
/**
 * The plan editor, the `dv.canvas.editor` entry keyed `plan`, under the slot test runtime with the media plugins
 * mounted: its versions and approval status, its shots and their reference assets drawn through `dv.media`, and its
 * task labels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { PlanId } from '@dv/shot-plan/types'
import type { ChainAnchor } from '@dv/ui-canvas/contract'
import { createDvCanvas } from '@dv/ui-canvas/src/client/dv-canvas.ts'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { asset, fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { shotReferences } from '../src/client/PlanEditor.tsx'
import { mountPlanCanvas } from './plan-canvas.client.tsx'

/** The chain anchor of the fixture's approval `a1`: it approved v1 of p1. */
const APPROVAL: ChainAnchor = {
  starter: 'plan.approve', anchor: record => `plan:${String(record.params['plan'])}`,
  approvedVersions: (_state, anchorId) => anchorId === 'plan:p1' ? [1] : [],
}

const SECOND_APPROVAL: ChainAnchor = {
  starter: 'test.approve', anchor: () => 'plan:p1', approvedVersions: (_state, anchorId) => anchorId === 'plan:p1' ? [2] : [],
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.lang = ''
})

/**
 * @param state - the fixture state.
 * @returns version 1 of plan p1 and its first shot.
 */
function firstVersion(state: FixtureState) {
  const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
  const shot = v1?.shots[0]
  if (v1 === undefined || shot === undefined) throw new Error('fixture lacks plan p1')
  return { v1, shot }
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

function drawnMedia(element: Element | null | undefined): string[] {
  return [...element?.querySelectorAll('img, video, [data-dv-media="file"], span[aria-hidden="true"]') ?? []].map((media) => {
    if (media instanceof HTMLImageElement || media instanceof HTMLVideoElement) return `${media.tagName.toLowerCase()} ${media.getAttribute('src') ?? ''}`
    if (media.getAttribute('data-dv-media') === 'file') return `file ${media.textContent ?? ''}`
    return `audio ${media.textContent ?? ''}`
  })
}

/** Make a prompt box report a height of 10 px per prompt character, because jsdom lays out nothing; an image adds none. */
function measureByCharacters(): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return (this.textContent ?? '').length * 10 })
}

describe('PlanEditor', () => {
  it('marks a version replaced before approval as 已被第 {n} 版取代, shows the version\'s title and each shot\'s reference images', async () => {
    document.documentElement.lang = 'zh-CN'
    const canvas = createDvCanvas()
    canvas.chainAnchors.register(APPROVAL)
    canvas.versionKinds.register(CHARACTERS)
    const state = fixtureState()
    const { v1 } = firstVersion(state)
    const v3 = {
      ...v1, version: 3, title: '雨夜', references: ['hero@1'],
      shots: [{ prompt: '<Picture 1> walks in the rain', modality: 'video' as const, task: 'ref2v' as const, provider: 'fastvideo', model: 'fasth3' }, { prompt: 'the sky clears', modality: 'video' as const, task: 't2v' as const, provider: 'fastvideo', model: 'fasth3' }],
    }
    state.components.plan.plans['p1' as PlanId] = [v1, { ...v1, version: 2 }, v3]
    const { runtime, editor } = await mountPlanCanvas(state, { canvas })
    expect(within(editor).getByRole('group', { name: '分镜计划版次' })).toBeTruthy()
    expect(statuses(editor, [1, 2, 3])).toEqual(['已批准', '已被第 3 版取代', '待批准'])
    expect(within(editor).getByText('雨夜')).toBeTruthy()
    statuses(editor, [1])
    expect(within(editor).queryByText('雨夜')).toBeNull()
    statuses(editor, [3])
    // v3's shot renders from Hero's reference image: a "Picture 1 · Hero" chip, and the image in place of <Picture 1> and its brackets.
    const shot = editor.querySelector('li[data-shot="1"]')
    expect(drawnMedia(shot?.querySelector('dd'))).toEqual([`img ${assetUrl('ref.png')}`])
    expect([...shot?.querySelectorAll('p img') ?? []].map(image => [image.getAttribute('alt'), image.getAttribute('src')])).toEqual([['<Picture 1>', assetUrl('ref.png')]])
    expect(shot?.textContent).toContain('Picture 1 · Hero')
    expect(shot?.querySelector('p')?.textContent).toBe(' walks in the rain')
    expect(shot?.textContent).toContain('无 · 不接上一镜头')
    // A text shot shows its model and task by the catalog's task label, and no reference images.
    const textShot = editor.querySelector('li[data-shot="2"]')
    expect(drawnMedia(textShot)).toEqual([])
    expect(textShot?.textContent).toContain('无（文字生成不用参考图）')
    await runtime.dispose()
  })

  it('names a shot\'s task by the label that GET /api/dv/tasks serves', async () => {
    document.documentElement.lang = 'zh-CN'
    const state = fixtureState()
    const { v1, shot } = firstVersion(state)
    state.components.plan.plans['p1' as PlanId] = [{ ...v1, shots: [{ ...shot, task: 't2v' }, shot] }]
    const { runtime, editor } = await mountPlanCanvas(state)
    const modes = (): string[] => within(editor).getAllByTestId('dv-canvas-shot-mode').map(mode => mode.textContent ?? '')
    await waitFor(() => { expect(modes()).toEqual(['fasth3 · 文字生成', 'fasth3 · 参考图生成']) })
    await runtime.dispose()
  })

  it('reads approval status from the union of the chain anchors\' approved versions as anchors register and leave', async () => {
    document.documentElement.lang = 'zh-CN'
    const canvas = createDvCanvas()
    const disposePlanAnchor = canvas.chainAnchors.register(APPROVAL)
    const state = fixtureState()
    const { v1 } = firstVersion(state)
    state.components.plan.plans['p1' as PlanId] = [v1, { ...v1, version: 2 }, { ...v1, version: 3 }]
    const { runtime, editor } = await mountPlanCanvas(state, { canvas })
    expect(statuses(editor, [1, 2, 3])).toEqual(['已批准', '已被第 3 版取代', '待批准'])
    let disposeSecondAnchor = (): void => {}
    act(() => { disposeSecondAnchor = canvas.chainAnchors.register(SECOND_APPROVAL) })
    expect(statuses(editor, [1, 2, 3])).toEqual(['已批准', '已批准', '待批准'])
    act(() => { disposeSecondAnchor() })
    expect(statuses(editor, [1, 2, 3])).toEqual(['已批准', '已被第 3 版取代', '待批准'])
    // With no anchor left, no version is approved.
    act(() => { disposePlanAnchor() })
    expect(statuses(editor, [1, 2, 3])).toEqual(['已被第 2 版取代', '已被第 3 版取代', '待批准'])
    await runtime.dispose()
  })

  it('draws reference assets of every media type through dv.media, numbers only the images as Picture N, and names a version by its version kind', async () => {
    document.documentElement.lang = 'zh-CN'
    const canvas = createDvCanvas()
    const state = fixtureState()
    const { v1 } = firstVersion(state)
    state.assets.push(asset('score.wav', 'audio/wav', null), asset('notes.pdf', 'application/pdf', null))
    state.components.plan.plans['p1' as PlanId] = [{
      ...v1, references: ['shot1.mp4', 'hero@1'],
      shots: [{ prompt: '<Video 1> then <Picture 1>', modality: 'video' as const, task: 'ref2v' as const, provider: 'fastvideo', model: 'fasth3', references: ['shot1.mp4', 'hero@1', 'score.wav', 'notes.pdf'] }],
    }]
    const { runtime, editor } = await mountPlanCanvas(state, { canvas })
    // Without a version kind, hero@1 stands for no asset.
    const header = within(editor).getByText('计划参考')
    expect(header.textContent).toBe('计划参考shot1.mp4')
    expect(drawnMedia(header)).toEqual([`video ${assetUrl('shot1.mp4')}#t=0.1`])
    act(() => { canvas.versionKinds.register(CHARACTERS) })
    await waitFor(() => { expect(header.textContent).toBe('计划参考shot1.mp4Picture 1 · Hero') })
    expect(drawnMedia(header)).toEqual([`video ${assetUrl('shot1.mp4')}#t=0.1`, `img ${assetUrl('ref.png')}`])
    // The shot lists the video, the image, the audio and the PDF in input order; <Picture 1> draws Hero's image.
    const shot = editor.querySelector('li[data-shot="1"]')
    const chips = shot?.querySelector('dd')
    expect(drawnMedia(chips)).toEqual([`video ${assetUrl('shot1.mp4')}#t=0.1`, `img ${assetUrl('ref.png')}`, 'audio ♪', 'file application/pdf'])
    expect([...chips?.firstElementChild?.children ?? []].map(chip => chip.lastElementChild?.textContent)).toEqual(['shot1.mp4', 'Picture 1 · Hero', 'score.wav', 'notes.pdf'])
    expect(shot?.querySelector('p')?.textContent).toBe('<Video 1> then ')
    expect(shot?.querySelector('p img')?.getAttribute('src')).toBe(assetUrl('ref.png'))
    await runtime.dispose()
  })

  it('shows the total duration and the aspect ratio in the version row, and each shot\'s duration on its card', async () => {
    document.documentElement.lang = 'zh-CN'
    const state = fixtureState()
    const { v1 } = firstVersion(state)
    state.components.plan.plans['p1' as PlanId] = [{ ...v1, aspect_ratio: '16:9', shots: v1.shots.map((shot, index) => ({ ...shot, duration_sec: index + 1 })) }]
    const { runtime, editor } = await mountPlanCanvas(state)
    expect(within(editor).getByText('2 个镜头 · 0:03 · 16:9')).toBeTruthy()
    expect(editor.querySelector('li[data-shot="1"]')?.textContent).toContain('1 秒')
    expect(editor.querySelector('li[data-shot="2"]')?.textContent).toContain('2 秒')
    await runtime.dispose()
  })

  it('collapses only a prompt taller than 140 px under a fade, with a toggle that shows all of it and collapses it again', async () => {
    document.documentElement.lang = 'zh-CN'
    measureByCharacters()
    const state = fixtureState()
    const { v1, shot } = firstVersion(state)
    state.components.plan.plans['p1' as PlanId] = [{ ...v1, shots: [{ ...shot, prompt: 'hero walks through the rain' }, { ...shot, prompt: 'hero turns' }] }]
    const { runtime, editor } = await mountPlanCanvas(state)
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
    document.documentElement.lang = 'zh-CN'
    const canvas = createDvCanvas()
    canvas.versionKinds.register(CHARACTERS)
    const state = fixtureState()
    const { v1 } = firstVersion(state)
    state.components.plan.plans['p1' as PlanId] = [{ ...v1, references: ['hero@1.0'] }]
    const { runtime, editor } = await mountPlanCanvas(state, { canvas })
    expect(within(editor).getByText('计划参考').textContent).toBe('计划参考Picture 1 · Hero')
    await runtime.dispose()
  })

  it('measures a shot prompt again when the chosen version shows a different prompt in the same shot', async () => {
    document.documentElement.lang = 'zh-CN'
    measureByCharacters()
    const state = fixtureState()
    const { v1, shot } = firstVersion(state)
    state.components.plan.plans['p1' as PlanId] = [
      { ...v1, shots: [{ ...shot, prompt: 'hero walks through the rain' }] },
      { ...v1, version: 2, shots: [{ ...shot, prompt: 'hero turns' }] },
    ]
    const { runtime, editor } = await mountPlanCanvas(state)
    const toggles = (): HTMLElement[] => within(editor).queryAllByRole('button', { name: '展开全部提示词' })
    expect(toggles()).toHaveLength(0)
    fireEvent.click(within(editor).getByRole('button', { name: '第 1 版' }))
    expect(toggles()).toHaveLength(1)
    fireEvent.click(within(editor).getByRole('button', { name: '第 2 版' }))
    expect(toggles()).toHaveLength(0)
    await runtime.dispose()
  })

  it('measures a shot prompt again when a reference starts to resolve and its Picture N token turns into an image', async () => {
    document.documentElement.lang = 'zh-CN'
    measureByCharacters()
    const canvas = createDvCanvas()
    const state = fixtureState()
    const { v1 } = firstVersion(state)
    state.components.plan.plans['p1' as PlanId] = [{
      ...v1, references: ['hero@1'],
      shots: [{ prompt: '<Picture 1> walks', modality: 'video' as const, task: 'ref2v' as const, provider: 'fastvideo', model: 'fasth3' }],
    }]
    const { runtime, editor } = await mountPlanCanvas(state, { canvas })
    const toggles = (): HTMLElement[] => within(editor).queryAllByRole('button', { name: '展开全部提示词' })
    // Without a version kind, hero@1 resolves to nothing, and the 17-character token text overflows.
    expect(toggles()).toHaveLength(1)
    act(() => { canvas.versionKinds.register(CHARACTERS) })
    // After the registration, Hero's image stands for <Picture 1>; the remaining 6 characters fit.
    await waitFor(() => { expect(toggles()).toHaveLength(0) })
    await runtime.dispose()
  })

  it('shows nothing for a node whose plan the state does not hold', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, card, editor } = await mountPlanCanvas(fixtureState(), { nodeId: 'plan:p9' })
    expect(card.textContent).toBe('分镜计划 · 第 1 版')
    expect(editor.querySelector('[data-slot="dv.canvas.editor"]')?.childElementCount).toBe(0)
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
