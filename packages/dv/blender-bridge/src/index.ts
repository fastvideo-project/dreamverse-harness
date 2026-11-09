/**
 * The Blender component of DreamVerse as the `dvBlender` Cordis service: the link to the user's Blender, which the
 * DreamVerse add-on opens from Blender to the harness, on the laptop through the same SSH tunnel as the browser or on
 * the harness's own machine.
 *
 * - The link `/dv/blender/ws` is a WebSocket upgrade route of the web server. It admits a request that presents the
 *   pairing token as `Authorization: Bearer <token>` and carries no `Origin` header, which every browser sends, so a web
 *   page cannot open it. One Blender is connected at a time; a newer one replaces it.
 * - The agent tools `dv_blender_scene`, `dv_blender_run` and `dv_blender_look` (see `tools.ts`).
 * - The operations `blender.render` and `blender.animation_render` (see `render.ts`), registered while `dvProject` is
 *   mounted, which put renders of the scene camera into the project.
 * - The viewport route `/dv/blender/view`, a WebSocket upgrade route admitted by the Connection's browser checks: a
 *   text message `{type: 'status', linked, state}` at once and at every change, and per frame a text message
 *   `{type: 'frame', seq, width, height, mime}` followed by one binary message with the JPEG or PNG. A viewer with more
 *   than {@link VIEWER_BACKLOG_BYTES} unsent skips frames. A viewer's text message `{type: 'view', ...}` (a
 *   {@link ViewCommand}) moves the view of Blender's main 3D viewport; a message that does not parse is dropped. A
 *   WebSocket does not hold one of the browser's few HTTP/1.1 connections to the harness, which a long-lived HTTP
 *   stream would.
 * - The `blender.viewport` operation (see `viewport-node.ts`), registered while `dvProject` and `dvCanvasNodes` are
 *   mounted, whose record puts the viewport on the project canvas as a node; each render record makes a take node of kind
 *   `blender` on the canvas.
 * - The browser's Fetch routes (see `routes.ts`): status, pairing token and the add-on download.
 *
 * @module @fastvideo/dreamverse-blender-bridge
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import type {} from '@dv/canvas'
import type {} from '@dv/project'
import WebSocket, { WebSocketServer } from 'ws'
import { BlenderLink, type ViewEvent } from './link.ts'
import { parseViewCommand, type ViewCommand } from './protocol.ts'
import { ANIMATION_OPERATION, animationOperation, STILL_OPERATION, stillOperation } from './render.ts'
import { bridgeRoutes, LINK_PATH, VIEW_PATH } from './routes.ts'
import { PairingToken } from './token.ts'
import { registerTools } from './tools.ts'
import { renderMaker, viewportMaker, viewportOperation } from './viewport-node.ts'

export { BlenderLink, NOT_LINKED, type BlenderReply, type ViewEvent } from './link.ts'
export {
  encodeBinary, parseBlenderBinary, parseBlenderText, parseViewCommand, VIEW_COMMAND_LIMIT, VIEW_PRESETS,
  type BlenderOp, type BlenderState, type FrameMime, type ViewCommand, type ViewPreset,
} from './protocol.ts'
export { ADDON_ROUTE, LINK_PATH, STATUS_ROUTE, TOKEN_ROUTE, VIEW_PATH, bridgeRoutes, zipAddon, type BlenderStatus } from './routes.ts'
export { LOOK_TOOL, RUN_TOOL, SCENE_TOOL, lookContent, type LookValue } from './tools.ts'
export { RENDER_KIND, renderMaker, VIEWPORT_KIND, VIEWPORT_OPERATION, viewportMaker, viewportOperation } from './viewport-node.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Blender component: the link to the user's Blender, its tools and render operations. */
    dvBlender: DvBlender
  }
}

/** `dvBlender` plugin configuration. */
export interface Config {
  /** How long a scene read, a code run or a look waits for Blender, in ms. */
  requestTimeoutMs: number
  /** How long a render waits for Blender, in ms. */
  renderTimeoutMs: number
  /** The most bytes one file from Blender (a look or a render) may hold. */
  maxFileBytes: number
  /** Interval of the keepalive pings on the link and the viewport stream, in ms. */
  pingMs: number
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  requestTimeoutMs: z.natural().min(1).default(60_000),
  renderTimeoutMs: z.natural().min(1).default(1_800_000),
  maxFileBytes: z.natural().min(1).default(536_870_912),
  pingMs: z.natural().min(1).default(20_000),
})

/** A viewer socket with more bytes than this waiting to be sent skips frames until it catches up. */
export const VIEWER_BACKLOG_BYTES = 1_048_576

/**
 * Send one viewport event to a viewer socket: a status always, a frame (its text message, then its bytes) only while
 * fewer than {@link VIEWER_BACKLOG_BYTES} wait to be sent.
 * @param viewer - the socket's unsent byte count and its send.
 * @param event - the event.
 * @returns whether the event was sent.
 */
export function relayView(viewer: Pick<WebSocket, 'bufferedAmount' | 'send'>, event: ViewEvent): boolean {
  if (event.type === 'status') {
    viewer.send(JSON.stringify({ type: 'status', linked: event.linked, state: event.state }))
    return true
  }
  if (viewer.bufferedAmount > VIEWER_BACKLOG_BYTES) return false
  viewer.send(JSON.stringify({ type: 'frame', seq: event.seq, width: event.width, height: event.height, mime: event.mime }))
  viewer.send(event.data)
  return true
}

