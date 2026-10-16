/**
 * The Shot render component of DreamVerse as the `dvShotRender` Cordis service: the Consumer of the model catalog of
 * `@dv/models`. It owns one operation, `shot.render` (tool `dv_shot_render`): one take of a shot rendered by the catalog
 * entry whose key the call names in the required params `modality`, `task`, `provider` and `model`. Task `ref2v` takes
 * reference media (imported assets, or the assets of the characters, locations and styles it names) and optionally a
 * first frame, usually the last still of the shot it continues. The entry's `validateGenerationRequest` decides which
 * inputs and which values of the model's own parameters (`extra`) it renders, and the entry's schema describes them to
 * the agent. The model receives asset IDs and reads each asset from the asset pool.
 *
 * The operation exists while the catalog holds at least one model. The model's facts decide the frame size and frame
 * count. Every render stores the video and its last still as two outputs (`video`, `last_still`), so a later shot
 * can start from output `#1`. The component's reducer groups the takes of each shot in the `shot` slice. While the
 * optional live stream service is mounted, the video bytes also go to browsers as the model produces them.
 *
 * @module @dv/shot-render
 */
import { randomInt } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  formatModelKey, type ModalityId, type ModelEntry, type ModelKey, type RenderModelFacts, type RenderRequest, type RenderStreamEvent,
  type TaskId,
} from '@dv/models'
import {
  citedAsset, citedInput, parsePromptCitations, type AssetId, type OperationContext, type OperationInput, type OperationResult,
  type OperationSpec, type OperationToolCall, type ProjectId, type ProjectRecord, type ProjectState, type RecordId, type RecordInput,
  type RecordInputRef, type RunRequest,
} from '@dv/project'
import { RENDER_OPERATION, shotReducer } from './reducer.ts'
import { backendSeconds, baseMime, number, shotGeometry, text, type ShotGeometry } from './render.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Shot render component: one take of a shot per render call. */
    dvShotRender: DvShotRender
  }
}

/** `dvShotRender` plugin configuration: none; each catalog entry carries its GPU rate. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

/** The seed range of the render backends. */
const SEED_LIMIT = 2 ** 31

/** The duration the GPU estimate assumes for a call that names none. */
const ESTIMATE_DURATION_SEC = 5

/**
 * Where a shot's bytes go while the model is still producing them, so browsers can watch the shot render: the
 * structural type of the optional live stream service's `openSegment`.
 */
interface LiveShotSink {
  openSegment(projectId: ProjectId, record: RecordId, init: { mime: string; segmentIdx: number }): {
    chunk(bytes: Uint8Array): void
    complete(): void
    fail(error: Error): void
  }
}

/** The live stream of one shot, or null while no sink is mounted. */
type LiveShot = ReturnType<LiveShotSink['openSegment']> | null

/** The tool-only argument of `dv_shot_render` that names the take whose last still the new shot starts from. */
const CONTINUE_FROM_PARAM: ParameterSchemaSpec = {
  continue_from: {
    type: 'string',
    description: 'A render record whose last_still (output #1) this shot starts from; only when the model takes a first frame.',
  },
}

/**
 * The params of `shot.render`: the model key, the prompt, the shot's geometry and seed, the model's own parameters, and
 * the plan that scheduled it.
 */
