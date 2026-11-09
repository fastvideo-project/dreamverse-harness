/**
 * The canvas viewport per project, so a user's pan and zoom survive reloads. The viewport is view state, not project
 * history: it lives in `<project folder>/.dreamverse/canvas-layout.json` and is never written as records, so undo never
 * pans or zooms. Node positions are project content in the `canvas` slice of `@dv/canvas`. A project ID is the ID of
 * the DSH Workspace whose folder holds the project, so the store finds the folder through the Workspace registry.
 *
 * Route: `GET /api/dv/canvas/layout?project=<id>` returns the stored layout; `POST /api/dv/canvas/layout` with
 * `{project, viewport}` replaces the viewport.
 * Errors use the body `{error, code}` of every `/api/dv` route: 400 `invalid_params` for a malformed project, 404
 * `unknown_project` for an ID that names no Workspace, or for a write to a folder without `.dreamverse/`.
 *
 * @module @dv/ui-canvas/layout
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { WorkspaceId, type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { PROJECT_DIR } from '@dv/project/folder'
import { CANVAS_LAYOUT_ROUTE, type CanvasLayout, type CanvasViewport } from './canvas-layout.ts'

/** The layout file's name inside the project's `.dreamverse/` directory. */
const LAYOUT_FILE = 'canvas-layout.json'

/** A refused layout request, answered with its status and code. */
export class LayoutRequestError extends Error {
  /**
   * @param status - the HTTP status.
   * @param message - the reason.
   * @param code - the error code of the `/api/dv` error body.
   */
  constructor(readonly status: 400 | 404, message: string, readonly code: 'invalid_params' | 'unknown_project') {
    super(message)
  }
}

/** One project's layout file, as JSON in the project folder. */
export class CanvasLayoutStore {
  /** @param registry - the DSH Workspace registry, which holds each project's folder. */
  constructor(private readonly registry: Pick<WorkspaceRegistry, 'get'>) {}

  /**
   * @param project - a project.
   * @returns the stored layout, or an empty one when the project has no layout file yet.
   * @throws LayoutRequestError `unknown_project` when no Workspace has the ID.
   */
  read(project: WorkspaceId): CanvasLayout {
    const file = this.path(project)
    try {
      return layoutOf(JSON.parse(readFileSync(file, 'utf8'))) ?? { viewport: null }
    } catch {
      // No file yet, or a file this version cannot read: start from an empty layout.
      return { viewport: null }
    }
  }

  /**
   * Replace the viewport, then write atomically. The store creates no directory, so a write that arrives after the user
   * deleted `.dreamverse/` recreates nothing.
   * @param project - a project.
   * @param viewport - the viewport.
   * @returns the stored layout afterwards.
   * @throws LayoutRequestError `unknown_project` when no Workspace has the ID or its folder has no `.dreamverse/`.
   */
  write(project: WorkspaceId, viewport: CanvasViewport | null): CanvasLayout {
    const target = this.path(project)
    const next: CanvasLayout = { viewport }
    try {
      writeFileSync(`${target}.tmp`, JSON.stringify(next))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LayoutRequestError(404, `Project '${project}' has no ${PROJECT_DIR} folder.`, 'unknown_project')
      throw error
    }
    renameSync(`${target}.tmp`, target)
    return next
  }

  private path(project: WorkspaceId): string {
    const workspace = this.registry.get(project)
    if (workspace === undefined) throw new LayoutRequestError(404, `Unknown project '${project}'.`, 'unknown_project')
    return join(workspace.path, PROJECT_DIR, LAYOUT_FILE)
  }
}

/**
 * The viewport in a raw JSON value, kept only with finite numbers and a positive zoom.
 * @param value - parsed JSON.
 * @returns the layout, or null when the value is not an object.
 */
export function layoutOf(value: unknown): CanvasLayout | null {
  if (typeof value !== 'object' || value === null) return null
  const rawViewport = (value as Record<string, unknown>)['viewport']
  let viewport: CanvasViewport | null = null
  if (typeof rawViewport === 'object' && rawViewport !== null) {
    const { x, y, zoom } = rawViewport as Record<string, unknown>
    if (typeof x === 'number' && typeof y === 'number' && typeof zoom === 'number' && [x, y, zoom].every(Number.isFinite) && zoom > 0) viewport = { x, y, zoom }
  }
  return { viewport }
}

/**
 * @param value - the raw project ID of a request.
 * @returns the project ID.
 * @throws LayoutRequestError `invalid_params` when it is not a project ID.
 */
function projectOf(value: unknown): WorkspaceId {
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) return WorkspaceId(value)
  throw new LayoutRequestError(400, "'project' must name a project.", 'invalid_params')
}

/**
 * @param value - the body.
 * @param status - the HTTP status.
 * @returns a JSON response with no caching.
 */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

/**
 * The layout Fetch route. GET reads, POST replaces the viewport.
 * @param store - the layout files.
 * @returns the route.
 */
export function layoutRoutes(store: CanvasLayoutStore): ConnectionFetchRoute[] {
  const handle = async (request: Request): Promise<Response> => {
    try {
      if (request.method === 'GET') return json(store.read(projectOf(new URL(request.url).searchParams.get('project'))))
      const body: unknown = await request.json().catch(() => ({}))
      const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
      const project = projectOf(record['project'])
      return json(store.write(project, layoutOf(record)?.viewport ?? null))
    } catch (error) {
      if (error instanceof LayoutRequestError) return json({ error: error.message, code: error.code }, error.status)
      return json({ error: error instanceof Error ? error.message : String(error), code: 'internal_error' }, 500)
    }
  }
  return [{ path: CANVAS_LAYOUT_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: handle }]
}
