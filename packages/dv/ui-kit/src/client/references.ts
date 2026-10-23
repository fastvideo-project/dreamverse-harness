/**
 * The input references of the views: the reference text of a stored input reference, the request inputs of a stored
 * record, and the assets that reference texts stand for, in the order that `shot.render` in task `ref2v` sends them: the
 * resolved `reference` inputs in input order, where a version of a reference kind stands for all of its reference
 * assets in the version's order.
 *
 * Client code names no reference kind: it reads a version reference with {@link versionRefOf}, reads and writes
 * reference text with the kernel's `splitInputRef` and `formatInputSyntax` of `@dv/project/grammar`, and writes any
 * stored input reference as text with {@link formatInputRef}.
 *
 * @module @dv/ui-kit/references
 */
import { formatInputSyntax, splitInputRef } from '@dv/project/grammar'
import type { VersionKind } from './registries.ts'
import type { ProjectAsset, ProjectRecord, WireInputRef, WireState } from './types.ts'

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
  if (!('version' in ref)) return formatInputSyntax(ref)
  const named = versionRefOf(ref)
  return named === null ? JSON.stringify(ref) : formatInputSyntax(named)
}

/**
 * The request inputs of a stored record, as an operation request takes them: a record holds one input per asset of a
 * version, and a request names the version once.
 * @param record - the record.
 * @returns the inputs in stored order, each version once.
 */
export function requestInputsOf(record: Pick<ProjectRecord, 'inputs'>): Array<{ role: string; ref: string }> {
  const inputs: Array<{ role: string; ref: string }> = []
  for (const input of record.inputs) {
    const ref = formatInputRef(input.ref)
    const previous = inputs.at(-1)
    if (!('version' in input.ref) || previous?.role !== input.role || previous.ref !== ref) inputs.push({ role: input.role, ref })
  }
  return inputs
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
    const syntax = splitInputRef(ref)
    if ('asset' in syntax) return heldAssets([syntax.asset])
    if ('record' in syntax) {
      const asset = records.get(syntax.record)?.outputs[syntax.output]
      return asset === undefined ? [] : heldAssets([asset])
    }
    return heldAssets(kinds.map(kind => kind.assets(state, syntax.id, syntax.version)).find(assets => assets.length > 0) ?? [])
  })
}

/**
 * The items that reference texts name, in input order, as a view lists them: a version `<id>@<version>` by the name
 * that the first of `kinds` holding it gives, with its first reference asset; a record output and an asset by the
 * asset's name. A text the state cannot resolve gives no item.
 * @param state - the project state the references are read against.
 * @param references - the reference texts, in input order.
 * @param kinds - the registered version kinds.
 * @returns the items; a version without a reference asset has a null asset.
 */
export function referenceItems(
  state: WireState, references: readonly string[], kinds: readonly VersionKind[],
): Array<{ name: string; asset: ProjectAsset | null }> {
  return references.flatMap((ref) => {
    const syntax = splitInputRef(ref)
    if (!('version' in syntax)) return referenceAssets(state, [ref], kinds).map(asset => ({ name: asset.name, asset }))
    for (const kind of kinds) {
      const name = kind.name(state, syntax.id, syntax.version)
      if (name !== null) return [{ name, asset: referenceAssets(state, [ref], [kind])[0] ?? null }]
    }
    return []
  })
}
