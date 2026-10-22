/**
 * Readings of the project state that every view needs: asset lookups and the rule that tells generation records apart.
 *
 * @module @dv/ui-kit/state
 */
import { mediaTypeOf } from './media-type.ts'
import type { Asset, ProjectRecord, WireOperation, WireState } from './types.ts'

/** The output types of a generation operation, which are also the MIME top-level types of its output assets. */
const MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'video', 'audio'])

/**
 * @param op - an operation declaration from `/api/dv/operations`.
 * @returns whether the operation generates media: not deterministic, resource `gpu`, and an image, video or audio output.
 */
export function isGenerationOperation(op: WireOperation): boolean {
  return !op.deterministic && op.resource === 'gpu' && op.outputs.some(output => MEDIA_TYPES.has(output.type))
}

/**
 * Whether a record generated media, so that views draw it as a take. A record whose operation is on the wire follows
 * {@link isGenerationOperation}, so a pending record without outputs counts. A record whose operation is off the wire
 * (no provider, or an old operation name) counts when it is not deterministic and has an image, video or audio output.
 * @param record - a record of the project.
 * @param op - the declaration of the record's operation, or undefined when `/api/dv/operations` does not list it.
 * @param mimeOf - the MIME type of an asset, or undefined for an asset that the caller does not know.
 * @returns whether the record is a generation record.
 */
export function isGenerationRecord(
  record: ProjectRecord, op: WireOperation | undefined, mimeOf: (asset: string) => string | undefined,
): boolean {
  if (op !== undefined) return isGenerationOperation(op)
  return !record.deterministic && record.outputs.some(output => MEDIA_TYPES.has(mediaTypeOf(mimeOf(output) ?? '')))
}

/**
 * @param state - the project state.
 * @returns assets by ID.
 */
export function assetIndex(state: WireState): Map<string, Asset> {
  return new Map(state.assets.map(asset => [asset.id, asset]))
}

/**
 * The video assets of a state, newest first, for insertion into the timeline.
 * @param state - the project state.
 * @returns the video assets.
 */
export function videoAssets(state: WireState): Asset[] {
  return state.assets.filter(asset => asset.mime.startsWith('video/')).sort((a, b) => b.created_at.localeCompare(a.created_at))
}
