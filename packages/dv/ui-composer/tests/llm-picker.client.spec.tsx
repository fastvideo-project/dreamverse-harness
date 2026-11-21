// @vitest-environment jsdom
/** The composer's LLM picker names the provider beside every model, hides unroutable providers, and sets reasoning effort. */
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/src/client/directory.ts'
import { setLlmPickerModel } from '@dv/ui-kit/llm-picker.ts'
import { LlmPicker, type LlmPickerInjected } from '../src/client/LlmPicker.tsx'
import { PickerPopover } from '../src/client/PickerPopover.tsx'

beforeEach(() => { document.documentElement.lang = 'en'; window.localStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const effort = (id: string, name: string) => ({ id, name, description: `${name} effort` })
const groups = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] },
  { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'chat', name: 'Chat', description: 'Routed chat',
    reasoning: { efforts: [effort('low', 'Low'), effort('high', 'High')], defaultEffort: 'low' } }] },
  { id: 'local', name: 'Local', models: [{ id: 'tiny', name: 'Tiny' }] },
]

function setup(over: Partial<LlmPickerInjected> = {}, state: Partial<ModelDirectoryState> = {}) {
  const directory = createSnapshotStore<ModelDirectoryState>({
    current: { provider: 'openrouter', model: 'chat', reasoningEffort: 'low' }, routable: true, groups,
    failures: [], status: 'ready', error: null, ...state,
  })
  const select = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const props: LlmPickerInjected & { locked: boolean } = {
    locked: false, available: true, directory, load: vi.fn(), select,
    routable: vi.fn(async () => ['deepseek', 'openrouter']), logoOf: id => id === 'openrouter' ? ({ size }) => <i data-testid="or">{size}</i> : undefined,
    ...over,
  }
  const view = render(<LlmPicker {...props} />)
  return { view, props, select, directory }
}

const open = (view: ReturnType<typeof render>) => {
  fireEvent.click(view.getByRole('button', { name: /^Language model/ }))
  return within(document.body).getByRole('listbox', { name: 'Language model' })
}

it('groups models under their provider, so equal names stay distinguishable, and lists routable providers only', async () => {
  const { view } = setup()
  expect(view.getByRole('button', { name: 'Language model: Chat · OpenRouter · Low' })).toBeTruthy()
  await act(async () => {})
  const list = open(view)
  expect(within(list).getAllByRole('option', { name: /^Chat/ })).toHaveLength(2)
  expect(within(within(list).getByRole('group', { name: 'DeepSeek' })).getByRole('option', { name: /^Chat/ })).toBeTruthy()
  expect(within(within(list).getByRole('group', { name: 'OpenRouter' })).getByRole('option', { name: /^Chat/ })).toBeTruthy()
  expect(within(list).queryByRole('option', { name: /Tiny/ })).toBeNull()
  expect(within(document.body).getByText('Connect providers and choose which models appear in Settings → Models.')).toBeTruthy()
})

it('selects a model with its default effort, and keeps the current effort when the model offers it', async () => {
  const { view, select } = setup()
  await act(async () => {})
  fireEvent.click(within(within(open(view)).getByRole('group', { name: 'DeepSeek' })).getByRole('option', { name: /^Chat/ }))
  await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat' }) })
  fireEvent.click(view.getByRole('button', { name: /^Language model/ }))
  fireEvent.click(within(within(document.body).getByRole('group', { name: 'OpenRouter' })).getByRole('option', { name: /^Chat/ }))
  await waitFor(() => { expect(select).toHaveBeenLastCalledWith({ provider: 'openrouter', model: 'chat', reasoningEffort: 'low' }) })
})

it('picks the default effort for a model that does not offer the current one', async () => {
  const { view, select } = setup({}, { current: { provider: 'deepseek', model: 'chat', reasoningEffort: 'max' } })
  await act(async () => {})
  fireEvent.click(within(within(open(view)).getByRole('group', { name: 'OpenRouter' })).getByRole('option', { name: /^Chat/ }))
  await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'openrouter', model: 'chat', reasoningEffort: 'low' }) })
})

