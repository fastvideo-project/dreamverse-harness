/**
 * Browser half of the location component: one `defineReferenceUi` declaration gives the location noun its canvas node
 * type, version kind, references in use, `dv.canvas.card` and `dv.canvas.editor` entries, `@` menu kind and History row.
 *
 * @module @dv/ui-location/client
 */
import type { LocationState } from '@dv/location/types'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { location: LocationState } }

/** The location noun on the canvas, in the asset picker, in the `@` menu and in the History panel. */
export const { inject, apply } = defineReferenceUi({
  id: '@dv/ui-location', key: 'location', slice: state => state.components.location,
  label: ['场景', 'Location'], mention: { section: ['场景', 'Locations'], order: 2 },
})
