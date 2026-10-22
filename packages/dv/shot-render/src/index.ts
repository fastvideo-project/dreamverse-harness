/**
 * The Shot render component of DreamVerse as the `dvShotRender` Cordis service: the Consumer of the model catalog of
 * `@dv/models`. It owns one operation, `shot.render` (tool `dv_shot_render`): one take of a shot rendered by the catalog
 * entry whose key the call names in the required params `modality`, `task`, `provider` and `model`. Task `ref2v` takes
 * reference media (imported assets, or the assets of the characters, locations and styles it names) and optionally a
 * first frame, usually the last still of the shot it continues. The entry's `validateGenerationRequest` decides which
 * inputs and which values of the model's own parameters (`extra`) it renders, and the entry's schema describes them to
 * the agent. The model receives asset IDs and reads each asset from the asset pool.
 *
 * The operation exists while the catalog holds a model of task `t2v` or `ref2v`. The model's facts decide the frame size
 * and frame count. Every render stores the video and its last still as two outputs (`video`, `last_still`), so a later shot
 * can start from output `#1`. While the optional live stream service is mounted, the video bytes also go to browsers as
 * the model produces them.
 *
 * `defineGeneration` of `@dv/generation` builds the service from the declaration of `shot.render`: it registers the
 * component, the task labels and the operation, draws the seed, checks a call against the model before its record, and
 * gives workflows the `GenerationApi` methods.
 *
 * @module @dv/shot-render
 */
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { defineGeneration, type GenerationSpec, type RequestInput } from '@dv/generation'
import {
  formatModelKey, modelKey, type RenderModelFacts, type RenderRequest, type RenderStreamEvent,
} from '@dv/models'
import {
  citedAsset, citedInput, elementCitationUri, formatCitation, parsePromptCitations, replacePromptCitations, type AssetId,
  type OperationContext, type OperationInput, type OperationResult, type OperationSpec, type ProjectId, type RecordId, type RecordInput,
  type StartedBy,
} from '@dv/project'
import { backendSeconds, baseMime, number, shotGeometry, text } from './render.ts'

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
 * The params of `shot.render` between the model key and prompt and the `seed` and `extra` params, which
 * `defineGeneration` adds with its shared descriptions: the shot's geometry.
 */
const RENDER_PARAMS: OperationSpec['params'] = {
  duration_sec: { type: 'integer', description: 'Whole seconds within the model range; default the model minimum.' },
  aspect_ratio: { type: 'string', description: 'One of the model aspect ratios; default the first.' },
  resolution: { type: 'string', description: 'One of the model resolutions; default the first.' },
}

/** The inputs of `shot.render`; a model accepts the subset its schema lists. */
const RENDER_INPUTS: Record<string, OperationInput> = {
  reference: {
    type: 'any', many: true, versioned: true,
    description: 'Reference media in prompt order: imported assets, or versions (<id>@<version>) whose reference '
      + 'assets the shot carries; the model accepts the media types dv_models_get lists. Task ref2v only.',
  },
  first_frame: { type: 'image', description: 'The frame the shot starts from, usually output #1 of the previous shot.' },
}

/** The sentence the render description ends with. */
const TAKE_RULE = 'Outputs: the video, then its last still. Every call is a new take; a changed prompt for the same shot passes based_on.'

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
    if (asset === null) {
      return [`The prompt cites ${citation.uri}; a shot prompt cites only the assets and elements of its reference input `
        + 'and the inputs of the call.']
    }
    return references.includes(asset) ? [] : [`The prompt cites asset ${asset}, which is not in the reference input.`]
  })
}

/**
 * A prompt with each citation of an element in the `reference` input (`dv:character/<id>`, `dv:location/<id>` or
 * `dv:style/<id>`) expanded into the citation's label and the citations of the element's reference assets, in their
 * order: `Mia (@[Mia · 1](dv:asset/a1) @[Mia · 2](dv:asset/a2))`. A citation of anything else stays as written.
 * @param prompt - the prompt.
 * @param inputs - the call's input assets with their roles and references; a chained role has neither.
 * @returns the expanded prompt.
 */
function expandElements(prompt: string, inputs: readonly RequestInput[]): string {
  return replacePromptCitations(prompt, (citation) => {
    const assets = [...new Set(inputs.flatMap(input => input.role === 'reference' && input.resolved_asset !== null
      && input.ref !== null && elementCitationUri(input.ref) === citation.uri ? [input.resolved_asset] : []))]
    if (assets.length === 0) return prompt.slice(citation.start, citation.end)
    const label = citation.label.replaceAll(']', '')
    const cited = assets.map((asset, index) => formatCitation(`${label} · ${String(index + 1)}`, 'asset', asset))
    return `${label} (${cited.join(' ')})`
  })
}

