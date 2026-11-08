/**
 * Browser half: register `dv-asset-pool` as a right-Sidebar tab type and its body; fill the canvas's picker slot at key
 * `assets` with the asset pool panel, whose tiles open the `dvMedia` preview; register the canvas node type of assets
 * with its card and editor; register the image, video and audio media types and their
 * `dv.media.view` entries, because every asset enters a project through `asset.import`; and export the asset pool panel
 * for the workspace shell to render directly.
 *
 * @module @dv/ui-asset-pool/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DvClient } from '@dv/ui-kit/api.ts'
import type {} from '@dv/ui-media/contract'
import { AssetsPanel, AssetsTabBody } from './AssetsPanel.tsx'
import type { AssetsTabInjected } from './AssetsPanel.tsx'
import { AssetCard, AssetEditor, assetNodeType } from './canvas.tsx'
import { ASSET_POOL_ID, ASSET_POOL_KIND, assetPoolDefinition } from './definition.ts'
import { MEDIA_TYPES } from './media.tsx'

export { AssetsPanel, type AssetsPanelProps } from './AssetsPanel.tsx'
export { ASSET_POOL_ID, ASSET_POOL_KIND }

/** Required browser services: the tab registry and the DSH UI slot registry. */
export const inject = ['slots', 'sidebarRightTabs']

/**
 * Client plugin body: register the tab type and its body under the type's id; while the canvas declares them, the
 * picker, card and editor entries; while `dvCanvas` is present, the node type and its action; and while `dvMedia` is
 * present, each media type with its view, in one step, so a type that does not register leaves no view.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register(assetPoolDefinition), 'ui-asset-pool: tab type')
  const client = new DvClient()
  const preview: AssetsTabInjected['preview'] = (projectId, asset, opener) => { ctx.get('dvMedia')?.preview(projectId, asset, opener) }
  const injected: AssetsTabInjected = { client, preview }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ASSET_POOL_ID, inject: () => injected },
    AssetsTabBody,
  )), 'ui-asset-pool: tab body')
  ctx.effect(() => ctx.slots.inject('dv.canvas.picker', () => ctx.slots.register(
    { name: 'dv.canvas.picker', key: 'assets', inject: () => ({ client }) }, AssetsPanel,
  )), 'ui-asset-pool: canvas picker')
  ctx.effect(() => ctx.slots.inject('dv.canvas.card', () => ctx.slots.register({ name: 'dv.canvas.card', key: 'asset' }, AssetCard)), 'ui-asset-pool: card')
  ctx.effect(() => ctx.slots.inject('dv.canvas.editor', () => ctx.slots.register({ name: 'dv.canvas.editor', key: 'asset' }, AssetEditor)), 'ui-asset-pool: editor')
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.nodeTypes.register(assetNodeType), 'ui-asset-pool: node type')
  })
  ctx.inject(['dvMedia', 'slots'], (scope) => {
    for (const { type, View } of MEDIA_TYPES) {
      scope.effect(() => {
        const unregister = scope.dvMedia.types.register(type)
        const unview = scope.slots.inject('dv.media.view', () => scope.slots.register({ name: 'dv.media.view', key: type.id }, View))
        return () => { unview(); unregister() }
      }, `ui-asset-pool: media type ${type.id}`)
    }
  })
}
