/**
 * The Shot render component of DreamVerse as the `dvShotRender` Cordis service: the Consumer of the model catalog of
 * `@dv/models`. It owns one operation, `shot.render` (tool `dv_shot_render`): one take of a shot rendered by the model
 * and in the generation mode the call names, both required. Mode `reference` takes 1 to N reference images (the images
 * of the characters, locations and styles it names) and optionally a first frame, usually the last still of the shot it
 * continues; mode `text` takes the prompt alone. A model accepts only the inputs it declares for the mode, and its own
 * parameters go in `extra`, checked against the parameters the model declares for the mode.
 *
 * The operation exists while the catalog holds at least one model, and it is registered again on every catalog change,
 * so its `model` param lists exactly the registered models. The model's facts in the mode decide the frame size and
 * frame count. Every render stores the video and its last still as two outputs (`video`, `last_still`), so a later shot
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
import type {} from '@dv/asset-pool'
import { MODES, type ModeDeclaration, type ModeId, type ModelEntry, type RenderModelFacts, type RenderStreamEvent } from '@dv/models'
import type {
  AssetId, OperationContext, OperationInput, OperationResult, OperationSpec, OperationToolCall, ProjectId, ProjectRecord, ProjectState,
  RecordId, RecordInputRef, RunRequest,
} from '@dv/project'
import { RENDER_OPERATION, shotReducer } from './reducer.ts'
import { backendSeconds, baseMime, imageLabels, number, shotGeometry, text, type ShotGeometry } from './render.ts'

export type * from './types.ts'
export { RENDER_OPERATION } from './reducer.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Shot render component: one take of a shot per render call. */
    dvShotRender: DvShotRender
  }
}

/** `dvShotRender` plugin configuration: none; each model reports its GPU rate in its facts. */
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
    description: 'A render record whose last_still (output #1) this shot starts from; only in a mode whose model accepts a first frame.',
  },
}

/**
 * The params of `shot.render`: the model and mode, the prompt, the shot's geometry and seed, the model's own parameters,
 * and the plan that scheduled it.
 * @param models - the registered model names, at least one.
 * @returns the params.
 */
function renderParams(models: string[]): OperationSpec['params'] {
  return {
    model: { type: 'string', enum: models, required: true, description: 'A model from the video model list.' },
    mode: { type: 'string', enum: Object.keys(MODES), required: true, description: 'A mode the model supports (see the video model list).' },
    prompt: {
      type: 'string', required: true,
      description: 'The complete shot prompt, written with the prompt skill of its model and mode; it names the images by position: '
        + 'the reference images in input order, then the first frame.',
    },
    duration_sec: { type: 'integer', description: 'Whole seconds within the model range; default the model minimum.' },
    aspect_ratio: { type: 'string', description: 'One of the model aspect ratios; default the first.' },
    resolution: { type: 'string', description: 'One of the model resolutions; default the first.' },
    seed: { type: 'integer', description: 'Fixed seed; omitted, a random seed is drawn and recorded.' },
    extra: {
      type: 'object', additionalProperties: true,
      description: 'The model\'s own parameters in this mode, as dv_models_get lists them; omit it when the model has none.',
    },
    // Set when an approved plan schedules the render; the live stream shows the shot position.
    plan: { type: 'string', description: 'The plan ID (p1, p2, …) whose approval scheduled this render; set by dv_plan_approve.' },
    plan_version: { type: 'integer', description: 'The approved version of that plan; set by dv_plan_approve.' },
    shot: { type: 'integer', description: 'The shot position in that version, 1 = first; set by dv_plan_approve.' },
  }
}

/** The inputs of `shot.render`; a model accepts the subset it declares for the mode. */
const RENDER_INPUTS: Record<string, OperationInput> = {
  reference: {
    type: 'image', many: true, bible: true,
    description: 'Reference images, or character, location and style versions whose reference images the shot carries, in prompt '
      + 'order. Mode reference only.',
  },
  first_frame: { type: 'image', description: 'The frame the shot starts from, usually output #1 of the previous shot.' },
}

/** The sentence the render description ends with. */
const TAKE_RULE = 'Outputs: the video, then its last still. Every call is a new take; a changed prompt for the same shot passes based_on.'

