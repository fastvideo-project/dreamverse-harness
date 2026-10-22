/**
 * Browser half: register `dv-asset-pool` as a right-Sidebar tab type and its body, whose tiles open the `dvMedia`
 * preview; fill the canvas's picker slot at key `assets` with the asset pool panel; register the image, video and audio
 * media types and their `dv.media.view` entries, because every asset enters a project through `asset.import`; and
 * export the asset pool panel for the workspace shell to render directly.
 *
 * @module @dv/ui-asset-pool/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DvClient } from '@dv/ui-kit/api.ts'
import type {} from '@dv/ui-kit/registries.ts'
import type {} from '@dv/ui-media/contract'
import { AssetsPanel, AssetsTabBody } from './AssetsPanel.tsx'
import type { AssetsTabInjected } from './AssetsPanel.tsx'
import { ASSET_POOL_ID, ASSET_POOL_KIND, assetPoolDefinition } from './definition.ts'
import { AudioView, ImageView, MEDIA_TYPES, VideoView } from './media.tsx'

export { AssetsPanel, type AssetsPanelProps } from './AssetsPanel.tsx'
export { ASSET_POOL_ID, ASSET_POOL_KIND }

/** Required browser services: the tab registry and the DSH UI slot registry. */
export const inject = ['slots', 'sidebarRightTabs']

/** The view of each media type, by its MIME top-level type. */
const VIEWS = { image: ImageView, video: VideoView, audio: AudioView } as const

/**
 * Client plugin body: register the tab type and its body under the type's id; while the canvas declares it, the entry
 * of its picker slot; while `dvMedia` is present, the media types; and while the `dv.media` Factory declares it, each
 * media view.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register(assetPoolDefinition), 'ui-asset-pool: tab type')
  // The media plugin is optional; without it an asset opens no preview.
  const preview: AssetsTabInjected['preview'] = (asset, opener) => { ctx.get('dvMedia')?.preview(asset, opener) }
  const injected: AssetsTabInjected = { client: new DvClient(), preview }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ASSET_POOL_ID, inject: () => injected },
    AssetsTabBody,
  )), 'ui-asset-pool: tab body')
  ctx.effect(() => ctx.slots.inject('dv.canvas.picker', () => ctx.slots.register(
    { name: 'dv.canvas.picker', key: 'assets', inject: () => ({ preview }) }, AssetsPanel,
  )), 'ui-asset-pool: canvas picker')
  ctx.inject(['dvMedia'], (scope) => {
    for (const type of MEDIA_TYPES) scope.effect(() => scope.dvMedia.types.register(type), `ui-asset-pool: media type ${type.id}`)
  })
  for (const [key, view] of Object.entries(VIEWS)) {
    ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key }, view)), `ui-asset-pool: ${key} view`)
  }
}
