/**
 * The canvas node contract: the `ctx.dvCanvas` registries that plugins fill and the keyed child slots of the
 * `dv.canvas` Component Factory with their owner props. The canvas draws every node through this contract and names
 * no node type. Types only.
 *
 * @module @dv/ui-canvas/contract
 */
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import type { Registry, VersionKind } from '@dv/ui-kit/registries.ts'
import type { Asset, OperationRequest, ProjectRecord, WireCanvasNode, WireOperation, WireState } from '@dv/ui-kit/types.ts'

/**
 * One type of canvas node: how the canvas draws the nodes of one kind of the canvas's node list. Registry
 * `dvCanvas.nodeTypes`, keyed by `type`, the node type key that the host producer registers the kind under.
 */
export interface NodeType {
  /** The registering package; a refused key names it. One package may register several types. */
  id: string
  /** The node type key: the `kind` of the nodes it draws, the `data-node-type` value, and the key of its slot entries. */
  type: string
  /** The type label in the interface language: the editor header and the accessible names. */
  label(): string
  /**
   * A slot of the theme's node palette, `var(--dv-node-1)` to `var(--dv-node-8)` of `@dv/ui-shell`: the color of every
   * edge that leaves a node of this type.
   */
  color: string
  /** The words that the canvas draws over the body of a running node and inside the frame of a failed node. */
  status?: NodeStatusText
  /** The parts of one node that vary by type, from the node and one of its versions; a pending version has no outputs. */
  entry(node: NodeInput): TypeEntry
  /**
   * What a double click on a node of this type does in place of opening the floating editor, such as showing the
   * timeline view of a timeline node; absent opens the editor.
   */
  open?(node: NodeView): void
}

/** What a type supplies for one node at one version. */
export interface TypeEntry {
  /** The accessible name, the caption title and the text of the canvas's write intents. */
  title: string
  /** Text right of the title in the caption, such as '2.0s', drawn in the mono style. */
  meta?: string
  /** Assets that belong to the node: input edges from them start here, badges land here; default the version's outputs. */
  assets?: readonly string[]
  /** One of `assets` that stands for the node in small views; default `assets[0]`. */
  preview?: string
  /** The node's sizing, for the default size of a node without a stored size and the limits of a resize. */
  sizing: NodeSizing
  /** The kernel reference that this node stands for in a prompt, when it is not its record. */
  ref?: { kind: string; id: string }
  /**
   * What the node uses without owning it, such as the clips and sounds of a timeline: assets, and records whose outputs
   * it waits for. The canvas draws an edge from the node of each to this node, and while this node is selected it
   * outlines those nodes.
   */
  uses?: { assets: readonly string[]; records: readonly string[] }
}

/** The status words of a type's nodes in the interface language. */
export interface NodeStatusText {
  /** While the record is pending or running, such as 渲染中…. */
  running(): string
  failed(): string
}

/** What the canvas hands a type for one node. */
export interface NodeInput {
  /** The node's ID in the canvas's node list. */
  id: string
  node: WireCanvasNode
  /** The version to draw: the newest on the card, any version in the editor's version strip. */
  record: OperationRecord
  state: WireState
  operations: readonly WireOperation[]
  language: DvLanguage
}

/** A record of an operation call: a record that a canvas node can show. */
export type OperationRecord = ProjectRecord & { operation: string }

/** A box size in canvas units. */
export type Size = { width: number; height: number }

/**
 * How the canvas sizes a node, declared by the type from the node's own data. A size is the node's frame box in canvas
 * units; the caption above the frame is not part of it. The canvas takes `defaultSize` for a node that has no size yet
 * and keeps a node at or above `minSize`. A window node shows more or less of its body as its frame changes; a media
 * node shows a picture that scales with its frame, so its frame keeps height = width / `aspectRatio.ratio` +
 * `aspectRatio.fixedHeight`, where `fixedHeight` is the height of the fixed bars outside the picture (0 for none).
 */
export type NodeSizing =
  | { kind: 'window'; defaultSize: Size; minSize: Size }
  | { kind: 'media'; defaultSize: Size; minSize: Size; aspectRatio: { ratio: number; fixedHeight: number } }

/** One drawn node: the type's entry with the facts of the node list. */
export interface NodeEntry extends Omit<TypeEntry, 'assets'> {
  /** The node ID of the canvas's node list: other plugins name it, and `canvas.node_position` moves it. */
  id: string
  assets: readonly string[]
  /** The version on show; the card always shows the newest. */
  record: OperationRecord
  /** The node's versions, oldest first. */
  versions: readonly string[]
}

/** Display states of a node, read from its record. */
export interface NodeFlags { stale: boolean; rendering: boolean; failed: boolean; superseded: boolean }

/** A node as its card, its editor and an action receive it. JSON data only. */
export type NodeView = NodeEntry & {
  /** Its `NodeType.type`, the node's kind. */
  type: string
  flags: NodeFlags
  /** Labels that `RecordsInUse.badges` reports for the node's assets, such as 已裁剪. */
  badges: readonly string[]
  /** A finished newest version that the user has not opened; the caption shows the unseen dot. */
  unseen: boolean
  /** True while a `rerun` that this node started waits for its new version. */
  rerunning: boolean
}

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
  /** Run an operation again; once its version joins the node, the canvas closes the editor and selects and centers the node. */
  rerun(request: RerunRequest): void
  /** The asset preview of `dvMedia`, growing out of `opener`. */
  preview(asset: string, opener: Element | null): void
  /** Open another node's editor over this one, which keeps its unsaved changes. */
  openNode(nodeId: string): void
  /** Close the editor and clear the selection. */
  close(): void
}

