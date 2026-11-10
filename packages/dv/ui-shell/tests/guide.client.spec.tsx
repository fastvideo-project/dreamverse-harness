// @vitest-environment jsdom
/**
 * The DreamVerse right-panel guide: the four fixed panels, then the panels that plugins outside DSH register, such as a
 * DreamVerse plugin's or an installed plugin's own tab, each opening its tab type; DSH tab types, the fixed panels' own
 * registrations, and the canvas and timeline types, whose views the center shows, are not repeated.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SidebarRightGuideBox } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { canvasDefinition } from '../../ui-canvas/src/client/definition.ts'
import { timelineDefinition } from '../../ui-timeline/src/client/definition.ts'
import { DreamVerseGuide, isPluginPanel } from '../src/client/chrome.tsx'

afterEach(() => { cleanup() })

/**
 * Render the guide over a source of guide entries, as the slot runtime binds `useGuideEntries` to the injected hook.
 * @param entries - the guide entries the registry lists.
 * @returns the rendered guide, its button titles, and the recorded `openTab` calls.
 */
function renderGuide(entries: ObservableSnapshot<readonly SidebarRightGuideBox[]>) {
  const openTab = vi.fn()
  const useTabInfo = () => ({ tab: { actions: { openTab } } })
  const useGuideEntries = <S,>(selector: (entries: readonly SidebarRightGuideBox[]) => S): S =>
    selector(useSyncExternalStore(listener => entries.subscribe(listener), () => entries.getSnapshot()))
  const props: Parameters<typeof DreamVerseGuide>[0] = { useTabInfo, useGuideEntries } as never
  const view = render(<DreamVerseGuide {...props} />)
  const titles = () => [...view.container.querySelectorAll('button')].map(button => button.firstElementChild?.textContent)
  return { view, titles, openTab }
}

const box = (providerId: string, kind: string, title: string, description?: string): SidebarRightGuideBox => ({
  id: kind, order: 1, providerId, kind, title: () => title, ...description === undefined ? {} : { description: () => description },
})

describe('the DreamVerse guide', () => {
  it('lists the panels of DreamVerse plugins after the four fixed ones, follows the registry, and opens the picked one', () => {
    let entries = [
      box('@dv/ui-asset-pool', 'dv-asset-pool', 'Asset pool'), box('@deepseek-ai/dsh-client-ui-files', 'files', 'Files'),
      box('@dv/ui-example', 'dv-example', 'Example', 'A panel of another DreamVerse plugin'),
    ]
    const listeners = new Set<() => void>()
    const { view, titles, openTab } = renderGuide({
      getSnapshot: () => entries,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    })
    expect(titles()).toEqual(['Chat', 'Asset pool', 'History', 'Trajectory', 'Example'])
    expect(view.getByText('A panel of another DreamVerse plugin')).toBeTruthy()
    fireEvent.click(view.getByText('Example'))
    expect(openTab).toHaveBeenCalledWith('dv-example', { replaceTab: true })
    fireEvent.click(view.getByText('History'))
    expect(openTab).toHaveBeenLastCalledWith('dv-history', { replaceTab: true })
    entries = [...entries, box('@dv/ui-notes', 'dv-notes', 'Notes')]
    act(() => { for (const listener of listeners) listener() })
    expect(titles()).toEqual(['Chat', 'Asset pool', 'History', 'Trajectory', 'Example', 'Notes'])
  })

  it('leaves out the canvas and timeline types of the shipped bundle and keeps another plugin panel', () => {
    const ctx = new Context()
    const registry = new SidebarRightTabRegistry(ctx)
    const t = ((key: string) => key) as never
    registry.register(canvasDefinition(t))
    registry.register(timelineDefinition(t))
    registry.register({
      id: '@dv/ui-example', kind: 'dv-example', title: () => 'Example',
      guide: [{ id: 'example', order: 50, title: () => 'Example' }],
    })
    expect(registry.guide().map(entry => entry.kind)).toEqual(['dv-canvas', 'dv-timeline', 'dv-example'])
    const { titles } = renderGuide({ subscribe: listener => registry.subscribe(listener), getSnapshot: () => registry.guide() })
    expect(titles()).toEqual(['Chat', 'Asset pool', 'History', 'Trajectory', 'Example'])
  })

  it('takes tab types from plugins outside DSH that the fixed panels do not offer', () => {
    expect(isPluginPanel(box('@dv/ui-example', 'dv-example', 'Example'))).toBe(true)
    expect(isPluginPanel(box('@fastvideo/dreamverse-ui-voice-convert', 'dv-voice', 'Voice'))).toBe(true)
    expect(isPluginPanel(box('@dv/ui-history', 'dv-history', 'History'))).toBe(false)
    expect(isPluginPanel(box('@dv/ui-canvas', 'dv-canvas', 'Canvas'))).toBe(false)
    expect(isPluginPanel(box('@dv/ui-timeline', 'dv-timeline', 'Timeline'))).toBe(false)
    expect(isPluginPanel(box('@deepseek-ai/dsh-client-ui-terminal', 'terminal', 'Terminal'))).toBe(false)
  })
})
