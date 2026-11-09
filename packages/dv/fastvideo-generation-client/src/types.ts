/**
 * Shared inputs and outputs of the streaming_v2 and OpenAI generation transports. TypeScript fields use camelCase;
 * nested maps keep the backend's values, such as `16:9` or `720p`.
 *
 * @module @dv/fastvideo-generation-client/types
 */

/**
 * The served model's facts from streaming capabilities or explicit OpenAI deployment configuration.
 * `aspectRatios` and `resolutions` list the keys of `frameSizes`.
 */
export interface ModelFacts {
  /** Exact model alias served by the generation backend. */
  modelId: string
  /** Supported aspect ratios, matching the outer keys of `frameSizes`. */
  aspectRatios: string[]
  /** Supported resolution names, matching the inner keys of `frameSizes`. */
  resolutions: string[]
  /** Shortest segment duration in whole seconds, inclusive. */
  minSegmentDurationSec: number
  /** Longest segment duration in whole seconds, inclusive. */
  maxSegmentDurationSec: number
  /** The most references that one segment request can carry across media types. */
  maxReferences: number
  /** The accepted reference media types, such as `image` or `video`, and the most references of each per request. */
  referenceMediaTypes: Record<string, {
    /** Maximum references of this media type in one request. */
    maxCount: number
  }>
  /** `[width, height]` by aspect ratio and then by resolution, for every supported pair. */
  frameSizes: Record<string, Record<string, [number, number]>>
  /** Native frame count by segment duration in seconds, for every duration from the minimum to the maximum. */
  numFramesByDurationSec: Record<string, number>
}

/** One reference of a segment request: its media type and its bytes, in model order. */
export interface SegmentReference {
  /** The top-level type of the file's MIME type, such as `image` or `video`; the backend decodes the bytes by it. */
  mediaType: string
  /** MIME type of the source bytes for the OpenAI transport; its top-level type must match `mediaType`. */
  mimeType?: string
  bytes: Buffer
}

/** The inputs of one segment generation request. */
export interface SegmentRequest {
  /** Native MiniMax-H3/Pika task selector for OpenAI servers; omit for inferred-task servers. */
  task?: 't2va' | 'i2va' | 'l2va' | 'fl2va' | 'ref2va'
  prompt: string
  frameWidth: number
  frameHeight: number
  numFrames: number
  /** References in caller order. OpenAI groups them by media type and validates types; streaming_v2 preserves order. */
  references: SegmentReference[]
  /** The generation seed; omitted, the backend uses its default seed. */
  seed?: number
  /** Whether to emit the last decoded frame as PNG bytes before the video; OpenAI extracts it locally. */
  returnLastFrame: boolean
  /** Aborting cancels the HTTP request and rejects the iteration with `signal.reason`. */
  signal?: AbortSignal
}

/** One client output of a segment request. */
export type SegmentOutput =
  | { kind: 'last_frame'; png: Buffer }
  | { kind: 'video_start'; mime: string }
  | { kind: 'chunk'; bytes: Buffer }
  | { kind: 'done'; timings: Record<string, number> }
