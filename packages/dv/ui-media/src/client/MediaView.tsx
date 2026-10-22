/**
 * The `dv.media` Factory definition: one asset drawn by the `dv.media.view` entry keyed by its media type
 * (`mediaTypeOf` of `@dv/ui-kit/media-type.ts`), else by the file card, which shows the asset's name and MIME type. A
 * view that reports that it cannot draw the asset is replaced by the file card. The surface that renders an occurrence
 * owns the box; the view fills it.
 */
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import type { MediaOwner } from './contract/index.ts'
import css from './media.module.css'

/**
 * The file card of an asset whose media type has no view.
 * @param props - the asset and the purpose; a thumbnail, and an asset whose name the surface does not know, show the
 *   media type only.
 * @returns the card.
 */
export function FileCard({ asset, purpose }: MediaOwner): ReactNode {
  return (
    <span className={purpose === 'thumb' ? `${css.file} ${css.fileThumb}` : css.file} data-dv-media="file" title={asset.name ?? asset.mime}>
      {purpose === 'thumb' || asset.name === undefined ? null : <span className={css.fileName}>{asset.name}</span>}
      <span className={css.fileType}>{asset.mime}</span>
    </span>
  )
}

/**
 * One asset by its media type.
 * @param props - the asset, the purpose, the poster, the play badge, the size callback, and the renderer of the
 *   `dv.media.view` entries.
 * @returns the view of the asset's media type, or the file card when no view is registered or the view cannot draw it.
 */
export function MediaView({ asset, purpose, poster, playBadge, onSize, renderSlot }: FactoryComponentPropsOf<'dv.media'>): ReactNode {
  const [unsupportedId, setUnsupportedId] = useState<string | null>(null)
  const unsupported = useCallback(() => { setUnsupportedId(asset.id) }, [asset.id])
  const card = <FileCard asset={asset} purpose={purpose} />
  if (unsupportedId === asset.id) return card
  const owner = {
    asset, purpose, unsupported, ...poster === undefined ? {} : { poster }, ...playBadge === undefined ? {} : { playBadge },
    ...onSize === undefined ? {} : { onSize },
  }
  return renderSlot('dv.media.view', owner, { entryKey: mediaTypeOf(asset.mime), fallback: card })
}
