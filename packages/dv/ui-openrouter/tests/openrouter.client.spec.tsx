// @vitest-environment jsdom
/** Cloud model choices use existing settings and never persist an API key in config. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ImageModel, OpenRouterCatalog, OpenRouterSettings, VideoModel } from '@dv/openrouter/types'
import { OpenRouterPage } from '../src/client/OpenRouterPage.tsx'

let language: string
beforeEach(() => { language = document.documentElement.lang; document.documentElement.lang = 'en' })
afterEach(() => { cleanup(); document.documentElement.lang = language })
const model: VideoModel = { id: 'google/veo-3.1', name: 'Google Veo 3.1', durations: [4, 6, 8], resolutions: ['720p'],
  aspectRatios: ['16:9'], frames: ['first_frame', 'last_frame'], audio: true, seed: true }
const image: ImageModel = { id: 'black-forest-labs/flux-3-image', name: 'FLUX 3',
  parameters: { aspect_ratio: ['1:1', '16:9'], resolution: ['1K', '2K'] }, outputFormats: ['png', 'jpeg'], seed: true }
const both: OpenRouterCatalog = { videos: [model], images: [image] }
const videosOnly = async (): Promise<OpenRouterCatalog> => ({ videos: [model], images: [] })
class Form implements ConfigForm<OpenRouterSettings> {
  private listeners = new Set<() => void>()
  private snapshot: ConfigFormSnapshot<OpenRouterSettings> = { status: 'ready', writable: true, mode: 'host', revision: 1,
    value: { models: {}, imageModels: {}, credentialRef: 'OPENROUTER_API_KEY' }, base: {}, user: {} }
  getSnapshot(): ConfigFormSnapshot<OpenRouterSettings> { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  mutate = vi.fn(async (ops: Parameters<ConfigForm<OpenRouterSettings>['mutate']>[0]) => {
    const op = ops[0]
    const field = op?.op === 'set' ? String(op.path[0]) : 'models'
    const current = this.snapshot.value ?? { models: {}, imageModels: {}, credentialRef: 'OPENROUTER_API_KEY' }
    this.snapshot = { ...this.snapshot, revision: 2, value: { ...current, [field]: (op?.op === 'set' ? op.value : {}) as Record<string, string> } }
    for (const listener of this.listeners) listener()
    return true
  })
  set = vi.fn(async () => true)
  unset = vi.fn(async () => true)
}

it('saves only the key reference, enables a cloud model in chat, and removes it again', async () => {
  const form = new Form()
  const store = vi.fn(async () => {})
  const discover = vi.fn(async () => ({ videos: [model], images: [] }))
  render(<OpenRouterPage enableOperator={async () => {}} form={form} storeKey={store} discover={discover} />)
  fireEvent.change(screen.getByLabelText('OpenRouter API key'), { target: { value: 'fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save key and load models' }))
  await act(async () => {})
  expect(store).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'fixture-key')
  expect(screen.getByText('4, 6, 8s · 720p · 16:9')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }))
  await act(async () => {})
  expect(form.getSnapshot().value?.models).toEqual({ 'google-veo-3-1': 'google/veo-3.1' })
  expect(JSON.stringify(form.mutate.mock.calls)).not.toContain('fixture-key')
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await act(async () => {})
  expect(form.getSnapshot().value?.models).toEqual({})
})

it('retains setup after a discovery failure without claiming the key was verified', async () => {
  render(<OpenRouterPage enableOperator={async () => {}} form={new Form()} storeKey={async () => {}} discover={async () => { throw new Error('offline') }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save key and load models' }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('Check the saved key and connection')
  expect(screen.getByRole('button', { name: 'Save key and load models' })).toBeTruthy()
})


it('enables the existing operator adapter with a credential reference instead of sending the key in settings', async () => {
  const enable = vi.fn(async () => {})
  const store = vi.fn(async () => {})
  render(<OpenRouterPage form={new Form()} storeKey={store} discover={videosOnly} enableOperator={enable} />)
  fireEvent.change(screen.getByLabelText('OpenRouter API key'), { target: { value: 'operator-fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enable OpenRouter for operator LLM' }))
  await act(async () => {})
  expect(store).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'operator-fixture-key')
  expect(enable).toHaveBeenCalledWith('OPENROUTER_API_KEY')
  expect(screen.getByRole('status').textContent).toContain('Choose an LLM in chat')
})


it('removes every alias of the chosen model while preserving other models', async () => {
  const form = new Form()
  await form.mutate([{ op: 'set', path: ['models'], value: { a: model.id, b: model.id, other: 'other/video' } }])
  render(<OpenRouterPage enableOperator={async () => {}} form={form} storeKey={async () => {}} discover={videosOnly} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save key and load models' }))
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await act(async () => {})
  expect(form.getSnapshot().value?.models).toEqual({ other: 'other/video' })
})


it('adds an image model to the image choices without touching the video choices', async () => {
  const form = new Form()
  render(<OpenRouterPage enableOperator={async () => {}} form={form} storeKey={async () => {}} discover={async () => both} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save key and load models' }))
  await act(async () => {})
  const images = screen.getByRole('list', { name: 'Image models' })
  expect(within(images).getByText('1:1, 16:9 · 1K, 2K')).toBeTruthy()
  fireEvent.click(within(images).getByRole('button', { name: 'Add to chat' }))
  await act(async () => {})
  expect(form.getSnapshot().value).toMatchObject({ models: {},
    imageModels: { 'black-forest-labs-flux-3-image': 'black-forest-labs/flux-3-image' } })
  expect(within(screen.getByRole('list', { name: 'Video models' })).getByRole('button', { name: 'Add to chat' })).toBeTruthy()
})
