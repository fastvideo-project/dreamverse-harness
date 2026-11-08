/**
 * Mounts `@dv/ui-canvas` and the real kind plugins that the bundle loads in a `SlotTestRuntime`, whose root frame
 * stands in for the shell's `dv.center.view`, right Sidebar tab body and `shell.overlay`, over a scripted `/api/dv`
 * server that replaces the global `fetch` and `EventSource`.
 */
import { vi } from 'vitest'
import { fireEvent, waitFor, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import type { NodeAction, NodeType, RecordsInUse } from '../src/client/contract/index.ts'
import type { OperationRequest, WireOperation, WireProject } from '@dv/ui-kit/types.ts'
import type { CanvasLayout, CanvasViewport } from '../src/canvas-layout.ts'
import { asset, canvasNode, fixtureState, OPERATIONS, PROJECT, record, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState, Recorded } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { composerStack } from '../../ui-composer/tests/composer-stack.client.ts'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { defineReferenceUi } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import { apply as shotRenderApply, inject as shotRenderInject } from '../../ui-shot-render/src/client/index.ts'
import { CANVAS_ID } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import type { CenterRequest } from '@dv/ui-shell/contract'

/** The reference noun `test_ref` of the fixture, declared as the UI package of a noun declares it. */
export const testRef = defineReferenceUi({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref, color: 'var(--dv-node-1)',
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

/** The kind plugins a canvas test can mount, each the real plugin that the bundle loads. */
export const KINDS = {
  reference: { inject: [...testRef.inject], apply: testRef.apply },
  assets: { inject: [...assetPoolInject], apply: assetPoolApply },
  takes: { inject: [...shotRenderInject], apply: shotRenderApply },
  media: { inject: [...mediaInject], apply: mediaApply },
  composer: composerStack,
} satisfies Record<string, Plugin>

/** A kind plugin by name. */
export type Kind = keyof typeof KINDS

/** Every kind plugin, in the order the bundle lists them. */
export const ALL_KINDS: readonly Kind[] = ['reference', 'assets', 'takes', 'media', 'composer']

/** What the scripted server serves. */
export interface ServerOptions {
  /** Changes to the fixture state, applied to every state the server serves. */
  edit?: (state: FixtureState) => void
  /** The stored layout of p1, by default the viewport at 100%; any other project has none stored. Null makes the layout read fail. */
  layout?: CanvasLayout | null
  /** Leave `GET /api/dv/canvas/layout` unanswered until {@link CanvasServer.releaseLayout} answers it. */
  holdLayout?: boolean
  /** Leave `POST /api/dv/operation` unanswered until {@link CanvasServer.releaseOperations} answers it. */
  holdOperations?: boolean
  /** The operation declarations; null makes `/api/dv/operations` fail. */
  operations?: WireOperation[] | null
  /** The projects that `/api/dv/projects` lists; the fixture project p1 by default. */
  projects?: WireProject[]
  /** The error that the server answers a JSON write with, by path and body; null accepts the write. */
  refuse?: (path: string, body: unknown) => string | null
}

/** One `POST /api/dv/canvas/layout` body. */
export interface LayoutWrite {
  project: string
  viewport: CanvasViewport
}

/** One file that `POST /api/dv/assets/import` received. */
export interface ImportRequest {
  project: string
  name: string
  mime: string
  surface: string
  session: string | null
}

/** The scripted server's records and its change announcement. */
export interface CanvasServer {
  /** Every JSON write, by path. */
  writes: Recorded[]
  layoutWrites: LayoutWrite[]
  imports: ImportRequest[]
  /** The params of every `canvas.node_position` request, in request order. */
  positionWrites: Array<Record<string, unknown>>
  /** Announce a project change on every open `/dv/events` stream. */
  notify: () => void
  /** Answer the held layout reads of one project. */
  releaseLayout: (project: string) => void
  /** Answer every held operation request. */
  releaseOperations: () => void
}

class ScriptedEventSource extends EventTarget {
  static readonly open = new Set<ScriptedEventSource>()

  constructor() {
    super()
    ScriptedEventSource.open.add(this)
    queueMicrotask(() => { this.dispatchEvent(new Event('ready')) })
  }

  close(): void {
    ScriptedEventSource.open.delete(this)
  }
}

/**
 * Apply an accepted canvas write to the canvas slice as the host's node list does: `canvas.node_position` sets the
 * fields its params give, `asset.place` adds an `asset` node per asset that no node shows, `canvas.node_remove` deletes
 * the nodes its params name.
 * @param state - the served state.
 * @param request - the accepted request.
 * @param index - the request's position among the accepted writes, for the IDs of placement nodes.
 */
function applyCanvasWrite(state: FixtureState, request: OperationRequest, index: number): void {
  const canvas = state.components.canvas
  const assets = (request.inputs ?? []).map(input => input.ref)
  if (request.operation === 'canvas.node_position') {
    const params = request.params ?? {}
    const node = canvas.nodes[String(params['node'])]
    if (node === undefined) return
    for (const field of ['x', 'y', 'width', 'height'] as const) {
      const value = params[field]
      if (typeof value === 'number') node.position = { ...node.position, [field]: value }
    }
  } else if (request.operation === 'asset.place') {
    const id = `place${String(index + 1)}`
    state.components.proj.records.push(record({ id, operation: 'asset.place', inputs: assets.map(ref => ({ role: 'asset', ref: { asset: ref }, resolved_asset: ref })) }))
    for (const [n, placed] of assets.filter(each => canvas.assets[each] === undefined).entries()) {
      const node = n === 0 ? id : `${id}.${String(n + 1)}`
      canvas.nodes[node] = canvasNode('asset', [id], 0, 0, { asset: placed })
      canvas.order.push(node)
      canvas.assets[placed] = node
    }
  } else if (request.operation === 'canvas.node_remove') {
    const removed = new Set(request.params?.['nodes'] as string[])
    canvas.nodes = Object.fromEntries(Object.entries(canvas.nodes).filter(([id]) => !removed.has(id)))
    canvas.assets = Object.fromEntries(Object.entries(canvas.assets).filter(([, id]) => !removed.has(id)))
    canvas.order = canvas.order.filter(each => !removed.has(each))
  }
}

/** The operations whose accepted writes change the served canvas slice. */
const CANVAS_WRITES = new Set(['canvas.node_position', 'asset.place', 'canvas.node_remove'])

/**
 * Replace the global `fetch` and `EventSource` with a server of the fixture project and its `test_ref` noun. An
 * imported file becomes an asset created by an `asset.import` record and shown by an `asset` node of that record. An
 * accepted canvas write changes the canvas slice of every later state and announces a project change.
 * @param options - what the server serves.
 * @returns the server's records and its change announcement.
 */
export function serveCanvas(options: ServerOptions = {}): CanvasServer {
  const imports: ImportRequest[] = []
  const accepted: OperationRequest[] = []
  const state = (): FixtureState => {
    const served = withTestRef(fixtureState())
    imports.forEach((file, index) => {
      const id = `imp${String(index + 1)}`
      served.assets.push(asset(file.name, file.mime, id, null, 'asset.import'))
      served.components.proj.records.push(record({ id, operation: 'asset.import', params: { name: file.name }, outputs: [file.name], surface: 'canvas' }))
      served.components.proj.created_by[file.name] = id
      served.components.canvas.nodes[id] = canvasNode('asset', [id], 0, 0)
      served.components.canvas.order.push(id)
      served.components.canvas.assets[file.name] = id
    })
    options.edit?.(served)
    accepted.forEach((request, index) => { applyCanvasWrite(served, request, index) })
    return served
  }
  const scripted = scriptedFetch({ state, operations: options.operations ?? OPERATIONS, projects: options.projects ?? [PROJECT] })
  const layoutWrites: LayoutWrite[] = []
  const layout: CanvasLayout = options.layout ?? { viewport: { x: 0, y: 0, zoom: 1 } }
  const positionWrites: Array<Record<string, unknown>> = []
  const notify = (): void => {
    for (const source of ScriptedEventSource.open) source.dispatchEvent(new MessageEvent('record', { data: 'null' }))
  }
  const heldLayouts: Array<{ project: string; answer: () => void }> = []
  const heldOperations: Array<() => void> = []
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const refusal = (path: string, init: RequestInit | undefined): Response | null => {
    if (init?.method !== 'POST' || typeof init.body !== 'string' || options.refuse === undefined) return null
    const error = options.refuse(path, JSON.parse(init.body))
    return error === null ? null : json({ error }, 500)
  }
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host')
    if (url.pathname === '/api/dv/canvas/layout') {
      const project = url.searchParams.get('project') ?? ''
      const stored = project === 'p1' ? layout : { viewport: null }
      if (init?.method === 'POST' && typeof init.body === 'string') layoutWrites.push(JSON.parse(init.body) as LayoutWrite)
      const refused = refusal(url.pathname, init)
      if (refused !== null) return Promise.resolve(refused)
      if (options.layout === null && init?.method !== 'POST') return Promise.resolve(json({ error: 'unavailable' }, 503))
      if (options.holdLayout === true && init?.method !== 'POST') {
        return new Promise<Response>((resolve) => { heldLayouts.push({ project, answer: () => { resolve(json(stored)) } }) })
      }
      return Promise.resolve(json(stored))
    }
    if (url.pathname === '/api/dv/operations' && options.operations === null) return Promise.resolve(json({ error: 'offline' }, 503))
    if (url.pathname === '/api/dv/state') {
      const served = state()
      return Promise.resolve(json({ ...served, project: { ...served.project, id: url.searchParams.get('project') ?? '' } }))
    }
    if (url.pathname === '/api/dv/assets/import') {
      const query = url.searchParams
      const file: ImportRequest = {
        project: query.get('project') ?? '', name: query.get('name') ?? '', mime: query.get('mime') ?? '',
        surface: query.get('surface') ?? '', session: query.get('session'),
      }
      imports.push(file)
      queueMicrotask(notify)
      return Promise.resolve(json({ asset: file.name, record: record({ id: `imp${String(imports.length)}`, operation: 'asset.import' }) }))
    }
    const answer = scripted.fetch(input, init)
    const refused = refusal(url.pathname, init)
    const response = refused === null ? answer : Promise.resolve(refused)
    const request = url.pathname === '/api/dv/operation' && typeof init?.body === 'string' ? JSON.parse(init.body) as OperationRequest : null
    if (request?.operation === 'canvas.node_position') positionWrites.push(request.params ?? {})
    // The host announces a change once the record is written, so a canvas write reaches the state on the answer.
    const answered = (): Promise<Response> => {
      if (request !== null && refused === null && CANVAS_WRITES.has(request.operation)) {
        accepted.push(request)
        queueMicrotask(notify)
      }
      return response
    }
    if (options.holdOperations === true && request !== null) {
      return new Promise<Response>((resolve) => { heldOperations.push(() => { resolve(answered()) }) })
    }
    return answered()
  }
  const releaseLayout = (project: string): void => {
    for (const held of heldLayouts.filter(each => each.project === project)) held.answer()
  }
  const releaseOperations = (): void => { heldOperations.splice(0).forEach((answer) => { answer() }) }
  vi.stubGlobal('fetch', fetchImpl)
  vi.stubGlobal('EventSource', ScriptedEventSource)
  return { writes: scripted.writes, layoutWrites, imports, positionWrites, notify, releaseLayout, releaseOperations }
}

/** Where the root frame shows the canvas. */
export type Surface = 'center' | 'tab'

/** What a mounted canvas test drives. */
export interface MountedCanvas {
  runtime: SlotTestRuntime
  view: RenderResult
  server: CanvasServer
  /** The ui-canvas plugin's fiber. */
  canvas: FeatureHandle
  /** Each mounted kind plugin's fiber. */
  kinds: Partial<Record<Kind, FeatureHandle>>
  /**
   * @param id - a node ID.
   * @param surface - the surface whose canvas draws it; the center by default.
   * @returns the node's card.
   */
  node: (id: string, surface?: Surface) => HTMLElement
  /**
   * Double click a node and wait for its editor.
   * @param id - the node ID.
   * @param surface - the surface whose canvas draws it; the center by default.
   * @returns the editor panel.
   */
  open: (id: string, surface?: Surface) => Promise<HTMLElement>
  /** @returns the canvas surface of the center, or of the right Sidebar tab. */
  canvasOf: (surface?: Surface) => HTMLElement
}

/** How {@link mountCanvas} composes the canvas. */
export interface MountOptions extends ServerOptions {
  /** The kind plugins to mount, in order; every kind by default. */
  kinds?: readonly Kind[]
  /** The surfaces whose canvas the root frame shows; the center by default. */
  surfaces?: readonly Surface[]
  /** Mount ui-canvas before the kind plugins; by default the kinds mount first and register once `dvCanvas` exists. */
  canvasFirst?: boolean
  /** Runs once the kinds that mount first are mounted, just before ui-canvas mounts. */
  beforeCanvas?: (runtime: SlotTestRuntime) => void | Promise<void>
  /** The request that the center hands the canvas view, as `dvCenter.show` sets it; none by default. */
  request?: CenterRequest
}

const TAB_SESSION = 's-tab'

/**
 * Mount ui-canvas and the kind plugins under the locale runtime, the right Sidebar tab registry, and the root frame.
 * The center passes project p1 and chat session s5; the tab body picks its project from `/api/dv/projects`.
 * @param options - the server, the kinds, the surfaces and the load order.
 * @returns the runtime, the rendered root, the server, the fibers, and node lookups.
 */
export async function mountCanvas(options: MountOptions = {}): Promise<MountedCanvas> {
  document.documentElement.lang = 'zh-CN'
  const server = serveCanvas(options)
  const surfaces = options.surfaces ?? ['center']
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  const tabSession = runtime.sessions.retainFor(runtime.ctx, await runtime.sessions.add({ id: TAB_SESSION }))
  type FrameProps = PropsRenderSlots<'dv.center.view' | 'sidebar.right.pane.tab' | 'shell.overlay'>
    & { SessionProvider: (props: { session: unknown; children: ReactNode }) => ReactNode }
  const Frame = ({ renderSlot, SessionProvider }: FrameProps): ReactNode => (
    <>
      {surfaces.includes('center')
        ? <div data-testid="center">{renderSlot('dv.center.view', { projectId: 'p1', session: 's5', request: options.request ?? null, fields: {}, note: () => {} }, { only: 'canvas' })}</div>
        : null}
      {surfaces.includes('tab')
        ? <div data-testid="tab"><SessionProvider session={tabSession}>{renderSlot('sidebar.right.pane.tab', {} as never, { entryKey: CANVAS_ID } as never)}</SessionProvider></div>
        : null}
      {renderSlot('shell.overlay', {})}
    </>
  )
  await runtime.root.declare({
    'dv.center.view': { kind: 'list', scope: 'root' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' } as never,
    'shell.overlay': { kind: 'list', scope: 'root' },
  }, Frame as never)
  const view = runtime.renderRoot()
  const kinds: Partial<Record<Kind, FeatureHandle>> = {}
  const mountKinds = async (): Promise<void> => {
    for (const kind of options.kinds ?? ALL_KINDS) kinds[kind] = await runtime.mount(KINDS[kind])
  }
  if (options.canvasFirst !== true) await mountKinds()
  await options.beforeCanvas?.(runtime)
  const canvas = await runtime.mount({ inject: [...inject], apply })
  if (options.canvasFirst === true) await mountKinds()
  const canvasOf = (surface: Surface = 'center'): HTMLElement => within(view.getByTestId(surface)).getByTestId('dv-canvas-view')
  const node = (id: string, surface: Surface = 'center'): HTMLElement => {
    const element = view.getByTestId(surface).querySelector(`[data-node-id="${id}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no node ${id} in the ${surface} canvas`)
    return element
  }
  const open = async (id: string, surface: Surface = 'center'): Promise<HTMLElement> => {
    const card = await waitFor(() => node(id, surface))
    // Two quick clicks on the card: the canvas opens the editor on the second.
    for (const pointerId of [1, 2]) {
      fireEvent.pointerDown(card, { button: 0, clientX: 5, clientY: 5, pointerId })
      fireEvent.pointerUp(canvasOf(surface), { pointerId })
    }
    return waitFor(() => {
      const editors = within(view.getByTestId(surface)).getAllByTestId('dv-canvas-node-editor')
      const editor = editors.find(panel => panel.getAttribute('aria-label') === card.getAttribute('aria-label'))
      if (editor === undefined) throw new Error(`no editor of ${id}`)
      return editor
    })
  }
  return { runtime, view, server, canvas, kinds, node, open, canvasOf }
}

/**
 * Mount a plugin that registers canvas descriptors from its own fiber, as a workflow plugin does.
 * @param runtime - the runtime.
 * @param descriptors - records in use, a node type and node actions to register.
 * @returns the plugin's fiber.
 */
export function mountDescriptors(
  runtime: SlotTestRuntime,
  descriptors: { inUse?: RecordsInUse; nodeType?: NodeType; actions?: readonly NodeAction[] },
): Promise<FeatureHandle> {
  return runtime.mount({
    inject: ['dvCanvas'],
    apply: (ctx: Context) => {
      const { inUse, nodeType, actions = [] } = descriptors
      if (inUse !== undefined) ctx.effect(() => ctx.dvCanvas.recordsInUse.register(inUse), 'test: records in use')
      if (nodeType !== undefined) ctx.effect(() => ctx.dvCanvas.nodeTypes.register(nodeType), 'test: node type')
      for (const action of actions) ctx.effect(() => ctx.dvCanvas.actions.register(action), 'test: node action')
    },
  })
}

/** Forget the page state that a canvas test leaves: the editor rectangle, the opened nodes and <html lang>. */
export function forgetCanvasStorage(): void {
  document.documentElement.lang = ''
  window.localStorage.removeItem('dv-canvas-editor-rect')
  window.localStorage.removeItem('dv-canvas-seen:p1')
}
