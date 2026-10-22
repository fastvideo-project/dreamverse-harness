/**
 * The descriptor registries that plugin UI halves register into, as types and one factory. Each registry is a client
 * service that the UI-core package which reads it provides at its `apply` top level: `@dv/ui-canvas` provides `dvCanvas`,
 * whose node types, chain anchors, takes in use and version kinds describe the canvas nodes of plugin data. The History
 * rows are declared in `@dv/ui-history/contract`. A UI half registers inside `ctx.inject([<service>], …)` of `dvCanvas`
 * or `dvMentions` (`@dv/ui-composer`) and keeps its disposers.
 *
 * @module @dv/ui-kit/registries
 */
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { DvClient } from './api.ts'
import type { Asset, OperationRequest, ProjectRecord, WireState } from './types.ts'

/** A list of descriptors that plugins add and remove, with one owner per key. */
export interface Registry<D> {
  /** Throws on a key that another descriptor already holds. */
  register(descriptor: D): () => void
  /** The same array until a change. */
  list(): readonly D[]
  subscribe(listener: () => void): () => void
}

/**
 * Create an empty registry.
 * @param keys - the keys a descriptor holds; two descriptors never share one.
 * @returns the registry.
 */
export function createRegistry<D>(keys: (descriptor: D) => readonly string[]): Registry<D> {
  let items: readonly D[] = []
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of [...listeners]) listener() }
  return {
    register(descriptor) {
      const taken = new Set(items.flatMap(keys))
      const clash = keys(descriptor).find(key => taken.has(key))
      if (clash !== undefined) throw new Error(`registry key "${clash}" is already registered`)
      items = [...items, descriptor]
      notify()
      return () => {
        if (!items.includes(descriptor)) return
        items = items.filter(item => item !== descriptor)
        notify()
      }
    },
    list: () => items,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** The registries of the canvas, provided by `@dv/ui-canvas` as `ctx.dvCanvas`. */
export interface DvCanvas {
  /** Keyed by `id`. */
  nodeTypes: Registry<NodeType>
  /** Keyed by `starter`. */
  chainAnchors: Registry<ChainAnchor>
  /** Keyed by `id`. */
  takesInUse: Registry<TakesInUse>
  /** Keyed by `kind`. */
  versionKinds: Registry<VersionKind>
}

/** The canvas node that the records started by one operation hang off. */
export interface ChainAnchor {
  /** The operation of a starting record. */
  starter: string
  /** The node ID that the records it started hang off, such as 'plan:p1'. */
  anchor(starter: ProjectRecord): string
  /** The approved versions of the node, read from the workflow's own slice. */
  approvedVersions?(state: WireState, anchorId: string): number[]
}

/** One type of canvas node that a plugin draws from its own slice. */
export interface NodeType {
  /** Package name; also the key of its 'dv.canvas.editor' slot entry. */
  id: string
  /** The data-node-type value, such as 'character' or 'plan'. */
  type: string
  /** The type label of the default card. */
  label(): string
  color: string
  /** Default layout column: character 0, plan 1; takes start at 2. */
  column: number
  /** Reads only its own slice. */
  entries(state: WireState): NodeEntry[]
}

/** One node that a `NodeType` draws. */
export interface NodeEntry {
  id: string
  /** The record that wrote the shown version. */
  record: ProjectRecord | null
  /** Records that wrote earlier versions; a history focus on one centers this node. */
  records?: readonly string[]
  title: string
  subtitle?: string
  /** Assets the node shows; no asset node draws them again. */
  media: string[]
  /** A frame grid of n slots, which the core fills from anchored takes by chain slot. */
  slots?: number
}

/** The generation records whose outputs a plugin's data uses. */
export interface TakesInUse {
  id: string
  /** Record IDs whose outputs the plugin's data uses (timeline clips, character and plan references). */
  uses(state: WireState): string[]
  /** Labels on the node of an asset, such as the trim badge of a clip. */
  badges?(state: WireState): Array<{ asset: string; label: string }>
}

/** How the canvas reads the versions of one reference kind of the kernel. */
export interface VersionKind {
  /** A reference kind of the kernel, such as 'character'. */
  kind: string
  /** The section title of the kind's items in the asset picker, such as 角色. */
  label(): string
  /** The canvas node ID of an item, such as 'character:c1'. */
  node(id: string): string
  /** Every item at its newest version. */
  latest(state: WireState): Array<{ id: string; version: number }>
  name(state: WireState, id: string, version: number): string | null
  /** The reference assets of the version, in order. */
  assets(state: WireState, id: string, version: number): string[]
}

/** What the canvas lends the `dv.canvas.editor` entry of a node entry: its writes, its asset picker and its asset preview. */
export interface EntryEditorHost {
  /** Run an operation as a canvas write, with the canvas's project and chat session; the canvas shows a failure. */
  run(request: Omit<OperationRequest, 'project' | 'surface' | 'session'>): void
  /** Open the canvas's asset picker of assets only; `onConfirm` receives the picked asset IDs in pick order. */
  pickAssets(chosen: readonly string[], onConfirm: (assets: string[]) => void): void
  /** Open the asset preview of `dvMedia` (`@dv/ui-media`), growing out of `opener` and shrinking back into it. */
  preview(asset: string, opener: Element | null): void
}

/** The registry of the `@` menu, which `@dv/ui-composer` provides as `ctx.dvMentions`; `kinds` is keyed by `id`. */
export interface DvMentions { kinds: Registry<MentionKind> }
/** One kind of project item that the `@` menu lists, read from its plugin's own slice. */
export interface MentionKind {
  id: string
  /** The kind of the inserted address `dv:<kind>/<id>`. */
  kind: string
  /** Section order in the `@` menu; the core lists assets last. */
  order: number
  section(): string
  /** The items of a state; `thumb` is the asset whose media type's poster the menu shows as the icon. */
  items(state: WireState): Array<{ uri: string; label: string; description?: string; thumb?: string }>
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    dvCanvas: DvCanvas
    dvMentions: DvMentions
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The editor body of the nodes of one `NodeType`, keyed by its `id`; `@dv/ui-canvas` renders it in a node's editor. */
    'dv.canvas.editor': { kind: 'keyed'; scope: 'root'; owner: { node: NodeEntry; state: WireState; host: EntryEditorHost } }
    /** The asset pool panel in the canvas's asset picker; `@dv/ui-canvas` renders the entry at key 'assets' below the version kinds. */
    'dv.canvas.picker': { kind: 'keyed'; scope: 'root'; owner: { projectId: string; session: string | null; client: DvClient; onOpen(asset: Asset): void } }
  }
}
