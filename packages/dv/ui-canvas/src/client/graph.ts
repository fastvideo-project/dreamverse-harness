/**
 * Canvas nodes and edges derived from a project state and the registered node types. The canvas shows the project's
 * current state only, and every node comes from a registered `NodeType`: the slice nodes that a type reads from its own
 * slice, and one claimed node per current record of an operation that a type claims. The current claimed records are
 * the records of the newest chain on each anchor node, every record without an anchored chain, every record whose
 * outputs are in use, and, for each of them, the claimed records it read its inputs from and its `based_on` family. A
 * record that no type claims draws no node. A badge that a `RecordsInUse` reports for an asset, such as the trim of a
 * timeline clip, shows on the node of that asset. The builder names no node type.
 */
import { chainOf } from '@dv/ui-kit/chain.ts'
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import { versionRefOf } from '@dv/ui-kit/references.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { NodePosition, ProjectRecord, RecordInput, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type {
  AnchoredChain, ChainAnchor, ClaimedEntry, ClaimedRecord, NodeDataMap, NodeEntry, NodeFlags, NodeInput, NodeType, OperationRecord,
  RecordsInUse,
} from './contract/index.ts'

/** One drawn node: its entry, its type, and the facts that the canvas derived. */
export type CanvasNode<K extends keyof NodeDataMap = keyof NodeDataMap> = { [P in K]: CanvasNodeOf<P> }[K]

/**
 * A drawn node of one type. A claimed node is built by the canvas from its record and draws that record's edges.
 */
type CanvasNodeOf<K extends keyof NodeDataMap> = NodeEntry<K> & ({ claimed: true; record: OperationRecord } | { claimed: false }) & {
  type: K
  nodeType: NodeType<K>
  flags: NodeFlags
  badges: string[]
  chain: AnchoredChain | null
  version: number | null
  /** The default position when the user has not placed the node. */
  x: number
  y: number
}

/** A drawn claimed node, whose `record` is the record it was built from. */
type ClaimedCanvasNode<K extends keyof NodeDataMap = keyof NodeDataMap> = CanvasNode<K> & { claimed: true; record: OperationRecord }

/** How one node fed another: an input of the target's record (with its role), its chain anchor, or its `based_on`. */
export interface CanvasEdge {
  from: string
  to: string
  kind: 'input' | 'chain' | 'lineage'
  /** The input role of an `input` edge, such as 'reference' or 'first_frame'. */
  role?: string
}

/** A drawn edge with the nodes it joins, which the layout and the canvas read. */
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
}

/** The registered descriptors that the builder reads. */
export interface CanvasRegistrations {
  nodeTypes: readonly NodeType[]
  chainAnchors: readonly ChainAnchor[]
  recordsInUse: readonly RecordsInUse[]
  versionKinds: readonly VersionKind[]
}

/** Width of every node card, in canvas units: a 16:9 frame fills it (208 × 117 at 100%). */
export const NODE_WIDTH = 208
/** Default spacing of the automatic layout, in canvas units. */
const COLUMN = 240
/** Row pitch; it leaves room for a 147-unit card whose text has grown at a low zoom. */
export const ROW = 200

/** The anchored chains of a project's records ({@link anchorChains}). */
interface ChainIndex {
  /** The anchored chain of a record; null for a record without a chain and for a chain without an anchor. */
  anchored: (record: ProjectRecord) => AnchoredChain | null
  /** The newest starter record of each starter operation on each anchor node. */
  newest: ReadonlySet<string>
}

/**
 * Anchor the chains of a project's records. The chain of a record (`chainOf`: its own `started_by`, else the
 * `started_by` of its `based_on` root) is anchored when its starter record is loaded and a `ChainAnchor` is registered
 * for the starter's operation.
 * @param records - the loaded records by ID, in log order.
 * @param anchors - the registered chain anchors.
 * @returns the index.
 */
