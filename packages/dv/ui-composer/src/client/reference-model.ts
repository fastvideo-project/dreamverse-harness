/**
 * The client reference model of a `dv.prompt` occurrence: the document of a call (the prompt, whose citations the
 * kernel's parser reads as atoms, with the call's inputs in their stored order), the host's rule for which inputs
 * satisfy a citation, the edits that keep every citation satisfied, and the view that a chip or a tray tile draws. The
 * grammars are the kernel's, read and written through `@dv/project/grammar`, so the client reads a citation wherever
 * the kernel reads one; the model names no reference kind, and reads elements through the version readers that the
 * kinds' plugins register.
 *
 * @module @dv/ui-composer/reference-model
 */
import {
  citationUri, citedAsset, citedElement, citedInput, formatInputSyntax, parsePromptCitations, splitInputRef,
} from '@dv/project/grammar'
import type { PromptChangeCause } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { ProjectAsset, WireState } from '@dv/ui-kit/types.ts'
import type {
  CallInput, CandidateFilter, ChipFace, PromptCall, PromptDocument, ReferenceAtom, ReferenceView, RemovedInput, TrayEntry,
} from './contract/index.ts'

/** The part of a version kind that the model reads. */
export type VersionReader = Pick<VersionKind, 'kind' | 'name' | 'assets' | 'latest' | 'node'>

/** What resolution reads: the state, the version readers, and the call's inputs (null in chat) and `@` filter. */
export interface ResolveContext {
  readonly state: WireState
  readonly versions: readonly VersionReader[]
  /** The inputs of the call; null in chat, where an element citation means the element's newest version. */
  readonly inputs: readonly CallInput[] | null
  readonly filter: CandidateFilter | null
}

/** One chip of the editor's content: its citation text, its label, and its clipboard offset and length. */
export interface EditorChip {
  readonly ref: string
  readonly label: string
  readonly offset: number
  readonly length: number
}

/**
 * The atoms of a prompt: one per citation that the kernel's parser reads, in prompt order.
 * @param prompt - the prompt.
 * @returns the atoms.
 */
export function atomsOf(prompt: string): ReferenceAtom[] {
  return parsePromptCitations(prompt).map(citation => ({ label: citation.label, uri: citation.uri }))
}

/**
 * The document of a stored call: the prompt as stored, and the inputs as stored.
 * @param call - the call.
 * @returns the document.
 */
export function documentOf(call: PromptCall): PromptDocument {
  return { prompt: typeof call.params['prompt'] === 'string' ? call.params['prompt'] : '', inputs: call.inputs }
}

/**
 * The call that a document stands for. For every stored call `c`, `callOf(documentOf(c), c)` deep-equals `c`.
 * @param document - the document.
 * @param base - the call it was made from; its operation and its other params stay.
 * @returns the call.
 */
export function callOf(document: PromptDocument, base: PromptCall): PromptCall {
  const { prompt } = document
  const params = prompt === '' && !('prompt' in base.params) ? base.params : { ...base.params, prompt }
  return { operation: base.operation, params, inputs: document.inputs }
}

/**
 * The editor content of a document: the prompt as clipboard text, and one chip per citation.
 * @param document - the document.
 * @returns the text and the chips in text order.
 */
export function editorContent(document: PromptDocument): { text: string; chips: EditorChip[] } {
  const { prompt } = document
  const chips = parsePromptCitations(prompt).map(citation => ({
    ref: prompt.slice(citation.start, citation.end), label: citation.label, offset: citation.start, length: citation.end - citation.start,
  }))
  return { text: prompt, chips }
}

/** The version reader of `kind`, or of any kind, that holds version `version` of `id`, with that version's name; else null. */
function versionOf(id: string, version: number, ctx: ResolveContext, kind?: string): { reader: VersionReader; name: string } | null {
  for (const reader of ctx.versions) {
    const name = kind === undefined || reader.kind === kind ? reader.name(ctx.state, id, version) : null
    if (name !== null) return { reader, name }
  }
  return null
}

