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
  BLENDER_ID, BlenderPanel, VIEWPORT_SIZING, VIEWPORT_TYPE, ViewportCard, ViewportEditor, addonNavigates, apply, applyWith,
  blenderDefinition, drawFrame, httpBlenderSource, inject, shownSize, viewportNode, viewportNodeType, type BlenderSource,
  type BlenderState, type BlenderStatus, type ViewCommand, type ViewFrame,
} from '../src/client/index.ts'
import { statsText } from '../src/client/controls.tsx'
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

/**
 * Mount the plugin with the canvas and the tab registry, and draw its tab body in chat session s5, and, when `canvas` is
 * set, the viewport node's card and editor.
 */
async function mount(body: ReturnType<typeof applyWith>, canvas = false) {
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
          {canvas
            ? (
              <>
                <div data-testid="card">{renderSlot('dv.canvas.card', { node: nodeView, assets: {}, textScale: 1, host: CARD_HOST }, { entryKey: VIEWPORT_TYPE })}</div>
                <div data-testid="editor">
                  {renderSlot('dv.canvas.editor', { node: nodeView, state: stateWith(true), operations: [], host: EDITOR_HOST }, { entryKey: VIEWPORT_TYPE })}
                </div>
              </>
            )
            : null}
        </SessionProvider>
      )
  ))
  const handle = await runtime.mount({ inject: [...inject], apply: body })
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
  const view = runtime.renderRoot()
  return { runtime, handle, tabs, view, tab: () => within(view.getByTestId('tab')) }
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
    const { runtime, handle, tab } = await mount(applyWith(source))
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
// The canvas's hosts of a card and an editor, which the viewport card and editor never call.
const CARD_HOST = { run: vi.fn(), rerun: vi.fn() }
const editorHost = (): EditorHost => ({ run: vi.fn(), close: vi.fn() }) as unknown as EditorHost
const EDITOR_HOST = editorHost()

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
    const host = editorHost()
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

  it('zooms by whole wheel lines, and keeps the context menu off the surface', () => {
    const source = new FakeSource()
    const { runFrame, surface } = mountEditor(source)
    source.link(STATE)
    fireEvent.wheel(surface, { deltaY: 3, deltaMode: 1 })
    runFrame()
    expect(source.sent).toEqual([{ action: 'zoom', steps: 3 }])
    expect(fireEvent.contextMenu(surface)).toBe(false)
  })

  it('counts a drag on a surface with no layout size as whole pictures, within the command limit', () => {
    const source = new FakeSource()
    const { runFrame, surface } = mountEditor(source)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(0)
    source.link(STATE)
    fireEvent.pointerDown(surface, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 3, clientY: -40, pointerId: 1 })
    runFrame()
    expect(source.sent).toEqual([{ action: 'orbit', dx: 3, dy: -10 }])
  })

  it('measures a drag against the newest frame\'s size', () => {
    const source = new FakeSource()
    const { runFrame, surface } = mountEditor(source)
    source.link(STATE)
    source.frame(frame(640, 360))
    // A square frame of the same width shows as 180 × 180 in the 320 × 180 surface.
    source.frame(frame(640, 640))
    source.frame(frame(640, 640))
    fireEvent.pointerDown(surface, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 18, clientY: 0, pointerId: 1 })
    runFrame()
    expect(source.sent).toEqual([{ action: 'orbit', dx: 0.1, dy: 0 }])
  })

  it('shows a picture in a box of no size as one pixel', () => {
    expect(shownSize({ width: 0, height: 0 }, { width: 640, height: 360 })).toEqual({ width: 1, height: 1 })
  })
})

