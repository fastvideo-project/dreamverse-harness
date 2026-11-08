/**
 * The box of a canvas node after a drag of one of its corner handles, computed from the node type's sizing.
 *
 * @module @dv/ui-canvas/client/resize
 */
import type { NodePosition } from '../canvas-layout.ts'
import type { NodeSizing, Size } from './contract/index.ts'

/** A corner handle of the selected node: north or south, west or east. */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

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
 * The box of a node after a corner drag. A window node takes the width and the height that the pointer asks for, each
 * at least its side of `minSize`; a media node keeps height = width / ratio + fixedHeight. A west corner moves the left
 * edge and a north corner the top edge, so the opposite corner stays in place.
 * @param sizing - the node type's sizing of the node.
 * @param origin - the node's box when the drag started.
 * @param corner - the dragged corner.
 * @param dx - the pointer's horizontal movement in canvas units.
 * @param dy - the pointer's vertical movement in canvas units.
 * @returns the box.
 */
export function resizedBox(sizing: NodeSizing, origin: NodePosition, corner: ResizeCorner, dx: number, dy: number): NodePosition {
  const west = corner.endsWith('w')
  const north = corner.startsWith('n')
  const width = origin.width + (west ? -dx : dx)
  const height = origin.height + (north ? -dy : dy)
  const size = sizing.kind === 'window'
    ? { width: Math.max(sizing.minSize.width, width), height: Math.max(sizing.minSize.height, height) }
    : mediaSize(sizing, width, height, Math.abs(dx) >= Math.abs(dy) * sizing.aspectRatio.ratio)
  return {
    x: west ? origin.x + origin.width - size.width : origin.x,
    y: north ? origin.y + origin.height - size.height : origin.y,
    ...size,
  }
}