function anchorChains(records: ReadonlyMap<string, ProjectRecord>, anchors: readonly ChainAnchor[]): ChainIndex {
  const anchorOf = new Map(anchors.map(anchor => [anchor.starter, anchor]))
  const nodeOf = new Map<string, string>()
  const newest = new Map<string, string>()
  for (const record of records.values()) {
    const anchor = anchorOf.get(record.operation ?? '')
    if (anchor === undefined) continue
    const node = anchor.anchor(record)
    nodeOf.set(record.id, node)
    newest.set(`${anchor.starter}>${node}`, record.id)
  }
  return {
    anchored: (record) => {
      const chain = chainOf(record, records)
      const anchor = chain === null ? undefined : nodeOf.get(chain.record)
      if (chain === null || anchor === undefined) return null
      return { starter: chain.record, anchor, slot: chain.slot, ...chain.lane === undefined ? {} : { lane: chain.lane } }
    },
    newest: new Set(newest.values()),
  }
}

/**
 * The claimed records in the current state: for each anchor node and starter operation, the records of the chain that
 * the newest starter started; every claimed record without an anchored chain; every claimed record whose outputs are in
 * use (`used`), walking up records that no type claims, such as a still grab; and, for each of these, the claimed
 * records it read its inputs from, of any type, and its `based_on` family. Records of an earlier starter's chain that
 * nothing uses are left out, so an undo or a jump to an earlier step changes what the canvas shows.
 * @param state - a project state.
 * @param isClaimed - whether a registered type claims a record's operation.
 * @param chains - the anchored chains of the records.
 * @param used - the records whose outputs are in use.
 * @returns the record IDs.
 */
function currentRecords(
  state: WireState, isClaimed: (record: ProjectRecord) => boolean, chains: ChainIndex, used: readonly string[],
): Set<string> {
  const proj = state.components.proj
  const records = new Map(proj.records.map(record => [record.id, record]))
  const claimed = proj.records.filter(isClaimed)
  const rootOf = (id: string): string => {
    let current = id
    for (let depth = 0; depth < 64; depth++) {
      const base = records.get(current)?.based_on
      if (base === null || base === undefined || !records.has(base)) break
      current = base
    }
    return current
  }
  // Claimed records with one `based_on` root are one family.
  const roots = claimed.map(record => ({ id: record.id, root: rootOf(record.id) }))
  const familyOf = (id: string): string[] => roots.filter(each => each.root === rootOf(id)).map(each => each.id)
  // A version reference may carry any kind key, so only a reference without `version` is a record output.
  const producerOf = (input: RecordInput): string | undefined => !('version' in input.ref) && 'record' in input.ref
    ? input.ref.record : input.resolved_asset === null ? undefined : proj.created_by[input.resolved_asset]
  // The claimed record behind a record, walking up records that no type claims, such as a still grab or an export.
  const sourceOf = (recordId: string | undefined, depth = 0): ProjectRecord | undefined => {
    const record = recordId === undefined ? undefined : records.get(recordId)
    if (record === undefined || depth > 16 || isClaimed(record)) return record
    const input = record.inputs.find(entry => producerOf(entry) !== undefined)
    return input === undefined ? undefined : sourceOf(producerOf(input), depth + 1)
  }
  const claimedOf = (recordId: string | undefined): string[] => {
    const source = sourceOf(recordId)
    return source !== undefined && isClaimed(source) ? [source.id] : []
  }
  const newestOrFree = claimed.filter((record) => {
    const chain = chains.anchored(record)
    return chain === null || chains.newest.has(chain.starter)
  })
  const queue = [...newestOrFree.map(record => record.id), ...used.flatMap(claimedOf)]
  const shown = new Set<string>()
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    const record = records.get(id)
    if (shown.has(id) || record === undefined) continue
    shown.add(id)
    queue.push(...record.inputs.flatMap(input => claimedOf(producerOf(input))), ...familyOf(id))
  }
  return shown
}

/**
 * Number the current claimed records of each group, so an original and its reruns read differently. Records linked by
 * `based_on` are one group; otherwise a record of an anchored chain is grouped by the chain's anchor, slot and lane, and
 * a record without one is its own group. A group of more than one record is numbered in log order.
 * @param current - the current claimed records, in log order.
 * @param anchored - the anchored chain of a record.
 * @returns record ID → its number, or null when its group has one record.
 */
