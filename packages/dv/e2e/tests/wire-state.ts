/**
 * The project state that the e2e stories read from `GET /api/dv/state`: the wire state of `@dv/ui-kit/types.ts`, with
 * the slices of character, location, style and timeline typed by the client faces of those host packages; the
 * `canvas` slice is typed by the wire copy of `@dv/ui-kit`.
 *
 * @module @dv/e2e/wire-state
 */
import type { CharacterState } from '@dv/character/types'
import type { LocationState } from '@dv/location/types'
import type { StyleState } from '@dv/style/types'
import type { TimelineState } from '@dv/timeline/types'
import type { ComponentStates, WireState as KitWireState } from '@dv/ui-kit/types.ts'

export type { ProjectRecord } from '@dv/ui-kit/types.ts'

/** The project state with typed plugin slices. */
export interface WireState extends Omit<KitWireState, 'components'> {
  components: ComponentStates & {
    character: CharacterState
    location: LocationState
    style: StyleState
    timeline: TimelineState
  }
}

/**
 * The assets that the `asset` nodes of the canvas show, in node order.
 * @param state - a project state.
 * @returns the asset IDs.
 */
export function placedAssets(state: WireState): string[] {
  const { nodes, order, assets } = state.components.canvas
  const shown = Object.entries(assets)
  return order.flatMap(node => nodes[node]?.kind === 'asset' ? shown.flatMap(([asset, by]) => by === node ? [asset] : []) : [])
}
