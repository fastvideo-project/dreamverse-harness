/**
 * The History rows of `canvas.node_position` records, with their move and resize copy and the node's title, of
 * `canvas.node_remove` records, with the removed node's title, and of `canvas.node_rename` records, with the name; and
 * their focus.
 */
import { describe, expect, it } from 'vitest'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import { actionLabel, matchingRow } from '../../ui-history/src/client/rows.ts'
import { canvasNode, fixtureState, OPERATIONS, record } from '../../ui-kit/tests/fixture.client.tsx'
import type { NodeType } from '../src/client/contract/index.ts'
import { createDvCanvas } from '../src/client/dv-canvas.ts'
import { positionRow, removeRow, renameRow } from '../src/client/history-row.ts'

const SHOT: NodeType = {
  id: '@dv/ui-test-shot', type: 'shot', label: () => 'Shot', color: '',
  entry: ({ language }) => ({ title: language === 'zh' ? '镜头一' : 'Shot one', sizing: { kind: 'window', defaultSize: { width: 208, height: 117 }, minSize: { width: 104, height: 59 } } }),
}

const OPERATION_LABELS: WireOperation[] = [...OPERATIONS, {
  name: 'canvas.node_position', version: '1', description: '', label: { zh: '节点位置', en: 'Node position' },
  inputs: {}, params: {}, outputs: [], deterministic: true, resource: 'none',
}]

/** @returns the row over a registry that holds the shot type. */
function rowWithShot() {
  const canvas = createDvCanvas()
  canvas.nodeTypes.register(SHOT)
  return positionRow(canvas.nodeTypes)
}

describe('the canvas.node_position History row', () => {
  const move = record({ id: 'm1', operation: 'canvas.node_position', params: { node: 'g2', x: 10, y: 20 } })
  const resize = record({ id: 'm2', operation: 'canvas.node_position', params: { node: 'g2', x: 10, y: 20, width: 300, height: 169 } })

  it('labels a move 移动节点 / Moved “title” and a resize 调整大小 / Resized “title”, with the title the node\'s card shows now', () => {
    const rows = [rowWithShot()]
    const context = { operations: OPERATION_LABELS, rows, records: new Map(), state: fixtureState() }
    expect(actionLabel(move, context)).toEqual(['移动节点', 'Moved “Shot one”'])
    expect(actionLabel(resize, context)).toEqual(['调整大小', 'Resized “Shot one”'])
  })

  it('names the node by its ID while the state is not loaded or the node is gone', () => {
    const rows = [rowWithShot()]
    expect(actionLabel(move, { operations: OPERATION_LABELS, rows, records: new Map(), state: null })).toEqual(['移动节点', 'Moved “g2”'])
    const gone = record({ id: 'm3', operation: 'canvas.node_position', params: { node: 'zz', x: 0, y: 0 } })
    expect(actionLabel(gone, { operations: OPERATION_LABELS, rows, records: new Map(), state: fixtureState() })).toEqual(['移动节点', 'Moved “zz”'])
    const state = fixtureState()
    state.components.canvas.nodes['n9'] = canvasNode('shot', ['missing'])
    const lost = record({ id: 'm4', operation: 'canvas.node_position', params: { node: 'n9', x: 0, y: 0 } })
    expect(actionLabel(lost, { operations: OPERATION_LABELS, rows, records: new Map(), state })).toEqual(['移动节点', 'Moved “n9”'])
  })

  it('matches the operation and moves the center to the canvas node that the record names', () => {
    const row = rowWithShot()
    expect([matchingRow(move, [row]), row.subject(move)]).toEqual([row, null])
    expect(row.focus?.(move, [move])).toEqual({ view: 'canvas', target: { record: 'g2' } })
  })
})

