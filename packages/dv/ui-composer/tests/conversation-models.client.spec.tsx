// @vitest-environment jsdom
/** The model picker of a conversation: Settings defaults seed a blank conversation once, and a failed seed is reported. */
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { WireModelEntry } from '@dv/ui-kit/types.ts'
import { fixtureState, scriptedFetch, type ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { applyPrompt } from '../src/client/prompt.ts'

type Defaults = Record<string, { provider: string; model: string }>
const reactorEntry: WireModelEntry = { modality: 'video', task: 't2v', provider: 'reactor', model: 'fast', description: 'Fast',
  display_name: 'FastH3-Omni', schema: {} }

beforeEach(() => { document.documentElement.lang = 'en' })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
})

function defaultsForm(status: 'ready' | 'loading', defaults: Defaults) {
  const current: ConfigFormSnapshot<{ defaults?: Defaults }> = status === 'ready'
    ? { status: 'ready', mode: 'host', writable: true, revision: 4, value: { defaults }, base: {}, user: {} }
    : { status: 'loading', mode: 'host', writable: false, revision: 0, value: undefined, base: {}, user: {} } as never
  const snapshot = () => current
  const mutate = vi.fn(async () => true)
  return { form: { getSnapshot: snapshot, subscribe: () => () => {}, mutate } as never, mutate }
}

async function mount(options: { form: ConfigForm<unknown>; routes?: ScriptedRoutes; blank?: boolean; project?: string | null }) {
  const script = scriptedFetch({ models: [reactorEntry], ...options.routes })
  vi.stubGlobal('fetch', script.fetch)
  publishCurrentProject(options.project === undefined ? 'p1' : options.project)
  const runtime = await SlotTestRuntime.create()
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  providers.register({ id: 'reactor', name: 'Reactor', logo: () => <i data-testid="reactor-logo" /> } as never)
  runtime.ctx.provide('configForms', { get: () => options.form } as never)
  runtime.ctx.provide('dvCloudModels', providers)
  const session = await runtime.sessions.add({ id: 's1' })
  runtime.sessions.list.update((draft) => {
    const row = draft.byId['s1' as keyof typeof draft.byId]
    if (row !== undefined) row.blank = options.blank ?? true
  })
  const reference = runtime.sessions.retain(session)
  await runtime.root.declare({ 'conversation.input.left': { kind: 'list', scope: 'session' } }, props => (
    <props.SessionProvider session={reference}>{props.renderSlot('conversation.input.left', {})}</props.SessionProvider>
  ))
  await runtime.mount({ inject: ['slots', 'sessions'], apply: applyPrompt })
  const view = runtime.renderRoot()
  return { runtime, view, script }
}

const selectWrites = (script: { writes: { path: string; body: unknown }[] }) =>
  script.writes.filter(write => write.path === '/api/dv/operation')

it('records the Settings default on a blank conversation once, with the provider named in the picker', async () => {
  const { form } = defaultsForm('ready', { video: { provider: 'reactor', model: 'fast' } })
  const { view, script, runtime } = await mount({ form })
  await waitFor(() => { expect(selectWrites(script)).toHaveLength(1) })
  expect(selectWrites(script)[0]?.body).toMatchObject({ project: 'p1', session: 's1', operation: 'models.select',
    params: { modality: 'video', provider: 'reactor', model: 'fast' } })
  expect(await view.findByRole('button', { name: 'Generation model: FastH3-Omni · Reactor' })).toBeTruthy()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(selectWrites(script)).toHaveLength(1)
  expect(view.queryByRole('alert')).toBeNull()
  await runtime.dispose()
})

it('tells the user when the defaults could not be recorded', async () => {
  const { form } = defaultsForm('ready', { video: { provider: 'reactor', model: 'fast' } })
  const { view, runtime } = await mount({ form, routes: { post: () => ({ status: 500, body: { error: 'refused' } }) } })
  expect((await view.findByRole('alert')).textContent).toBe('Could not apply your default models. Pick them in the model picker.')
  await runtime.dispose()
})

it('seeds nothing for a conversation that has begun, while settings load, or with no defaults', async () => {
  for (const [form, blank] of [[defaultsForm('ready', { video: { provider: 'reactor', model: 'fast' } }).form, false],
    [defaultsForm('loading', {}).form, true], [defaultsForm('ready', {}).form, true]] as const) {
    const { script, runtime } = await mount({ form, blank })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(selectWrites(script)).toEqual([])
    await runtime.dispose()
    cleanup()
  }
})

it('writes the home picker choice to the Settings defaults when no project is open, and clears it', async () => {
  const { form, mutate } = defaultsForm('ready', { video: { provider: 'reactor', model: 'fast' } })
  const { view, runtime } = await mount({ form, project: null })
  fireEvent.click(await view.findByRole('button', { name: 'Generation model: FastH3-Omni · Reactor' }))
  const list = within(document.body).getByRole('listbox', { name: 'Generation model' })
  fireEvent.click(within(list).getByRole('option', { name: /Video · Auto/ }))
  await waitFor(() => { expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['defaults'], value: {} }], 4) })
  await runtime.dispose()
})

it('adds a home picker choice to the Settings defaults and reports Settings that changed meanwhile', async () => {
  const { form, mutate } = defaultsForm('ready', {})
  const { view, runtime } = await mount({ form, project: null })
  fireEvent.click(await view.findByRole('button', { name: 'Generation model: Auto' }))
  fireEvent.click(within(within(document.body).getByRole('listbox', { name: 'Generation model' })).getByRole('option', { name: /FastH3-Omni/ }))
  await waitFor(() => { expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['defaults'],
    value: { video: { provider: 'reactor', model: 'fast' } } }], 4) })
  mutate.mockResolvedValueOnce(false)
  fireEvent.click(await view.findByRole('button', { name: 'Generation model: Auto' }))
  fireEvent.click(within(within(document.body).getByRole('listbox', { name: 'Generation model' })).getByRole('option', { name: /FastH3-Omni/ }))
  expect((await view.findByRole('alert')).textContent).toContain('Settings changed elsewhere')
  await runtime.dispose()
})

it('reports unavailable Settings when the defaults form has not loaded', async () => {
  const { form } = defaultsForm('loading', {})
  const { view, runtime } = await mount({ form, project: null })
  fireEvent.click(await view.findByRole('button', { name: 'Generation model: Auto' }))
  fireEvent.click(within(within(document.body).getByRole('listbox', { name: 'Generation model' })).getByRole('option', { name: /FastH3-Omni/ }))
  expect((await view.findByRole('alert')).textContent).toContain('Settings are unavailable.')
  await runtime.dispose()
})


it('seeds nothing for a conversation that already holds a choice, and records Auto for a media type the user clears', async () => {
  const state = fixtureState()
  state.components['models'] = { conversations: { s1: { video: { provider: 'reactor', model: 'fast' } } } }
  const { form } = defaultsForm('ready', { video: { provider: 'reactor', model: 'other' } })
  const { view, script, runtime } = await mount({ form, routes: { state } })
  fireEvent.click(await view.findByRole('button', { name: 'Generation model: FastH3-Omni · Reactor' }))
  expect(selectWrites(script)).toEqual([])
  fireEvent.click(within(within(document.body).getByRole('listbox', { name: 'Generation model' })).getByRole('option', { name: /Video · Auto/ }))
  await waitFor(() => { expect(selectWrites(script)).toHaveLength(1) })
  expect(selectWrites(script)[0]?.body).toMatchObject({ params: { modality: 'video', provider: '', model: '' } })
  await runtime.dispose()
})
