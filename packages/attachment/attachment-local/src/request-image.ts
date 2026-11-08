/** Deterministic cached image versions for model requests. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Sharp } from 'sharp'
import { AttachmentError, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageMediaType,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import {
  IMAGE_ENCODING_QUALITIES,
  PNG_COMPRESSION_LEVEL,
  WEBP_ENCODING_EFFORT,
  encodeFirstWithinLimit,
  isExhaustedEncoding,
  requestEncodingLadder,
  requestMediaType,
} from './encoding.ts'
import type { EncodedImage } from './encoding.ts'
import { detectImage, encodedAlphaIsCompatible, probeImage } from './image.ts'
import { requireSharp } from './sharp.ts'

/** Transform version included in every cache and upload-index identity. */
export const REQUEST_IMAGE_TRANSFORM_VERSION = 'request-image-v7'

interface EncodedRequestImage {
  data: Uint8Array
  mediaType: ImageMediaType
  width: number
  height: number
}

interface VerifiedRequestImage extends EncodedRequestImage {
  hasAlpha: boolean
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function checkedInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AttachmentError(`${name} must be a positive integer.`, 'INVALID_ATTACHMENT_REF')
  }
  return value
}

function validateTarget(target: ImageRequestTarget): void {
  checkedInteger(target.width, 'Image request width')
  checkedInteger(target.height, 'Image request height')
  checkedInteger(target.maxBytes, 'Image request maxBytes')
  if (!ENCODABLE_MEDIA_TYPES.some(mediaType => target.mediaTypes.includes(mediaType))) {
    throw new AttachmentError('Image request mediaTypes must name image/jpeg, image/png or image/webp.', 'INVALID_ATTACHMENT_REF')
  }
}

const ENCODABLE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/jpeg', 'image/png', 'image/webp']

function descriptor(attachment: ImageAttachmentRef, target: ImageRequestTarget): string {
  return JSON.stringify({
    transformVersion: REQUEST_IMAGE_TRANSFORM_VERSION,
    attachmentId: attachment.attachmentId,
    targetWidth: target.width,
    targetHeight: target.height,
    encodedByteBudget: target.maxBytes,
    acceptedMediaTypes: [...target.mediaTypes].sort(),
    encoding: {
      webpQualities: IMAGE_ENCODING_QUALITIES,
      webpEffort: WEBP_ENCODING_EFFORT,
      jpegQualities: IMAGE_ENCODING_QUALITIES,
      pngCompressionLevel: PNG_COMPRESSION_LEVEL,
      order: ['alpha:webp,png,jpeg-on-white', 'opaque:jpeg,webp,png'],
      colourspace: 'srgb',
    },
  })
}

/**
 * Complete deterministic identity for one attachment and route-chosen request target.
 * @param attachment - provider-independent durable normalized attachment reference.
 * @param target - route-chosen dimensions and byte target.
 * @returns branded digest over every request transform input.
 */
export function requestImageVariantId(
  attachment: ImageAttachmentRef,
  target: ImageRequestTarget,
): ReturnType<typeof ImageVariantId> {
  return ImageVariantId(`sha256:${digest(descriptor(attachment, target))}`)
}

/** Resize by the source long edge only, so the encoder derives the short edge as the route predicts. */
function pipeline(attachment: StoredImageAttachment, target: ImageRequestTarget): Sharp {
  const byWidth = attachment.ref.width >= attachment.ref.height
  return sourcePipeline(attachment)
    .resize({ ...byWidth ? { width: target.width } : { height: target.height }, withoutEnlargement: true })
}

function sourcePipeline(attachment: StoredImageAttachment): Sharp {
  const sharp = requireSharp()
  return sharp(attachment.data, { failOn: 'error', limitInputPixels: false }).toColourspace('srgb')
}

/** The stored bytes go unchanged when they fit the target and the route accepts their format. */
function sendsStoredBytes(attachment: StoredImageAttachment, target: ImageRequestTarget): boolean {
  return target.width >= attachment.ref.width
    && target.height >= attachment.ref.height
    && attachment.data.byteLength <= target.maxBytes
    && target.mediaTypes.includes(attachment.ref.mediaType)
}

/** The bytes and alpha fact a request version gets: the stored bytes, or an encoding in the chosen format. */
interface RequestPlan {
  /** Format to encode into; undefined when the stored bytes go unchanged. */
  mediaType: EncodedImage['mediaType'] | undefined
  /** Whether the request version keeps an alpha channel. */
  hasAlpha: boolean
}

