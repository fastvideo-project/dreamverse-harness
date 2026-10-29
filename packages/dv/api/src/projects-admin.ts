/**
 * Project removal and renaming for the DreamVerse shell, through `dvProject`. Removal unregisters the project's DSH
 * Workspace, after which the project is no longer listed; its folder stays on disk, so adding the folder again
 * restores the project. The project's canvas layout file is view state and is deleted.
 *
 * Routes:
 * - `POST /api/dv/projects/delete` with `{project}` removes the project and deletes its canvas layout file, and
 *   returns `{ok}`.
 * - `POST /api/dv/projects/rename` with `{project, title}` stores a title that no other project has, appending ` 2`,
 *   ` 3`, … on a clash, and returns `{title}`.
 *
 * Errors use the body `{error, code}` of every `/api/dv` route: 400 `invalid_params` for a malformed request, 404
 * `unknown_project` for an unknown project.
 *
 * @module @dv/api/projects-admin
 */
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type DvProject from '@dv/project'
import { answer, requireProject } from './api.ts'
import type { CanvasLayoutStore } from './layout.ts'

/** The Fetch route paths. */
export const PROJECT_ADMIN_ROUTES = {
  delete: '/api/dv/projects/delete',
  rename: '/api/dv/projects/rename',
} as const

/**
 * The project deletion and rename Fetch routes.
 * @param project - the Project service, which owns the project files.
 * @param layouts - the canvas layout files; removal deletes the project's file.
 * @returns the routes.
 */
export function projectAdminRoutes(project: DvProject, layouts: CanvasLayoutStore): ConnectionFetchRoute[] {
  const bodyOf = async (request: Request): Promise<Record<string, unknown>> => {
    const body: unknown = await request.json().catch(() => ({}))
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  }
  const remove = async (request: Request): Promise<unknown> => {
    const projectId = requireProject(project, (await bodyOf(request))['project'])
    await project.removeProject(projectId)
    layouts.delete(projectId)
    return { ok: true }
  }
  const rename = async (request: Request): Promise<unknown> => {
    const body = await bodyOf(request)
    const projectId = requireProject(project, body['project'])
    const info = await project.renameProject(projectId, typeof body['title'] === 'string' ? body['title'] : '')
    return { title: info.title }
  }
  const guard = (run: (request: Request) => Promise<unknown>) => (request: Request): Promise<Response> => answer(() => run(request))
  return [
    { path: PROJECT_ADMIN_ROUTES.delete, methods: ['POST'], requestBody: 'buffered', fetch: guard(remove) },
    { path: PROJECT_ADMIN_ROUTES.rename, methods: ['POST'], requestBody: 'buffered', fetch: guard(rename) },
  ]
}