function versionsOf(
  current: readonly ProjectRecord[], anchored: (record: ProjectRecord) => AnchoredChain | null,
): Map<string, number | null> {
  const byId = new Map(current.map(record => [record.id, record]))
  const groupOf = (record: ProjectRecord, depth = 0): string => {
    const base = record.based_on === null ? undefined : byId.get(record.based_on)
    if (base !== undefined && depth < 64) return groupOf(base, depth + 1)
    const chain = anchored(record)
    return chain === null ? record.id : `${chain.anchor}#${String(chain.slot)}#${chain.lane ?? ''}`
  }
  const groups = new Map<string, ProjectRecord[]>()
  for (const record of current) groups.set(groupOf(record), [...groups.get(groupOf(record)) ?? [], record])
  const numbers = new Map<string, number | null>()
  for (const members of groups.values()) {
    members.forEach((record, index) => { numbers.set(record.id, members.length > 1 ? index + 1 : null) })
  }
  return numbers
}

/**
 * The nodes of one type: its slice nodes, split into stand-ins and the rest, and a claimed node for each current record
 * that it claims. Generic over the data key, so each node's `type`, `nodeType` and `data` belong to one type.
 * @param nodeType - the type.
 * @param input - what the canvas hands the type, with the current records that it claims.
 * @param flagsOf - the display states of a record.
 * @returns the type's nodes.
 */
function nodesOf<K extends keyof NodeDataMap>(
  nodeType: NodeType<K>, input: NodeInput, flagsOf: (record: ProjectRecord | null) => NodeFlags,
): { slice: Array<CanvasNode<K>>; standIns: Array<CanvasNode<K>>; claimed: Array<ClaimedCanvasNode<K>> } {
  const sliceNode = (entry: NodeEntry<K>): CanvasNode<K> => ({
    ...entry, type: nodeType.type, nodeType, claimed: false, flags: flagsOf(entry.record), badges: [], chain: null, version: null,
    x: 0, y: 0,
  })
  const claimedNode = (each: ClaimedRecord, entry: ClaimedEntry<K>): ClaimedCanvasNode<K> => ({
    ...entry, id: each.record.id, assets: each.record.outputs, type: nodeType.type, nodeType, claimed: true, record: each.record,
    flags: flagsOf(each.record), badges: [], chain: each.chain, version: each.version, x: 0, y: 0,
  })
  const entries = nodeType.entries?.(input) ?? []
  const claimedNodes = nodeType.claimed
  return {
    slice: entries.filter(entry => entry.standIn !== true).map(sliceNode),
    standIns: entries.filter(entry => entry.standIn === true).map(sliceNode),
    claimed: claimedNodes === undefined ? [] : input.records.map(each => claimedNode(each, claimedNodes.entry(each, input))),
  }
}

/**
 * The canvas graph of a project state, with a default layout: each node in its type's `column`, a node one column
 * right of the node it reads a `deepenOn` input from, a rerun in its source's column. The assets of slice nodes belong
 * to them, then the assets of every earlier version of an item that a `VersionKind` draws as a slice node, then the
 * outputs of claimed nodes, then the assets of stand-ins. A claimed node draws one edge per input (from the node of the
 * versioned item it names, else from the node of the asset), a chain edge from its anchor, and a lineage edge from its
 * `based_on` record; a slice node draws none.
 * @param state - a project state.
 * @param placed - the assets on the canvas.
 * @param operations - the operation declarations.
 * @param language - the interface language.
 * @param registered - the registered descriptors.
 * @returns the nodes and edges.
 */