it('sets the reasoning effort from the detail card of the selected model and reports a refused selection', async () => {
  const { view, select } = setup()
  await act(async () => {})
  const list = open(view)
  fireEvent.mouseEnter(within(within(list).getByRole('group', { name: 'OpenRouter' })).getByRole('option', { name: /^Chat/ }))
  select.mockResolvedValueOnce({ ok: false, error: { message: 'Effort refused' } } as never)
  fireEvent.click(within(document.body).getByRole('button', { name: 'High' }))
  expect((await view.findByRole('alert')).textContent).toBe('Effort refused')
  select.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(within(document.body).getByRole('button', { name: 'High' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('offline') })
  select.mockRejectedValueOnce('plain')
  fireEvent.click(within(document.body).getByRole('button', { name: 'High' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('plain') })
})

it('lists every group while the route list is unknown, and renders nothing when unavailable', async () => {
  const { view } = setup({ routable: async () => { throw new Error('offline') } })
  await act(async () => {})
  expect(within(open(view)).getByRole('option', { name: /Tiny/ })).toBeTruthy()
  cleanup()
  const unavailable = setup({ available: false })
  expect(unavailable.view.container.textContent).toBe('')
  expect(unavailable.props.load).not.toHaveBeenCalled()
})

it('names an unlisted current model by its id and falls back to a prompt when none is selected', () => {
  const { view } = setup({}, { current: { provider: 'gone', model: 'ghost' } })
  expect(view.getByRole('button', { name: 'Language model: ghost' })).toBeTruthy()
  cleanup()
  const none = setup({}, { current: null })
  expect(none.view.getByRole('button', { name: 'Language model: Choose a model' })).toBeTruthy()
})

it('closes the popover on Escape and on an outside press, and filters by search and by rail button', async () => {
  const { view } = setup()
  await act(async () => {})
  open(view)
  const search = within(document.body).getByRole('searchbox', { name: 'Search models' })
  fireEvent.change(search, { target: { value: 'zzz' } })
  expect(within(document.body).getByText('No models match.')).toBeTruthy()
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.click(within(document.body).getByRole('button', { name: 'DeepSeek' }))
  expect(within(document.body).queryByRole('option', { name: /OpenRouter/ })).toBeNull()
  fireEvent.click(within(document.body).getByRole('button', { name: 'DeepSeek' }))
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(within(document.body).getByRole('dialog', { name: 'Language model' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(within(document.body).queryByRole('dialog')).toBeNull()
  open(view)
  fireEvent.pointerDown(document.body)
  expect(within(document.body).queryByRole('dialog')).toBeNull()
})

it('keeps a popover open when the selection handler asks and places it beside the trigger on a narrow window', () => {
  const onSelect = vi.fn(() => false)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(420)
  const view = render(<PickerPopover label="Pick" value="v" searchLabel="Search" emptyLabel="Empty" noneLabel={() => 'None'} groups={[{ id: 'g', name: 'G', icon: null }]}
    items={[{ id: 'a', group: 'g', label: 'A', selected: false, facts: [] }]} onSelect={onSelect} />)
  fireEvent.click(view.getByRole('button', { name: 'Pick: v' }))
  fireEvent.click(within(document.body).getByRole('option', { name: 'A' }))
  expect(onSelect).toHaveBeenCalledWith('a')
  expect(within(document.body).getByRole('dialog', { name: 'Pick' }).getAttribute('data-side')).toBe('stack')
  fireEvent.mouseEnter(within(document.body).getByRole('option', { name: 'A' }))
  fireEvent(window, new Event('resize'))
})

it('keeps the trigger to the model and effort when the provider has a logo, and the accessible name in full', async () => {
  const { view } = setup()
  await act(async () => {})
  const trigger = view.getByRole('button', { name: 'Language model: Chat · OpenRouter · Low' })
  expect(trigger.textContent).not.toContain('OpenRouter')
  expect(within(trigger).getByText('Chat · Low')).toBeTruthy()
  expect(trigger.getAttribute('title')).toBe('Chat · OpenRouter · Low')
  cleanup()
  const plain = setup({}, { current: { provider: 'deepseek', model: 'chat' } })
  expect(plain.view.getByRole('button', { name: 'Language model: Chat · DeepSeek' }).textContent).toContain('DeepSeek')
})

it('offers the first few models of each provider, then only the models switched on, and always the model in use', async () => {
  const many = { id: 'deepseek', name: 'DeepSeek', models: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id.toUpperCase() })) }
  const { view, directory } = setup({}, { groups: [many, groups[1]!], current: { provider: 'openrouter', model: 'chat' } })
  await act(async () => {})
  const list = open(view)
  const names = () => within(list).getAllByRole('option').map(option => option.children[1]?.textContent)
  expect(names()).toEqual(expect.arrayContaining(['A', 'B', 'C']))
  expect(names()).not.toContain('D')
  act(() => { setLlmPickerModel('deepseek/d', true); setLlmPickerModel('deepseek/a', false) })
  expect(names()).toContain('D')
  expect(names()).not.toContain('A')
  act(() => { directory.update((draft) => { draft.current = { provider: 'deepseek', model: 'e' } }) })
  expect(names()).toContain('E')
})

it('says to connect a provider when none can serve a request', async () => {
  const { view } = setup({ routable: async () => [] }, { current: null, groups: [] })
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: 'Language model: Connect a provider' }))
  expect(within(document.body).getByText(/No models to pick yet\./)).toBeTruthy()
})
