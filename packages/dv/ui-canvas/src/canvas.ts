/**
 * The rules of the canvas tool: the tool name and the parsers of the values that cross the wire, which both halves of
 * the plugin use.
 *
 * @module @dv/ui-canvas/canvas
 */
import type { CanvasCard, CanvasQuery } from './types.ts'

/** The tool that reads the open canvas. */
export const CANVAS_READ = 'dv_canvas_read'

/** The streaming Fetch route that an open canvas holds open to receive reads. */
export const CANVAS_AGENT_ROUTE = '/api/dv/canvas/agent'

/** The Fetch route of an open canvas's answer to a read. */
export const CANVAS_ANSWER_ROUTE = '/api/dv/canvas/agent/answer'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isCard = (value: unknown): value is CanvasCard => isObject(value)
  && ['id', 'type', 'title', 'shown'].every(key => typeof value[key] === 'string')
  && ['versions', 'x', 'y', 'width', 'height'].every(key => isNumber(value[key])) && typeof value['rendering'] === 'boolean'

/**
 * @param input - the data of a `read` frame, or the body of an answer to it.
 * @returns the read and its stream, or null when the input is not a {@link CanvasQuery}.
 */
export function parseQuery(input: unknown): CanvasQuery | null {
  return isObject(input) && typeof input['id'] === 'string' && typeof input['stream'] === 'string'
    ? { id: input['id'], stream: input['stream'] }
    : null
}

/**
 * @param value - the body of an answer to a read, as a canvas sent it.
 * @param project - the project that the read named.
 * @returns the cards, or null when the value is not a `CanvasDrawn` of `project`.
 */
export function parseDrawn(value: unknown, project: string): CanvasCard[] | null {
  if (!isObject(value) || value['project'] !== project) return null
  const cards = value['cards']
  return Array.isArray(cards) && cards.every(isCard) ? cards : null
}
