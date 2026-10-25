/**
 * The JSON the browser receives from `@dv/api`, as plain structural types: host packages cannot be imported into a
 * browser bundle, so the browser keeps its own copy of the field names. A type that copies a registry type of
 * `@dv/project` has the registry name; a shape that only the wire has carries the prefix `Wire`. A plugin's slice type
 * comes from the client face `./types` of its host package, and the plugin's UI half merges it into `ComponentStates`.
 *
 * @module @dv/ui-kit/types
 */

/** Who caused a record. */
export type Actor = 'user' | 'agent' | 'system'

/** Where the action that caused a record came from. */
export type Surface = 'chat' | 'canvas' | 'timeline' | 'asset_pool' | 'api' | 'history'

/** The state of an operation call. */
export type RecordStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

/** One version of a reference kind, such as `{ prop: 'p1', version: 2 }`: the kind's key with the ID, and `version`. */
export type WireVersionRef = { version: number } & { [kind: string]: string | number }

/**
 * What one record input refers to: an asset, the n-th output of an earlier record, or one version of a reference kind.
 * Read it with `versionRefOf` and `formatInputRef` of `@dv/ui-kit/references.ts`.
 */
export type WireInputRef = { asset: string } | { record: string; output: number } | WireVersionRef

/** One input of a record: what the operation read. */
export interface RecordInput {
  role: string
  ref: WireInputRef
  /** The asset the input stood for when the operation ran; null while its producer has not finished. */
  resolved_asset: string | null
}

/** The cost of one operation call. */
export interface RecordCost {
  wall_seconds: number
  /** Whether the outputs were reused from an earlier identical deterministic call. */
  reused: boolean
}

/** Why a call failed or was cancelled. */
export interface RecordFailure {
  code: string
  message: string
}

/** The record whose execute started a call, the position it gave the call (or null), and its parallel sequence. */
export interface WireStartedBy {
  record: string
  slot: number | null
  lane?: string
}

/** One record of a project in its current form: one operation call. */
export interface ProjectRecord {
  id: string
  parents: string[]
  kind: 'operation'
  /** The component key that owns the operation, for example `timeline`. */
  component: string
  /** The operation name, for example `shot.render`. */
  operation: string | null
  operation_version: string | null
  actor: Actor
  surface: Surface
  /** The agent turn; null for direct human actions. */
  turn: string | null
  /** The chat session of the action; null outside any chat session. */
  session: string | null
  tool_call: string | null
  intent: string
  params: Record<string, unknown>
  inputs: RecordInput[]
  outputs: string[]
  /** The record this one repeats with changes, such as a take with an edited prompt; null when none. */
  based_on: string | null
  /** The record whose execute started this call; absent on a record that no record started. */
  started_by?: WireStartedBy
  supersedes: string[]
  deterministic: boolean
  status: RecordStatus
  created_at: string
  started_at?: string
  finished_at?: string
  error?: RecordFailure
  cost?: RecordCost
  report?: Record<string, unknown>
}

/** A project's identity, as `project.json` stores it. */
export interface ProjectInfo {
  id: string
  title: string
  created_at: string
}

/** One stored asset of the asset pool. */
export interface Asset {
  id: string
  mime: string
  name: string
  size_bytes: number
  /** The record that created the asset; null for an imported file. */
  created_by: string | null
  created_at: string
  width: number | null
  height: number | null
  duration_sec: number | null
}

/**
 * An asset as one project sees it: `name` and `created_at` are the project's own import name and time, and `made_by`
 * is the operation of the current-state record that created it, else `asset.import` for an asset the project imported
 * anywhere in its history, else null.
 */
export interface ProjectAsset extends Asset {
  made_by: string | null
}

/** The state slices of the components the browser reads, sent verbatim by the server. */
export interface ComponentStates {
  proj: {
    /** The records of the effective chain, oldest first. */
    records: ProjectRecord[]
    /** Stale records: record → the record whose change made it stale. */
    stale: Record<string, string>
    /** Superseded records: record → the record that superseded it. */
    superseded: Record<string, string>
    /** The record that created each output asset. */
    created_by: Record<string, string>
  }
  /** The assets on the canvas, in the order they were placed. */
  asset: { placed: string[] }
  /**
   * The slice of any other loaded component. A UI half whose host package has a client face merges the slice type of
   * that face here; any other UI half narrows its own slice with a guard.
   */
  [key: string]: unknown
}

/** The slices of one wire state: `proj` and `asset` always (the `@dv/api` plugin injects `dvProject` and `dvAssetPool`
 *  in `static inject` of `DvApi`); any other slice only while the server loads the plugin that owns it. */
export type WireComponents = Pick<ComponentStates, 'proj' | 'asset'> & Partial<ComponentStates>

/** The project's current state, with the assets the views need beside it. */
export interface WireState {
  project: ProjectInfo
  /** The current position: the step whose state this is. */
  head: string
  /** The last step of the history list; redo can move the current position up to it. */
  tip: string
  components: WireComponents
  /** Every asset of the current state, and every asset the project imported anywhere in its history. */
  assets: ProjectAsset[]
}

/** One property of an operation's parameter schema, in the DSH parameter format. */
export interface WireParamSpec {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object' | 'json'
  required?: boolean
  description?: string
  title?: string
  default?: unknown
  enum?: readonly unknown[]
  items?: WireParamSpec
  properties?: Record<string, WireParamSpec>
  oneOf?: readonly WireParamSpec[]
}

