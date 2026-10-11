// @vitest-environment jsdom
/** The navigator's copy of the DSH sidebar pages: order, labels, entries that come and go, and the language. */
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { followPanelEntries, usePanelEntries } from '../src/client/panels.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Options {
  id?: string
  order?: number
  label?: () => string
}

/** Print the page entries as `id:label` rows. */
function Pages(): ReactNode {
  return <p>{usePanelEntries().map(page => `${page.id}:${page.label}`).join(' ')}</p>
}

describe('followPanelEntries', () => {
  it('lists the sidebar pages in order and follows registrations and the language', async () => {
    let language = 'zh'
    let options: Options[] = [
      { id: 'skills', order: 2, label: () => (language === 'zh' ? '技能' : 'Skills') },
      { id: 'plugins', order: 0, label: () => (language === 'zh' ? '插件' : 'Plugins') },
      { order: 1, label: () => 'no id' },
    ]
    const slotListeners = new Set<() => void>()
    const localeListeners = new Set<() => void>()
    const ctx = new Context()
    ctx.provide('slots', {
      entriesOfSlot: () => options.map(entry => ({ options: entry })),
      subscribe: (_name: string, listener: () => void) => { slotListeners.add(listener); return () => { slotListeners.delete(listener) } },
    } as never)
    ctx.provide('locale', {
      subscribe: (listener: () => void) => { localeListeners.add(listener); return () => { localeListeners.delete(listener) } },
    } as never)
    const fiber = ctx.plugin({ inject: ['slots'], apply: followPanelEntries })
    await fiber.await()

    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => { root.render(<Pages />) })
    expect(host.textContent).toBe('plugins:插件 skills:技能')

    // A plugin registers a page between the two.
    options = [...options, { id: 'mcp', order: 1, label: () => 'MCP' }]
    act(() => { for (const listener of slotListeners) listener() })
    expect(host.textContent).toBe('plugins:插件 mcp:MCP skills:技能')

    act(() => { language = 'en'; for (const listener of localeListeners) listener() })
    expect(host.textContent).toBe('plugins:Plugins mcp:MCP skills:Skills')

    // A plugin that unloads removes its page.
    options = options.filter(entry => entry.id !== 'skills')
    act(() => { for (const listener of slotListeners) listener() })
    expect(host.textContent).toBe('plugins:Plugins mcp:MCP')

    act(() => { root.unmount() })
    await fiber.dispose()
    expect(slotListeners.size).toBe(0)
    expect(localeListeners.size).toBe(0)
  })
})