/**
 * The render request of a call: its prompt with each element citation expanded (see `expandElements`), its
 * `reference` assets in input order, its `first_frame` asset, the frame size and frame count from the model's facts, the
 * seed, and the model's own parameters.
 * @param facts - the model's facts.
 * @param params - the call's params.
 * @param inputs - the call's input assets with their roles and references; a chained role has neither.
 * @param seed - the call's `seed`, else the random seed that `defineGeneration` drew.
 * @returns the request.
 * @throws Error for a missing prompt, a citation that names no `reference` asset, params outside the facts, or more than
 *   one `first_frame` input.
 */
function renderRequest(
  facts: RenderModelFacts, params: Record<string, unknown>, inputs: readonly RequestInput[], seed: number,
): RenderRequest {
  if (text(params['prompt']) === '') throw new Error('shot.render needs a `prompt`.')
  const prompt = expandElements(text(params['prompt']), inputs)
  const references = inputAssets(inputs, 'reference')
  // An output of a record that has not finished counts here although it has no asset yet.
  const firstFrameCount = inputs.filter(input => input.role === 'first_frame').length
  const problems = citationProblems(prompt, references, new Set(inputs.map(input => input.role)))
  if (problems.length > 0) throw new Error(`${problems.join(' ')} Cite only the assets of inputs.reference and the inputs of the call.`)
  if (firstFrameCount > 1) throw new Error(`shot.render takes one first_frame input; this call has ${firstFrameCount}.`)
  const firstFrames = inputAssets(inputs, 'first_frame')
  const geometry = shotGeometry(facts, params)
  return {
    prompt, references, firstFrame: firstFrames[0] ?? null,
    frameWidth: geometry.width, frameHeight: geometry.height, numFrames: geometry.numFrames,
    seed, extra: (params['extra'] ?? {}) as Record<string, unknown>,
  }
}

/**
 * Store one render stream as the video and last-still outputs of a record, and build its report. While the live
 * stream service is mounted, the chunks also go to it as they arrive, so browsers watch the shot before the record
 * completes.
 * @param ctx - the context of `dvShotRender`, which looks up the optional live stream service.
 * @param context - the running `shot.render` call.
 * @param stream - the model's render stream.
 * @param facts - the model's facts.
 * @param request - the render request; its prompt is the expanded prompt.
 * @returns the outputs, the GPU time, and the report of the render's facts; `defineGeneration` adds the seed.
 * @throws Error for a model failure, or a stream that ends before the model reports completion or without a last frame.
 */
async function storeShot(
  ctx: Context, context: OperationContext, stream: AsyncIterable<RenderStreamEvent>, facts: RenderModelFacts, request: RenderRequest,
): Promise<OperationResult> {
  const record = context.record
  /* v8 ignore next -- a render is not a read, so it always runs with a record. */
  if (record === null) throw new Error('A render runs only with a record.')
  const geometry = shotGeometry(facts, context.params)
  const streamed = await streamShot(ctx, context, record.id, stream)
  const shortId = record.id.slice(0, 8)
  const video = context.importAsset({ path: streamed.videoPath }, {
    mime: baseMime(streamed.mime), name: `${shortId}.mp4`, durationSec: geometry.durationSec,
    width: geometry.width, height: geometry.height,
  })
  const frame = context.importAsset(streamed.lastFrame, {
    mime: 'image/png', name: `${shortId}-last.png`, width: geometry.width, height: geometry.height,
  })
  // The record's params keep the prompt as written; the report adds the prompt that the model plugin received.
  const expanded = request.prompt === text(context.params['prompt']) ? {} : { expanded_prompt: request.prompt }
  return {
    outputs: [video, frame],
    cost: { gpu_seconds: backendSeconds(streamed.timings) },
    report: {
      model_id: facts.modelId, aspect_ratio: geometry.aspectRatio, resolution: geometry.resolution,
      duration_sec: geometry.durationSec, frame_width: geometry.width, frame_height: geometry.height, num_frames: geometry.numFrames,
      ...modelKey(context.params), ...expanded, timings: streamed.timings,
    },
  }
}

