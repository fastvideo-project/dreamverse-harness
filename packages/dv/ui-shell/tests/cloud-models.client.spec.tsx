// @vitest-environment jsdom
/** Generation provider connections show the saved key and balance; one paged table selects models of every provider. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cloudSelection, type CloudAccount, type CloudModel, type CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import { CloudConnections } from '../src/client/cloud-connections.ts'
import { createLlmReadiness } from '../src/client/llm-readiness.ts'
import { Connections, ModelTable } from '../src/client/CloudModelsSettings.tsx'

afterEach(cleanup)

const connected = (balanceUsd: number | null = null): CloudAccount =>
  ({ status: 'connected', balanceUsd, label: null, limitRemainingUsd: null })

function provider(id: string, name: string, models: readonly CloudModel[], enabled: boolean, account: CloudAccount): CloudModelSettings {
  let configured = { enabled: enabled ? models.slice(0, 1) : [] }
  const listeners = new Set<() => void>()
  const settings = cloudSelection({
    getSnapshot: () => configured,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }, state => ({ writable: true, enabled: state.enabled }))
  return {
    id, name, domain: `${id}.example`, keyUrl: `https://${id}.example/keys`, logo: () => null,
    media: [...new Set(models.map(model => model.media))], settings,
    account: vi.fn(async () => account),
    verify: vi.fn(async () => connected()),
    removeKey: vi.fn(async () => {}),
    load: vi.fn(async () => ({ models })),
    setEnabled: vi.fn(async (model: CloudModel, next: boolean) => {
      configured = { enabled: next ? [model] : [] }
      for (const listener of listeners) listener()
    }),
  }
}

it('shows saved keys with balances and pages one source-aware table of picker choices', async () => {
  const previous = document.documentElement.lang
  document.documentElement.lang = 'en'
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const many = Array.from({ length: 14 }, (_, index) => ({ id: `google/veo-${index}`, name: `Veo ${String(index).padStart(2, '0')}`, media: 'video' as const }))
  const openrouter = provider('openrouter', 'OpenRouter', many, true, connected(12.5))
  const reactor = provider('reactor', 'Reactor', [{ id: 'reactor/fast-h3', name: 'FastH3', media: 'video' }], false, { status: 'missing' })
  providers.register(openrouter)
  providers.register(reactor)
  const connections = new CloudConnections()
  try {
    render(<>
      <Connections providers={providers} connections={connections} />
      <ModelTable providers={providers} connections={connections} readiness={createLlmReadiness()} />
    </>)
    const openrouterRow = await screen.findByRole('button', { name: 'Manage OpenRouter' })
    await waitFor(() => { expect(within(openrouterRow).getByText('Connected')).toBeTruthy() })
    expect(within(openrouterRow).getByText('$12.50')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: 'Manage Reactor' })).getByText('Not connected')).toBeTruthy()
    expect(reactor.load).not.toHaveBeenCalled()

    const table = screen.getByRole('table', { name: 'Model catalog' })
    await waitFor(() => { expect(within(table).getByText('Veo 00')).toBeTruthy() })
    expect(screen.getByText('1–12 of 14')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('13–14 of 14')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add a connection' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add a connection' })).getByRole('button', { name: /Reactor/ }))
    const sheet = screen.getByRole('dialog', { name: 'Add a connection' })
    fireEvent.change(within(sheet).getByPlaceholderText('Paste your API key'), { target: { value: 'rk_fixture' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Verify and save' }))
    await within(sheet).findByText('Key works. Models loaded.')
    expect(reactor.verify).toHaveBeenCalledWith('rk_fixture', expect.any(AbortSignal))
    expect(reactor.load).toHaveBeenCalledWith('rk_fixture', expect.any(AbortSignal))
    // The embedded key form is not a second dialog, and one Escape closes the drawer.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(within(sheet).getByRole('button', { name: 'All connections' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Provider' }))
    const filterMenu = screen.getByRole('menu')
    fireEvent.change(within(filterMenu).getByRole('searchbox', { name: 'Search providers' }), { target: { value: 'react' } })
    expect(within(filterMenu).queryByRole('menuitem', { name: 'OpenRouter' })).toBeNull()
    fireEvent.click(within(filterMenu).getByRole('menuitem', { name: 'Reactor' }))
    const fast = within(table).getByRole('switch', { name: 'Use FastH3 in the picker' })
    expect(fast.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(fast)
    await waitFor(() => { expect(fast.getAttribute('aria-checked')).toBe('true') })
    expect(reactor.setEnabled).toHaveBeenCalledWith(expect.objectContaining({ id: 'reactor/fast-h3' }), true)
    expect(within(table).queryByText('Veo 00')).toBeNull()
  } finally {
    connections.dispose()
    document.documentElement.lang = previous
  }
})

it('keeps the chat option checked for a provider whose key the operator profile already uses', async () => {
  const previous = document.documentElement.lang
  document.documentElement.lang = 'en'
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const disableOperator = vi.fn(async () => {})
  const openrouter = {
    ...provider('openrouter', 'OpenRouter', [{ id: 'flux', name: 'FLUX 3', media: 'image' }], true,
      connected(4)),
    enableOperator: vi.fn(async () => {}),
    disableOperator,
    operatorEnabled: () => true,
  }
  providers.register(openrouter)
  const connections = new CloudConnections()
  try {
    render(<Connections providers={providers} connections={connections} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage OpenRouter' }))
    const option = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Also use for chat LLMs' })
    expect(option.checked).toBe(true)
    fireEvent.click(option)
    await waitFor(() => { expect(option.checked).toBe(false) })
    expect(disableOperator).toHaveBeenCalledOnce()
    expect(await screen.findByText('This provider no longer serves chat LLMs.')).toBeTruthy()
  } finally {
    connections.dispose()
    document.documentElement.lang = previous
  }
})

async function openSheet(account: CloudAccount, adjust: (p: CloudModelSettings) => CloudModelSettings = p => p) {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const reactor = adjust(provider('reactor', 'Reactor', [{ id: 'reactor/fast', name: 'FastH3', media: 'video' }], true, account))
  providers.register(reactor)
  const connections = new CloudConnections()
  render(<Connections providers={providers} connections={connections} />)
  const row = await screen.findByRole('button', { name: 'Manage Reactor' })
  await waitFor(() => { expect(within(row).queryByText('Checking…')).toBeNull() })
  return { reactor, connections, row }
}

const enterKey = (value: string) => {
  fireEvent.change(screen.getByLabelText(/API key/), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }))
}

it('lists providers whose key is rejected, unreachable, or waiting for setup, each with its status line', async () => {
  document.documentElement.lang = 'en'
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const entries: [string, CloudAccount][] = [['a', { status: 'rejected' }], ['b', { status: 'unavailable' }],
    ['c', { status: 'needs-setup', message: 'Add billing' }], ['d', { status: 'connected', balanceUsd: null, label: 'me@example.com', limitRemainingUsd: 3 }]]
  for (const [id, account] of entries) providers.register(provider(id, `Provider ${id}`, [], false, account))
  const connections = new CloudConnections()
  render(<Connections providers={providers} connections={connections} />)
  const row = async (id: string) => await screen.findByRole('button', { name: `Manage Provider ${id}` })
  await waitFor(() => { expect(within(screen.getByRole('button', { name: 'Manage Provider a' })).getByText('Key rejected')).toBeTruthy() })
  expect(within(await row('b')).getByText('Account unavailable')).toBeTruthy()
  expect(within(await row('c')).getByText('Setup needed')).toBeTruthy()
  expect(within(await row('c')).getByText('· Add billing')).toBeTruthy()
  expect(within(await row('d')).getByText('· me@example.com')).toBeTruthy()
  expect(within(await row('d')).getByText('$3.00')).toBeTruthy()
  expect(screen.getByText('1 connected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
  connections.dispose()
})

it('does not store a key the provider rejects or cannot check, and keeps it in the field', async () => {
  document.documentElement.lang = 'en'
  const { reactor, row } = await openSheet(connected(1))
  fireEvent.click(row)
  vi.mocked(reactor.verify).mockResolvedValueOnce({ status: 'rejected' })
  enterKey('bad')
  expect((await screen.findByRole('alert')).textContent).toContain('Reactor rejected this key, so it was not saved.')
  expect(reactor.load).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText<HTMLInputElement>(/API key/).value).toBe('bad')
  vi.mocked(reactor.verify).mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not check this key with Reactor')
  expect(reactor.load).toHaveBeenCalledTimes(1)
})

it('stores a key whose account needs setup and shows what is missing', async () => {
  document.documentElement.lang = 'en'
  const { reactor, row } = await openSheet(connected(1))
  fireEvent.click(row)
  vi.mocked(reactor.verify).mockResolvedValueOnce({ status: 'needs-setup', message: 'Add billing' })
  vi.mocked(reactor.account).mockResolvedValue({ status: 'needs-setup', message: 'Add billing' })
  enterKey('good')
  expect((await screen.findByRole('alert')).textContent).toContain('Reactor still needs setup: Add billing')
  expect(reactor.load).toHaveBeenLastCalledWith('good', expect.any(AbortSignal))
  expect(screen.getByLabelText<HTMLInputElement>(/API key/).value).toBe('')
})

it('reports a rejected, missing, or unreachable catalog the same way for every provider', async () => {
  document.documentElement.lang = 'en'
  const { reactor, row } = await openSheet(connected(1))
  fireEvent.click(row)
  vi.mocked(reactor.load).mockResolvedValueOnce({ credentialError: 'rejected' })
  enterKey('k1')
  expect((await screen.findByRole('alert')).textContent).toContain('Reactor rejected this key')
  vi.mocked(reactor.load).mockResolvedValueOnce({ credentialError: 'missing' })
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Enter an API key first.') })
  vi.mocked(reactor.load).mockRejectedValueOnce(new Error('HTTP 502'))
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Could not load the models.') })
})

it('removes a saved key after confirmation and reports a failed removal', async () => {
  document.documentElement.lang = 'en'
  const { reactor, row } = await openSheet(connected(1))
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(reactor.removeKey).not.toHaveBeenCalled()
  vi.mocked(reactor.removeKey).mockRejectedValueOnce(new Error('denied'))
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove key' }).at(-1)!)
  expect((await screen.findByRole('alert')).textContent).toContain('Could not remove the key.')
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove key' }).at(-1)!)
  expect(await screen.findByText('Key removed.')).toBeTruthy()
  expect(reactor.removeKey).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: 'Remove key' })).toBeNull()
  expect(within(screen.getByRole('button', { name: 'Manage Reactor' })).getByText('Not connected')).toBeTruthy()
})

it('names the provider when the chat option is enabled, and closes the sheet with Escape', async () => {
  document.documentElement.lang = 'en'
  const { row } = await openSheet(connected(1), p => ({
    ...p, enableOperator: vi.fn(async () => {}), disableOperator: vi.fn(async () => {}),
  }))
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Also use for chat LLMs' }))
  expect(await screen.findByText('You can now pick Reactor LLMs in chat.')).toBeTruthy()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('reports a chat option the provider refuses', async () => {
  document.documentElement.lang = 'en'
  const { row } = await openSheet(connected(1), p => ({ ...p, enableOperator: vi.fn(async () => { throw new Error('refused') }) }))
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Also use for chat LLMs' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not update the chat LLM setting.')
})
