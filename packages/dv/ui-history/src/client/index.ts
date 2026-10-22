/**
 * Browser half: provide `dvHistory`, the registry of the history rows that plugin UI halves register and the record
 * label that the chat reads; register `dv-history` as a right-Sidebar tab type and its body; open the tab when a
 * `dv:history-focus` event asks for a record; and export the History panel for direct rendering.
 *
 * @module @dv/ui-history/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DvClient } from '@dv/ui-kit/api.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import { DV_HISTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
import type {} from '@dv/ui-shell/contract'
import type { DvHistory, HistoryRow } from './contract/index.ts'
import { HistoryTabBody, type HistoryInjected } from './HistoryPanel.tsx'
import { HISTORY_ID, HISTORY_KIND, historyDefinition } from './definition.ts'
import { actionLabel, matchingRow } from './rows.ts'

export { HistoryPanel, type HistoryPanelProps } from './HistoryPanel.tsx'
export { HISTORY_ID, HISTORY_KIND }

/** Required browser services: the tab registry and the DSH UI slot registry. */
export const inject = ['slots', 'sidebarRightTabs']

/**
 * Client plugin body: provide `dvHistory`; register the tab type and its body under the type's id, whose selected
 * records move the center through `dvCenter` while `@dv/ui-shell` provides it; while the right panel service is
 * present, a `dv:history-focus` event opens the tab (the panel itself selects the record).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // At apply's top level, never inside an effect: other plugins register into the registry from their own fibers.
  const rows = createRegistry<HistoryRow>(row => [row.match], row => `the History row of ${row.match}`)
  const history: DvHistory = {
    rows,
    describe: (record, operations) => {
      const registered = rows.getSnapshot()
      if (matchingRow(record, registered)?.media === undefined) return null
      return actionLabel(record, { operations, rows: registered, records: new Map() })
    },
  }
  ctx.reflect.provide('dvHistory', history)
  ctx.effect(() => ctx.sidebarRightTabs.register(historyDefinition), 'ui-history: tab type')
  const injected: HistoryInjected = {
    client: new DvClient(),
    hooks: { rows },
    showInCenter: (target) => { ctx.get('dvCenter')?.show(target) },
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: HISTORY_ID, inject: () => injected },
    HistoryTabBody,
  )), 'ui-history: tab body')
  ctx.inject(['sidebarRight'], (scope) => {
    scope.effect(() => {
      const open = (): void => { scope.sidebarRight.openTab(HISTORY_KIND) }
      window.addEventListener(DV_HISTORY_FOCUS_EVENT, open)
      return () => { window.removeEventListener(DV_HISTORY_FOCUS_EVENT, open) }
    }, 'ui-history: open on dv:history-focus')
  })
}
