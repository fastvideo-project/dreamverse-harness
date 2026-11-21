// @vitest-environment jsdom
/** The connections list also holds the LLM providers of the core Models page, and the shell registers both settings seats. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'

vi.mock('@deepseek-ai/dsh-client-ui-settings-models/client', () => ({
  providerUsable: (row: { configured: boolean }) => row.configured,
  protocolChoices: () => ['openai'],
  ProviderEditor: ({ displayName, onClose }: { displayName: string; onClose: () => void }) =>
    <div data-testid="editor">{displayName}<button type="button" onClick={onClose}>Done editing</button></div>,
  CustomProviderCard: ({ onClose }: { onClose: () => void }) => <div data-testid="custom"><button type="button" onClick={onClose}>Done custom</button></div>,
}))

const { ModelsPage, Connections, applyCloudModelsSettings } = await import('../src/client/CloudModelsSettings.tsx')
const { CloudConnections } = await import('../src/client/cloud-connections.ts')
const { createLlmReadiness } = await import('../src/client/llm-readiness.ts')

const EMPTY_SELECTION = { writable: true, enabled: [] }
const LOADING = { status: 'loading', writable: false, revision: 0 }

beforeEach(() => { document.documentElement.lang = 'en' })
afterEach(cleanup)

const row = (provider: string, displayName: string, configured: boolean, removable = false) => ({
  entry: { provider, displayName, active: true, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] },
  configured, removable, apiKeyEnv: undefined, credential: { configured },
})

function page(remove: () => Promise<string | undefined>, writable = true) {
  return {
    rows: [row('deepseek', 'DeepSeek', true), row('amazon-bedrock', 'amazon-bedrock', false), row('mine', 'Mine', true, true)],
    namespaces: new Map([['llm-pi-ai', { revision: 1 }]]), writable, operations: {}, remove, schema: {}, status: 'ready', t: (key: string) => key,
  } as never
}

it('lists the usable LLM providers beside the generation providers, and removes a user-added profile after confirmation', async () => {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const connections = new CloudConnections()
  const remove = vi.fn().mockResolvedValueOnce('Could not remove it').mockResolvedValue(undefined)
  render(<Connections providers={providers} connections={connections} page={page(remove)} />)
  expect(screen.getByText('2 connected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Manage Mine' }))
  expect(within(screen.getByRole('dialog')).getByTestId('editor').textContent).toContain('Mine')
  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove connection' }).at(-1)!)
  expect((await screen.findByRole('alert')).textContent).toBe('Could not remove it')
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove connection' }).at(-1)!)
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(remove).toHaveBeenCalledTimes(2)
  connections.dispose()
})

it('adds a connection by LLM provider name, by custom endpoint, and by search, and closes with Escape or the mask', async () => {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  providers.register({
    id: 'reactor', name: 'Reactor', domain: 'reactor.inc', keyUrl: 'https://x', logo: () => null, media: ['video'],
    settings: { getSnapshot: () => EMPTY_SELECTION, subscribe: () => () => {} },
    account: async () => ({ status: 'missing' }), verify: async () => ({ status: 'missing' }), removeKey: async () => {},
    load: async () => ({ models: [] }), setEnabled: async () => {},
  })
  const connections = new CloudConnections()
  render(<Connections providers={providers} connections={connections} page={page(async () => undefined, false)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add a connection' }))
  const drawer = screen.getByRole('dialog', { name: 'Add a connection' })
  expect(within(drawer).getByText('Amazon Bedrock')).toBeTruthy()
  expect(within(drawer).getByText('Reactor')).toBeTruthy()
  fireEvent.click(within(drawer).getByRole('button', { name: 'LLM' }))
  expect(within(drawer).queryByText('Reactor')).toBeNull()
  fireEvent.click(within(drawer).getByRole('button', { name: 'Video' }))
  expect(within(drawer).getByText('Reactor')).toBeTruthy()
  fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Search providers' }), { target: { value: 'zzz' } })
  expect(within(drawer).queryByText('Reactor')).toBeNull()
  fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Search providers' }), { target: { value: '' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'All' }))
  fireEvent.click(within(drawer).getByText('Amazon Bedrock'))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'All connections' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Custom endpoint'))
  fireEvent.click(screen.getByRole('button', { name: 'Done custom' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add a connection' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add a connection' }))
  fireEvent.click(document.querySelector('[aria-hidden="true"][class*="sheetMask"]')!)
  expect(screen.queryByRole('dialog')).toBeNull()
  connections.dispose()
})

it('registers the connections header and the model table footer in the Models settings', () => {
  const registrations: { name: string; id: string; inject: () => Record<string, unknown> }[] = []
  const effects: (() => unknown)[] = []
  const scope = {
    configForms: { get: () => ({ getSnapshot: () => LOADING, subscribe: () => () => {} }) },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [], routableProviders: [] } }) } },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (entry: { name: string; id: string; inject: () => Record<string, unknown> }) => { registrations.push(entry) },
    },
    effect: (fn: () => unknown) => { effects.push(fn); fn() },
  }
  const provided: Record<string, unknown> = {}
  const ctx = {
    effect: (fn: () => () => void) => { effects.push(fn) },
    reflect: { provide: (name: string, value: unknown) => { provided[name] = value } },
    inject: (_services: string[], fn: (scope: unknown) => void) => { fn(scope) },
  } as never
  applyCloudModelsSettings(ctx)
  expect(Object.keys(provided)).toEqual(['dvCloudModels'])
  expect(registrations.map(entry => entry.id)).toEqual(['dv-models-page', 'dv-cloud-models'])
  const header = registrations[0]!.inject() as {
    source: { mediaCatalog: (signal: AbortSignal) => Promise<unknown>; llmCatalog: () => Promise<unknown> }
  }
  const footer = registrations[1]!.inject() as { loadLlmCatalog: () => Promise<unknown> }
  return Promise.all([header.source.llmCatalog(), footer.loadLlmCatalog()]).then(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === 'api/dv/models' ? Response.json([]) : new Response('', { status: 500 })))
    await expect(header.source.mediaCatalog(new AbortController().signal)).resolves.toEqual([])
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(header.source.mediaCatalog(new AbortController().signal)).rejects.toThrow('Could not load the generation models.')
    scope.remote.session.modelCatalog = async () => ({ ok: false, error: { message: 'down' } }) as never
    await expect(header.source.llmCatalog()).rejects.toThrow('down')
    vi.unstubAllGlobals()
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
  })
})

it('draws the default models above the connections', () => {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const connections = new CloudConnections()
  const form = { getSnapshot: () => LOADING, subscribe: () => () => {} }
  render(createElement(ModelsPage, {
    ...(page(async () => undefined) as Record<string, unknown>), providers, connections, readiness: createLlmReadiness(),
    source: {
      llmForm: form, mediaForm: form, llmCatalog: async () => ({ groups: [], routableProviders: [] }), mediaCatalog: async () => [],
    },
  } as never))
  expect(screen.getByRole('heading', { name: 'Default models' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Your connections' })).toBeTruthy()
  connections.dispose()
})

it('draws one card per provider, listing chat among the roles of a provider that serves generation and chat', () => {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  providers.register({
    id: 'openrouter', name: 'OpenRouter', domain: 'openrouter.ai', keyUrl: 'https://x', logo: () => null, media: ['video', 'image', 'audio'],
    settings: { getSnapshot: () => EMPTY_SELECTION, subscribe: () => () => {} },
    account: async () => ({ status: 'missing' }), verify: async () => ({ status: 'missing' }), removeKey: async () => {},
    load: async () => ({ models: [] }), setEnabled: async () => {},
  })
  const connections = new CloudConnections()
  const shared = { ...page(async () => undefined) as { rows: unknown[] } }
  shared.rows = [row('openrouter', 'OpenRouter', true), row('deepseek', 'DeepSeek', true)]
  render(<Connections providers={providers} connections={connections} page={shared as never} />)
  expect(screen.getAllByRole('button', { name: 'Manage OpenRouter' })).toHaveLength(1)
  expect(within(screen.getByRole('button', { name: 'Manage OpenRouter' })).getByText('Video · Image · Audio · Chat')).toBeTruthy()
  expect(within(screen.getByRole('button', { name: 'Manage DeepSeek' })).getByText('LLM')).toBeTruthy()
  expect(screen.getByText('2 connected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Add a connection' }))
  const drawer = screen.getByRole('dialog', { name: 'Add a connection' })
  expect(within(drawer).getAllByText('OpenRouter')).toHaveLength(1)
  connections.dispose()
})

it('publishes the usable LLM providers of the Models page for the model table', () => {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const connections = new CloudConnections()
  const readiness = createLlmReadiness()
  const form = { getSnapshot: () => LOADING, subscribe: () => () => {} }
  render(createElement(ModelsPage, {
    ...(page(async () => undefined) as Record<string, unknown>), providers, connections, readiness,
    source: {
      llmForm: form, mediaForm: form, llmCatalog: async () => ({ groups: [], routableProviders: [] }), mediaCatalog: async () => [],
    },
  } as never))
  expect([...readiness.getSnapshot() ?? []]).toEqual(['deepseek', 'mine'])
  connections.dispose()
})