describe('BlenderPanel viewport controls', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('moves Blender\'s view from the tab with the same controls as the node editor', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(180)
    const source = new FakeSource()
    render(<BlenderPanel source={source} draw={noDraw} />)
    await screen.findByTestId('dv-blender-connection')
    source.link(STATE)
    source.frame(frame(640))
    fireEvent.click(screen.getByText('Front'))
    fireEvent.click(screen.getByText('Frame all'))
    const surface = screen.getByTestId('dv-blender-surface')
    fireEvent.pointerDown(surface, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 32, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(surface, { pointerId: 1 })
    await vi.waitFor(() => { expect(source.sent).toHaveLength(3) })
    expect(source.sent.slice(0, 2)).toEqual([{ action: 'preset', preset: 'front' }, { action: 'frame', target: 'all' }])
    expect(source.sent[2]).toMatchObject({ action: 'orbit', dy: 0 })
    expect(screen.getByText('Drag to orbit · Shift-drag or right-drag to pan · Scroll to zoom. This moves only the view.')).toBeTruthy()
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

/** A WebSocket stand-in for the shared viewport socket: the test delivers its messages and reads what it sent. */
class FakeSocket {
  static readonly OPEN = 1
  static readonly opened: FakeSocket[] = []
  readyState = FakeSocket.OPEN
  binaryType = 'blob'
  readonly sent: string[] = []
  closed = false
  private readonly handlers = new Map<string, Array<(event: { data?: unknown }) => void>>()
  constructor(readonly url: string) { FakeSocket.opened.push(this) }
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void {
    this.handlers.set(type, [...this.handlers.get(type) ?? [], handler])
  }
  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed = true }
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

describe('viewport stream measurements', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('times a move to its frame, counts the frames of the last second, and keeps the add-on\'s timing', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    FakeSocket.opened.length = 0
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const viewer = new SharedViewer()
    const frames: ViewFrame[] = []
    viewer.watch({ status: () => {}, frame: (next) => { frames.push(next) } })
    const [socket] = FakeSocket.opened
    const deliver = (timing?: Record<string, number>): void => {
      socket?.deliver('message', JSON.stringify({ type: 'frame', width: 640, height: 360, mime: 'image/jpeg', ...timing === undefined ? {} : { timing } }))
      socket?.deliver('message', new Blob(['jpeg']))
    }
    viewer.send({ action: 'orbit', dx: 0.1, dy: 0 })
    now += 40
    viewer.send({ action: 'orbit', dx: 0.1, dy: 0 })
    now += 80
    deliver({ draw_ms: 5.2, encode_ms: 31.6 })
    now += 50
    viewer.send({ action: 'preset', preset: 'top' })
    deliver()
    now += 2000
    deliver()
    expect(frames.map(frame => frame.stats)).toEqual([
      { fps: 1, responseMs: 120, drawMs: 5.2, encodeMs: 31.6 },
      { fps: 2, responseMs: null, drawMs: null, encodeMs: null },
      { fps: 1, responseMs: null, drawMs: null, encodeMs: null },
    ])
  })

  it('reads the stream measurements out in the controls of a connected view', async () => {
    const t = (_zh: string, en: string): string => en
    expect(statsText({ fps: 22, responseMs: 140, drawMs: 5.2, encodeMs: 31.6 }, t)).toBe('22 fps · response 140 ms · Blender draw 5 ms, encode 32 ms')
    expect(statsText({ fps: 9, responseMs: null, drawMs: null, encodeMs: null }, t)).toBe('9 fps')
    const source = new FakeSource()
    render(<BlenderPanel source={source} draw={noDraw} />)
    await screen.findByTestId('dv-blender-connection')
    source.link(STATE)
    expect(screen.queryByTestId('dv-blender-stats')).toBeNull()
    source.frame({ ...frame(640), stats: { fps: 12, responseMs: 90, drawMs: 4, encodeMs: 20 } })
    expect(screen.getByTestId('dv-blender-stats').textContent).toBe('12 fps · response 90 ms · Blender draw 4 ms, encode 20 ms')
  })
})

describe('BlenderPanel failures and defaults', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('saves the add-on through a temporary link, and revokes the link\'s address a minute later', async () => {
    const source = new FakeSource()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:addon')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicked: Array<{ href: string; download: string; attached: boolean }> = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected })
    })
    render(<BlenderPanel source={source} />)
    await screen.findByTestId('dv-blender-connection')
    vi.useFakeTimers()
    fireEvent.click(screen.getByText('Download dreamverse_blender.zip'))
    await act(async () => {})
    expect(clicked).toEqual([{ href: 'blob:addon', download: 'dreamverse_blender.zip', attached: true }])
    expect(created).toHaveBeenCalledWith(expect.any(Blob))
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(59_999)
    expect(revoked).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoked).toHaveBeenCalledWith('blob:addon')
  })

  it('says why the status, a new pairing token, or the add-on did not load, for Error and non-Error reasons', async () => {
    const failing = new FakeSource()
    failing.status = () => Promise.reject(new Error('HTTP 503'))
    render(<BlenderPanel source={failing} />)
    expect(await screen.findByText('Failed to load: HTTP 503')).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    cleanup()
    const offline = new FakeSource()
    offline.status = async () => { throw 'offline' }
    render(<BlenderPanel source={offline} />)
    expect(await screen.findByText('Failed to load: offline')).toBeTruthy()
    cleanup()
    const source = new FakeSource()
    render(<BlenderPanel source={source} save={vi.fn()} />)
    await screen.findByTestId('dv-blender-connection')
    source.regenerate = () => Promise.reject(new Error('HTTP 500'))
    fireEvent.click(screen.getByText('Replace the pairing token'))
    expect(await screen.findByText('Failed to load: HTTP 500')).toBeTruthy()
    source.regenerate = async () => { throw 'gone' }
    fireEvent.click(screen.getByText('Replace the pairing token'))
    expect(await screen.findByText('Failed to load: gone')).toBeTruthy()
    expect(screen.getByTestId('dv-blender-connection').textContent).toBe('http://127.0.0.1:18094#tok-1')
    source.addon = async () => { throw 'network down' }
    fireEvent.click(screen.getByText('Download dreamverse_blender.zip'))
    expect(await screen.findByText('The download failed: network down')).toBeTruthy()
  })

  it('keeps the answer of the panel\'s current host half when an earlier one answers late', async () => {
    const early = new FakeSource()
    const answer = Promise.withResolvers<BlenderStatus>()
    early.status = () => answer.promise
    const later = new FakeSource()
    later.token = 'tok-later'
    const view = render(<BlenderPanel source={early} />)
    view.rerender(<BlenderPanel source={later} />)
    await screen.findByTestId('dv-blender-connection')
    await act(async () => { answer.resolve({ linked: false, state: null, token: 'tok-early', link_path: '/dv/blender/ws', viewers: 0 }) })
    expect(screen.getByTestId('dv-blender-connection').textContent).toBe('http://127.0.0.1:18094#tok-later')
    const refused = new FakeSource()
    const refusal = Promise.withResolvers<BlenderStatus>()
    refused.status = () => refusal.promise
    view.rerender(<BlenderPanel source={refused} />)
    view.rerender(<BlenderPanel source={later} />)
    await act(async () => { refusal.reject(new Error('HTTP 401')) })
    expect(screen.queryByText('Failed to load: HTTP 401')).toBeNull()
  })

  it('copies through the page\'s clipboard, and offers the copy again after a refused one', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<BlenderPanel source={new FakeSource()} />)
    await screen.findByTestId('dv-blender-connection')
    fireEvent.click(screen.getByText('Copy the connection string'))
    expect(await screen.findByText('Copied')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:18094#tok-1')
    writeText.mockImplementation(async () => { throw new Error('denied') })
    fireEvent.click(screen.getByText('Copied'))
    expect(await screen.findByText('Copy the connection string')).toBeTruthy()
  })

  it('names an unsaved Blender file', async () => {
    const source = new FakeSource()
    render(<BlenderPanel source={source} draw={noDraw} />)
    await screen.findByTestId('dv-blender-connection')
    source.link({ ...STATE, file: '' })
    expect(screen.getByText('Unsaved file')).toBeTruthy()
  })
})