/**
 * The resolved assets of an input role, in input order.
 * @param context - the running call.
 * @param role - the role.
 * @returns the assets.
 */
function inputAssets(context: Pick<OperationContext, 'inputs'>, role: string): AssetId[] {
  return context.inputs.filter(input => input.role === role)
    .map(input => input.resolved_asset)
    .filter((asset): asset is AssetId => asset !== null)
}

/** The model, mode and declaration a call names, after they were checked against the catalog. */
interface Resolved {
  entry: ModelEntry
  mode: ModeId
  declaration: ModeDeclaration
}

/** The Shot render service: the `shot.render` operation while the catalog holds a model, the `shot` reducer, and the method it runs. */
export default class DvShotRender extends Service {
  static inject = ['dvProject', 'dvAssetPool', 'dvModels']
  static Config = Config

  /**
   * The latest facts each model reported per mode, by `<model>/<mode>`. The GPU estimate (`estimate`,
   * `confirmSummary`) is synchronous, so it reads the model's GPU rate from here; every facts read refreshes the entry.
   */
  private readonly facts = new Map<string, RenderModelFacts>()

  constructor(ctx: Context) {
    super(ctx, 'dvShotRender')
    ctx.effect(() => ctx.dvProject.registerReducer('shot', shotReducer), 'dvShotRender reducer')
    ctx.effect(() => {
      let removeOperation: (() => void) | null = null
      const sync = (): void => {
        removeOperation?.()
        removeOperation = null
        const models = ctx.dvModels.list()
        const names = models.map(entry => entry.id)
        for (const key of [...this.facts.keys()]) if (!names.includes(key.split('/')[0] ?? '')) this.facts.delete(key)
        if (models.length === 0) return
        for (const entry of models) {
          for (const mode of Object.keys(entry.modes) as ModeId[]) if (!this.facts.has(`${entry.id}/${mode}`)) this.prefetchFacts(entry, mode)
        }
        removeOperation = ctx.dvProject.registerOperation(this.renderOperation(names))
      }
      sync()
      const unlisten = ctx.dvModels.onChanged(sync)
      return () => {
        unlisten()
        removeOperation?.()
        this.facts.clear()
      }
    }, 'dvShotRender shot.render')
  }

  /**
   * The model and mode a call names, checked against the catalog.
   * @param params - the call's params.
   * @returns the model entry, the mode, and what the model declares for it.
   * @throws Error naming the registered models when the model is unknown, or the model's modes when it does not support
   *   the mode.
   */
  private resolve(params: Record<string, unknown>): Resolved {
    const id = text(params['model'])
    const entry = this.ctx.dvModels.get(id)
    if (entry === undefined) {
      throw new Error(`Unknown model "${id}"; models: ${this.ctx.dvModels.list().map(model => model.id).join(', ') || 'none'}.`)
    }
    const mode = text(params['mode']) as ModeId
    const declaration = Object.hasOwn(entry.modes, mode) ? entry.modes[mode] : undefined
    if (declaration === undefined) {
      throw new Error(`Model ${entry.id} does not support mode "${mode}"; its modes: ${Object.keys(entry.modes).join(', ')}.`)
    }
    return { entry, mode, declaration }
  }