const RENDER_PARAMS: OperationSpec['params'] = {
  modality: { type: 'string', required: true, description: 'The modality of a model that dv_models_list lists.' },
  task: { type: 'string', required: true, description: 'The task of that model, as dv_models_list lists it.' },
  provider: { type: 'string', required: true, description: 'The provider of that model, as dv_models_list lists it.' },
  model: { type: 'string', required: true, description: 'The model name, as dv_models_list lists it.' },
  prompt: {
    type: 'string', required: true,
    description: 'The complete shot prompt, written with the prompt skill of its model and task; it cites each reference image '
      + 'of the reference input as @[<label>](dv:asset/<asset ID>) where it names it.',
  },
  duration_sec: { type: 'integer', description: 'Whole seconds within the model range; default the model minimum.' },
  aspect_ratio: { type: 'string', description: 'One of the model aspect ratios; default the first.' },
  resolution: { type: 'string', description: 'One of the model resolutions; default the first.' },
  seed: { type: 'integer', description: 'Fixed seed; omitted, a random seed is drawn and recorded.' },
  extra: {
    type: 'object', additionalProperties: true,
    description: 'The model\'s own parameters, as dv_models_get lists them; omit it when the model has none.',
  },
  // Set when an approved plan schedules the render; the live stream shows the shot position.
  plan: { type: 'string', description: 'The plan ID (p1, p2, …) whose approval scheduled this render; set by dv_plan_approve.' },
  plan_version: { type: 'integer', description: 'The approved version of that plan; set by dv_plan_approve.' },
  shot: { type: 'integer', description: 'The shot position in that version, 1 = first; set by dv_plan_approve.' },
}

/** The inputs of `shot.render`; a model accepts the subset its schema lists. */
const RENDER_INPUTS: Record<string, OperationInput> = {
  reference: {
    type: 'any', many: true, bible: true,
    description: 'Reference media in prompt order: imported assets, or character, location and style versions whose reference '
      + 'assets the shot carries; the model accepts the media types dv_models_get lists. Task ref2v only.',
  },
  first_frame: { type: 'image', description: 'The frame the shot starts from, usually output #1 of the previous shot.' },
}

/** The sentence the render description ends with. */
const TAKE_RULE = 'Outputs: the video, then its last still. Every call is a new take; a changed prompt for the same shot passes based_on.'

/**
 * The catalog key that a call's params name. A modality or task outside the vocabulary names no entry, so
 * `dvModels.get` finds none for it.
 * @param params - the call's params.
 * @returns the key.
 */
function modelKey(params: Record<string, unknown>): ModelKey {
  return {
    modality: text(params['modality']) as ModalityId, task: text(params['task']) as TaskId,
    provider: text(params['provider']), model: text(params['model']),
  }
}

/**
 * The resolved assets of an input role, in input order.
 * @param inputs - the call's input assets with their roles.
 * @param role - the role.
 * @returns the assets.
 */
function inputAssets(inputs: ReadonlyArray<Pick<RecordInput, 'role' | 'resolved_asset'>>, role: string): AssetId[] {
  return inputs.filter(input => input.role === role)
    .map(input => input.resolved_asset)
    .filter((asset): asset is AssetId => asset !== null)
}

/**
 * The problems of a prompt's citations: a citation of an input role (`dv:input/<role>`) that the call has no input of, or
 * of the `reference` role, which a prompt cites by asset; a citation of anything other than an asset or an input; and a
 * citation of an asset that is not one of the `reference` assets.
 * @param prompt - the prompt.
 * @param references - the `reference` assets of the call.
 * @param roles - the input roles of the call, such as `first_frame`, including inputs whose value does not exist yet.
 * @returns one sentence per problem; empty when every citation names a reference asset or an input of the call.
 */
function citationProblems(prompt: string, references: readonly AssetId[], roles: ReadonlySet<string>): string[] {
  return parsePromptCitations(prompt).flatMap((citation) => {
    const role = citedInput(citation.uri)
    if (role !== null) {
      return role !== 'reference' && roles.has(role) ? [] : [`The prompt cites the input ${role}, which this call does not have.`]
    }
    const asset = citedAsset(citation.uri)
    if (asset === null) return [`The prompt cites ${citation.uri}; a shot prompt cites only reference assets and inputs of the call.`]
    return references.includes(asset) ? [] : [`The prompt cites asset ${asset}, which is not in the reference input.`]
  })
}

