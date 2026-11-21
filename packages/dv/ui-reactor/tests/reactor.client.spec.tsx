// @vitest-environment jsdom
/** The Reactor page keeps credentials out of the model choices it saves. */
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReactorCatalog, ReactorSettings } from '@dv/reactor/types'
import { expect, it, vi } from 'vitest'
import { reactorSettings } from '../src/client/settings.ts'

const model = { name: 'reactor/fast-h3-omni', profile: 'fast-h3-omni', displayName: 'FastH3-Omni', status: 'active', shotModels: [] } as const
const catalog: ReactorCatalog = { models: [{ ...model, shotModels: [] }, { name: 'reactor/live-fixture', status: 'active', shotModels: [] }] }
class Form implements ConfigForm<ReactorSettings> {
  private readonly listeners = new Set<() => void>()
  private snapshot: ConfigFormSnapshot<ReactorSettings> = {
    status: 'ready', mode: 'host', writable: true, revision: 1, value: { models: {} },
    base: {}, user: {},
  }

  getSnapshot(): ConfigFormSnapshot<ReactorSettings> { return this.snapshot }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  mutate = vi.fn((ops: Parameters<ConfigForm<ReactorSettings>['mutate']>[0], revision?: number): Promise<boolean> => {
    const op = ops[0]
    if (op?.op !== 'set' || revision === undefined || revision !== this.snapshot.revision) return Promise.resolve(false)
    this.snapshot = {
      ...this.snapshot, revision: revision + 1, value: {
        credentialRef: 'REACTOR_API_KEY', models: op.value as NonNullable<ReactorSettings['models']>,
      },
    }
    for (const listener of this.listeners) listener()
    return Promise.resolve(true)
  })

  set = vi.fn(() => Promise.resolve(true))
  unset = vi.fn(() => Promise.resolve(true))
}

it('loads supported shot workflows and persists the chosen deployment without its key', async () => {
  const form = new Form()
  const storeKey = vi.fn(async () => {})
  const provider = reactorSettings({ form, storeKey, removeKey: async () => {}, discover: async () => catalog,
    account: async () => ({ status: 'missing' }), verify: async () => ({ status: 'missing' }) })
  const loaded = await provider.load('rk_fixture', new AbortController().signal)
  expect(storeKey).toHaveBeenCalledExactlyOnceWith('REACTOR_API_KEY', 'rk_fixture')
  if ('credentialError' in loaded) throw new Error('Expected a catalog')
  expect(loaded.models).toEqual([{ id: model.name, name: model.displayName, media: 'video' }])
  await provider.setEnabled(loaded.models[0]!, true)
  expect(form.mutate).toHaveBeenCalledWith([{
    op: 'set', path: ['models'], value: { 'fast-h3-omni': { profile: 'fast-h3-omni', modelId: model.name } },
  }], 1)
  await provider.setEnabled(loaded.models[0]!, false)
  expect(form.getSnapshot().value?.models).toEqual({})
})

it('shows a preconfigured deployment before discovery and refuses to enable a disabled offering', async () => {
  const form = new Form()
  await form.mutate([{ op: 'set', path: ['models'], value: { custom: { profile: 'pika-h3-flex', modelId: 'team/custom' } } }], 1)
  const storeKey = vi.fn(async () => {})
  const provider = reactorSettings({
    form, storeKey, removeKey: async () => {}, discover: async () => ({ models: [{ ...model, status: 'disabled', shotModels: [] }] }),
    account: async () => ({ status: 'missing' }), verify: async () => ({ status: 'missing' }),
  })
  expect(provider.settings.getSnapshot().enabled).toEqual([{ id: 'team/custom', name: 'team/custom', media: 'video' }])
  const loaded = await provider.load('', new AbortController().signal)
  if ('credentialError' in loaded) throw new Error('Expected a catalog')
  const { models } = loaded
  expect(models[0]?.unavailable).toBe('provider')
  await expect(provider.setEnabled(models[0]!, true)).rejects.toThrow('Unavailable model')
  expect(storeKey).not.toHaveBeenCalled()
})

it('deletes the key under the form credential reference and passes a credential error through', async () => {
  const form = new Form()
  const removeKey = vi.fn(async () => {})
  const verify = vi.fn(async () => ({ status: 'rejected' as const }))
  const provider = reactorSettings({
    form, storeKey: async () => {}, removeKey, discover: async () => ({ credentialError: 'rejected' }),
    account: async () => ({ status: 'missing' }), verify,
  })
  await provider.removeKey()
  expect(removeKey).toHaveBeenCalledExactlyOnceWith('REACTOR_API_KEY')
  expect(await provider.load('', new AbortController().signal)).toEqual({ credentialError: 'rejected' })
  expect(await provider.verify('candidate', new AbortController().signal)).toEqual({ status: 'rejected' })
})
