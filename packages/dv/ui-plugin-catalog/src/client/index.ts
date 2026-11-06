/**
 * Browser half: register the Plugins tab (a `dv.explore` entry) of the entry page's 探索 section, which lists the plugin
 * catalog of `@dv/plugin-catalog` and installs, switches on, and removes its plugins through the plugin manager.
 *
 * @module @dv/ui-plugin-catalog/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-shell/contract'
import { pickText } from '@dv/ui-kit/locale.ts'
import { CatalogShelf } from './CatalogShelf.tsx'
import { followCatalog } from './catalog.ts'

/** Required browser services: the DSH UI slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the Plugins tab once `@dv/ui-shell` declares `dv.explore`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('dv.explore', () => ctx.slots.register(
    { name: 'dv.explore', id: 'plugins', order: 2, label: () => pickText('插件', 'Plugins') }, CatalogShelf,
  )), 'ui-plugin-catalog: explore entry')
  followCatalog(ctx)
}
