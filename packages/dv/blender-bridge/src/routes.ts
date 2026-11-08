/**
 * The browser's Fetch routes of the Blender bridge, behind the Connection's authentication:
 * - `GET /api/dv/blender/status`: whether a Blender is connected, the add-on's state, the pairing token, the path of the
 *   Blender link, and the number of viewport viewers;
 * - `POST /api/dv/blender/token`: a new pairing token, which disconnects the connected Blender;
 * - `GET /api/dv/blender/addon.zip`: the DreamVerse add-on as a Blender extension zip.
 *
 * The viewport goes to the browser over the WebSocket route `/dv/blender/view` of `index.ts` instead, because a
 * long-lived HTTP stream would hold one of the browser's few HTTP/1.1 connections to the harness.
 *
 * @module @fastvideo/dreamverse-blender-bridge/routes
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { zipSync } from 'fflate'
import type { BlenderLink } from './link.ts'
import type { BlenderState } from './protocol.ts'
import type { PairingToken } from './token.ts'

/** The path of the Blender link, where the add-on connects. */
export const LINK_PATH = '/dv/blender/ws'
export const STATUS_ROUTE = '/api/dv/blender/status'
export const TOKEN_ROUTE = '/api/dv/blender/token'
/** The WebSocket route of the viewport, where the browser watches. */
export const VIEW_PATH = '/dv/blender/view'
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

/**
 * The routes; see the module comment.
 * @param link - the Blender link.
 * @param token - the pairing token.
 * @param options - the add-on folder.
 * @returns the Fetch routes.
 */
export function bridgeRoutes(
  link: BlenderLink, token: PairingToken, options: { addonDir: string },
): ConnectionFetchRoute[] {
  const status = async (): Promise<BlenderStatus> => ({
    linked: link.linked, state: link.state, token: await token.current(), link_path: LINK_PATH, viewers: link.viewerCount,
  })
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
    {
      path: ADDON_ROUTE, methods: ['GET'], requestBody: 'buffered',
      fetch: () => Promise.resolve(new Response(zipAddon(options.addonDir), {
        headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="dreamverse_blender.zip"' },
      })),
    },
  ]
}
