/**
 * The canvas layout as both halves of the canvas plugin see it: the host store writes it, the browser client reads
 * and writes it through {@link CANVAS_LAYOUT_ROUTE}.
 *
 * @module @dv/ui-canvas/canvas-layout
 */

/** The Fetch route path of the canvas layout. */
export const CANVAS_LAYOUT_ROUTE = '/api/dv/canvas/layout'

/** Where a canvas node sits, in canvas units. */
export interface NodePosition {
  x: number
  y: number
}

/** The canvas pan offset, in screen pixels, and zoom. */
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/** A project's stored canvas layout: node positions keyed by canvas node ID, and the viewport. */
export interface CanvasLayout {
  positions: Record<string, NodePosition>
  viewport: CanvasViewport | null
}

/** A change of one project's layout: the positions to set and, when given, the viewport. */
export interface CanvasLayoutPatch {
  positions?: Record<string, NodePosition>
  viewport?: CanvasViewport | null
}
