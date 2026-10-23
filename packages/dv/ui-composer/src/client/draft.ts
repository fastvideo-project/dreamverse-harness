/**
 * The draft of one `dv.prompt` occurrence: the document and the params that the user edits, the content that the
 * editor shows, and the check and the send of the edited call. Every change is one action of {@link reduceDraft}, so
 * an action that arrives late, such as a pick from the host's picker, applies to the draft as it is then.
 *
 * @module @dv/ui-composer/draft
 */
import type { PromptChangeCause, PromptChip, PromptContent } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { fieldsOf, valueOf } from '@dv/ui-kit/form.ts'
import type { OperationCheck, WireOperation } from '@dv/ui-kit/types.ts'
import type { PromptCall, PromptDocument, RemovedInput } from './contract/index.ts'
import { MENTION_SOURCE } from './mention.ts'
import { atomsOf, documentOf, editorContent, pinVersion, reconcile, removeInput, type ResolveContext } from './reference-model.ts'

/** What one occurrence holds between renders. */
export interface Draft {
  /** The call that the host lent, as JSON; another call starts the occurrence over. */
  readonly callKey: string
  readonly document: PromptDocument
  /** The inputs that edits removed, kept so that the editor's undo of an edit brings its input back. */
  readonly removed: readonly RemovedInput[]
  /** What the editor shows; a new revision replaces the editor's content. */
  readonly content: PromptContent
  readonly params: Readonly<Record<string, unknown>>
  /** The answer of the check of the edited call; null until it answers. */
  readonly checked: OperationCheck | null
  readonly sending: boolean
}

/** One change of a draft. */
export type DraftAction =
  | { readonly type: 'callLent'; readonly call: PromptCall }
  | {
    readonly type: 'editorChanged'
    readonly text: string
    /** The number of chips that the editor holds. */
    readonly chips: number
    readonly cause: PromptChangeCause
    readonly ctx: ResolveContext
  }
  | { readonly type: 'tileRemoved'; readonly index: number; readonly ctx: ResolveContext }
  | { readonly type: 'picked'; readonly refs: readonly string[] }
  | { readonly type: 'imported'; readonly assets: readonly string[] }
  | { readonly type: 'pinned'; readonly index: number; readonly version: number }
  | { readonly type: 'patched'; readonly patch: Readonly<Record<string, unknown>> }
  | { readonly type: 'typed'; readonly operation: WireOperation; readonly key: string; readonly text: string }
  | { readonly type: 'checked'; readonly answer: OperationCheck }
  | { readonly type: 'sending'; readonly sending: boolean }

/** The editor content of a document at one revision, with every chip owned by the `@` source. */
function contentOf(document: PromptDocument, revision: number, history: PromptContent['history']): PromptContent {
  const content = editorContent(document)
  const chips: PromptChip[] = content.chips.map(chip => ({ source: MENTION_SOURCE, ...chip, clipboardText: chip.ref }))
  return { revision, history, text: content.text, chips }
}

/**
 * The draft of a call that the host lends.
 * @param call - the call.
 * @returns the draft, with the editor's first content.
 */
export function draftOf(call: PromptCall): Draft {
  const document = documentOf(call)
  return {
    callKey: JSON.stringify(call), document, removed: [], content: contentOf(document, 0, 'reset'), params: call.params,
    checked: null, sending: false,
  }
}

/** The params with one free-text chip's text, typed by the param's declaration; text that does not parse stays out. */
function withText(
  params: Readonly<Record<string, unknown>>, operation: WireOperation, key: string, text: string,
): Readonly<Record<string, unknown>> {
  const field = fieldsOf(operation.params, {}).find(candidate => candidate.key === key)
  if (field === undefined) return params
  let value: unknown
  try {
    value = valueOf({ ...field, text })
  } catch (unparsed) {
    // A text the param's type cannot take keeps the previous value; the check route names the problem of a bad value.
    void unparsed
    return params
  }
  const { [key]: _old, ...rest } = params
  return value === undefined ? rest : { ...rest, [key]: value }
}

/**
 * Apply one action to a draft.
 * @param draft - the draft.
 * @param action - the action.
 * @returns the next draft.
 */
export function reduceDraft(draft: Draft, action: DraftAction): Draft {
  const { document } = draft
  switch (action.type) {
    case 'callLent': {
      // Another call starts the editor's history over, so an undo cannot bring back the call it replaced.
      const next = draftOf(action.call)
      return { ...next, content: { ...next.content, revision: draft.content.revision + 1 } }
    }
    case 'editorChanged': {
      const next = reconcile(document, action.text, draft.removed, { ...action.ctx, inputs: document.inputs }, action.cause)
      // A citation that a paste or typing brought in as text becomes a chip inside that edit's undo step, so the editor
      // shows a chip for every citation that the kernel reads.
      const content = atomsOf(action.text).length > action.chips ? contentOf(next.document, draft.content.revision + 1, 'merge') : draft.content
      return { ...draft, document: next.document, removed: next.removed, content }
    }
    case 'tileRemoved': {
      const next = removeInput(document, action.index, { ...action.ctx, inputs: document.inputs })
      // A removal that turns chips into text changes the prompt, so the editor takes it as one undoable step; any other
      // removal leaves the editor as it is.
      const content = next.removed.length === 0 ? draft.content : contentOf(next.document, draft.content.revision + 1, 'step')
      return { ...draft, document: next.document, removed: [...draft.removed, ...next.removed], content }
    }
    case 'picked': {
      const added = action.refs.filter(ref => !document.inputs.some(input => input.ref === ref)).map(ref => ({ role: 'reference', ref }))
      return { ...draft, document: { ...document, inputs: [...document.inputs, ...added] } }
    }
    case 'imported':
      return { ...draft, document: { ...document, inputs: [...document.inputs, ...action.assets.map(ref => ({ role: 'reference', ref }))] } }
    case 'pinned':
      return { ...draft, document: pinVersion(document, action.index, action.version) }
    case 'patched':
      return { ...draft, params: { ...draft.params, ...action.patch } }
    case 'typed':
      return { ...draft, params: withText(draft.params, action.operation, action.key, action.text) }
    case 'checked':
      return { ...draft, checked: action.answer }
    case 'sending':
      return { ...draft, sending: action.sending }
  }
}