describe('the plugin over the page\'s bridge', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('draws the tab body over the bridge routes and the viewport node\'s card and editor over the shared socket', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    FakeSocket.opened.length = 0
    const fetched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      fetched.push(input)
      return new Response(JSON.stringify({ linked: false, state: null, token: 'tok-h', link_path: '/dv/blender/ws', viewers: 0 }))
    }))
    const { view, tab } = await mount(apply, true)
    expect((await tab().findByTestId('dv-blender-connection')).textContent).toBe(`${window.location.origin}#tok-h`)
    expect(fetched).toEqual(['/api/dv/blender/status'])
    expect(within(view.getByTestId('card')).getByText('Blender is not connected')).toBeTruthy()
    expect(within(view.getByTestId('editor')).getByTestId('dv-blender-node-surface')).toBeTruthy()
    // The tab body, the card and the editor share one socket.
    expect(FakeSocket.opened.map(socket => socket.url)).toEqual([`ws://${window.location.host}/dv/blender/view`])
    act(() => { FakeSocket.opened[0]?.deliver('message', JSON.stringify({ type: 'status', linked: true, state: STATE })) })
    expect(within(view.getByTestId('card')).getByText('Waiting for the viewport…')).toBeTruthy()
    expect(within(view.getByTestId('editor')).getByText<HTMLButtonElement>('Top').disabled).toBe(false)
  })

  it('names the viewport node type', () => {
    expect(viewportNodeType(BLENDER_ID).label()).toBe('Blender viewport')
  })
})

