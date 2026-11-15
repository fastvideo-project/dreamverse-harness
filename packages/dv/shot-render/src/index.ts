/**
 * The Shot render component of DreamVerse as the `dvShotRender` Cordis service: the Consumer of the model catalog of
 * `@dv/models`. It owns one operation, `shot.render` (tool `dv_shot_render`): one take of a shot rendered by the catalog
 * entry whose key the call names in the required params `modality`, `task`, `provider` and `model`. Task `ref2v` takes
 * reference media (imported assets, or the assets of the characters, locations and styles it names) and optionally a
 * first frame, usually the last still of the shot it continues. Video continuation extracts the previous video's tail
 * with audio as one ordinary reference, requiring video-reference support. The entry's `validateGenerationRequest` decides which
 * inputs and which values of the model's own parameters (`extra`) it renders, and the entry's schema describes them to
 * the agent. The model receives asset IDs and reads each asset from the asset pool.
 *
 * The operation exists while the catalog holds a model of task `t2v`, `ref2v` or `fl2v`. The model's facts decide the frame size
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
  modelKey, type RenderModelFacts, type RenderRequest, type RenderStreamEvent,
} from '@dv/models'
import {
  citedAsset, citedInput, elementCitationUri, formatCitation, parsePromptCitations, replacePromptCitations, type AssetId,
  type OperationContext, type OperationInput, type OperationResult, type OperationSpec, type ProjectId, type RecordId, type RecordInput,
  type StartedBy,
} from '@dv/project'
import { baseMime, shotGeometry, text } from './render.ts'
import { continuationAsset, prepareContinuation } from './continuation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Shot render component: one take of a shot per render call. */
    dvShotRender: DvShotRender
  }
}

