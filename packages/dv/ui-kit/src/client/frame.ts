/**
 * The frame of a canvas node: the rounded outline under the node's caption, 208 canvas units wide by default, inside
 * which the node's `dv.canvas.card` body draws. A media node declares its frame with {@link mediaSizing}; a body that
 * shows a picture of known size paints nothing else, and any other body paints {@link CARD_SURFACE}.
 *
 * @module @dv/ui-kit/frame
 */
import type { CSSProperties } from 'react'
import type { Asset } from './types.ts'

/** The default width of a canvas node's frame, in canvas units. */
const FRAME_WIDTH = 208
/** The narrowest and the widest frame aspect ratio (width ÷ height); a picture outside this range is cover-fitted. */
const FRAME_ASPECT = { min: 3 / 4, max: 16 / 9 }

/**
 * The aspect ratio (width ÷ height) of a picture's frame: the picture's own, clamped between 3:4 and 16:9.
 * @param size - the picture's pixel size; undefined when the state holds no such asset.
 * @returns the ratio; undefined for a picture of unknown width or height.
 */
function clampedRatio(size: Pick<Asset, 'width' | 'height'> | undefined): number | undefined {
  if (size === undefined || size.width === null || size.height === null) return undefined
  return Math.min(FRAME_ASPECT.max, Math.max(FRAME_ASPECT.min, size.width / size.height))
}

/** The 16:9 aspect ratio (width ÷ height): the frame of a picture of unknown size. */
export const WIDE_RATIO = 16 / 9

/** The narrowest frame of a media node, in canvas units: half the default width. */
const MIN_FRAME_WIDTH = FRAME_WIDTH / 2

/** The `NodeSizing` of `@dv/ui-canvas/contract` for a media node, in canvas units. */
export type MediaSizing = {
  kind: 'media'
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  aspectRatio: { ratio: number; fixedHeight: number }
}

/**
 * The sizing of a media node whose picture fills its frame above or below fixed bars: the picture's aspect ratio
 * clamped between 3:4 and 16:9, else `fallbackRatio`; a default frame 208 units wide and a narrowest frame 104 units
 * wide, each at height = width / ratio + `fixedHeight`.
 * @param size - the picture's pixel size; undefined when the state holds no such asset.
 * @param fallbackRatio - the aspect ratio (width ÷ height) of a picture of unknown width or height.
 * @param fixedHeight - the height of the fixed bars outside the picture, in canvas units; 0 for none.
 * @returns the sizing.
 */
export function mediaSizing(size: Pick<Asset, 'width' | 'height'> | undefined, fallbackRatio: number, fixedHeight: number): MediaSizing {
  const ratio = clampedRatio(size) ?? fallbackRatio
  const at = (width: number): { width: number; height: number } => ({ width, height: Math.round(width / ratio) + fixedHeight })
  return { kind: 'media', defaultSize: at(FRAME_WIDTH), minSize: at(MIN_FRAME_WIDTH), aspectRatio: { ratio, fixedHeight } }
}

/** The fill of a card-like body: the card surface and text color, filling the frame's height. */
export const CARD_SURFACE: CSSProperties = { boxSizing: 'border-box', height: '100%', background: 'var(--dv-surface-2)', color: 'var(--dv-text)' }