describe('httpBlenderSource', () => {
  const href = window.location.href
  // The page address, set through the jsdom instance that vitest exposes.
  const navigateTo = (url: string): void => {
    (globalThis as typeof globalThis & { jsdom: { reconfigure(settings: { url: string }): void } }).jsdom.reconfigure({ url })
  }
  afterEach(() => { navigateTo(href) })

  it('reads the status, makes a pairing token, downloads the add-on, and names HTTP failures', async () => {
    const requests: Array<{ url: string; method: string }> = []
    const answers: Response[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? 'GET' })
      return answers.shift() ?? new Response(null, { status: 500 })
    }))
    const status = { linked: false, state: null, token: 'tok-h', link_path: '/dv/blender/ws', viewers: 1 }
    answers.push(new Response(JSON.stringify(status)), new Response(JSON.stringify({ ...status, token: 'tok-new' })), new Response('zip'))
    expect(await httpBlenderSource.status()).toEqual(status)
    expect((await httpBlenderSource.regenerate()).token).toBe('tok-new')
    expect(await (await httpBlenderSource.addon()).text()).toBe('zip')
    answers.push(new Response(null, { status: 503 }), new Response(null, { status: 404 }))
    await expect(httpBlenderSource.status()).rejects.toThrow('HTTP 503')
    await expect(httpBlenderSource.addon()).rejects.toThrow('HTTP 404')
    expect(requests).toEqual([
      { url: '/api/dv/blender/status', method: 'GET' }, { url: '/api/dv/blender/token', method: 'POST' },
      { url: '/api/dv/blender/addon.zip', method: 'GET' }, { url: '/api/dv/blender/status', method: 'GET' },
      { url: '/api/dv/blender/addon.zip', method: 'GET' },
    ])
    expect(httpBlenderSource.origin).toBe(window.location.origin)
  })

  it('puts the viewport on the open project\'s canvas through the blender.viewport operation, and needs an open project', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body: unknown = JSON.parse(init?.body as string)
      bodies.push({ url, body })
      return new Response(JSON.stringify({ id: 'r1' }))
    }))
    await expect(httpBlenderSource.place()).rejects.toThrow('no project is open')
    publishCurrentProject('p1')
    await httpBlenderSource.place()
    expect(bodies).toEqual([{ url: '/api/dv/operation', body: { project: 'p1', operation: 'blender.viewport', params: {}, surface: 'canvas' } }])
  })

  it('sends view changes over the page\'s secure viewport socket', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    FakeSocket.opened.length = 0
    navigateTo('https://dv.test/app')
    const stop = httpBlenderSource.watch({ status: () => {}, frame: () => {} })
    httpBlenderSource.navigate({ action: 'zoom', steps: 1 })
    stop()
    expect(FakeSocket.opened.map(socket => ({ url: socket.url, sent: socket.sent, closed: socket.closed }))).toEqual([
      { url: 'wss://dv.test/dv/blender/view', sent: ['{"type":"view","action":"zoom","steps":1}'], closed: true },
    ])
  })
})

describe('SharedViewer socket lifecycle', () => {
  afterEach(() => { vi.useRealTimers() })

  /** A shared viewer over fake sockets, with a listener that records the link statuses it receives. */
  function openViewer() {
    vi.stubGlobal('WebSocket', FakeSocket)
    FakeSocket.opened.length = 0
    const viewer = new SharedViewer()
    const statuses: boolean[] = []
    const listener = { status: (linked: boolean) => { statuses.push(linked) }, frame: () => {} }
    return { viewer, statuses, listener }
  }

  it('closes the socket after the last listener leaves, ignores that socket\'s later close, and opens a new one for the next listener', () => {
    vi.useFakeTimers()
    const { viewer, statuses, listener } = openViewer()
    const stop = viewer.watch(listener)
    stop()
    const [first] = FakeSocket.opened
    expect(first?.closed).toBe(true)
    const next = viewer.watch(listener)
    first?.deliver('close')
    vi.advanceTimersByTime(2000)
    expect(statuses).toEqual([])
    expect(FakeSocket.opened).toHaveLength(2)
    next()
  })

  it('tells listeners of a dropped socket that Blender is gone, and reopens it two seconds later while one remains', () => {
    vi.useFakeTimers()
    const { viewer, statuses, listener } = openViewer()
    viewer.watch(listener)
    FakeSocket.opened[0]?.deliver('close')
    expect(statuses).toEqual([false])
    // A listener that joins while the reopen waits shares the coming socket.
    const joined = viewer.watch({ status: () => {}, frame: () => {} })
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.opened).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.opened).toHaveLength(2)
    joined()
  })

  it('reopens nothing after the last listener leaves while the reopen waits, or leaves on the disconnect itself', () => {
    vi.useFakeTimers()
    const { viewer, listener } = openViewer()
    const stop = viewer.watch(listener)
    FakeSocket.opened[0]?.deliver('close')
    stop()
    vi.advanceTimersByTime(2000)
    expect(FakeSocket.opened).toHaveLength(1)
    let stopOnDisconnect = (): void => {}
    stopOnDisconnect = viewer.watch({ status: (linked) => { if (!linked) stopOnDisconnect() }, frame: () => {} })
    FakeSocket.opened[1]?.deliver('close')
    vi.advanceTimersByTime(2000)
    expect(FakeSocket.opened).toHaveLength(2)
  })

  it('drops a picture without a frame header and view changes while the socket is not open, and reads a bare frame header as an empty JPEG', () => {
    const { viewer } = openViewer()
    const frames: ViewFrame[] = []
    const stop = viewer.watch({ status: () => {}, frame: (next) => { frames.push(next) } })
    const [socket] = FakeSocket.opened
    socket?.deliver('message', new Blob(['jpeg']))
    socket?.deliver('message', JSON.stringify({ type: 'unknown' }))
    socket?.deliver('message', new Blob(['jpeg']))
    expect(frames).toEqual([])
    socket?.deliver('message', JSON.stringify({ type: 'frame' }))
    socket?.deliver('message', new Blob(['jpeg']))
    expect(frames.map(next => ({ width: next.width, height: next.height, type: next.image.type }))).toEqual([{ width: 0, height: 0, type: 'image/jpeg' }])
    socket!.readyState = 0
    viewer.send({ action: 'zoom', steps: 1 })
    stop()
    viewer.send({ action: 'zoom', steps: 1 })
    expect(socket?.sent).toEqual([])
  })
})

