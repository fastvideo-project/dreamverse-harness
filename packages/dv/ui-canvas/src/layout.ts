/**
 * Canvas node positions and frame sizes, and the viewport per project, so a user's arrangement survives reloads. The
 * layout is view state, not project history: it lives in
 * `<project folder>/.dreamverse/canvas-layout.json` and is never written as records, so undo never moves or resizes a
 * node. The keys of `positions` are canvas node IDs. A project ID is the ID of the DSH Workspace whose folder holds the
 * project, so the store finds the folder through the Workspace registry.
 *
 * Route: `GET /api/dv/canvas/layout?project=<id>` returns the stored layout; `POST /api/dv/canvas/layout` with
 * `{project, positions?, viewport?}` merges the given node entries into the stored ones field by field, so an entry
 * with only `x` and `y` keeps the stored `width` and `height`, and replaces the viewport.
 * Errors use the body `{error, code}` of every `/api/dv` route: 400 `invalid_params` for a malformed project or too many
 * positions, 404 `unknown_project` for an ID that names no Workspace, or for a write to a folder without `.dreamverse/`.
 *
 * @module @dv/ui-canvas/layout
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { WorkspaceId, type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { PROJECT_DIR } from '@dv/project/folder'
import { CANVAS_LAYOUT_ROUTE, type CanvasLayout, type CanvasLayoutPatch, type CanvasViewport, type LayoutEntry } from './canvas-layout.ts'

/** The layout file's name inside the project's `.dreamverse/` directory. */
const LAYOUT_FILE = 'canvas-layout.json'

/** The most node positions one project keeps; a larger request is refused. */
const MAX_POSITIONS = 5000

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
      return layoutOf(JSON.parse(readFileSync(file, 'utf8'))) ?? { positions: {}, viewport: null }
    } catch {
      // No file yet, or a file this version cannot read: start from an empty layout.
      return { positions: {}, viewport: null }
    }
  }

  /**
   * Merge node entries field by field, so an entry with only `x` and `y` keeps the stored size, replace the viewport
   * when given, then write atomically. The store creates no directory, so a write that arrives after the user deleted
   * `.dreamverse/` recreates nothing.
   * @param project - a project.
   * @param patch - the node entries to merge and the viewport, when given.
   * @returns the stored layout afterwards.
   * @throws LayoutRequestError `unknown_project` when no Workspace has the ID or its folder has no `.dreamverse/`,
   *   `invalid_params` when the merged layout would keep more than 5000 positions.
   */
  write(project: WorkspaceId, patch: CanvasLayoutPatch): CanvasLayout {
    const target = this.path(project)
    const current = this.read(project)
    const positions = { ...current.positions }
    for (const [id, entry] of Object.entries(patch.positions ?? {})) positions[id] = { ...positions[id], ...entry }
    const next: CanvasLayout = { positions, viewport: patch.viewport === undefined ? current.viewport : patch.viewport }
    if (Object.keys(next.positions).length > MAX_POSITIONS) {
      throw new LayoutRequestError(400, `A layout keeps at most ${String(MAX_POSITIONS)} positions.`, 'invalid_params')
    }
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
 * The positions and viewport in a raw JSON value, keeping only finite numbers: an entry with finite `x` and `y`, and
 * its `width` and `height` when each is a finite positive number.
 * @param value - parsed JSON.
 * @returns the layout, or null when the value is not an object.
 */
export function layoutOf(value: unknown): CanvasLayout | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const positions: Record<string, LayoutEntry> = {}
  const rawPositions = record['positions']
  const size = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw) && raw > 0
  if (typeof rawPositions === 'object' && rawPositions !== null) {
    for (const [id, position] of Object.entries(rawPositions as Record<string, unknown>)) {
      if (typeof position !== 'object' || position === null) continue
      const { x, y, width, height } = position as Record<string, unknown>
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue
      positions[id] = { x, y, ...size(width) ? { width } : {}, ...size(height) ? { height } : {} }
    }
  }
  const rawViewport = record['viewport']
  let viewport: CanvasViewport | null = null
  if (typeof rawViewport === 'object' && rawViewport !== null) {
    const { x, y, zoom } = rawViewport as Record<string, unknown>
    if (typeof x === 'number' && typeof y === 'number' && typeof zoom === 'number' && [x, y, zoom].every(Number.isFinite) && zoom > 0) viewport = { x, y, zoom }
  }
  return { positions, viewport }
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
 * The layout Fetch route. GET reads, POST merges.
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
      const parsed = layoutOf(record) ?? { positions: {}, viewport: null }
      return json(store.write(project, { positions: parsed.positions, ...record['viewport'] === undefined ? {} : { viewport: parsed.viewport } }))
    } catch (error) {
      if (error instanceof LayoutRequestError) return json({ error: error.message, code: error.code }, error.status)
      return json({ error: error instanceof Error ? error.message : String(error), code: 'internal_error' }, 500)
    }
  }
  return [{ path: CANVAS_LAYOUT_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: handle }]
}
