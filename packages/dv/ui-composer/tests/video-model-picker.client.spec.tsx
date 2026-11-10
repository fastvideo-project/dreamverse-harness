// @vitest-environment jsdom
/** Conversation choice updates through project state and does not replace the chat draft. */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WireModelEntry } from '@dv/ui-kit/types.ts'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { VideoModelPicker, videoChoices } from '../src/client/VideoModelPicker.tsx'

let originalLanguage: string
beforeEach(() => { originalLanguage = document.documentElement.lang; document.documentElement.lang = 'en' })
afterEach(() => { cleanup(); document.documentElement.lang = originalLanguage })
const model = (name: string, task = 't2v'): WireModelEntry => ({ modality: 'video', task, provider: 'fastvideo',
  model: name, description: name, display_name: name === 'pika' ? 'Pika H3 Flex' : 'FastH3 Omni', schema: {} })

describe('conversation video choice', () => {
  it('groups tasks into one choice and follows an agent switch and a restored conversation', async () => {
    const state = createSnapshotStore(fixtureState())
    const catalog = createSnapshotStore([model('pika'), model('pika', 'ref2v'), model('omni', 'ref2v')])
    const save = vi.fn(async (selection) => {
      state.set({ ...state.getSnapshot(), components: { ...state.getSnapshot().components,
        models: { conversations: { s1: selection } } } })
    })
    const view = render(<VideoModelPicker sessionId="s1" state={state} models={catalog} save={save} />)
    fireEvent.click(view.getByRole('button', { name: 'Video model: Auto' }))
    const menu = within(document.body).getByRole('menu')
    expect(within(menu).getAllByText('Pika H3 Flex')).toHaveLength(1)
    fireEvent.click(within(menu).getByText('Pika H3 Flex'))
    await act(async () => {})
    expect(save).toHaveBeenCalledWith({ provider: 'fastvideo', model: 'pika' })
    expect(view.getByRole('button', { name: 'Video model: Pika H3 Flex' })).toBeTruthy()
    act(() => { state.set({ ...state.getSnapshot(), components: { ...state.getSnapshot().components,
      models: { conversations: { s1: { provider: 'fastvideo', model: 'omni' } } } } }) })
    expect(view.getByRole('button', { name: 'Video model: FastH3 Omni' })).toBeTruthy()
    view.unmount()
    const restored = render(<VideoModelPicker sessionId="s1" state={state} models={catalog} save={save} />)
    expect(restored.getByRole('button', { name: 'Video model: FastH3 Omni' })).toBeTruthy()
  })

  it('keeps the previous choice and reports a save failure, and hides missing weights', async () => {
    const project = fixtureState()
    project.components['models'] = { conversations: { s1: { provider: 'fastvideo', model: 'pika' } } }
    const state = createSnapshotStore(project)
    const catalog = createSnapshotStore([model('pika'), { ...model('omni'), runtime: { installed: false, loaded: false, loading: false, busy: false } }])
    const save = vi.fn(async () => { throw new Error('Connection interrupted. Try again.') })
    const view = render(<VideoModelPicker sessionId="s1" state={state} models={catalog} save={save} />)
    fireEvent.click(view.getByRole('button', { name: 'Video model: Pika H3 Flex' }))
    expect(within(document.body).queryByRole('menuitem', { name: 'FastH3 Omni' })).toBeNull()
    fireEvent.click(within(document.body).getByText('Auto · let the operator choose'))
    await act(async () => {})
    expect(view.getByRole('alert').textContent).toContain('Connection interrupted')
    expect(view.getByRole('button', { name: 'Video model: Pika H3 Flex' })).toBeTruthy()
  })

  it('ignores non-video models', () => {
    expect(videoChoices([{ ...model('text'), modality: 'text' }, model('pika')])).toEqual([model('pika')])
  })
})
