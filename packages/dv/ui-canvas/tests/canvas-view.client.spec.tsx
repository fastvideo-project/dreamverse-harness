// @vitest-environment jsdom
/** The canvas over a scripted API: nodes, drag persistence, the floating editor, and the `dv:compose` event. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { RecordId } from '@dv/project/types'
import type { PlanId } from '@dv/shot-plan/types'
import { apply as assetPoolApply, inject as assetPoolInject } from '@dv/ui-asset-pool/src/client/index.ts'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import { DV_COMPOSE_EVENT } from '@dv/ui-kit/compose.ts'
import type { DvComposeDetail } from '@dv/ui-kit/compose.ts'
import type { ChainAnchor, DvCanvas } from '@dv/ui-kit/registries.ts'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE, DV_CANVAS_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
import { defineReferenceUi } from '@dv/ui-kit/reference-kit.tsx'
import { asset, fixtureState, OPERATIONS, record, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { planNodeType } from '../../ui-shot-plan/src/client/index.ts'
import { CanvasView } from '../src/client/CanvasView.tsx'
import { createDvCanvas } from '../src/client/dv-canvas.ts'
import { NODE_WIDTH } from '../src/client/graph.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import type { CanvasTranslate } from '../src/client/NodeCard.tsx'
import { zh } from '../src/client/locales.ts'

/** The chain anchor of the fixture's approval `a1`: it hangs the records it started off `plan:p1` and approved v1. */
const APPROVAL: ChainAnchor = {
  starter: 'plan.approve', anchor: record => `plan:${String(record.params['plan'])}`,
  approvedVersions: (_state, anchorId) => anchorId === 'plan:p1' ? [1] : [],
}

/** The reference noun `test_ref` of the fixture, declared as the UI package of a noun declares it. */
const testRef = defineReferenceUi({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref,
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

/**
 * Canvas registries that hold the node type, references in use and version kind of `test_ref`, as the bundle mounts the
 * UI package of a noun.
 * @returns the registries and the disposer of the descriptors of `test_ref`.
 */
function refCanvas(): { canvas: DvCanvas; dispose: () => void } {
  const canvas = createDvCanvas()
  const disposers = [
    canvas.nodeTypes.register(testRef.nodeType), canvas.takesInUse.register(testRef.referencesInUse),
    canvas.versionKinds.register(testRef.versionKind),
  ]
  return { canvas, dispose: () => { for (const dispose of disposers) dispose() } }
}

/**
 * @param canvas - the registries that get the node type of plans; empty ones by default.
 * @returns the registries with the node type of plans, as `@dv/ui-shot-plan` registers it.
 */
function planCanvas(canvas: DvCanvas = createDvCanvas()): DvCanvas {
  canvas.nodeTypes.register(planNodeType)
  return canvas
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.localStorage.removeItem(EDITOR_RECT_KEY)
  window.localStorage.removeItem('dv-canvas-seen:p1')
  document.documentElement.lang = ''
})

/**
 * An API client over scripted `/api/dv` routes and a scripted layout route.
 * @param edit - changes to the fixture state, applied to every state the route serves.
 * @param holdOperations - whether `POST /api/dv/operation` stays unanswered, as a render does until it ends.
 * @param operations - the operation declarations the route serves.
 * @returns the client, the recorded writes, and the recorded layout writes.
 */
function scriptedClient(edit: (state: FixtureState) => void, holdOperations: boolean, operations: WireOperation[]) {
  const scripted = scriptedFetch({
    state: () => {
      const state = withTestRef(fixtureState())
      edit(state)
      return state
    },
    operations,
  })
  const layoutWrites: unknown[] = []
  const fetchWithLayout: typeof fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/dv/layout')) {
      if (init?.method === 'POST') layoutWrites.push(JSON.parse(String(init.body)))
      const layout = { positions: { g1: { x: 10, y: 20 } }, viewport: { x: 0, y: 0, zoom: 1 } }
      return Promise.resolve(new Response(JSON.stringify(layout)))
    }
    if (holdOperations && input === '/api/dv/operation') {
      void scripted.fetch(input, init)
      return new Promise<Response>(() => undefined)
    }
    return scripted.fetch(input, init)
  }
  return { client: new DvClient(fetchWithLayout), writes: scripted.writes, layoutWrites }
}

