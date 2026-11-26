/** Exercise the Reactor catalog route, the session-lifetime bound on durations, and setting updates through the bundle Loader. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boot, catalogRoute, disposeBooted, model } from './reactor-support.ts'

afterEach(async () => {
  await disposeBooted()
  vi.unstubAllGlobals()
})

describe('Reactor catalog route', () => {
  it('lists the account models with the bundled profile and the configured aliases of each', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([
      { name: 'reactor/fast-h3', status: 'active', description: 'Fast clips' }, { name: 'fixture/other', status: 'deprecated' },
    ]))
    vi.stubGlobal('fetch', fetch)
    const get = await catalogRoute({ models: { quick: { profile: 'fast-h3' }, 'fast-h3': { profile: 'fast-h3' } } })
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ models: [
      { name: 'reactor/fast-h3', status: 'active', description: 'Fast clips', profile: 'fast-h3', displayName: 'FastH3',
        shotModels: ['quick', 'fast-h3'] },
      { name: 'fixture/other', status: 'deprecated', shotModels: [] },
    ] })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer rk_fixture' } })
  })

  it('requests the catalog from the configured API origin', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetch)
    await (await catalogRoute({ apiBaseUrl: 'https://reactor.example.test' }))()
    expect((fetch.mock.calls[0]?.[0] as URL).href).toBe('https://reactor.example.test/models?limit=200&offset=0')
  })

  it('answers 503 without a Reactor key and does not call Reactor', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const get = await catalogRoute({ credentialRef: 'REACTOR_MISSING_KEY' })
    const response = await get()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Set the Reactor API key on the host.' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([401, 403])('answers 401 when Reactor rejects the key with HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status })))
    const response = await (await catalogRoute())()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Reactor rejected the API key.' })
  })

  it.each([
    ['a server error', () => Promise.resolve(new Response(null, { status: 500 }))],
    ['a network failure', () => Promise.reject(new Error('socket closed'))],
    ['a malformed listing', () => Promise.resolve(Response.json({ models: [] }))],
  ])('answers 502 for %s', async (_label, answer) => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation(answer))
    const response = await (await catalogRoute())()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Could not load Reactor models. Check the API key and connection.' })
  })

  it('stops waiting for Reactor after catalogTimeoutSeconds, independent of the session lifetime', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })))
    const get = await catalogRoute({ catalogTimeoutSeconds: 1, timeoutSeconds: 3600 })
    const started = Date.now()
    const response = await get()
    expect(response.status).toBe(502)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('Reactor duration choices', () => {
  it('lists only durations shorter than the session lifetime', async () => {
    const { ctx } = await boot({ timeoutSeconds: 10, models: { ltx2: { profile: 'ltx2' }, custom: { profile: 'fast-h3-omni', durationsSec: [8, 10.125, 12] } } })
    const ltx = await ctx.dvModels.resolve(['i2v'], { ...model, model: 'ltx2', task: 'i2v' }).facts()
    expect(ltx.durationsSec).toEqual([4, 5, 6, 7, 8, 9])
    expect(ltx.maxDurationSec).toBe(9)
    const custom = await ctx.dvModels.resolve(['t2v'], { ...model, model: 'custom', task: 't2v' }).facts()
    expect(custom.durationsSec).toEqual([8])
    expect(custom.maxDurationSec).toBe(8)
    const schema = await ctx.dvModels.resolve(['i2v'], { ...model, model: 'ltx2', task: 'i2v' }).schema() as { duration_sec: { values: number[] } }
    expect(schema.duration_sec.values).toEqual([4, 5, 6, 7, 8, 9])
  })

  it('keeps the previous models and logs the alias when a volatile update leaves it without durations', async () => {
    const { ctx } = await boot({ timeoutSeconds: 60, models: { quick: { profile: 'fast-h3' } } })
    const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'dv-reactor')!
    const warnings: unknown[] = []
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(...args) })
    await provider.update({ config: { timeoutSeconds: 60, models: { quick: { profile: 'fast-h3', durationsSec: [90] } } } })
    warn.mockRestore()
    expect(JSON.stringify(warnings.map(error => error instanceof AggregateError ? error.errors.map(String) : String(error))))
      .toMatch(/quick.*timeoutSeconds \(60\)/)
    const entry = ctx.dvModels.resolve(['i2v'], { ...model, model: 'quick', task: 'i2v' })
    expect((await entry.facts()).durationsSec).toEqual([8])
  })

  it('keeps the entries of unchanged aliases when settings add another alias', async () => {
    const { ctx } = await boot({ models: { quick: { profile: 'fast-h3' } } })
    const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'dv-reactor')!
    const before = ctx.dvModels.list({ provider: 'reactor' })
    await provider.update({ config: { models: { quick: { profile: 'fast-h3' }, slow: { profile: 'ltx2' } } } })
    const after = ctx.dvModels.list({ provider: 'reactor' })
    expect(before.map(entry => entry.model)).toEqual(['quick', 'quick', 'quick', 'quick'])
    expect(after.map(entry => entry.model)).toEqual(['quick', 'quick', 'quick', 'quick', 'slow'])
    before.forEach((entry, index) => { expect(after[index]).toBe(entry) })
  })
})
