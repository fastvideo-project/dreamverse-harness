// @vitest-environment jsdom
/**
 * What `@fastvideo/dreamverse-ui-blender` registers: the Blender takes on the canvas, the Blender right-Sidebar tab type
 * and its body under the real slot runtime, the Blender viewport node type with its card and editor, and their removal
 * with the plugin; the panel's two states over a fake host half (the connection steps while no Blender is connected,
 * the live viewport while one is); and the viewport node's card, which leaves the pointer to the canvas, and editor,
 * which turns drags, the wheel and its buttons into view changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps, GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import type { EditorHost, NodeView } from '@dv/ui-canvas/contract'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import {
  BLENDER_ID, BlenderPanel, VIEWPORT_SIZING, VIEWPORT_TYPE, ViewportCard, ViewportEditor, addonNavigates, applyWith,
  blenderDefinition, inject, shownSize, viewportNode, viewportNodeType, type BlenderSource, type BlenderState, type BlenderStatus,
  type ViewCommand, type ViewFrame,
} from '../src/client/index.ts'
import { SharedViewer } from '../src/client/viewer.ts'
import { apply as hostApply } from '../src/index.ts'

const SLOTS = {
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  'dv.canvas.card': { kind: 'keyed', scope: 'root' },
  'dv.canvas.editor': { kind: 'keyed', scope: 'root' },
} as const

type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

const STATE: BlenderState = { blender_version: '5.3.0', addon_version: '0.2.0', file: 'shot.blend', allow_code: true }

/** A host half whose stream the test drives. */
class FakeSource implements BlenderSource {
  addonFailure: Error | null = null

  addon(): Promise<Blob> {
    return this.addonFailure === null ? Promise.resolve(new Blob(['zip'], { type: 'application/zip' })) : Promise.reject(this.addonFailure)
  }

  origin = 'http://127.0.0.1:18094'
  token = 'tok-1'
  watchers = 0
  readonly sent: ViewCommand[] = []
  placeFailure: Error | null = null
  placed = 0

  navigate(command: ViewCommand): void {
    this.sent.push(command)
  }

  place(): Promise<void> {
    this.placed += 1
    return this.placeFailure === null ? Promise.resolve() : Promise.reject(this.placeFailure)
  }

  private readonly listeners = new Set<Parameters<BlenderSource['watch']>[0]>()

  status(): Promise<BlenderStatus> {
    return Promise.resolve({ linked: false, state: null, token: this.token, link_path: '/dv/blender/ws', viewers: this.watchers })
  }

  regenerate(): Promise<BlenderStatus> {
    this.token = 'tok-2'
    return this.status()
  }

  watch(listener: Parameters<BlenderSource['watch']>[0]): () => void {
    this.watchers += 1
    this.listeners.add(listener)
    listener.status(false, null)
    return () => {
      this.watchers -= 1
      this.listeners.delete(listener)
    }
  }

  link(state: BlenderState | null): void {
    act(() => { for (const listener of this.listeners) listener.status(state !== null, state) })
  }

  frame(frame: ViewFrame): void {
    act(() => { for (const listener of this.listeners) listener.frame(frame) })
  }
}

const runtimes: SlotTestRuntime[] = []
const sessions: Disposable[] = []

