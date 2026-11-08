/**
 * The History rows of the canvas's own operations. A `canvas.node_position` record reads 移动节点 / Moved “{title}” for
 * a move and 调整大小 / Resized “{title}” for a resize, where the title is the one the node's card shows now. A
 * `canvas.node_remove` record reads 从画布移除「{title}」 / Removed “{title}”, where the title is the one the node's
 * card showed before the removal, drawn from the node that the record's report keeps. Selecting either row opens the
 * node on the canvas.
 *
 * @module @dv/ui-canvas/history-row
 */
import type { HistoryRow } from '@dv/ui-history/contract'
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import type { Registry } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord, WireCanvasNode, WireState } from '@dv/ui-kit/types.ts'
import type { NodeType } from './contract/index.ts'
import { nodeTitle } from './graph.ts'
import { en, zh } from './locales.ts'

/** The operations whose records the rows name. */
const NODE_POSITION = 'canvas.node_position'
const NODE_REMOVE = 'canvas.node_remove'

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

/**
 * The History row of `canvas.node_remove`, titled by the nodes that the record's report keeps.
 * @param nodeTypes - the registered node types, read when a row is labeled.
 * @returns the row.
 */
export function removeRow(nodeTypes: Registry<NodeType>): HistoryRow {
  // The precondition of `canvas.node_remove` refuses a call that names no node.
  const removedOf = (step: ProjectRecord): [string, ...string[]] => step.params['nodes'] as [string, ...string[]]
  return {
    match: NODE_REMOVE,
    subject: () => null,
    label(step, { state, operations }) {
      const kept = (step.report?.['removed'] ?? {}) as Record<string, WireCanvasNode>
      // The removed nodes are titled alone, over the current records, which still hold their versions.
      const before: WireState | null = state === null ? null : {
        ...state, components: { ...state.components, canvas: { nodes: kept, order: Object.keys(kept), assets: {} } },
      }
      const titleIn = (language: DvLanguage): string => {
        const titles = before === null
          ? []
          : Object.keys(kept).flatMap(id => nodeTitle(before, operations, language, nodeTypes.getSnapshot(), id) ?? [])
        return titles.length === 0 ? removedOf(step).join(', ') : titles.join(', ')
      }
      return [zh['history.removed'].replace('{title}', titleIn('zh')), en['history.removed'].replace('{title}', titleIn('en'))]
    },
    focus: () => ({ view: 'canvas', target: {} }),
  }
}
