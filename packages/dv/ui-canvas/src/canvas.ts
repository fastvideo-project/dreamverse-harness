/**
 * The rules of the canvas tools: the tool names and the parsers of the values that cross the wire, which both halves of
 * the plugin use, and the check of a batch of moves against the cards, which the host half runs.
 *
 * @module @dv/ui-canvas/canvas
 */
import type { NodePosition } from './canvas-layout.ts'
import type { CanvasCard, CanvasMoved, CanvasQuery, NodeMove } from './types.ts'

/** The tool that reads the open canvas. */
export const CANVAS_READ = 'dv_canvas_read'

/** The tool that moves canvas nodes. */
export const CANVAS_MOVE = 'dv_canvas_move'

/** The streaming Fetch route that an open canvas holds open to receive reads and stored moves. */
export const CANVAS_AGENT_ROUTE = '/api/dv/canvas/agent'

/** The Fetch route of an open canvas's answer to a read. */
export const CANVAS_ANSWER_ROUTE = '/api/dv/canvas/agent/answer'

/** A move's outcome: the positions to store, or the refusal. */
export type MovePlan =
  | { kind: 'move'; positions: Record<string, NodePosition> }
  | { kind: 'duplicate_nodes'; ids: string[] }
  | { kind: 'unknown_nodes'; ids: string[]; known: string[] }
  | { kind: 'too_close'; pairs: Array<[CanvasCard, CanvasCard]> }

/** The least space that a moved card keeps from every other card, in canvas units. */
const CARD_GAP = 24

/**
 * Check a batch of moves against the drawn cards. A move is refused, in this order, when a node is listed twice, when a
 * node is not drawn, or when a moved card would come closer than {@link CARD_GAP} to another card; cards that the batch
 * does not move may stay closer.
 * @param cards - the cards as drawn now.
 * @param moves - the requested moves.
 * @returns the plan.
 */
export function planMove(cards: readonly CanvasCard[], moves: readonly NodeMove[]): MovePlan {
  const duplicates = [...new Set(moves.map(move => move.node).filter((id, index, ids) => ids.indexOf(id) !== index))]
  if (duplicates.length > 0) return { kind: 'duplicate_nodes', ids: duplicates }
  const known = new Map(cards.map(card => [card.id, card]))
  const unknown = moves.flatMap(move => known.has(move.node) ? [] : [move.node])
  if (unknown.length > 0) return { kind: 'unknown_nodes', ids: unknown, known: [...known.keys()] }
  const positions = Object.fromEntries(moves.map(move => [move.node, { x: move.x, y: move.y }]))
  const after = cardsAfter(cards, positions)
  const pairs = after.flatMap((card, index) => after.slice(index + 1)
    .filter(other => (card.id in positions || other.id in positions) && card.x < other.x + other.width + CARD_GAP
      && other.x < card.x + card.width + CARD_GAP && card.y < other.y + other.height + CARD_GAP
      && other.y < card.y + card.height + CARD_GAP)
    .map((other): [CanvasCard, CanvasCard] => [card, other]))
  return pairs.length > 0 ? { kind: 'too_close', pairs } : { kind: 'move', positions }
}

/**
 * The sentence that a refused move fails with: what was wrong and the next step.
 * @param refusal - a refused plan.
 * @returns the sentence, ending with 'Nothing was moved.'
 */
export function refusalSentence(refusal: Exclude<MovePlan, { kind: 'move' }>): string {
  switch (refusal.kind) {
    case 'duplicate_nodes':
      return `The moves list these nodes more than once: ${refusal.ids.join(', ')}. List each node once. Nothing was moved.`
    case 'unknown_nodes':
      return `The canvas has no node ${refusal.ids.join(', ')}. Its nodes are: ${refusal.known.join(', ')}. Nothing was moved.`
    case 'too_close': {
      const box = (card: CanvasCard): string => `${card.id} (x ${String(card.x)}, y ${String(card.y)}, ${String(card.width)} wide, ${String(card.height)} tall)`
      const pairs = refusal.pairs.map(([card, other]) => `${box(card)} and ${box(other)}`).join('; ')
      return `The move would leave cards closer than ${String(CARD_GAP)} units: ${pairs}. Keep at least ${String(CARD_GAP)} units between the cards and call dv_canvas_move again. Nothing was moved.`
    }
  }
}

/**
 * The cards with stored positions applied.
 * @param cards - the cards as drawn.
 * @param positions - the new top-left corners by node id.
 * @returns the cards after the move, in the same order.
 */
export function cardsAfter(cards: readonly CanvasCard[], positions: Readonly<Record<string, NodePosition>>): CanvasCard[] {
  return cards.map(card => ({ ...card, ...positions[card.id] }))
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isSpot = (value: unknown): value is NodePosition => isObject(value) && isNumber(value['x']) && isNumber(value['y'])
const isSpots = (value: unknown): value is Record<string, NodePosition> => isObject(value) && Object.values(value).every(isSpot)
const isCard = (value: unknown): value is CanvasCard => isObject(value)
  && ['id', 'type', 'title'].every(key => typeof value[key] === 'string')
  && (value['record'] === null || typeof value['record'] === 'string')
  && ['x', 'y', 'width', 'height'].every(key => isNumber(value[key])) && typeof value['rendering'] === 'boolean'

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

/**
 * @param output - the data of a `moved` frame.
 * @returns the move, or null when the output is not a {@link CanvasMoved}.
 */
export function parseMoved(output: unknown): CanvasMoved | null {
  if (!isObject(output) || typeof output['project'] !== 'string') return null
  const positions = output['positions']
  return isSpots(positions) ? { project: output['project'], positions } : null
}
