/**
 * The box that a surface gives a playable asset, so that the media view of `@dv/ui-media`, which fills its box, shows
 * the whole media inside it.
 *
 * @module @dv/ui-kit/player-box
 */
import type { CSSProperties } from 'react'
import type { Asset } from './types.ts'

/**
 * The box of a playable asset across a surface: the surface's full width at the asset's aspect ratio and at most
 * `maxHeight` tall; `maxHeight` tall for an asset of unknown dimensions.
 * @param asset - the asset's pixel size.
 * @param maxHeight - the tallest the box may be, in pixels.
 * @returns the box styles.
 */
export function playerBox(asset: Pick<Asset, 'width' | 'height'>, maxHeight: number): CSSProperties {
  const { width, height } = asset
  if (width === null || height === null) return { width: '100%', height: maxHeight }
  return { width: '100%', aspectRatio: `${String(width)} / ${String(height)}`, maxHeight }
}