export function buildCanvasGraph(
  state: WireState, placed: ReadonlySet<string>, operations: readonly WireOperation[], language: DvLanguage,
  registered: CanvasRegistrations,
): CanvasGraph {
  const { nodeTypes, chainAnchors, recordsInUse, versionKinds } = registered
  const proj = state.components.proj
  const records = new Map(proj.records.map(record => [record.id, record]))
  const ownerOf = new Map<string, NodeType>()
  for (const type of nodeTypes) for (const operation of type.claimed?.operations ?? []) ownerOf.set(operation, type)
  const isClaimed = (record: ProjectRecord): record is OperationRecord => record.operation !== null && ownerOf.has(record.operation)
  const flagsOf = (record: ProjectRecord | null): NodeFlags => ({
    stale: record !== null && proj.stale[record.id] !== undefined,
    rendering: record !== null && (record.status === 'pending' || record.status === 'running'),
    failed: record?.status === 'failed',
    superseded: record !== null && proj.superseded[record.id] !== undefined,
  })
  const chains = anchorChains(records, chainAnchors)
  const current = currentRecords(state, isClaimed, chains, recordsInUse.flatMap(descriptor => descriptor.uses(state)))
  const currentList = proj.records.filter((record): record is OperationRecord => isClaimed(record) && current.has(record.id))
  const versions = versionsOf(currentList, record => chains.anchored(record))
  const base = { state, operations, language, placed }
  const slice: CanvasNode[] = []
  const claimed: ClaimedCanvasNode[] = []
  const standIns: CanvasNode[] = []
  for (const nodeType of nodeTypes) {
    const mine = currentList.filter(record => ownerOf.get(record.operation) === nodeType)
      .map((record): ClaimedRecord => ({ record, chain: chains.anchored(record), version: versions.get(record.id) ?? null }))
    const nodes = nodesOf<keyof NodeDataMap>(nodeType, { ...base, records: mine }, flagsOf)
    slice.push(...nodes.slice)
    standIns.push(...nodes.standIns)
    claimed.push(...nodes.claimed)
  }
  claimed.sort((a, b) => currentList.indexOf(a.record) - currentList.indexOf(b.record))
  const owner = new Map<string, string>()
  const own = (entry: CanvasNode): void => { for (const asset of entry.assets) if (!owner.has(asset)) owner.set(asset, entry.id) }
  slice.forEach(own)
  const sliceIds = new Set(slice.map(entry => entry.id))
  for (const kind of versionKinds) {
    for (const { id, version } of kind.latest(state)) {
      const item = kind.node(id)
      if (!sliceIds.has(item)) continue
      for (let earlier = 1; earlier < version; earlier++) {
        for (const asset of kind.assets(state, id, earlier)) if (!owner.has(asset)) owner.set(asset, item)
      }
    }
  }
  claimed.forEach(own)
  const kept = standIns.filter((entry) => {
    if (entry.assets.some(asset => owner.has(asset))) return false
    own(entry)
    return true
  })
  const nodes = [...slice, ...claimed, ...kept]
  const byId = new Map(nodes.map(entry => [entry.id, entry]))
  const recordNode = new Map(claimed.map(entry => [entry.id, entry.id]))
  /** The node an asset comes from: its owner, else the nearest drawn claimed record up its producer chain. */
  const nodeOfAsset = (assetId: string | null, depth = 0): string | null => {
    if (assetId === null) return null
    const mine = owner.get(assetId)
    if (mine !== undefined) return mine
    const producer = proj.created_by[assetId]
    if (producer === undefined || depth > 16) return null
    const drawn = recordNode.get(producer)
    if (drawn !== undefined) return drawn
    const produced = records.get(producer)
    // A claimed record that is not current has no node to stand for its assets.
    if (produced !== undefined && isClaimed(produced)) return null
    const source = produced?.inputs.find(input => input.resolved_asset !== null)?.resolved_asset
    return source === undefined || source === null ? null : nodeOfAsset(source, depth + 1)
  }
  const links: EdgeLink[] = []
  const seen = new Set<string>()
  const addEdge = (from: string | null | undefined, target: CanvasNode, edge: Omit<CanvasEdge, 'from' | 'to'>): void => {
    const source = byId.get(from ?? '')
    if (source === undefined || source === target || seen.has(`${source.id}>${target.id}`)) return
    seen.add(`${source.id}>${target.id}`)
    links.push({ source, target, edge: { from: source.id, to: target.id, ...edge } })
  }
  for (const entry of claimed) {
    const record = entry.record
    for (const input of record.inputs) {
      const named = versionRefOf(input.ref)
      const item = named === null ? undefined : versionKinds.find(kind => kind.kind === named.kind)?.node(named.id)
      addEdge(item !== undefined && byId.has(item) ? item : nodeOfAsset(input.resolved_asset), entry, { kind: 'input', role: input.role })
    }
    if (entry.chain !== null) addEdge(entry.chain.anchor, entry, { kind: 'chain' })
    if (record.based_on !== null) addEdge(recordNode.get(record.based_on), entry, { kind: 'lineage' })
  }
  for (const { asset, label } of recordsInUse.flatMap(descriptor => descriptor.badges?.(state) ?? [])) {
    const badged = byId.get(nodeOfAsset(asset) ?? '')
    if (badged !== undefined && !badged.badges.includes(label)) badged.badges.push(label)
  }
  layout([...slice, ...inChainOrder(claimed), ...kept], links)
  const assetNodes: Record<string, string> = {}
  for (const asset of state.assets) {
    const shown = nodeOfAsset(asset.id)
    if (shown !== null && byId.has(shown)) assetNodes[asset.id] = shown
  }
  return { nodes, edges: links.map(link => link.edge), links, assetNodes }
}

