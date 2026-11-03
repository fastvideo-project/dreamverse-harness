/**
 * The frame of a canvas node: the rounded outline under the node's caption, 208 canvas units wide, inside which the
 * node's `dv.canvas.card` body draws. A body that shows a picture of known size sizes the frame with
 * {@link frameHeight} at the frame's width and paints nothing else; any other body paints {@link CARD_SURFACE}.
 *
 * @module @dv/ui-kit/frame
 */
import type { CSSProperties } from 'react'
import type { Asset } from './types.ts'

/** The height of the 16:9 frame at the 208-unit width of a canvas node, in canvas units. */
export const NODE_FRAME_HEIGHT = 117

/** The width of a canvas node's frame, in canvas units. */
const FRAME_WIDTH = 208
/** The narrowest and the widest frame aspect ratio (width ÷ height); a picture outside this range is cover-fitted. */
const FRAME_ASPECT = { min: 3 / 4, max: 16 / 9 }

/**
 * The frame height of a picture: the frame width at the picture's aspect ratio, clamped between 3:4 and 16:9.
 * @param size - the picture's pixel size; undefined when the state holds no such asset.
 * @param fallback - the height for a picture of unknown width or height.
 * @param width - the frame width in canvas units; the 208-unit node width when omitted.
 * @returns the height in canvas units.
 */
export function frameHeight(size: Pick<Asset, 'width' | 'height'> | undefined, fallback: number, width = FRAME_WIDTH): number {
  if (size === undefined || size.width === null || size.height === null) return fallback
  const aspect = Math.min(FRAME_ASPECT.max, Math.max(FRAME_ASPECT.min, size.width / size.height))
  return Math.round(width / aspect)
}

/** The fill of a card-like body: the card surface and text color, filling the frame's height. */
export const CARD_SURFACE: CSSProperties = { boxSizing: 'border-box', height: '100%', background: 'var(--dv-surface-2)', color: 'var(--dv-text)' }
