// @vitest-environment jsdom
/** The canvas over a scripted API: nodes, drag persistence, the floating editor, and the `dv:compose` event. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { RecordId } from '@dv/project/types'
import type { PlanId } from '@dv/shot-plan/types'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import { DV_COMPOSE_EVENT } from '@dv/ui-kit/compose.ts'
import type { DvComposeDetail } from '@dv/ui-kit/compose.ts'
import type { ChainAnchor, DvCanvas, NodeType } from '@dv/ui-kit/registries.ts'
import type { CanvasLayout, CanvasViewport, NodePosition, WireOperation } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'
import { asset, fixtureState, OPERATIONS, record, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { planNodeType } from '../../ui-shot-plan/src/client/index.ts'
import { CanvasView } from '../src/client/CanvasView.tsx'
import type { CanvasFocus, CanvasViewProps } from '../src/client/CanvasView.tsx'
import { createDvCanvas } from '../src/client/dv-canvas.ts'
import { NODE_WIDTH } from '../src/client/graph.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import type { CanvasTranslate } from '../src/client/NodeCard.tsx'
import { zh } from '../src/client/locales.ts'
import { mountCanvasFrame } from './media-runtime.client.tsx'

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

/** The layout that the server stores for p1 unless a test gives another: g1 at (10, 20) and the viewport at 100%. */
const STORED_LAYOUT: CanvasLayout = { positions: { g1: { x: 10, y: 20 } }, viewport: { x: 0, y: 0, zoom: 1 } }

/** What the scripted server serves, holds back and refuses. */
interface ServerOptions {
  /** Changes to the fixture state, applied to every state the route serves. */
  edit?: (state: FixtureState) => void
  /** The operation declarations the route serves; the fixture's by default. */
  operations?: WireOperation[]
  /** The stored layout of p1, {@link STORED_LAYOUT} by default; any other project has none stored. */
  layout?: CanvasLayout
  /** Leave every `GET /api/dv/layout` unanswered until `releaseLayout` answers its project. */
  holdLayout?: boolean
  /** Leave `POST /api/dv/operation` unanswered, as a render is until it ends, until `releaseOperations`. */
  holdOperations?: boolean
  /** The routes whose reads fail with HTTP 503. */
  failReads?: readonly string[]
  /** The error that the server answers a write with, by path and body; null accepts the write. */
  refuse?: (path: string, body: unknown) => string | null
}

/** One `POST /api/dv/layout` body: the project, the positions to store, and the viewport of a save after a gesture. */
interface LayoutWrite {
  project: string
  positions: Record<string, NodePosition>
  viewport?: CanvasViewport
}

/** A stand-in `/dv/events` stream that carries what the server announces; it never sends `ready`, so the client also polls. */
class ScriptedEventSource extends EventTarget {
  static readonly open = new Set<ScriptedEventSource>()

  constructor() {
    super()
    ScriptedEventSource.open.add(this)
  }

  close(): void {
    ScriptedEventSource.open.delete(this)
  }
}

/**
 * A scripted `/api/dv` server: the fixture state with the `test_ref` noun, the layout route, file imports, and the
 * global `EventSource` that announces project changes.
 * @param options - the state edits and operations, the stored layout, and what the server holds back, fails and refuses.
 * @returns the client and the fetch over the server, the recorded writes, layout writes and imports, and the controls
 *   that announce a change and answer held requests.
 */
function serveCanvas(options: ServerOptions = {}) {
  const scripted = scriptedFetch({
    state: () => {
      const state = withTestRef(fixtureState())
      options.edit?.(state)
      return state
    },
    operations: options.operations ?? OPERATIONS,
  })
  const layoutWrites: LayoutWrite[] = []
  const imports: Array<{ name: string | null; mime: string | null; surface: string | null; session: string | null }> = []
  const heldLayouts: Array<{ project: string; answer: () => void }> = []
  const heldOperations: Array<() => void> = []
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
  /** Answer one request: a held, failed or refused one as the options say, the layout and import routes here, the rest by the fixture. */
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://host')
    const writing = init?.method === 'POST'
    const body: unknown = writing && typeof init.body === 'string' ? JSON.parse(init.body) : null
    const refusal = writing ? options.refuse?.(url.pathname, body) ?? null : null
    if (!writing && options.failReads?.includes(url.pathname) === true) return Promise.resolve(json({ error: 'unavailable' }, 503))
    if (url.pathname === '/api/dv/layout') {
      const project = writing ? (body as LayoutWrite).project : url.searchParams.get('project') ?? ''
      const stored = project === 'p1' ? options.layout ?? STORED_LAYOUT : { positions: {}, viewport: null }
      if (writing) layoutWrites.push(body as LayoutWrite)
      if (refusal !== null) return Promise.resolve(json({ error: refusal }, 500))
      if (writing || options.holdLayout !== true) return Promise.resolve(json(stored))
      return new Promise<Response>((resolve) => { heldLayouts.push({ project, answer: () => { resolve(json(stored)) } }) })
    }
    if (url.pathname === '/api/dv/assets/import') {
      const query = url.searchParams
      imports.push({ name: query.get('name'), mime: query.get('mime'), surface: query.get('surface'), session: query.get('session') })
      return Promise.resolve(json({ asset: query.get('name'), record: record({ id: `imp${String(imports.length)}`, operation: 'asset.import' }) }))
    }
    const answer = scripted.fetch(input, init)
    const response = refusal === null ? answer : Promise.resolve(json({ error: refusal }, 500))
    if (options.holdOperations !== true || url.pathname !== '/api/dv/operation') return response
    return new Promise<Response>((resolve) => { heldOperations.push(() => { resolve(response) }) })
  }
  vi.stubGlobal('EventSource', ScriptedEventSource)
  return {
    client: new DvClient(fetchImpl), fetch: fetchImpl, writes: scripted.writes, layoutWrites, imports,
    notify: () => { for (const source of ScriptedEventSource.open) source.dispatchEvent(new MessageEvent('record', { data: 'null' })) },
    releaseLayout: (project: string) => { for (const held of heldLayouts.filter(each => each.project === project)) held.answer() },
    releaseOperations: () => { for (const answer of heldOperations.splice(0)) answer() },
  }
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

