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

/**
 * One citation of a prompt, as the kernel's parser reads it; its input binding is derived from the call's inputs, never
 * stored.
 */
export interface ReferenceAtom {
  readonly label: string
  readonly uri: string
}

/**
 * The document of one call: the prompt, whose citations are its atoms, and the call's inputs in their stored order. For
 * every stored call `c`, the call of `c`'s document deep-equals `c`.
 */
export interface PromptDocument {
  readonly prompt: string
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
  /** False for a reference that the selected model cannot take: a media type it does not take, or past its count. */
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
  /** Open the host's asset picker; `done` receives the picked input reference texts. A host without one offers no add. */
  readonly pickAssets?: (chosen: readonly string[], done: (refs: string[]) => void) => void
  /**
   * Import local files into the project as the user. Resolves with the asset IDs that the host imported, in file
   * order; the host shows a refused import itself. A host without it offers no upload.
   */
  readonly importFiles?: (files: readonly File[]) => Promise<string[]>
  /** Open the host's preview of an asset, growing out of `opener`. */
  preview(asset: string, opener: Element | null): void
  /** Open the editor of a canvas node. */
  openNode(nodeId: string): void
}

/** Owner props of one `dv.prompt` occurrence: JSON values and callbacks. */
export interface DvPromptProps {
  readonly projectId: string
  readonly call: PromptCall
  /** The project state that the host draws; the tray, the chips and the edits resolve every reference against it. */
  readonly state: WireState
  /** The operation declarations that the host reads; the composer finds the call's operation among them. */
  readonly operations: readonly WireOperation[]
  readonly readOnly: boolean
  readonly host: PromptHost
  /** Send the edited call; absent in read mode. The caller decides what a send does, such as a rerun with `based_on`. */
  readonly onSubmit?: (call: PromptCall) => Promise<void>
}

/** One chip of the parameter bar; the descriptor gives data, and the composer draws every chip with one component. */
export type ParamChip = {
  /** The param key. */
  readonly key: string
  /** The name that the chip shows beside its control. */
  readonly label: Text
} & (
  | {
    /** A menu of choices. */
    readonly kind: 'menu'
    /** The display text of the current value, such as `16:9`. */
    readonly value: string
    /** The choices; each choice is the patch it applies to the params. */
    readonly options: ReadonlyArray<{ readonly label: string; readonly patch: Readonly<Record<string, unknown>> }>
  }
  | {
    /** A text field; the param's declaration types its text, such as a number or JSON, and an empty text unsets it. */
    readonly kind: 'text'
    /** The text of the current value. */
    readonly value: string
    /** The text the empty field shows, such as 随机 / random for a seed. */
    readonly placeholder?: Text
  }
  | {
    /** A checkbox of a boolean param. */
    readonly kind: 'toggle'
    readonly checked: boolean
  }
)

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

/**
 * The parameter bar of one operation, registered by the UI half of the plugin that owns the operation; the generation
 * kit `@dv/ui-generation` registers one for each operation of a kind, from the kind's declaration.
 */
export interface ParamBar {
  readonly operation: string
  /** The registering package, which a refused second bar of the operation names. */
  readonly owner: string
  /**
   * The chips of a call under a model's schema, whose fields that plugin owns; each replaces the declared param's chip of
   * its key. Absent, the declared params' chips show.
   */
  chips?(input: {
    readonly schema: unknown
    readonly params: Readonly<Record<string, unknown>>
    readonly operation: WireOperation
  }): ParamChip[]
  /** The `@` filter of a model, read from the same schema; null, or absent, for no filter, such as an unknown schema. */
  candidates?(schema: unknown): CandidateFilter | null
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
  /** The input's index when the edit removed it, after the removals of the same edit that came before it. */
  readonly index: number
  /** The edit that removed it; the inputs of one edit come back together. */
  readonly step: number
}

/**
 * The apply-world face of the `dv.prompt` Factory: the `/api/dv` check route, and live data in the hooks compartment.
 * The component resolves the references of a call against the state that its host lends and the version kinds.
 */
export interface DvPromptInjected {
  readonly check: (request: OperationRequest) => Promise<OperationCheck>
  readonly hooks: {
    /** The model catalog; null until it loads, and loaded again when an occurrence opens while none is open. */
    readonly models: HostObservable<readonly WireModelEntry[] | null>
    /** The parameter bars that plugins registered, `dvComposer.paramBars`. */
    readonly paramBars: HostObservable<readonly ParamBar[]>
    /** The version kinds that the canvas holds, which read the versions of the elements that chips cite. */
    readonly versionKinds: HostObservable<readonly VersionKind[]>
  }
}

/**
 * What the face of one chip of a `dv.prompt` occurrence draws, as the occurrence resolved it against the state that its
 * host lends. A type alias, so that it is JSON.
 */
export type ChipFace = {
  /** The asset that the chip previews; null for a role chip and for a citation that resolves to no asset. */
  readonly preview: { readonly id: string; readonly mime: string; readonly name: string } | null
  /** The version that the call sends; null for an asset, a role, and an element that no input satisfies. */
  readonly sent: number | null
  /** False when no input of the call satisfies the citation. */
  readonly satisfied: boolean
}

/** The face context that a `dv.prompt` occurrence gives its chips: the face of each citation URI of its prompt. */
export type PromptFaceContext = {
  readonly faces: Readonly<Record<string, ChipFace>>
}

/** The apply-world face of the chip face entry: live data only. */
export interface ReferenceFaceInjected {
  readonly hooks: {
    /** The project the shell has open, for chat chips. */
    readonly currentProject: HostObservable<string | null>
    /** The version kinds that resolve the element of a chat chip. */
    readonly versionKinds: HostObservable<readonly VersionKind[]>
  }
  readonly keyedHooks: {
    /** The live state of a project that a chat chip reads; null until it loads. */
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
