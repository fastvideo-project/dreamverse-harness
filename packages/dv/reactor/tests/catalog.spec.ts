/** Check pagination and validation of Reactor's official model listing. */
import { afterEach, expect, it, vi } from 'vitest'
import { checkAccess, listModels, readBalance } from '../src/catalog.ts'

afterEach(() => vi.unstubAllGlobals())

it('lists both configured and unconfigured model IDs across pages without creating sessions', async () => {
  const first = Array.from({ length: 200 }, (_, index) => ({ name: `fixture/model-${index}`, status: 'active', is_public: true }))
  const last = [{ name: 'fixture/private-model', status: 'deprecated', description: 'Shared model' }]
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(first))
    .mockResolvedValueOnce(Response.json(last))
  vi.stubGlobal('fetch', fetch)
  const signal = new AbortController().signal

  const models = await listModels('rk_fixture', signal, 'https://api.reactor.inc')
  expect(models).toHaveLength(201)
  expect(models[0]).toEqual({ name: 'fixture/model-0', status: 'active' })
  expect(models.at(-1)).toEqual(last[0])
  expect(fetch.mock.calls.map(([url]) => url instanceof URL ? url.href : url)).toEqual([
    'https://api.reactor.inc/models?limit=200&offset=0', 'https://api.reactor.inc/models?limit=200&offset=200',
  ])
  expect(fetch.mock.calls[0]?.[1]).toEqual({
    headers: { Authorization: 'Bearer rk_fixture' }, signal, redirect: 'error',
  })
})

it('reports invalid credentials and malformed catalog data', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json([{ name: 'fixture/model', status: 'unknown' }]))
  vi.stubGlobal('fetch', fetch)
  const signal = new AbortController().signal
  await expect(listModels('rk_fixture', signal, 'https://api.reactor.inc')).rejects.toThrow('HTTP 401')
  await expect(listModels('rk_fixture', signal, 'https://api.reactor.inc')).rejects.toThrow('invalid model name or status')
})

it('rejects a model entry that is not an object', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(['fixture/model'])))
  await expect(listModels('rk_fixture', new AbortController().signal, 'https://api.reactor.inc')).rejects.toThrow('invalid model entry')
})

it('rejects a response that is not a list', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ models: [] })))
  await expect(listModels('rk_fixture', new AbortController().signal, 'https://api.reactor.inc')).rejects.toThrow('invalid model catalog')
})

it('requests the catalog from the configured API origin', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([]))
  vi.stubGlobal('fetch', fetch)
  await listModels('rk_fixture', new AbortController().signal, 'https://reactor.example.test')
  expect((fetch.mock.calls[0]?.[0] as URL).href).toBe('https://reactor.example.test/models?limit=200&offset=0')
})

it('checks access with one authenticated catalog page and preserves rejection', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
  vi.stubGlobal('fetch', fetch)
  const signal = new AbortController().signal
  await expect(checkAccess('rk_fixture', signal, 'https://api.reactor.inc')).resolves.toBeUndefined()
  expect(fetch.mock.calls[0]?.[0]).toEqual(new URL('https://api.reactor.inc/models?limit=1&offset=0'))
  expect(fetch.mock.calls[0]?.[1]).toEqual({
    headers: { Authorization: 'Bearer rk_fixture' }, signal, redirect: 'error',
  })
  await expect(checkAccess('rk_fixture', signal, 'https://api.reactor.inc')).rejects.toMatchObject({ status: 403 })
})

it('reads the account email and credit balance, and hides figures Reactor does not report', async () => {
  const origin = 'https://api.reactor.inc'
  const signal = new AbortController().signal
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ email: 'me@example.test', account_id: 'acct/1' }))
    .mockResolvedValueOnce(Response.json({ balance_usd: '12.50' }))
    .mockResolvedValueOnce(Response.json({ email: 'me@example.test' }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ account_id: 'acct' }))
    .mockResolvedValueOnce(Response.json({ balance_usd: 3 }))
    .mockResolvedValueOnce(Response.json({ account_id: 'acct' }))
    .mockResolvedValueOnce(Response.json({ balance_usd: 'n/a' }))
    .mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce(Response.json({ email: 'me@example.test', account_id: '' }))
    .mockResolvedValueOnce(Response.json({ account_id: 'acct' }))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
  vi.stubGlobal('fetch', fetch)
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: 'me@example.test', balanceUsd: 12.5 })
  expect(fetch.mock.calls.map(([url]) => (url as URL).href)).toEqual([`${origin}/me`, `${origin}/accounts/acct%2F1/credits`])
  expect(fetch.mock.calls[0]?.[1]).toEqual({ headers: { Authorization: 'Bearer rk_fixture' }, signal, redirect: 'error' })
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: 'me@example.test', balanceUsd: null })
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: null, balanceUsd: null })
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: null, balanceUsd: 3 })
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: null, balanceUsd: null })
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: null, balanceUsd: null })
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: 'me@example.test', balanceUsd: null })
  expect(await readBalance('rk_fixture', signal, origin)).toEqual({ label: null, balanceUsd: null })
})

it('rejects a balance read that the caller aborts', async () => {
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
    controller.abort()
    return Promise.reject(new DOMException('aborted', 'AbortError'))
  }))
  await expect(readBalance('rk_fixture', controller.signal, 'https://api.reactor.inc')).rejects.toThrow('aborted')
})