/**
 * The render request of a call: its prompt, its `reference` assets in input order, its `first_frame` asset, the frame
 * size and frame count from the model's facts, the seed (the call's `seed`, else a random one), and the model's own
 * parameters.
 * @param facts - the model's facts.
 * @param params - the call's params.
 * @param inputs - the call's input assets with their roles.
 * @returns the request and the shot's geometry.
 * @throws Error for a missing prompt, a citation that names no `reference` asset, params outside the facts, or more than
 *   one `first_frame` input.
 */
function renderRequest(
  facts: RenderModelFacts, params: Record<string, unknown>, inputs: Array<Pick<RecordInput, 'role' | 'resolved_asset'>>,
): { request: RenderRequest; geometry: ShotGeometry } {
  const prompt = text(params['prompt'])
  if (prompt === '') throw new Error('shot.render needs a `prompt`.')
  const references = inputAssets(inputs, 'reference')
  // An output of a record that has not finished counts here although it has no asset yet.
  const firstFrameCount = inputs.filter(input => input.role === 'first_frame').length
  const problems = citationProblems(prompt, references, new Set(inputs.map(input => input.role)))
  if (problems.length > 0) throw new Error(`${problems.join(' ')} Cite only the assets of inputs.reference and the inputs of the call.`)
  if (firstFrameCount > 1) throw new Error(`shot.render takes one first_frame input; this call has ${firstFrameCount}.`)
  const firstFrames = inputAssets(inputs, 'first_frame')
  const geometry = shotGeometry(facts, params)
  return {
    request: {
      prompt, references, firstFrame: firstFrames[0] ?? null,
      frameWidth: geometry.width, frameHeight: geometry.height, numFrames: geometry.numFrames,
      seed: number(params['seed'], randomInt(SEED_LIMIT)),
      extra: (params['extra'] ?? {}) as Record<string, unknown>,
    },
    geometry,
  }
}

/** The Shot render service: the `shot.render` operation while the catalog holds a model, the `shot` reducer, and the method it runs. */
export default class DvShotRender extends Service {
  static inject = ['dvProject', 'dvModels']
  static Config = Config

  constructor(ctx: Context) {
    super(ctx, 'dvShotRender')
    ctx.effect(() => ctx.dvProject.registerReducer('shot', shotReducer), 'dvShotRender reducer')
    ctx.effect(() => {
      let removeOperation: (() => void) | null = null
      // The operation is registered when the catalog gains its first model and removed when it loses its last.
      const sync = (): void => {
        const serving = ctx.dvModels.list().length > 0
        if (serving === (removeOperation !== null)) return
        removeOperation?.()
        removeOperation = serving ? ctx.dvProject.registerOperation(this.renderOperation()) : null
      }
      sync()
      const unlisten = ctx.dvModels.onChanged(sync)
      return () => {
        unlisten()
        removeOperation?.()
      }
    }, 'dvShotRender shot.render')
  }

  /**
   * The catalog entry whose key a call names.
   * @param params - the call's params.
   * @returns the entry.
   * @throws Error naming the key and `dv_models_list` when no entry has the key.
   */
  private resolve(params: Record<string, unknown>): ModelEntry {
    const key = modelKey(params)
    const entry = this.ctx.dvModels.get(key)
    if (entry === undefined) throw new Error(`Unknown model "${formatModelKey(key)}"; call dv_models_list for the models.`)
    return entry
  }

