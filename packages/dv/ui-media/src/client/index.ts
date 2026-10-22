/**
 * Browser half: provide `dvMedia`, whose `types` registry the media plugins fill and whose `preview` opens the asset
 * preview; register the `dv.media` Component Factory, which draws one asset by its `dv.media.view` entry or the file
 * card; and register the preview in DSH's root `shell.overlay` list, which declares `dv.media.preview.action`. The
 * package names no media type.
 *
 * @module @dv/ui-media/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import type { DvMedia, MediaType } from './contract/index.ts'
import { MediaPreview } from './MediaPreview.tsx'
import type { PreviewInjected, PreviewRequest } from './MediaPreview.tsx'
import { MediaView } from './MediaView.tsx'

export type { DvMedia, MediaAsset, MediaOwner, MediaPurpose, MediaType, MediaViewOwner, PreviewActionOwner } from './contract/index.ts'

/** Required browser service: the DSH UI slot registry. */
export const inject = ['slots']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The open request is shared by every `preview` caller and the one overlay entry; the opener element stays here,
  // outside the observable, because it is not JSON data.
  let request: PreviewRequest | null = null
  let opener: Element | null = null
  let serial = 0
  const listeners = new Set<() => void>()
  const source = {
    getSnapshot: (): PreviewRequest | null => request,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const publish = (next: PreviewRequest | null): void => {
    request = next
    for (const listener of [...listeners]) listener()
  }
  const media: DvMedia = {
    // At apply's top level, never inside an effect: other plugins register into the registry from their own fibers.
    types: createRegistry<MediaType>(type => [type.id]),
    preview(asset: Asset, element: Element | null) {
      opener = element
      serial += 1
      publish({ asset, serial })
    },
  }
  ctx.reflect.provide('dvMedia', media)
  const injected: PreviewInjected = {
    hooks: { preview: source },
    openerOf: () => opener,
    close: () => { publish(null) },
  }
  ctx.effect(() => ctx.slots.registerFactory(
    { name: 'dv.media', scope: 'root', children: { 'dv.media.view': { kind: 'keyed', scope: 'root' } } },
    MediaView,
  ), 'ui-media: dv.media')
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay', id: 'dv.media.preview', inject: () => injected,
      children: { 'dv.media.preview.action': { kind: 'list', scope: 'root' } },
    },
    MediaPreview,
  )), 'ui-media: preview')
}