afterEach(async () => {
  cleanup()
  for (const session of sessions.splice(0)) session[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
})

/** Mount the plugin with the canvas and the tab registry, and draw its tab body in chat session s5. */
async function mount(source: BlenderSource) {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const tabs = new SidebarRightTabRegistry(runtime.ctx)
  runtime.ctx.provide('sidebarRightTabs', tabs as never)
  runtime.ctx.provide('dvCanvas', createDvCanvas())
  const reference: { current: SessionReference | undefined } = { current: undefined }
  await runtime.root.declare(SLOTS, ({ renderSlot, SessionProvider }: FrameProps) => (
    reference.current === undefined
      ? null
      : (
        <SessionProvider session={reference.current}>
          <div data-testid="tab">{renderSlot('sidebar.right.pane.tab', {}, { entryKey: BLENDER_ID, hookContext: {} as never })}</div>
        </SessionProvider>
      )
  ))
  const handle = await runtime.mount({ inject: [...inject], apply: applyWith(source) })
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
  const view = runtime.renderRoot()
  return { runtime, handle, tabs, tab: () => within(view.getByTestId('tab')) }
}

describe('@fastvideo/dreamverse-ui-blender', () => {
  it('keeps the host Loader entry inert, and names the Blender tab type', () => {
    expect(hostApply).not.toThrow()
    const guide = blenderDefinition.guide?.map(entry => [entry.title(), entry.description?.()])
    expect({ kind: blenderDefinition.kind, title: blenderDefinition.title('dv-blender'), guide })
      .toEqual({ kind: 'dv-blender', title: 'Blender', guide: [['Blender', 'Connect Blender and watch its viewport live']] })
  })

  it('registers the blender take node type, draws the Blender panel, and removes both with the plugin', async () => {
    const source = new FakeSource()
    const { runtime, handle, tab } = await mount(source)
    const blenderType = () => runtime.ctx.dvCanvas.nodeTypes.getSnapshot().find(type => type.type === 'blender')
    expect(blenderType()?.id).toBe(BLENDER_ID)
    const viewportType = () => runtime.ctx.dvCanvas.nodeTypes.getSnapshot().find(type => type.type === VIEWPORT_TYPE)
    expect(viewportType()?.id).toBe(BLENDER_ID)
    expect(await tab().findByTestId('dv-blender-panel')).toBeTruthy()
    expect(source.watchers).toBe(1)
    await handle.dispose()
    expect(blenderType()).toBeUndefined()
    expect(viewportType()).toBeUndefined()
    expect(source.watchers).toBe(0)
  })
})

describe('BlenderPanel', () => {
  it('shows the connection steps with the connection string, copies it, and replaces the token', async () => {
    const source = new FakeSource()
    const copy = vi.fn(() => Promise.resolve())
    render(<BlenderPanel source={source} copy={copy} />)
    const connection = await screen.findByTestId('dv-blender-connection')
    expect(connection.textContent).toBe('http://127.0.0.1:18094#tok-1')
    const save = vi.fn()
    cleanup()
    render(<BlenderPanel source={source} copy={copy} save={save} />)
    await screen.findByTestId('dv-blender-connection')
    fireEvent.click(screen.getByText('Download dreamverse_blender.zip'))
    await vi.waitFor(() => { expect(save).toHaveBeenCalledWith(expect.any(Blob), 'dreamverse_blender.zip') })
    source.addonFailure = new Error('HTTP 401')
    fireEvent.click(screen.getByText('Download dreamverse_blender.zip'))
    expect(await screen.findByText('The download failed: HTTP 401')).toBeTruthy()
    fireEvent.click(screen.getByText('Copy the connection string'))
    expect(copy).toHaveBeenCalledWith('http://127.0.0.1:18094#tok-1')
    expect(await screen.findByText('Copied')).toBeTruthy()
    fireEvent.click(screen.getByText('Replace the pairing token'))
    await vi.waitFor(() => { expect(screen.getByTestId('dv-blender-connection').textContent).toBe('http://127.0.0.1:18094#tok-2') })
  })

  it('shows the live viewport while a Blender is connected, and the steps again after it disconnects', async () => {
    const source = new FakeSource()
    const drawn: number[] = []
    const releases: Array<() => void> = []
    // Each draw stays pending until the test releases it, so frames that arrive meanwhile wait.
    const draw = (_canvas: HTMLCanvasElement, next: ViewFrame): Promise<void> => {
      drawn.push(next.width)
      return new Promise((resolve) => { releases.push(resolve) })
    }
    render(<BlenderPanel source={source} draw={draw} />)
    await screen.findByTestId('dv-blender-connection')
    source.link(STATE)
    expect(screen.getByText('Connected to Blender 5.3.0')).toBeTruthy()
    expect(screen.getByText('shot.blend')).toBeTruthy()
    expect(screen.getByText('Waiting for the viewport…')).toBeTruthy()
    const frame = (width: number): ViewFrame => ({ image: new Blob(['jpeg'], { type: 'image/jpeg' }), width, height: 360 })
    source.frame(frame(640))
    expect(screen.queryByText('Waiting for the viewport…')).toBeNull()
    expect(drawn).toEqual([640])
    // While the first frame is drawn, two more arrive: only the newest is drawn next.
    source.frame(frame(641))
    source.frame(frame(642))
    expect(drawn).toEqual([640])
    await act(async () => { releases.shift()?.() })
    await vi.waitFor(() => { expect(drawn).toEqual([640, 642]) })
    source.link({ ...STATE, allow_code: false })
    expect(screen.getByText('This Blender has code from the harness switched off; the agent can only look.')).toBeTruthy()
    source.link(null)
    expect(screen.queryByTestId('dv-blender-view')).toBeNull()
    expect(source.watchers).toBe(1)
    expect(screen.getByText('Connect Blender')).toBeTruthy()
  })
})

/** A project state whose canvas holds the viewport node r1 beside an asset node, or only the asset node. */
function stateWith(viewport: boolean): WireState {
  const record = { id: 'r1', operation: 'blender.viewport', status: 'done', params: {} }
  const node = (kind: string) => ({ kind, name: null, versions: [], position: { x: 0, y: 0, width: null, height: null } })
  return {
    project: { id: 'p1' }, head: 'r1', tip: 'r1', assets: [],
    components: {
      proj: { records: [record], stale: {}, superseded: {}, created_by: {} },
      canvas: {
        nodes: { a1: node('asset'), ...viewport ? { r1: node(VIEWPORT_TYPE) } : {} }, order: ['a1', ...viewport ? ['r1'] : []], assets: {},
      },
    },
  } as never
}

describe('the viewport node type', () => {
  it('draws the viewport node as a 16:9 media node and finds it on the canvas', () => {
    const type = viewportNodeType(BLENDER_ID)
    expect(type.entry({} as never)).toEqual({ title: 'Blender viewport', assets: [], sizing: VIEWPORT_SIZING })
    expect(VIEWPORT_SIZING).toMatchObject({ kind: 'media', aspectRatio: { ratio: 16 / 9, fixedHeight: 0 } })
    expect([viewportNode(stateWith(true)), viewportNode(stateWith(false))]).toEqual(['r1', null])
  })

  it('fits a frame into a box and knows which add-on versions move the view', () => {
    expect(shownSize({ width: 320, height: 320 }, { width: 640, height: 360 })).toEqual({ width: 320, height: 180 })
    expect(shownSize({ width: 320, height: 180 }, null)).toEqual({ width: 320, height: 180 })
    expect([addonNavigates('0.1.0'), addonNavigates('0.2.0'), addonNavigates('0.10.1'), addonNavigates('1.0.0')]).toEqual([false, true, true, true])
  })
})

const frame = (width: number, height = 360): ViewFrame => ({ image: new Blob(['jpeg'], { type: 'image/jpeg' }), width, height })
const noDraw = (): Promise<void> => Promise.resolve()
// The slot runtime's standard hooks, which the viewport card and editor never call.
const STANDARD = {} as GlobalStandardProps
const nodeView = { id: 'r1', type: VIEWPORT_TYPE } as unknown as NodeView

describe('ViewportCard', () => {
  it('shows the live viewport and leaves every pointer press to the canvas', () => {
    const source = new FakeSource()
    const pressed = vi.fn()
    render(
      <div onPointerDown={pressed}>
        <ViewportCard
          node={nodeView} assets={{}} textScale={1} host={{ run: vi.fn(), rerun: vi.fn() }} source={source} draw={noDraw} {...STANDARD}
        />
      </div>,
    )
    expect(screen.getByText('Blender is not connected')).toBeTruthy()
    source.link(STATE)
    expect(screen.getByText('Waiting for the viewport…')).toBeTruthy()
    source.frame(frame(640))
    expect(screen.queryByText('Waiting for the viewport…')).toBeNull()
    fireEvent.pointerDown(screen.getByTestId('dv-blender-node-view'))
    expect(pressed).toHaveBeenCalledTimes(1)
  })
})

describe('ViewportEditor', () => {
  /** Mount the editor over a 320 × 180 surface, with changes flushed only when the test runs the queued frame. */
  function mountEditor(source: FakeSource) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(180)
    const frames: Array<() => void> = []
    const host = { run: vi.fn(), close: vi.fn() } as unknown as EditorHost
    render(
      <ViewportEditor
        node={nodeView} state={stateWith(true)} operations={[]} host={host} source={source} draw={noDraw}
        schedule={(flush) => { frames.push(flush) }} {...STANDARD}
      />,
    )
    const runFrame = (): void => { act(() => { for (const flush of frames.splice(0)) flush() }) }
    return { host, runFrame, surface: screen.getByTestId('dv-blender-node-surface') }
  }

  afterEach(() => { vi.restoreAllMocks() })

  it('turns drags into one orbit or pan per frame and the wheel into zoom steps, as fractions of the shown picture', () => {
    const source = new FakeSource()
    const { runFrame, surface } = mountEditor(source)
    source.link(STATE)
    source.frame(frame(640))
    fireEvent.pointerDown(surface, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 16, clientY: 9, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 32, clientY: -18, pointerId: 1 })
    runFrame()
    fireEvent.pointerUp(surface, { pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 64, clientY: 0, pointerId: 1 })
    runFrame()
    fireEvent.pointerDown(surface, { button: 0, shiftKey: true, clientX: 0, clientY: 0, pointerId: 2 })
    fireEvent.pointerMove(surface, { clientX: -32, clientY: 0, pointerId: 2 })
    runFrame()
    fireEvent.pointerUp(surface, { pointerId: 2 })
    fireEvent.pointerDown(surface, { button: 2, clientX: 0, clientY: 0, pointerId: 3 })
    fireEvent.pointerMove(surface, { clientX: 0, clientY: 90, pointerId: 3 })
    runFrame()
    fireEvent.pointerUp(surface, { pointerId: 3 })
    fireEvent.wheel(surface, { deltaY: 100 })
    fireEvent.wheel(surface, { deltaY: 100 })
    runFrame()
    fireEvent.wheel(surface, { deltaY: -6000 })
    runFrame()
    const rounded = (value: number): number => Math.round(value * 1e6) / 1e6
    expect(source.sent.map(command => 'dx' in command ? { ...command, dx: rounded(command.dx), dy: rounded(command.dy) } : command)).toEqual([
      { action: 'orbit', dx: 0.1, dy: -0.1 },
      { action: 'pan', dx: -0.1, dy: 0 },
      { action: 'pan', dx: 0, dy: 0.5 },
      { action: 'zoom', steps: 2 },
      { action: 'zoom', steps: -10 },
    ])
  })

  it('switches views and frames the scene, and leaves removing the node to the canvas', () => {
    const source = new FakeSource()
    const { host } = mountEditor(source)
    source.link(STATE)
    fireEvent.click(screen.getByText('Top'))
    fireEvent.click(screen.getByText('Camera'))
    fireEvent.click(screen.getByText('Frame selected'))
    expect(source.sent).toEqual([{ action: 'preset', preset: 'top' }, { action: 'preset', preset: 'camera' }, { action: 'frame', target: 'selected' }])
    expect(screen.queryByText('Remove from the canvas')).toBeNull()
    expect(host.run).not.toHaveBeenCalled()
  })

  it('moves nothing while Blender is not connected or its add-on predates view changes, and says to update it', () => {
    const source = new FakeSource()
    const { runFrame, surface } = mountEditor(source)
    expect(screen.getByText<HTMLButtonElement>('Top').disabled).toBe(true)
    source.link({ ...STATE, addon_version: '0.1.0' })
    expect(screen.getByText('Update the DreamVerse add-on in Blender to move the view from here.')).toBeTruthy()
    fireEvent.pointerDown(surface, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 32, clientY: 0, pointerId: 1 })
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    surface.dispatchEvent(wheel)
    runFrame()
    expect(wheel.defaultPrevented).toBe(false)
    expect(screen.getByText<HTMLButtonElement>('Top').disabled).toBe(true)
    expect(source.sent).toEqual([])
  })
})

