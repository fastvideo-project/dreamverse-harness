/**
 * Inputs and outputs of the FastVideo `POST /v1/videos/sync` transport. TypeScript fields use camelCase; nested maps
 * keep the backend's values, such as `16:9` or `720p`.
 *
 * @module @dv/fastvideo-generation-client/types
 */

/**
 * The served model's facts, derived from the deployment's configured `ModelFactsConfig`. `aspectRatios` and
 * `resolutions` list the keys of `frameSizes`; the duration range lists the keys of `numFramesByDurationSec`.
 */
export interface ModelFacts {
  /** Exact model alias served by the generation backend. */
  modelId: string
  /** Supported aspect ratios, matching the outer keys of `frameSizes`. */
  aspectRatios: string[]
  /** Supported resolution names, matching the inner keys of `frameSizes`. */
  resolutions: string[]
  /** Shortest segment duration in whole seconds, inclusive. */
  minDurationSec: number
  /** Longest segment duration in whole seconds, inclusive. */
  maxDurationSec: number
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
  /** The native tasks the server accepts, when it publishes them. */
  tasks?: ServedTaskFacts[]
  /** The server's reference limits, when it is a Ref2VA server that publishes them. */
  referenceLimits?: ReferenceLimitFacts
}

/** One native task that a FastVideo server accepts, from `video_output_capabilities.tasks`. */
export interface ServedTaskFacts {
  /** Native task ID, such as `t2va`, `i2va`, `l2va`, `fl2va` or `ref2va`. */
  task: string
  /** How many image references the task takes as frames; absent for `ref2va`. */
  imageReferences?: number
  /** The frames those images anchor, in order. */
  anchors?: Array<'first' | 'last'>
}

/** A Ref2VA server's reference limits, from `video_output_capabilities.reference_limits`. */
export interface ReferenceLimitFacts {
  /** Most image references in one request. */
  images: number
  /** Most video references in one request. */
  videos: number
  /** Most audio references in one request. */
  audios: number
  /** Most references in one request across media types. */
  total: number
  /** Whether the server accepts a continuation clip. */
  continuationVideo: boolean
}

/** One reference of a segment request: its bytes and their MIME type, whose top-level type is the media type. */
export interface SegmentReference {
  /** MIME type of the bytes, such as `image/jpeg`; its top-level type must be `image`, `video` or `audio`. */
  mimeType: string
  bytes: Buffer
}

/** The inputs of one segment generation request. */
export interface SegmentRequest {
  prompt: string
  frameWidth: number
  frameHeight: number
  numFrames: number
  /** References in caller order; the request groups them by media type and keeps the caller order within each type. */
  references: SegmentReference[]
  /** The generation seed; omitted, the backend uses its default seed. */
  seed?: number
  /** Aborting cancels the HTTP request and rejects with `signal.reason`. */
  signal?: AbortSignal
}

/** The whole generated segment. */
export interface SegmentVideo {
  /** The MP4 bytes. */
  video: Buffer
  /** The answer's `video/*` content type. */
  mime: string
  /** Backend timings in seconds: `inference_s` and one `<stage>_s` per stage of `X-Stage-Durations`. */
  timings: Record<string, number>
}