/** An operation declaration, as `GET /api/dv/operations` lists it. */
export interface WireOperation {
  name: string
  version: string
  description: string
  /** The name that views show for the operation; absent when the operation declares none. */
  label?: { zh: string; en: string }
  inputs: Record<string, { type: string; description: string; required?: boolean; many?: boolean; versioned?: boolean }>
  params: Record<string, WireParamSpec>
  outputs: Array<{ role: string; type: string }>
  deterministic: boolean
  resource: 'none' | 'cpu' | 'gpu'
  confirm: 'never' | 'always'
}

/** A project row. */
export interface WireProject {
  id: string
  title: string
  created_at: string
  /** Whether the chat session the view sits beside is bound to this project. */
  current?: boolean
}

/** The media a project card shows as its cover, with its MIME type: a video, whose first frame the card shows, or an image. */
export interface WireProjectCover {
  asset: string
  mime: string
}

/**
 * What a project card shows besides the title, as `GET /api/dv/projects/summary` lists it. A project whose state the
 * server could not read arrives with `cover` and `edited_at` null.
 */
export interface WireProjectSummary {
  project: string
  /**
   * The first clip with media on the requested timeline, else on the first timeline; else the first image output of a
   * finished record; null when the project has neither.
   */
  cover: WireProjectCover | null
  /** When the project's last record was written, ISO-8601; null without records. */
  edited_at: string | null
}

/**
 * What narrows one project's summary in `GET /api/dv/projects/summary`: `timeline`, the timeline whose first clip is the
 * cover when the project has it. It is a type alias so that a record of string fields, such as the shell's center
 * fields, is assignable to it.
 */
export type SummaryQuery = { readonly timeline?: string }

/** The last step of the history list and the current position, as undo and redo answer them. */
export interface WireLine {
  tip: string
  at: string
}

/** One project change, as the event stream sends it: an appended record, a record update, or a move of the position. */
export type ProjectEvent =
  | { kind: 'record'; record: ProjectRecord }
  | { kind: 'update'; record: ProjectRecord }
  | ({ kind: 'line' } & WireLine)

/** One entry of the history list: one step and where it stands relative to the current position. */
export interface HistoryEntry {
  record: ProjectRecord
  /** `current` for the current position, `before` for a step before it, `after` for a step redo brings back. */
  place: 'before' | 'current' | 'after'
}

/** What `POST /api/dv/history` selects (the JSON body). Every filter is optional; filters combine with AND. */
export interface HistoryQuery {
  project: string
  actor?: Actor
  /** A component key, such as `timeline`. */
  component?: string
  operation?: string
  kind?: ProjectRecord['kind']
  status?: RecordStatus
  session?: string
  turn?: string
  /** Only records written by this tool call. */
  tool_call?: string
  /** Only these records. */
  records?: string[]
  /** Only records written before this record, for paging. */
  before?: string
  /** At most this many entries: 1 to 200; the server's default is 50. */
  limit?: number
}

/** The `POST /api/dv/history` answer. */
export interface WireHistory {
  /** The entries, newest first. */
  entries: HistoryEntry[]
  /** Every asset that the entries name as an output or a resolved input. */
  assets: Asset[]
}

/** What a view sends to run an operation as the human. */
export interface OperationRequest {
  project: string
  operation: string
  /** Inputs with `ref` as reference text: `<asset>`, `<record>#<output>`, or `<id>@<version>`. */
  inputs?: Array<{ role: string; ref: string }>
  params?: Record<string, unknown>
  intent?: string
  surface: 'canvas' | 'timeline' | 'asset_pool'
  /** The chat session the view sits beside, recorded as the record's `session`. */
  session?: string
  based_on?: string
  supersedes?: string[]
}

/** What `POST /api/dv/operation/check` answers: the refusal that `run` would give now. */
export interface OperationCheck {
  /** The refusal sentence, verbatim; empty when the call can run. */
  problems: string[]
}

/** One entry of `GET /api/dv/models`, as the agent tool `dv_models_get` returns it. */
export interface WireModelEntry {
  modality: string
  task: string
  provider: string
  model: string
  description: string
  /** The entry's `schema()`, whose fields its primitive owns; null when the backend cannot be reached. */
  schema: unknown
}

/** Where a canvas node sits, in canvas units. */
export interface NodePosition {
  x: number
  y: number
}

/** The canvas pan offset, in screen pixels, and zoom. */
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/** A project's stored canvas layout: node positions keyed by canvas node ID, and the viewport. */
export interface CanvasLayout {
  positions: Record<string, NodePosition>
  viewport: CanvasViewport | null
}

/** One project as `GET /api/dv/workspaces` lists it. */
export interface WireProjectLink {
  id: string
  title: string
  created_at: string
  /** The project's directory, which is its Workspace's directory. */
  path: string
  /** The recorded Workspace, or null before one was created. */
  workspace_id: string | null
}

/** The `GET /api/dv/workspaces` answer. */
export interface WireWorkspaces {
  entry_path: string
  projects: WireProjectLink[]
  /** Saved chat session → project bindings. */
  bindings: Record<string, string>
}

/** One saved chat session of a project, as `GET /api/dv/workspaces/sessions` lists it. */
export interface WireSession {
  session: string
  /** When the session log last changed, ISO-8601 UTC. */
  updated_at: string
  bytes: number
}
