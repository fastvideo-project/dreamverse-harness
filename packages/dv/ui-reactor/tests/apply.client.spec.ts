// @vitest-environment jsdom
/** The Reactor plugin registers its provider and reaches the account, catalog, and credential routes. */
import { afterEach, expect, it, vi } from 'vitest'
import type { CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import { apply, inject } from '../src/client/index.ts'
import { ReactorLogo } from '../src/client/logo.tsx'

afterEach(() => { vi.unstubAllGlobals() })

function mount(credentials: { set: () => Promise<{ ok: boolean }>; unset: () => Promise<{ ok: boolean }> }) {
  const registry = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const form = { getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { models: {} } }), subscribe: () => () => {}, mutate: async () => true }
  const ctx = { dvCloudModels: registry, configForms: { get: () => form }, remote: { credentials },
    effect: (register: () => () => void) => { register() } } as never
  apply(ctx)
  return registry.getSnapshot()[0]!
}

it('registers the Reactor provider and calls its account and catalog routes', async () => {
  expect(inject).toContain('dvCloudModels')
  const responses = new Map<string, () => Response>([
    ['/api/dv/reactor/account', () => Response.json({ status: 'rejected' })],
    ['/api/dv/reactor/catalog', () => Response.json({ models: [] })],
  ])
  const fetchSpy = vi.fn(async (url: string) => responses.get(url)?.() ?? new Response('', { status: 404 }))
  vi.stubGlobal('fetch', fetchSpy)
  const provider = mount({ set: async () => ({ ok: true }), unset: async () => ({ ok: true }) })
  const signal = new AbortController().signal
  expect(provider.id).toBe('reactor')
  expect(await provider.account(signal)).toEqual({ status: 'rejected' })
  expect(await provider.verify('candidate', signal)).toEqual({ status: 'rejected' })
  expect(fetchSpy).toHaveBeenLastCalledWith('/api/dv/reactor/account', expect.objectContaining({ method: 'POST', body: '{"key":"candidate"}' }))
  expect(await provider.load('', signal)).toEqual({ models: [] })
  responses.set('/api/dv/reactor/catalog', () => Response.json({}, { status: 401 }))
  expect(await provider.load('', signal)).toEqual({ credentialError: 'rejected' })
  expect(ReactorLogo({ size: 12 }).type).toBe('svg')
})

it('stores and removes the key through the credential service and reports a refusal', async () => {
  const set = vi.fn(async () => ({ ok: true }))
  const unset = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ models: [] })))
  const provider = mount({ set, unset })
  await provider.load('rk_new', new AbortController().signal)
  expect(set).toHaveBeenCalledWith('REACTOR_API_KEY', 'rk_new')
  await provider.removeKey()
  expect(unset).toHaveBeenCalledWith('REACTOR_API_KEY')
  const refusing = mount({ set: async () => ({ ok: false }), unset: async () => ({ ok: false }) })
  await expect(refusing.load('rk_new', new AbortController().signal)).rejects.toThrow('Could not store the Reactor key.')
  await expect(refusing.removeKey()).rejects.toThrow('Could not remove the Reactor key.')
})