  /**
   * Render one take of a shot with the model of the call, and import its video and last still. While the live
   * stream service is mounted, the chunks also go to it as they arrive, so browsers watch the shot before the record
   * completes.
   * @param context - the running `shot.render` call.
   * @returns the video and last-still assets, the GPU time, and the report of the render's facts.
   * @throws Error for a key that names no catalog entry, params outside the model's facts, a missing
   *   prompt, a request that the model's `validateGenerationRequest` refuses, a model failure, or a stream that ends
   *   before the model reports completion or without a last frame.
   */
  async renderShot(context: OperationContext): Promise<OperationResult> {
    const record = context.record
    /* v8 ignore next -- a render is not a read, so it always runs with a record. */
    if (record === null) throw new Error('A render runs only with a record.')
    const entry = this.resolve(context.params)
    const facts = await entry.facts()
    const { request, geometry } = renderRequest(facts, context.params, context.inputs)
    // A record output that had not finished when the precondition ran is an asset now, so the model sees every asset.
    await this.validate(entry, request, context.params)
    const stream = entry.render(request, context.signal)
    const key = { modality: entry.modality, task: entry.task, provider: entry.provider, model: entry.model }
    return await this.storeShot(context, record, facts, geometry, request.seed, stream, key)
  }

  /**
   * Store one render stream as the video and last-still outputs of a record, and build its report.
   * @param context - the running call.
   * @param record - the running record.
   * @param facts - the model's facts.
   * @param geometry - the shot's frame size and frame count.
   * @param seed - the seed the request carried.
   * @param stream - the model's render stream.
   * @param extra - report fields of the call: the model key.
   * @returns the outputs, the GPU time, and the report.
   */
  private async storeShot(
    context: OperationContext, record: ProjectRecord, facts: RenderModelFacts, geometry: ShotGeometry, seed: number,
    stream: AsyncIterable<RenderStreamEvent>, extra: Record<string, unknown>,
  ): Promise<OperationResult> {
    const streamed = await this.streamShot(context, record.id, stream)
    const shortId = record.id.slice(0, 8)
    const video = context.importAsset({ path: streamed.videoPath }, {
      mime: baseMime(streamed.mime), name: `${shortId}.mp4`, durationSec: geometry.durationSec,
      width: geometry.width, height: geometry.height,
    })
    const frame = context.importAsset(streamed.lastFrame, {
      mime: 'image/png', name: `${shortId}-last.png`, width: geometry.width, height: geometry.height,
    })
    return {
      outputs: [video, frame],
      cost: { gpu_seconds: backendSeconds(streamed.timings) },
      report: {
        seed, model_id: facts.modelId, aspect_ratio: geometry.aspectRatio, resolution: geometry.resolution,
        duration_sec: geometry.durationSec, frame_width: geometry.width, frame_height: geometry.height, num_frames: geometry.numFrames,
        ...extra, timings: streamed.timings,
      },
    }
  }

  /**
   * Write one render stream into a scratch file and, while it is mounted, into the live stream service.
   * @param context - the running call.
   * @param record - the running record, which names the live stream.
   * @param stream - the model's render stream.
   * @returns the video file, its media type, the last frame, and the backend's timings.
   * @throws Error for a provider failure, or when the stream ends before completion or without a last frame.
   */
  private async streamShot(
    context: OperationContext, record: RecordId, stream: AsyncIterable<RenderStreamEvent>,
  ): Promise<{ videoPath: string; mime: string; lastFrame: Buffer; timings: Record<string, number> }> {
    const videoPath = join(context.scratchDir, 'shot.mp4')
    const file = createWriteStream(videoPath)
    let lastFrame: Buffer | null = null
    let mime: string | null = null
    let timings: Record<string, number> = {}
    let finished = false
    let live: LiveShot = null
    try {
      for await (const event of stream) {
        switch (event.kind) {
          case 'last_frame':
            lastFrame = event.png
            break
          case 'video_start':
            mime = event.mime
            // The shot number a plan assigned tells the page which shot is playing; a free-standing shot has none.
            live = this.liveSink()?.openSegment(context.project, record, {
              mime: event.mime, segmentIdx: number(context.params['shot'], 0),
            }) ?? null
            break
          case 'chunk':
            live?.chunk(event.bytes)
            if (!file.write(event.bytes)) await new Promise<void>(resolve => file.once('drain', resolve))
            break
          case 'done':
            timings = event.timings
            finished = true
            live?.complete()
            live = null
            break
          /* v8 ignore next 4 -- closed-union exhaustiveness guard. */
          default: {
            const unexpected: never = event
            throw new Error(`Unexpected render stream event: ${JSON.stringify(unexpected)}`)
          }
        }
      }
    } catch (error) {
      live?.fail(error instanceof Error ? error : new Error(String(error)))
      live = null
      throw error
    } finally {
      await new Promise<void>(resolve => file.end(resolve))
    }
    if (live !== null) live.fail(new Error('The render stream ended before the backend reported completion.'))
    if (!finished || mime === null) throw new Error('The render stream ended before the backend reported completion.')
    if (lastFrame === null) throw new Error('The backend returned no last frame.')
    return { videoPath, mime, lastFrame, timings }
  }

