/**
 * The reducer of the `canvas` slice. It reads every record of the chain, oldest first, and applies the first rule that
 * matches:
 * 1. a record whose `based_on` is a version of node N becomes the newest version of N, unless its operation is
 *    `canvas.node_position`, a placement's, or a maker's of another kind;
 * 2. a record of an operation that a {@link NodeMaker} names creates a node of its kind in the first free row of its
 *    column (a full column continues in a sub-column), with the default size;
 * 3. a finished `place` record of an {@link AssetPlacement} creates a node for each input asset that no node shows;
 * 4. a finished `canvas.node_remove` record deletes the nodes that its params name;
 * 5. a finished `canvas.node_position` record sets the fields of the node's position that its params give;
 * 6. every other record leaves the slice as it is.
 * Rules 1 and 2 take records in any status, so a running or failed version shows its state. The slice follows the
 * records of the chain, so an undo of a move or a resize restores the earlier position, and an undo of a removal
 * restores the node with its name, versions and position.
 *
 * @module @dv/canvas/reducer
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ProjectRecord, RecordId, Reducer } from '@dv/project'
import type { AssetPlacement, CanvasNode, CanvasState, NodeId, NodeMaker, NodePosition } from './types.ts'

/** The operation that moves or resizes a node. */
export const NODE_POSITION = 'canvas.node_position'
/** The operation that removes nodes from the canvas. */
export const NODE_REMOVE = 'canvas.node_remove'

/** The width of a layout column, in canvas units. */
export const COLUMN = 240
/** The height of a layout row, in canvas units. */
export const ROW = 200
/** The rows of one layout column before new nodes continue in the next sub-column. */
const ROWS = 6
/** How far right a column's next sub-column sits, in columns: the producers use columns 0 to 2. */
const COLUMN_STRIDE = 3
/** The height of the caption above a node's frame, in canvas units. */
const CAPTION = 20

/** The registrations that the reducer reads: the makers and placements by operation. */
export interface CanvasRegistrations {
  maker(operation: string): NodeMaker | undefined
  placement(operation: string): AssetPlacement | undefined
}

/**
 * The first cell of a column that no node covers: its six rows, then the rows of each sub-column three columns further
 * right. A node of the default size covers one cell at its corner, because only the browser knows the default size of
 * its type.
 * @param slice - the slice.
 * @param column - the column.
 * @returns the position of a new node, with the default size.
 */
function freeRow(slice: CanvasState, column: number): NodePosition {
  const boxes = Object.values(slice.nodes).map(({ position: at }) => ({
    x: at.x, y: at.y, width: at.width ?? COLUMN, height: at.height === null ? ROW : at.height + CAPTION,
  }))
  const covered = (x: number, y: number): boolean =>
    boxes.some(box => box.x < x + COLUMN && x < box.x + box.width && box.y < y + ROW && y < box.y + box.height)
  // A full column continues in a sub-column further right, so a long list forms a block that fits the screen.
  for (let x = column * COLUMN; ; x += COLUMN_STRIDE * COLUMN) {
    for (let y = 0; y < ROWS * ROW; y += ROW) if (!covered(x, y)) return { x, y, width: null, height: null }
  }
}

/**
 * @param slice - the slice.
 * @param record - a record.
 * @returns the node that has the record as a version, or undefined.
 */
function nodeOfVersion(slice: CanvasState, record: RecordId): NodeId | undefined {
  return slice.order.find(id => slice.nodes[id]?.versions.includes(record) === true)
}

/**
 * @param assets - the asset map.
 * @param node - a node.
 * @returns the map without the assets that the node shows.
 */
function withoutNode(assets: CanvasState['assets'], node: NodeId): CanvasState['assets'] {
  return Object.fromEntries(Object.entries(assets).filter(([, shown]) => shown !== node))
}

/**
 * @param assets - the asset map.
 * @param node - a node.
 * @param shown - the assets that the node shows now.
 * @returns the map with the node's assets replaced.
 */
function showing(assets: CanvasState['assets'], node: NodeId, shown: readonly AssetId[]): CanvasState['assets'] {
  const next = withoutNode(assets, node)
  for (const asset of shown) next[asset] = node
  return next
}

