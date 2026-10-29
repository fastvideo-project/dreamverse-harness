/**
 * The project state that the e2e stories read from `GET /api/dv/state`: the wire state of `@dv/ui-kit/types.ts`, with
 * the slices of character, location, style, timeline and asset-pool typed by the client faces of those host
 * packages.
 *
 * @module @dv/e2e/wire-state
 */
import type { AssetState } from '@dv/asset-pool/types'
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
    asset: AssetState
  }
}
