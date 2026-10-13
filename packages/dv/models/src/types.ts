/**
 * Types of the DreamVerse model catalog: the generation modes every model chooses from, the model entries that company
 * plugins register, the facts a model reports for one mode, the render request, and the render stream. A model and a
 * mode are two separate choices: a model declares which modes it supports, and a render names both.
 *
 * @module @dv/models/types
 */
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { AssetId } from '@dv/project'

/**
 * The top-level type of an asset's MIME type, such as `image`, `video` or `audio`, as `dvAssetPool.mediaType` returns
 * it. Any string; the catalog never interprets it.
 */
export type MediaType = string

/**
 * A generation mode: which inputs a render takes. `reference`: reference media (character, location and style
 * versions, or imported assets) and optionally a first frame; `text`: the prompt alone.
 */
export type ModeId = 'reference' | 'text'

/** An input role of a render: `reference` (reference media in prompt order) or `first_frame` (the frame it starts from). */
export type InputRole = 'reference' | 'first_frame'

/** What one generation mode means, for every model that supports it. */
export interface ModeDefinition {
  /** One model-facing sentence. */
  description: string
  /** The input roles the mode allows; a model declares the subset it accepts. */
  inputs: readonly InputRole[]
}

/** One input role that a model accepts in one mode. */
export interface InputDeclaration {
  /** The fewest assets that a render needs in this role. */
  min: number
  /** The media types the role accepts; at least one. */
  mediaTypes: readonly MediaType[]
}

/** The inputs one model accepts in one mode, by role. */
export type ModeInputs = Partial<Record<InputRole, InputDeclaration>>

/**
 * What one model supports in one mode, declared when the model registers. `inputs` and the facts' `inputLimits`
 * describe the mode to the agent; Shot render renders a request only when `validateGenerationRequest` accepts it.
 */
export interface ModeDeclaration {
  /**
   * The accepted input roles, as the model list and the render tool describe them; a role the mode allows but the
   * model omits is not offered.
   */
  inputs: ModeInputs
  /** The model's own parameters in this mode, passed in the render's `extra` param; empty when it has none. */
  extra: ParameterSchemaSpec
  /** GPU seconds per rendered video second in this mode, for the GPU estimate of a render before it runs. */
  gpuSecondsPerVideoSecond: number
  /**
   * Check one render request of the model in this mode. Shot render calls it before it records a render whose input
   * assets all exist, and again before it sends the request to `render`.
   * @param request - the request as `render` would receive it.
   * @returns the problems, each one model-facing sentence; empty when the model renders the request.
   */
  validateGenerationRequest(request: RenderRequest): Promise<string[]>
}

/** The count limits of one input role, read from the backend. */
export interface InputLimits {
  /** The most assets in the role across all media types; absent when the role has no total limit. */
  maxCount?: number
  /**
   * The most assets of each media type in the role. The keys are a subset of the role's declared `mediaTypes`; a
   * declared media type without a key has no count limit.
   */
  maxCountByMediaType: Partial<Record<MediaType, number>>
}

/**
 * The facts of one model in one mode, read from its backend. Shot render reads them to choose the frame size and frame
 * count of a shot, and the model list reads the input limits. Map keys keep the backend's values, such as `16:9` or `720p`.
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
  /** The count limits by declared input role; a role without an entry has no limit beyond its declaration. */
  inputLimits: Partial<Record<InputRole, InputLimits>>
}

/**
 * One render: the prompt, the input assets the mode takes, the frame size and count, the seed, and the model's own
 * parameters. Inputs are asset IDs; the model reads each asset's bytes and media type from `dvAssetPool`.
 */
export interface RenderRequest {
  prompt: string
  /** The `reference` assets in input order; empty in a mode without references. */
  references: AssetId[]
  /** The asset the video starts from, or null. */
  firstFrame: AssetId | null
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
 * - `render(mode, request, signal)` sends the references in input order, then the first frame, reading each asset
 *   through `dvAssetPool`; yields exactly one `last_frame`, one `video_start`, the `chunk` events, then `done`; rejects
 *   for any backend failure. Aborting `signal` cancels the render and rejects with its reason.
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
   * @param request - the prompt, input assets, frame size, frame count, seed, and the model's own parameters.
   * @param signal - cancels the render.
   * @returns the render stream.
   */
  render(mode: ModeId, request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent>
}