/**
 * The order in which the layout places the claimed nodes: by the anchor of their chain in first-record order (a node
 * without a chain is its own group at its own record), then slot (null last), then lane in first-record order, then
 * record order. Version numbers and slot frames read the record order, so the order goes to the layout in a copy.
 * @param claimed - the drawn claimed nodes, in record order.
 * @returns a copy of the claimed nodes in that order.
 */
function inChainOrder(claimed: readonly ClaimedCanvasNode[]): ClaimedCanvasNode[] {
  /** The index of the first node whose key equals the key of `entry`. */
  const firstOf = (key: (entry: ClaimedCanvasNode) => string) => (entry: ClaimedCanvasNode): number =>
    claimed.findIndex(other => key(other) === key(entry))
  const anchor = firstOf(entry => entry.chain?.anchor ?? entry.id)
  const lane = firstOf(entry => entry.chain?.lane ?? '')
  const keyed = claimed.map(entry => ({
    entry, anchor: anchor(entry), slot: entry.chain?.slot ?? Number.MAX_SAFE_INTEGER, lane: lane(entry),
  }))
  // The sort is stable, so nodes with equal keys keep their record order.
  return keyed.toSorted((a, b) => a.anchor - b.anchor || a.slot - b.slot || a.lane - b.lane).map(each => each.entry)
}

/**
 * Assign default positions in place. Each column wraps into several sub-columns once it holds more nodes than the
 * shared row count, so a long shot list forms a block that fits the screen. A rerun sits right after its source.
 * @param nodes - the nodes.
 * @param links - the edges with the nodes they leave, read for `deepenOn` depth and rerun columns.
 */
function layout(nodes: CanvasNode[], links: readonly EdgeLink[]): void {
  const column = new Map<string, number>()
  const incoming = (id: string, match: (edge: CanvasEdge) => boolean): CanvasNode[] =>
    links.filter(link => link.edge.to === id && match(link.edge)).map(link => link.source)
  const columnOf = (entry: CanvasNode, depth = 0): number => {
    const known = column.get(entry.id)
    if (known !== undefined) return known
    let value = entry.nodeType.column
    if (depth < 64) {
      const base = incoming(entry.id, edge => edge.kind === 'lineage')[0]
      if (base !== undefined) value = columnOf(base, depth + 1)
      else {
        const roles = entry.nodeType.deepenOn ?? []
        for (const source of incoming(entry.id, edge => edge.kind === 'input' && roles.some(role => role === edge.role))) {
          value = Math.max(value, columnOf(source, depth + 1) + 1)
        }
      }
    }
    column.set(entry.id, value)
    return value
  }
  const columns = new Map<number, CanvasNode[]>()
  for (const entry of nodes) columns.set(columnOf(entry), [...columns.get(columnOf(entry)) ?? [], entry])
  const baseOf = new Map(links.filter(link => link.edge.kind === 'lineage').map(link => [link.edge.to, link.source.id]))
  const tallest = Math.max(0, ...[...columns.values()].map(members => members.length))
  // About 1.5 rows per sub-column keeps a wrapped block close to the shape of a landscape screen.
  const rowsPer = Math.max(4, Math.ceil(Math.sqrt(tallest * 1.5)))
  let x = 0
  for (const [, members] of [...columns].sort(([a], [b]) => a - b)) {
    const ordered: CanvasNode[] = []
    const place = (entry: CanvasNode): void => {
      if (ordered.includes(entry)) return
      ordered.push(entry)
      for (const other of members) if (baseOf.get(other.id) === entry.id) place(other)
    }
    for (const entry of members) if (!members.some(other => other.id === baseOf.get(entry.id))) place(entry)
    for (const entry of members) place(entry)
    ordered.forEach((entry, index) => {
      entry.x = x + Math.floor(index / rowsPer) * COLUMN
      entry.y = (index % rowsPer) * ROW
    })
    x += Math.ceil(ordered.length / rowsPer) * COLUMN
  }
}