describe('BlenderPanel placing', () => {
  it('puts the viewport on the open project\'s canvas, shows a refusal, and needs an open project', async () => {
    const source = new FakeSource()
    render(<BlenderPanel source={source} draw={noDraw} />)
    await screen.findByTestId('dv-blender-connection')
    source.link(STATE)
    const button = (): HTMLButtonElement => screen.getByText('Put the viewport on the canvas') as HTMLButtonElement
    expect(button().disabled).toBe(true)
    expect(screen.getByText('Open a project to put the viewport on its canvas.')).toBeTruthy()
    act(() => { publishCurrentProject('p1') })
    expect(button().disabled).toBe(false)
    fireEvent.click(button())
    await vi.waitFor(() => { expect(source.placed).toBe(1) })
    await vi.waitFor(() => { expect(button().disabled).toBe(false) })
    source.placeFailure = new Error('The Blender viewport is already on the canvas.')
    fireEvent.click(button())
    expect(await screen.findByText('The viewport was not put on the canvas: The Blender viewport is already on the canvas.')).toBeTruthy()
  })
})

/** A WebSocket stand-in for the shared viewport socket: the test delivers its messages. */
class FakeSocket {
  static readonly OPEN = 1
  static readonly opened: FakeSocket[] = []
  readyState = FakeSocket.OPEN
  binaryType = 'blob'
  private readonly handlers = new Map<string, Array<(event: { data?: unknown }) => void>>()
  constructor(readonly url: string) { FakeSocket.opened.push(this) }
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void {
    this.handlers.set(type, [...this.handlers.get(type) ?? [], handler])
  }
  send(): void {}
  close(): void {}
  deliver(type: string, data?: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler({ data })
  }
}

