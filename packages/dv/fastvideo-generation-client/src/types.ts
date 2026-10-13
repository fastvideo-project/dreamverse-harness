/**
 * Values that the generation backend's streaming_v2 API returns and accepts. TypeScript fields use camelCase; keys of
 * nested maps keep the backend's values, such as `16:9` or `720p`.
 *
 * @module @dv/fastvideo-generation-client/types
 */

/**
 * The served model's facts. The model-specific values come from `GET /v1/streamv2/capabilities`; `referenceLabels` is
 * the harness's value, and `aspectRatios` and `resolutions` list the keys of `frameSizes`.
 */
export interface ModelFacts {
  modelId: string
  aspectRatios: string[]
  resolutions: string[]
  minSegmentDurationSec: number
  maxSegmentDurationSec: number
  /** The most images that one segment request can carry, including a predecessor's last frame. */
  maxReferenceImages: number
  /** `[width, height]` by aspect ratio and then by resolution, for every supported pair. */
  frameSizes: Record<string, Record<string, [number, number]>>
  /** Native frame count by segment duration in seconds, for every duration from the minimum to the maximum. */
  numFramesByDurationSec: Record<string, number>
  /** Prompt labels of the request images in request order; the labels for N images are the first N entries. */
  referenceLabels: string[]
}

/** The inputs of one `POST /v1/streamv2/generate` request. */
export interface SegmentRequest {
  prompt: string
  frameWidth: number
  frameHeight: number
  numFrames: number
  /** Image bytes in request order; the prompt names them `Picture 1`, `Picture 2`, and so on. */
  referenceImages: Buffer[]
  /** The generation seed; omitted, the backend uses its default seed. */
  seed?: number
  /** Whether the backend returns the segment's last decoded frame, as PNG bytes, before its video. */
  returnLastFrame: boolean
  /** Aborting cancels the HTTP request and rejects the iteration with `signal.reason`. */
  signal?: AbortSignal
}

/** One output of a segment request, in the order the backend sent it. */
export type SegmentOutput =
  | { kind: 'last_frame'; png: Buffer }
  | { kind: 'video_start'; mime: string }
  | { kind: 'chunk'; bytes: Buffer }
  | { kind: 'done'; timings: Record<string, number> }
