/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ReferenceIconRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceThumbnail } from '../../contract/draft-editor.ts'
import css from './ReferenceChip.module.css'
import referenceCss from './composer-editor.module.css'

/** Pointer dwell on a chip before its enlarged media shows. */
const PREVIEW_DELAY_MS = 300
/** Space between the chip and its preview, in pixels. */
const PREVIEW_GAP = 8

/** Display inputs of one chip (the node's cached owner projections). */
export interface ReferenceChipProps {
  readonly label: string
  /** Domain glyph; absent renders the trigger marker instead of an icon. */
  readonly appearance?: ReferenceIconKind | undefined
  /** Media of the referenced item, shown in place of the glyph while it loads. */
  readonly thumbnail?: ReferenceThumbnail | undefined
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
}

/**
 * One image or video element of a chip thumbnail or its hover preview. A thumbnail video shows its first frame; a
 * preview video plays muted in a loop.
 * @param props - the media, its class, whether a video plays, and the load-failure callback.
 * @returns the media element.
 */
function ChipMedia({ thumbnail, className, play = false, onError }: {
  thumbnail: ReferenceThumbnail
  className: string | undefined
  play?: boolean
  onError?: () => void
}): ReactNode {
  return thumbnail.video
    ? (
      <video
        src={thumbnail.url} className={className} muted autoPlay={play} loop={play} playsInline
        preload={play ? 'auto' : 'metadata'} onError={onError}
      />
    )
    : <img src={thumbnail.url} className={className} alt="" draggable={false} onError={onError} />
}

/**
 * The enlarged media of a chip while the pointer rests on it, above the chip in a body portal. The preview closes when
 * a pointer move lands outside the chip, when anything scrolls, and when the chip unmounts, so a chip that leaves the
 * page under a resting pointer (a sent draft) takes its preview with it.
 * @param props - the chip element, the media, and the label.
 * @returns the preview, or null while closed.
 */
function ChipPreview({ anchor, thumbnail, label }: {
  anchor: HTMLElement | null
  thumbnail: ReferenceThumbnail
  label: string
}): ReactNode {
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  useEffect(() => {
    if (anchor === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const close = (): void => {
      clearTimeout(timer)
      setAt(null)
    }
    const enter = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const rect = anchor.getBoundingClientRect()
        setAt({ left: rect.left, bottom: window.innerHeight - rect.top + PREVIEW_GAP })
      }, PREVIEW_DELAY_MS)
    }
    const move = (event: PointerEvent): void => {
      if (!anchor.isConnected || !(event.target instanceof Node) || !anchor.contains(event.target)) close()
    }
    anchor.addEventListener('pointerenter', enter)
    anchor.addEventListener('pointerleave', close)
    document.addEventListener('pointermove', move, true)
    window.addEventListener('scroll', close, true)
    return () => {
      clearTimeout(timer)
      anchor.removeEventListener('pointerenter', enter)
      anchor.removeEventListener('pointerleave', close)
      document.removeEventListener('pointermove', move, true)
      window.removeEventListener('scroll', close, true)
    }
  }, [anchor])
  if (at === null) return null
  return createPortal(
    <span className={css.previewCard} style={{ left: at.left, bottom: at.bottom }} role="tooltip">
      <ChipMedia thumbnail={thumbnail} className={css.preview} play />
      <span className={css.previewName}>{label}</span>
    </span>,
    document.body,
  )
}

/**
 * Render one inline reference chip. A chip with a thumbnail shows the media at its start and an enlarged preview while
 * the pointer rests on it; media that fails to load (such as a revoked object URL) falls back to the glyph.
 * @param props - label, optional domain glyph, optional thumbnail, and the invalid bit.
 * @returns the chip body (thumbnail or icon + truncating label).
 */
export function ReferenceChip({ label, appearance, thumbnail, invalid }: ReferenceChipProps): ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const media = thumbnail !== undefined && failedUrl !== thumbnail.url ? thumbnail : undefined
  return (
    <span
      ref={setAnchor}
      className={clsx(referenceCss.reference, css.chip, appearance === 'file' && !invalid && referenceCss.openable, invalid && css.invalid)}
      title={media === undefined ? label : undefined}
    >
      {media !== undefined
        ? <ChipMedia thumbnail={media} className={css.thumbnail} onError={() => { setFailedUrl(media.url) }} />
        : appearance === undefined
          ? <span className={css.marker} aria-hidden>@</span>
          : <ReferenceIconRegular kind={appearance} size={14} className={css.icon} />}
      <span className={css.label}>{label}</span>
      {media !== undefined && <ChipPreview anchor={anchor} thumbnail={media} label={label} />}
    </span>
  )
}
