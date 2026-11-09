/**
 * Canvas nodes and edges derived from a project state and the registered node types. Every node comes from the
 * canvas's node list (`state.components.canvas`), in creation order, at its stored position, titled with its name when it
 * has one; the node type whose `type` is the node's kind draws it, and a kind without a registered type draws a plain
 * card. The builder names no node type.
 */
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import { versionRefOf } from '@dv/ui-kit/references.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord, WireCanvasNode, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type { NodePosition } from '../canvas-layout.ts'
import type { NodeEntry, NodeFlags, NodeType, OperationRecord, RecordsInUse, TypeEntry } from './contract/index.ts'

/** One drawn node: its entry at the newest version, its type, and the facts that the canvas derived. */
export type CanvasNode = NodeEntry & {
  type: string
  nodeType: NodeType
  /** The node of the node list. */
  node: WireCanvasNode
  flags: NodeFlags
  badges: string[]
}

/** How one node fed another: an input of the target's newest version, with its role. */
export interface CanvasEdge {
  from: string
  to: string
  /** The input role, such as 'reference' or 'first_frame'. */
  role: string
}

/** A drawn edge with the nodes it joins. */
export interface EdgeLink {
  source: CanvasNode
  target: CanvasNode
  edge: CanvasEdge
}

/** The canvas graph. */
export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** The edges in the same order, each with the nodes it joins. */
  links: EdgeLink[]
  /** The node that shows each asset: the node that owns it, else the nearest drawn record up its producer chain. */
  assetNodes: Record<string, string>
  /**
   * The node at one of its versions, as the editor's version strip shows it.
   * @param node - a drawn node.
   * @param record - one of its versions.
   * @returns the node with that version's entry, or the node itself for its newest version or an unknown record.
   */
  atVersion(node: CanvasNode, record: string): CanvasNode
}

/** The registered descriptors that the builder reads. */
export interface CanvasRegistrations {
  nodeTypes: readonly NodeType[]
  recordsInUse: readonly RecordsInUse[]
  versionKinds: readonly VersionKind[]
}

/** The frame of a node of a kind without a registered type: a 16:9 card. */
const PLAIN_SIZE = { width: 208, height: 117 }

/**
 * The type that draws the nodes of a kind without a registered type: the operation label as the title, on a plain card.
 * @param kind - the node's kind.
 * @returns the type.
 */
function plainType(kind: string): NodeType {
  return {
    id: '@dv/ui-canvas', type: kind, label: () => kind, color: 'var(--dv-node-1)',
    entry: ({ record, operations, language }) => ({
      title: operations.find(operation => operation.name === record.operation)?.label?.[language] ?? record.operation,
      sizing: { kind: 'window', defaultSize: PLAIN_SIZE, minSize: { width: 104, height: 59 } },
    }),
  }
}

/** @returns the registered type of a kind, else the plain type. */
function typeOf(nodeTypes: readonly NodeType[], kind: string): NodeType {
  return nodeTypes.find(type => type.type === kind) ?? plainType(kind)
}

/**
 * The title that the card of one node shows, from that node alone.
 * @param state - a project state.
 * @param operations - the operation declarations.
 * @param language - the interface language.
 * @param nodeTypes - the registered node types.
 * @param id - the node.
 * @returns the title, or undefined for a node that the canvas does not draw.
 */
export function nodeTitle(
  state: WireState, operations: readonly WireOperation[], language: DvLanguage, nodeTypes: readonly NodeType[], id: string,
): string | undefined {
  const node = state.components.canvas.nodes[id]
  if (node === undefined) return undefined
  const record = state.components.proj.records.find(entry => entry.id === node.versions.at(-1))
  if (record === undefined || record.operation === null) return undefined
  const shown: OperationRecord = { ...record, operation: record.operation }
  return typeOf(nodeTypes, node.kind).entry({ id, node, record: shown, state, operations, language }).title
}

/**
 * A project state with other names on some nodes of the node list, such as the names of renames still in flight.
 * @param state - a project state.
 * @param names - the name of each node to change, by node ID; null clears it.
 * @returns the state with those names.
 */
export function withNames(state: WireState, names: Readonly<Record<string, string | null>>): WireState {
  const canvas = state.components.canvas
  const nodes = { ...canvas.nodes }
  for (const [id, name] of Object.entries(names)) {
    const node = nodes[id]
    if (node !== undefined) nodes[id] = { ...node, name }
  }
  return { ...state, components: { ...state.components, canvas: { ...canvas, nodes } } }
}

/**
 * The box of a node in canvas units: its stored position, with its type's default size where the stored size is null.
 * @param node - a drawn node.
 * @returns the box.
 */
export function boxOf(node: Pick<CanvasNode, 'node' | 'sizing'>): NodePosition {
  const { x, y, width, height } = node.node.position
  return { x, y, width: width ?? node.sizing.defaultSize.width, height: height ?? node.sizing.defaultSize.height }
}

/**
 * The canvas graph of a project state. A node owns the assets of its entry, then the outputs of its earlier versions.
 * A node draws one edge per input of its newest version: from the node of the versioned item it names, else from the
 * node of the asset.
 * @param state - a project state.
 * @param operations - the operation declarations.
 * @param language - the interface language.
 * @param registered - the registered descriptors.
 * @returns the nodes and edges.
 */