/** The output assets of a record output reference. */
function recordOutput(record: string, output: number, state: WireState): string[] {
  const found = state.components.proj.records.find(candidate => candidate.id === record)?.outputs[output]
  return found === undefined ? [] : [found]
}

/**
 * The assets that one input stands for, in order.
 * @param input - the input.
 * @param ctx - the state and the version readers.
 * @returns the asset IDs; empty for an unknown version or a record output that does not exist yet.
 */
export function assetsOfInput(input: CallInput, ctx: ResolveContext): string[] {
  const syntax = splitInputRef(input.ref)
  if ('asset' in syntax) return [syntax.asset]
  if ('record' in syntax) return recordOutput(syntax.record, syntax.output, ctx.state)
  return versionOf(syntax.id, syntax.version, ctx)?.reader.assets(ctx.state, syntax.id, syntax.version) ?? []
}

/**
 * The indexes of the inputs that satisfy one citation, by the host's rule: an asset citation by a `reference` input
 * that stands for the asset, an element citation by a `reference` input that is a version of the element with at least
 * one asset, and an input citation by an input of that role other than `reference`.
 * @param uri - the citation's URI.
 * @param inputs - the call's inputs.
 * @param ctx - the state and the version readers.
 * @returns the indexes in input order.
 */
export function satisfyingIndexes(uri: string, inputs: readonly CallInput[], ctx: ResolveContext): number[] {
  const role = citedInput(uri)
  const asset = citedAsset(uri)
  const element = citedElement(uri)
  return inputs.flatMap((input, index) => {
    if (role !== null) return role !== 'reference' && input.role === role ? [index] : []
    if (input.role !== 'reference') return []
    if (asset !== null) return assetsOfInput(input, ctx).includes(asset) ? [index] : []
    if (element === null) return []
    const syntax = splitInputRef(input.ref)
    if (!('version' in syntax) || syntax.id !== element.id) return []
    // A version without assets expands to nothing in the kernel, which then refuses the citation.
    const found = versionOf(syntax.id, syntax.version, ctx, element.kind)
    return found !== null && found.reader.assets(ctx.state, syntax.id, syntax.version).length > 0 ? [index] : []
  })
}

/**
 * The input that a new atom adds when no input satisfies it: the asset itself, or the element at its newest version.
 * @param atom - the atom.
 * @param ctx - the state and the version readers.
 * @returns the input; null for a citation that no input can satisfy, such as an input role.
 */
export function inputForAtom(atom: ReferenceAtom, ctx: ResolveContext): CallInput | null {
  const asset = citedAsset(atom.uri)
  if (asset !== null) return { role: 'reference', ref: asset }
  const element = citedElement(atom.uri)
  const newest = element === null
    ? undefined
    : ctx.versions.find(reader => reader.kind === element.kind)?.latest(ctx.state).find(item => item.id === element.id)
  return newest === undefined ? null : { role: 'reference', ref: formatInputSyntax({ id: newest.id, version: newest.version }) }
}

/** The context of a document: its own inputs. */
function withInputs(ctx: ResolveContext, inputs: readonly CallInput[]): ResolveContext {
  return { ...ctx, inputs }
}

/**
 * R2. Remove one input; each atom that only this input satisfied becomes its label as plain text, so the sentence
 * still reads and the host accepts the call.
 * @param document - the document.
 * @param index - the index of the input.
 * @param ctx - the state and the version readers.
 * @param step - the step of this edit, from {@link nextStep}.
 * @returns the document, and the input as removed by each atom that turned into text.
 */
export function removeInput(
  document: PromptDocument, index: number, ctx: ResolveContext, step: number,
): { document: PromptDocument; removed: RemovedInput[] } {
  const input = document.inputs[index]
  if (input === undefined) return { document, removed: [] }
  const inputs = document.inputs.filter((_, at) => at !== index)
  const removed: RemovedInput[] = []
  let prompt = ''
  let last = 0
  for (const citation of parsePromptCitations(document.prompt)) {
    const before = satisfyingIndexes(citation.uri, document.inputs, withInputs(ctx, document.inputs))
    if (before.length !== 1 || before[0] !== index) continue
    prompt += document.prompt.slice(last, citation.start) + citation.label
    last = citation.end
    removed.push({ uri: citation.uri, input, index, step })
  }
  return { document: { prompt: prompt + document.prompt.slice(last), inputs }, removed }
}

