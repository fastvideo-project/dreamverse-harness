/**
 * The types of the DreamVerse prompt composer, `@dv/ui-composer/contract`: the call that a `dv.prompt` occurrence
 * edits, what the host lends it, the reference view that a chip or a tray tile draws, the parameter bar descriptor
 * with its copy, and the `dv.prompt` Factory. A plugin reaches the Factory with a bare `import type {}` of this entry.
 * Types only.
 *
 * @module @dv/ui-composer/contract
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { Registry, VersionKind } from '@dv/ui-kit/registries.ts'
import type { OperationCheck, OperationRequest, ProjectAsset, WireModelEntry, WireOperation, WireState } from '@dv/ui-kit/types.ts'

/** A pair of interface texts, Chinese then English. */
export type Text = readonly [zh: string, en: string]

/** One input of a call in request form: a role and its input reference text. A version that fans out is one input. */
export interface CallInput {
  readonly role: string
  readonly ref: string
}

/** The generation request that a `dv.prompt` occurrence edits. */
export interface PromptCall {
  readonly operation: string
  /** Every param of the call; `params.prompt` is the prompt with its citations. */
  readonly params: Readonly<Record<string, unknown>>
  readonly inputs: readonly CallInput[]
}

/** A run of plain text in a prompt document. */
export interface TextRun {
  readonly text: string
}

/** One citation chip of a prompt document; its input binding is derived from the call's inputs, never stored. */
export interface ReferenceAtom {
  readonly label: string
  readonly uri: string
}

/**
 * The document of one call: the prompt as text runs and atoms, and the call's inputs in their stored order. For every
 * stored call `c`, the call of `c`'s document deep-equals `c`.
 */
export interface PromptDocument {
  readonly runs: ReadonlyArray<TextRun | ReferenceAtom>
  readonly inputs: readonly CallInput[]
}

/** What a chip or a tray tile draws for one reference. */
export interface ReferenceView {
  readonly uri: string
  readonly label: string
  /** The call input that holds the reference; null for a chat chip. */
  readonly input: CallInput | null
  /** What the reference stands for, in order; a version fans out to its assets. */
  readonly assets: readonly ProjectAsset[]
  /** The asset the preview draws; null for a role chip such as a chained first frame. */
  readonly preview: ProjectAsset | null
  /** What a click opens: the node of an element, or the preview of an asset. */
  readonly open: { readonly node: string } | { readonly asset: string } | null
  /** False when no input of the call satisfies the citation; the host then refuses the call. */
  readonly satisfied: boolean
  /** False for a reference that the selected model cannot take: a media type it does not take. */
  readonly fits: boolean
  /** The version the call sends and the newest version; null for assets, roles and chat chips. */
  readonly version: { readonly sent: number; readonly newest: number } | null
}

/** The `@` filter of the selected model: the media types and the count that its `reference` input takes. */
export interface CandidateFilter {
  /** Media types such as the MIME top-level types; empty means the model takes no reference and `@` offers nothing. */
  readonly mediaTypes: readonly string[]
  readonly maxReferences: number | null
}

/** What the host of an occurrence lends it. */
export interface PromptHost {
  /** Open the host's asset picker; `done` receives the picked input reference texts. */
  pickAssets(chosen: readonly string[], done: (refs: string[]) => void): void
  /** Open the host's preview of an asset, growing out of `opener`. */
  preview(asset: string, opener: Element | null): void
  /** Open the editor of a canvas node. */
  openNode(nodeId: string): void
}

/** Owner props of one `dv.prompt` occurrence: JSON values and callbacks. */
export interface DvPromptProps {
  readonly projectId: string
  readonly call: PromptCall
  readonly readOnly: boolean
  readonly host: PromptHost
  /** Send the edited call; absent in read mode. The caller decides what a send does, such as a rerun with `based_on`. */
  readonly onSubmit?: (call: PromptCall) => Promise<void>
}

/** One chip of the parameter bar; the descriptor gives data, and the composer draws every chip with one component. */
export interface ParamChip {
  /** The param key. */
  readonly key: string
  readonly label: Text
  /** The display text, such as `16:9`. */
  readonly value: string
  /** The choices; each choice is the patch it applies to the params. */
  readonly options: ReadonlyArray<{ readonly label: string; readonly patch: Readonly<Record<string, unknown>> }>
}

/**
 * The words of an occurrence that name what its operation makes. Each absent text keeps the composer's neutral one,
 * which names no kind.
 */
