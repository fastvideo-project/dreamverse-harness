// @vitest-environment jsdom
/**
 * The DreamVerse right-panel guide: the four fixed panels, then the panels that plugins outside DSH register, such as a
 * DreamVerse plugin's or an installed plugin's own tab, each opening its tab type; DSH tab types and the fixed panels'
 * own registrations are not repeated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { SidebarRightGuideBox } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DreamVerseGuide, isPluginPanel, type GuideSource } from '../src/client/chrome.tsx'

afterEach(() => { cleanup() })

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
    const tabs: GuideSource = {
      guide: () => entries,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
    const openTab = vi.fn()
    const useTabInfo = () => ({ tab: { actions: { openTab } } })
    const props: Parameters<typeof DreamVerseGuide>[0] = { useTabInfo, tabs } as never
    const view = render(<DreamVerseGuide {...props} />)
    const titles = () => [...view.container.querySelectorAll('button')].map(button => button.firstElementChild?.textContent)
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

  it('takes tab types from plugins outside DSH that the fixed panels do not offer', () => {
    expect(isPluginPanel(box('@dv/ui-example', 'dv-example', 'Example'))).toBe(true)
    expect(isPluginPanel(box('@dreamverse/ui-voice-convert', 'dv-voice', 'Voice'))).toBe(true)
    expect(isPluginPanel(box('@dv/ui-history', 'dv-history', 'History'))).toBe(false)
    expect(isPluginPanel(box('@deepseek-ai/dsh-client-ui-terminal', 'terminal', 'Terminal'))).toBe(false)
  })
})
