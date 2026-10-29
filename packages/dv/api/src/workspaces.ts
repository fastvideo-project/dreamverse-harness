/**
 * DreamVerse projects as DSH Workspaces, for the browser. A project's Workspace ID is its project ID, so the chat
 * sessions of a project are the sessions of that Workspace.
 *
 * Routes:
 * - `GET /api/dv/workspaces` returns `{entry_path, projects: [{id, title, created_at, path, workspace_id}]}`, where
 *   `entry_path` is the directory of the Workspace that replaces DSH's first-use default Workspace.
 *
 * @module @dv/api/workspaces
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type DvProject from '@dv/project'
import { answer } from './api.ts'

/** The Fetch route paths. */
export const WORKSPACE_ROUTES = {
  workspaces: '/api/dv/workspaces',
} as const

/**
 * The project ↔ Workspace Fetch routes.
 * @param project - the Project service, for the project list.
 * @param stateRoot - the state directory.
 * @returns the routes.
 */
export function workspaceRoutes(project: DvProject, stateRoot: string): ConnectionFetchRoute[] {
  const list = (): unknown => {
    const projects = project.listProjects()
    const entryPath = join(stateRoot, 'entry')
    mkdirSync(entryPath, { recursive: true })
    return {
      entry_path: entryPath,
      projects: projects.map(info => ({
        id: info.id, title: info.title, created_at: info.created_at,
        path: info.path, workspace_id: info.id,
      })),
    }
  }
  return [{ path: WORKSPACE_ROUTES.workspaces, methods: ['GET'], requestBody: 'buffered', fetch: () => answer(list) }]
}
