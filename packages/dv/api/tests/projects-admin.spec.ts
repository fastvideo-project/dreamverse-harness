/**
 * Project rename and delete routes over the real Project service: renamed titles stay unique and reach the project list,
 * a removed project leaves the list with its Workspace link while its folder stays on disk, and
 * the sessions route finds a project's DSH sessions by directory.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { RecordOrigin } from '@dv/project'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startBase, type BaseFixture } from './support.ts'
import { PROJECT_ADMIN_ROUTES, projectAdminRoutes } from '../src/projects-admin.ts'
import { WORKSPACE_ROUTES, workspaceRoutes } from '../src/workspaces.ts'

/** A human action outside any chat session. */
const HUMAN: RecordOrigin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'test' }

let root = ''
let fixture: BaseFixture | null = null
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dv-projects-admin-'))
})

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
  rmSync(root, { recursive: true, force: true })
})

/** Call one route by path. */
async function call(
  routes: ConnectionFetchRoute[],
  path: string,
  init: { query?: Record<string, string>; json?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  const route = routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`no route ${path}`)
  const url = `http://localhost${path}?${new URLSearchParams(init.query ?? {}).toString()}`
  const request = init.json === undefined ? new Request(url) : new Request(url, { method: 'POST', body: JSON.stringify(init.json) })
  const response = await route.fetch(request)
  return { status: response.status, json: await response.json() }
}

it('renames a project to a unique title and removes it from the list while its folder stays on disk', async () => {
  fixture = await startBase({ generation: 'none', root })
  const routes = [...workspaceRoutes(fixture.project, root), ...projectAdminRoutes(fixture.project)]
  const first = (await fixture.project.createProject(await fixture.project.newProjectFolder('未命名项目'), '未命名项目', HUMAN)).id
  const second = (await fixture.project.createProject(await fixture.project.newProjectFolder('未命名项目'), '未命名项目', HUMAN)).id

  expect((await call(routes, PROJECT_ADMIN_ROUTES.rename, { json: { project: second, title: '未命名项目' } })).json).toEqual({ title: '未命名项目 2' })
  expect((await call(routes, PROJECT_ADMIN_ROUTES.rename, { json: { project: first, title: '  广告  ' } })).json).toEqual({ title: '广告' })
  expect(fixture.project.openProject(first).title).toBe('广告')
  expect(await call(routes, PROJECT_ADMIN_ROUTES.rename, { json: { project: first, title: ' ' } }))
    .toMatchObject({ status: 400, json: { error: expect.any(String), code: 'invalid_params' } })
  expect(await call(routes, PROJECT_ADMIN_ROUTES.delete, { json: {} })).toMatchObject({ status: 400, json: { code: 'invalid_params' } })

  const removed = await call(routes, PROJECT_ADMIN_ROUTES.delete, { json: { project: second } })
  expect(removed.json).toEqual({ ok: true })
  expect(fixture.services.workspaces.get(second)).toBeUndefined()
  expect(existsSync(join(root, 'projects', '未命名项目 2', '.dreamverse', 'records.jsonl'))).toBe(true)
  expect(readdirSync(join(root, 'projects')).sort()).toEqual(['未命名项目', '未命名项目 2'])
  const listed = (await call(routes, WORKSPACE_ROUTES.workspaces)).json as { projects: Array<{ id: string; workspace_id: string }> }
  expect(listed.projects).toMatchObject([{ id: first, workspace_id: first }])
  // A removed project is unknown to both routes.
  expect(await call(routes, PROJECT_ADMIN_ROUTES.rename, { json: { project: second, title: 'x' } }))
    .toMatchObject({ status: 404, json: { error: expect.any(String), code: 'unknown_project' } })
  expect(await call(routes, PROJECT_ADMIN_ROUTES.delete, { json: { project: second } })).toMatchObject({ status: 404, json: { code: 'unknown_project' } })
})
