/**
 * Values that the generation backend's streaming_v2 API returns and accepts. TypeScript fields use camelCase; keys of
 * nested maps keep the backend's values, such as `16:9` or `720p`.
 *
 * @module @dv/fastvideo-generation-client/types
 */

/**
 * The served model's facts from `GET /v1/streamv2/capabilities`; `aspectRatios` and `resolutions` list the keys of
 * `frameSizes`.
 */
export interface ModelFacts {
  modelId: string
  aspectRatios: string[]
  resolutions: string[]
  minSegmentDurationSec: number
  maxSegmentDurationSec: number
  /** The most references that one segment request can carry across media types. */
  maxReferences: number
  /** The accepted reference media types, such as `image` or `video`, and the most references of each per request. */
  referenceMediaTypes: Record<string, { maxCount: number }>
  /** `[width, height]` by aspect ratio and then by resolution, for every supported pair. */
  frameSizes: Record<string, Record<string, [number, number]>>
  /** Native frame count by segment duration in seconds, for every duration from the minimum to the maximum. */
  numFramesByDurationSec: Record<string, number>
  /** The community LoRAs that a request of this server may select. */
  lora: LoraFacts
}

/** One adapter that the server allows a request to select. */
export interface LoraAdapter {
  /** The adapter id that a request names: the HF repo id or local path the server loads. */
  id: string
  /** The strength that the adapter's author published, and that a request without a `strength` uses. */
  defaultStrength: number
  /** The lowest strength the server applies; the base model is at {@link LoraFacts.baseStrength}. */
  minStrength: number
  /** The highest strength the server applies. */
  maxStrength: number
  /** What the adapter changes, when the server's operator wrote it. */
  description?: string
  /** The adapter's licence, when the operator wrote it. */
  license?: string
  /** The page the weights come from, when the operator wrote it. */
  sourceUrl?: string
}

/** The server's LoRA support, from the `lora` block of its capabilities. */
export interface LoraFacts {
  /** Whether the server allows a request to select an adapter at all. */
  supported: boolean
  /** Whether a request may change the adapter or its strength on a running server. */
  runtimeSwitching: boolean
  /** The strength that returns the model without the adapter. */
  baseStrength: number
  /** The adapters a request may select, in the server's order. */
  adapters: LoraAdapter[]
}

/** The adapter one segment request selects, and the strength to apply it at. */
export interface LoraSelection {
  /** The id of one adapter of the server's allow-list. */
  id: string
  /** The strength to apply; omitted, the adapter's default strength applies. `0` is the model without the adapter. */
  strength?: number
}

/** One reference of a segment request: its media type and its bytes, in model order. */
export interface SegmentReference {
  /** The top-level type of the file's MIME type, such as `image` or `video`; the backend decodes the bytes by it. */
  mediaType: string
  bytes: Buffer
}

/** The inputs of one `POST /v1/streamv2/generate` request. */
export interface SegmentRequest {
  prompt: string
  frameWidth: number
  frameHeight: number
  numFrames: number
  /** The references in model order; the client sends them unchecked and the backend checks their media types. */
  references: SegmentReference[]
  /** The generation seed; omitted, the backend uses its default seed. */
  seed?: number
  /** Whether the backend returns the segment's last decoded frame, as PNG bytes, before its video. */
  returnLastFrame: boolean
  /** The adapter this segment selects; omitted, the backend renders the model without an adapter. */
  lora?: LoraSelection
  /** Aborting cancels the HTTP request and rejects the iteration with `signal.reason`. */
  signal?: AbortSignal
}

/** One output of a segment request, in the order the backend sent it. */
export type SegmentOutput =
  | { kind: 'last_frame'; png: Buffer }
  | { kind: 'video_start'; mime: string }
  | { kind: 'chunk'; bytes: Buffer }
  | { kind: 'done'; timings: Record<string, number> }