/** `dvShotRender` plugin configuration: none. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

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

/** Tool shortcuts for the source take of still or video continuation. */
const CONTINUATION_PARAMS: ParameterSchemaSpec = {
  continue_from: {
    type: 'string',
    description: 'A render record whose last_still (output #1) this shot starts from; only when the model takes a first frame.',
  },
  continue_video_from: {
    type: 'string',
    description: 'A render record whose video tail (output #0) guides continuing motion or audio. Requires video-reference support; '
      + 'uses continuation_seconds (default 2). This supplies a video reference; do not also put its source in inputs.reference. '
      + 'Cannot combine with continue_from or first_frame. No output overlap is trimmed.',
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
  continuation_seconds: { type: 'number', description: 'Positive tail duration for video continuation; default 2 seconds, capped at the source duration.' },
}

/** The inputs of `shot.render`; a model accepts the subset its schema lists. */
const RENDER_INPUTS: Record<string, OperationInput> = {
  reference: {
    type: 'any', many: true, versioned: true,
    description: 'Reference media in prompt order: imported assets, or versions (<id>@<version>) whose reference '
      + 'assets the shot carries; the model accepts the media types dv_models_get lists. Task ref2v only.',
  },
  first_frame: { type: 'image', description: 'The frame the shot starts from, usually output #1 of the previous shot.' },
  last_frame: { type: 'image', description: 'The frame the shot ends at. Task fl2v needs both first_frame and last_frame.' },
  continuation_video: { type: 'video', description: 'Previous shot video (output #0); its tail becomes one ordinary video reference.' },
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
 * `reference` assets in input order, its `first_frame` and `last_frame` assets, the frame size and frame count from the model's facts, the
 * seed, and the model's own parameters.
 * @param facts - the model's facts.
 * @param params - the call's params.
 * @param inputs - the call's input assets with their roles and references; a chained role has neither.
 * @param seed - the call's `seed`, else the random seed that `defineGeneration` drew.
 * @returns the request.
 * @throws Error for a missing prompt, a citation that names no `reference` asset, params outside the facts, or more than
 *   one input of either frame role or of `continuation_video`, missing frames or forbidden reference media for task
 *   `fl2v`, conflicting continuation modes, or invalid continuation duration.
 */
function renderRequest(
  facts: RenderModelFacts, params: Record<string, unknown>, inputs: readonly RequestInput[], seed: number,
): RenderRequest {
  if (text(params['prompt']) === '') throw new Error('shot.render needs a `prompt`.')
  let prompt = expandElements(text(params['prompt']), inputs)
  const video = continuationAsset(inputs)
  const cited = inputAssets(inputs, 'reference')
  const references = [...cited, ...video === null ? [] : [video]]
  // An output of a record that has not finished counts here although it has no asset yet.
  for (const role of ['first_frame', 'last_frame']) {
    const count = inputs.filter(input => input.role === role).length
    if (count > 1) throw new Error(`shot.render takes one ${role} input; this call has ${count}.`)
    if ((params['task'] === 'fl2v' || (params['task'] === 'i2v' && role === 'first_frame')
      || (params['task'] === 'l2v' && role === 'last_frame')) && count !== 1) throw new Error(`Task ${params['task']} needs one ${role} input.`)
  }
  if (params['task'] === 'i2v' && inputs.some(input => input.role !== 'first_frame')) {
    throw new Error('Task i2v takes one first_frame, with no reference or last_frame input.')
  }
  if (params['task'] === 'l2v' && inputs.some(input => input.role !== 'last_frame')) {
    throw new Error('Task l2v takes one last_frame, with no reference or first_frame input.')
  }
  if (params['task'] === 'fl2v' && inputs.some(input => input.role === 'reference')) throw new Error('Task fl2v takes first_frame and last_frame, with no reference input.')
  const firstFrameCount = inputs.filter(input => input.role === 'first_frame').length
  const continuationCount = inputs.filter(input => input.role === 'continuation_video').length
  if (continuationCount > 1) throw new Error('shot.render takes one continuation_video input.')
  if (continuationCount > 0 && firstFrameCount > 0) throw new Error('Video continuation cannot combine with continue_from or first_frame.')
  const seconds = params['continuation_seconds']
  if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0)) {
    throw new Error('continuation_seconds must be a positive finite number.')
  }
  if (seconds !== undefined && continuationCount === 0) throw new Error('continuation_seconds needs a continuation_video input or continue_video_from.')
  // The continuation video is cited only as its input: execution replaces the source asset with its cropped tail.
  const problems = citationProblems(prompt, cited, new Set(inputs.map(input => input.role)))
  if (problems.length > 0) throw new Error(`${problems.join(' ')} Cite only the assets of inputs.reference and the inputs of the call.`)
  if (video !== null) {
    prompt = replacePromptCitations(prompt, citation => citedInput(citation.uri) === 'continuation_video'
      ? formatCitation(citation.label, 'asset', video) : prompt.slice(citation.start, citation.end))
  }
  const firstFrames = inputAssets(inputs, 'first_frame')
  const lastFrames = inputAssets(inputs, 'last_frame')
  const geometry = shotGeometry(facts, params)
  return {
    prompt, references, firstFrame: firstFrames[0] ?? null, lastFrame: lastFrames[0] ?? null,
    ...geometry.width === undefined ? {} : { frameWidth: geometry.width, frameHeight: geometry.height },
    ...geometry.numFrames === undefined ? { durationSec: geometry.durationSec, aspectRatio: geometry.aspectRatio,
      resolution: geometry.resolution } : { numFrames: geometry.numFrames },
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
 * @returns the outputs and the report of the render's facts; `defineGeneration` adds the seed.
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
  const dimensions = geometry.width === undefined || geometry.height === undefined ? {}
    : { width: geometry.width, height: geometry.height }
  const video = context.importAsset({ path: streamed.videoPath }, {
    mime: baseMime(streamed.mime), name: `${shortId}.mp4`, durationSec: geometry.durationSec,
    ...dimensions,
  })
  const frame = context.importAsset(streamed.lastFrame, {
    mime: 'image/png', name: `${shortId}-last.png`, ...dimensions,
  })
  // The record's params keep the prompt as written; the report adds the prompt that the model plugin received.
  const expanded = request.prompt === text(context.params['prompt']) ? {} : { expanded_prompt: request.prompt }
  const tailAsset = context.inputs.some(input => input.role === 'continuation_video') ? request.references.at(-1) : undefined
  const continuation = tailAsset === undefined ? {} : {
    continuation_video_asset: tailAsset, continuation_seconds: ctx.get('dvAssetPool')?.get(tailAsset).duration_sec,
  }
  return {
    outputs: [video, frame],
    report: {
      model_id: facts.modelId, aspect_ratio: geometry.aspectRatio, resolution: geometry.resolution,
      duration_sec: geometry.durationSec,
      ...geometry.width === undefined || geometry.height === undefined ? {}
        : { frame_width: geometry.width, frame_height: geometry.height },
      ...geometry.numFrames === undefined ? {} : { num_frames: geometry.numFrames },
      ...modelKey(context.params), ...expanded, ...continuation, timings: streamed.timings,
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
  node: { kind: 'shot', column: 2 },
  primitive: 'video',
  tasks: { t2v: { zh: '文字生成', en: 'From text' }, ref2v: { zh: '参考图生成', en: 'From references' }, fl2v: { zh: '首尾帧生成', en: 'From first and last frames' }, i2v: { zh: '首帧生成', en: 'From first frame' }, l2v: { zh: '尾帧生成', en: 'From last frame' } },
  label: { zh: '渲染镜头', en: 'Render shot' },
  description: 'Render one take of a shot with a model from dv_models_list; modality, task, provider and model name it and are '
    + 'required. Task ref2v renders from reference media through the reference input: imported assets, or versions '
    + 'with reference assets (<id>@<version>, such as c1@1); the prompt cites each reference image as '
    + '@[<label>](dv:asset/<asset ID>). dv_models_get lists the inputs, media types and counts each model accepts. '
    + 'Task i2v renders from one first_frame image, with no reference or last_frame input. '
    + 'Task l2v renders toward one last_frame image, with no reference or first_frame input. '
    + 'Task fl2v renders between image inputs first_frame and last_frame; both are required, with no reference input. '
    + 'Pass continue_from to start from the last still of an earlier shot when the model takes a first frame. '
    + 'Pass continue_video_from to guide ongoing motion or audio with a previous shot\'s tail as a video reference; '
    + 'cite it as @[previous clip](dv:input/continuation_video). Audio continuity depends on the model\'s audio conditioning. '
    + 'The model\'s own parameters go in extra (see dv_models_get). ' + TAKE_RULE,
  params: RENDER_PARAMS,
  inputs: RENDER_INPUTS,
  outputs: [{ role: 'video', type: 'video' }, { role: 'last_still', type: 'image' }],
  toolParams: CONTINUATION_PARAMS,
  // Both shortcuts become inputs that name a source record output, which the runner resolves like any record-output input.
  prepareToolCall({ args, request }) {
    const continueFrom = text(args['continue_from'])
    if (continueFrom !== '') request.inputs.push({ role: 'first_frame', ref: { record: brandString<RecordId>(continueFrom), output: 1 } })
    const continueVideoFrom = text(args['continue_video_from'])
    if (continueVideoFrom !== '') request.inputs.push({ role: 'continuation_video', ref: { record: brandString<RecordId>(continueVideoFrom), output: 0 } })
  },
  prepareInputs: prepareContinuation,
  toRequest: renderRequest,
  toOutputs: storeShot,
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
