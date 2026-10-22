/**
 * The canvas node contract: the node types, chain anchors, records in use, version kinds and node actions that plugins
 * register in `ctx.dvCanvas`, the owner props of the card and editor bodies, and the `dv.canvas` Component Factory with
 * its keyed child slots. The canvas draws every node through this contract and names no node type. Types only.
 *
 * @module @dv/ui-canvas/contract
 */
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import type { Registry, VersionKind } from '@dv/ui-kit/registries.ts'
import type { Asset, OperationRequest, ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'

/** The fields every node type has. */
interface NodeTypeCore {
  /** The registering package; a refused key names it. One package may register several types. */
  id: string
  /** The `data-node-type` value, a registry key, and the key of its `dv.canvas.card` and `dv.canvas.editor` entries. */
  type: string
  /** The type label in the interface language: the editor header and the accessible names. */
  label(): string
  /**
   * A slot of the theme's node palette, `var(--dv-node-1)` to `var(--dv-node-8)` of `@dv/ui-shell`: the type dot and
   * every edge that leaves a node of this type.
   */
  color: string
  /** The default layout column. */
  column: number
  /**
   * Input roles that push a node one column right of the node it reads them from, such as ['first_frame'] for a video
   * take that continues the previous shot. Absent means none.
   */
  deepenOn?: readonly string[]
}

/**
 * How a type draws the current records of its operations. The canvas builds each claimed node itself: `id` is the
 * record ID, `record` the record, `assets` its outputs, and its edges are the record's inputs, its chain and its
 * `based_on`; so a claimed node cannot disagree with its record.
 */
export interface ClaimedNodes {
  /** One registry key `op:<operation>` per name, so two types never claim one operation. */
  operations: readonly string[]
  /** The words that the chrome draws over the body of a running node and in the row of a failed node. */
  status: NodeStatusText
  /** The parts of one claimed node that vary by type. A pending record draws before it has outputs. */
  entry(claimed: ClaimedRecord, input: NodeInput): ClaimedEntry
}

/** What a type supplies for one claimed node. */
export type ClaimedEntry = Pick<NodeEntry, 'title' | 'bodyHeight'> & Partial<Pick<NodeEntry, 'meta' | 'preview'>>

/** The nodes that a type reads from its own slice, such as nouns and plans. Pure. */
export type SliceEntries = (input: Omit<NodeInput, 'records'>) => NodeEntry[]

/**
 * One type of canvas node. Registry `dvCanvas.nodeTypes`, keyed by `type` and by `op:<operation>` for each claimed
 * operation. A type has claimed nodes, slice nodes, or both; the union refuses a type with neither.
 */
export type NodeType = NodeTypeCore & (
  | { claimed: ClaimedNodes; entries?: SliceEntries }
  | { claimed?: never; entries: SliceEntries }
)

/** The status words of a type's claimed nodes in the interface language. */
export interface NodeStatusText {
  /** While the record is pending or running, such as 渲染中…. */
  running(): string
  failed(): string
}

/** What the canvas hands a type. */
export interface NodeInput {
  state: WireState
  operations: readonly WireOperation[]
  language: DvLanguage
  /** The assets on the project's canvas list, with this view's placements in flight. */
  placed: ReadonlySet<string>
  /** The current records that this type claims, in log order. */
  records: readonly ClaimedRecord[]
}

/** A record of an operation call: a record whose operation a node type can claim. */
export type OperationRecord = ProjectRecord & { operation: string }

/** One claimed record of the current state, with the lineage that the canvas derived. */
export interface ClaimedRecord {
  record: OperationRecord
  /** The anchored chain (the record's `started_by`, else its `based_on` root's, resolved by a `ChainAnchor`), or null. */
  chain: AnchoredChain | null
  /**
   * The 1-based number in its group when the group has several records: records linked by `based_on` are one group,
   * else records of one anchor, slot and lane; null for a record alone in its group.
   */
  version: number | null
}

/** The anchored chain of a record: the record that started it, the node that it hangs off, its slot and lane. */
export interface AnchoredChain {
  starter: string
  /** The node ID that the chain hangs off, such as 'plan:p1'. */
  anchor: string
  slot: number | null
  lane?: string
}

/** One node. Optional fields are set by the few types that need them. */
export interface NodeEntry {
  /** Stable: other plugins name it (a `ChainAnchor` returns 'plan:<id>'); positions and the unseen set store it. */
  id: string
  /** The accessible name, the chrome title and the text of the canvas's write intents. */
  title: string
  /** Text right of the title in the chrome header, such as '2.0s', drawn in the mono style. */
  meta?: string
  /** The record behind the shown state: flags, focus. */
  record: ProjectRecord | null
  /** Records of earlier versions; a focus on one opens this node, and none draws a node of its own. */
  records?: readonly string[]
  /** Assets that belong to this node: input edges from them start here, badges land here, a drop moves it. */
  assets: readonly string[]
  /** A stand-in draws only when no other node owns one of its assets; of two stand-ins for one asset, the first. */
  standIn?: true
  /** One of `assets` that stands for the node in small views, such as a frame of its anchor's grid; default `assets[0]`. */
  preview?: string
  /** A frame grid of n slots that the canvas fills with the previews of the nodes anchored here by slot. */
  slots?: number
  /**
   * The body height at base text size. The canvas computes the card height as chrome header + frame grid (when a slot
   * has a frame) + `bodyHeight`, before mount, for the free positions, the edge anchors and the fit; a failed claimed
   * node is the chrome header plus the chrome's failed row instead.
   */
  bodyHeight: number
  /** The kernel reference that this node stands for in a prompt, when it is not its record. */
  ref?: { kind: string; id: string }
}

/** Display states of a node, read from its record. */
export interface NodeFlags { stale: boolean; rendering: boolean; failed: boolean; superseded: boolean }

/**
 * A node as its card, its editor and an action receive it. JSON data only. A claimed node is built from its record, so
 * `record` is that record.
 */
export type NodeView = NodeEntry & ({ claimed: true; record: OperationRecord } | { claimed: false }) & {
  /** Its `NodeType.type`. */
  type: string
  flags: NodeFlags
  /** Labels that `RecordsInUse.badges` reports for the node's assets, such as 已裁剪. */
  badges: readonly string[]
  chain: AnchoredChain | null
  version: number | null
  /** A finished claimed node that the user has not opened; the chrome draws the unseen dot. */
  unseen: boolean
  /** True while a `rerun` that this node started waits for its new node. */
  rerunning: boolean
}
/** A claimed node as the editor of its type's claimed nodes and an action on it receive it. */
export type ClaimedNodeView = Extract<NodeView, { claimed: true }>

/** A write that the canvas completes with its project, chat session and surface. */
export type CanvasRequest = Omit<OperationRequest, 'project' | 'surface' | 'session'>

/** A canvas write whose record is `based_on` the record of the node that runs it. */
export type RerunRequest = CanvasRequest & { based_on: string }

/**
 * What the canvas lends a node action, on every surface that draws it. The canvas shows the error of a refused write
 * in its notice, over any open editor.
 */
export interface NodeHost {
  /** Run an operation as a canvas write (project, chat session, surface 'canvas'). */
  run(request: CanvasRequest): void
  /** Run an operation again; once its node appears, the canvas closes the editor and selects and centers that node. */
  rerun(request: RerunRequest): void
  /** The asset preview of `dvMedia`, growing out of `opener`. */
  preview(asset: string, opener: Element | null): void
  /**
   * What reference text names, read through the registered version kinds: for `<id>@<version>`, the name of that
   * version, its first reference asset and the item's node; for an asset ID, the asset's name and the asset.
   */
  reference(ref: string): ReferenceFacts
  /** Open another node's editor over this one, which keeps its unsaved changes. */
  openNode(nodeId: string): void
  /** Put an asset on the project's canvas list or take it off, at once in this view. */
  setPlaced(asset: string, on: boolean): void
  /** Close the editor and clear the selection. */
  close(): void
}

/** What the canvas lends a card body: the writes of the node host. */
export type CardHost = Pick<NodeHost, 'run' | 'rerun'>

/** What the canvas lends an editor body: the node host with the editor's asset picker, and a rerun that it awaits. */
export interface EditorHost extends Omit<NodeHost, 'rerun'> {
  /**
   * As `NodeHost.rerun`, and the body shows a refusal itself: settles once the new node appears, rejects with the error
   * of a refused request or once a later rerun replaces this one, and the canvas shows neither.
   */
  rerun(request: RerunRequest): Promise<void>
  /** The editor's asset picker; `versions: true` adds the sections of the registered version kinds. */
  pickAssets(chosen: readonly string[], options: { versions: boolean }, onConfirm: (refs: string[]) => void): void
}

/** What one reference of an input names, for its chip. */
export interface ReferenceFacts {
  name: string
  /** The wire asset that shows the reference, or null. */
  asset: Asset | null
  /** The node of the versioned item that the reference names, or null for an asset. */
  node: string | null
}

/** The node that the records started by one operation hang off. */
export interface ChainAnchor {
  /** The operation of a starting record. */
  starter: string
  /** The node ID that the records it started hang off, such as 'plan:p1'. */
  anchor(starter: ProjectRecord): string
  /** The approved versions of the node, read from the workflow's own slice. */
  approvedVersions?(state: WireState, anchorId: string): number[]
}

/** Records whose outputs a plugin's data uses. */
export interface RecordsInUse {
  /** The registering package. */
  id: string
  /** Record IDs whose outputs the plugin's data uses; the canvas keeps the claimed record behind each one current. */
  uses(state: WireState): string[]
  /** Labels on the node that owns an asset, such as the trim badge of a timeline clip. */
  badges?(state: WireState): Array<{ asset: string; label: string }>
}

/**
 * One command on a node, drawn by the canvas in the toolbar over the selected node, in the editor header, and in the
 * failed row of a failed claimed node. `shows` alone decides where it applies, and it narrows the node that `run`
 * receives to `N`.
 */
export interface NodeAction<N extends NodeView = NodeView> {
  /** Unique, such as '@dv/ui-image-upscale:upscale'; the owner is the part before ':'. */
  id: string
  label(): string
  order: number
  /** Whether it shows for one node, such as "a failed claimed node" or "shows an image asset". */
  shows(node: NodeView, assets: ReadonlyMap<string, Asset>): node is N
  /** Runs only on a node for which `shows` returned true. */
  run(node: N, host: NodeHost): void
}

/** The registries of the canvas, provided by `@dv/ui-canvas` as `ctx.dvCanvas`. */
export interface DvCanvas {
  /** Keyed by `type` and by `op:<operation>` per claimed operation. */
  nodeTypes: Registry<NodeType>
  /** Keyed by `starter`. */
  chainAnchors: Registry<ChainAnchor>
  /** Keyed by `id`. */
  recordsInUse: Registry<RecordsInUse>
  /** Keyed by `kind`. */
  versionKinds: Registry<VersionKind>
  /** Keyed by `id`. */
  actions: Registry<NodeAction>
}

/**
 * Owner props of a card body, which draws media or content only. The chrome draws the ring, the header (dot, `title`,
 * `meta`, unseen dot, stale tag), the status words over the body, the failed row with the actions that show on it,
 * the badges, and the frame grid of a node with `slots`.
 */
export interface CardOwner {
  node: NodeView
  /** The wire asset of each of the node's assets, so the body can draw them through `dv.media`. */
  assets: Readonly<Record<string, Asset>>
  /** The text enlargement at low zoom, so a body's text matches the chrome's. */
  textScale: number
  host: CardHost
}

/** Owner props of an editor body; the canvas draws the editor shell around it. */
export interface EditorOwner<N extends NodeView = NodeView> {
  node: N
  state: WireState
  operations: readonly WireOperation[]
  host: EditorHost
}

/** Owner props of the asset pool panel inside the canvas's picker. */
export interface PickerOwner {
  projectId: string
  session: string | null
  /** Toggle an asset in the picker. */
  onOpen(asset: Asset): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { dvCanvas: DvCanvas }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The body of one node's card inside the canvas chrome, keyed by `NodeType.type`; fallback: the type label. */
    'dv.canvas.card': { kind: 'keyed'; scope: 'root'; owner: CardOwner }
    /** The editor body of the nodes of one node type that it does not claim, keyed by `NodeType.type`; fallback: none. */
    'dv.canvas.editor': { kind: 'keyed'; scope: 'root'; owner: EditorOwner }
    /** The editor body of the claimed nodes of one node type, keyed by `NodeType.type`; fallback: none. */
    'dv.canvas.editor.claimed': { kind: 'keyed'; scope: 'root'; owner: EditorOwner<ClaimedNodeView> }
    /** The asset pool in the canvas's picker, at key 'assets'. */
    'dv.canvas.picker': { kind: 'keyed'; scope: 'root'; owner: PickerOwner }
  }
}
