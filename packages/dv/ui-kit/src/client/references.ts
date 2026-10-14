/**
 * The reference assets a shot sends to the video model, the reference images among them in the order its prompt names
 * them (`Picture 1`, `Picture 2`, …), and the split of a prompt at those names, so a view can show each named image
 * instead of the bare label.
 *
 * The order matches `shot.render` in task `ref2v`: the resolved `reference` inputs in input order, where a
 * character, location or style version stands for all of its references in the version's order. The `first_frame`
 * input of a shot that continues the previous shot (the previous take's last still) is not a reference: the model names
 * it after the reference images (`Picture N+1`, where N is the number of reference images). A shot in task `t2v`
 * renders from the prompt alone and has no references.
 *
 * @module @dv/ui-kit/references
 */
import type { PlanVersion, ProjectAsset, Shot, WireState } from './types.ts'

/** One run of a prompt: plain text, or a `Picture N` or `<Picture N>` token that names the N-th (1-based) reference image. */
export type PicturePart = { text: string } | { picture: number; text: string }

/**
 * The reference texts a plan shot renders from, as `plan.approve` passes them to `shot.render`: in task `ref2v`,
 * the shot's own references, else the plan version's. A shot in task `t2v` has none.
 * @param version - the plan version.
 * @param shot - one shot of the version.
 * @returns the reference texts (`<asset>`, `<record>#<output>`, or `<id>@<version>`).
 */
export function shotReferences(version: Pick<PlanVersion, 'references'>, shot: Pick<Shot, 'references' | 'task'>): string[] {
  return shot.task === 'ref2v' ? shot.references ?? version.references ?? [] : []
}

/**
 * The assets that reference texts stand for, of any media type, in input order: `<id>@<version>` expands to that
 * character, location or style version's references (characters tried first, then locations, then styles),
 * `<record>#<output>` names that output of a record, and any other text is an asset ID. A text the state cannot resolve,
 * and an asset the state does not hold, adds nothing.
 * @param state - the project state the references are read against.
 * @param references - the reference texts, in input order.
 * @returns the assets.
 */
export function referenceAssets(state: WireState, references: readonly string[]): ProjectAsset[] {
  const bible = state.components.bible
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
    const at = ref.lastIndexOf('@')
    const version = at > 0 ? Number(ref.slice(at + 1)) : Number.NaN
    if (!Number.isInteger(version)) return heldAssets([ref])
    const id = ref.slice(0, at)
    const versions = bible.characters[id] ?? bible.locations[id] ?? bible.styles[id] ?? []
    return heldAssets(versions.find(entry => entry.version === version)?.references ?? [])
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