/**
 * Write one render stream into a scratch file and, while it is mounted, into the live stream service.
 * @param ctx - the context of `dvShotRender`.
 * @param context - the running call.
 * @param record - the running record, which names the live stream.
 * @param stream - the model's render stream.
 * @returns the video file, its media type, the last frame, and the backend's timings.
 * @throws Error for a provider failure, or when the stream ends before completion or without a last frame.
 */
async function streamShot(
  ctx: Context, context: OperationContext, record: RecordId, stream: AsyncIterable<RenderStreamEvent>,
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
          // The slot that the starter record gave the render tells the page which shot is playing; a free-standing shot
          // has none and plays at index 0.
          live = liveSink(ctx)?.openSegment(context.project, record, {
            mime: event.mime, segmentIdx: context.record?.started_by?.slot ?? 0,
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
function liveSink(ctx: Context): LiveShotSink | undefined {
  return ctx.get('vhStream') as LiveShotSink | undefined // names:allow (the live stream service keeps its name)
}

/**
 * The declaration of `shot.render` for `defineGeneration`. Before any record, for every caller, the call is refused when
 * its key names no catalog entry, when `renderRequest` throws, or when the entry's `validateGenerationRequest` refuses
 * the render request; a call whose input is an output of an unfinished record is validated again before the render.
 */
const RENDER_DECLARATION: GenerationSpec<'video'> = {
  service: 'dvShotRender',
  component: 'shot',
  operation: 'shot.render',
  primitive: 'video',
  tasks: { t2v: { zh: '文字生成', en: 'From text' }, ref2v: { zh: '参考图生成', en: 'From references' } },
  label: { zh: '渲染镜头', en: 'Render shot' },
  description: 'Render one take of a shot with a model from dv_models_list; modality, task, provider and model name it and are '
    + 'required. Task ref2v renders from reference media through the reference input: imported assets, or versions '
    + 'with reference assets (<id>@<version>, such as c1@1); the prompt cites each reference image as '
    + '@[<label>](dv:asset/<asset ID>). dv_models_get lists the inputs, media types and counts each model accepts. '
    + 'Pass continue_from to start from the last still of an earlier shot when the model takes a first frame. '
    + 'The model\'s own parameters go in extra (see dv_models_get). ' + TAKE_RULE,
  params: RENDER_PARAMS,
  inputs: RENDER_INPUTS,
  outputs: [{ role: 'video', type: 'video' }, { role: 'last_still', type: 'image' }],
  toolParams: CONTINUE_FROM_PARAM,
  // `continue_from` becomes the `first_frame` input; the model's `validateGenerationRequest` decides whether it takes it.
  prepareToolCall({ args, request }) {
    const continueFrom = text(args['continue_from'])
    if (continueFrom !== '') request.inputs.push({ role: 'first_frame', ref: { record: brandString<RecordId>(continueFrom), output: 1 } })
  },
  toRequest: renderRequest,
  toOutputs: storeShot,
  // The duration (5 seconds when the call names none) times the `gpuSecondsPerVideoSecond` of the catalog entry.
  estimate(params, entry) {
    const durationSec = number(params['duration_sec'], 0)
    return { gpu_seconds: (durationSec > 0 ? durationSec : ESTIMATE_DURATION_SEC) * entry.gpuSecondsPerVideoSecond }
  },
  confirmText(params) {
    const durationSec = number(params['duration_sec'], 0)
    return `Render shot with ${formatModelKey(modelKey(params))}${durationSec > 0 ? `, ${durationSec} s` : ''}: `
      + `"${text(params['prompt']).slice(0, 80)}"`
  },
  summarize: record => `${shotName(record.started_by)} "${text(record.params['prompt']).slice(0, 60)}" `
    + `(${label(record.report?.['duration_sec'] ?? record.params['duration_sec'])}s, seed ${label(record.report?.['seed'])})`,
}

/**
 * The Shot render service: the `shot.render` operation and the `GenerationApi` methods that `defineGeneration` builds
 * from the declaration.
 */
export default class DvShotRender extends defineGeneration(RENDER_DECLARATION) {
  static Config = Config
}

/** How a summary names the shot: `shot 7` for a render that a record started at slot 7, else `shot`. */
function shotName(startedBy?: StartedBy): string {
  const slot = startedBy?.slot ?? null
  return slot === null ? 'shot' : `shot ${String(slot)}`
}

/** A number or string field as display text, or `?` for anything else. */
function label(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '?'
}