/** The add-on folder that ships beside `src/` and `lib/`. */
const ADDON_DIR = fileURLToPath(new URL('../addon', import.meta.url))

/**
 * Answer a refused upgrade with a plain HTTP status and close the socket.
 * @param socket - the upgrade socket.
 * @param status - the status code.
 * @param text - the status text.
 */
function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${String(status)} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/** The Blender service; see the module comment. */
export default class DvBlender extends Service {
  static Config = Config

  /** The link to the connected Blender. */
  readonly link: BlenderLink
  /** The pairing token a Blender presents. */
  readonly token: PairingToken
  private readonly sockets = new WebSocketServer({ noServer: true })
  private readonly viewers = new Set<WebSocket>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dvBlender')
    this.link = new BlenderLink({ maxFileBytes: config.maxFileBytes, pingMs: config.pingMs }, (message) => { ctx.logger('dvBlender').warn(message) })
    this.token = new PairingToken(() => ctx.get('credentials'))
    ctx.effect(() => () => {
      this.link.close(1001, 'The harness is shutting down.')
      for (const viewer of this.viewers) viewer.close(1001)
      this.sockets.close()
    }, 'dvBlender link')
    ctx.inject(['webServer'], (web) => {
      web.effect(() => web.webServer.registerUpgrade({
        path: LINK_PATH,
        handler: (request, socket, head) => this.admit(request, socket, head),
      }), `dvBlender ${LINK_PATH}`)
      web.effect(() => web.webServer.registerUpgrade({
        path: VIEW_PATH,
        handler: (request, socket, head) => { this.watch(web, request, socket, head) },
      }), `dvBlender ${VIEW_PATH}`)
    })
    ctx.inject(['connection'], (connected) => {
      for (const route of bridgeRoutes(this.link, this.token, { addonDir: ADDON_DIR })) {
        connected.effect(() => {
          const dispose = connected.connection.fetch.register(route)
          return () => { void dispose() }
        }, `dvBlender ${route.path}`)
      }
    })
    registerTools(ctx, this.link, { requestTimeoutMs: config.requestTimeoutMs })
    ctx.inject(['dvProject'], (projected) => {
      projected.effect(() => projected.dvProject.registerComponent('blender'), 'dvBlender component')
      projected.effect(() => projected.dvProject.registerOperation(stillOperation(this.link, config)), 'dvBlender blender.render')
      projected.effect(() => projected.dvProject.registerOperation(animationOperation(this.link, config)), 'dvBlender blender.animation_render')
    })
    // The viewport operation reads the canvas's node list, so it exists only beside the canvas.
    ctx.inject(['dvProject', 'dvCanvasNodes'], (canvas) => {
      canvas.effect(() => canvas.dvProject.registerOperation(viewportOperation()), 'dvBlender blender.viewport')
      canvas.effect(() => canvas.dvCanvasNodes.registerMaker(viewportMaker), 'dvBlender viewport node')
      canvas.effect(() => canvas.dvCanvasNodes.registerMaker(renderMaker([STILL_OPERATION, ANIMATION_OPERATION])), 'dvBlender render nodes')
    })
  }

  /**
   * Admit one link request; see the module comment.
   * @param request - the upgrade request.
   * @param socket - its socket.
   * @param head - the bytes after the request head.
   */
  private async admit(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (request.headers.origin !== undefined) {
      refuse(socket, 403, 'Forbidden')
      return
    }
    const presented = /^Bearer (\S+)$/u.exec(request.headers.authorization ?? '')?.[1]
    if (presented === undefined || !await this.token.matches(presented)) {
      refuse(socket, 401, 'Unauthorized')
      return
    }
    this.sockets.handleUpgrade(request, socket, head, (websocket) => { this.link.attach(websocket) })
  }

  /**
   * Admit one viewer when the Connection accepts the request (or no Connection is mounted), then send it the viewport.
   * @param web - the context that holds the web server and the optional Connection.
   * @param request - the upgrade request.
   * @param socket - its socket.
   * @param head - the bytes after the request head.
   */
  private watch(web: Context, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const rejection = web.get('connection')?.requestRejection({ headers: request.headers })
    if (rejection !== undefined) {
      refuse(socket, rejection, rejection === 401 ? 'Unauthorized' : 'Forbidden')
      return
    }
    this.sockets.handleUpgrade(request, socket, head, (viewer) => {
      this.viewers.add(viewer)
      const unwatch = this.link.watch((event) => { relayView(viewer, event) })
      const pings = setInterval(() => { viewer.ping() }, this.config.pingMs)
      pings.unref()
      viewer.on('close', () => {
        clearInterval(pings)
        unwatch()
        this.viewers.delete(viewer)
      })
      viewer.on('message', (data, isBinary) => {
        const text = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
        const command: ViewCommand | null = isBinary ? null : parseViewCommand(text.toString())
        if (command !== null) this.link.navigate(command)
      })
      viewer.on('error', (error) => { this.ctx.logger('dvBlender').warn('blender viewer error: %s', error.message) })
    })
  }
}
