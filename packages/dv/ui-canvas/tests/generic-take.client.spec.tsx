// @vitest-environment jsdom
/**
 * Image and audio records on the canvas, drawn through the real `dv.media` Factory and media views, and the take editor
 * that shows only declared params.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import type { WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import type { ProjectAsset, ProjectRecord, WireOperation, WireParamSpec } from '@dv/ui-kit/types.ts'
import { asset, fixtureState, OPERATIONS, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { CanvasView } from '../src/client/CanvasView.tsx'
import type { CanvasTranslate } from '../src/client/NodeCard.tsx'
import { zh } from '../src/client/locales.ts'
import { mountCanvasFrame } from './media-runtime.client.tsx'

/** The model key and the prompt, which every generation operation declares first. */
const KEY_PARAMS: Record<string, WireParamSpec> = Object.fromEntries(
  ['modality', 'task', 'provider', 'model', 'prompt'].map(key => [key, { type: 'string', required: true }]),
)

/** A literal `image.generate` declaration: the image primitive with a size choice, a seed, and the model's own params. */
const IMAGE: WireOperation = {
  name: 'image.generate', version: '1', description: 'One image.', label: { zh: '生成图片', en: 'Generate image' }, inputs: {},
  params: { ...KEY_PARAMS, size: { type: 'string', enum: ['1024x1024', '512x512'] }, seed: { type: 'integer' }, extra: { type: 'object' } },
  outputs: [{ role: 'image', type: 'image' }], deterministic: false, resource: 'gpu', confirm: 'over_gpu_budget',
}

/** A literal `audio.generate` declaration: the audio primitive has a voice and no seed. */
const AUDIO: WireOperation = {
  name: 'audio.generate', version: '1', description: 'One audio clip.', label: { zh: '生成音频', en: 'Generate audio' }, inputs: {},
  params: { ...KEY_PARAMS, voice: { type: 'string' }, extra: { type: 'object' } },
  outputs: [{ role: 'audio', type: 'audio' }], deterministic: false, resource: 'gpu', confirm: 'over_gpu_budget',
}

/** A timeline export: not deterministic and with a video output, but on the CPU. */
const EXPORT: WireOperation = {
  name: 'timeline.export', version: '1', description: 'Export a timeline.', inputs: {}, params: { timeline: { type: 'string' } },
  outputs: [{ role: 'video', type: 'video' }], deterministic: false, resource: 'cpu', confirm: 'never',
}

/** The params of the image take `i1`. */
const CAT_PARAMS = { modality: 'image', task: 't2i', provider: 'sglang', model: 'qwen-image', prompt: 'a cat', size: '512x512', seed: 7 }

let language = ''
/** The runtimes that {@link mount} created, disposed after each test. */
const runtimes: SlotTestRuntime[] = []
beforeEach(() => {
  language = document.documentElement.lang
  document.documentElement.lang = 'zh-CN'
})
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  document.documentElement.lang = language
})

/**
 * Mount the canvas over the shared fixture plus some records and their assets, under a slot runtime frame that hands it
 * the `dv.media` renderer, with the real media and asset pool plugins mounted.
 * @param operations - the declarations that `/api/dv/operations` serves.
 * @param records - the records added to the fixture.
 * @param assets - the assets added to the fixture, each with its producer in `created_by`.
 * @param tasks - the task labels that `/api/dv/tasks` serves; the fixture's video labels when omitted.
 * @returns the view, the recorded writes, a node lookup that waits for the node, and an editor opener.
 */