/**
 * The asset that stands for a node in small views: its `preview`, else its first asset.
 * @param entry - the node.
 * @returns the asset ID, or null for a node without assets.
 */
export function previewOf(entry: Pick<NodeEntry, 'preview' | 'assets'>): string | null {
  return entry.preview ?? entry.assets[0] ?? null
}

/** The frame of one grid slot: the anchored node that fills it and its preview asset. */
export interface SlotFrame {
  node: string
  preview: string
}

/**
 * The frame of each slot of a node's frame grid: the newest done claimed node whose anchored chain hangs off that node
 * with that slot (a rerun has the chain of its root) and that has a preview.
 * @param nodes - the drawn nodes, claimed nodes in record order.
 * @param nodeId - the node of the grid, such as `plan:p1`.
 * @param slots - the number of slots.
 * @returns one frame per slot, null for a slot without one.
 */
export function slotFrames(nodes: readonly CanvasNode[], nodeId: string, slots: number): Array<SlotFrame | null> {
  return Array.from({ length: slots }, (_unused, index) => {
    const filled = nodes.findLast(entry => entry.claimed && entry.record.status === 'done' && entry.chain?.anchor === nodeId
      && entry.chain.slot === index + 1 && previewOf(entry) !== null)
    const preview = filled === undefined ? null : previewOf(filled)
    return filled === undefined || preview === null ? null : { node: filled.id, preview }
  })
}

/**
 * Whether a node counts as a finished result that the user has not seen until its editor opens: a claimed node that is
 * not rendering and has an output.
 * @param entry - the node.
 * @returns whether the unseen dot applies.
 */
export function isFinished(entry: Pick<CanvasNode, 'claimed' | 'flags' | 'assets'>): boolean {
  return entry.claimed && !entry.flags.rendering && entry.assets.length > 0
}

/** The least space between two node cards that {@link freePositions} keeps, in canvas units. */
const NODE_GAP = 12

/**
 * Positions for the nodes that have no stored position: each node's automatic position, moved down one row at a time
 * until its card overlaps neither a stored node nor a node placed before it. A node that appears later therefore never
 * covers a node that the user moved.
 * @param nodes - the graph's nodes, in graph order.
 * @param stored - the stored positions by node ID.
 * @param heightOf - a node's card height in canvas units.
 * @returns the positions of the nodes that had none, by node ID.
 */
export function freePositions(
  nodes: readonly CanvasNode[], stored: Readonly<Record<string, NodePosition>>, heightOf: (entry: CanvasNode) => number,
): Record<string, NodePosition> {
  const boxes = nodes.flatMap((entry) => {
    const at = stored[entry.id]
    return at === undefined ? [] : [{ ...at, height: heightOf(entry) }]
  })
  const placed: Record<string, NodePosition> = {}
  for (const entry of nodes) {
    if (stored[entry.id] !== undefined) continue
    const height = heightOf(entry)
    let y = entry.y
    const overlaps = (box: { x: number; y: number; height: number }): boolean =>
      box.x < entry.x + NODE_WIDTH + NODE_GAP && entry.x < box.x + NODE_WIDTH + NODE_GAP
      && box.y < y + height + NODE_GAP && y < box.y + box.height + NODE_GAP
    while (boxes.some(overlaps)) y += ROW
    placed[entry.id] = { x: entry.x, y }
    boxes.push({ x: entry.x, y, height })
  }
  return placed
}
