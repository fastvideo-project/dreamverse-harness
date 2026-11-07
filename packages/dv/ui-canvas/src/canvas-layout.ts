/**
 * The canvas layout as both halves of the canvas plugin see it: the host store writes it, the browser client reads
 * and writes it through {@link CANVAS_LAYOUT_ROUTE}.
 *
 * @module @dv/ui-canvas/canvas-layout
 */

/** The Fetch route path of the canvas layout. */
export const CANVAS_LAYOUT_ROUTE = '/api/dv/canvas/layout'

/**
 * Where a canvas node sits and how large its frame is, in canvas units: `x` and `y` are the top-left corner of the
 * node, which is the top of its caption; `width` and `height` are the frame box below the caption. A type alias, so
 * that a positions map is a `JsonValue` of an event.
 */
export type NodePosition = { x: number; y: number; width: number; height: number }

/** The height of the caption above a node's frame at base text size, in canvas units. */
export const CAPTION_HEIGHT = 20

/** The top-left corner of a node, in canvas units, as a move sets it. */
export type NodeSpot = Pick<NodePosition, 'x' | 'y'>

/**
 * A node's entry in the layout file and in a layout write. A move stores `x` and `y` alone, and a layout file written
 * before nodes had a stored size holds no `width` or `height`; the canvas then gives the node its default size.
 */
export type LayoutEntry = NodeSpot & Partial<Pick<NodePosition, 'width' | 'height'>>

/** The canvas pan offset, in screen pixels, and zoom. */
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/** A project's stored canvas layout: node positions keyed by canvas node ID, and the viewport. */
export interface CanvasLayout {
  positions: Record<string, LayoutEntry>
  viewport: CanvasViewport | null
}

/** A change of one project's layout: the entries to merge field by field and, when given, the viewport. */
export interface CanvasLayoutPatch {
  positions?: Record<string, LayoutEntry>
  viewport?: CanvasViewport | null
}
