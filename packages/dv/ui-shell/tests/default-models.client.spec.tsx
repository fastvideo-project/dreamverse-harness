// @vitest-environment jsdom
/** Default model rows name the provider, and warn about a saved default that is no longer offered. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { WireModelEntry } from '@dv/ui-kit/types.ts'
import { DefaultModels, type DefaultModelsProps } from '../src/client/DefaultModels.tsx'

beforeEach(() => { document.documentElement.lang = 'en' })
afterEach(cleanup)

function form<T>(value: T) {
  const snapshot: ConfigFormSnapshot<T> = { status: 'ready', mode: 'host', writable: true, revision: 3, value, base: {}, user: {} }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: vi.fn(async () => true),
    set: async () => true, unset: async () => true } satisfies ConfigForm<T>
}

const entry = (provider: string, model: string, display: string): WireModelEntry =>
  ({ modality: 'video', task: 't2v', provider, model, description: model, display_name: display, schema: {} })

function setup(defaults: Record<string, { provider: string; model: string }>, entries: WireModelEntry[] | Error) {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  providers.register({ id: 'reactor', name: 'Reactor', logo: () => null } as never)
  const mediaForm = form({ defaults })
  const llmForm = form({ provider: 'deepseek', model: 'chat' })
  const source: DefaultModelsProps['source'] = {
    llmForm, mediaForm,
    llmCatalog: vi.fn(async () => ({ groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }], routableProviders: ['deepseek'] }) as never),
    mediaCatalog: vi.fn(async () => { if (entries instanceof Error) throw entries; return entries }),
  }
  render(<DefaultModels source={source} providers={providers} />)
  return { mediaForm, llmForm, source }
}

it('names the provider beside the saved default model, falling back to the capitalized id', async () => {
  setup({ video: { provider: 'reactor', model: 'fast' } }, [entry('reactor', 'fast', 'FastH3-Omni'), entry('uniserve', 'fast', 'FastH3-Omni')])
  const video = await screen.findByRole('button', { name: 'Video model' })
  await waitFor(() => { expect(video.textContent).toBe('FastH3-Omni · Reactor') })
  fireEvent.click(video)
  const menu = screen.getByRole('menu')
  expect(within(menu).getByRole('menuitem', { name: 'FastH3-Omni · Reactor' })).toBeTruthy()
  expect(within(menu).getByRole('menuitem', { name: 'FastH3-Omni · Uniserve' })).toBeTruthy()
})

it('warns about a default that is no longer offered and clears it on request', async () => {
  const { mediaForm } = setup({ video: { provider: 'reactor', model: 'retired' }, image: { provider: 'x', model: 'y' } },
    [entry('reactor', 'fast', 'FastH3-Omni')])
  const alerts = await screen.findAllByRole('alert')
  expect(alerts.map(alert => alert.textContent).join(' ')).toContain('retired is no longer available')
  expect(screen.getByRole('button', { name: 'Video model' }).textContent).toBe('retired · Unavailable')
  fireEvent.click(within(alerts[0]!).getByRole('button', { name: 'Use Auto' }))
  await waitFor(() => { expect(mediaForm.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['defaults'], value: { image: { provider: 'x', model: 'y' } } }], 3) })
})

it('does not call a default stale while the generation catalog has not loaded', async () => {
  const { source } = setup({ video: { provider: 'reactor', model: 'retired' } }, new Error('offline'))
  await waitFor(() => { expect(source.mediaCatalog).toHaveBeenCalled() })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('picks a model for a media type and returns it to Auto', async () => {
  const { mediaForm, source } = setup({}, [entry('reactor', 'fast', 'FastH3-Omni')])
  const row = await screen.findByRole('button', { name: 'Video model' })
  await waitFor(() => { expect(source.mediaCatalog).toHaveBeenCalled() })
  fireEvent.click(row)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'FastH3-Omni · Reactor' }))
  await waitFor(() => { expect(mediaForm.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['defaults'],
    value: { video: { provider: 'reactor', model: 'fast' } } }], 3) })
})

it('saves the director LLM and reports a refused write', async () => {
  const { llmForm } = setup({}, [])
  fireEvent.click(await screen.findByRole('button', { name: 'Director LLM' }))
  llmForm.mutate.mockResolvedValueOnce(false)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Settings changed elsewhere')
  fireEvent.click(await screen.findByRole('button', { name: 'Director LLM' }))
  llmForm.mutate.mockRejectedValueOnce(new Error('transport'))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Could not save the default model') })
})
