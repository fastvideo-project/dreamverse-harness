// @vitest-environment jsdom
/** The model table lists the LLM models of usable providers with an In picker switch that the composer's LLM picker honours. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { llmPickerEnabled, readLlmPickerChoices } from '@dv/ui-kit/llm-picker.ts'
import type { CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import { CloudConnections } from '../src/client/cloud-connections.ts'
import { createLlmReadiness } from '../src/client/llm-readiness.ts'
import { ModelTable } from '../src/client/CloudModelsSettings.tsx'

beforeEach(() => { document.documentElement.lang = 'en'; window.localStorage.clear() })
afterEach(cleanup)

const names = ['a', 'b', 'c', 'd', 'e']
const catalog = async () => ({
  routableProviders: ['deepseek', 'groq'], default: { provider: 'deepseek', model: 'a' },
  groups: ['deepseek', 'groq'].map(id => ({ id, name: id === 'groq' ? 'Groq' : 'DeepSeek', models: names.map(name => ({ id: name, name: name.toUpperCase() })) })),
}) as never

it('lists LLM models of the usable providers only, offers the first three by default, and saves a switch for the picker', async () => {
  const providers = createRegistry<CloudModelSettings>(p => [p.id], p => p.name)
  const connections = new CloudConnections()
  const readiness = createLlmReadiness()
  render(<ModelTable providers={providers} connections={connections} readiness={readiness} loadLlmCatalog={catalog} />)
  await act(async () => {})
  // Before the Models page joins its rows, the routes the host reports stand in; then only usable providers remain.
  expect(screen.getAllByText('Groq').length).toBeGreaterThan(0)
  act(() => { readiness.set(new Set(['deepseek'])) })
  const table = screen.getByRole('table', { name: 'Model catalog' })
  expect(within(table).queryByText('Groq')).toBeNull()
  const switches = () => within(table).getAllByRole('switch').map(item => [item.getAttribute('aria-label'), item.getAttribute('aria-checked')])
  expect(switches().filter(([, checked]) => checked === 'true')).toHaveLength(3)
  expect(within(table).getAllByText('LLM').length).toBe(5)
  fireEvent.click(within(table).getByRole('switch', { name: 'Use D in the picker' }))
  const groups = [{ id: 'deepseek', models: names.map(id => ({ id })) }]
  expect([...llmPickerEnabled(readLlmPickerChoices(), groups)]).toEqual(['deepseek/a', 'deepseek/b', 'deepseek/c', 'deepseek/d'])
  fireEvent.click(within(table).getByRole('switch', { name: 'Use A in the picker' }))
  expect(within(table).getByRole('switch', { name: 'Use A in the picker' }).getAttribute('aria-checked')).toBe('false')
  connections.dispose()
})