  /** @returns the optional live stream service, looked up per render so a service mounted later is still used. */
  private liveSink(): LiveShotSink | undefined {
    return this.ctx.get('vhStream') // names:allow (the live stream service keeps its name)
  }

  /**
   * Refuse a `shot.render` call of any caller before any record when its key names no catalog entry, or the entry's
   * `validateGenerationRequest` refuses the call's render request, its `extra` values included. Character, location and
   * style versions stand for their reference assets. A missing prompt, a citation that names no reference asset, params
   * outside the model's facts, and more than one `first_frame` input are refused for every call; a call whose input is
   * an output of a record that has not finished is validated, `extra` included, by `renderShot` before the render. A call
   * that a plan scheduled (param `plan`) is told to update the plan with `dv_plan_update`; `plan.approve` names the shots
   * in front of it.
   * @param request - the call, with its input references.
   * @param state - the project's current state, which the call writes after.
   * @throws Error naming the problem.
   */
  private async precondition(request: RunRequest, state: ProjectState): Promise<void> {
    const entry = this.resolve(request.params)
    const inputs = request.inputs.flatMap(({ role, ref }) =>
      this.resolveRefAssets(request.project, state, ref).map(asset => ({ role, resolved_asset: asset })))
    const facts = await entry.facts()
    // A seed drawn here only completes the request checked before recording; `renderShot` draws the recorded seed.
    const { request: renderable } = renderRequest(facts, request.params, inputs)
    if (inputs.some(input => input.resolved_asset === null)) return
    await this.validate(entry, renderable, request.params)
  }

  /**
   * Refuse a render request that the model's `validateGenerationRequest` finds problems in.
   * @param entry - the catalog entry.
   * @param request - the render request.
   * @param params - the call's params; a call that a plan scheduled (param `plan`) is told to update the plan.
   * @throws Error with the model's problems and what to change before calling again.
   */
  private async validate(entry: ModelEntry, request: RenderRequest, params: Record<string, unknown>): Promise<void> {
    const problems = await entry.validateGenerationRequest(request)
    if (problems.length === 0) return
    const next = params['plan'] !== undefined
      ? 'update the plan with dv_plan_update'
      : 'change the inputs (ask the user for an asset the shot needs; they can attach it in the chat)'
    throw new Error(`Model ${formatModelKey(entry)} cannot render this shot: ${problems.join(' ')} Nothing was rendered; ${next}, then call again.`)
  }

  /**
   * The assets one input reference stands for before the record is written: an asset itself, an output of a finished
   * record, or the assets of a character, location or style version.
   * @param project - the project of the call.
   * @param state - the project's current state.
   * @param ref - the input reference.
   * @returns the assets in order; null for an output of a record that has not finished, which has no asset yet.
   */
  private resolveRefAssets(project: ProjectId, state: ProjectState, ref: RecordInputRef): Array<AssetId | null> {
    if ('asset' in ref) return [ref.asset]
    if ('record' in ref) {
      const producer = this.ctx.dvProject.getRecord(project, ref.record)
      return [producer.status === 'done' ? producer.outputs[ref.output] ?? null : null]
    }
    return this.ctx.dvProject.assetsOf(state, ref) ?? []
  }