/**
 * R3′. The inputs left after one atom with `uri` is deleted: each `reference` input that satisfied the deleted atom
 * goes when no remaining atom cites it. An input that no atom cited before stays, and so does every input of another
 * role, such as a first frame, which the call holds whatever its prompt cites.
 * @param inputs - the inputs before the delete.
 * @param uri - the deleted atom's URI.
 * @param remaining - the atoms left after the delete.
 * @param ctx - the state and the version readers.
 * @param step - the step of the edit that deletes the atom.
 * @returns the inputs, and the inputs that went in index order, each index counted after the removals before it.
 */
export function deleteAtom(
  inputs: readonly CallInput[], uri: string, remaining: readonly ReferenceAtom[], ctx: ResolveContext, step: number,
): { inputs: CallInput[]; removed: RemovedInput[] } {
  const own = withInputs(ctx, inputs)
  const satisfying = satisfyingIndexes(uri, inputs, own)
  const cited = new Set(remaining.flatMap(atom => satisfyingIndexes(atom.uri, inputs, own)))
  const going = inputs.flatMap((input, index) => input.role === 'reference' && satisfying.includes(index) && !cited.has(index) ? [index] : [])
  const removed = going.flatMap((index, order) => inputs.slice(index, index + 1).map(input => ({ uri, input, index: index - order, step })))
  return { inputs: inputs.filter((_, at) => !going.includes(at)), removed }
}

/**
 * The step of the next edit that removes inputs.
 * @param removed - the inputs that earlier edits removed.
 * @returns a step after every step of `removed`.
 */
export function nextStep(removed: readonly RemovedInput[]): number {
  return (removed.at(-1)?.step ?? 0) + 1
}

/**
 * The removed inputs that an undo or a redo brings back for atoms that come back: for each URI, the inputs that the
 * last edit to remove an input for it removed for it, each input once, in the order they were removed.
 */
function undone(removed: readonly RemovedInput[], uris: readonly string[]): RemovedInput[] {
  const steps = new Map(uris.flatMap((uri) => {
    const last = removed.findLast(entry => entry.uri === uri)
    return last === undefined ? [] : [[uri, last.step] as const]
  }))
  const back: RemovedInput[] = []
  for (const entry of removed) {
    if (steps.get(entry.uri) === entry.step && !back.some(other => other.input === entry.input)) back.push(entry)
  }
  return back
}

/** Each URI of a list of atoms, with its count and its first atom. */
function tally(atoms: readonly ReferenceAtom[]): Map<string, { count: number; atom: ReferenceAtom }> {
  const counts = new Map<string, { count: number; atom: ReferenceAtom }>()
  for (const atom of atoms) {
    const known = counts.get(atom.uri)
    counts.set(atom.uri, known === undefined ? { count: 1, atom } : { ...known, count: known.count + 1 })
  }
  return counts
}

/**
 * Bring a document in step with the editor's new prompt, whose citations the kernel's parser reads, whether a chip, a
 * paste or typing wrote them. A deleted atom removes its input by R3′. A new atom that no input satisfies adds its input
 * at the end (R1); when an undo or a redo brings the atom back, the input that an earlier edit removed for it comes back
 * at its old place instead. The other inputs keep their order.
 * @param previous - the document before the editor change.
 * @param prompt - the editor's clipboard text, which is the prompt.
 * @param removed - the inputs earlier edits removed.
 * @param ctx - the state and the version readers.
 * @param cause - `history` for an undo or a redo of the editor's history, else `edit`.
 * @returns the document and the removed inputs after the change.
 */
