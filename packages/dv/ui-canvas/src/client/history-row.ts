/**
 * The History rows of the canvas's own operations. A `canvas.node_position` record reads 移动节点 / Moved “{title}” for
 * a move and 调整大小 / Resized “{title}” for a resize, where the title is the one the node's card shows now. A
 * `canvas.node_remove` record reads 从画布移除「{title}」 / Removed “{title}”, where the title is the one the node's
 * card showed before the removal, drawn from the node that the record's report keeps. A `canvas.node_rename` record
 * reads 重命名为「{name}」 / Renamed to “{name}”, where a cleared name reads as the title that the node's type computes.
 * Selecting a row opens the node on the canvas.
 *
 * @module @dv/ui-canvas/history-row
 */
import type { HistoryRow } from '@dv/ui-history/contract'
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import type { Registry } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord, WireCanvasNode, WireState } from '@dv/ui-kit/types.ts'
import type { NodeType } from './contract/index.ts'
import { buildCanvasGraph, withNames } from './graph.ts'
import { en, zh } from './locales.ts'

/** The operations whose records the rows name. */
const NODE_POSITION = 'canvas.node_position'
const NODE_REMOVE = 'canvas.node_remove'
const NODE_RENAME = 'canvas.node_rename'

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
      const registered = { nodeTypes: nodeTypes.getSnapshot(), recordsInUse: [], versionKinds: [] }
      const titleIn = (language: DvLanguage): string => state === null
        ? nodeOf(step)
        : buildCanvasGraph(state, operations, language, registered).nodes.find(node => node.id === nodeOf(step))?.title ?? nodeOf(step)
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
      const registered = { nodeTypes: nodeTypes.getSnapshot(), recordsInUse: [], versionKinds: [] }
      // The removed nodes are drawn alone, over the current records, which still hold their versions.
      const before = (shown: WireState): WireState => ({
        ...shown, components: { ...shown.components, canvas: { nodes: kept, order: Object.keys(kept), assets: {} } },
      })
      const titleIn = (language: DvLanguage): string => {
        const titles = state === null ? [] : buildCanvasGraph(before(state), operations, language, registered).nodes.map(node => node.title)
        return titles.length === 0 ? removedOf(step).join(', ') : titles.join(', ')
      }
      return [zh['history.removed'].replace('{title}', titleIn('zh')), en['history.removed'].replace('{title}', titleIn('en'))]
    },
    focus: step => ({ view: 'canvas', target: { record: removedOf(step)[0] } }),
  }
}

/**
 * The History row of `canvas.node_rename` records, which names the node's new name.
 * @param nodeTypes - the registered node types, read when a row is labeled.
 * @returns the row.
 */
export function renameRow(nodeTypes: Registry<NodeType>): HistoryRow {
  return {
    match: NODE_RENAME,
    subject: () => null,
    label(step, { state, operations }) {
      const param = step.params['name']
      // The name as the `canvas.node_rename` reducer of `@dv/canvas` stores it: trimmed, with each line break as a space.
      const given = typeof param === 'string' ? param.replace(/\s*[\r\n]+\s*/gu, ' ').trim() : ''
      const registered = { nodeTypes: nodeTypes.getSnapshot(), recordsInUse: [], versionKinds: [] }
      // A cleared name reads as the title the node's type computes, which the card shows after the record.
      const nameIn = (language: DvLanguage): string => {
        if (given !== '') return given
        if (state === null) return nodeOf(step)
        const graph = buildCanvasGraph(withNames(state, { [nodeOf(step)]: null }), operations, language, registered)
        return graph.nodes.find(node => node.id === nodeOf(step))?.title ?? nodeOf(step)
      }
      return [zh['history.renamed'].replace('{name}', nameIn('zh')), en['history.renamed'].replace('{name}', nameIn('en'))]
    },
    focus: step => ({ view: 'canvas', target: { record: nodeOf(step) } }),
  }
}