export interface PromptCopy {
  /** The prompt editor's placeholder text. */
  readonly placeholder?: Text
  /** The send button. */
  readonly send?: Text
  /** The send button while a send runs. */
  readonly sending?: Text
}

/** The parameter bar of one operation, registered by the UI half of the plugin that owns the operation. */
export interface ParamBar {
  readonly operation: string
  /** The registering package, which a refused second bar of the operation names. */
  readonly owner: string
  /** The chips of a call under a model's schema, whose fields that plugin owns. */
  chips(input: {
    readonly schema: unknown
    readonly params: Readonly<Record<string, unknown>>
    readonly operation: WireOperation
  }): ParamChip[]
  /** The `@` filter of a model, read from the same schema. */
  candidates(schema: unknown): CandidateFilter
  /** The words of the operation's occurrences. */
  readonly copy?: PromptCopy
}

/** The registries of the composer, provided by `@dv/ui-composer` as `ctx.dvComposer`. */
export interface DvComposer {
  /** Keyed by `operation`. */
  readonly paramBars: Registry<ParamBar>
}

/** One tile of the reference tray: an input of the call, its view, and whether an atom of the prompt cites it. */
export interface TrayEntry {
  readonly input: CallInput
  readonly view: ReferenceView
  readonly cited: boolean
}

/** An input that an edit removed, kept so that the editor's undo of that edit brings it back to its place. */
export interface RemovedInput {
  readonly uri: string
  readonly input: CallInput
  readonly index: number
}

/**
 * The apply-world face of the `dv.prompt` Factory: callbacks over the registered version kinds and the `/api/dv`
 * routes, and live data in the hooks compartments. The component passes the state it reads from `useProjectState`.
 */
export interface DvPromptInjected {
  /** The views of every atom of a document, and the tray of its inputs, in document order. */
  readonly views: (state: WireState, document: PromptDocument, filter: CandidateFilter | null) => {
    readonly atoms: readonly ReferenceView[]
    readonly tray: readonly TrayEntry[]
  }
  /** Bring a document in step with the editor's runs: R3′ for deleted atoms, R1 or an undone removal for new ones. */
  readonly reconcile: (
    state: WireState, document: PromptDocument, runs: PromptDocument['runs'], removed: readonly RemovedInput[],
  ) => { readonly document: PromptDocument; readonly removed: readonly RemovedInput[] }
  /** R2: remove one input; the atoms only it satisfied turn into their labels. */
  readonly removeInput: (state: WireState, document: PromptDocument, index: number) => {
    readonly document: PromptDocument
    readonly removed: readonly RemovedInput[]
  }
  /** The parameter bar that a plugin registered for an operation, else null. */
  readonly bar: (operation: string) => ParamBar | null
  readonly check: (request: OperationRequest) => Promise<OperationCheck>
  readonly hooks: {
    /** The model catalog; empty until it loads. */
    readonly models: HostObservable<readonly WireModelEntry[]>
    /** The operation declarations; empty until they load. */
    readonly operations: HostObservable<readonly WireOperation[]>
    /** The version kinds the views read; a component reads it so it draws again when a kind registers. */
    readonly versionKinds: HostObservable<readonly VersionKind[]>
  }
  readonly keyedHooks: {
    /** The live state of a project; null until it loads. */
    readonly projectState: (projectId: string) => HostObservable<WireState | null>
  }
}

/** The face context that a `dv.prompt` occurrence gives each of its chips: its project and the call's inputs. */
export interface PromptFaceContext {
  readonly projectId: string
  readonly inputs: readonly CallInput[]
  readonly filter: CandidateFilter | null
}

/** The apply-world face of the chip face entry. */
export interface ReferenceFaceInjected {
  /** The view of one atom; `context` null is a chat chip, which names the newest version. */
  readonly view: (state: WireState, atom: ReferenceAtom, context: PromptFaceContext | null) => ReferenceView
  readonly hooks: {
    /** The project the shell has open, for chat chips. */
    readonly currentProject: HostObservable<string | null>
    /** The version kinds the view reads. */
    readonly versionKinds: HostObservable<readonly VersionKind[]>
  }
  readonly keyedHooks: {
    readonly projectState: (projectId: string) => HostObservable<WireState | null>
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** The DreamVerse composer: the reference tray, the prompt editor, the parameter bar, the cost and send, over one call. */
    'dv.prompt': { scope: 'root'; props: DvPromptProps; inject: DvPromptInjected }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dvComposer: DvComposer
  }
}
