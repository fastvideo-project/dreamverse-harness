/** Shared quality ladder and lazy candidate execution for normalization and request-image encoders. */

import type { Sharp } from 'sharp'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Shared ladder for both encoders: spaced so each step buys a real size reduction. */
export const IMAGE_ENCODING_QUALITIES = [85, 75, 60] as const
/** Fixed lossy-WebP effort; deeper search costs 3-4x encode time for about 5% size. */
export const WEBP_ENCODING_EFFORT = 0

/** Fixed zlib level of the lossless PNG request encoding. */
export const PNG_COMPRESSION_LEVEL = 9

/** One ladder output carrying its complete bytes and exact facts. */
export interface EncodedImage {
  data: Uint8Array
  mediaType: 'image/jpeg' | 'image/webp' | 'image/png'
  width: number
  height: number
}

async function encode(pipeline: Sharp, mediaType: EncodedImage['mediaType'], quality: number): Promise<EncodedImage> {
  const encoded = mediaType === 'image/webp'
    ? pipeline.webp({ quality, effort: WEBP_ENCODING_EFFORT })
    : mediaType === 'image/png'
      ? pipeline.png({ compressionLevel: PNG_COMPRESSION_LEVEL })
      : pipeline.jpeg({ quality })
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), mediaType, width: info.width, height: info.height }
}

/**
 * Choose the request format among the formats the model route accepts: an alpha source becomes WebP, else lossless PNG,
 * else JPEG flattened onto white; an opaque source becomes JPEG, else WebP, else PNG.
 * @param hasAlpha - decoded source alpha fact.
 * @param mediaTypes - the formats the model route accepts.
 * @returns the chosen format, or undefined when the route accepts none of JPEG, PNG and WebP.
 */
export function requestMediaType(
  hasAlpha: boolean,
  mediaTypes: readonly ImageMediaType[],
): EncodedImage['mediaType'] | undefined {
  const order: readonly EncodedImage['mediaType'][] = hasAlpha
    ? ['image/webp', 'image/png', 'image/jpeg']
    : ['image/jpeg', 'image/webp', 'image/png']
  return order.find(candidate => mediaTypes.includes(candidate))
}

/**
 * Build the lazy request encoders for one prepared pipeline in one format: PNG is one lossless candidate, JPEG and WebP
 * walk the quality ladder, and JPEG of an alpha source is flattened onto white.
 * @param prepared - sized sRGB pipeline; cloned per candidate.
 * @param hasAlpha - decoded source alpha fact.
 * @param mediaType - the format from {@link requestMediaType}.
 * @returns encoders ordered from highest to lowest quality.
 */
export function requestEncodingLadder(
  prepared: Sharp,
  hasAlpha: boolean,
  mediaType: EncodedImage['mediaType'],
): Array<() => Promise<EncodedImage>> {
  if (mediaType === 'image/png') return [() => encode(prepared.clone(), mediaType, 100)]
  const source = hasAlpha && mediaType === 'image/jpeg' ? prepared.clone().flatten({ background: '#ffffff' }) : prepared
  return IMAGE_ENCODING_QUALITIES.map(quality => () => encode(source.clone(), mediaType, quality))
}
/**
 * Build the lazy quality ladder for one prepared pipeline: WebP keeps a source
 * alpha channel, everything else is JPEG.
 * @param prepared - sized sRGB pipeline; cloned per candidate.
 * @param hasAlpha - decoded source alpha fact selecting the codec.
 * @returns encoders ordered from highest to lowest ladder quality.
 */
export function encodingLadder(prepared: Sharp, hasAlpha: boolean): Array<() => Promise<EncodedImage>> {
  const mediaType = hasAlpha ? 'image/webp' : 'image/jpeg'
  return IMAGE_ENCODING_QUALITIES.map(quality => (
    () => encode(prepared.clone(), mediaType, quality)
  ))
}

/** One encoded candidate carrying its complete bytes. */
export interface EncodedCandidate {
  data: Uint8Array
}

/** Result of exhausting candidates at one raster size without a fitting output. */
export interface ExhaustedEncoding<T extends EncodedCandidate> {
  smallest: T
}

/**
 * Execute encoding candidates in preference order and stop after the first fitting output.
 * @param attempts - lazy encoders ordered from preferred to fallback representation.
 * @param maxBytes - positive encoded-byte target.
 * @returns the first fitting candidate, otherwise the smallest completed fallback.
 */
export async function encodeFirstWithinLimit<T extends EncodedCandidate>(
  attempts: readonly (() => Promise<T>)[],
  maxBytes: number,
): Promise<T | ExhaustedEncoding<T>> {
  const [first, ...remaining] = attempts
  if (first === undefined) throw new Error('image encoding requires at least one candidate')
  let smallest = await first()
  if (smallest.data.byteLength <= maxBytes) return smallest
  for (const attempt of remaining) {
    const candidate = await attempt()
    if (candidate.data.byteLength <= maxBytes) return candidate
    if (candidate.data.byteLength < smallest.data.byteLength) {
      smallest = candidate
    }
  }
  return { smallest }
}

/**
 * Whether a lazy encoding result exhausted every candidate at one size.
 * @param result - first fitting candidate or exhausted result.
 * @returns whether every candidate exceeded the byte target.
 */
export function isExhaustedEncoding<T extends EncodedCandidate>(
  result: T | ExhaustedEncoding<T>,
): result is ExhaustedEncoding<T> {
  return 'smallest' in result
}