  /**
   * Render one take of a shot with the model and mode of the call, and import its video and last still. While the live
   * stream service is mounted, the chunks also go to it as they arrive, so browsers watch the shot before the record
   * completes.
   * @param context - the running `shot.render` call.
   * @returns the video and last-still assets, the GPU time, and the report of the render's facts.
   * @throws Error for an unknown model or a mode it does not support, params outside the model's facts, a missing
   *   prompt, a reference count the model refuses, a model failure, or a stream that ends before the model reports
   *   completion or without a last frame.
   */
  async renderShot(context: OperationContext): Promise<OperationResult> {
    const record = context.record
    /* v8 ignore next -- a render is not a read, so it always runs with a record. */
    if (record === null) throw new Error('A render runs only with a record.')
    const { entry, mode, declaration } = this.resolve(context.params)
    const facts = await this.modelFacts(entry, mode)
    const geometry = shotGeometry(facts, context.params)
    const prompt = text(context.params['prompt'])
    if (prompt === '') throw new Error('shot.render needs a `prompt`.')
    const references = declaration.inputs.reference === undefined ? [] : inputAssets(context, 'reference')
    const firstFrame = declaration.inputs.first_frame === undefined ? null : inputAssets(context, 'first_frame')[0] ?? null
    if (declaration.inputs.reference !== undefined && references.length > facts.maxReferenceImages) {
      throw new Error(`Model ${entry.id} takes at most ${facts.maxReferenceImages} reference images in mode ${mode}; this shot has ${references.length}.`)
    }
    const pool = this.ctx.dvAssetPool
    const seed = number(context.params['seed'], randomInt(SEED_LIMIT))
    const extra = typeof context.params['extra'] === 'object' && context.params['extra'] !== null
      ? context.params['extra'] as Record<string, unknown> : {}
    const stream = entry.render(mode, {
      prompt, references: references.map(asset => pool.read(asset)), firstFrame: firstFrame === null ? null : pool.read(firstFrame),
      frameWidth: geometry.width, frameHeight: geometry.height, numFrames: geometry.numFrames, seed, extra,
    }, context.signal)
    const images = references.length > 0 || firstFrame !== null
    return await this.storeShot(context, record, facts, geometry, seed, stream, {
      model: entry.id, mode, ...images ? { image_labels: imageLabels(facts, references.length, firstFrame !== null) } : {},
    })
  }

  /**
   * Store one render stream as the video and last-still outputs of a record, and build its report.
   * @param context - the running call.
   * @param record - the running record.
   * @param facts - the model's facts in the mode.
   * @param geometry - the shot's frame size and frame count.
   * @param seed - the seed the request carried.
   * @param stream - the model's render stream.
   * @param extra - report fields of the call: the model, the mode, and the image labels.
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

  /**
   * Read a model's facts in one mode and keep them for the GPU estimate while the model stays registered.
   * @param entry - the model.
   * @param mode - a mode the model supports.
   * @returns the facts.
   * @throws Error when the model cannot read them.
   */
  private async modelFacts(entry: ModelEntry, mode: ModeId): Promise<RenderModelFacts> {
    const facts = await entry.facts(mode)
    if (this.ctx.dvModels.get(entry.id) === entry) this.facts.set(`${entry.id}/${mode}`, facts)
    return facts
  }

  /**
   * Read a newly registered model's facts in one mode in the background, so the GPU estimate knows its rate before the
   * first call; a failed read is logged and retried by the next call.
   * @param entry - the model.
   * @param mode - a mode the model supports.
   */
  private prefetchFacts(entry: ModelEntry, mode: ModeId): void {
    this.modelFacts(entry, mode).catch((error: unknown) => {
      this.ctx.logger.warn(`dvShotRender: model ${entry.id} reported no facts in mode ${mode} yet: ${String(error)}`)
    })
  }

  /** @returns the optional live stream service, looked up per render so a service mounted later is still used. */
  private liveSink(): LiveShotSink | undefined {
    return this.ctx.get('vhStream') // names:allow (the live stream service keeps its name)
  }

