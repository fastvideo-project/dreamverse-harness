/** Check the shared account-status route and the catalog failure answers with a connection stand-in. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { describe, expect, it, vi } from 'vitest'
import { AccountNeedsSetupError, catalogFailure, catalogMissingKey, MAX_ACCOUNT_KEY_LENGTH, registerAccountRoute,
  type AccountRouteOptions } from '../src/index.ts'

const URL_ = 'http://dsh.local/api/dv/fixture/account'
const details = { balanceUsd: 3, label: 'Main', limitRemainingUsd: 1.5 }

/** Register the route on a stand-in context and return its fetch, the effect labels and the disposals. */
function mount(overrides: Partial<AccountRouteOptions> = {}) {
  const routes: ConnectionFetchRoute[] = []
  const labels: string[] = []
  const disposed = vi.fn()
  const scope = {
    connection: { fetch: { register: (route: ConnectionFetchRoute) => { routes.push(route); return disposed } } },
    effect: (callback: () => unknown, label: string) => { labels.push(label); return callback() },
  }
  const ctx = { inject: (_names: string[], callback: (scope: unknown) => unknown) => callback(scope) } as unknown as Context
  const check = vi.fn<AccountRouteOptions['check']>().mockResolvedValue(details)
  registerAccountRoute(ctx, {
    provider: 'fixture', description: 'Fixture account status', savedKey: () => Promise.resolve('saved-key'), check,
    isRejected: error => error instanceof Error && error.message === 'refused', timeoutSeconds: 5, ...overrides,
  })
  const route = routes[0]!
  return { route, routes, labels, check, get: () => route.fetch(new Request(URL_)),
    post: (body: string) => route.fetch(new Request(URL_, { method: 'POST', body })) }
}

describe('registerAccountRoute', () => {
  it('registers one buffered GET and POST route as a labelled effect', () => {
    const { route, labels } = mount()
    expect(route).toMatchObject({ path: '/api/dv/fixture/account', methods: ['GET', 'POST'], requestBody: 'buffered' })
    expect(labels).toEqual(['Fixture account status'])
  })

  it('checks the saved key on GET and answers connected without caching', async () => {
    const { get, check } = mount()
    const response = await get()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'connected', ...details })
    expect(check.mock.calls[0]?.[0]).toBe('saved-key')
  })

  it('answers missing without calling the check when no key is saved', async () => {
    const { get, check } = mount({ savedKey: () => Promise.resolve(undefined) })
    expect(await (await get()).json()).toEqual({ status: 'missing' })
    expect(check).not.toHaveBeenCalled()
  })

  it('answers unavailable when the saved key cannot be read', async () => {
    const { get, check } = mount({ savedKey: () => Promise.reject(new Error('bad ref')) })
    const response = await get()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'unavailable' })
    expect(check).not.toHaveBeenCalled()
  })

  it('maps check failures to rejected, unavailable and needs-setup', async () => {
    const { get, check } = mount()
    check.mockRejectedValueOnce(new Error('refused'))
    expect(await (await get()).json()).toEqual({ status: 'rejected' })
    check.mockRejectedValueOnce(new Error('network'))
    expect(await (await get()).json()).toEqual({ status: 'unavailable' })
    check.mockRejectedValueOnce(new AccountNeedsSetupError('Install the runtime.'))
    expect(await (await get()).json()).toEqual({ status: 'needs-setup', message: 'Install the runtime.' })
  })

  it('drops a label that contains the checked key', async () => {
    const { get, check } = mount()
    check.mockResolvedValueOnce({ ...details, label: 'prefix-saved-key-suffix' })
    expect(await (await get()).json()).toEqual({ status: 'connected', ...details, label: null })
    check.mockResolvedValueOnce({ ...details, label: null })
    expect(await (await get()).json()).toMatchObject({ label: null })
  })

  it('bounds the check by the configured deadline and the request signal', async () => {
    const { check, route } = mount({ timeoutSeconds: 1 })
    check.mockImplementation((_key, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    const started = Date.now()
    const response = await route.fetch(new Request(URL_))
    expect(await response.json()).toEqual({ status: 'unavailable' })
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('checks a candidate key on POST without reading the saved key', async () => {
    const savedKey = vi.fn(() => Promise.resolve('saved-key'))
    const { post, check } = mount({ savedKey })
    const response = await post('{"key":"candidate-key"}')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'connected', ...details })
    expect(check.mock.calls[0]?.[0]).toBe('candidate-key')
    expect(savedKey).not.toHaveBeenCalled()
  })

  it('maps a refused candidate key', async () => {
    const { post, check } = mount()
    check.mockRejectedValueOnce(new Error('refused'))
    expect(await (await post('{"key":"candidate-key"}')).json()).toEqual({ status: 'rejected' })
  })

  it.each([
    ['text that is not JSON', 'nope'],
    ['a JSON array', '["key"]'],
    ['null', 'null'],
    ['a number', '4'],
    ['an object without a key', '{}'],
    ['a non-string key', '{"key":5}'],
    ['an empty key', '{"key":""}'],
    ['a key with a space', '{"key":"a b"}'],
    ['a key with a control character', '{"key":"a\\nb"}'],
    ['a key above the length limit', JSON.stringify({ key: 'k'.repeat(MAX_ACCOUNT_KEY_LENGTH + 1) })],
    ['an extra field', '{"key":"candidate-key","other":1}'],
    ['a body above the size limit', JSON.stringify({ key: 'k', pad: 'x'.repeat(5000) })],
  ])('answers 400 for %s without echoing the body or calling the check', async (_label, body) => {
    const { post, check } = mount()
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ error: expect.stringContaining('"key"') as unknown })
    expect(text).not.toContain('candidate-key')
    expect(check).not.toHaveBeenCalled()
  })

  it('accepts a key at the length limit', async () => {
    const { post, check } = mount()
    await post(JSON.stringify({ key: 'k'.repeat(MAX_ACCOUNT_KEY_LENGTH) }))
    expect(check).toHaveBeenCalledOnce()
  })
})

describe('catalog answers', () => {
  it('answers 503 without a key', async () => {
    const response = catalogMissingKey('Fixture')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Set the Fixture API key on the host.' })
  })

  it('answers 401 for a refused key and 502 for any other failure', async () => {
    const refused = catalogFailure('Fixture', true)
    expect(refused.status).toBe(401)
    expect(await refused.json()).toEqual({ error: 'Fixture rejected the API key.' })
    const failed = catalogFailure('Fixture', false)
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'Could not load Fixture models. Check the API key and connection.' })
  })
})
