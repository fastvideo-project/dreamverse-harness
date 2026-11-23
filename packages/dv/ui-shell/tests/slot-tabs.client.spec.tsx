// @vitest-environment jsdom
/** The shell's tabs of its list slots: each slot keeps its own tabs, in order, and follows registrations and the language. */
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { followSlotTabs, type TabSlot, useSlotTabs } from '../src/client/slot-tabs.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Options {
  id?: string
  order?: number
  label?: () => string
}

/**
 * Print the tabs of one slot as `id:label` rows.
 * @param props - the slot.
 * @returns the element.
 */
function Tabs({ slot }: { slot: TabSlot }): ReactNode {
  return <p>{useSlotTabs(slot).map(tab => `${tab.id}:${tab.label}`).join(' ')}</p>
}

describe('followSlotTabs', () => {
  it('lists the entries of the slot in order, and follows registrations and the language', async () => {
    let language = 'zh'
    const entries: Record<TabSlot, Options[]> = {
      'dv.center.view': [
        { id: 'timeline', order: 1, label: () => (language === 'zh' ? '时间线' : 'Timeline') },
        { id: 'canvas', order: 0, label: () => (language === 'zh' ? '画布' : 'Canvas') },
      ],
    }
    const slotListeners = new Map<string, Set<() => void>>()
    const localeListeners = new Set<() => void>()
    const ctx = new Context()
    ctx.provide('slots', {
      entriesOfSlot: (name: TabSlot) => entries[name].map(entry => ({ options: entry })),
      subscribe: (name: string, listener: () => void) => {
        const listeners = slotListeners.get(name) ?? new Set()
        slotListeners.set(name, listeners.add(listener))
        return () => { listeners.delete(listener) }
      },
    } as never)
    ctx.provide('locale', {
      subscribe: (listener: () => void) => { localeListeners.add(listener); return () => { localeListeners.delete(listener) } },
    } as never)
    const fiber = ctx.plugin({
      inject: ['slots'],
      apply: (scope: Context) => { followSlotTabs(scope, 'dv.center.view') },
    })
    await fiber.await()

    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => { root.render(<Tabs slot="dv.center.view" />) })
    expect([...host.querySelectorAll('p')].map(row => row.textContent)).toEqual(['canvas:画布 timeline:时间线'])

    // A plugin that unloads removes its view from the tabs.
    entries['dv.center.view'] = entries['dv.center.view'].filter(entry => entry.id !== 'timeline')
    act(() => { for (const listener of slotListeners.get('dv.center.view') ?? []) listener() })
    act(() => { language = 'en'; for (const listener of localeListeners) listener() })
    expect([...host.querySelectorAll('p')].map(row => row.textContent)).toEqual(['canvas:Canvas'])

    act(() => { root.unmount() })
    await fiber.dispose()
    expect([...slotListeners.values()].every(listeners => listeners.size === 0)).toBe(true)
    expect(localeListeners.size).toBe(0)
  })

  it('drops an entry without an id, sorts an entry without an order as order 0, and labels an entry without a label by its id', async () => {
    const entries: Options[] = [
      { id: 'late', order: 1, label: () => 'Late' },
      { order: 0, label: () => 'Nameless' },
      {},
      { id: 'plain' },
      { id: 'early', order: -1, label: () => 'Early' },
    ]
    const ctx = new Context()
    ctx.provide('slots', {
      entriesOfSlot: () => entries.map(entry => ({ options: entry })),
      subscribe: () => () => {},
    } as never)
    const fiber = ctx.plugin({ inject: ['slots'], apply: (scope: Context) => { followSlotTabs(scope, 'dv.center.view') } })
    await fiber.await()

    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => { root.render(<Tabs slot="dv.center.view" />) })
    expect(host.textContent).toBe('early:Early plain:plain late:Late')

    act(() => { root.unmount() })
    await fiber.dispose()
  })
})
