/**
 * The DSH sidebar pages (Plugins, MCP, and any page a plugin adds through `sidebar.panellist`), mirrored for the
 * navigator, which lists them below 首页 instead of above 新建项目 where the DSH sidebar draws them.
 *
 * @module @dv/ui-shell/panels
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

/** One sidebar page entry. */
export interface PanelEntry {
  /** The main panel id the entry opens. */
  readonly id: string
  /** The localized label. */
  readonly label: string
}

let entries: readonly PanelEntry[] = []
const listeners = new Set<() => void>()

/**
 * Subscribe to the page entries.
 * @param listener - called after each change.
 * @returns the unsubscribe function.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Read the page entries in the sidebar's order.
 * @returns the entries; the same array until they change.
 */
export function usePanelEntries(): readonly PanelEntry[] {
  return useSyncExternalStore(subscribe, () => entries)
}

/**
 * Mirror the `sidebar.panellist` registrations, sorted by their order, as entries come and go and the language changes.
 * @param ctx - the shell's client context.
 */
export function followPanelEntries(ctx: Context): void {
  const sync = (): void => {
    const next = ctx.slots.entriesOfSlot('sidebar.panellist')
      .map(({ options }) => ({ id: options.id ?? '', order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? options.id ?? '' }))
      .filter(entry => entry.id !== '')
      .sort((a, b) => a.order - b.order)
      .map(({ id, label }) => ({ id, label }))
    const key = (list: readonly PanelEntry[]): string => list.map(entry => `${entry.id}\n${entry.label}`).join('\n\n')
    if (key(next) === key(entries)) return
    entries = next
    for (const listener of listeners) listener()
  }
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', sync), 'ui-shell: sidebar page entries')
  ctx.inject(['locale'], (scope) => { scope.effect(() => scope.locale.subscribe(sync), 'ui-shell: sidebar page labels') })
  sync()
}