  /**
   * Refuse a `shot.render` call of any caller before any record when the model is unknown, the model does not support
   * the mode, `extra` names a parameter the model does not take in the mode or a value of the wrong type, an input
   * role is one the model does not accept in the mode, or the call carries fewer reference images than the model needs
   * in the mode. Character, location and style versions count their reference images, so a character created without
   * reference images adds nothing. A call that a plan scheduled (param `plan`) is told to update the plan with
   * `dv_plan_update`; `plan.approve` names the shots in front of it.
   * @param request - the call, with its input references.
   * @param state - the project's current state, which the call writes after.
   * @throws Error naming the problem; for missing reference images, telling the model to ask the user for one first.
   */
  private async precondition(request: RunRequest, state: ProjectState): Promise<void> {
    const { entry, mode, declaration } = this.resolve(request.params)
    const extra = request.params['extra']
    if (extra !== undefined) {
      const problems = typeof extra === 'object' && extra !== null && !Array.isArray(extra)
        ? this.ctx.dvModels.checkExtra(entry, mode, extra as Record<string, unknown>)
        : ['extra must be an object.']
      if (problems.length > 0) throw new Error(problems.join(' '))
    }
    for (const input of request.inputs) {
      if (!Object.hasOwn(declaration.inputs, input.role)) {
        throw new Error(`Model ${entry.id} in mode ${mode} takes no ${input.role} input; it takes: `
          + `${Object.keys(declaration.inputs).join(', ') || 'no inputs'}.`)
      }
    }
    const needed = declaration.inputs.reference?.min ?? 0
    if (needed === 0) return
    const images = (ref: RecordInputRef): number =>
      'asset' in ref || 'record' in ref ? 1 : this.ctx.dvProject.assetsOf(state, ref)?.length ?? 0
    const count = request.inputs.filter(input => input.role === 'reference').reduce((sum, input) => sum + images(input.ref), 0)
    if (count >= needed) return
    const limit = (await this.modelFacts(entry, mode)).maxReferenceImages
    const planned = request.params['plan'] !== undefined
    const textModels = this.ctx.dvModels.list().filter(model => model.modes.text !== undefined).map(model => model.id)
    const fromText = textModels.length === 0 ? '' : ` A shot that needs no reference image can use mode text with ${textModels.join(', ')}.`
    throw new Error(`Model ${entry.id} in mode ${mode} renders a shot from ${needed} to ${limit} reference images`
      + `${planned ? '' : ', and this shot has none'}. Nothing was rendered. Ask the user for a reference image of the subject `
      + '(they can attach one in the chat; it appears under Imported images), add it as a reference or to the character, '
      + `${planned ? 'update the plan with dv_plan_update, ' : ''}then call again.${fromText}`)
  }

  /**
   * Prepare an agent call of `shot.render`: read the model's facts (the agreement text reads its GPU rate), turn
   * `continue_from` into the `first_frame` input, and apply the precondition before Project asks for the user's agreement.
   * @param call - the parsed call.
   * @throws Error from the precondition, or when `continue_from` names a first frame the model does not take in the mode.
   */
  private async prepareCall(call: OperationToolCall): Promise<void> {
    const { args, request, state } = call
    const { entry, mode, declaration } = this.resolve(request.params)
    await this.modelFacts(entry, mode)
    const continueFrom = text(args['continue_from'])
    if (continueFrom !== '') {
      if (declaration.inputs.first_frame === undefined) {
        throw new Error(`Model ${entry.id} in mode ${mode} takes no first frame, so continue_from does not apply.`)
      }
      request.inputs.push({ role: 'first_frame', ref: { record: brandString<RecordId>(continueFrom), output: 1 } })
    }
    await this.precondition(request, state)
  }

  /**
   * The GPU estimate of one render: its duration times the `gpuSecondsPerVideoSecond` of its model in its mode.
   * @param params - the call's params.
   * @returns the estimate from `duration_sec`, or from 5 seconds when the call names none; 0 while the model has
   *   reported no facts in the mode (its backend was never reached, so the render cannot run either).
   */
  private estimate(params: Record<string, unknown>): { gpu_seconds: number } {
    const durationSec = number(params['duration_sec'], 0)
    const rate = this.facts.get(`${text(params['model'])}/${text(params['mode'])}`)?.gpuSecondsPerVideoSecond ?? 0
    return { gpu_seconds: (durationSec > 0 ? durationSec : ESTIMATE_DURATION_SEC) * rate }
  }

  /**
   * The `shot.render` operation.
   * @param models - the registered model names.
   * @returns the operation.
   */
  private renderOperation(models: string[]): OperationSpec {
    return {
      name: RENDER_OPERATION,
      component: 'shot',
      version: '1',
      description: 'Render one take of a shot with a model from the video model list, in one of its modes; model and mode are '
        + 'required. Mode reference renders from reference images through the reference input: imported images, or character, '
        + 'location and style versions with reference images (c1@1). Mode text renders from the prompt alone. Pass continue_from to '
        + 'start from the last still of an earlier shot when the model takes a first frame in the mode. The model\'s own parameters '
        + 'go in extra (see dv_models_get). ' + TAKE_RULE,
      inputs: RENDER_INPUTS,
      params: renderParams(models),
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
          text: `Render ${planShot(params)} with ${text(params['model'])} (${text(params['mode'])})${durationSec > 0 ? `, ${durationSec} s` : ''}: `
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
