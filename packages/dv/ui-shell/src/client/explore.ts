/**
 * The tabs of the entry page's 探索 section: one per `dv.explore` entry (the slot is declared in `src/index.ts`), labeled
 * and ordered by the entry's registration. The shell draws the heading, the 收起 / 展开 toggle, and the tab row; the
 * selected tab's body is the entry's component, and the section is absent while no plugin registers an entry.
 *
 * @module @dv/ui-shell/explore
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../index.ts'

/** One 探索 tab: a `dv.explore` entry. */
export interface ExploreTab {
  /** The entry id, which `renderSlot`'s `only` selects. */
  readonly id: string
  /** The localized tab label the entry registered. */
  readonly label: string
}

let tabs: readonly ExploreTab[] = []
const listeners = new Set<() => void>()

/**
 * Read the 探索 tabs in their entries' order.
 * @returns the tabs; the same array until they change.
 */
export function useExploreTabs(): readonly ExploreTab[] {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => tabs,
  )
}

/**
 * Mirror the `dv.explore` registrations as tabs, sorted by their order, as entries come and go and the language changes.
 * @param ctx - the shell's client context.
 */
export function followExploreEntries(ctx: Context): void {
  const sync = (): void => {
    const next = ctx.slots.entriesOfSlot('dv.explore')
      .map(({ options }) => ({ id: options.id ?? '', order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? options.id ?? '' }))
      .filter(tab => tab.id !== '')
      .sort((a, b) => a.order - b.order)
      .map(({ id, label }) => ({ id, label }))
    const key = (list: readonly ExploreTab[]): string => list.map(tab => `${tab.id}\n${tab.label}`).join('\n\n')
    if (key(next) === key(tabs)) return
    tabs = next
    for (const listener of listeners) listener()
  }
  ctx.effect(() => ctx.slots.subscribe('dv.explore', sync), 'ui-shell: explore entries')
  ctx.inject(['locale'], (scope) => { scope.effect(() => scope.locale.subscribe(sync), 'ui-shell: explore labels') })
  sync()
}
