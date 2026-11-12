/**
 * Types of the DreamVerse model catalog: the generation primitives and their types, the task vocabulary, the key of a
 * catalog entry, the video render request and render stream, and the model entry that provider plugins implement. One
 * entry is one model of one provider serving one task; `ModelEntry<T>` takes the types of the primitive that task `T`
 * runs on.
 *
 * @module @dv/models/types
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { AssetId, SessionId } from '@dv/project/types'

/** A conversation's explicit video-model default. */
export interface VideoModelSelection { provider: string; model: string }

/** Conversation defaults derived from models.select records. */
export interface ModelSelections { conversations: Record<SessionId, VideoModelSelection | null> }

declare module '@dv/project/types' {
  interface ComponentStates {
    /** Present while conversation model controls are mounted. */
    models: ModelSelections
  }
}

/** An explicit configured worker for a generation or model lifecycle operation. */
export interface ModelExecutionTarget { worker: string }

/** Provider-reported installation and GPU residency. */
export interface ModelRuntimeState {
  installed: boolean
  loaded: boolean
  loading: boolean
  busy: boolean
  workers?: Array<{
    id: string
    label: string
    available: boolean
    installed: boolean
    loaded: boolean
    loading: boolean
    busy: boolean
  }>
}

/** Optional provider controls over an installed model's GPU residency. */
export interface ModelRuntime {
  status(signal?: AbortSignal, target?: ModelExecutionTarget): Promise<ModelRuntimeState>
  load(signal?: AbortSignal, target?: ModelExecutionTarget): Promise<void>
  unload(signal?: AbortSignal, target?: ModelExecutionTarget): Promise<void>
}

/**
 * The generation primitives: one row per input and output signature, with the output modality, the facts a request is
 * built from, the request, the result of `render`, and the entry fields that only this primitive reads. The catalog
 * declares only `video`. The package that defines a primitive declares its row, and the tasks that run on it, through
 * declaration merging: `declare module '@dv/models' { interface PrimitiveTypes { <name>: { modality; facts; request;
 * result; entry } } interface TaskMap { <task>: '<name>' } }`.
 */
export interface PrimitiveTypes {
  video: {
    modality: 'video'
    facts: RenderModelFacts
    request: RenderRequest
    result: AsyncIterable<RenderStreamEvent>
    /** Entry fields that only this primitive reads: none. */
    entry: Record<never, never>
  }
}

/** One generation primitive, such as `video`. */
export type PrimitiveId = keyof PrimitiveTypes

/**
 * The generation tasks, each mapped to the primitive it runs on. `t2v`: a video from the prompt alone; `ref2v`: a video
 * from reference media and the prompt, optionally from a first frame; `fl2v`: a video between first and last images.
 * `i2v`: a video beginning at one image; `l2v`: a video ending at one image. A plugin adds a task through declaration merging:
 * `declare module '@dv/models' { interface TaskMap { v2v: 'video' } }`.
 */
export interface TaskMap {
  t2v: 'video'
  ref2v: 'video'
  fl2v: 'video'
  i2v: 'video'
  l2v: 'video'
}

/** One generation task, such as `ref2v`. */
export type TaskId = keyof TaskMap

/** One output modality, such as `video`: the `modality` of a primitive. */
export type ModalityId = PrimitiveTypes[PrimitiveId]['modality']

/** One task that runs on primitive `P`, such as `t2v | ref2v` for `video`. */
export type TaskOfPrimitive<P extends PrimitiveId> = { [T in TaskId]: TaskMap[T] extends P ? T : never }[TaskId]

