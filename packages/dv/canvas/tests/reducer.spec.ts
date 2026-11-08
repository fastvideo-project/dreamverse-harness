/** The pure `canvas` reducer: each rule, replay of a shorter chain as an undo does, the free row, and the agent summary. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ComponentStates, ProjectRecord, RecordId } from '@dv/project'
import { describe, expect, it } from 'vitest'
import { canvasReducer, COLUMN, ROW } from '../src/reducer.ts'
import type { AssetPlacement, NodeId, NodeMaker } from '../src/types.ts'

type Slice = ComponentStates['canvas']

const makers: NodeMaker[] = [
  { operations: ['shot.render'], kind: 'shot', column: 2 },
  { operations: ['character.create'], kind: 'character', column: 0 },
  { operations: ['asset.import'], kind: 'asset', column: 0, makes: record => record.params['place'] === true },
]
const placement: AssetPlacement = { place: 'asset.place', unplace: 'asset.unplace', kind: 'asset', column: 0 }
const reducer = canvasReducer({
  maker: operation => makers.find(maker => maker.operations.includes(operation)),
  placement: operation => [placement.place, placement.unplace].includes(operation) ? placement : undefined,
})

let counter = 0

/** A record of one operation. */
function record(operation: string, fields: Partial<ProjectRecord> = {}): ProjectRecord {
  counter += 1
  return {
    id: brandString<RecordId>(`r${String(counter)}`), parents: [], kind: 'operation', component: operation.split('.')[0] ?? '', operation,
    operation_version: '1', actor: 'user', surface: 'canvas', turn: null, session: null, tool_call: null, intent: 'test', params: {},
    inputs: [], outputs: [], based_on: null, supersedes: [], deterministic: false, status: 'done', created_at: new Date().toISOString(),
    ...fields,
  }
}

const asset = (id: string): AssetId => brandString<AssetId>(id)
const inputs = (...ids: string[]): ProjectRecord['inputs'] => ids.map(id => ({ role: 'asset', ref: { asset: asset(id) }, resolved_asset: asset(id) }))

function reduceAll(records: readonly ProjectRecord[]): Slice {
  return records.reduce((slice, each) => reducer.reduce(slice, each), reducer.initial())
}

/** Each node as `id kind versions x,y width×height`. */
function nodesOf(slice: Slice): string[] {
  return slice.order.map((id) => {
    const node = slice.nodes[id]
    const at = node?.position
    return `${id} ${node?.kind ?? '?'} [${node?.versions.join(',') ?? ''}] ${String(at?.x)},${String(at?.y)} ${String(at?.width)}×${String(at?.height)}`
  })
}