describe('drawFrame', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('sizes the canvas to the decoded frame, draws it, and frees the decoded frame even when drawing fails', async () => {
    const closed: number[] = []
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 36, close: () => { closed.push(64) } })))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    const canvas = document.createElement('canvas')
    await drawFrame(canvas, frame(64, 36))
    await drawFrame(canvas, frame(64, 36))
    expect({ width: canvas.width, height: canvas.height, draws: drawImage.mock.calls.length, closed })
      .toEqual({ width: 64, height: 36, draws: 2, closed: [64, 64] })
    drawImage.mockImplementation(() => { throw new Error('lost context') })
    await expect(drawFrame(canvas, frame(64, 36))).rejects.toThrow('lost context')
    expect(closed).toHaveLength(3)
  })
})

describe('useLiveView', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('stops watching while the page is hidden or the view is off screen, and watches again when it shows', () => {
    const source = new FakeSource()
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as never)
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(callback) }
      observe(): void {}
      disconnect(): void {}
    })
    render(<ViewportCard node={nodeView} assets={{}} textScale={1} host={CARD_HOST} source={source} draw={noDraw} {...STANDARD} />)
    expect(source.watchers).toBe(1)
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(source.watchers).toBe(0)
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(source.watchers).toBe(1)
    act(() => { observers[0]?.([{ isIntersecting: false }]) })
    expect(source.watchers).toBe(0)
    act(() => { observers[0]?.([{ isIntersecting: true }]) })
    expect(source.watchers).toBe(1)
  })

  it('draws the next frame after a draw fails', async () => {
    const source = new FakeSource()
    const drawn: number[] = []
    const draw = async (_canvas: HTMLCanvasElement, next: ViewFrame): Promise<void> => {
      drawn.push(next.width)
      if (next.width === 640) throw new Error('decode failed')
    }
    render(<ViewportCard node={nodeView} assets={{}} textScale={1} host={CARD_HOST} source={source} draw={draw} {...STANDARD} />)
    source.link(STATE)
    source.frame(frame(640))
    await act(async () => {})
    source.frame(frame(641))
    expect(drawn).toEqual([640, 641])
  })

  it('draws a frame that arrives before the view\'s canvas mounts once the canvas mounts', async () => {
    /** A host half that, like the shared socket a view joins while Blender is connected, gives the status and the newest frame at once. */
    class ConnectedSource extends FakeSource {
      override watch(listener: Parameters<BlenderSource['watch']>[0]): () => void {
        const stop = super.watch(listener)
        listener.status(true, STATE)
        listener.frame(frame(640))
        return stop
      }
    }
    const drawn: number[] = []
    render(<BlenderPanel source={new ConnectedSource()} draw={async (_canvas, next) => { drawn.push(next.width) }} />)
    await screen.findByText('Connected to Blender 5.3.0')
    expect(drawn).toEqual([640])
  })
})
