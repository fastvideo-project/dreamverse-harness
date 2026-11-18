/** Real HTTP workers verify routing, credentials, reservations and configuration validation. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import DvHardware, { validateWorkers, type WorkerConfig } from '../src/index.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import Schema from '@deepseek-ai/schemastery'
import { volatileForm } from '../../../settings/settings/src/schema.ts'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

const worker = (baseUrl: string): WorkerConfig => ({ label: 'GPU worker', provider: 'fastvideo', transport: 'api',
  baseUrl, credentialRef: '', enabled: true, sshHost: '', remoteHost: '127.0.0.1', remotePort: 18000 })

async function endpoint() {
  const authorizations: Array<string | undefined> = []
  const server = createServer((request, response) => { authorizations.push(request.headers.authorization)
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true })) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
  })
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, authorizations }
}

async function boot(workers: Record<string, WorkerConfig>) {
  const ctx = new Context()
  const credentials = ctx.plugin(MemoryCredentials)
  await credentials
  const mounted = ctx.plugin(DvHardware, { workers, connectionTimeoutMs: 1000 })
  await mounted
  cleanup.push(async () => { await mounted.dispose(); await credentials.dispose() })
  return ctx
}

describe('generation hardware', () => {
  it('gives the operator live inspection and explicit placement instructions without connection secrets', async () => {
    const ctx = await boot({ gpu: { ...worker('https://private-worker.example'), label: 'GPU {{literal}}', credentialRef: 'PRIVATE_REF' } })
    const prompt = ctx.plugin(SystemPrompt)
    await prompt
    cleanup.push(async () => { await prompt.dispose() })
    const text = renderPrompt(await ctx.systemPrompt.assemble())
    expect(text).toContain('call dv_hardware_list immediately')
    expect(text).toContain('pass the worker ID as worker')
    expect(text).toContain('A pinned operation never falls back')
    expect(text).toContain('GPU {{literal}}')
    expect(text).toContain('"id":"gpu"')
    expect(text).not.toContain('private-worker.example')
    expect(text).not.toContain('PRIVATE_REF')
  })

  it('round-trips the editable worker schema through the actual settings projection', () => {
    const schema = volatileForm(DvHardware.Config)!
    const wire = JSON.parse(JSON.stringify(schema.toJSON())) as Partial<Schema>
    const restored = new Schema(wire)
    expect(restored({ workers: { gpu: worker('https://gpu.example') } })).toMatchObject({ workers: { gpu: { label: 'GPU worker' } } })
  })

  it('validates unique endpoints and rejects executable SSH coordinates and URL credentials', () => {
    const api = worker('https://gpu.example')
    expect(validateWorkers({ gpu: api })).toBe(true)
    expect(validateWorkers({ a: api, b: { ...api, baseUrl: 'https://gpu.example/' } })).toBe(false)
    expect(validateWorkers({ gpu: { ...api, baseUrl: 'https://secret@gpu.example' } })).toBe(false)
    expect(validateWorkers({ gpu: { ...api, transport: 'ssh', sshHost: '-oProxyCommand=bad' } })).toBe(false)
    expect(validateWorkers({ gpu: { ...api, transport: 'ssh', sshHost: 'gpu-server', remoteHost: 'host;bad' } })).toBe(false)
    expect(validateWorkers({ gpu: { ...api, transport: 'ssh', sshHost: 'gpu-server' } })).toBe(true)
  })

  it('resolves credentials per request, keeps keys out of inventory, and refuses endpoint changes', async () => {
    const first = await endpoint()
    const second = await endpoint()
    const ctx = await boot({ gpu: { ...worker(first.url), credentialRef: 'GPU_KEY' } })
    await ctx.credentials.set(credentialRef('GPU_KEY'), 'first-token')
    const connection = ctx.dvHardware.workers('fastvideo')[0]!
    await (await connection.fetch(new URL('/health', connection.baseUrl))).json()
    await ctx.credentials.set(credentialRef('GPU_KEY'), 'second-token')
    await (await connection.fetch(new URL('/health', connection.baseUrl))).json()
    expect(first.authorizations).toEqual(['Bearer first-token', 'Bearer second-token'])
    expect(JSON.stringify(ctx.dvHardware.list())).not.toContain('token')
    await expect(connection.fetch(second.url)).rejects.toThrow('cannot change its endpoint')
    expect(second.authorizations).toHaveLength(0)
  })

  it('checks enabled workers and holds one reservation per worker until its owner releases it', async () => {
    const server = await endpoint()
    const ctx = await boot({ a: worker(server.url), b: { ...worker(server.url + '/b'), enabled: false } })
    expect(ctx.dvHardware.workers('fastvideo').map(value => value.id)).toEqual(['a'])
    expect((await ctx.dvHardware.check()).map(value => value.status)).toEqual(['ready', 'disabled'])
    const release = ctx.dvHardware.reserve('a')!
    expect(ctx.dvHardware.reserve('a')).toBeNull()
    expect(ctx.dvHardware.reserve('b')).toBeNull()
    expect(ctx.dvHardware.list()[0]?.status).toBe('busy')
    release()
    const next = ctx.dvHardware.reserve('a')!
    release()
    expect(ctx.dvHardware.reserve('a')).toBeNull()
    next()
    expect(ctx.dvHardware.list()[0]?.status).toBe('ready')
  })

  it('reports a missing credential as unreachable without sending an unauthenticated request', async () => {
    const server = await endpoint()
    const ctx = await boot({ gpu: { ...worker(server.url), credentialRef: 'MISSING_KEY' } })
    expect((await ctx.dvHardware.check())[0]?.status).toBe('unreachable')
    expect(server.authorizations).toHaveLength(0)
  })

  it('uses the provider inspector for resident model state', async () => {
    const server = await endpoint()
    const ctx = await boot({ gpu: worker(server.url) })
    const dispose = ctx.dvHardware.registerInspector('fastvideo', async () => ({ reachable: true, busy: false,
      loadedModel: 'my-model', loadingModel: null }))
    expect((await ctx.dvHardware.check())[0]).toMatchObject({ loadedModel: 'my-model', status: 'ready' })
    dispose()
  })

  it('refuses an invalid inventory at settings save time', async () => {
    const { ctx } = await configurationFixture({
      hmr: false,
      schema: Schema.object({ ...DvHardware.Config.dict, ordinary: Schema.string() }),
      apply: (probe, config) => {
        if ((config as { ordinary: string }).ordinary !== 'fixed') return
        probe.plugin(MemoryCredentials)
        probe.inject(['credentials'], (scope) => { new DvHardware(scope, config as DvHardware['config']) })
      },
    })
    const save = async (id: string, value: object) => {
      const revision = ctx.settings.describe().find(row => row.ns === 'first')!.revision
      await ctx.settings.mutate('first', [{ op: 'set', path: ['workers', id], value }], revision)
    }
    await save('a', { label: 'Local' })
    await expect(save('b', { label: 'Local 2' })).rejects.toThrow('invalid or duplicate endpoints')
    await expect(save('remote', { label: 'Remote', transport: 'ssh', sshHost: '' })).rejects.toThrow('invalid or duplicate endpoints')
    expect(Object.keys((ctx.settings.describe().find(row => row.ns === 'first')!.value as { workers: object }).workers)).toEqual(['a'])
  })

  it('keeps the inventory and prompt when a live edit would duplicate an endpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(SystemPrompt)
    cleanup.push(async () => { await ctx.fiber.dispose() })
    const a = worker('http://127.0.0.1:18000')
    const live = await liveConfig(ctx, DvHardware, { workers: { a }, connectionTimeoutMs: 1000 })
    await expect(live.update({ workers: { a, b: { ...a, label: 'Copy' } } })).rejects.toThrow('invalid or duplicate endpoints')
    expect(ctx.dvHardware.list().map(value => value.id)).toEqual(['a'])
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('"id":"a"')
  })

  for (const [name, workers] of [
    ['duplicate endpoints', { a: worker('http://127.0.0.1:18000'), b: { ...worker('http://127.0.0.1:18000'), label: 'Copy' } }],
    ['an empty SSH host', { remote: { ...worker('http://127.0.0.1:18000'), transport: 'ssh' as const } }],
  ] as const) {
    it(`boots with a stored inventory containing ${name} and refuses admission`, async () => {
      const ctx = await boot(workers)
      const prompt = ctx.plugin(SystemPrompt)
      await prompt
      cleanup.push(async () => { await prompt.dispose() })
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Worker configuration contains invalid or duplicate endpoints.')
      expect(() => ctx.dvHardware.workers('fastvideo')).toThrow('invalid or duplicate endpoints')
    })
  }

  it.skipIf(!process.env['DV_HARDWARE_SSH_TEST_HOST'])('reads a real worker through the configured key-only SSH alias', async () => {
    const ctx = await boot({ remote: { ...worker('http://unused.invalid'), transport: 'ssh',
      sshHost: process.env['DV_HARDWARE_SSH_TEST_HOST']! } })
    const connection = ctx.dvHardware.workers('fastvideo')[0]!
    const response = await connection.fetch(new URL('/v1/model_state', connection.baseUrl), { signal: AbortSignal.timeout(15000) })
    const state: unknown = await response.json()
    expect(response.ok).toBe(true)
    expect(state).toMatchObject({ managed: true })
  })
})
