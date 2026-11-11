/**
 * The reference fields of a FastVideo `POST /v1/videos/sync` request. The Ref2VA pipeline reads the image references,
 * then the video references, then the audio references, each list in its own order; the key order of
 * `REFERENCE_FIELDS` is that reading order, and both the request body and the prompt labels of `@dv/fastvideo` follow
 * it.
 *
 * @module @dv/fastvideo-generation-client/references
 */

/** The request list and the `data:` URL key of each reference media type, in the order the backend reads them. */
export const REFERENCE_FIELDS = {
  image: { field: 'image_reference', urlKey: 'image_url' },
  video: { field: 'video_reference', urlKey: 'video_url' },
  audio: { field: 'audio_reference', urlKey: 'audio_url' },
} as const

/** A media type that FastVideo accepts as a reference: `image`, `video` or `audio`. */
export type ReferenceMediaType = keyof typeof REFERENCE_FIELDS

/**
 * The reference media type of a MIME type, from its top-level type.
 * @param mimeType - a MIME type, such as `image/jpeg`.
 * @returns the media type, or `undefined` when FastVideo accepts no reference of that top-level type.
 */
export function referenceMediaType(mimeType: string): ReferenceMediaType | undefined {
  const [type] = mimeType.split('/') as [string]
  return Object.hasOwn(REFERENCE_FIELDS, type) ? type as ReferenceMediaType : undefined
}

/**
 * Items in the order the backend reads them: grouped by media type in `REFERENCE_FIELDS` order, keeping the given
 * order within each type. An item whose media type FastVideo does not accept is left out.
 * @param items - the items in caller order.
 * @param mediaTypeOf - the media type of an item, such as `image`.
 * @returns the items in backend order.
 */
export function backendOrder<T>(items: readonly T[], mediaTypeOf: (item: T) => string): T[] {
  return Object.keys(REFERENCE_FIELDS).flatMap(type => items.filter(item => mediaTypeOf(item) === type))
}
