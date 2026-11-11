// @vitest-environment jsdom
/** Cloud model choices use existing settings and never persist an API key in config. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { OpenRouterSettings, VideoModel } from '@dv/openrouter/types'
import { OpenRouterPage } from '../src/client/OpenRouterPage.tsx'

let language: string
beforeEach(() => { language = document.documentElement.lang; document.documentElement.lang = 'en' })
afterEach(() => { cleanup(); document.documentElement.lang = language })
const model: VideoModel = { id: 'google/veo-3.1', name: 'Google Veo 3.1', durations: [4, 6, 8], resolutions: ['720p'],
  aspectRatios: ['16:9'], frames: ['first_frame', 'last_frame'], audio: true, seed: true }
class Form implements ConfigForm<OpenRouterSettings> {
  private listeners = new Set<() => void>()
  private snapshot: ConfigFormSnapshot<OpenRouterSettings> = { status: 'ready', writable: true, mode: 'host', revision: 1,
    value: { models: {}, credentialRef: 'OPENROUTER_API_KEY' }, base: {}, user: {} }
  getSnapshot(): ConfigFormSnapshot<OpenRouterSettings> { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  mutate = vi.fn(async (ops: Parameters<ConfigForm<OpenRouterSettings>['mutate']>[0]) => {
    const value = ops[0]?.op === 'set' ? ops[0].value : {}
    this.snapshot = { ...this.snapshot, revision: 2, value: { models: value as Record<string, string>, credentialRef: 'OPENROUTER_API_KEY' } }
    for (const listener of this.listeners) listener()
    return true
  })
  set = vi.fn(async () => true)
  unset = vi.fn(async () => true)
}

it('saves only the key reference, enables a cloud model in chat, and removes it again', async () => {
  const form = new Form()
  const store = vi.fn(async () => {})
  const discover = vi.fn(async () => [model])
  render(<OpenRouterPage enableOperator={async () => {}} form={form} storeKey={store} discover={discover} />)
  fireEvent.change(screen.getByLabelText('OpenRouter API key'), { target: { value: 'fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save key and load video models' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Save key and load video models' }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('Check the saved key and connection')
  expect(screen.getByRole('button', { name: 'Save key and load video models' })).toBeTruthy()
})


it('enables the existing operator adapter with a credential reference instead of sending the key in settings', async () => {
  const enable = vi.fn(async () => {})
  const store = vi.fn(async () => {})
  render(<OpenRouterPage form={new Form()} storeKey={store} discover={async () => [model]} enableOperator={enable} />)
  fireEvent.change(screen.getByLabelText('OpenRouter API key'), { target: { value: 'operator-fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enable OpenRouter for operator LLM' }))
  await act(async () => {})
  expect(store).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'operator-fixture-key')
  expect(enable).toHaveBeenCalledWith('OPENROUTER_API_KEY')
  expect(screen.getByRole('status').textContent).toContain('Choose an LLM in chat')
})