  /**
   * Prepare an agent call of `shot.render`: turn `continue_from` into the `first_frame` input, and apply the
   * precondition before Project asks for the user's agreement. The model's `validateGenerationRequest` decides whether
   * it takes the first frame.
   * @param call - the parsed call.
   * @throws Error from the precondition.
   */
  private async prepareCall(call: OperationToolCall): Promise<void> {
    const { args, request, state } = call
    const continueFrom = text(args['continue_from'])
    if (continueFrom !== '') request.inputs.push({ role: 'first_frame', ref: { record: brandString<RecordId>(continueFrom), output: 1 } })
    await this.precondition(request, state)
  }

  /**
   * The GPU estimate of one render: its duration times the `gpuSecondsPerVideoSecond` of its catalog entry.
   * @param params - the call's params.
   * @returns the estimate from `duration_sec`, or from 5 seconds when the call names none; 0 for a key that names no
   *   catalog entry.
   */
  private estimate(params: Record<string, unknown>): { gpu_seconds: number } {
    const durationSec = number(params['duration_sec'], 0)
    const rate = this.ctx.dvModels.get(modelKey(params))?.gpuSecondsPerVideoSecond ?? 0
    return { gpu_seconds: (durationSec > 0 ? durationSec : ESTIMATE_DURATION_SEC) * rate }
  }

  /**
   * The `shot.render` operation.
   * @returns the operation.
   */
  private renderOperation(): OperationSpec {
    return {
      name: RENDER_OPERATION,
      component: 'shot',
      version: '1',
      description: 'Render one take of a shot with a model from dv_models_list; modality, task, provider and model name it and are '
        + 'required. Task ref2v renders from reference media through the reference input: imported assets, or character, '
        + 'location and style versions with reference assets (c1@1); the prompt cites each reference image as '
        + '@[<label>](dv:asset/<asset ID>). dv_models_get lists the inputs, media types and counts each model accepts. '
        + 'Pass continue_from to start from the last still of an earlier shot when the model takes a first frame. '
        + 'The model\'s own parameters go in extra (see dv_models_get). ' + TAKE_RULE,
      inputs: RENDER_INPUTS,
      params: RENDER_PARAMS,
      toolParams: CONTINUE_FROM_PARAM,
      outputs: [{ role: 'video', type: 'video' }, { role: 'last_still', type: 'image' }],
      deterministic: false,
      resource: 'gpu',
      // A shot the user did not ask for needs the user's agreement once the turn's GPU time passes the budget.
      confirm: 'over_gpu_budget',
      confirmSummary: (call) => {
        const params = call.request.params
        const durationSec = number(params['duration_sec'], 0)
        return {
          text: `Render ${planShot(params)} with ${formatModelKey(modelKey(params))}${durationSec > 0 ? `, ${durationSec} s` : ''}: `
            + `"${text(params['prompt']).slice(0, 80)}"`,
          gpu_seconds: this.estimate(params).gpu_seconds,
        }
      },
      estimate: params => this.estimate(params),
      summarize: record => `${planShot(record.params)} "${text(record.params['prompt']).slice(0, 60)}" `
        + `(${label(record.report?.['duration_sec'] ?? record.params['duration_sec'])}s, seed ${label(record.report?.['seed'])})`,
      prepareToolCall: call => this.prepareCall(call),
      precondition: (request, state) => this.precondition(request, state),
      execute: context => this.renderShot(context),
    }
  }
}

/** How a summary names the shot: `shot 7 of plan p1 v2` for a render an approved plan scheduled, else `shot`. */
function planShot(params: Record<string, unknown>): string {
  if (typeof params['plan'] !== 'string') return 'shot'
  return `shot ${label(params['shot'])} of plan ${params['plan']} v${label(params['plan_version'])}`
}

/** A number or string field as display text, or `?` for anything else. */
function label(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '?'
}