export function reconcile(
  previous: PromptDocument, prompt: string, removed: readonly RemovedInput[], ctx: ResolveContext, cause: PromptChangeCause,
): { document: PromptDocument; removed: RemovedInput[] } {
  const before = tally(atomsOf(previous.prompt))
  const remaining = atomsOf(prompt)
  const after = tally(remaining)
  let inputs = [...previous.inputs]
  let memo = [...removed]
  const step = nextStep(removed)
  for (const [uri, { count }] of before) {
    for (let gone = count - (after.get(uri)?.count ?? 0); gone > 0; gone -= 1) {
      const deleted = deleteAtom(inputs, uri, remaining, ctx, step)
      inputs = deleted.inputs
      memo = [...memo, ...deleted.removed]
    }
  }
  const added = [...after].filter(([uri, { count }]) => count > (before.get(uri)?.count ?? 0)
    && satisfyingIndexes(uri, inputs, withInputs(ctx, inputs)).length === 0)
  const back = cause === 'history' ? undone(memo, added.map(([uri]) => uri)) : []
  // Last removed first, so that each input goes back to the index it had before the removals that came after it.
  for (const entry of [...back].reverse()) inputs.splice(Math.min(entry.index, inputs.length), 0, entry.input)
  memo = memo.filter(entry => !back.some(other => other.input === entry.input))
  for (const [uri, { atom }] of added) {
    const input = back.some(entry => entry.uri === uri) ? null : inputForAtom(atom, ctx)
    if (input !== null) inputs = [...inputs, input]
  }
  return { document: { prompt, inputs }, removed: memo }
}

/**
 * R5′. Pin the version input at `index` to another version; every atom of that element follows, because an element
 * citation names no version.
 * @param document - the document.
 * @param index - the index of an `<id>@<version>` input.
 * @param version - the version to send.
 * @returns the document.
 */
export function pinVersion(document: PromptDocument, index: number, version: number): PromptDocument {
  const input = document.inputs[index]
  const syntax = input === undefined ? null : splitInputRef(input.ref)
  if (input === undefined || syntax === null || !('version' in syntax)) return document
  const pinned = { role: input.role, ref: formatInputSyntax({ id: syntax.id, version }) }
  const inputs = document.inputs.map((other, at) => at === index ? pinned : other)
  return { prompt: document.prompt, inputs }
}

/** The assets of a list of IDs that the state holds. */
function assetsIn(ids: readonly string[], state: WireState): ProjectAsset[] {
  return ids.flatMap(id => state.assets.find(asset => asset.id === id) ?? [])
}

/** Whether an asset's media type is one that the selected model takes. */
function fitsFilter(assets: readonly ProjectAsset[], filter: CandidateFilter | null): boolean {
  return filter === null || assets.every(asset => filter.mediaTypes.includes(mediaTypeOf(asset.mime)))
}

/** The view of an element at one version. */
function elementView(
  uri: string, label: string, reader: VersionReader, id: string, version: number, input: CallInput | null, ctx: ResolveContext,
): ReferenceView {
  const assets = assetsIn(reader.assets(ctx.state, id, version), ctx.state)
  const newest = reader.latest(ctx.state).find(item => item.id === id)?.version ?? version
  return {
    uri, label, input, assets, preview: assets[0] ?? null, open: { node: reader.node(id) }, satisfied: true,
    fits: fitsFilter(assets, ctx.filter), version: input === null ? null : { sent: version, newest },
  }
}

/**
 * The view of one atom. With a call, an element names the version of its satisfying input; in chat, its newest version.
 * @param atom - the atom.
 * @param ctx - the state, the readers, the call's inputs (null in chat) and the filter.
 * @returns the view; `satisfied` is false when the call's inputs do not satisfy the citation.
 */