export function buildCanvasGraph(
  state: WireState, operations: readonly WireOperation[], language: DvLanguage, registered: CanvasRegistrations,
): CanvasGraph {
  const { nodeTypes, recordsInUse, versionKinds } = registered
  const proj = state.components.proj
  const canvas = state.components.canvas
  const records = new Map(proj.records.map(record => [record.id, record]))
  const flagsOf = (record: ProjectRecord): NodeFlags => ({
    stale: proj.stale[record.id] !== undefined,
    rendering: record.status === 'pending' || record.status === 'running',
    failed: record.status === 'failed',
    superseded: proj.superseded[record.id] !== undefined,
  })
  const drawn = (id: string, node: WireCanvasNode, record: OperationRecord): CanvasNode => {
    const nodeType = typeOf(nodeTypes, node.kind)
    const entry: TypeEntry = nodeType.entry({ id, node, record, state, operations, language })
    return {
      ...entry, title: node.name ?? entry.title, id, assets: entry.assets ?? record.outputs, record, versions: node.versions,
      type: node.kind, nodeType, node, flags: flagsOf(record), badges: [],
    }
  }
  const recordOf = (id: string | undefined): OperationRecord | undefined => {
    const record = id === undefined ? undefined : records.get(id)
    return record?.operation === null || record === undefined ? undefined : { ...record, operation: record.operation }
  }
  const nodes = canvas.order.flatMap((id) => {
    const node = canvas.nodes[id]
    const record = recordOf(node?.versions.at(-1))
    return node === undefined || record === undefined ? [] : [drawn(id, node, record)]
  })
  const byId = new Map(nodes.map(entry => [entry.id, entry]))
  const owner = new Map<string, string>()
  for (const entry of nodes) for (const asset of entry.assets) if (!owner.has(asset)) owner.set(asset, entry.id)
  for (const entry of nodes) {
    for (const version of entry.versions) {
      for (const asset of records.get(version)?.outputs ?? []) if (!owner.has(asset)) owner.set(asset, entry.id)
    }
  }
  const recordNode = new Map(nodes.flatMap(entry => entry.versions.map(version => [version, entry.id] as const)))
  /** The node an asset comes from: its owner, else the nearest record up its producer chain that a node shows. */
  const nodeOfAsset = (assetId: string | null, depth = 0): string | null => {
    if (assetId === null) return null
    const mine = owner.get(assetId)
    if (mine !== undefined) return mine
    const producer = proj.created_by[assetId]
    if (producer === undefined || depth > 16) return null
    const shown = recordNode.get(producer)
    if (shown !== undefined) return shown
    const source = records.get(producer)?.inputs.find(input => input.resolved_asset !== null)?.resolved_asset
    return source === undefined || source === null ? null : nodeOfAsset(source, depth + 1)
  }
  const links: EdgeLink[] = []
  const seen = new Set<string>()
  for (const target of nodes) {
    for (const input of target.record.inputs) {
      const named = versionRefOf(input.ref)
      const item = named === null ? null : versionKinds.find(kind => kind.kind === named.kind)?.node(state, named.id) ?? null
      const source = byId.get((item !== null && byId.has(item) ? item : nodeOfAsset(input.resolved_asset)) ?? '')
      if (source === undefined || source === target || seen.has(`${source.id}>${target.id}`)) continue
      seen.add(`${source.id}>${target.id}`)
      links.push({ source, target, edge: { from: source.id, to: target.id, role: input.role } })
    }
  }
  for (const { asset, label } of recordsInUse.flatMap(descriptor => descriptor.badges?.(state) ?? [])) {
    const badged = byId.get(nodeOfAsset(asset) ?? '')
    if (badged !== undefined && !badged.badges.includes(label)) badged.badges.push(label)
  }
  const assetNodes: Record<string, string> = {}
  for (const asset of state.assets) {
    const shown = nodeOfAsset(asset.id)
    if (shown !== null && byId.has(shown)) assetNodes[asset.id] = shown
  }
  const atVersion = (entry: CanvasNode, record: string): CanvasNode => {
    const version = recordOf(entry.versions.includes(record) ? record : undefined)
    if (version === undefined || version.id === entry.record.id) return entry
    return { ...drawn(entry.id, entry.node, version), badges: entry.badges }
  }
  return { nodes, edges: links.map(link => link.edge), links, assetNodes, atVersion }
}

/**
 * The asset that stands for a node in small views: its `preview`, else its first asset.
 * @param entry - the node.
 * @returns the asset ID, or null for a node without assets.
 */
export function previewOf(entry: Pick<NodeEntry, 'preview' | 'assets'>): string | null {
  return entry.preview ?? entry.assets[0] ?? null
}

/**
 * Whether a node counts as a finished result that the user has not seen until its editor opens: a node whose newest
 * version is not rendering and has an output.
 * @param entry - the node.
 * @returns whether the unseen dot applies.
 */
export function isFinished(entry: Pick<CanvasNode, 'flags' | 'record'>): boolean {
  return !entry.flags.rendering && entry.record.outputs.length > 0
}
