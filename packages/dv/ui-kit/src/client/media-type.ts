/**
 * The media type of an asset: the key that the media registry of `@dv/ui-media` and its views share.
 *
 * @module @dv/ui-kit/media-type
 */

/**
 * The media type of a MIME type: its top-level type in lower case, without spaces or parameters, so `Image/PNG` and
 * `image/png; charset=binary` are both `image`.
 * @param mime - a MIME type as an asset records it.
 * @returns the media type.
 */
export function mediaTypeOf(mime: string): string {
  return mime.replace(/[/;].*$/su, '').trim().toLowerCase()
}
