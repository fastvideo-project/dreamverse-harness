/**
 * Boot the bundle with the Reactor plugin over the SDK stand-in of `fixtures/reactor/` (streaming models) and the fake
 * Clip Generation API of the provider tests (`installFakeReactor`), and reach its catalog route.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { expect, vi } from 'vitest'
import { bootBundle, type Bundle } from './bundle.ts'

const fixture = fileURLToPath(new URL('./fixtures/reactor/', import.meta.url))
const booted: Bundle[] = []

/** The key of the default model of the specs. */
export const model = { modality: 'video', provider: 'reactor', model: 'fast-h3-omni' } as const

/** Dispose every bundle that `boot` started. */
export async function disposeBooted(): Promise<void> {
  vi.unstubAllGlobals()
  for (const app of booted.splice(0).reverse()) await app.dispose()
}

/**
 * Boot the bundle with the Reactor row configured by `reactor` and the SDK stand-in on the Python path.
 * @param reactor - config of the `dv-reactor` row; empty registers every bundled profile.
 * @returns the bundle, the trace and recording paths of the stand-in, and a reader for the trace rows.
 */
export async function boot(reactor: Record<string, unknown> = {}) {
  const app = await bootBundle({}, undefined, {
    'dv-reactor': { config: reactor }, credentials: { config: { REACTOR_API_KEY: 'rk_fixture' } },
  })
  booted.push(app)
  const { dir } = app
  const trace = join(dir, 'reactor.jsonl')
  const recording = join(dir, 'fixture.ts')
  vi.stubEnv('PYTHONPATH', fixture)
  vi.stubEnv('DV_REACTOR_TRACE', trace)
  vi.stubEnv('DV_REACTOR_RECORDING', recording)
  vi.stubEnv('REACTOR_API_KEY', 'rk_should_not_reach_child_environment')
  const readTrace = (): Array<Record<string, unknown>> => readFileSync(trace, 'utf8').trim().split('\n').map(row => JSON.parse(row) as Record<string, unknown>)
  return { ...app, trace, recording, readTrace }
}

const catalogUrl = 'http://dsh.local/api/dv/reactor/catalog'

/** Mount a connection stand-in after boot so the plugin registers its catalog route, and return that route's fetch. */
export async function catalogRoute(reactor: Record<string, unknown> = {}): Promise<(signal?: AbortSignal) => Promise<Response>> {
  const { ctx } = await boot(reactor)
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => {
    routes.set(route.path, route)
    return () => { routes.delete(route.path); return Promise.resolve() }
  } } } as never)
  await vi.waitFor(() => { expect(routes.has('/api/dv/reactor/catalog')).toBe(true) })
  const route = routes.get('/api/dv/reactor/catalog')!
  expect(route.methods).toEqual(['GET'])
  return signal => route.fetch(new Request(catalogUrl, signal === undefined ? {} : { signal }))
}
