/**
 * The canvas node list of a wire state as plugin UI halves read it: which node shows a record, and the name an asset
 * takes from its node.
 *
 * @module @dv/ui-kit/canvas-nodes
 */
import type { Asset, WireState } from './types.ts'

/**
 * @param state - a project state.
 * @param record - a record ID, or undefined.
 * @returns the ID of the canvas node that has the record as a version, or null for none.
 */
export function nodeOfRecord(state: WireState, record: string | undefined): string | null {
  const { nodes, order } = state.components.canvas
  return record === undefined ? null : order.find(id => nodes[id]?.versions.includes(record) === true) ?? null
}

/**
 * The name an asset shows outside the canvas, so that a rename on the canvas shows everywhere. The node of an asset is
 * the node that shows it, else the node that has the record that created it as an earlier version. An asset of a node
 * without a name, or of no node, shows its own name. Of a node with a name, the main asset shows the node's name: the
 * placed asset of a placement node, else the first output of the node's newest version that has outputs. Every other
 * asset of the node, such as an earlier take or a second output, shows the node's name and then its own, such as
 * `Opening · shot1.mp4`, so two assets of one node never show the same name.
 * @param state - a project state.
 * @param asset - an asset of the project.
 * @returns the name.
 */
export function assetLabel(state: WireState, asset: Pick<Asset, 'id' | 'name' | 'created_by'>): string {
  const { canvas, proj } = state.components
  const id = canvas.assets[asset.id] ?? nodeOfRecord(state, asset.created_by ?? undefined)
  const node = id === null ? undefined : canvas.nodes[id]
  if (node === undefined || node.name === null) return asset.name
  const finished = node.versions.map(version => proj.records.find(record => record.id === version))
    .findLast(record => record?.outputs[0] !== undefined)
  const main = node.asset ?? finished?.outputs[0]
  return main === asset.id ? node.name : `${node.name} · ${asset.name}`
}