describe('canvasReducer', () => {
  it('creates one node per record of a registered operation, in the first free row of its column, with the default size', () => {
    const first = record('shot.render', { status: 'running' })
    const second = record('shot.render', { status: 'failed' })
    const character = record('character.create')
    expect(nodesOf(reduceAll([first, second, character]))).toEqual([
      `${first.id} shot [${first.id}] ${String(2 * COLUMN)},0 null×null`,
      `${second.id} shot [${second.id}] ${String(2 * COLUMN)},${String(ROW)} null×null`,
      `${character.id} character [${character.id}] 0,0 null×null`,
    ])
  })

  it('adds a record based on any version of a node to that node, so a rerun of a rerun joins the first node', () => {
    const first = record('shot.render', { outputs: [asset('v1')] })
    const rerun = record('shot.render', { based_on: first.id, outputs: [asset('v2')], status: 'failed' })
    const again = record('shot.render', { based_on: rerun.id, outputs: [asset('v3')] })
    const slice = reduceAll([first, rerun, again])
    expect(nodesOf(slice)).toEqual([`${first.id} shot [${first.id},${rerun.id},${again.id}] ${String(2 * COLUMN)},0 null×null`])
    expect(slice.assets).toEqual({ v3: first.id })
  })

  it('adds a version for a record of an unregistered operation based on a node, and creates a node when the base is in no node', () => {
    const character = record('character.create')
    const update = record('character.update', { based_on: character.id })
    const orphan = record('shot.render', { based_on: brandString<RecordId>('gone') })
    expect(nodesOf(reduceAll([character, update, orphan]))).toEqual([
      `${character.id} character [${character.id},${update.id}] 0,0 null×null`,
      `${orphan.id} shot [${orphan.id}] ${String(2 * COLUMN)},0 null×null`,
    ])
  })

  it('creates its own node for a record of a maker of another kind based on a node', () => {
    const shot = record('shot.render')
    const character = record('character.create', { based_on: shot.id })
    expect(nodesOf(reduceAll([shot, character]))).toEqual([
      `${shot.id} shot [${shot.id}] ${String(2 * COLUMN)},0 null×null`,
      `${character.id} character [${character.id}] 0,0 null×null`,
    ])
  })

  it('moves a node for a position record based on it, and places assets for a placement record based on a node, without a version', () => {
    const shot = record('shot.render')
    const move = record('canvas.node_position', { based_on: shot.id, params: { node: shot.id, x: 600, y: 40 } })
    const place = record('asset.place', { based_on: shot.id, inputs: inputs('a1') })
    expect(nodesOf(reduceAll([shot, move, place]))).toEqual([
      `${shot.id} shot [${shot.id}] 600,40 null×null`,
      `${place.id} asset [${place.id}] 0,0 null×null`,
    ])
  })

  it('takes a record only when the maker filter accepts it', () => {
    const quiet = record('asset.import', { outputs: [asset('a1')] })
    const placed = record('asset.import', { params: { place: true }, outputs: [asset('a2')] })
    expect(nodesOf(reduceAll([quiet, placed]))).toEqual([`${placed.id} asset [${placed.id}] 0,0 null×null`])
  })

  it('places each input asset that no node shows, and unplaces the asset nodes of its input assets', () => {
    const shot = record('shot.render', { outputs: [asset('v1')] })
    // An input whose asset is not resolved names no asset to place.
    const place = record('asset.place', { inputs: [...inputs('a1', 'v1', 'a2'), { role: 'asset', ref: { record: shot.id, output: 0 }, resolved_asset: null }] })
    const again = record('asset.place', { inputs: inputs('a1') })
    const unplace = record('asset.unplace', { inputs: inputs('a1', 'v1') })
    const placed = reduceAll([shot, place, again])
    expect(nodesOf(placed)).toEqual([
      `${shot.id} shot [${shot.id}] ${String(2 * COLUMN)},0 null×null`,
      `${place.id} asset [${place.id}] 0,0 null×null`,
      `${place.id}.2 asset [${place.id}] 0,${String(ROW)} null×null`,
    ])
    expect([placed.nodes[brandString<NodeId>(place.id)]?.asset, placed.nodes[brandString<NodeId>(`${place.id}.2`)]?.asset]).toEqual(['a1', 'a2'])
    const after = reducer.reduce(placed, unplace)
    expect(nodesOf(after)).toEqual([
      `${shot.id} shot [${shot.id}] ${String(2 * COLUMN)},0 null×null`,
      `${place.id}.2 asset [${place.id}] 0,${String(ROW)} null×null`,
    ])
    expect(after.assets).toEqual({ v1: shot.id, a2: `${place.id}.2` })
  })

  it('leaves the slice as it is for an unplacement of assets that no asset node shows', () => {
    const shot = record('shot.render', { outputs: [asset('v1')] })
    const slice = reduceAll([shot])
    expect(reducer.reduce(slice, record('asset.unplace', { inputs: inputs('v1', 'a9') }))).toBe(slice)
  })

  it('ignores a placement that has not finished', () => {
    expect(nodesOf(reduceAll([record('asset.place', { inputs: inputs('a1'), status: 'failed' })]))).toEqual([])
  })

  it('sets the given position fields of a node, and a shorter chain, as an undo replays it, restores the earlier position', () => {
    const shot = record('shot.render')
    const move = record('canvas.node_position', { params: { node: shot.id, x: 600, y: 40 } })
    const resize = record('canvas.node_position', { params: { node: shot.id, width: 320, height: 200 } })
    const unknown = record('canvas.node_position', { params: { node: 'gone', x: 1 } })
    const pending = record('canvas.node_position', { params: { node: shot.id, x: 9 }, status: 'pending' })
    expect(nodesOf(reduceAll([shot, move, resize, unknown, pending]))).toEqual([`${shot.id} shot [${shot.id}] 600,40 320×200`])
    expect(nodesOf(reduceAll([shot, move]))).toEqual([`${shot.id} shot [${shot.id}] 600,40 null×null`])
  })

  it('skips the rows that a moved or resized node covers', () => {
    const first = record('shot.render')
    const grow = record('canvas.node_position', { params: { node: first.id, height: ROW + 30 } })
    const second = record('shot.render')
    const nodes = nodesOf(reduceAll([first, grow, second]))
    expect(nodes[1]).toBe(`${second.id} shot [${second.id}] ${String(2 * COLUMN)},${String(2 * ROW)} null×null`)
  })

  it('continues a full column of six rows in a sub-column three columns to the right', () => {
    const nodes = nodesOf(reduceAll(Array.from({ length: 7 }, () => record('shot.render'))))
    expect(nodes[5]).toMatch(new RegExp(` ${String(2 * COLUMN)},${String(5 * ROW)} `, 'u'))
    expect(nodes[6]).toMatch(new RegExp(` ${String(5 * COLUMN)},0 `, 'u'))
  })

  it('ignores records of other operations', () => {
    const slice = reduceAll([record('shot.render')])
    expect(reducer.reduce(slice, record('timeline.create'))).toBe(slice)
    expect(reducer.reduce(slice, { ...record('proj.request'), operation: null })).toBe(slice)
  })

  it('lists every node with its kind, name, shown version and position in the agent summary', () => {
    const first = record('shot.render')
    const rerun = record('shot.render', { based_on: first.id })
    const slice = reduceAll([first, rerun])
    expect(reducer.agentSummary?.(slice, { url: id => id }, {} as never)).toEqual({
      canvas: [{ node: first.id, kind: 'shot', name: null, shown: rerun.id, x: 2 * COLUMN, y: 0, width: null, height: null }],
    })
  })
})
