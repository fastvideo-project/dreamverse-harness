/**
 * The canvas node list of a wire state as plugin UI halves read it: which node shows a record, and the name an asset
 * takes from its node, whole or in its parts.
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
 * The parts of the name an asset shows outside the canvas, so that a rename on the canvas shows everywhere. The node of
 * an asset is the node that shows it, else the node that has the record that created it as an earlier version. An asset
 * of a node without a name, or of no node, has one part, its own name. Of a node with a name, the main asset has one
 * part, the node's name: the main asset is the placed asset of a placement node, else the first output of the node's
 * newest version that has outputs. Every other asset of the node, such as an earlier take or a second output, has two
 * parts, the node's name and then its own, so two assets of one node never show the same name.
 * @param state - a project state.
 * @param asset - an asset of the project.
 * @returns the parts in the order they show.
 */
export function assetLabelParts(state: WireState, asset: Pick<Asset, 'id' | 'name' | 'created_by'>): string[] {
  const { canvas, proj } = state.components
  const id = canvas.assets[asset.id] ?? nodeOfRecord(state, asset.created_by ?? undefined)
  const node = id === null ? undefined : canvas.nodes[id]
  if (node === undefined || node.name === null) return [asset.name]
  const newest = node.versions.map(version => proj.records.find(record => record.id === version))
    .findLast(record => record?.outputs[0] !== undefined)
  const main = node.asset ?? newest?.outputs[0]
  return main === asset.id ? [node.name] : [node.name, asset.name]
}

/**
 * The name an asset shows outside the canvas: its parts ({@link assetLabelParts}) joined with ` · `, such as
 * `Opening · shot1.mp4` for an earlier take of the node named Opening.
 * @param state - a project state.
 * @param asset - an asset of the project.
 * @returns the name.
 */
export function assetLabel(state: WireState, asset: Pick<Asset, 'id' | 'name' | 'created_by'>): string {
  return assetLabelParts(state, asset).join(' · ')
}
