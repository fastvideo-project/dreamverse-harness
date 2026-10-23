/**
 * The DreamVerse cards that replace asset links, asset images, and asset tables in settled chat Markdown. Each card
 * draws its asset through the `dv.media` Factory at purpose 'thumb'; a click opens the asset preview of `dvMedia`,
 * which grows out of the card. The card of a standalone link is captioned with History's label of the record that
 * created the asset, because chat link texts such as 点此播放 do not name the asset.
 *
 * @module @dv/ui-composer/ChatMedia
 */
import type { CSSProperties, ReactNode } from 'react'
import type { RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import { useText } from '@dv/ui-kit/locale.ts'
import type { Asset, ProjectAsset } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'
import type { ChatMedia } from './chat-media.ts'

const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, margin: '8px 0',
}
/** A single card stays inline so it can sit in a sentence or a table cell. */
const card: CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', gap: 4, width: 160, maxWidth: '100%', verticalAlign: 'top',
}
const gridCard: CSSProperties = { ...card, display: 'flex', width: 'auto' }
const frame: CSSProperties = {
  position: 'relative', display: 'block', aspectRatio: '16 / 9', overflow: 'hidden', padding: 0, border: 0, cursor: 'pointer',
  borderRadius: 'var(--dv-radius-sm)', background: 'var(--dv-media-bg)', boxShadow: '0 0 0 1px var(--dv-line)',
}
const caption: CSSProperties = {
  color: 'var(--dv-text-2)', fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const imageButton: CSSProperties = {
  display: 'inline-block', maxWidth: 'min(240px, 100%)', padding: 0, border: 0, overflow: 'hidden', cursor: 'zoom-in',
  verticalAlign: 'top', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-media-bg)', boxShadow: '0 0 0 1px var(--dv-line)',
}

interface CardProps {
  /** Open the asset preview of an asset of a project, growing out of `opener`. */
  preview: (projectId: string, asset: Asset, opener: Element | null) => void
  renderFactorySlot: RenderFactorySlot
}

type OneCardProps = CardProps & { project: string }

/**
 * One 16:9 card: the asset's still and the caption under it; a click opens the asset preview.
 */
function AssetCard(props: OneCardProps & { asset: ProjectAsset; label: string; inGrid: boolean }): ReactNode {
  const { project, asset, label, inGrid, preview, renderFactorySlot } = props
  const t = useText()
  const open = t('查看', 'View')
  return (
    <span style={inGrid ? gridCard : card} data-dv-chat-card={asset.id}>
      <button type="button" style={frame} aria-label={label === '' ? open : `${open}: ${label}`}
        onClick={(event) => { preview(project, asset, event.currentTarget) }}>
        {renderFactorySlot('dv.media', { asset, purpose: 'thumb', playBadge: true })}
      </button>
      {label !== '' && <span style={caption} title={label}>{label}</span>}
    </span>
  )
}

/**
 * One thumbnail, at most 240 px wide, that opens the asset preview on click.
 */
function AssetThumb({ project, asset, alt, preview, renderFactorySlot }: OneCardProps & { asset: ProjectAsset; alt: string }): ReactNode {
  const t = useText()
  const view = t('查看大图', 'View large image')
  const { width, height } = asset
  const box: CSSProperties = width !== null && height !== null && height > 0
    ? { width, aspectRatio: `${String(width)} / ${String(height)}` }
    : { width: 240, aspectRatio: '16 / 9' }
  return (
    <button type="button" style={{ ...imageButton, ...box }} aria-label={alt === '' ? view : `${view}: ${alt}`}
      data-dv-chat-card={asset.id} onClick={(event) => { preview(project, asset, event.currentTarget) }}>
      {renderFactorySlot('dv.media', { asset, purpose: 'thumb' })}
    </button>
  )
}

/**
 * Draw what the chain entry resolved from an element's asset references and the open project's assets.
 * @param props - the resolved `media`, the preview, and the Factory renderer.
 * @returns the card, the thumbnail, or the grid.
 */
export function ChatMediaView({ media, preview, renderFactorySlot }: CardProps & { media: ChatMedia }): ReactNode {
  const t = useText()
  switch (media.kind) {
    case 'link':
      return (
        <AssetCard project={media.project} asset={media.asset} label={t(media.caption[0], media.caption[1])} inGrid={false}
          preview={preview} renderFactorySlot={renderFactorySlot} />
      )
    case 'image':
      return (
        <AssetThumb project={media.project} asset={media.asset} alt={media.alt} preview={preview} renderFactorySlot={renderFactorySlot} />
      )
    case 'table':
      return (
        <div style={grid}>
          {media.cards.map((shown, index) => (
            <AssetCard key={index} project={media.project} asset={shown.asset} label={shown.caption} inGrid
              preview={preview} renderFactorySlot={renderFactorySlot} />
          ))}
        </div>
      )
  }
}
