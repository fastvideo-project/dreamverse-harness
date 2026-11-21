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
import { ModelPickers, modelChoices, pickerModalities } from '../src/client/ModelPicker.tsx'

let originalLanguage: string
beforeEach(() => { originalLanguage = document.documentElement.lang; document.documentElement.lang = 'en' })
afterEach(() => { cleanup(); document.documentElement.lang = originalLanguage; vi.restoreAllMocks() })
const model = (name: string, task = 't2v'): WireModelEntry => ({ modality: 'video', task, provider: 'fastvideo',
  model: name, description: name, display_name: name === 'pika' ? 'Pika H3 Flex' : 'FastH3 Omni', schema: {} })
const image = (name: string): WireModelEntry => ({ modality: 'image', task: 't2i', provider: 'openrouter',
  model: name, description: name, display_name: name === 'flux' ? 'FLUX 3' : 'Seedream 5', schema: {} })

describe('conversation model choices', () => {
  const props = (
    state: ReturnType<typeof createSnapshotStore<ReturnType<typeof fixtureState>>>,
    models: HostObservable<readonly WireModelEntry[] | null>,
    extra: Partial<Parameters<typeof ModelPickers>[0]> = {}) =>
    ({ sessionId: 's1', state, models, reloadModels: () => {}, save: async () => {}, ...extra })

  it('groups tasks into one choice and follows an agent switch and a restored conversation', async () => {
    const state = createSnapshotStore(fixtureState())
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([model('pika'), model('pika', 'ref2v'), model('omni', 'ref2v')])
    const save = vi.fn(async (writes: readonly (readonly [string, { provider: string; model: string } | null])[]) => {
      state.set({ ...state.getSnapshot(), components: { ...state.getSnapshot().components,
        models: { conversations: { s1: { video: writes[0]?.[1] } } } } })
    })
    const view = render(<ModelPickers {...props(state, catalog, { save })} providerName={() => 'FastVideo'} />)
    fireEvent.click(view.getByRole('button', { name: 'Generation model: Auto' }))
    const list = within(document.body).getByRole('listbox', { name: 'Generation model' })
    expect(within(list).getAllByRole('option', { name: /Pika H3 Flex/ })).toHaveLength(1)
    fireEvent.click(within(list).getByRole('option', { name: /Pika H3 Flex/ }))
    await act(async () => {})
    expect(save).toHaveBeenCalledWith([['video', { provider: 'fastvideo', model: 'pika' }]])
    expect(view.getByRole('button', { name: 'Generation model: Pika H3 Flex · FastVideo' })).toBeTruthy()
    act(() => { state.set({ ...state.getSnapshot(), components: { ...state.getSnapshot().components,
      models: { conversations: { s1: { video: { provider: 'fastvideo', model: 'omni' } } } } } }) })
    expect(view.getByRole('button', { name: 'Generation model: FastH3 Omni · FastVideo' })).toBeTruthy()
    view.unmount()
    const restored = render(<ModelPickers {...props(state, catalog, { save })} providerName={() => 'FastVideo'} />)
    expect(restored.getByRole('button', { name: 'Generation model: FastH3 Omni · FastVideo' })).toBeTruthy()
  })

  it('groups every model under its provider, so equal model names stay distinguishable', () => {
    const project = fixtureState()
    project.components['models'] = { conversations: { s1: { video: { provider: 'uniserve', model: 'fasth3' } } } }
    const state = createSnapshotStore(project)
    const fasth3 = { ...model('fasth3'), display_name: 'FastH3-Omni' }
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([
      { ...fasth3, provider: 'reactor', hosting: 'managed' },
      { ...fasth3, provider: 'uniserve', hosting: 'self-hosted' },
    ])
    const names: Record<string, string> = { reactor: 'Reactor' }
    const view = render(<ModelPickers {...props(state, catalog)} providerName={id => names[id] ?? 'Uniserve'}
      logoOf={id => id === 'reactor' ? ({ size }) => <i data-testid="logo">{size}</i> : undefined} />)
    fireEvent.click(view.getByRole('button', { name: 'Generation model: FastH3-Omni · Uniserve' }))
    const list = within(document.body).getByRole('listbox', { name: 'Generation model' })
    expect(within(within(list).getByRole('group', { name: 'Reactor' })).getByRole('option', { name: /^FastH3-Omni/ })).toBeTruthy()
    expect(within(within(list).getByRole('group', { name: 'Uniserve' })).getByRole('option', { name: /^FastH3-Omni/ })).toBeTruthy()
    expect(within(document.body).getAllByTestId('logo').length).toBeGreaterThan(0)
    fireEvent.change(within(document.body).getByRole('searchbox', { name: 'Search models' }), { target: { value: 'reactor' } })
    expect(within(list).queryByRole('group', { name: 'Uniserve' })).toBeNull()
  })

  it('falls back to the capitalized provider id when no provider name is supplied', () => {
    const state = createSnapshotStore(fixtureState())
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([model('pika')])
    const view = render(<ModelPickers {...props(state, catalog)} defaults={{ video: { provider: 'fastvideo', model: 'pika' } }} />)
    expect(view.getByRole('button', { name: 'Generation model: Pika H3 Flex · Fastvideo' })).toBeTruthy()
  })

  it('keeps the previous choice and reports a save failure, and hides missing weights', async () => {
    const project = fixtureState()
    project.components['models'] = { conversations: { s1: { video: { provider: 'fastvideo', model: 'pika' } } } }
    const state = createSnapshotStore(project)
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([model('pika'), { ...model('omni'), runtime: { installed: false, loaded: false, loading: false, busy: false } }])
    const save = vi.fn(async () => { throw new Error('Connection interrupted. Try again.') })
    const view = render(<ModelPickers {...props(state, catalog, { save })} />)
    fireEvent.click(view.getByRole('button', { name: 'Generation model: Pika H3 Flex · Fastvideo' }))
    expect(within(document.body).queryByRole('option', { name: /FastH3 Omni/ })).toBeNull()
    fireEvent.click(within(document.body).getByRole('option', { name: /Pika H3 Flex/ }))
    await act(async () => {})
    expect(view.getByRole('alert').textContent).toContain('Connection interrupted')
    expect(view.getByRole('button', { name: 'Generation model: Pika H3 Flex · Fastvideo' })).toBeTruthy()
  })

  it('shows a notice about the conversation models', () => {
    const state = createSnapshotStore(fixtureState())
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([model('pika')])
    const view = render(<ModelPickers {...props(state, catalog)} notice="Could not apply your default models." />)
    expect(view.getByRole('alert').textContent).toBe('Could not apply your default models.')
  })

  it('loads the catalog again when the user opens the picker after a failed load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([model('pika')])
    const models = catalogSource(load)
    const state = createSnapshotStore(fixtureState())
    const view = render(<ModelPickers {...props(state, models, { reloadModels: models.reload })} />)
    await act(async () => {})
    fireEvent.click(view.getByRole('button', { name: 'Generation model: Auto' }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    expect(within(document.body).getByText('Pika H3 Flex')).toBeTruthy()
  })

  it('lets a prompt that opens later load the catalog again while the picker stays subscribed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([model('pika')])
    const models = catalogSource(load)
    const state = createSnapshotStore(fixtureState())
    render(<ModelPickers {...props(state, models, { reloadModels: models.reload })} />)
    await act(async () => {})
    const prompt = render(<CatalogReader models={models} />)
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    expect(prompt.getByTestId('catalog').textContent).toBe('1 models')
  })

  it('lists every reachable media model in one picker and saves the chosen model for its own media type', async () => {
    const project = fixtureState()
    project.components['models'] = { conversations: { s1: { video: { provider: 'fastvideo', model: 'pika' } } } }
    const state = createSnapshotStore(project)
    const unreachable = { ...image('seedream'), schema: null }
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([model('pika'), image('flux'), unreachable])
    const save = vi.fn(async () => {})
    const view = render(<ModelPickers sessionId="s1" state={state} models={catalog} reloadModels={() => {}} save={save} />)
    fireEvent.click(view.getByRole('button', { name: 'Generation model: Pika H3 Flex · Fastvideo' }))
    const list = within(document.body).getByRole('listbox', { name: 'Generation model' })
    expect(within(list).getByRole('option', { name: /Pika H3 Flex/, selected: true })).toBeTruthy()
    expect(within(list).queryByText('Seedream 5')).toBeNull()
    const dialog = view.getByRole('dialog', { name: 'Generation model' })
    expect(within(dialog).getByRole('button', { name: 'Audio' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Image', pressed: false }))
    expect(within(dialog).getByRole('button', { name: 'Image', pressed: true })).toBeTruthy()
    expect(within(list).queryByRole('option', { name: /Pika H3 Flex/ })).toBeNull()
    fireEvent.click(within(list).getByRole('option', { name: /FLUX 3/ }))
    await act(async () => {})
    expect(save).toHaveBeenCalledWith([['image', { provider: 'openrouter', model: 'flux' }]])
    fireEvent.click(view.getByRole('button', { name: 'Generation model: Pika H3 Flex · Fastvideo' }))
    fireEvent.click(within(within(document.body).getByRole('listbox', { name: 'Generation model' })).getByRole('option', { name: /Pika H3 Flex/ }))
    await act(async () => {})
    expect(save).toHaveBeenLastCalledWith([['video', null]])
  })

  it('clears every chosen media type in one write, and shows a default only before the conversation chooses', async () => {
    const state = createSnapshotStore(fixtureState())
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([model('pika'), image('flux')])
    const save = vi.fn(async () => {})
    const defaults = { video: { provider: 'fastvideo', model: 'pika' }, image: { provider: 'openrouter', model: 'flux' } }
    const view = render(<ModelPickers sessionId="s1" state={state} models={catalog} reloadModels={() => {}} save={save}
      defaults={defaults} />)
    // No project choice yet: the saved defaults stand in, and one gesture clears both at once.
    fireEvent.click(view.getByRole('button', { name: 'Generation model: Pika H3 Flex · Fastvideo +1' }))
    fireEvent.click(within(within(document.body).getByRole('listbox', { name: 'Generation model' }))
      .getByRole('option', { name: /Auto · the director chooses/ }))
    await act(async () => {})
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith([['video', null], ['image', null]])
    // Once the conversation holds a choice, a media type it left on Auto no longer shows the default.
    state.update((draft) => {
      (draft.components as Record<string, unknown>)['models'] = { conversations: { s1: {} } }
    })
    await act(async () => {})
    expect(view.getByRole('button', { name: 'Generation model: Auto' })).toBeTruthy()
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

  it('describes each model with its hosting, tasks, and runtime state, and ignores Auto when nothing is chosen', async () => {
    const state = createSnapshotStore(fixtureState())
    const runtime = (patch: Partial<NonNullable<WireModelEntry['runtime']>>) => ({ installed: true, loaded: false, loading: false, busy: false, ...patch })
    const catalog = createSnapshotStore<readonly WireModelEntry[] | null>([
      { ...model('a'), hosting: 'managed', runtime: runtime({ busy: true }) },
      { ...model('b'), hosting: 'self-hosted', runtime: runtime({ loading: true }) },
      { ...model('c'), runtime: runtime({ loaded: true }) },
      { ...model('d'), runtime: runtime({}) },
      { ...model('e'), runtime: null },
    ])
    const save = vi.fn(async () => {})
    const view = render(<ModelPickers sessionId="s1" state={state} models={catalog} reloadModels={() => {}} save={save} />)
    fireEvent.click(view.getByRole('button', { name: 'Generation model: Auto' }))
    const dialog = within(document.body).getByRole('dialog', { name: 'Generation model' })
    const facts = () => within(dialog).getByRole('complementary').textContent ?? ''
    const options = within(dialog).getAllByRole('option')
    const hover = (index: number) => { fireEvent.mouseEnter(options[index]!) }
    hover(1)
    expect(facts()).toContain('Cloud')
    expect(facts()).toContain('Generating')
    hover(2)
    expect(facts()).toContain('Self-hosted')
    expect(facts()).toContain('Loading')
    hover(3)
    expect(facts()).toContain('Loaded')
    hover(4)
    expect(facts()).toContain('Installed')
    hover(5)
    expect(facts()).toContain('Available')
    fireEvent.click(options[0]!)
    expect(save).not.toHaveBeenCalled()
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
