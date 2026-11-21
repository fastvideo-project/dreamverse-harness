// @vitest-environment jsdom
/** Cloud model choices use existing settings and never persist an API key in config. */
import { expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ImageModel, OpenRouterCatalog, OpenRouterSettings, SpeechModel, VideoModel } from '@dv/openrouter/types'
import { openRouterSettings } from '../src/client/settings.ts'

const model: VideoModel = { id: 'google/veo-3.1', name: 'Google Veo 3.1', durations: [4, 6, 8], resolutions: ['720p'],
  aspectRatios: ['16:9'], frames: ['first_frame', 'last_frame'], references: ['image'], audio: true, seed: true }
const image: ImageModel = { id: 'black-forest-labs/flux-3-image', name: 'FLUX 3',
  parameters: { aspect_ratio: ['1:1', '16:9'], resolution: ['1K', '2K'] }, outputFormats: ['png', 'jpeg'], seed: true }
const speech: SpeechModel = { id: 'openai/gpt-4o-mini-tts', name: 'GPT-4o mini TTS', voices: ['alloy', 'nova'] }
const both: OpenRouterCatalog = { videos: [model], images: [image], speech: [speech], error: null }
class Form implements ConfigForm<OpenRouterSettings> {
  private listeners = new Set<() => void>()
  private snapshot: ConfigFormSnapshot<OpenRouterSettings> = { status: 'ready', writable: true, mode: 'host', revision: 1,
    value: { models: {}, imageModels: {}, audioModels: {}, credentialRef: 'OPENROUTER_API_KEY' }, base: {}, user: {} }
  getSnapshot(): ConfigFormSnapshot<OpenRouterSettings> { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  mutate = vi.fn(async (ops: Parameters<ConfigForm<OpenRouterSettings>['mutate']>[0]) => {
    const op = ops[0]
    const field = op?.op === 'set' ? String(op.path[0]) : 'models'
    const current = this.snapshot.value ?? { models: {}, imageModels: {}, audioModels: {}, credentialRef: 'OPENROUTER_API_KEY' }
    this.snapshot = { ...this.snapshot, revision: 2, value: { ...current, [field]: (op?.op === 'set' ? op.value : {}) as Record<string, string> } }
    for (const listener of this.listeners) listener()
    return true
  })
  set = vi.fn(async () => true)
  unset = vi.fn(async () => true)
}

it('loads all three media catalogs through one provider and stores only the key reference', async () => {
  const form = new Form()
  const storeKey = vi.fn(async () => {})
  const discover = vi.fn(async () => both)
  const enableOperator = vi.fn(async () => {})
  const disableOperator = vi.fn(async () => {})
  const provider = openRouterSettings({
    form, storeKey, discover, enableOperator, disableOperator, operatorEnabled: () => false,
    account: async () => ({ status: 'missing' }), removeKey: async () => {}, verify: async () => ({ status: 'missing' }),
  })
  const signal = new AbortController().signal
  const catalog = await provider.load('fixture-key', signal)
  expect(storeKey).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'fixture-key')
  expect(discover).toHaveBeenCalledWith(signal)
  if ('credentialError' in catalog) throw new Error('Expected a catalog')
  expect(catalog.models.map(m => m.media)).toEqual(['video', 'image', 'audio'])
  const initial = provider.settings.getSnapshot()
  expect(initial.enabled).toEqual([])
  for (const choice of catalog.models) await provider.setEnabled(choice, true)
  expect(form.getSnapshot().value).toMatchObject({ models: { 'google-veo-3-1': model.id },
    imageModels: { 'black-forest-labs-flux-3-image': image.id }, audioModels: { 'openai-gpt-4o-mini-tts': speech.id } })
  expect(provider.settings.getSnapshot().enabled).toHaveLength(3)
  expect(JSON.stringify(form.mutate.mock.calls)).not.toContain('fixture-key')
  await provider.enableOperator?.()
  expect(enableOperator).toHaveBeenCalledWith('OPENROUTER_API_KEY')
  await provider.disableOperator?.()
  expect(disableOperator).toHaveBeenCalledOnce()
  expect(storeKey).toHaveBeenCalledTimes(1)
})

it('keeps saved selections available for removal even when they are missing from the catalog', async () => {
  const form = new Form()
  await form.mutate([{ op: 'set', path: ['models'], value: { retired: 'example/retired-video', second: 'example/retired-video', veo: model.id } }])
  const warning = 'Configured model is unavailable.'
  const provider = openRouterSettings({
    form, storeKey: async () => {}, discover: async () => ({ ...both, error: warning }), enableOperator: async () => {},
    disableOperator: async () => {}, operatorEnabled: () => false, account: async () => ({ status: 'missing' }),
    removeKey: async () => {}, verify: async () => ({ status: 'missing' }),
  })
  expect(await provider.load('', new AbortController().signal)).toMatchObject({ warning })
  const retired = provider.settings.getSnapshot().enabled.find(row => row.id === 'example/retired-video')!
  await provider.setEnabled(retired, false)
  expect(form.getSnapshot().value?.models).toEqual({ veo: model.id })
})

it('turns the chat route off before it deletes a key the route uses, and passes a credential error through', async () => {
  const form = new Form()
  const order: string[] = []
  const provider = openRouterSettings({
    form, storeKey: async () => {}, discover: async () => ({ credentialError: 'missing' }), enableOperator: async () => {},
    disableOperator: async () => { order.push('operator') }, operatorEnabled: () => true,
    account: async () => ({ status: 'missing' }), removeKey: async (ref) => { order.push(`remove ${ref}`) },
    verify: async () => ({ status: 'rejected' }),
  })
  expect(await provider.load('', new AbortController().signal)).toEqual({ credentialError: 'missing' })
  await provider.removeKey()
  expect(order).toEqual(['operator', 'remove OPENROUTER_API_KEY'])
  expect(await provider.verify('candidate', new AbortController().signal)).toEqual({ status: 'rejected' })
})

it('leaves the chat route alone when deleting a key it does not use', async () => {
  const disableOperator = vi.fn(async () => {})
  const provider = openRouterSettings({
    form: new Form(), storeKey: async () => {}, discover: async () => both, enableOperator: async () => {},
    disableOperator, operatorEnabled: () => false, account: async () => ({ status: 'missing' }),
    removeKey: async () => {}, verify: async () => ({ status: 'missing' }),
  })
  await provider.removeKey()
  expect(disableOperator).not.toHaveBeenCalled()
})