/**
 * @param view - a rendered canvas.
 * @returns the lookup of a drawn node by its ID.
 */
function nodeLookup(view: RenderResult): (id: string) => HTMLElement {
  return (id) => {
    const element = view.container.querySelector(`[data-node-id="${id}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no node ${id}`)
    return element
  }
}

/**
 * Mount the canvas over scripted `/api/dv` routes and a scripted layout route.
 * @param withTranslate - whether the host passes the Chinese translate.
 * @param edit - changes to the fixture state, applied to every state the route serves.
 * @param holdOperations - whether `POST /api/dv/operation` stays unanswered, as a render does until it ends.
 * @param operations - the operation declarations the route serves; the fixture's by default.
 * @param canvas - the `dvCanvas` registries the view reads; the descriptors of `test_ref` and the node type of plans by
 *   default.
 * @returns the rendered view, the recorded writes, and a node lookup.
 */
function mount(
  withTranslate = true, edit: (state: FixtureState) => void = () => undefined, holdOperations = false, operations = OPERATIONS,
  canvas: DvCanvas = planCanvas(refCanvas().canvas),
) {
  const { client, writes, layoutWrites } = scriptedClient(edit, holdOperations, operations)
  const t: CanvasTranslate = makeTranslate(zh)
  const view = render(<CanvasView projectId="p1" client={client} session="s5" {...withTranslate ? { t } : {}} canvas={canvas} />)
  return { view, writes, layoutWrites, node: nodeLookup(view) }
}

/**
 * Mount the canvas under the real slot runtime, in a frame that declares the slots of its editors as the canvas center
 * view does, with the asset pool plugin filling the picker and the preview.
 * @param edit - changes to the fixture state, applied to every state the route serves.
 * @returns the runtime, the rendered view, the recorded writes, and a node lookup.
 */
async function mountWithAssetPool(edit: (state: FixtureState) => void) {
  const { client, writes } = scriptedClient(edit, false, OPERATIONS)
  const t: CanvasTranslate = makeTranslate(zh)
  const canvas = refCanvas().canvas
  const runtime = await SlotTestRuntime.create()
  const Frame = ({ renderSlot }: PropsRenderSlots<'dv.canvas.editor' | 'dv.canvas.picker' | 'dv.canvas.preview'>): ReactNode =>
    <CanvasView projectId="p1" client={client} session="s5" t={t} canvas={canvas} renderSlot={renderSlot} />
  await runtime.root.declare({
    'dv.canvas.editor': { kind: 'keyed', scope: 'root' },
    'dv.canvas.picker': { kind: 'keyed', scope: 'root' },
    'dv.canvas.preview': { kind: 'keyed', scope: 'root' },
  }, Frame)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  const view = runtime.renderRoot()
  return { runtime, view, writes, node: nodeLookup(view) }
}

