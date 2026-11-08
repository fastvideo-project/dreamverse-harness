/**
 * The History row of `canvas.node_position` records: 移动节点 / Moved “{title}” for a move and 调整大小 /
 * Resized “{title}” for a resize, where the title is the one the node's card shows now. Selecting the row opens the
 * node on the canvas.
 *
 * @module @dv/ui-canvas/history-row
 */
import type { HistoryRow } from '@dv/ui-history/contract'
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import type { Registry } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord } from '@dv/ui-kit/types.ts'
import type { NodeType } from './contract/index.ts'
import { nodeTitle } from './graph.ts'
import { en, zh } from './locales.ts'

/** The operation whose records the row names. */
const NODE_POSITION = 'canvas.node_position'

/** @returns the node that a position record names, from its params. */
function nodeOf(step: ProjectRecord): string {
  return String(step.params['node'])
}

/**
 * @param nodeTypes - the registered node types, read when a row is labeled.
 * @returns the History row.
 */
export function positionRow(nodeTypes: Registry<NodeType>): HistoryRow {
  return {
    match: NODE_POSITION,
    subject: () => null,
    label(step, { state, operations }) {
      const resized = step.params['width'] !== undefined || step.params['height'] !== undefined
      const titleIn = (language: DvLanguage): string => state === null
        ? nodeOf(step)
        : nodeTitle(state, operations, language, nodeTypes.getSnapshot(), nodeOf(step)) ?? nodeOf(step)
      const key = resized ? 'history.resized' : 'history.moved'
      // A History row is a pair of texts, so it takes both dictionaries; the Chinese copy names no title.
      return [zh[key], en[key].replace('{title}', titleIn('en'))]
    },
    focus: step => ({ view: 'canvas', target: { record: nodeOf(step) } }),
  }
}