/** @returns the slice with one more node. */
function added(slice: CanvasState, id: NodeId, node: CanvasNode, shown: readonly AssetId[]): CanvasState {
  return { nodes: { ...slice.nodes, [id]: node }, order: [...slice.order, id], assets: showing(slice.assets, id, shown) }
}

/** @returns the assets of a record's inputs. */
function inputAssets(record: ProjectRecord): AssetId[] {
  return record.inputs.flatMap(input => input.resolved_asset === null ? [] : [input.resolved_asset])
}

/**
 * Rule 3: one node per input asset that no node shows; the first takes the record ID.
 * @returns the slice after the record.
 */
function place(slice: CanvasState, record: ProjectRecord, placement: AssetPlacement): CanvasState {
  let next = slice
  for (const asset of new Set(inputAssets(record))) {
    if (next.assets[asset] !== undefined) continue
    const count = next.order.filter(id => String(id) === record.id || id.startsWith(`${record.id}.`)).length
    const id = brandString<NodeId>(count === 0 ? record.id : `${record.id}.${String(count + 1)}`)
    const node: CanvasNode = { kind: placement.kind, name: null, versions: [record.id], asset, position: freeRow(next, placement.column) }
    next = added(next, id, node, [asset])
  }
  return next
}

/**
 * Rule 4: delete the nodes that the params name, with the assets they show.
 * @returns the slice after the record.
 */
function remove(slice: CanvasState, record: ProjectRecord): CanvasState {
  const removed = new Set(record.params['nodes'] as NodeId[])
  let assets = slice.assets
  for (const id of removed) assets = withoutNode(assets, id)
  const nodes = Object.fromEntries(Object.entries(slice.nodes).filter(([id]) => !removed.has(id as NodeId))) as CanvasState['nodes']
  return { nodes, order: slice.order.filter(id => !removed.has(id)), assets }
}

/**
 * Rule 5: set the position fields that the params give, of a node the slice has.
 * @returns the slice after the record.
 */
function position(slice: CanvasState, record: ProjectRecord): CanvasState {
  const id = brandString<NodeId>(String(record.params['node']))
  const node = slice.nodes[id]
  if (node === undefined) return slice
  const at = { ...node.position }
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const value = record.params[field]
    if (typeof value === 'number') at[field] = value
  }
  return { ...slice, nodes: { ...slice.nodes, [id]: { ...node, position: at } } }
}

/**
 * The `canvas` reducer.
 * @param registered - the makers and placements, read at every record.
 * @returns the reducer.
 */
export function canvasReducer(registered: CanvasRegistrations): Reducer<'canvas'> {
  return {
    initial: () => ({ nodes: {}, order: [], assets: {} }),
    reduce(slice, record) {
      const operation = record.operation ?? ''
      const maker = registered.maker(operation)
      const placement = registered.placement(operation)
      const versioned = operation !== NODE_POSITION && placement === undefined
      const base = versioned && record.based_on !== null ? nodeOfVersion(slice, record.based_on) : undefined
      const node = base === undefined ? undefined : slice.nodes[base]
      if (base !== undefined && node !== undefined && (maker === undefined || maker.kind === node.kind)) {
        const versions = [...node.versions, record.id]
        return { ...slice, nodes: { ...slice.nodes, [base]: { ...node, versions } }, assets: showing(slice.assets, base, record.outputs) }
      }
      if (maker !== undefined && maker.makes?.(record) !== false) {
        const made: CanvasNode = { kind: maker.kind, name: null, versions: [record.id], position: freeRow(slice, maker.column) }
        return added(slice, brandString<NodeId>(record.id), made, record.outputs)
      }
      if (record.status !== 'done') return slice
      if (placement !== undefined) return place(slice, record, placement)
      if (operation === NODE_REMOVE) return remove(slice, record)
      return operation === NODE_POSITION ? position(slice, record) : slice
    },
    agentSummary: slice => ({
      canvas: slice.order.flatMap((id) => {
        const node = slice.nodes[id]
        /* v8 ignore next -- every ID of the order names a node of the slice. */
        if (node === undefined) return []
        const { x, y, width, height } = node.position
        /* v8 ignore next -- every node holds the record that created it, so its versions are never empty. */
        const shown = node.versions.at(-1) ?? null
        return [{ node: id, kind: node.kind, name: node.name, shown, x, y, width, height }]
      }),
    }),
  }
}
