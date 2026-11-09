/**
 * The canvas layout as both halves of the canvas plugin see it: the host store writes it, the browser client reads
 * and writes it through {@link CANVAS_LAYOUT_ROUTE}.
 *
 * @module @dv/ui-canvas/canvas-layout
 */

/** The Fetch route path of the canvas layout. */
export const CANVAS_LAYOUT_ROUTE = '/api/dv/canvas/layout'

/**
 * Where a canvas node is drawn and how large its frame is, in canvas units: `x` and `y` are the top-left corner of the
 * node, which is the top of its caption; `width` and `height` are the frame box below the caption.
 */
export type NodePosition = { x: number; y: number; width: number; height: number }

/** The height of the caption above a node's frame at base text size, in canvas units. */
export const CAPTION_HEIGHT = 20

/** The top-left corner of a node, in canvas units, as a move sets it. */
export type NodeSpot = Pick<NodePosition, 'x' | 'y'>

/** The canvas pan offset, in screen pixels, and zoom. */
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/** A project's stored canvas layout: the viewport, or null before the first pan or zoom. */
export interface CanvasLayout {
  viewport: CanvasViewport | null
}