/** The key of one catalog entry: one model of one provider, serving one task of the task's modality. */
export interface ModelKey<T extends TaskId = TaskId> {
  /** The modality of the primitive that the task runs on. */
  modality: PrimitiveTypes[TaskMap[T]]['modality']
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
  frameSizes?: Record<string, Record<string, [number, number]>>
  /** The shortest shot in whole seconds. */
  minDurationSec: number
  /** The longest shot in whole seconds. */
  maxDurationSec: number
  /** The model's frame count by shot duration in whole seconds, for every duration from the minimum to the maximum. */
  numFramesByDurationSec?: Record<string, number>
  /** Exact supported durations for APIs that accept seconds and do not publish frame counts. */
  durationsSec?: number[]
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
  /** The asset the video ends at, or null. Separate from general reference media. */
  lastFrame: AssetId | null
  /** Pixel geometry and frame count are present only when the provider publishes them. */
  frameWidth?: number
  frameHeight?: number
  numFrames?: number
  /** Duration-based output selection, used when the provider does not expose frame counts. */
  durationSec?: number
  aspectRatio?: string
  resolution?: string
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
  | { kind: 'done'; timings: Record<string, number>; worker?: { id: string; label: string } }

/**
 * One catalog entry, which a provider plugin implements and registers: one model of the provider serving one task. A
 * model that serves several tasks is registered once per task. The row of the task's primitive in `PrimitiveTypes`
 * gives the entry's extra fields and the types of its facts, request and result.
 *
 * Entries must honor these semantics:
 * - `facts()` and `schema()` resolve with values read from the backend; they reject when the backend cannot be reached.
 * - `validateGenerationRequest(request)` resolves with every reason the model cannot render the request, including
 *   invalid `extra` values; it resolves with an empty list when the model renders it, and rejects when the backend
 *   cannot be reached.
 * - `render(request, signal)` reads each input asset through `dvAssetPool`; a `video` entry yields one `video_start`,
 *   the `chunk` events, then one `done`, and exactly one `last_frame` before `video_start` or after the last `chunk`;
 *   rejects for any backend failure. Aborting `signal` cancels the render and rejects with its reason.
 */
export type ModelEntry<T extends TaskId = TaskId> = ModelKey<T> & PrimitiveTypes[TaskMap[T]]['entry'] & {
  /** The provider reserves independent workers safely for overlapping render calls. */
  concurrentRenders?: boolean
  /** Whether this provider honors explicit worker targets without fallback. */
  workerRouting?: boolean
  /** Creator-facing variant name; absent, use the model key. */
  displayName?: string
  /** Present when the provider supports native model loading and unloading. */
  runtime?: ModelRuntime
  /** The model's strengths and weaknesses, for the agent and the user to choose between similar models. */
  description: string
  /**
   * Read the facts that a request of this entry is built from.
   * @returns the facts.
   * @throws Error when the backend cannot be reached.
   */
  facts(target?: ModelExecutionTarget): Promise<PrimitiveTypes[TaskMap[T]]['facts']>
  /**
   * Read the model's own description of the requests it accepts: the limits that the agent needs, such as durations,
   * aspect ratios and resolutions; the inputs it takes with their media types and counts; and the parameters it
   * takes in `extra`. The catalog returns it to the agent unchanged.
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
  validateGenerationRequest(request: PrimitiveTypes[TaskMap[T]]['request'], target?: ModelExecutionTarget): Promise<string[]>
  /**
   * Render one request, such as one shot of a `video` entry.
   * @param request - the request of the task's primitive, such as a `RenderRequest`.
   * @param signal - cancels the render.
   * @returns the result of the task's primitive, such as the render stream of a `video` entry.
   */
  render(request: PrimitiveTypes[TaskMap[T]]['request'], signal?: AbortSignal, target?: ModelExecutionTarget): PrimitiveTypes[TaskMap[T]]['result']
  /**
   * The prompt skill of this model and task, when the model has its own prompt rules: the skill name, a description
   * that names the model and the task and no tool, and the skill body. While the entry is registered and the DSH skill
   * registry is mounted, the catalog registers it as a runtime skill that only the agent loads.
   */
  promptSkill?: { name: string; description: string; content: string }
}

/** A filter of `dvModels.list`: an entry matches when it equals every given field. */
export type ModelFilter = Partial<Pick<ModelKey, 'modality' | 'task' | 'provider'>>