/** What the host passes the canvas, beyond the project, the client and the chat session. */
interface HostOptions {
  /** Whether the host passes the Chinese translate; true by default. */
  withTranslate?: boolean
  /** The `dvCanvas` registries the view reads; the descriptors of `test_ref` and the node type of plans by default. */
  canvas?: DvCanvas
  /** The record whose node the view opens; none by default. */
  focus?: CanvasFocus | null
}

/**
 * Mount the canvas of p1 beside chat session s5 over a scripted server.
 * @param options - what the server serves, holds back and refuses, and what the host passes.
 * @returns the rendered view, the server, the recorded writes and layout writes, a node lookup, a node click that opens
 *   its editor, and a rerender with changed props.
 */
function mountCanvas(options: ServerOptions & HostOptions = {}) {
  const server = serveCanvas(options)
  const t: CanvasTranslate = makeTranslate(zh)
  let props: CanvasViewProps = {
    projectId: 'p1', client: server.client, session: 's5', ...options.withTranslate === false ? {} : { t },
    canvas: options.canvas ?? planCanvas(refCanvas().canvas), focus: options.focus ?? null,
  }
  const view = render(<CanvasView {...props} />)
  const node = nodeLookup(view)
  const open = async (id: string): Promise<HTMLElement> => {
    await waitFor(() => { node(id) })
    fireEvent.pointerDown(node(id), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    return view.findByTestId('dv-canvas-node-editor')
  }
  const rerender = (change: Partial<CanvasViewProps>): void => {
    props = { ...props, ...change }
    view.rerender(<CanvasView {...props} />)
  }
  return { view, server, writes: server.writes, layoutWrites: server.layoutWrites, node, open, rerender }
}

/**
 * {@link mountCanvas} with positional options.
 * @param withTranslate - whether the host passes the Chinese translate.
 * @param edit - changes to the fixture state, applied to every state the route serves.
 * @param holdOperations - whether `POST /api/dv/operation` stays unanswered, as a render does until it ends.
 * @param operations - the operation declarations the route serves; the fixture's by default.
 * @param canvas - the `dvCanvas` registries the view reads; the descriptors of `test_ref` and the node type of plans by
 *   default.
 * @param focus - the record whose node the view opens; none by default.
 * @returns what {@link mountCanvas} returns.
 */
function mount(
  withTranslate = true, edit: (state: FixtureState) => void = () => undefined, holdOperations = false, operations = OPERATIONS,
  canvas: DvCanvas = planCanvas(refCanvas().canvas), focus: CanvasFocus | null = null,
) {
  return mountCanvas({ withTranslate, edit, holdOperations, operations, canvas, focus })
}

/**
 * Mount the canvas of p1 beside chat session s5 under the real slot runtime, in a frame that declares the slots of its
 * editors as the canvas center view does and hands the canvas the `dv.media` renderer and the `dvMedia` preview, with
 * the real media and asset pool plugins mounted.
 * @param options - what the server serves; the canvas reads the descriptors of `test_ref`.
 * @returns the runtime, the rendered view, the recorded writes, and a node lookup.
 */
async function mountWithMedia(options: ServerOptions = {}) {
  const { client, writes } = serveCanvas(options)
  const t: CanvasTranslate = makeTranslate(zh)
  const canvas = refCanvas().canvas
  const runtime = await SlotTestRuntime.create()
  await mountCanvasFrame(runtime, ({ renderSlot, renderFactorySlot, preview }) => (
    <CanvasView
      projectId="p1" client={client} session="s5" t={t} canvas={canvas} renderSlot={renderSlot} renderFactorySlot={renderFactorySlot}
      preview={preview}
    />
  ))
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
    const { view, node, server, open } = mount(true, (state) => {
      if (!started) return
      state.components.proj.records.push(record({
        id: 'n1', operation: 'shot.render', deterministic: false, based_on: 'g1', params: { prompt: 'hero runs' }, status: 'running',
      }))
    }, true)
    await open('g1')
    fireEvent.click(view.getByText(zh['editor.renderTake']))
    const button = view.getByRole('button', { name: zh['node.rendering'] })
    expect(button.hasAttribute('disabled')).toBe(true)
    // A project change without the new take keeps the editor waiting.
    server.notify()
    await settle()
    expect(view.getByRole('button', { name: zh['node.rendering'] }).hasAttribute('disabled')).toBe(true)
    // The host wrote the pending record; the state refetch after the next project change shows its node.
    started = true
    server.notify()
    await waitFor(() => { expect(node('n1').getAttribute('data-node-selected')).toBe('true') })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    expect(node('g1').getAttribute('data-node-selected')).toBeNull()
    // An editor opened after the reveal stays open when the request ends.
    await open('g2')
    server.releaseOperations()
    await settle()
    expect(view.getByTestId('dv-canvas-node-editor').getAttribute('aria-label')).toBe(node('g2').getAttribute('aria-label'))
  })

  it('draws a record of a generation operation from the served declarations as a take titled by the operation label', async () => {
    const lang = document.documentElement.lang
    document.documentElement.lang = 'zh-CN'
    try {
      const generate: WireOperation = {
        name: 'image.generate', version: '1', description: 'One image.', inputs: {}, params: {}, outputs: [{ role: 'image', type: 'image' }],
        deterministic: false, resource: 'gpu', confirm: 'never', label: { zh: '生成图像', en: 'Generate image' },
      }
      const { runtime, node } = await mountWithMedia({
        edit: (state) => {
          state.components.proj.records.push(record({ id: 'i1', operation: 'image.generate', deterministic: false, outputs: ['cat.png'] }))
          state.assets.push(asset('cat.png', 'image/png', 'i1'))
          state.components.proj.created_by['cat.png'] = 'i1'
        },
        operations: [...OPERATIONS, generate],
      })
      await waitFor(() => { node('i1') })
      expect(node('i1').getAttribute('data-node-type')).toBe('take')
      expect(node('i1').getAttribute('aria-label')).toBe('生成图像')
      expect(node('i1').querySelector('img')?.getAttribute('src')).toBe(assetUrl('cat.png'))
      await runtime.dispose()
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
    const { runtime, node } = await mountWithMedia({
      edit: (state) => {
        state.assets.push(...references.slice(1).map(id => asset(id, 'image/png', 'u1')))
        const hero = state.components.test_ref?.['hero']?.[0]
        if (hero !== undefined) hero.references = references
      },
    })
    await waitFor(() => { node('test_ref:hero') })
    const card = node('test_ref:hero')
    expect([...card.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([assetUrl('ref.png')])
    // The card carries the label of the node type of `test_ref`.
    expect(card.textContent).toContain('参考')
    expect(card.textContent).toContain('Hero')
    expect(card.textContent).toContain('+5')
    await runtime.dispose()
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
    const { runtime, node } = await mountWithMedia({
      edit: (state) => {
        const hero = state.components.test_ref?.['hero']?.[0]
        if (hero !== undefined) hero.references = ['shot1.mp4', 'ref.png']
      },
    })
    await waitFor(() => { node('test_ref:hero') })
    expect([...node('test_ref:hero').querySelectorAll('video')].map(video => video.getAttribute('src'))).toEqual([`${assetUrl('shot1.mp4')}#t=0.1`])
    expect(node('test_ref:hero').textContent).toContain('+1')
    await runtime.dispose()
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
    const { runtime, view, node, writes } = await mountWithMedia({
      edit: (state) => {
        state.components.test_ref = {
          ...state.components.test_ref,
          villain: [{ id: 'villain', version: 2, name: 'Villain', description: '', references: [], created_by: 'e1' }],
          ghost: [],
          studio: [{ id: 'studio', version: 1, name: '', description: '', references: ['plan.json'], created_by: 'e1' }],
        }

        state.assets.push(asset('plan.json', 'application/json', null))
      },
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
    const studio = within(picker).getByText('studio').closest('button')
    if (studio === null) throw new Error('no studio tile')
    expect(studio.closest('section')?.querySelector('h3')?.textContent).toBe('参考')
    // A tile draws its item's first asset as a thumbnail: a media type without a view shows only its MIME type there.
    expect(studio.querySelector('[data-dv-media="file"]')?.textContent).toBe('application/json')
    fireEvent.click(studio)
    fireEvent.click(studio)
    expect(studio.getAttribute('aria-pressed')).toBe('false')
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
    // The chip opens the `dvMedia` preview of its asset, growing out of the chip.
    const opened = vi.spyOn(runtime.ctx.dvMedia, 'preview')
    const chip = view.getByRole('button', { name: '查看 shot1.mp4' })
    fireEvent.click(chip)
    expect(opened.mock.calls).toEqual([['p1', expect.objectContaining({ id: 'shot1.mp4' }), chip]])
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
    // A press beside the stacked panel and its close button each close the stacked editor only.
    const openHero = (): HTMLElement => {
      fireEvent.click(within(editor).getByRole('button', { name: '查看 Hero' }))
      const stacked = view.getAllByTestId('dv-canvas-node-editor')[1]
      if (stacked === undefined) throw new Error('no stacked editor')
      return stacked
    }
    const beside = openHero().parentElement
    if (beside === null) throw new Error('no stacked editor cover')
    fireEvent.pointerDown(beside, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    expect(view.getAllByTestId('dv-canvas-node-editor')).toHaveLength(1)
    fireEvent.click(within(openHero()).getByRole('button', { name: zh['editor.close'] }))
    const panels = view.getAllByTestId('dv-canvas-node-editor')
    expect(panels.map(panel => panel.getAttribute('aria-label'))).toEqual([editor.getAttribute('aria-label')])
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
    const retry = within(node('g1')).getByRole('button', { name: zh['node.retry'] })
    // A press on 重试 neither selects its take nor opens its editor.
    fireEvent.pointerDown(retry, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBeNull()
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    fireEvent.click(retry)
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({
      project: 'p1', operation: 'shot.render', surface: 'canvas', based_on: 'g1', session: 's5',
      params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero walks through the rain at night in the city' }, inputs: [{ role: 'reference', ref: 'hero@1' }],
    })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    expect((await view.findByTestId('dv-canvas-node-editor')).textContent).toContain('GPU out of memory')
  })

  it('opens the record that the focus names; empty-canvas clicks and Escape close the editor', async () => {
    const { view, node } = mount(true, undefined, false, OPERATIONS, undefined, { record: 'g2', take: () => {} })
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

  it('opens the plan node for a focus on the record that wrote an earlier plan version', async () => {
    const { view, node } = mount(true, (state) => {
      const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
      if (v1 === undefined) throw new Error('fixture lacks plan p1')
      state.components.plan.plans['p1' as PlanId] = [v1, { ...v1, version: 2, created_by: 'q2' as RecordId }]
    }, false, OPERATIONS, undefined, { record: 'p1', take: () => {} })
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

/** Wait past the 150 ms debounce of the state refetch that a project change starts, so answered requests settle. */
const settle = (): Promise<void> => act(() => new Promise<void>((resolve) => { setTimeout(resolve, 200) }))

/**
 * @param assetId - the asset of the tile.
 * @returns the data of a drag of a 素材 tile of the asset pool panel.
 */
const tileDrag = (assetId: string) => ({ types: [DV_ASSET_DRAG_TYPE], getData: (type: string) => type === DV_ASSET_DRAG_TYPE ? assetId : '', files: [] })

/**
 * Drop on the canvas at (500, 300); jsdom's drop event carries no pointer coordinates, so they are set on the event.
 * @param canvas - the canvas surface.
 * @param dataTransfer - the dropped data.
 */
function dropAt(canvas: HTMLElement, dataTransfer: object): void {
  const drop = createEvent.drop(canvas, { dataTransfer })
  Object.defineProperties(drop, { clientX: { value: 500 }, clientY: { value: 300 } })
  fireEvent(canvas, drop)
}

/**
 * @param operation - the refused operation.
 * @param error - the error that the server answers.
 * @returns a write refusal of every request of that operation.
 */
const refuseOperation = (operation: string, error: string) => (path: string, body: unknown): string | null => {
  const named = typeof body === 'object' && body !== null && 'operation' in body && body.operation === operation
  return path === '/api/dv/operation' && named ? error : null
}

/** A failed g1 whose render ran out of GPU memory. */
const failG1 = (state: FixtureState): void => {
  state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
    ? { ...entry, status: 'failed' as const, outputs: [], error: { code: 'operation_failed', message: 'GPU out of memory' } }
    : entry)
}

function viewportOf(canvas: HTMLElement): CanvasViewport {
  const layer = canvas.querySelector('div[style*="transform"]')
  if (!(layer instanceof HTMLElement)) throw new Error('no node layer')
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/u.exec(layer.style.transform)
  if (match === null) throw new Error(`unexpected transform ${layer.style.transform}`)
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) }
}

/**
 * The cards that do not show whole inside a view of the given size: a card is its width and the 180-unit height that a
 * fit leaves for it.
 * @param canvas - the canvas surface.
 * @param width - the view width in px.
 * @param height - the view height in px.
 * @returns the IDs of those cards.
 */
function cardsOutside(canvas: HTMLElement, width: number, height: number): string[] {
  const { x, y, zoom } = viewportOf(canvas)
  return [...canvas.querySelectorAll<HTMLElement>('[data-node-id]')].filter((card) => {
    const left = x + parseFloat(card.style.left) * zoom
    const top = y + parseFloat(card.style.top) * zoom
    return left < 0 || top < 0 || left + NODE_WIDTH * zoom > width || top + 180 * zoom > height
  }).map(card => card.getAttribute('data-node-id') ?? '')
}

/**
 * Make every element report a layout box of the given size, as a laid-out canvas does.
 * @param width - the width in px.
 * @param height - the height in px.
 */
const mockCanvasSize = (width: number, height: number): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, height))
}

/**
 * Replace `ResizeObserver` with observers that report a resize only when the test says so.
 * @returns a call that reports a resize to every observer.
 */
function stubResizeObservers(): () => void {
  const callbacks: Array<() => void> = []
  vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { callbacks.push(() => { callback([], this) }) }
    observe(): void { /* The test reports resizes itself. */ }
    unobserve(): void { /* Nothing to stop. */ }
    disconnect(): void { /* Nothing to stop. */ }
  })
  return () => { act(() => { for (const callback of callbacks) callback() }) }
}

describe('the viewport', () => {
  it('fits every node into view when no viewport is stored, refits on a resize until the user zooms, and 适应 fits again', async () => {
    const resize = stubResizeObservers()
    mockCanvasSize(1000, 700)
    const { view, layoutWrites } = mountCanvas({ layout: { positions: {}, viewport: null } })
    // The fit runs once the layout is read, as the free spots of the nodes are stored.
    await waitFor(() => { expect(layoutWrites).toHaveLength(1) })
    const canvas = view.getByTestId('dv-canvas-view')
    expect(cardsOutside(canvas, 1000, 700)).toEqual([])
    expect(viewportOf(canvas).zoom).toBeLessThanOrEqual(1)
    mockCanvasSize(500, 300)
    resize()
    expect(cardsOutside(canvas, 500, 300)).toEqual([])
    act(() => { canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })) })
    const zoomed = viewportOf(canvas)
    mockCanvasSize(1000, 700)
    resize()
    expect(viewportOf(canvas)).toEqual(zoomed)
    fireEvent.click(within(canvas).getByRole('button', { name: zh['canvas.fit'] }))
    expect(cardsOutside(canvas, 1000, 700)).toEqual([])
  })

  it('pans on a drag of empty canvas with the grabbing cursor and stores the viewport; a jitter under 4 px is a click', async () => {
    const { view, node, open, layoutWrites } = mountCanvas()
    await open('g1')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    const canvas = view.getByTestId('dv-canvas-view')
    fireEvent.pointerDown(canvas, { button: 0, clientX: 700, clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 701, clientY: 501, pointerId: 1 })
    expect(viewportOf(canvas)).toEqual({ x: 0, y: 0, zoom: 1 })
    fireEvent.pointerMove(canvas, { clientX: 730, clientY: 520, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 760, clientY: 540, pointerId: 1 })
    expect(viewportOf(canvas)).toEqual({ x: 60, y: 40, zoom: 1 })
    expect(canvas.style.cursor).toBe('grabbing')
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    const panned = { project: 'p1', positions: {}, viewport: { x: 60, y: 40, zoom: 1 } }
    await waitFor(() => { expect(layoutWrites).toContainEqual(panned) }, { timeout: 2000 })
  })

  it('ignores presses of other buttons than the primary one on empty canvas and on a node', async () => {
    const { view, node, open } = mountCanvas()
    await open('g1')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    const canvas = view.getByTestId('dv-canvas-view')
    fireEvent.pointerDown(canvas, { button: 2, clientX: 700, clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    fireEvent.pointerDown(node('g2'), { button: 2, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
  })

  it('放大 and 缩小 zoom around the canvas center and store the viewport once; a press on the zoom bar keeps the selection', async () => {
    const { view, node, open, layoutWrites } = mountCanvas()
    await open('g1')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    const canvas = view.getByTestId('dv-canvas-view')
    const zoomBar = within(canvas).getByRole('toolbar', { name: zh['canvas.zoom'] })
    fireEvent.pointerDown(zoomBar, { button: 0, clientX: 30, clientY: 580, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    await waitFor(() => { expect(layoutWrites).toHaveLength(1) })
    // jsdom lays out nothing, so the canvas counts as 800 × 600 and zooms around (400, 300).
    fireEvent.click(within(zoomBar).getByRole('button', { name: zh['canvas.zoomIn'] }))
    expect(viewportOf(canvas)).toEqual({ x: -80, y: -60, zoom: 1.2 })
    expect(zoomBar.textContent).toContain('120%')
    fireEvent.click(within(zoomBar).getByRole('button', { name: zh['canvas.zoomOut'] }))
    expect(zoomBar.textContent).toContain('100%')
    await waitFor(() => { expect(layoutWrites).toHaveLength(2) }, { timeout: 2000 })
    const { x, y, zoom } = layoutWrites[1]?.viewport ?? { x: NaN, y: NaN, zoom: NaN }
    expect([x, y, zoom].map(value => Math.round(value * 1000) / 1000)).toEqual([0, 0, 1])
    await settle()
    expect(layoutWrites).toHaveLength(2)
  })

  it('适应 keeps the zoom of a canvas without nodes', async () => {
    const { view } = mountCanvas({ canvas: createDvCanvas(), edit: (state) => { state.components.proj.records = [] } })
    const canvas = view.getByTestId('dv-canvas-view')
    await waitFor(() => { expect(canvas.textContent).toContain(zh['canvas.empty']) })
    fireEvent.click(within(canvas).getByRole('button', { name: zh['canvas.fit'] }))
    expect(canvas.textContent).toContain('100%')
  })

  it('shows the error of a project whose state fails to load, and 适应 keeps its zoom', async () => {
    const { view } = mountCanvas({ failReads: ['/api/dv/state'] })
    const canvas = view.getByTestId('dv-canvas-view')
    await waitFor(() => { expect(canvas.textContent).toContain('失败：unavailable') })
    fireEvent.click(within(canvas).getByRole('button', { name: zh['canvas.fit'] }))
    expect(canvas.textContent).toContain('100%')
  })

  it('leaves the canvas working when the server refuses to store the layout', async () => {
    const { view, node, layoutWrites } = mountCanvas({ refuse: path => path === '/api/dv/layout' ? 'read-only' : null })
    await waitFor(() => { node('g3') })
    await waitFor(() => { expect(layoutWrites).toHaveLength(1) })
    act(() => { view.getByTestId('dv-canvas-view').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })) })
    await waitFor(() => { expect(layoutWrites).toHaveLength(2) }, { timeout: 2000 })
    await settle()
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('ignores the layout of a project that the view left before the layout arrived, and stores none of its drags under the next project', async () => {
    const { view, node, server, layoutWrites, rerender } = mountCanvas({
      holdLayout: true, layout: { positions: {}, viewport: { x: 0, y: 0, zoom: 0.5 } },
    })
    await waitFor(() => { node('g1') })
    const canvas = view.getByTestId('dv-canvas-view')
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    rerender({ projectId: 'p2' })
    server.releaseLayout('p1')
    await settle()
    const zoomBar = within(canvas).getByRole('toolbar', { name: zh['canvas.zoom'] })
    expect(zoomBar.textContent).toContain('100%')
    server.releaseLayout('p2')
    await settle()
    fireEvent.click(within(zoomBar).getByRole('button', { name: zh['canvas.zoomIn'] }))
    await waitFor(() => { expect(layoutWrites.filter(write => write.project === 'p2')).toHaveLength(1) }, { timeout: 2000 })
    expect(layoutWrites.find(write => write.project === 'p2')?.positions).toEqual({})
  })
})

describe('the opened takes in storage', () => {
  it('reads stored text that is not JSON as none stored, so every finished take counts as opened', async () => {
    window.localStorage.setItem('dv-canvas-seen:p1', 'not json')
    const { view, node } = mountCanvas()
    await waitFor(() => { node('g2') })
    expect(view.container.querySelectorAll('[data-node-unseen]')).toHaveLength(0)
    expect(JSON.parse(window.localStorage.getItem('dv-canvas-seen:p1') ?? 'null')).toEqual(['g1', 'g2'])
  })

  it('reads stored JSON that is not a list as no take opened, so every finished take shows the accent dot', async () => {
    window.localStorage.setItem('dv-canvas-seen:p1', '{"g1":true}')
    const { node } = mountCanvas()
    await waitFor(() => { expect(node('g2').getAttribute('data-node-unseen')).toBe('true') })
    expect(node('g1').getAttribute('data-node-unseen')).toBe('true')
    expect(window.localStorage.getItem('dv-canvas-seen:p1')).toBe('[]')
  })
})

describe('the focus', () => {
  it('opens the node of a record\'s first output, opens nothing for a record without a node, and takes each focus once loaded', async () => {
    const taken: string[] = []
    const focusOn = (record: string): CanvasFocus => ({ record, take: () => { taken.push(record) } })
    const { view, node, layoutWrites, rerender } = mountCanvas({ focus: focusOn('s1') })
    // The stored free spots show that the layout and the graph are loaded, so the focus has been read.
    await waitFor(() => { expect(layoutWrites).toHaveLength(1) })
    expect([view.queryByTestId('dv-canvas-node-editor'), taken]).toEqual([null, ['s1']])
    // The still x1 grabbed from the export of g2's video is drawn by g2.
    const still = focusOn('x1')
    rerender({ focus: still })
    expect((await view.findByTestId('dv-canvas-node-editor')).getAttribute('aria-label')).toBe(node('g2').getAttribute('aria-label'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    rerender({ focus: still })
    expect([view.queryByTestId('dv-canvas-node-editor'), taken]).toEqual([null, ['s1', 'x1']])
    rerender({ focus: focusOn('x1') })
    expect((await view.findByTestId('dv-canvas-node-editor')).getAttribute('aria-label')).toBe(node('g2').getAttribute('aria-label'))
  })
})

describe('drags and drops', () => {
  it('accepts and outlines a drag of files, keeps the outline over a node, clears it on leaving, and ignores a text drag', async () => {
    const { view, node, server } = mountCanvas()
    await waitFor(() => { node('g1') })
    const canvas = view.getByTestId('dv-canvas-view')
    const files = { types: ['Files'], dropEffect: 'none' }
    expect(fireEvent.dragEnter(canvas, { dataTransfer: files })).toBe(false)
    expect(fireEvent.dragOver(canvas, { dataTransfer: files })).toBe(false)
    expect(files.dropEffect).toBe('copy')
    expect(canvas.style.boxShadow).toBe('inset 0 0 0 2px var(--dv-accent)')
    fireEvent.dragLeave(node('g1'), { dataTransfer: files })
    expect(canvas.style.boxShadow).toBe('inset 0 0 0 2px var(--dv-accent)')
    fireEvent.dragLeave(canvas, { dataTransfer: files })
    expect(canvas.style.boxShadow).toBe('none')
    const text = { types: ['text/plain'], getData: () => 'hello', files: [] }
    expect(fireEvent.dragEnter(canvas, { dataTransfer: text })).toBe(true)
    expect(fireEvent.dragOver(canvas, { dataTransfer: text })).toBe(true)
    expect(canvas.style.boxShadow).toBe('none')
    dropAt(canvas, text)
    await settle()
    expect(server.writes.filter(write => write.path === '/api/dv/operation')).toEqual([])
    expect(server.imports).toEqual([])
  })

  it('moves the node of a dropped 素材 tile that the canvas already draws under the pointer, and writes no placement', async () => {
    const { view, node, server } = mountCanvas()
    await waitFor(() => { node('g1') })
    // g1 draws shot1.mp4, its video.
    dropAt(view.getByTestId('dv-canvas-view'), tileDrag('shot1.mp4'))
    expect(node('g1').style.left).toBe(`${String(500 - NODE_WIDTH / 2)}px`)
    await settle()
    expect(server.writes.filter(write => write.path === '/api/dv/operation')).toEqual([])
  })

  it('imports dropped image and video files and places each node at its drop spot once it appears; another file shows a notice', async () => {
    let imported = false
    const { view, node, server } = mountCanvas({
      edit: (state) => {
        if (!imported) return
        for (const [id, name, mime] of [['imp1', 'still.png', 'image/png'], ['imp2', 'clip.mp4', 'video/mp4']] as const) {
          state.assets.push(asset(name, mime, id))
          state.components.proj.records.push(record({ id, operation: 'asset.import', params: { name }, outputs: [name], surface: 'canvas' }))
          state.components.proj.created_by[name] = id
          state.components.asset.placed.push(name)
        }
      },
    })
    await waitFor(() => { node('g1') })
    const files = [
      new File(['x'], 'still.png', { type: 'image/png' }), new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    ]
    dropAt(view.getByTestId('dv-canvas-view'), { types: ['Files'], getData: () => '', files })
    expect((await view.findByRole('alert')).textContent).toBe('「notes.txt」不是图片或视频，画布只接受图片和视频。')
    await waitFor(() => {
      expect(server.imports).toEqual([
        { name: 'still.png', mime: 'image/png', surface: 'canvas', session: 's5' },
        { name: 'clip.mp4', mime: 'video/mp4', surface: 'canvas', session: 's5' },
      ])
    })
    // A project change before the imports show keeps their drop spots.
    server.notify()
    await settle()
    expect(view.container.querySelector('[data-node-id="imp1"]')).toBeNull()
    imported = true
    server.notify()
    await waitFor(() => { expect(node('imp2').style.left).toBe(`${String(500 - NODE_WIDTH / 2 + 32)}px`) })
    expect([node('imp1').style.left, node('imp1').style.top]).toEqual([`${String(500 - NODE_WIDTH / 2)}px`, '260px'])
    expect(node('imp2').style.top).toBe('292px')
  })

  it('takes a dropped 素材 tile\'s node back off the canvas when the server refuses the placement, and shows the error', async () => {
    const { view, node } = mountCanvas({
      refuse: refuseOperation('asset.place', 'no room'),
      edit: (state) => {
        state.assets.push(asset('pool.png', 'image/png', 'u2'))
        state.components.proj.records.push(record({
          id: 'u2', operation: 'asset.import', params: { name: 'pool.png' }, outputs: ['pool.png'], surface: 'asset_pool',
        }))
        state.components.proj.created_by['pool.png'] = 'u2'
      },
    })
    await waitFor(() => { node('g1') })
    dropAt(view.getByTestId('dv-canvas-view'), tileDrag('pool.png'))
    expect((await view.findByRole('alert')).textContent).toBe('失败：no room')
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull() })
  })
})

describe('writes and failures', () => {
  it('draws the canvas and opens an editor while the operation declarations and the task labels fail to load', async () => {
    const { node, open } = mountCanvas({ failReads: ['/api/dv/operations', '/api/dv/tasks'] })
    const editor = await open('g1')
    expect(editor.getAttribute('aria-label')).toBe(node('g1').getAttribute('aria-label'))
  })

  it('shows the error of a refused 重试 and offers 重试 again', async () => {
    const { view, node } = mountCanvas({ edit: failG1, refuse: refuseOperation('shot.render', 'GPU busy') })
    await waitFor(() => { node('g1') })
    fireEvent.click(within(node('g1')).getByRole('button', { name: zh['node.retry'] }))
    expect((await view.findByRole('alert')).textContent).toBe('失败：GPU busy')
    await waitFor(() => { expect(within(node('g1')).getByRole('button', { name: zh['node.retry'] }).hasAttribute('disabled')).toBe(false) })
  })

  it('shows the error of a render that fails after its new take appeared', async () => {
    let started = false
    const { view, node, open, server } = mountCanvas({
      holdOperations: true, refuse: refuseOperation('shot.render', 'lost connection'),
      edit: (state) => {
        if (started) state.components.proj.records.push(record({ id: 'n1', operation: 'shot.render', deterministic: false, based_on: 'g1', status: 'running' }))
      },
    })
    const editor = await open('g1')
    fireEvent.click(within(editor).getByRole('button', { name: zh['editor.renderTake'] }))
    started = true
    server.notify()
    await waitFor(() => { expect(node('n1').getAttribute('data-node-selected')).toBe('true') })
    server.releaseOperations()
    expect((await view.findByRole('alert')).textContent).toBe('失败：lost connection')
  })

  it('writes nothing for 重试 on a failed take whose record names no operation', async () => {
    const { node, writes } = mountCanvas({
      edit: (state) => {
        state.components.proj.records.push(record({ id: 'm1', deterministic: false, status: 'failed', outputs: ['m1.mp4'] }))
        state.assets.push(asset('m1.mp4', 'video/mp4', 'm1'))
        state.components.proj.created_by['m1.mp4'] = 'm1'
      },
    })
    await waitFor(() => { node('m1') })
    fireEvent.click(within(node('m1')).getByRole('button', { name: zh['node.retry'] }))
    await settle()
    expect(writes.filter(write => write.path === '/api/dv/operation')).toEqual([])
    expect(within(node('m1')).getByRole('button', { name: zh['node.retry'] }).hasAttribute('disabled')).toBe(false)
  })

  it('reads the page\'s own API when the host passes no client, and writes without a chat session when it passes none', async () => {
    const server = serveCanvas({ edit: failG1 })
    vi.stubGlobal('fetch', server.fetch)
    const t: CanvasTranslate = makeTranslate(zh)
    const view = render(<CanvasView projectId="p1" t={t} />)
    const node = nodeLookup(view)
    await waitFor(() => { node('g1') })
    fireEvent.click(within(node('g1')).getByRole('button', { name: zh['node.retry'] }))
    await waitFor(() => { expect(server.writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    const retry = server.writes.find(write => write.path === '/api/dv/operation')?.body
    expect(retry).toMatchObject({ project: 'p1', operation: 'shot.render', based_on: 'g1' })
    expect(retry).not.toHaveProperty('session')
  })

  it('shows the reason of a request that fails with a value other than an Error', async () => {
    const server = serveCanvas()
    /** The server's fetch, except that every operation request fails with a bare string. */
    const offline: typeof fetch = async (input, init) => {
      if (input === '/api/dv/operation') throw 'offline'
      return server.fetch(input, init)
    }
    const t: CanvasTranslate = makeTranslate(zh)
    const view = render(<CanvasView projectId="p1" client={new DvClient(offline)} t={t} />)
    await waitFor(() => { nodeLookup(view)('g1') })
    dropAt(view.getByTestId('dv-canvas-view'), tileDrag('pool.png'))
    expect((await view.findByRole('alert')).textContent).toBe('失败：offline')
  })
})

/** A node type as a plugin's UI half registers it: an entry without a record or media, and one titled by its type. */
const PROPS: NodeType = {
  id: '@dv/ui-prop', type: 'prop', label: () => '道具', color: 'rgb(1, 2, 3)', column: 1,
  entries: () => [{ id: 'prop:p1', record: null, title: '红伞', media: [] }, { id: 'prop:p2', record: null, title: '道具', media: [] }],
}

/**
 * Make every element report a client size of 1200 × 800, which gives the editor panel the default rectangle 240, 80,
 * 720 × 640.
 */
function mockAreaSize(): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
}

/**
 * @param editor - an editor panel.
 * @returns its left, top, width and height in px.
 */
const boxOf = (editor: HTMLElement): number[] =>
  [editor.style.left, editor.style.top, editor.style.width, editor.style.height].map(value => parseFloat(value))

describe('the editor panel', () => {
  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '5'],
    ['null', 'null'],
    ['an object without a height', '{"x":0,"y":0,"width":800}'],
    ['an object with a number beyond the double range', '{"x":1e999,"y":0,"width":800,"height":600}'],
  ])('opens at the default rectangle when the remembered rectangle is %s', async (_name, stored) => {
    mockAreaSize()
    window.localStorage.setItem(EDITOR_RECT_KEY, stored)
    const { open } = mount()
    expect(boxOf(await open('g2'))).toEqual([240, 80, 720, 640])
  })

  it('keeps the panel on a release without a press, another pointer\'s release, a still press and another key; a straight drag moves it, and a double click on a button keeps it', async () => {
    mockAreaSize()
    const { view, open } = mount()
    const editor = await open('g2')
    const title = view.getByTestId('dv-canvas-editor-title-row')
    fireEvent.pointerUp(title, { clientX: 400, clientY: 400, pointerId: 2 })
    fireEvent.pointerDown(title, { button: 0, clientX: 300, clientY: 100, pointerId: 2 })
    fireEvent.pointerUp(title, { clientX: 400, clientY: 400, pointerId: 3 })
    fireEvent.pointerUp(title, { clientX: 300, clientY: 100, pointerId: 2 })
    expect(boxOf(editor)).toEqual([240, 80, 720, 640])
    expect(window.localStorage.getItem(EDITOR_RECT_KEY)).toBeNull()
    fireEvent.keyDown(view.getByRole('button', { name: zh['editor.resize'] }), { key: 'Enter' })
    expect(boxOf(editor)).toEqual([240, 80, 720, 640])
    // A drag straight down moves the panel down only.
    fireEvent.pointerDown(title, { button: 0, clientX: 300, clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(title, { clientX: 300, clientY: 140, pointerId: 2 })
    fireEvent.pointerUp(title, { clientX: 300, clientY: 140, pointerId: 2 })
    expect(boxOf(editor)).toEqual([240, 120, 720, 640])
    fireEvent.doubleClick(view.getByRole('button', { name: zh['editor.close'] }))
    expect(boxOf(editor)).toEqual([240, 120, 720, 640])
    expect(JSON.parse(window.localStorage.getItem(EDITOR_RECT_KEY) ?? 'null')).toEqual({ x: 240, y: 120, width: 720, height: 640 })
  })

  it('问 agent refers to a take and an imported asset by their records, a placed asset without a record as the asset, and an entry without a record by its node', async () => {
    const canvas = planCanvas(refCanvas().canvas)
    canvas.nodeTypes.register(PROPS)
    const { view, node, open } = mount(true, (state) => {
      state.assets.push(asset('pool.png', 'image/png', 'u2'), asset('undone.png', 'image/png', 'u9', null, 'asset.import'))
      state.components.proj.records.push(record({ id: 'u2', operation: 'asset.import', params: { name: 'pool.png' }, outputs: ['pool.png'], surface: 'asset_pool' }))
      state.components.proj.created_by['pool.png'] = 'u2'
      state.components.asset.placed = ['pool.png', 'undone.png']
    }, false, OPERATIONS, canvas)
    const composed: DvComposeDetail[] = []
    const listener = (event: Event): void => { composed.push((event as CustomEvent<DvComposeDetail>).detail) }
    window.addEventListener(DV_COMPOSE_EVENT, listener)
    try {
      for (const id of ['g1', 'u2', 'asset:undone.png', 'prop:p1']) {
        fireEvent.click(within(await open(id)).getByRole('button', { name: zh['editor.askAgent'] }))
        expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
      }
    } finally {
      window.removeEventListener(DV_COMPOSE_EVENT, listener)
    }
    const take = node('g1').getAttribute('aria-label') ?? ''
    expect(composed.map(detail => detail.refs)).toEqual([
      [{ kind: 'record', id: 'g1', label: take, assetId: 'shot1-last.png' }],
      [{ kind: 'record', id: 'u2', label: 'pool.png', assetId: 'pool.png' }],
      [{ kind: 'asset', id: 'undone.png', label: 'undone.png', assetId: 'undone.png' }],
      [{ kind: 'record', id: 'prop:p1', label: '红伞' }],
    ])
  })

  it('shows the type label once in the header of a node titled by its type', async () => {
    const canvas = planCanvas(refCanvas().canvas)
    canvas.nodeTypes.register(PROPS)
    const { open } = mount(true, undefined, false, OPERATIONS, canvas)
    const header = (await open('prop:p2')).querySelector('header')
    if (header === null) throw new Error('no editor header')
    expect(within(header).getAllByText('道具').map(element => element.tagName)).toEqual(['H2'])
  })
})

describe('the take editor', () => {
  it('renders a new take with a toggled checkbox param as true', async () => {
    const { view, writes, open } = mount()
    const editor = await open('g1')
    fireEvent.click(editor.querySelector('#dv-canvas-editor-loop') as HTMLInputElement)
    fireEvent.click(view.getByText(zh['editor.renderTake']))
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({ params: { loop: true } })
  })

  it('names a chip by its reference text when no item or asset matches and opens nothing from it, names an item without a name by its ID, and × takes a reference off', async () => {
    document.documentElement.lang = 'zh-CN'
    const canvas = planCanvas(refCanvas().canvas)
    // A version kind whose one item has no name and no asset.
    canvas.versionKinds.register({
      kind: 'prop', label: () => '道具', node: id => `prop:${id}`, latest: () => [{ id: 'p9', version: 1 }], name: () => null, assets: () => [],
    })
    const { view, writes, open } = mount(true, (state) => {
      state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
        ? { ...entry, inputs: [...entry.inputs, { role: 'reference', ref: { asset: 'gone.png' }, resolved_asset: 'gone.png' }] }
        : entry)
    }, false, OPERATIONS, canvas)
    const editor = await open('g1')
    fireEvent.click(within(editor).getByRole('button', { name: '查看 gone.png' }))
    expect(view.getAllByTestId('dv-canvas-node-editor')).toEqual([editor])
    expect(view.queryByRole('dialog', { name: 'gone.png' })).toBeNull()
    fireEvent.click(within(editor).getByText(zh['editor.addAsset']))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    fireEvent.click(within(picker).getByRole('button', { name: 'p9' }))
    fireEvent.click(view.getByText('确认（1）'))
    expect(within(editor).getByRole('button', { name: '查看 p9' })).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '移除 gone.png' }))
    expect(within(editor).queryByRole('button', { name: '查看 gone.png' })).toBeNull()
    fireEvent.click(view.getByText(zh['editor.renderTake']))
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'p9@1' }],
    })
  })

  it('shows why a new take does not start, a field that does not parse and then a refused request, and offers 渲染新版本 again', async () => {
    const { writes, open } = mountCanvas({ refuse: refuseOperation('shot.render', 'GPU busy') })
    const editor = await open('g1')
    const extra = editor.querySelector('#dv-canvas-editor-extra') as HTMLInputElement
    fireEvent.change(extra, { target: { value: '{' } })
    fireEvent.click(within(editor).getByRole('button', { name: zh['editor.renderTake'] }))
    expect(within(editor).getByRole('alert').textContent).toBe('失败：extra must be JSON.')
    expect(writes.filter(write => write.path === '/api/dv/operation')).toEqual([])
    fireEvent.change(extra, { target: { value: '' } })
    fireEvent.click(within(editor).getByRole('button', { name: zh['editor.renderTake'] }))
    await waitFor(() => { expect(within(editor).getByRole('alert').textContent).toBe('失败：GPU busy') })
    expect(within(editor).getByRole('button', { name: zh['editor.renderTake'] }).hasAttribute('disabled')).toBe(false)
  })

  it('renders a new take without a chat session when the host passes none', async () => {
    const server = serveCanvas()
    const t: CanvasTranslate = makeTranslate(zh)
    const view = render(<CanvasView projectId="p1" client={server.client} t={t} canvas={planCanvas(refCanvas().canvas)} />)
    const node = nodeLookup(view)
    await waitFor(() => { node('g1') })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    fireEvent.click(within(await view.findByTestId('dv-canvas-node-editor')).getByRole('button', { name: zh['editor.renderTake'] }))
    await waitFor(() => { expect(server.writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    const request = server.writes.find(write => write.path === '/api/dv/operation')?.body
    expect(request).toMatchObject({ project: 'p1', operation: 'shot.render', based_on: 'g1' })
    expect(request).not.toHaveProperty('session')
  })

  it('shows no failure reason for a failed take whose record carries no error', async () => {
    const { open } = mount(true, (state) => {
      state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1' ? { ...entry, status: 'failed' as const, outputs: [] } : entry)
    })
    const editor = await open('g1')
    expect(editor.querySelector('[role="note"]')).toBeNull()
  })

  it('shows an empty model and task, no params and no 渲染新版本 for a take whose record names no operation', async () => {
    const { view, open } = mount(true, (state) => {
      state.components.proj.records.push(record({ id: 'm1', deterministic: false, outputs: ['m1.mp4'] }))
      state.assets.push(asset('m1.mp4', 'video/mp4', 'm1'))
      state.components.proj.created_by['m1.mp4'] = 'm1'
    })
    const editor = await open('m1')
    expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe(' · ')
    expect(editor.querySelector('textarea, input, select')).toBeNull()
    expect(within(editor).queryByRole('button', { name: zh['editor.renderTake'] })).toBeNull()
  })
})

describe('the cards', () => {
  it('fades a superseded take', async () => {
    const { node } = mount(true, (state) => { state.components.proj.superseded = { ...state.components.proj.superseded, g2: 'g3' } })
    await waitFor(() => { node('g2') })
    expect([node('g1').style.opacity, node('g2').style.opacity]).toEqual(['1', '0.55'])
  })

  it.each([
    ['running', 'failed'],
    ['failed', 'running'],
  ] as const)('marks an entry whose record is %s, and an entry with slots whose record is %s, with the words and color of the state', async (hero, plan) => {
    const { node } = mount(true, (state) => {
      state.components.proj.records = state.components.proj.records.map((entry) => {
        if (entry.id === 'e1') return { ...entry, status: hero }
        return entry.id === 'p1' ? { ...entry, status: plan } : entry
      })
    })
    await waitFor(() => { node('plan:p1') })
    const marker = (id: string, status: 'running' | 'failed'): string =>
      within(node(id)).getByText(status === 'running' ? zh['node.running'] : zh['node.failed']).style.color
    const colorOf = (status: 'running' | 'failed'): string => status === 'running' ? 'var(--dv-text-2)' : 'var(--dv-danger)'
    expect([marker('test_ref:hero', hero), marker('plan:p1', plan)]).toEqual([colorOf(hero), colorOf(plan)])
  })

  it('shows the badge of an entry\'s media in a row under its card', async () => {
    const canvas = planCanvas(refCanvas().canvas)
    canvas.takesInUse.register({ id: 'clips', uses: () => [], badges: () => [{ asset: 'ref.png', label: '已裁剪' }] })
    const { node } = mount(true, undefined, false, OPERATIONS, canvas)
    await waitFor(() => { expect(within(node('test_ref:hero')).getByText('已裁剪')).toBeTruthy() })
  })
})
