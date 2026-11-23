/**
 * The tabs that the shell draws from the entries of its list slot `dv.center.view`, declared in `./contract`: the
 * workspace's view toggle. Each entry is one tab, labeled and ordered by its registration; the selected tab's body is
 * the entry's component.
 *
 * @module @dv/ui-shell/slot-tabs
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './contract/index.ts'
import type {} from '../index.ts'

/** The list slots whose entries the shell draws as tabs. */
export type TabSlot = 'dv.center.view'

/** One tab: an entry of a list slot. */
export interface SlotTab {
  /** The entry id, which `renderSlot`'s `only` selects. */
  readonly id: string
  /** The localized tab label the entry registered. */
  readonly label: string
}

const tabs: Record<TabSlot, readonly SlotTab[]> = { 'dv.center.view': [] }
const listeners = new Set<() => void>()

/**
 * Read the tabs of a slot in their entries' order.
 * @param slot - the list slot.
 * @returns the tabs; the same array until they change.
 */
export function useSlotTabs(slot: TabSlot): readonly SlotTab[] {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => tabs[slot],
  )
}

/**
 * Mirror the registrations of a slot as tabs, sorted by their order, as entries come and go and the language changes.
 * @param ctx - the shell's client context.
 * @param slot - the list slot.
 */
export function followSlotTabs(ctx: Context, slot: TabSlot): void {
  const sync = (): void => {
    const next = ctx.slots.entriesOfSlot(slot)
      .map(({ options }) => ({ id: options.id ?? '', order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? options.id ?? '' }))
      .filter(tab => tab.id !== '')
      .sort((a, b) => a.order - b.order)
      .map(({ id, label }) => ({ id, label }))
    const key = (list: readonly SlotTab[]): string => list.map(tab => `${tab.id}\n${tab.label}`).join('\n\n')
    if (key(next) === key(tabs[slot])) return
    tabs[slot] = next
    for (const listener of listeners) listener()
  }
  ctx.effect(() => ctx.slots.subscribe(slot, sync), `ui-shell: ${slot} entries`)
  ctx.inject(['locale'], (scope) => { scope.effect(() => scope.locale.subscribe(sync), `ui-shell: ${slot} labels`) })
  sync()
}
