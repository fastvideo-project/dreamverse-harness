/**
 * Types of the Blender component's `blender` state slice, which the browser half reads to draw the viewport node.
 * Types only.
 *
 * @module @fastvideo/dreamverse-blender-bridge/types
 */
import type { RecordId } from '@dv/project/types'

/** The `blender` slice. */
export interface BlenderSlice {
  /** The `blender.viewport` record that put the viewport on the canvas; null while it is not on the canvas. */
  viewport: RecordId | null
}

declare module '@dv/project/types' {
  interface ComponentStates {
    /** Whether the Blender viewport is on the canvas (the Blender component's reducer). */
    blender: BlenderSlice
  }
}
