/** Account and catalog routes of cloud providers: one parser, one error mapping, and provider display names. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudSelection, fetchCloudAccount, fetchCloudCatalog, providerName, verifyCloudKey } from '../src/client/cloud-model-settings.ts'

const answer = (body: unknown, status = 200): void => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })))
}
const signal = new AbortController().signal
afterEach(() => { vi.unstubAllGlobals() })

describe('fetchCloudAccount', () => {
  it('reads every account state and never caches', async () => {
    answer({ status: 'connected', balanceUsd: 2, label: 'me', limitRemainingUsd: 1 })
    expect(await fetchCloudAccount('/api/dv/x/account', signal)).toEqual({ status: 'connected', balanceUsd: 2, label: 'me', limitRemainingUsd: 1 })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/dv/x/account', expect.objectContaining({ cache: 'no-store' }))
    answer({ status: 'connected', balanceUsd: 'x' })
    expect(await fetchCloudAccount('/a', signal)).toEqual({ status: 'connected', balanceUsd: null, label: null, limitRemainingUsd: null })
    for (const status of ['missing', 'rejected', 'unavailable'] as const) {
      answer({ status })
      expect(await fetchCloudAccount('/a', signal)).toEqual({ status })
    }
    answer({ status: 'needs-setup', message: 'Add billing' })
    expect(await fetchCloudAccount('/a', signal)).toEqual({ status: 'needs-setup', message: 'Add billing' })
    answer({ status: 'needs-setup' })
    expect(await fetchCloudAccount('/a', signal)).toEqual({ status: 'needs-setup', message: '' })
  })

  it('reads an unknown state or a failed response as unavailable', async () => {
    answer({ status: 'surprise' })
    expect(await fetchCloudAccount('/a', signal)).toEqual({ status: 'unavailable' })
    answer({}, 500)
    expect(await fetchCloudAccount('/a', signal)).toEqual({ status: 'unavailable' })
  })
})

describe('verifyCloudKey', () => {
  it('posts the candidate key in the body only', async () => {
    answer({ status: 'rejected' })
    expect(await verifyCloudKey('/api/dv/x/account?probe=1', 'secret', signal)).toEqual({ status: 'rejected' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/dv/x/account?probe=1')
    expect(init).toMatchObject({ method: 'POST', body: '{"key":"secret"}', cache: 'no-store' })
  })
})

describe('fetchCloudCatalog', () => {
  it('maps 401 to rejected and 503 to missing for every provider', async () => {
    answer({ error: 'no' }, 401)
    expect(await fetchCloudCatalog('/c', signal)).toEqual({ credentialError: 'rejected' })
    answer({ error: 'no' }, 503)
    expect(await fetchCloudCatalog('/c', undefined)).toEqual({ credentialError: 'missing' })
  })

  it('returns the body, and throws on any other failure', async () => {
    answer({ models: [] })
    expect(await fetchCloudCatalog('/c', signal)).toEqual({ models: [] })
    answer({ error: 'x' }, 502)
    await expect(fetchCloudCatalog('/c', signal)).rejects.toThrow('HTTP 502')
  })
})

describe('providerName', () => {
  it('uses the registered name, else the capitalized words of the id', () => {
    expect(providerName([{ id: 'reactor', name: 'Reactor' }], 'reactor')).toBe('Reactor')
    expect(providerName([], 'amazon-bedrock')).toBe('Amazon Bedrock')
  })
})

describe('cloudSelection', () => {
  it('projects once per source change', () => {
    let value = { n: 1 }
    const listeners = new Set<() => void>()
    const project = vi.fn((v: { n: number }) => ({ writable: true, enabled: [{ id: String(v.n), name: 'm', media: 'video' as const }] }))
    const subscribe = (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
    const selection = cloudSelection({ getSnapshot: () => value, subscribe }, project)
    expect(selection.getSnapshot()).toBe(selection.getSnapshot())
    const off = selection.subscribe(() => {})
    off()
    value = { n: 2 }
    expect(selection.getSnapshot().enabled[0]?.id).toBe('2')
    expect(project).toHaveBeenCalledTimes(2)
  })
})
