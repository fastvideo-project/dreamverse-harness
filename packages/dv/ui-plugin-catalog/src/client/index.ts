/**
 * Browser half: the 插件市场 / Marketplace entry in the left navigator (a DSH `sidebar.panellist` entry that
 * `@dv/ui-shell` lists with the other sidebar pages) and the page it opens in the main column, which lists the plugin
 * catalog of `@dv/plugin-catalog` and installs, switches on, and removes its plugins through the plugin manager.
 *
 * @module @dv/ui-plugin-catalog/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { pickText } from '@dv/ui-kit/locale.ts'
import { CatalogPage, MarketplacePanelIcon } from './CatalogPage.tsx'
import { followCatalog } from './catalog.ts'

/** The id shared by the navigator entry and the main panel it opens. */
export const MARKETPLACE_PANEL_ID = 'marketplace' as MainPanelId

/** Required browser services: the DSH UI slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the Marketplace page and its navigator entry, right below 插件 / Plugins (order 0) and
 * above MCP (order 1).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: MARKETPLACE_PANEL_ID }, CatalogPage,
  )), 'ui-plugin-catalog: page')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: MARKETPLACE_PANEL_ID, order: 0.5, label: () => pickText('插件市场', 'Marketplace') }, MarketplacePanelIcon,
  )), 'ui-plugin-catalog: navigator entry')
  followCatalog(ctx)
}
