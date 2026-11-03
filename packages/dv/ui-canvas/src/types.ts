/**
 * The values between the two halves of the canvas plugin. The host half's `dv_canvas_read` and `dv_canvas_move` write a
 * {@link CanvasQuery} `read` frame on the stream of each open canvas of the project beside the calling chat, and the
 * first canvas that answers sends a {@link CanvasDrawn}; after the host half stores a move, a `moved` frame carries a
 * {@link CanvasMoved} to every open canvas of the project.
 *
 * @module @dv/ui-canvas/types
 */
import type { NodePosition } from './canvas-layout.ts'

/** One card as the agent reads it: its node and its box in canvas units, with y growing downward. */
export type CanvasCard = {
  id: string
  type: string
  title: string
  record: string | null
  x: number
  y: number
  width: number
  /** The drawn height; while `rendering`, the height that the finished card takes. */
  height: number
  rendering: boolean
}

/** One requested move: a node and the new top-left corner of its card. */
export type NodeMove = { node: string; x: number; y: number }

/** A `read` frame to the canvas stream `stream`: the canvas answers with the same `id` and `stream`. */
export type CanvasQuery = { id: string; stream: string }

/** A canvas's answer to a {@link CanvasQuery}: the cards it draws. Answering changes nothing. */
export type CanvasDrawn = CanvasQuery & { project: string; cards: CanvasCard[] }

/** The `moved` frame of a stored move: every open canvas of `project` draws `positions`. */
export type CanvasMoved = { project: string; positions: Record<string, NodePosition> }
