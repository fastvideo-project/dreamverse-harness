/**
 * Readings of the project state that every view needs: asset lookups.
 *
 * @module @dv/ui-kit/state
 */
import type { Asset, WireState } from './types.ts'

/**
 * @param state - the project state.
 * @returns assets by ID.
 */
export function assetIndex(state: WireState): Map<string, Asset> {
  return new Map(state.assets.map(asset => [asset.id, asset]))
}