describe('SharedViewer', () => {
  /** A listener that records what it receives. */
  function recorder() {
    const seen: string[] = []
    return {
      seen,
      listener: {
        status: (linked: boolean, state: BlenderState | null) => { seen.push(`status ${String(linked)} ${state?.file ?? '-'}`) },
        frame: (next: ViewFrame) => { seen.push(`frame ${String(next.width)}x${String(next.height)}`) },
      },
    }
  }

  it('gives a listener that joins an open socket the last status and the newest frame, and forgets both on a disconnect', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    FakeSocket.opened.length = 0
    const viewer = new SharedViewer()
    const card = recorder()
    const stopCard = viewer.watch(card.listener)
    const [socket] = FakeSocket.opened
    socket?.deliver('message', JSON.stringify({ type: 'status', linked: true, state: STATE }))
    socket?.deliver('message', JSON.stringify({ type: 'frame', width: 640, height: 360, mime: 'image/jpeg' }))
    socket?.deliver('message', new Blob(['jpeg']))
    expect(card.seen).toEqual(['status true shot.blend', 'frame 640x360'])

    const editor = recorder()
    const stopEditor = viewer.watch(editor.listener)
    expect(FakeSocket.opened).toHaveLength(1)
    expect(editor.seen).toEqual(['status true shot.blend', 'frame 640x360'])

    socket?.deliver('message', JSON.stringify({ type: 'status', linked: false, state: null }))
    stopEditor()
    const late = recorder()
    viewer.watch(late.listener)
    expect(late.seen).toEqual(['status false -'])
    stopCard()
  })
})
