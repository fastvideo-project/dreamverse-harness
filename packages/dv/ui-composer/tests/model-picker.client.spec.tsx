// @vitest-environment jsdom
/** Conversation choices update through project state per modality and do not replace the chat draft. */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useCallback, useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { WireModelEntry } from '@dv/ui-kit/types.ts'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { catalogSource } from '../src/client/prompt.ts'
import { ModelPicker, ModelPickers, modelChoices, pickerModalities } from '../src/client/ModelPicker.tsx'

let originalLanguage: string
beforeEach(() => { originalLanguage = document.documentElement.lang; document.documentElement.lang = 'en' })
afterEach(() => { cleanup(); document.documentElement.lang = originalLanguage; vi.restoreAllMocks() })
const model = (name: string, task = 't2v'): WireModelEntry => ({ modality: 'video', task, provider: 'fastvideo',
  model: name, description: name, display_name: name === 'pika' ? 'Pika H3 Flex' : 'FastH3 Omni', schema: {} })
const image = (name: string): WireModelEntry => ({ modality: 'image', task: 't2i', provider: 'openrouter',
  model: name, description: name, display_name: name === 'flux' ? 'FLUX 3' : 'Seedream 5', schema: {} })

describe('conversation model choices', () => {
  it('groups tasks into one choice and follows an agent switch and a restored conversation', async () => {
    const state = createSnapshotStore(fixtureState())
    const catalog = createSnapshotStore([model('pika'), model('pika', 'ref2v'), model('omni', 'ref2v')])
    const save = vi.fn(async (selection) => {
      state.set({ ...state.getSnapshot(), components: { ...state.getSnapshot().components,
        models: { conversations: { s1: { video: selection } } } } })
    })
    const view = render(<ModelPicker sessionId="s1" modality="video" state={state} models={catalog} reloadModels={() => {}} save={save} />)
    fireEvent.click(view.getByRole('button', { name: 'Video model: Auto' }))
    const menu = within(document.body).getByRole('menu')
    expect(within(menu).getAllByText('Pika H3 Flex')).toHaveLength(1)
    fireEvent.click(within(menu).getByText('Pika H3 Flex'))
    await act(async () => {})
    expect(save).toHaveBeenCalledWith({ provider: 'fastvideo', model: 'pika' })
    expect(view.getByRole('button', { name: 'Video model: Pika H3 Flex' })).toBeTruthy()
    act(() => { state.set({ ...state.getSnapshot(), components: { ...state.getSnapshot().components,
      models: { conversations: { s1: { video: { provider: 'fastvideo', model: 'omni' } } } } } }) })
    expect(view.getByRole('button', { name: 'Video model: FastH3 Omni' })).toBeTruthy()
    view.unmount()
    const restored = render(<ModelPicker sessionId="s1" modality="video" state={state} models={catalog} reloadModels={() => {}} save={save} />)
    expect(restored.getByRole('button', { name: 'Video model: FastH3 Omni' })).toBeTruthy()
  })

  it('keeps the previous choice and reports a save failure, and hides missing weights', async () => {
    const project = fixtureState()
    project.components['models'] = { conversations: { s1: { video: { provider: 'fastvideo', model: 'pika' } } } }
    const state = createSnapshotStore(project)
    const catalog = createSnapshotStore([model('pika'), { ...model('omni'), runtime: { installed: false, loaded: false, loading: false, busy: false } }])
    const save = vi.fn(async () => { throw new Error('Connection interrupted. Try again.') })
    const view = render(<ModelPicker sessionId="s1" modality="video" state={state} models={catalog} reloadModels={() => {}} save={save} />)
    fireEvent.click(view.getByRole('button', { name: 'Video model: Pika H3 Flex' }))
    expect(within(document.body).queryByRole('menuitem', { name: 'FastH3 Omni' })).toBeNull()
    fireEvent.click(within(document.body).getByText('Auto · let the operator choose'))
    await act(async () => {})
    expect(view.getByRole('alert').textContent).toContain('Connection interrupted')
    expect(view.getByRole('button', { name: 'Video model: Pika H3 Flex' })).toBeTruthy()
  })

  it('loads the catalog again when the user opens the picker after a failed load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([model('pika')])
    const models = catalogSource(load)
    const state = createSnapshotStore(fixtureState())
    const view = render(<ModelPicker sessionId="s1" modality="video" state={state} models={models} reloadModels={models.reload} save={async () => {}} />)
    await act(async () => {})
    fireEvent.click(view.getByRole('button', { name: 'Video model: Auto' }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    expect(within(document.body).getByText('Pika H3 Flex')).toBeTruthy()
  })

  it('lets a prompt that opens later load the catalog again while the picker stays subscribed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([model('pika')])
    const models = catalogSource(load)
    const state = createSnapshotStore(fixtureState())
    render(<ModelPicker sessionId="s1" modality="video" state={state} models={models} reloadModels={models.reload} save={async () => {}} />)
    await act(async () => {})
    const prompt = render(<CatalogReader models={models} />)
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    expect(prompt.getByTestId('catalog').textContent).toBe('1 models')
  })

  it('shows an image picker only while an image model is configured, and saves each modality on its own', async () => {
    const project = fixtureState()
    project.components['models'] = { conversations: { s1: { video: { provider: 'fastvideo', model: 'pika' } } } }
    const state = createSnapshotStore(project)
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([model('pika')])
    const save = vi.fn(async () => {})
    const view = render(<ModelPickers sessionId="s1" state={state} models={catalog} reloadModels={() => {}} save={save} />)
    expect(view.queryByRole('button', { name: /^Image model/ })).toBeNull()
    act(() => { catalog.set([model('pika'), image('flux'), image('seedream')]) })
    expect(view.getByRole('button', { name: 'Video model: Pika H3 Flex' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Image model: Auto' }))
    fireEvent.click(within(within(document.body).getByRole('menu')).getByText('FLUX 3'))
    await act(async () => {})
    expect(save).toHaveBeenCalledWith('image', { provider: 'openrouter', model: 'flux' })
  })

  it('keeps its catalog subscriptions across re-renders, so a re-render loads no catalog', async () => {
    const load = vi.fn(async () => [model('pika')])
    const models = catalogSource(load)
    const state = createSnapshotStore(fixtureState())
    const props = { sessionId: 's1', state, models, reloadModels: models.reload, save: async () => {} }
    const view = render(<ModelPickers {...props} />)
    await act(async () => {})
    const loads = load.mock.calls.length
    for (let index = 0; index < 5; index += 1) {
      view.rerender(<ModelPickers {...props} />)
      await act(async () => {})
    }
    expect(load).toHaveBeenCalledTimes(loads)
  })

  it('lists only the models of its modality', () => {
    expect(modelChoices([{ ...model('text'), modality: 'text' }, model('pika'), image('flux')], 'video')).toEqual([model('pika')])
    expect(modelChoices([model('pika'), image('flux')], 'image')).toEqual([image('flux')])
    expect(pickerModalities([image('flux')])).toEqual(['video', 'image'])
    expect(pickerModalities([])).toEqual(['video'])
  })
})

/** A `dv.prompt` occurrence's read of the catalog, through the same hook that its chips use. */
function CatalogReader({ models }: { models: HostObservable<readonly WireModelEntry[] | null> }) {
  const subscribe = useCallback((listener: () => void) => models.subscribe(listener), [models])
  const catalog = useSyncExternalStore(subscribe, useCallback(() => models.getSnapshot(), [models]))
  return <span data-testid="catalog">{catalog === null ? 'no catalog' : `${catalog.length} models`}</span>
}
