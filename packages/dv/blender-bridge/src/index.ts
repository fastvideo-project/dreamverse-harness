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
 * - The browser's Fetch routes (see `routes.ts`): status, pairing token, the viewport stream and the add-on download.
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
import type {} from '@dv/project'
import { WebSocketServer } from 'ws'
import { BlenderLink } from './link.ts'
import { animationOperation, stillOperation } from './render.ts'
import { bridgeRoutes, LINK_PATH } from './routes.ts'
import { PairingToken } from './token.ts'
import { registerTools } from './tools.ts'

export { BlenderLink, NOT_LINKED, type BlenderReply, type ViewEvent } from './link.ts'
export { encodeBinary, parseBlenderBinary, parseBlenderText, type BlenderOp, type BlenderState, type FrameMime } from './protocol.ts'
export { ADDON_ROUTE, LINK_PATH, STATUS_ROUTE, TOKEN_ROUTE, VIEW_ROUTE, bridgeRoutes, zipAddon, type BlenderStatus } from './routes.ts'
export { LOOK_TOOL, RUN_TOOL, SCENE_TOOL, lookContent, type LookValue } from './tools.ts'

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

  constructor(ctx: Context, config: Config) {
    super(ctx, 'dvBlender')
    this.link = new BlenderLink({ maxFileBytes: config.maxFileBytes, pingMs: config.pingMs }, (message) => { ctx.logger('dvBlender').warn(message) })
    this.token = new PairingToken(() => ctx.get('credentials'))
    ctx.effect(() => () => {
      this.link.close(1001, 'The harness is shutting down.')
      this.sockets.close()
    }, 'dvBlender link')
    ctx.inject(['webServer'], (web) => {
      web.effect(() => web.webServer.registerUpgrade({
        path: LINK_PATH,
        handler: (request, socket, head) => this.admit(request, socket, head),
      }), `dvBlender ${LINK_PATH}`)
    })
    ctx.inject(['connection'], (connected) => {
      for (const route of bridgeRoutes(this.link, this.token, { addonDir: ADDON_DIR, pingMs: config.pingMs })) {
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
}
