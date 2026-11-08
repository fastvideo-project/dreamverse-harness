/** The History row of `canvas.node_position` records: its move and resize copy with the node's title, and its focus. */
import { describe, expect, it } from 'vitest'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import { actionLabel, matchingRow } from '../../ui-history/src/client/rows.ts'
import { fixtureState, OPERATIONS, record } from '../../ui-kit/tests/fixture.client.tsx'
import type { NodeType } from '../src/client/contract/index.ts'
import { createDvCanvas } from '../src/client/dv-canvas.ts'
import { positionRow } from '../src/client/history-row.ts'

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
  })

  it('matches the operation and moves the center to the canvas node that the record names', () => {
    const row = rowWithShot()
    expect([matchingRow(move, [row]), row.subject(move)]).toEqual([row, null])
    expect(row.focus?.(move, [move])).toEqual({ view: 'canvas', target: { record: 'g2' } })
  })
})