describe('the canvas.node_remove History row', () => {
  /** @returns the row over a registry that holds the shot type. */
  const rowOfRemoval = () => {
    const canvas = createDvCanvas()
    canvas.nodeTypes.register(SHOT)
    return removeRow(canvas.nodeTypes)
  }
  const removal = record({ id: 'rm1', operation: 'canvas.node_remove', params: { nodes: ['g2'] }, report: { removed: { g2: canvasNode('shot', ['g2'], 480, 200) } } })

  it('labels a removal 从画布移除「title」 / Removed “title”, with the title the node showed before the removal', () => {
    const rows = [rowOfRemoval()]
    const state = fixtureState()
    const canvas = state.components.canvas
    canvas.nodes = Object.fromEntries(Object.entries(canvas.nodes).filter(([id]) => id !== 'g2'))
    canvas.order = canvas.order.filter(id => id !== 'g2')
    expect(actionLabel(removal, { operations: OPERATIONS, rows, records: new Map(), state })).toEqual(['从画布移除「镜头一」', 'Removed “Shot one”'])
  })

  it('names the nodes by their IDs while the state is not loaded or the record keeps no node', () => {
    const rows = [rowOfRemoval()]
    expect(actionLabel(removal, { operations: OPERATIONS, rows, records: new Map(), state: null })).toEqual(['从画布移除「g2」', 'Removed “g2”'])
    const bare = record({ id: 'rm2', operation: 'canvas.node_remove', params: { nodes: ['g1', 'g2'] } })
    expect(actionLabel(bare, { operations: OPERATIONS, rows, records: new Map(), state: fixtureState() })).toEqual(['从画布移除「g1, g2」', 'Removed “g1, g2”'])
    const lost = record({ id: 'rm3', operation: 'canvas.node_remove', params: { nodes: ['n9'] }, report: { removed: { n9: canvasNode('shot', ['missing']) } } })
    expect(actionLabel(lost, { operations: OPERATIONS, rows, records: new Map(), state: fixtureState() })).toEqual(['从画布移除「n9」', 'Removed “n9”'])
  })

  it('matches the operation and moves the center to the canvas without a node to open, since the node is gone', () => {
    const row = rowOfRemoval()
    expect([matchingRow(removal, [row]), row.subject(removal)]).toEqual([row, null])
    expect(row.focus?.(removal, [removal])).toEqual({ view: 'canvas', target: {} })
  })
})

describe('the canvas.node_rename History row', () => {
  const rows = (): ReturnType<typeof renameRow>[] => {
    const canvas = createDvCanvas()
    canvas.nodeTypes.register(SHOT)
    return [renameRow(canvas.nodeTypes)]
  }
  const named = (state: ReturnType<typeof fixtureState>): ReturnType<typeof fixtureState> => {
    const g2 = state.components.canvas.nodes['g2']
    if (g2 !== undefined) g2.name = 'Later name'
    return state
  }

  it('labels a rename 重命名为「name」 / Renamed to “name” with the name the record gave, line breaks as spaces', () => {
    const rename = record({ id: 'r1', operation: 'canvas.node_rename', params: { node: 'g2', name: ' Harbor\n at dawn ' } })
    const context = { operations: OPERATION_LABELS, rows: rows(), records: new Map(), state: named(fixtureState()) }
    expect(actionLabel(rename, context)).toEqual(['重命名为「Harbor at dawn」', 'Renamed to “Harbor at dawn”'])
  })

  it('labels a cleared name with the title the node type computes, else the node ID', () => {
    const clear = record({ id: 'r2', operation: 'canvas.node_rename', params: { node: 'g2', name: null } })
    const gone = record({ id: 'r3', operation: 'canvas.node_rename', params: { node: 'zz', name: '' } })
    const context = { operations: OPERATION_LABELS, rows: rows(), records: new Map(), state: named(fixtureState()) }
    expect(actionLabel(clear, context)).toEqual(['重命名为「镜头一」', 'Renamed to “Shot one”'])
    expect(actionLabel(gone, context)).toEqual(['重命名为「zz」', 'Renamed to “zz”'])
    expect(actionLabel(clear, { ...context, state: null })).toEqual(['重命名为「g2」', 'Renamed to “g2”'])
  })

  it('matches the operation and moves the center to the canvas node that the record names', () => {
    const [row] = rows()
    const rename = record({ id: 'r1', operation: 'canvas.node_rename', params: { node: 'g2', name: 'x' } })
    expect([matchingRow(rename, rows()), row?.subject(rename)]).toEqual([expect.objectContaining({ match: 'canvas.node_rename' }), null])
    expect(row?.focus?.(rename, [rename])).toEqual({ view: 'canvas', target: { record: 'g2' } })
  })
})
