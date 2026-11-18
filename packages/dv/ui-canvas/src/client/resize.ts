/**
 * The box of a canvas node after a drag of one of its resize handles, at a corner or along an edge, computed from the
 * node type's sizing.
 *
 * @module @dv/ui-canvas/client/resize
 */
import type { NodePosition } from '../canvas-layout.ts'
import type { NodeSizing, Size } from './contract/index.ts'

/** A resize handle of the selected node: a corner (north or south, west or east) or one edge. */
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

/**
 * The frame size of a media node that the pointer asks for: the width that the axis with the larger movement asks
 * for, at least the narrowest width that keeps both sides of `minSize`, with height = width / ratio + fixedHeight.
 * @param sizing - the media node's sizing.
 * @param width - the width that the horizontal movement asks for.
 * @param height - the height that the vertical movement asks for.
 * @param horizontal - whether the horizontal movement is the larger one, measured in width.
 * @returns the frame size.
 */
function mediaSize(sizing: Extract<NodeSizing, { kind: 'media' }>, width: number, height: number, horizontal: boolean): Size {
  const { minSize, aspectRatio: { ratio, fixedHeight } } = sizing
  const narrowest = Math.max(minSize.width, (minSize.height - fixedHeight) * ratio)
  const wanted = Math.max(narrowest, horizontal ? width : (height - fixedHeight) * ratio)
  return { width: wanted, height: wanted / ratio + fixedHeight }
}

/**
 * The box of a node after a handle drag. A corner changes the width and the height, an east or west edge the width
 * only, and a north or south edge the height only. A window node takes the size that the pointer asks for, each side at
 * least its side of `minSize`; a media node keeps height = width / ratio + fixedHeight, following the edge's axis or,
 * at a corner, the axis with the larger movement. A west handle moves the left edge and a north handle the top edge, so
 * the opposite side stays in place.
 * @param sizing - the node type's sizing of the node.
 * @param origin - the node's box when the drag started.
 * @param handle - the dragged handle.
 * @param dx - the pointer's horizontal movement in canvas units.
 * @param dy - the pointer's vertical movement in canvas units.
 * @returns the box.
 */
export function resizedBox(sizing: NodeSizing, origin: NodePosition, handle: ResizeHandle, dx: number, dy: number): NodePosition {
  const west = handle.endsWith('w')
  const north = handle.startsWith('n')
  const across = west || handle.endsWith('e')
  const along = north || handle.startsWith('s')
  const width = across ? origin.width + (west ? -dx : dx) : origin.width
  const height = along ? origin.height + (north ? -dy : dy) : origin.height
  const horizontal = across && (!along || Math.abs(dx) >= Math.abs(dy) * (sizing.kind === 'media' ? sizing.aspectRatio.ratio : 1))
  const size = sizing.kind === 'window'
    ? { width: Math.max(sizing.minSize.width, width), height: Math.max(sizing.minSize.height, height) }
    : mediaSize(sizing, width, height, horizontal)
  return {
    x: west ? origin.x + origin.width - size.width : origin.x,
    y: north ? origin.y + origin.height - size.height : origin.y,
    ...size,
  }
}
