/**
 * Values that the generation backend's OpenAI-style video job API accepts and returns. TypeScript fields use camelCase.
 *
 * @module @dv/fastvideo-generation-client/types
 */

/** One image reference of a video job: its MIME type and its bytes, in model order. */
export interface VideoImage {
  /** The file's MIME type, such as `image/png`; the client sends the image as a `data:` URL of this type. */
  mime: string
  bytes: Buffer
}

/** The inputs of one video job. */
export interface VideoRequest {
  /** The backend's task name, such as `ref2va` or `t2va`. */
  task: string
  prompt: string
  frameWidth: number
  frameHeight: number
  numFrames: number
  /** The image references in model order; the client sends them unchecked and the backend decodes them. */
  images: VideoImage[]
  /** The generation seed; omitted, the backend uses its default seed. */
  seed?: number
  /** Aborting stops polling and rejects with `signal.reason`. */
  signal?: AbortSignal
}

/** The finished video of one job. */
export interface VideoOutput {
  /** The MP4 bytes that `GET /v1/videos/{id}/content` returned. */
  video: Buffer
  /** `e2e_latency_ms` from submission to downloaded bytes, and `generation_ms` when the backend reports `inference_time_s`. */
  timings: Record<string, number>
}