export function resolveAtom(atom: ReferenceAtom, ctx: ResolveContext): ReferenceView {
  const satisfying = ctx.inputs === null ? [] : satisfyingIndexes(atom.uri, ctx.inputs, ctx)
  const input = ctx.inputs === null ? null : ctx.inputs[satisfying[0] ?? -1] ?? null
  const satisfied = ctx.inputs === null || satisfying.length > 0
  const unresolved: ReferenceView = {
    uri: atom.uri, label: atom.label, input, assets: [], preview: null, open: null, satisfied, fits: true, version: null,
  }
  const element = citedElement(atom.uri)
  if (element !== null) {
    const syntax = input === null ? null : splitInputRef(input.ref)
    const reader = ctx.versions.find(candidate => candidate.kind === element.kind)
    const version = syntax !== null && 'version' in syntax
      ? syntax.version
      : reader?.latest(ctx.state).find(item => item.id === element.id)?.version
    return reader === undefined || version === undefined
      ? unresolved
      : { ...elementView(atom.uri, atom.label, reader, element.id, version, input, ctx), satisfied }
  }
  const asset = citedAsset(atom.uri)
  const ids = asset !== null ? [asset] : input === null ? [] : assetsOfInput(input, ctx)
  const assets = assetsIn(ids, ctx.state)
  const preview = assets[0] ?? null
  return { ...unresolved, assets, preview, open: preview === null ? null : { asset: preview.id }, fits: fitsFilter(assets, ctx.filter) }
}

/**
 * What a chip's face draws of a view: the preview asset, the version the call sends, and whether an input satisfies it.
 * @param view - the view of the chip's atom.
 * @returns the face, as JSON.
 */
export function faceOf(view: ReferenceView): ChipFace {
  const { preview, version, satisfied } = view
  const shown = preview === null ? null : { id: preview.id, mime: preview.mime, name: preview.name }
  return { preview: shown, sent: version?.sent ?? null, satisfied }
}

/**
 * The view of one call input, for the reference tray.
 * @param input - the input.
 * @param ctx - the state, the readers and the filter.
 * @returns the view.
 */
export function resolveInput(input: CallInput, ctx: ResolveContext): ReferenceView {
  const syntax = splitInputRef(input.ref)
  if ('version' in syntax) {
    const found = versionOf(syntax.id, syntax.version, ctx)
    if (found !== null) {
      return elementView(citationUri(found.reader.kind, syntax.id), found.name, found.reader, syntax.id, syntax.version, input, ctx)
    }
  }
  const assets = assetsIn(assetsOfInput(input, ctx), ctx.state)
  const preview = assets[0] ?? null
  return {
    uri: preview === null ? '' : citationUri('asset', preview.id), label: preview?.name ?? input.ref, input, assets, preview,
    open: preview === null ? null : { asset: preview.id }, satisfied: assets.length > 0, fits: fitsFilter(assets, ctx.filter),
    version: null,
  }
}

/**
 * The views of every atom of a document, and the tray of its inputs, in document order.
 * @param document - the document.
 * @param ctx - the state, the version readers and the filter; the document gives the inputs.
 * @returns the views of the atoms, and one tray entry per input.
 */
export function documentViews(document: PromptDocument, ctx: ResolveContext): { atoms: ReferenceView[]; tray: TrayEntry[] } {
  const resolve = withInputs(ctx, document.inputs)
  const atoms = atomsOf(document.prompt)
  const tray = document.inputs.map((input, index) => ({
    input, view: resolveInput(input, resolve),
    cited: atoms.some(atom => satisfyingIndexes(atom.uri, document.inputs, resolve).includes(index)),
  }))
  return { atoms: atoms.map(atom => resolveAtom(atom, resolve)), tray: countReferences(tray, ctx.filter) }
}

/**
 * Mark the reference inputs past the selected model's count. The count runs over the assets of the `reference` inputs
 * in input order, as the kernel counts them: a version counts its assets, and any other input that resolves to no
 * asset counts as one.
 * @param tray - the tray of a call, in input order.
 * @param filter - the selected model's filter; null, or a filter without a count, leaves the tray as it is.
 * @returns the tray, where every `reference` input whose assets end past `maxReferences` does not fit.
 */
export function countReferences(tray: readonly TrayEntry[], filter: CandidateFilter | null): TrayEntry[] {
  const max = filter?.maxReferences ?? null
  let count = 0
  return tray.map((entry) => {
    if (max === null || entry.input.role !== 'reference') return entry
    // A version counts its assets, as the kernel's fan-out does; any other input counts as one, resolved or not.
    count += 'version' in splitInputRef(entry.input.ref) ? entry.view.assets.length : Math.max(1, entry.view.assets.length)
    return count > max ? { ...entry, view: { ...entry.view, fits: false } } : entry
  })
}
