/**
 * The browser's Fetch routes of the Blender bridge, behind the Connection's authentication:
 * - `GET /api/dv/blender/status`: whether a Blender is connected, the add-on's state, the pairing token, the path of the
 *   Blender link, and the number of viewport viewers;
 * - `POST /api/dv/blender/token`: a new pairing token, which disconnects the connected Blender;
 * - `GET /api/dv/blender/view`: an event stream of the viewport, with `status` events and `frame` events whose `data`
 *   is the base64 JPEG or PNG named by `mime`; a viewer that has not read the previous frames skips frames instead of queueing them;
 * - `GET /api/dv/blender/addon.zip`: the DreamVerse add-on as a Blender extension zip.
 *
 * @module @fastvideo/dreamverse-blender-bridge/routes
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { zipSync } from 'fflate'
import type { BlenderLink, ViewEvent } from './link.ts'
import type { BlenderState } from './protocol.ts'
import type { PairingToken } from './token.ts'

/** The path of the Blender link, where the add-on connects. */
export const LINK_PATH = '/dv/blender/ws'
export const STATUS_ROUTE = '/api/dv/blender/status'
export const TOKEN_ROUTE = '/api/dv/blender/token'
export const VIEW_ROUTE = '/api/dv/blender/view'
export const ADDON_ROUTE = '/api/dv/blender/addon.zip'

/** What the status route answers. */
export interface BlenderStatus {
  linked: boolean
  state: BlenderState | null
  token: string
  link_path: string
  viewers: number
}

/**
 * The add-on folder's files as a zip whose root holds `blender_manifest.toml`, read on every download so an edited
 * add-on is served without a restart. Python caches are left out.
 * @param dir - the add-on folder.
 * @returns the zip bytes.
 */
export function zipAddon(dir: string): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else files[relative(dir, path).split('\\').join('/')] = readFileSync(path)
    }
  }
  walk(dir)
  // A copy, because a Fetch Response body takes only bytes backed by an ArrayBuffer.
  return zipSync(files, { level: 6 }).slice()
}

function sse(event: ViewEvent): string {
  if (event.type === 'status') return `event: status\ndata: ${JSON.stringify({ linked: event.linked, state: event.state })}\n\n`
  const data = Buffer.from(event.data.buffer, event.data.byteOffset, event.data.byteLength).toString('base64')
  return `event: frame\ndata: ${JSON.stringify({ seq: event.seq, width: event.width, height: event.height, mime: event.mime, data })}\n\n`
}

/**
 * The routes; see the module comment.
 * @param link - the Blender link.
 * @param token - the pairing token.
 * @param options - the add-on folder and the keepalive interval of the view stream.
 * @returns the Fetch routes.
 */
export function bridgeRoutes(
  link: BlenderLink, token: PairingToken, options: { addonDir: string; pingMs: number },
): ConnectionFetchRoute[] {
  const status = async (): Promise<BlenderStatus> => ({
    linked: link.linked, state: link.state, token: await token.current(), link_path: LINK_PATH, viewers: link.viewerCount,
  })
  const view = (request: Request): Response => {
    const encoder = new TextEncoder()
    let stop = (): void => {}
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const unwatch = link.watch((event) => {
          // A frame waits only while the viewer has room; a status change always goes through.
          if (event.type === 'frame' && (controller.desiredSize ?? 0) <= 0) return
          controller.enqueue(encoder.encode(sse(event)))
        })
        const pings = setInterval(() => { controller.enqueue(encoder.encode(': ping\n\n')) }, options.pingMs)
        pings.unref()
        stop = () => {
          clearInterval(pings)
          unwatch()
        }
        request.signal.addEventListener('abort', () => {
          stop()
          try {
            controller.close()
          } catch {
            // The stream was already cancelled by the reader.
          }
        }, { once: true })
      },
      cancel: () => { stop() },
    }, { highWaterMark: 2 })
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }
  return [
    { path: STATUS_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: async () => Response.json(await status()) },
    {
      path: TOKEN_ROUTE, methods: ['POST'], requestBody: 'buffered',
      fetch: async () => {
        await token.regenerate()
        link.close(4001, 'The pairing token was replaced; paste the new connection string in the add-on.')
        return Response.json(await status())
      },
    },
    { path: VIEW_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: request => Promise.resolve(view(request)) },
    {
      path: ADDON_ROUTE, methods: ['GET'], requestBody: 'buffered',
      fetch: () => Promise.resolve(new Response(zipAddon(options.addonDir), {
        headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="dreamverse_blender.zip"' },
      })),
    },
  ]
}