describe('CanvasView', () => {
  it('draws the project\'s current state with nodes at stored positions, stores the others\' spots, and stores a dragged position', async () => {
    const canvas = planCanvas(refCanvas().canvas)
    canvas.takesInUse.register({ id: 'clips', uses: () => [], badges: () => [{ asset: 'shot2.mp4', label: '已裁剪' }] })
    const { view, node, layoutWrites } = mount(true, undefined, false, OPERATIONS, canvas)
    await waitFor(() => { node('g3') })
    expect(node('g1').style.left).toBe('10px')
    expect(node('g2').getAttribute('data-node-stale')).toBe('true')
    // A badge that a TakesInUse reports for an asset shows on that asset's take as given.
    expect(within(node('g2')).getByText('已裁剪')).toBeTruthy()
    // Every node without a stored position gets its spot stored once, without the viewport.
    await waitFor(() => { expect(layoutWrites).toHaveLength(1) })
    expect(layoutWrites[0]).toEqual({ project: 'p1', positions: expect.objectContaining({ g2: { x: 720, y: 0 } }) })
    expect(Object.keys((layoutWrites[0] as { positions: object }).positions)).not.toContain('g1')
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(view.getByTestId('dv-canvas-view'), { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    await waitFor(() => { expect(layoutWrites).toHaveLength(2) }, { timeout: 2000 })
    expect(layoutWrites[1]).toMatchObject({ project: 'p1', positions: { g2: { x: 720 + 50, y: 0 + 30 } } })
  })

  it('reads the chain anchors of its registries: an anchor links and titles the takes of its chains until its disposal', async () => {
    const canvas = planCanvas()
    const { view, node } = mount(true, (state) => {
      state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1' ? { ...entry, started_by: { record: 'a1', slot: 1 } } : entry)
    }, false, OPERATIONS, canvas)
    const edge = (): Element | null => view.container.querySelector('path[data-edge="plan:p1>g1"]')
    await waitFor(() => { node('g1') })
    expect(edge()).toBeNull()
    let dispose = (): void => undefined
    act(() => { dispose = canvas.chainAnchors.register(APPROVAL) })
    // The retake g3 keeps the chain of its root g1, so both read 镜头 1 and hang off plan:p1.
    await waitFor(() => { expect(edge()).not.toBeNull() })
    expect(view.container.querySelector('path[data-edge="plan:p1>g3"]')).not.toBeNull()
    expect([node('g1'), node('g3')].map(element => element.getAttribute('aria-label'))).toEqual(['镜头 1 · 第 1 次', '镜头 1 · 第 2 次'])
    act(() => { dispose() })
    await waitFor(() => { expect(edge()).toBeNull() })
  })

  it('keeps the node selected after its editor closes; a click on empty canvas then clears the selection', async () => {
    const { view, node } = mount()
    await waitFor(() => { node('g1') })
    const canvas = view.getByTestId('dv-canvas-view')
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await view.findByTestId('dv-canvas-node-editor')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    fireEvent.pointerDown(canvas, { button: 0, clientX: 700, clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBeNull()
  })

  it('渲染新版本 reads 渲染中… until the new take appears, then the editor closes and the new take is selected', async () => {
    let started = false
    const { view, node } = mount(true, (state) => {
      if (!started) return
      state.components.proj.records.push(record({
        id: 'n1', operation: 'shot.render', deterministic: false, based_on: 'g1', params: { prompt: 'hero runs' }, status: 'running',
      }))
    }, true)
    await waitFor(() => { node('g1') })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    await view.findByTestId('dv-canvas-node-editor')
    fireEvent.click(view.getByText(zh['editor.renderTake']))
    const button = view.getByRole('button', { name: zh['node.rendering'] })
    expect(button.hasAttribute('disabled')).toBe(true)
    // The host wrote the pending record; the next state refetch (a 3-second poll without EventSource) shows its node.
    started = true
    await waitFor(() => { expect(node('n1').getAttribute('data-node-selected')).toBe('true') }, { timeout: 6000 })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    expect(node('g1').getAttribute('data-node-selected')).toBeNull()
  }, 10_000)

  it('draws a record of a generation operation from the served declarations as a take titled by the operation label', async () => {
    const lang = document.documentElement.lang
    document.documentElement.lang = 'zh-CN'
    try {
      const generate: WireOperation = {
        name: 'image.generate', version: '1', description: 'One image.', inputs: {}, params: {}, outputs: [{ role: 'image', type: 'image' }],
        deterministic: false, resource: 'gpu', confirm: 'never', label: { zh: '生成图像', en: 'Generate image' },
      }
      const { node } = mount(true, (state) => {
        state.components.proj.records.push(record({ id: 'i1', operation: 'image.generate', deterministic: false, outputs: ['cat.png'] }))
        state.assets.push(asset('cat.png', 'image/png', 'i1'))
        state.components.proj.created_by['cat.png'] = 'i1'
      }, false, [...OPERATIONS, generate])
      await waitFor(() => { node('i1') })
      expect(node('i1').getAttribute('data-node-type')).toBe('take')
      expect(node('i1').getAttribute('aria-label')).toBe('生成图像')
      expect(node('i1').querySelector('img')?.getAttribute('src')).toBe(assetUrl('cat.png'))
    } finally {
      document.documentElement.lang = lang
    }
  })

  it('marks a take that finished after the first load as unseen until its editor opens', async () => {
    let finished = false
    const { view, node } = mount(true, (state) => {
      if (!finished) return
      state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g3' ? { ...entry, status: 'done' as const, outputs: ['shot2.mp4'] } : entry)
    })
    await waitFor(() => { node('g3') })
    // Takes that were finished at the first load count as seen.
    expect(view.container.querySelectorAll('[data-node-unseen]')).toHaveLength(0)
    finished = true
    await waitFor(() => { expect(node('g3').getAttribute('data-node-unseen')).toBe('true') }, { timeout: 6000 })
    fireEvent.pointerDown(node('g3'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    await view.findByTestId('dv-canvas-node-editor')
    expect(node('g3').getAttribute('data-node-unseen')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem('dv-canvas-seen:p1') ?? '[]')).toContain('g3')
  }, 10_000)

  it('draws a character as its name and its first reference image with a count of the rest', async () => {
    document.documentElement.lang = 'zh-CN'
    const references = ['ref.png', 'r2.png', 'r3.png', 'r4.png', 'r5.png', 'r6.png']
    const { node } = mount(true, (state) => {
      state.assets.push(...references.slice(1).map(id => asset(id, 'image/png', 'u1')))
      const hero = state.components.test_ref?.['hero']?.[0]
      if (hero !== undefined) hero.references = references
    })
    await waitFor(() => { node('test_ref:hero') })
    const card = node('test_ref:hero')
    expect([...card.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([assetUrl('ref.png')])
    // The card carries the label of the node type of `test_ref`.
    expect(card.textContent).toContain('参考')
    expect(card.textContent).toContain('Hero')
    expect(card.textContent).toContain('+5')
  })

  it('draws the items of a reference noun and links their version inputs from them only while its descriptors are registered', async () => {
    const noun = refCanvas()
    const { view, node } = mount(true, undefined, false, OPERATIONS, noun.canvas)
    const edge = (): Element | null => view.container.querySelector('path[data-edge="test_ref:hero>g1"]')
    await waitFor(() => { expect(edge()).not.toBeNull() })
    expect(node('test_ref:hero').getAttribute('data-node-type')).toBe('test_ref')
    act(() => { noun.dispose() })
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="test_ref:hero"]')).toBeNull() })
    expect(edge()).toBeNull()
  })

  it('draws a character whose first reference is a video as the video\'s first frame', async () => {
    const { node } = mount(true, (state) => {
      const hero = state.components.test_ref?.['hero']?.[0]
      if (hero !== undefined) hero.references = ['shot1.mp4', 'ref.png']
    })
    await waitFor(() => { node('test_ref:hero') })
    expect([...node('test_ref:hero').querySelectorAll('video')].map(video => video.getAttribute('src'))).toEqual([`${assetUrl('shot1.mp4')}#t=0.1`])
    expect(node('test_ref:hero').textContent).toContain('+1')
  })

  it('puts a dropped 素材 tile on the canvas under the pointer with asset.place, and 从画布移除 takes it off with asset.unplace', async () => {
    const { view, node, writes } = mount(true, (state) => {
      state.assets.push(asset('pool.png', 'image/png', 'u2'))
      state.components.proj.records.push(record({ id: 'u2', operation: 'asset.import', params: { name: 'pool.png' }, outputs: ['pool.png'], surface: 'asset_pool' }))
      state.components.proj.created_by['pool.png'] = 'u2'
    })
    await waitFor(() => { node('g1') })
    expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull()
    const dataTransfer = { types: [DV_ASSET_DRAG_TYPE], getData: (type: string) => type === DV_ASSET_DRAG_TYPE ? 'pool.png' : '', files: [] }
    // jsdom's drop event carries no pointer coordinates, so they are set on the event.
    const drop = createEvent.drop(view.getByTestId('dv-canvas-view'), { dataTransfer })
    Object.defineProperties(drop, { clientX: { value: 500 }, clientY: { value: 300 } })
    fireEvent(view.getByTestId('dv-canvas-view'), drop)
    await waitFor(() => { expect(node('u2').style.left).toBe(`${String(500 - NODE_WIDTH / 2)}px`) })
    const placement = (operation: string) => ({
      path: '/api/dv/operation', body: { project: 'p1', operation, surface: 'canvas', inputs: [{ role: 'asset', ref: 'pool.png' }], session: 's5' },
    })
    await waitFor(() => { expect(writes).toContainEqual(placement('asset.place')) })
    fireEvent.pointerDown(node('u2'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    fireEvent.click(await view.findByText(zh['editor.removeFromCanvas']))
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull() })
    await waitFor(() => { expect(writes).toContainEqual(placement('asset.unplace')) })
  })

  it('places a dropped 素材 tile of an asset that no record of the current state imported, and draws it as asset:<id>', async () => {
    const canvas: string[] = []
    const { view, writes } = mount(true, (state) => {
      // An undo went back past the import: the asset pool still lists the asset.
      state.assets.push(asset('undone.png', 'image/png', 'u9', null, 'asset.import'))
      state.components.asset.placed = [...canvas]
    })
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="g1"]')).not.toBeNull() })
    const dataTransfer = { types: [DV_ASSET_DRAG_TYPE], getData: (type: string) => type === DV_ASSET_DRAG_TYPE ? 'undone.png' : '', files: [] }
    fireEvent.drop(view.getByTestId('dv-canvas-view'), { dataTransfer })
    await waitFor(() => {
      expect(writes).toContainEqual({
        path: '/api/dv/operation', body: { project: 'p1', operation: 'asset.place', surface: 'canvas', inputs: [{ role: 'asset', ref: 'undone.png' }], session: 's5' },
      })
    })
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="asset:undone.png"]')).not.toBeNull() })
    expect(view.queryByText(/no node/)).toBeNull()
  })

  it('draws an asset that another writer put on the project\'s canvas once the state refetches', async () => {
    const canvas: string[] = []
    const { view, node } = mount(true, (state) => {
      state.assets.push(asset('chat.png', 'image/png', 'u2'))
      state.components.proj.records.push(record({ id: 'u2', operation: 'asset.import', params: { name: 'chat.png' }, outputs: ['chat.png'], surface: 'chat' }))
      state.components.proj.created_by['chat.png'] = 'u2'
      state.components.asset.placed = [...canvas]
    })
    await waitFor(() => { node('g1') })
    expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull()
    // A chat message put the image on the canvas; the next state refetch (a 3-second poll without EventSource) shows it.
    canvas.push('chat.png')
    await waitFor(() => { node('u2') }, { timeout: 6000 })
  }, 10_000)

  it('opens the editor on click, renders a new take with based_on, and dispatches dv:compose', async () => {
    const { view, node, writes } = mount()
    await waitFor(() => { node('g1') })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    // The task reads its label from the scripted GET /api/dv/tasks, in the language of <html lang> (English here).
    expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe('fasth3 · From references')
    fireEvent.change(editor.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'hero runs' } })
    fireEvent.click(view.getByText(zh['editor.renderTake']))
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({
      project: 'p1', operation: 'shot.render', surface: 'canvas', based_on: 'g1', params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero runs' },
      inputs: [{ role: 'reference', ref: 'hero@1' }],
    })
    fireEvent.pointerDown(node('test_ref:hero'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    const composed: DvComposeDetail[] = []
    const listener = (event: Event): void => { composed.push((event as CustomEvent<DvComposeDetail>).detail) }
    window.addEventListener(DV_COMPOSE_EVENT, listener)
    fireEvent.click(await view.findByText(zh['editor.askAgent']))
    window.removeEventListener(DV_COMPOSE_EVENT, listener)
    expect(composed).toEqual([{ text: '修改 Hero：', refs: [{ kind: 'test_ref', id: 'hero', label: 'Hero', assetId: 'ref.png' }] }])
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    // Choosing a node is a view gesture: it writes nothing.
    expect(writes.map(write => write.path)).toEqual(['/api/dv/operation'])
  })

  it('添加素材 adds the characters, locations and assets picked in the picker as references of the take, and an asset chip opens its preview', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, view, node, writes } = await mountWithAssetPool((state) => {
      state.components.test_ref = {
        ...state.components.test_ref,
        villain: [{ id: 'villain', version: 2, name: 'Villain', description: '', references: [], created_by: 'e1' }],
        ghost: [],
        studio: [{ id: 'studio', version: 1, name: '', description: '', references: ['plan.json'], created_by: 'e1' }],
      }

      state.assets.push(asset('plan.json', 'application/json', null))
    })
    await waitFor(() => { node('g1') })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    await view.findByTestId('dv-canvas-node-editor')
    // Escape closes the picker and leaves the editor open.
    fireEvent.click(view.getByText(zh['editor.addAsset']))
    await view.findByTestId('dv-canvas-asset-picker')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    expect(view.getByTestId('dv-canvas-node-editor')).toBeTruthy()
    fireEvent.click(view.getByText(zh['editor.addAsset']))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    // The take already holds hero@1, so the picker offers the other characters and locations, then the asset pool's
    // `dv.canvas.picker` entry.
    fireEvent.keyDown(window, { key: 'a' })
    const villain = within(picker).getByRole('button', { name: 'Villain' })
    // Each item sits in the section of its version kind, titled with the kind's label.
    expect(villain.closest('section')?.querySelector('h3')?.textContent).toBe('参考')
    expect(within(picker).getByRole('button', { name: 'studio' }).closest('section')?.querySelector('h3')?.textContent).toBe('参考')
    fireEvent.click(within(picker).getByRole('button', { name: 'studio' }))
    fireEvent.click(within(picker).getByRole('button', { name: 'studio' }))
    expect(within(picker).getByRole('button', { name: 'studio' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(villain)
    const tile = await waitFor(() => {
      const found = picker.querySelector('[data-asset-id="shot1.mp4"]')
      if (!(found instanceof HTMLElement)) throw new Error('no shot1.mp4 tile')
      return found
    })
    fireEvent.click(tile)
    // The picker rings the picked tile of the asset pool panel.
    expect(picker.querySelector('style')?.textContent).toContain('[data-asset-id="shot1.mp4"]')
    fireEvent.click(view.getByText('确认（2）'))
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '查看 shot1.mp4' }))
    expect(await view.findByRole('dialog', { name: 'shot1.mp4' })).toBeTruthy()
    // Escape closes the preview and leaves the editor open.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('dialog', { name: 'shot1.mp4' })).toBeNull() })
    expect(view.getByTestId('dv-canvas-node-editor')).toBeTruthy()
    fireEvent.click(view.getByText(zh['editor.renderTake']))
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({
      operation: 'shot.render',
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'villain@2' }, { role: 'reference', ref: 'shot1.mp4' }],
    })
    await runtime.dispose()
  })

  it('a character chip opens the character editor over the take editor, and closing it keeps the take editor\'s changes', async () => {
    const { view, node } = mount()
    await waitFor(() => { node('g1') })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    fireEvent.change(editor.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'hero runs' } })
    fireEvent.click(view.getByRole('button', { name: '查看 Hero' }))
    expect(view.getAllByTestId('dv-canvas-node-editor').map(panel => panel.getAttribute('aria-label'))).toEqual([editor.getAttribute('aria-label'), 'Hero'])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.getAllByTestId('dv-canvas-node-editor')).toHaveLength(1)
    expect((view.getByTestId('dv-canvas-node-editor').querySelector('textarea') as HTMLTextAreaElement).value).toBe('hero runs')
  })

  it('offers 仍然保留 on a stale node, which accepts its record for the chat session beside the canvas', async () => {
    const { view, node, writes } = mount()
    await waitFor(() => { node('g2') })
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    await view.findByTestId('dv-canvas-node-editor')
    fireEvent.click(view.getByRole('button', { name: zh['editor.keepAnyway'] }))
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/stale/accept')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/stale/accept')?.body).toEqual({ project: 'p1', record: 'g2', surface: 'canvas', session: 's5' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    await view.findByTestId('dv-canvas-node-editor')
    expect(view.queryByRole('button', { name: zh['editor.keepAnyway'] })).toBeNull()
  })

  it('draws a failed take as a row with its failure reason, and 重试 renders it again based on it', async () => {
    const { view, node, writes } = mount(true, (state) => {
      state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
        ? { ...entry, status: 'failed' as const, outputs: [], error: { code: 'operation_failed', message: 'GPU out of memory' } }
        : entry)
    })
    await waitFor(() => { node('g1') })
    expect(node('g1').getAttribute('title')).toBe('GPU out of memory')
    expect(node('g1').textContent).toContain(zh['node.renderFailed'])
    fireEvent.click(view.getAllByRole('button', { name: zh['node.retry'] })[0] as HTMLElement)
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({
      project: 'p1', operation: 'shot.render', surface: 'canvas', based_on: 'g1', session: 's5',
      params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero walks through the rain at night in the city' }, inputs: [{ role: 'reference', ref: 'hero@1' }],
    })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    expect((await view.findByTestId('dv-canvas-node-editor')).textContent).toContain('GPU out of memory')
  })

  it('shows the failure reason of a failed take only when its failure has a message', async () => {
    const { view, node } = mount(true, (state) => {
      state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1' || entry.id === 'g2'
        ? { ...entry, status: 'failed' as const, outputs: [], error: { code: 'operation_failed', message: entry.id === 'g2' ? 'GPU out of memory' : '' } }
        : entry)
    })
    await waitFor(() => { node('g2') })
    const select = (id: string): void => {
      fireEvent.pointerDown(node(id), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
      fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    }
    select('g1')
    expect((await view.findByTestId('dv-canvas-node-editor')).textContent).not.toContain(zh['editor.failure'].replace('{message}', ''))
    select('g2')
    await waitFor(() => {
      expect(view.getByTestId('dv-canvas-node-editor').textContent).toContain(zh['editor.failure'].replace('{message}', 'GPU out of memory'))
    })
  })

  it('opens the record a dv:canvas-focus asked for before mounting; empty-canvas clicks and Escape close the editor', async () => {
    window.dispatchEvent(new CustomEvent(DV_CANVAS_FOCUS_EVENT, { detail: { recordId: 'g2' } }))
    const { view, node } = mount()
    const editor = await view.findByTestId('dv-canvas-node-editor')
    expect(editor.getAttribute('aria-label')).toBe(node('g2').getAttribute('aria-label'))
    const canvas = view.getByTestId('dv-canvas-view')
    fireEvent.pointerDown(canvas, { button: 0, clientX: 700, clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await view.findByTestId('dv-canvas-node-editor')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
  })

  it('opens the plan node for a dv:canvas-focus on the record that wrote an earlier plan version', async () => {
    window.dispatchEvent(new CustomEvent(DV_CANVAS_FOCUS_EVENT, { detail: { recordId: 'p1' } }))
    const { view, node } = mount(true, (state) => {
      const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
      if (v1 === undefined) throw new Error('fixture lacks plan p1')
      state.components.plan.plans['p1' as PlanId] = [v1, { ...v1, version: 2, created_by: 'q2' as RecordId }]
    })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    expect(editor.getAttribute('aria-label')).toBe(node('plan:p1').getAttribute('aria-label'))
    expect(node('plan:p1').getAttribute('data-node-selected')).toBe('true')
  })

  it('opens the editor centered, moves and resizes it, remembers the rectangle for the next node, and resets on a double click', async () => {
    // jsdom has no layout; a 1200 × 800 canvas area gives the default rectangle 240, 80, 720 × 640.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    const { view, node } = mount()
    const canvas = view.getByTestId('dv-canvas-view')
    const open = async (id: string): Promise<HTMLElement> => {
      await waitFor(() => { node(id) })
      fireEvent.pointerDown(node(id), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
      fireEvent.pointerUp(canvas, { pointerId: 1 })
      return view.findByTestId('dv-canvas-node-editor')
    }
    const box = (editor: HTMLElement): number[] =>
      [editor.style.left, editor.style.top, editor.style.width, editor.style.height].map(value => parseFloat(value))
    const drag = (target: HTMLElement, dx: number, dy: number): void => {
      fireEvent.pointerDown(target, { button: 0, clientX: 300, clientY: 100, pointerId: 2 })
      fireEvent.pointerMove(target, { clientX: 300 + dx, clientY: 100 + dy, pointerId: 2 })
      fireEvent.pointerUp(target, { clientX: 300 + dx, clientY: 100 + dy, pointerId: 2 })
    }
    let editor = await open('g2')
    expect(box(editor)).toEqual([240, 80, 720, 640])
    drag(view.getByTestId('dv-canvas-editor-title-row'), 50, 30)
    expect(box(editor)).toEqual([290, 110, 720, 640])
    // A press on a title-row button starts no move.
    const close = view.getByRole('button', { name: zh['editor.close'] })
    fireEvent.pointerDown(close, { button: 0, clientX: 0, clientY: 0, pointerId: 3 })
    fireEvent.pointerMove(close, { clientX: 400, clientY: 400, pointerId: 3 })
    expect(box(editor)).toEqual([290, 110, 720, 640])
    const resize = view.getByRole('button', { name: zh['editor.resize'] })
    drag(resize, 100, 50)
    expect(box(editor)).toEqual([290, 110, 820, 690])
    fireEvent.keyDown(resize, { key: 'ArrowLeft' })
    fireEvent.keyDown(resize, { key: 'ArrowUp' })
    expect(box(editor)).toEqual([290, 110, 804, 674])
    expect(JSON.parse(window.localStorage.getItem(EDITOR_RECT_KEY) ?? 'null')).toEqual({ x: 290, y: 110, width: 804, height: 674 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    editor = await open('g1')
    expect(box(editor)).toEqual([290, 110, 804, 674])
    fireEvent.doubleClick(view.getByTestId('dv-canvas-editor-title-row'))
    expect(box(editor)).toEqual([240, 80, 720, 640])
    expect(window.localStorage.getItem(EDITOR_RECT_KEY)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
  })

  it('fits a remembered rectangle from a larger window into the canvas', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    window.localStorage.setItem(EDITOR_RECT_KEY, JSON.stringify({ x: 700, y: 300, width: 1000, height: 500 }))
    const { view, node } = mount()
    await waitFor(() => { node('g2') })
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    expect([editor.style.left, editor.style.top, editor.style.width, editor.style.height]).toEqual(['0px', '100px', '800px', '500px'])
  })

  it('a wheel over the floating editor leaves the canvas viewport alone; a wheel over empty canvas zooms it', async () => {
    const { view, node } = mount()
    await waitFor(() => { node('plan:p1') })
    fireEvent.pointerDown(node('plan:p1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    const canvas = view.getByTestId('dv-canvas-view')
    const transform = (): string => (canvas.querySelector('div[style*="transform"]') as HTMLElement).style.transform
    const before = transform()
    const overEditor = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    act(() => { (editor.querySelector('li') ?? editor).dispatchEvent(overEditor) })
    expect(overEditor.defaultPrevented).toBe(false)
    expect(transform()).toBe(before)
    const overCanvas = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    act(() => { canvas.dispatchEvent(overCanvas) })
    expect(overCanvas.defaultPrevented).toBe(true)
    expect(transform()).not.toBe(before)
  })

  it('follows the DSH interface language in <html lang> when the host passes no translate', async () => {
    document.documentElement.lang = 'en'
    const { view } = mount(false)
    expect(await view.findByText('Fit')).toBeTruthy()
    await act(async () => { document.documentElement.lang = 'zh-CN'; await Promise.resolve() })
    expect(await view.findByText(zh['canvas.fit'])).toBeTruthy()
    document.documentElement.lang = ''
  })
})