function requestPlan(attachment: StoredImageAttachment, target: ImageRequestTarget, sourceHasAlpha: boolean): RequestPlan {
  if (sendsStoredBytes(attachment, target)) return { mediaType: undefined, hasAlpha: sourceHasAlpha }
  const mediaType = requestMediaType(sourceHasAlpha, target.mediaTypes)
  /* v8 ignore next -- validateTarget requires JPEG, PNG or WebP among the accepted formats. */
  if (mediaType === undefined) throw new AttachmentError('No accepted image format can encode the request.', 'INVALID_ATTACHMENT_REF')
  return { mediaType, hasAlpha: sourceHasAlpha && mediaType !== 'image/jpeg' }
}

async function createRequestImage(
  attachment: StoredImageAttachment,
  target: ImageRequestTarget,
  sourceHasAlpha: boolean,
  plan: RequestPlan,
): Promise<EncodedRequestImage> {
  if (plan.mediaType === undefined) {
    return {
      data: attachment.data,
      mediaType: attachment.ref.mediaType,
      width: attachment.ref.width,
      height: attachment.ref.height,
    }
  }
  const encodedVersion = await encodeFirstWithinLimit(
    requestEncodingLadder(pipeline(attachment, target), sourceHasAlpha, plan.mediaType),
    target.maxBytes,
  )
  return isExhaustedEncoding(encodedVersion) ? encodedVersion.smallest : encodedVersion
}

function cachePath(root: string, hash: string): string {
  return join(root, 'request-images', hash.slice(0, 2), hash)
}

async function readCached(
  path: string,
  target: ImageRequestTarget,
  expectedAlpha: boolean,
  signal?: AbortSignal,
): Promise<VerifiedRequestImage | undefined> {
  try {
    const data = new Uint8Array(await readFile(path, { signal }))
    const detected = await probeImage(data)
    if (detected.depth !== 'uchar' || detected.space !== 'srgb'
      || detected.width > target.width || detected.height > target.height
      || !encodedAlphaIsCompatible(expectedAlpha, detected)) return undefined
    return { data, mediaType: detected.mediaType, width: detected.width, height: detected.height, hasAlpha: detected.hasAlpha }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    signal?.throwIfAborted()
    return undefined
  }
}

async function verifyRequestImage(
  image: EncodedRequestImage,
  expectedAlpha: boolean,
): Promise<VerifiedRequestImage> {
  const detected = await detectImage(image.data)
  if (detected.depth !== 'uchar' || detected.space !== 'srgb'
    || detected.width !== image.width || detected.height !== image.height
    || detected.mediaType !== image.mediaType || !encodedAlphaIsCompatible(expectedAlpha, detected)) {
    throw new AttachmentError(
      'Encoded model-request image does not match its verified 8-bit sRGB metadata.',
      'ATTACHMENT_WRITE_FAILED',
    )
  }
  return { ...image, hasAlpha: detected.hasAlpha }
}

async function writeCached(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/**
 * Generate or reuse one request image below the local attachment cache root.
 * @param root - absolute attachment cache root; variants use its `request-images` child.
 * @param attachment - verified normalized attachment bytes and reference.
 * @param target - exact route-chosen dimensions and byte target; a target above the source keeps the source size.
 * @param signal - optional cancellation for cache I/O and image transformation.
 * @returns verified request bytes and deterministic variant identity.
 */
export async function readRequestImageFile(
  root: string,
  attachment: StoredImageAttachment,
  target: ImageRequestTarget,
  signal?: AbortSignal,
): Promise<RequestImageAttachment> {
  signal?.throwIfAborted()
  validateTarget(target)
  const source = await probeImage(attachment.data)
  const variantId = requestImageVariantId(attachment.ref, target)
  const hash = String(variantId).slice('sha256:'.length)
  const path = cachePath(root, hash)
  const plan = requestPlan(attachment, target, source.hasAlpha)
  const cached = await readCached(path, target, plan.hasAlpha, signal)
  const created = cached ?? await createRequestImage(attachment, target, source.hasAlpha, plan)
  const version = cached ?? (created.data === attachment.data
    ? { ...created, hasAlpha: source.hasAlpha }
    : await verifyRequestImage(created, plan.hasAlpha))
  signal?.throwIfAborted()
  if (cached === undefined && version.data !== attachment.data) await writeCached(path, version.data)
  return {
    variantId,
    attachment: attachment.ref,
    data: version.data,
    mediaType: version.mediaType,
    bytes: version.data.byteLength,
    width: version.width,
    height: version.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: version.hasAlpha,
  }
}
