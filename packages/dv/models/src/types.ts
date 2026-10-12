/**
 * Types of the DreamVerse model catalog: the generation modes every model chooses from, the model entries that company
 * plugins register, the facts a model reports for one mode, the render request, and the render stream. A model and a
 * mode are two separate choices: a model declares which modes it supports, and a render names both.
 *
 * @module @dv/models/types
 */
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

/**
 * A generation mode: which inputs a render takes. `reference`: reference images (character, location and style
 * versions, or imported images) and optionally a first frame; `text`: the prompt alone.
 */
export type ModeId = 'reference' | 'text'

/** An input role of a render: `reference` (reference images in prompt order) or `first_frame` (the frame it starts from). */
export type InputRole = 'reference' | 'first_frame'

/** What one generation mode means, for every model that supports it. */
export interface ModeDefinition {
  /** One model-facing sentence. */
  description: string
  /** The input roles the mode allows; a model declares the subset it accepts. */
  inputs: readonly InputRole[]
}

/** The inputs one model accepts in one mode: each accepted role with the smallest count a render needs. */
export type ModeInputs = Partial<Record<InputRole, { min: number }>>

/** What one model supports in one mode, declared when the model registers. */
export interface ModeDeclaration {
  /** The accepted input roles; a role the mode allows but the model omits is refused. */
  inputs: ModeInputs
  /** The model's own parameters in this mode, passed in the render's `extra` param; empty when it has none. */
  extra: ParameterSchemaSpec
  /** GPU seconds per rendered video second in this mode, for the GPU estimate of a render before it runs. */
  gpuSecondsPerVideoSecond: number
}

/**
 * The facts of one model in one mode, read from its backend. Shot render reads them to choose the frame size and frame
 * count of a shot and to check the reference images. Map keys keep the backend's values, such as `16:9` or `720p`.
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
  /** The most reference images one request carries besides its first frame; 0 in a mode without reference images. */
  maxReferenceImages: number
  /**
   * The prompt labels of the request images in request order (`Picture 1`, `Picture 2`, …): the reference images in
   * input order, then the first frame. Empty in a mode without images.
   */
  imageLabels: string[]
}

/** One render: the prompt, the images the mode takes, the frame size and count, the seed, and the model's own parameters. */
export interface RenderRequest {
  prompt: string
  /** Image bytes of the reference images in input order; empty in a mode without references. */
  references: Buffer[]
  /** Image bytes of the frame the video starts from, or null. */
  firstFrame: Buffer | null
  frameWidth: number
  frameHeight: number
  numFrames: number
  seed: number
  /** Values of the model's own parameters for this mode, already checked against its `extra` schema. */
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
 * One model in the catalog. A company plugin registers one entry per model it serves, with the modes it serves the
 * model in. Every render names a model and one of its modes.
 *
 * Models must honor these semantics:
 * - `facts(mode)` resolves with the facts of the model in that mode; rejects when the backend cannot be reached.
 * - `render(mode, request, signal)` sends the reference images in order, then the first frame; yields exactly one
 *   `last_frame`, one `video_start`, the `chunk` events, then `done`; rejects for any backend failure. Aborting `signal`
 *   cancels the render and rejects with its reason.
 */
export interface ModelEntry {
  /** The name the agent and the user choose the model by, such as `fasth3`; unique in the catalog. */
  id: string
  /** Who serves the model, such as `local FastVideo`, for the model list. */
  company: string
  /** One line that tells the model apart from the others, for the model list. */
  summary: string
  /** The modes the model supports, at least one. */
  modes: Partial<Record<ModeId, ModeDeclaration>>
  /**
   * Read the facts of the model in one mode.
   * @param mode - a mode the model supports.
   * @returns the facts.
   * @throws Error when the backend cannot be reached.
   */
  facts(mode: ModeId): Promise<RenderModelFacts>
  /**
   * Render one shot.
   * @param mode - a mode the model supports.
   * @param request - the prompt, images, frame size, frame count, seed, and the model's own parameters.
   * @param signal - cancels the render.
   * @returns the render stream.
   */
  render(mode: ModeId, request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent>
}