/** What the canvas lends a card body: the writes of the node host. */
export type CardHost = Pick<NodeHost, 'run' | 'rerun'>

/**
 * What the canvas lends an editor body: the node host with the editor's asset picker and file import, and a rerun that
 * it awaits.
 */
export interface EditorHost extends Omit<NodeHost, 'rerun'> {
  /**
   * As `NodeHost.rerun`, and the body shows a refusal itself: settles once the new version appears or once a later rerun
   * replaces this one, rejects with the error of a refused request, and the canvas shows no refusal.
   */
  rerun(request: RerunRequest): Promise<void>
  /** The editor's asset picker; `versions: true` adds the sections of the registered version kinds. */
  pickAssets(chosen: readonly string[], options: { versions: boolean }, onConfirm: (refs: string[]) => void): void
  /**
   * Import local files into the project as canvas imports, which also put each asset on the canvas, one after another.
   * Resolves with the asset IDs of the imported files in file order; a refused import stops the imports and shows the
   * canvas's error notice.
   */
  importFiles(files: readonly File[]): Promise<string[]>
}

/** Records whose outputs a plugin's data uses. */
export interface RecordsInUse {
  /** The registering package. */
  id: string
  /** Record IDs whose outputs the plugin's data uses. */
  uses(state: WireState): string[]
  /** Labels on the node that owns an asset, such as the trim badge of a timeline clip. */
  badges?(state: WireState): Array<{ asset: string; label: string }>
}

/**
 * One section of the canvas's 添加 / Add menu: what a plugin can put on the canvas, such as the project's timelines.
 * Registry `dvCanvas.addMenu`, keyed by `id`.
 */
export interface AddMenuSection {
  /** The registering package; a refused key names it. */
  id: string
  /** Sections show in ascending order. */
  order: number
  /** The section heading in the interface language. */
  label(): string
  /** The items of one project state, top first; an empty list shows the section with the canvas's empty words. */
  items(state: WireState): AddMenuItem[]
}

/** One item of an {@link AddMenuSection}. */
export interface AddMenuItem {
  /** Unique within its section. */
  key: string
  label: string
  /** The node that already shows the item, which the canvas selects and centers instead of writing; null for none. */
  node: string | null
  /** The write that puts the item on the canvas; the canvas selects and centers the node of its record once it appears. */
  request: CanvasRequest
}

/**
 * One command on a node, drawn by the canvas in the editor header and inside the frame of a node whose newest version failed.
 * `shows` alone decides where it applies, and it narrows the node that `run` receives to `N`.
 */
export interface NodeAction<N extends NodeView = NodeView> {
  /** Unique, such as '@dv/ui-image-upscale:upscale'; the owner is the part before ':'. */
  id: string
  label(): string
  order: number
  /** Whether it shows for one node, such as "a node whose version failed" or "shows an image asset". */
  shows(node: NodeView, assets: ReadonlyMap<string, Asset>): node is N
  /** Runs only on a node for which `shows` returned true. */
  run(node: N, host: NodeHost): void
}

/** The registries of the canvas, provided by `@dv/ui-canvas` as `ctx.dvCanvas`. */
export interface DvCanvas {
  /** Keyed by `type`. */
  nodeTypes: Registry<NodeType>
  /** Keyed by `id`. */
  recordsInUse: Registry<RecordsInUse>
  /** Keyed by `kind`. */
  versionKinds: Registry<VersionKind>
  /** Keyed by `id`. */
  actions: Registry<NodeAction>
  /** Keyed by `id`. */
  addMenu: Registry<AddMenuSection>
}

/**
 * Owner props of a card body, which owns the inside of the node's frame and paints its own fill: a card-like body
 * paints `CARD_SURFACE` of `@dv/ui-kit/frame.ts`, and a body that shows a picture paints only the picture. A press on a
 * control of the body (a button, an input, a select, a text area, a link, a slider, a menu, a dialog, or an element
 * marked `data-node-interactive`) selects the node without moving it and leaves the gesture to the body; a press
 * anywhere else in the body moves the node as on its caption. The canvas ignores a key from inside an element marked
 * `data-node-keys` and a key or right click whose default the body prevented; any other right click on the node opens
 * the node's menu. The canvas draws the caption above the frame (`title`, unseen dot, stale tag, `meta`), the frame
 * outline and selection ring, the status words over the body, the failed words with the actions that show on them in
 * place of the body, and the badges.
 */
export interface CardOwner {
  node: NodeView
  /** The project state the canvas draws, for a body that shows more than the node's assets. */
  state: WireState
  /** The chat session the canvas sits beside, for a body that writes on its own; null for none. */
  session: string | null
  /** Whether the node is selected; a video body plays while it is. */
  selected: boolean
  /**
   * While the node is selected, an empty element above its caption, as wide as its frame and in canvas units, into which
   * the body may render with a portal, such as a timeline's video; null otherwise.
   */
  above: HTMLElement | null
  /** The wire asset of each of the node's assets, so the body can draw them through `dv.media`. */
  assets: Readonly<Record<string, Asset>>
  /** The text enlargement at low zoom, so a body's text matches the caption's. */
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
    /** The inside of one node's frame, keyed by `NodeType.type`; fallback: the type label on the card surface. */
    'dv.canvas.card': { kind: 'keyed'; scope: 'root'; owner: CardOwner }
    /** The editor body of the nodes of one node type, keyed by `NodeType.type`; fallback: none. */
    'dv.canvas.editor': { kind: 'keyed'; scope: 'root'; owner: EditorOwner }
    /** The asset pool in the canvas's picker, at key 'assets'. */
    'dv.canvas.picker': { kind: 'keyed'; scope: 'root'; owner: PickerOwner }
  }
}
