/**
 * Types of the DreamVerse model catalog: the modalities with the facts, request and result types of each, the task
 * vocabulary, the key of a catalog entry, and the model entry that provider plugins implement. One entry is one model of
 * one provider serving one task; `ModelEntry<M>` is an entry of modality `M`.
 *
 * @module @dv/models/types
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { AssetId } from '@dv/project'

/** One output modality, such as `video`: a key of `ModalityTypes`. */
export type ModalityId = keyof ModalityTypes

/**
 * The generation tasks, each mapped to the modality it produces. `t2v`: a video from the prompt alone; `ref2v`: a video
 * from reference media and the prompt, optionally from a first frame. A plugin adds a task through declaration merging:
 * `declare module '@dv/models' { interface TaskMap { v2v: 'video' } }`.
 */
export interface TaskMap {
  t2v: 'video'
  ref2v: 'video'
}

/** One generation task, such as `ref2v`. */
export type TaskId = keyof TaskMap

/** The tasks of each modality: `TaskMap` read the other way, from modality to task. */
type TasksByModality = { [M in ModalityId]: { [T in TaskId]: TaskMap[T] extends M ? T : never }[TaskId] }

/** One task of modality `M`, such as `t2v | ref2v` for `video`. */
export type TaskOfModality<M extends ModalityId> = TasksByModality[M]

/** The key of one catalog entry: one model of one provider, serving one task of the task's modality. */
export interface ModelKey<T extends TaskId = TaskId> {
  /** The modality that the task produces. */
  modality: TaskMap[T]
  task: T
  /** The provider plugin's name for the backend that serves the model, such as `fastvideo`. */
  provider: string
  /** The provider's name for the model, such as `fasth3`. */
  model: string
}

/**
 * The facts of one entry that a render request is built from, read from the provider's backend. Map keys keep the
 * backend's values, such as `16:9` or `720p`.
 */
export interface RenderModelFacts {
  /** The backend's model ID, which the record report keeps (`model_id`); never shown to the user. */
  modelId: string
  /** The aspect ratios the model renders, the default first. */
  aspectRatios: string[]
  /** The resolutions the model renders, the default first. */
  resolutions: string[]
  /** `[width, height]` by aspect ratio and then by resolution, for every supported pair. */
  frameSizes: Record<string, Record<string, [number, number]>>
  /** The shortest shot in whole seconds. */
  minDurationSec: number
  /** The longest shot in whole seconds. */
  maxDurationSec: number
  /** The model's frame count by shot duration in whole seconds, for every duration from the minimum to the maximum. */
  numFramesByDurationSec: Record<string, number>
}

/**
 * One video render: the prompt, the input assets, the frame size and count, the seed, and the model's own parameters.
 * Inputs are asset IDs; the provider plugin reads each asset's bytes and media type from `dvAssetPool`.
 */
export interface RenderRequest {
  prompt: string
  /** The reference assets in input order; empty for a task without references. */
  references: AssetId[]
  /** The asset the video starts from, or null. */
  firstFrame: AssetId | null
  frameWidth: number
  frameHeight: number
  numFrames: number
  seed: number
  /** Values of the model's own parameters, which the entry's `schema()` describes. */
  extra: Record<string, unknown>
}

/**
 * One event of a render stream, in the order the backend sends them: the last frame (PNG bytes) before or after the
 * video, `video_start` with the video's media type, the video bytes in `chunk` events, then `done` with the backend's
 * timings (keys ending in `_ms` are milliseconds, other keys seconds). A failure rejects the iteration.
 */
export type RenderStreamEvent =
  | { kind: 'last_frame'; png: Buffer }
  | { kind: 'video_start'; mime: string }
  | { kind: 'chunk'; bytes: Buffer }
  | { kind: 'done'; timings: Record<string, number> }

/**
 * The facts, request and result types of each modality, which `ModelEntry<M>` uses for modality `M`. A plugin adds a
 * modality through declaration merging: `declare module '@dv/models' { interface ModalityTypes { audio: { … } } }`.
 */
export interface ModalityTypes {
  video: { facts: RenderModelFacts; request: RenderRequest; result: AsyncIterable<RenderStreamEvent> }
}

/**
 * One catalog entry, which a provider plugin implements and registers: one model of the provider serving one task. A
 * model that serves several tasks is registered once per task. `ModelEntry<M>` is an entry of modality `M`: its key names
 * one task of `M`, and `ModalityTypes[M]` gives the types of its facts, request and result.
 *
 * Entries must honor these semantics:
 * - `facts()` and `schema()` resolve with values read from the backend; they reject when the backend cannot be reached.
 *   `schema()` holds everything the agent reads about the model's limits, because the catalog returns it unchanged.
 * - `validateGenerationRequest(request)` resolves with every reason the model cannot render the request, including
 *   invalid `extra` values; it resolves with an empty list when the model renders it, and rejects when the backend
 *   cannot be reached.
 * - `render(request, signal)` reads each input asset through `dvAssetPool`; yields one `video_start`, the `chunk`
 *   events, then one `done`, and exactly one `last_frame` before `video_start` or after the last `chunk`; rejects for
 *   any backend failure. Aborting `signal` cancels the render and rejects with its reason.
 */
export interface ModelEntry<M extends ModalityId> {
  modality: M
  task: TaskOfModality<M>
  /** The provider plugin's name for the backend that serves the model, such as `fastvideo`. */
  provider: string
  /** The provider's name for the model, such as `fasth3`. */
  model: string
  /** The model's strengths and weaknesses, for the agent and the user to choose between similar models. */
  description: string
  /** GPU seconds per rendered video second, for the GPU estimate of a render before it runs. */
  gpuSecondsPerVideoSecond: number
  /**
   * Read the facts that a request of this entry is built from.
   * @returns the facts.
   * @throws Error when the backend cannot be reached.
   */
  facts(): Promise<ModalityTypes[M]['facts']>
  /**
   * Read the model's own description of the requests it accepts: its limits, the inputs it takes with their media types
   * and counts, and the parameters it takes in `extra`. The catalog returns it to the agent unchanged.
   * @returns the description.
   * @throws Error when the backend cannot be reached.
   */
  schema(): Promise<JsonValue>
  /**
   * Check one request.
   * @param request - the request as `render` would receive it.
   * @returns the problems, each one agent-facing sentence; empty when the model renders the request.
   * @throws Error when the backend cannot be reached.
   */
  validateGenerationRequest(request: ModalityTypes[M]['request']): Promise<string[]>
  /**
   * Render one request, such as one shot of a video entry.
   * @param request - the request of the entry's modality.
   * @param signal - cancels the render.
   * @returns the result of the entry's modality, such as the render stream of a video entry.
   */
  render(request: ModalityTypes[M]['request'], signal?: AbortSignal): ModalityTypes[M]['result']
}

/** A filter of `dvModels.list`: an entry matches when it equals every given field. */
export type ModelFilter = Partial<Pick<ModelKey, 'modality' | 'task' | 'provider'>>
