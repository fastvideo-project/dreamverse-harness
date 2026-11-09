/**
 * The page's link to the Blender bridge: the status and token routes, the add-on download, the `blender.viewport` run
 * that puts the viewport on the open project's canvas, and the page's one viewport socket. The viewport arrives over
 * the WebSocket route `/dv/blender/view`, one socket per page however many views are mounted, because a long-lived HTTP
 * stream would hold one of the browser's few HTTP/1.1 connections to the harness and stall the page's other requests.
 * The same socket carries the view changes a view sends to Blender.
 *
 * @module @fastvideo/dreamverse-ui-blender/viewer
 */
import { DvClient } from '@dv/ui-kit/api.ts'
import { getCurrentProject } from '@dv/ui-kit/current-project.ts'

/** What the add-on reports about the connected Blender. */
export interface BlenderState {
  blender_version: string
  addon_version: string
  file: string
  allow_code: boolean
}

/** The answer of `GET /api/dv/blender/status`. */
export interface BlenderStatus {
  linked: boolean
  state: BlenderState | null
  token: string
  link_path: string
  viewers: number
}

/** One viewport frame: its JPEG or PNG and its pixel size. */
export interface ViewFrame {
  image: Blob
  width: number
  height: number
}

/** The standard views a view can switch Blender's viewport to; `camera` looks through the scene camera. */
export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'camera'

/**
 * A change to the view of Blender's main 3D viewport, as the bridge accepts it: `orbit` and `pan` take the drag as
 * fractions of the shown picture's width (`dx`, rightward) and height (`dy`, downward), `zoom` takes wheel steps
 * (positive away from the scene), and each number stays within ±{@link VIEW_COMMAND_LIMIT}.
 */
export type ViewCommand =
  | { action: 'orbit' | 'pan'; dx: number; dy: number }
  | { action: 'zoom'; steps: number }
  | { action: 'preset'; preset: ViewPreset }
  | { action: 'frame'; target: 'all' | 'selected' }

/** The bound of each number of a {@link ViewCommand}; the bridge drops a command beyond it. */
export const VIEW_COMMAND_LIMIT = 10

/** The operation that puts the viewport on the canvas or takes it off. */
export const VIEWPORT_OPERATION = 'blender.viewport'

/** The page's link to the bridge; {@link httpBlenderSource} in the page. */
export interface BlenderSource {
  status(): Promise<BlenderStatus>
  regenerate(): Promise<BlenderStatus>
  /** @returns the close of the stream. */
  watch(listener: ViewListener): () => void
  /** Send one view change to Blender; it is dropped while the socket is not open. */
  navigate(command: ViewCommand): void
  /** Put the viewport on the open project's canvas; rejects with the refusal, or when no project is open. */
  place(): Promise<void>
  /** The add-on zip; a failed request rejects with its HTTP status. */
  addon(): Promise<Blob>
  /** The origin Blender must connect to. */
  origin: string
}

/** What a watcher of the viewport receives. */
export interface ViewListener {
  status(linked: boolean, state: BlenderState | null): void
  frame(frame: ViewFrame): void
}

const STATUS_ROUTE = '/api/dv/blender/status'
const TOKEN_ROUTE = '/api/dv/blender/token'
const VIEW_PATH = '/dv/blender/view'
const ADDON_ROUTE = '/api/dv/blender/addon.zip'

async function json(response: Response): Promise<BlenderStatus> {
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as BlenderStatus
}

/** A text message of the viewport socket. */
interface ViewMessage {
  type: string
  linked?: boolean
  state?: BlenderState | null
  width?: number
  height?: number
  mime?: string
}

/**
 * The page's one viewport socket, shared by every mounted view: opened for the first listener, reopened two seconds
 * after it drops while a listener remains, and closed after the last one leaves. A frame message names the size and
 * format of the binary message that follows it.
 */
class SharedViewer {
  private readonly listeners = new Set<ViewListener>()
  private socket: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private pending: { width: number; height: number; mime: string } | null = null

  watch(listener: ViewListener): () => void {
    this.listeners.add(listener)
    if (this.socket === null && this.retry === null) this.open()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size > 0) return
      if (this.retry !== null) clearTimeout(this.retry)
      this.retry = null
      const socket = this.socket
      this.socket = null
      socket?.close()
    }
  }

  send(command: ViewCommand): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'view', ...command }))
  }

  private open(): void {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${scheme}://${window.location.host}${VIEW_PATH}`)
    socket.binaryType = 'blob'
    this.socket = socket
    socket.addEventListener('message', (event: MessageEvent<string | Blob>) => {
      if (typeof event.data !== 'string') {
        const meta = this.pending
        this.pending = null
        if (meta === null) return
        const image = new Blob([event.data], { type: meta.mime })
        for (const listener of this.listeners) listener.frame({ image, width: meta.width, height: meta.height })
        return
      }
      const message = JSON.parse(event.data) as ViewMessage
      if (message.type === 'status') {
        for (const listener of this.listeners) listener.status(message.linked === true, message.state ?? null)
      } else if (message.type === 'frame') {
        this.pending = { width: message.width ?? 0, height: message.height ?? 0, mime: message.mime ?? 'image/jpeg' }
      }
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.pending = null
      for (const listener of this.listeners) listener.status(false, null)
      if (this.listeners.size > 0) {
        this.retry = setTimeout(() => {
          this.retry = null
          if (this.listeners.size > 0) this.open()
        }, 2000)
      }
    })
  }
}

const viewer = new SharedViewer()
const client = new DvClient()

/** The bridge over same-origin `fetch` with the session cookie, and the page's shared viewport socket. */
export const httpBlenderSource: BlenderSource = {
  status: async () => json(await fetch(STATUS_ROUTE)),
  regenerate: async () => json(await fetch(TOKEN_ROUTE, { method: 'POST' })),
  watch: listener => viewer.watch(listener),
  navigate: (command) => { viewer.send(command) },
  place: async () => {
    const project = getCurrentProject()
    if (project === null) throw new Error('no project is open')
    await client.runOperation({ project, operation: VIEWPORT_OPERATION, params: {}, surface: 'canvas' })
  },
  addon: async () => {
    const response = await fetch(ADDON_ROUTE)
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    return await response.blob()
  },
  get origin() {
    return window.location.origin
  },
}

/**
 * Whether an add-on version moves the view on request: 0.2.0 and later.
 * @param version - the add-on's reported version, such as `0.2.0`.
 * @returns whether it accepts view changes.
 */
export function addonNavigates(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(part => Number.parseInt(part, 10) || 0)
  return major > 0 || minor >= 2
}
