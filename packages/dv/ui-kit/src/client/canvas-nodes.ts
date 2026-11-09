/**
 * The canvas node list of a wire state as plugin UI halves read it: which node shows a record.
 *
 * @module @dv/ui-kit/canvas-nodes
 */
import type { WireState } from './types.ts'

/**
 * @param state - a project state.
 * @param record - a record ID, or undefined.
 * @returns the ID of the canvas node that has the record as a version, or null for none.
 */
export function nodeOfRecord(state: WireState, record: string | undefined): string | null {
  const { nodes, order } = state.components.canvas
  return record === undefined ? null : order.find(id => nodes[id]?.versions.includes(record) === true) ?? null
}
