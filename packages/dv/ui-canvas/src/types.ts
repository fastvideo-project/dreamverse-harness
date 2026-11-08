/**
 * The values between the two halves of the canvas plugin. The host half's `dv_canvas_read` writes a {@link CanvasQuery}
 * `read` frame on the stream of each open canvas of the project beside the calling chat, and the first canvas that
 * answers sends a {@link CanvasDrawn}.
 *
 * @module @dv/ui-canvas/types
 */

/**
 * One card as the agent reads it: its node and its box in canvas units, with y growing downward. `x` and `y` are the
 * top-left corner of the node, the top of its caption; `width` and `height` are its frame, below the caption. `shown`
 * is the record of the version on show, and `versions` counts the node's versions.
 */
export type CanvasCard = {
  id: string
  type: string
  title: string
  shown: string
  versions: number
  x: number
  y: number
  width: number
  height: number
  rendering: boolean
}

/** A `read` frame to the canvas stream `stream`: the canvas answers with the same `id` and `stream`. */
export type CanvasQuery = { id: string; stream: string }

/** A canvas's answer to a {@link CanvasQuery}: the cards it draws. Answering changes nothing. */
export type CanvasDrawn = CanvasQuery & { project: string; cards: CanvasCard[] }
