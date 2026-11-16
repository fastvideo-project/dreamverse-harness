/**
 * Inputs and outputs of the FastVideo `POST /v1/videos/sync` transport. TypeScript fields use camelCase; nested maps
 * keep the backend's values, such as `16:9` or `720p`.
 *
 * @module @dv/fastvideo-generation-client/types
 */

/** The configured facts of the served model: its alias and its reference limits, available when the client is built. */
export interface ConfiguredFacts {
  /** Exact model alias served by the generation backend. */
  modelId: string
  /** The most references that one segment request can carry across media types. */
  maxReferences: number
  /** The accepted reference media types, such as `image` or `video`, and the most references of each per request. */
  referenceMediaTypes: Record<string, {
    /** Maximum references of this media type in one request. */
    maxCount: number
  }>
}

/**
 * The output choices that the server publishes as `video_output_capabilities` on `GET /v1/model_info`, in the server's
 * order. `aspectRatios` and `resolutions` list the keys of `frameSizes`; the duration range lists the keys of
 * `numFramesByDurationSec`.
 */
export interface OutputFacts {
  /** Supported aspect ratios, matching the outer keys of `frameSizes`; the first one is the render default. */
  aspectRatios: string[]
  /** Supported resolution names, matching the inner keys of `frameSizes`; the first one is the render default. */
  resolutions: string[]
  /** Shortest segment duration in whole seconds, inclusive. */
  minDurationSec: number
  /** Longest segment duration in whole seconds, inclusive. */
  maxDurationSec: number
  /** `[width, height]` by aspect ratio and then by resolution, for every supported pair. */
  frameSizes: Record<string, Record<string, [number, number]>>
  /** Native frame count by segment duration in seconds, for every duration from the minimum to the maximum. */
  numFramesByDurationSec: Record<string, number>
}

/** The served model's facts: the configured facts and the output facts that `GET /v1/model_info` publishes. */
export type ModelFacts = ConfiguredFacts & OutputFacts

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
