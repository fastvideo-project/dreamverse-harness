/** The canvas layout route over project folders: read, merge, the position cap, refusals, and route disposal. */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it } from 'vitest'
import { CANVAS_LAYOUT_ROUTE } from '../src/canvas-layout.ts'
import { CANVAS_AGENT_ROUTE, CANVAS_ANSWER_ROUTE } from '../src/canvas.ts'
import * as canvas from '../src/index.ts'
import { CanvasLayoutStore, layoutRoutes } from '../src/layout.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** A registry with Workspace `p1`, a project folder, and Workspace `plain`, a folder without `.dreamverse/`. */
function registry() {
  const root = mkdtempSync(join(tmpdir(), 'dv-canvas-layout-'))
  roots.push(root)
  mkdirSync(join(root, 'p1', '.dreamverse'), { recursive: true })
  mkdirSync(join(root, 'plain'))
  const workspaces = new Map([['p1', join(root, 'p1')], ['plain', join(root, 'plain')]])
  return { root, get: (id: string) => workspaces.has(id) ? { id, path: workspaces.get(id) } as Workspace : undefined }
}

/** The route over {@link registry}. */
function route() {
  const workspaces = registry()
  const [entry] = layoutRoutes(new CanvasLayoutStore(workspaces))
  if (entry === undefined) throw new Error('no route')
  const call = async (method: 'GET' | 'POST', query: string, body?: unknown) => {
    const response = await entry.fetch(new Request(`http://host${CANVAS_LAYOUT_ROUTE}${query}`, { method, ...body === undefined ? {} : { body: JSON.stringify(body) } }))
    return { status: response.status, json: await response.json() as unknown }
  }
  return { root: workspaces.root, entry, call }
}

describe('layoutRoutes', () => {
  it('stores merged positions and the viewport in the project folder', async () => {
    const { root, entry, call } = route()
    expect(entry.methods).toEqual(['GET', 'POST'])
    expect((await call('GET', '?project=p1')).json).toEqual({ positions: {}, viewport: null })
    await call('POST', '', { project: 'p1', positions: { g1: { x: 1, y: 2 } }, viewport: { x: 0, y: 0, zoom: 1 } })
    await call('POST', '', { project: 'p1', positions: { g2: { x: 3, y: 4 }, bad: { x: 'no', y: 1 } } })
    const merged = { positions: { g1: { x: 1, y: 2 }, g2: { x: 3, y: 4 } }, viewport: { x: 0, y: 0, zoom: 1 } }
    expect((await call('GET', '?project=p1')).json).toEqual(merged)
    expect(JSON.parse(readFileSync(join(root, 'p1', '.dreamverse', 'canvas-layout.json'), 'utf8'))).toEqual(merged)
    expect(readdirSync(join(root, 'p1', '.dreamverse'))).toEqual(['canvas-layout.json'])
    // Which assets are on the canvas is project content, so the layout ignores placement fields.
    await call('POST', '', { project: 'p1', placed: ['a1'], removed: ['a2'] })
    expect((await call('GET', '?project=p1')).json).not.toHaveProperty('placed')
  })

  it('keeps a stored width through a write that sends only a position, and drops a width that is not a positive number', async () => {
    const { call } = route()
    await call('POST', '', { project: 'p1', positions: { g1: { x: 1, y: 2, width: 416 }, g2: { x: 0, y: 0, width: 0 }, g3: { x: 0, y: 0, width: 'wide' } } })
    await call('POST', '', { project: 'p1', positions: { g1: { x: 5, y: 6 } } })
    expect((await call('GET', '?project=p1')).json).toEqual({ positions: { g1: { x: 5, y: 6, width: 416 }, g2: { x: 0, y: 0 }, g3: { x: 0, y: 0 } }, viewport: null })
  })

  it('keeps at most 5000 positions', async () => {
    const { call } = route()
    const positions = (from: number, count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${String(from + i)}`, { x: i, y: i }]))
    expect((await call('POST', '', { project: 'p1', positions: positions(0, 4999) })).status).toBe(200)
    expect((await call('POST', '', { project: 'p1', positions: positions(4999, 1) })).status).toBe(200)
    expect(await call('POST', '', { project: 'p1', positions: positions(5000, 1) }))
      .toEqual({ status: 400, json: { error: 'A layout keeps at most 5000 positions.', code: 'invalid_params' } })
    expect(Object.keys(((await call('GET', '?project=p1')).json as { positions: object }).positions)).toHaveLength(5000)
  })

  it('answers 400 invalid_params without a project and 404 unknown_project for an unknown one', async () => {
    const { call } = route()
    expect(await call('GET', '')).toEqual({ status: 400, json: { error: "'project' must name a project.", code: 'invalid_params' } })
    expect(await call('GET', '?project=nope')).toEqual({ status: 404, json: { error: "Unknown project 'nope'.", code: 'unknown_project' } })
    expect(await call('POST', '', { project: 'nope', positions: {} })).toEqual({ status: 404, json: { error: "Unknown project 'nope'.", code: 'unknown_project' } })
  })

  it('refuses a write to a folder without .dreamverse and creates nothing', async () => {
    const { root, call } = route()
    expect(await call('POST', '', { project: 'plain', positions: { g1: { x: 1, y: 2 } } }))
      .toEqual({ status: 404, json: { error: "Project 'plain' has no .dreamverse folder.", code: 'unknown_project' } })
    expect(readdirSync(join(root, 'plain'))).toEqual([])
  })
})

describe('the host half', () => {
  it('registers the layout route while the Connection is mounted and removes it on dispose', async () => {
    const routes = new Map<string, ConnectionFetchRoute>()
    const connection = {
      fetch: {
        register: (entry: ConnectionFetchRoute) => {
          routes.set(entry.path, entry)
          return () => { routes.delete(entry.path); return Promise.resolve() }
        },
      },
    }
    const ctx = new Context()
    ctx.provide('workspaceRegistry', registry())
    ctx.provide('connection', connection)
    const fiber = ctx.plugin(canvas)
    await fiber.await()
    expect([...routes.keys()]).toEqual([CANVAS_LAYOUT_ROUTE, CANVAS_AGENT_ROUTE, CANVAS_ANSWER_ROUTE])
    await fiber.dispose()
    expect(routes.size).toBe(0)
  })
})
