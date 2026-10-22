/**
 * The reference assets a shot sends to the video model, the reference images among them in the order its prompt names
 * them (`Picture 1`, `Picture 2`, …), and the split of a prompt at those names, so a view can show each named image
 * instead of the bare label.
 *
 * The order matches `shot.render` in task `ref2v`: the resolved `reference` inputs in input order, where a version of
 * a reference kind stands for all of its reference assets in the version's order. The `first_frame`
 * input of a shot that continues the previous shot (the previous take's last still) is not a reference: the model names
 * it after the reference images (`Picture N+1`, where N is the number of reference images). A shot in task `t2v`
 * renders from the prompt alone and has no references.
 *
 * Client code names no reference kind: it reads a version reference with {@link versionRefOf}, reads the version that
 * a reference text names with {@link parseVersionedReference}, and writes any stored input reference as text with
 * {@link formatInputRef}.
 *
 * @module @dv/ui-kit/references
 */
import type { VersionKind } from './registries.ts'
import type { ProjectAsset, WireInputRef, WireState } from './types.ts'

/** One run of a prompt: plain text, or a `Picture N` or `<Picture N>` token that names the N-th (1-based) reference image. */
export type PicturePart = { text: string } | { picture: number; text: string }

/**
 * The kind, ID and version of a stored input reference that names a version of a reference kind.
 * @param ref - the stored input reference.
 * @returns the kind key, the ID and the version, or null for an asset, a record output, or a version reference without a kind key.
 */
export function versionRefOf(ref: WireInputRef): { kind: string; id: string; version: number } | null {
  if (!('version' in ref)) return null
  const kind = Object.keys(ref).find(key => key !== 'version')
  return kind === undefined ? null : { kind, id: String(ref[kind]), version: ref.version }
}

/**
 * The reference text of a stored input reference, as an operation request takes it.
 * @param ref - the stored input reference.
 * @returns `<asset>`, `<record>#<output>`, or `<id>@<version>` for a version of any reference kind.
 */
export function formatInputRef(ref: WireInputRef): string {
  if (!('version' in ref)) return 'asset' in ref ? ref.asset : `${ref.record}#${String(ref.output)}`
  const named = versionRefOf(ref)
  return named === null ? JSON.stringify(ref) : `${named.id}@${String(named.version)}`
}

/**
 * The ID and version that a reference text names as `<id>@<version>`, read with the grammar of `parseInputRef` in
 * `@dv/project`: the text after the last `@`, when that `@` is not the first character, converts with `Number` to an
 * integer.
 * @param ref - one reference text.
 * @returns the ID and the version, or null for an asset ID or a `<record>#<output>` text.
 */
export function parseVersionedReference(ref: string): { id: string; version: number } | null {
  const at = ref.lastIndexOf('@')
  const version = at > 0 ? Number(ref.slice(at + 1)) : Number.NaN
  return Number.isInteger(version) ? { id: ref.slice(0, at), version } : null
}

/**
 * The assets that reference texts stand for, of any media type, in input order: `<id>@<version>` expands to the
 * reference assets of that version in the first of `kinds` that gives it any, `<record>#<output>` names that output of a
 * record, and any other text is an asset ID. A text the state cannot resolve, and an asset the state does not hold, adds
 * nothing.
 * @param state - the project state the references are read against.
 * @param references - the reference texts, in input order.
 * @param kinds - the registered version kinds, which read the versions of their reference kinds.
 * @returns the assets.
 */
export function referenceAssets(state: WireState, references: readonly string[], kinds: readonly VersionKind[]): ProjectAsset[] {
  const records = new Map(state.components.proj.records.map(record => [record.id, record]))
  const held = new Map(state.assets.map(asset => [asset.id, asset]))
  const heldAssets = (ids: readonly string[]): ProjectAsset[] => ids.flatMap(id => held.get(id) ?? [])
  return references.flatMap((ref) => {
    const hash = ref.lastIndexOf('#')
    const output = hash > 0 ? Number(ref.slice(hash + 1)) : Number.NaN
    if (Number.isInteger(output) && output >= 0) {
      const asset = records.get(ref.slice(0, hash))?.outputs[output]
      return asset === undefined ? [] : heldAssets([asset])
    }
    const named = parseVersionedReference(ref)
    if (named === null) return heldAssets([ref])
    return heldAssets(kinds.map(kind => kind.assets(state, named.id, named.version)).find(assets => assets.length > 0) ?? [])
  })
}

/**
 * Whether the video model numbers a reference asset as `Picture N`: the asset is an image. Among a shot's reference
 * assets in input order, the N-th image is `Picture N`.
 * @param asset - one reference asset.
 * @returns whether the asset is a picture.
 */
export function isPicture(asset: Pick<ProjectAsset, 'mime'>): boolean {
  return asset.mime.startsWith('image/')
}

/**
 * Split a prompt at its `Picture N` and `picture N` tokens (N a whole number from 1). A token in angle brackets, as in
 * `<Picture 1>`, includes the brackets, so a view that draws the image drops them too.
 * @param prompt - the shot prompt.
 * @returns the text runs and tokens in prompt order; a token keeps its original text for alt text and screen readers.
 */
export function pictureParts(prompt: string): PicturePart[] {
  const parts: PicturePart[] = []
  let last = 0
  for (const match of prompt.matchAll(/<[Pp]icture (\d+)>|\b[Pp]icture (\d+)\b/g)) {
    const picture = Number(match[1] ?? match[2])
    if (picture < 1) continue
    if (match.index > last) parts.push({ text: prompt.slice(last, match.index) })
    parts.push({ picture, text: match[0] })
    last = match.index + match[0].length
  }
  if (last < prompt.length) parts.push({ text: prompt.slice(last) })
  return parts
}
