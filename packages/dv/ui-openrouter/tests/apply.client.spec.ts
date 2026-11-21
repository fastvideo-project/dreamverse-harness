// @vitest-environment jsdom
/** The OpenRouter plugin registers its provider, reaches its routes, and edits the operator profile with the key reference. */
import { afterEach, expect, it, vi } from 'vitest'
import type { CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import { apply, inject } from '../src/client/index.ts'
import { OpenRouterLogo } from '../src/client/logo.tsx'

afterEach(() => { vi.unstubAllGlobals() })

interface MountOptions {
  credentials?: { set: () => Promise<{ ok: boolean }>; unset: () => Promise<{ ok: boolean }> }
  operator?: { status: string; writable?: boolean; revision?: number; value?: unknown }
  mutate?: () => Promise<boolean>
}

function mount(options: MountOptions = {}) {
  const registry = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const own = { getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { models: {} } }), subscribe: () => () => {}, mutate: async () => true }
  const mutate = vi.fn(options.mutate ?? (async () => true))
  const operator = { getSnapshot: () => options.operator ?? { status: 'ready', writable: true, revision: 2, value: { providers: { openrouter: { apiKeyEnv: 'K' } } } },
    subscribe: () => () => {}, mutate }
  const ctx = {
    dvCloudModels: registry,
    configForms: { get: (ns: string) => ns === 'llm-pi-ai' ? operator : own },
    remote: { credentials: options.credentials ?? { set: async () => ({ ok: true }), unset: async () => ({ ok: true }) } },
    effect: (register: () => () => void) => { register() },
  } as never
  apply(ctx)
  return { provider: registry.getSnapshot()[0]!, mutate }
}

it('registers OpenRouter and maps its catalog and account routes', async () => {
  expect(inject).toContain('dvCloudModels')
  const answers = new Map<string, () => Response>([
    ['/api/dv/openrouter/account', () => Response.json({ status: 'missing' })],
    ['/api/dv/openrouter/catalog', () => Response.json({ data: [{ id: 'v', name: 'V' }], images: [], speech: [], error: null })],
  ])
  vi.stubGlobal('fetch', vi.fn(async (url: string) => answers.get(url)?.() ?? new Response('', { status: 404 })))
  const { provider } = mount()
  const signal = new AbortController().signal
  expect(await provider.account(signal)).toEqual({ status: 'missing' })
  expect(await provider.verify('k', signal)).toEqual({ status: 'missing' })
  expect(await provider.load('', signal)).toEqual({ models: [{ id: 'v', name: 'V', media: 'video' }] })
  for (const [status, expected] of [[401, 'rejected'], [503, 'missing']] as const) {
    answers.set('/api/dv/openrouter/catalog', () => Response.json({}, { status }))
    expect(await provider.load('', signal)).toEqual({ credentialError: expected })
  }
  expect(OpenRouterLogo({ size: 12 }).type).toBe('svg')
})

it('turns the chat route on and off with the saved key reference and reads whether it is on', async () => {
  const { provider, mutate } = mount()
  expect(provider.operatorEnabled?.()).toBe(true)
  await provider.enableOperator?.()
  expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['providers', 'openrouter'], value: { apiKeyEnv: 'OPENROUTER_API_KEY' } }], 2)
  await provider.disableOperator?.()
  expect(mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['providers', 'openrouter', 'apiKeyEnv'] }], 2)
})

it('refuses chat route changes while the operator settings are unavailable or changed elsewhere', async () => {
  const unavailable = mount({ operator: { status: 'loading' } })
  expect(unavailable.provider.operatorEnabled?.()).toBe(false)
  await expect(unavailable.provider.enableOperator?.()).rejects.toThrow('Operator settings are unavailable.')
  await expect(unavailable.provider.disableOperator?.()).rejects.toThrow('Operator settings are unavailable.')
  const changed = mount({ mutate: async () => false })
  await expect(changed.provider.enableOperator?.()).rejects.toThrow('Operator settings changed. Try again.')
  await expect(changed.provider.disableOperator?.()).rejects.toThrow('Operator settings changed. Try again.')
})

it('stores and removes the key through the credential service and reports a refusal', async () => {
  const set = vi.fn(async () => ({ ok: true }))
  const unset = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [], images: [], speech: [], error: null })))
  const { provider } = mount({ credentials: { set, unset }, operator: { status: 'ready', writable: true, revision: 1, value: { providers: {} } } })
  await provider.load('sk-new', new AbortController().signal)
  expect(set).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'sk-new')
  await provider.removeKey()
  expect(unset).toHaveBeenCalledWith('OPENROUTER_API_KEY')
  const refusing = mount({ credentials: { set: async () => ({ ok: false }), unset: async () => ({ ok: false }) } })
  await expect(refusing.provider.load('sk-new', new AbortController().signal)).rejects.toThrow('Could not store the API key.')
})