async function mount(operations: WireOperation[], records: ProjectRecord[], assets: ProjectAsset[], tasks?: WireTaskLabels) {
  const scripted = scriptedFetch({
    operations,
    ...tasks === undefined ? {} : { tasks },
    state: () => {
      const state = fixtureState()
      state.components.proj.records.push(...records)
      state.assets.push(...assets)
      for (const added of assets) if (added.created_by !== null) state.components.proj.created_by[added.id] = added.created_by
      return state
    },
  })
  const t: CanvasTranslate = makeTranslate(zh)
  const client = new DvClient(scripted.fetch)
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  await mountCanvasFrame(runtime, ({ renderFactorySlot }) => (
    <CanvasView projectId="p1" client={client} session="s5" t={t} renderFactorySlot={renderFactorySlot} />
  ))
  const view = runtime.renderRoot()
  const node = (id: string): Promise<HTMLElement> => waitFor(() => {
    const element = view.container.querySelector(`[data-node-id="${id}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no node ${id}`)
    return element
  })
  const open = (card: HTMLElement): Promise<HTMLElement> => {
    fireEvent.pointerDown(card, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    return view.findByTestId('dv-canvas-node-editor')
  }
  return { view, writes: scripted.writes, node, open }
}

/** The image take `i1` with its output `cat.png`. */
const catTake = (): ProjectRecord => record({ id: 'i1', operation: 'image.generate', deterministic: false, params: CAT_PARAMS, outputs: ['cat.png'] })

describe('image and audio records on the canvas', () => {
  it('a done image.generate record draws a take with its label and thumb; its form starts with the prompt and has no duration_sec field', async () => {
    const { view, writes, node, open } = await mount([...OPERATIONS, IMAGE], [catTake()], [asset('cat.png', 'image/png', 'i1')])
    // The running retake g3 has no output, so it draws only once the declarations arrived.
    await node('g3')
    const card = await node('i1')
    expect(card.getAttribute('data-node-type')).toBe('take')
    expect(card.getAttribute('aria-label')).toBe('生成图片')
    expect(card.querySelector('img')?.getAttribute('src')).toBe(assetUrl('cat.png'))
    const editor = await open(card)
    // The editor plays the image at full size, named by the asset; the card's still has no name.
    expect(editor.querySelector('img')?.getAttribute('alt')).toBe('cat.png')
    expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe('qwen-image · t2i')
    // The model key is the render-mode line; every other declared param has a field, the prompt first.
    expect([...editor.querySelectorAll('textarea, input, select')].map(control => control.id))
      .toEqual(['dv-canvas-editor-prompt', 'dv-canvas-editor-size', 'dv-canvas-editor-seed', 'dv-canvas-editor-extra'])
    expect(editor.querySelector('label[for="dv-canvas-editor-prompt"]')?.textContent).toBe(zh['editor.prompt'])
    expect(editor.querySelector('label[for="dv-canvas-editor-seed"]')?.textContent).toBe(zh['editor.seed'])
    expect(editor.querySelector('label[for="dv-canvas-editor-size"]')?.textContent).toBe('size')
    // The operation declares no reference input, so the editor offers no reference chips.
    expect(view.queryByText(zh['editor.addAsset'])).toBeNull()
    fireEvent.change(editor.querySelector('#dv-canvas-editor-prompt') as HTMLTextAreaElement, { target: { value: 'a black cat' } })
    fireEvent.change(editor.querySelector('#dv-canvas-editor-seed') as HTMLInputElement, { target: { value: '' } })
    fireEvent.click(view.getByText(zh['editor.renderTake']))
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toEqual({
      project: 'p1', operation: 'image.generate', inputs: [], surface: 'canvas', intent: '在画布上渲染 生成图片 的新版本', based_on: 'i1', session: 's5',
      params: { modality: 'image', task: 't2i', provider: 'sglang', model: 'qwen-image', prompt: 'a black cat', size: '512x512' },
    })
  })

  it('a pending image.generate record with no outputs draws with the rendering flag', async () => {
    const pending = record({ id: 'i2', operation: 'image.generate', deterministic: false, params: CAT_PARAMS, status: 'pending' })
    const { node } = await mount([...OPERATIONS, IMAGE], [pending], [])
    expect((await node('i2')).textContent).toContain(zh['node.rendering'])
  })

  it('an audio.generate take draws the audio card and plays in an audio player with controls, not muted', async () => {
    const line = record({
      id: 'v1', operation: 'audio.generate', deterministic: false, outputs: ['line.wav'],
      params: { modality: 'audio', task: 't2a', provider: 'sglang', model: 'fish-audio', prompt: 'hello', voice: 'calm' },
    })
    const { node, open } = await mount([...OPERATIONS, AUDIO], [line], [asset('line.wav', 'audio/wav', 'v1', 2)])
    await node('g3')
    // The card shows the audio view's card form: its play button.
    expect(within(await node('v1')).getByRole('button', { name: '播放' })).toBeTruthy()
    const editor = await open(await node('v1'))
    const player = editor.querySelector('audio')
    expect(player?.getAttribute('src')).toBe(assetUrl('line.wav'))
    expect(player?.hasAttribute('controls')).toBe(true)
    expect(player?.muted).toBe(false)
    expect(editor.querySelector('video')).toBeNull()
    // The audio operation declares no seed, so its form has no seed field.
    expect((editor.querySelector('#dv-canvas-editor-voice') as HTMLInputElement).value).toBe('calm')
    expect(editor.querySelector('#dv-canvas-editor-seed')).toBeNull()
  })

  it('an image record whose operation is off the list shows the label image.generate, no 渲染新版本 and no form', async () => {
    const { view, node, open } = await mount(OPERATIONS, [catTake()], [asset('cat.png', 'image/png', 'i1')])
    await node('g3')
    const card = await node('i1')
    expect(card.getAttribute('aria-label')).toBe('image.generate')
    const editor = await open(card)
    expect(editor.querySelector('textarea, input, select')).toBeNull()
    expect(view.queryByText(zh['editor.renderTake'])).toBeNull()
  })

  it('a timeline.export record draws no node', async () => {
    const exported = record({ id: 'c9', operation: 'timeline.export', deterministic: false, params: { timeline: 't1' }, outputs: ['cut.mp4'] })
    const { view, node } = await mount([...OPERATIONS, IMAGE, EXPORT], [catTake(), exported], [asset('cat.png', 'image/png', 'i1'), asset('cut.mp4', 'video/mp4', 'c9', 3)])
    await node('g3')
    await node('i1')
    expect(view.container.querySelector('[data-node-id="c9"]')).toBeNull()
  })

  it('the render-mode line of a t2i take reads the catalog label of t2i, else the task name', async () => {
    const labelled = await mount([...OPERATIONS, IMAGE], [catTake()], [asset('cat.png', 'image/png', 'i1')], { t2i: { zh: '文字生成图片', en: 'Image from text' } })
    await labelled.node('g3')
    await labelled.open(await labelled.node('i1'))
    await waitFor(() => { expect(labelled.view.getByTestId('dv-canvas-render-mode').textContent).toBe('qwen-image · 文字生成图片') })
    cleanup()
    const unlabelled = await mount([...OPERATIONS, IMAGE], [catTake()], [asset('cat.png', 'image/png', 'i1')], {})
    await unlabelled.node('g3')
    await unlabelled.open(await unlabelled.node('i1'))
    expect(unlabelled.view.getByTestId('dv-canvas-render-mode').textContent).toBe('qwen-image · t2i')
  })
})
