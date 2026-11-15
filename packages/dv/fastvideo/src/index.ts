/**
 * Provider plugin `fastvideo` of DreamVerse for models served by local FastVideo servers. It registers into
 * `ctx.dvModels` one entry per model that its `models` config names and per task the config gives a server for; a model
 * or task the config leaves out is not registered. Each task of a model is served by its own server, whose model facts
 * the config gives. `@dv/fastvideo-generation-client` sends each render as one `POST /v1/videos/sync` with the
 * references and an optional first frame as `data:` URLs read from `dvAssetPool`, with each citation of a reference in
 * the prompt replaced by the label that the served model gives the reference in the backend's reading order. The
 * server answers with the whole MP4; the entry reads its last frame with `dvFfmpeg`. Each entry describes
 * in `schema()` the durations, aspect ratios and resolutions of its server and the inputs and `extra` parameters it
 * accepts, and checks the inputs and `extra` in `validateGenerationRequest`. Each entry carries the prompt skill of its
 * model and task, which the catalog registers.
 *
 * Served models: `fasth3` (MiniMax H3 as FastH3), for task `ref2v` (FastH3 Ref2VA) and task `t2v` (FastH3 8-Step V2).
 *
 * @module @dv/fastvideo
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import {
  backendOrder, DvFastvideoGeneration, type Config as GenerationConfig, type ModelFacts,
} from '@dv/fastvideo-generation-client'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import type { ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent, TaskId } from '@dv/models'
import { FASTH3 } from './fasth3.ts'
import { PIKA_H3_FLEX } from './pika-h3-flex.ts'
import { modelPrompt } from './reference-labels.ts'
import type { AssignReferenceLabels } from './reference-labels.ts'
import type { InputDeclaration, InputRole, MediaType, ServedTask, TaskInputs } from './types.ts'

/** One task of one model: the generation server that renders it and the facts of its served model. */
export type TaskServer = GenerationConfig

/** `dv-fastvideo` configuration. */
export interface Config {
  /** The models to register, by model name, and for each the tasks to serve it for, by task ID, with their servers. */
  models: Record<string, Record<string, TaskServer>>
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  models: z.dict(z.dict(DvFastvideoGeneration.Config)).required(),
})

/** The provider name of every entry this plugin registers. */
const PROVIDER = 'fastvideo'

/** The count limits of one input, from the configured facts of its server. */
interface InputLimits {
  /** The most assets in the input across all media types. */
  maxCount: number
  /** The most assets of each media type in the input; a declared media type without a key has no count limit. */
  maxCountByMediaType: Partial<Record<MediaType, number>>
}

/** The count limits by declared input; an input without an entry has no limit beyond its declaration. */
type TaskInputLimits = Partial<Record<InputRole, InputLimits>>

/** The models this plugin can serve, with the tasks it can serve each for. */
const SERVED: Record<string, { [T in TaskId]?: ServedTask }> = {
  fasth3: FASTH3,
  'pika-h3-flex': PIKA_H3_FLEX,
}

/** Plugin name. */
export const name = 'dv-fastvideo'

/**
 * Required services: the model catalog, the asset pool that holds the bytes and media type of each input asset, and
 * ffmpeg, which reads the last frame of each rendered video.
 */
export const inject = ['dvModels', 'dvAssetPool', 'dvFfmpeg']

/**
 * Check the `models` config against the models and tasks this plugin serves.
 * @param config - the validated configuration.
 * @throws Error naming an unknown model, an unknown task, or a model without tasks.
 */
function checkConfig(config: Config): void {
  for (const [model, tasks] of Object.entries(config.models)) {
    const served = SERVED[model]
    if (served === undefined) throw new Error(`dv-fastvideo serves no model "${model}"; it serves: ${Object.keys(SERVED).join(', ')}.`)
    if (Object.keys(tasks).length === 0) throw new Error(`dv-fastvideo: model "${model}" names no task.`)
    for (const task of Object.keys(tasks)) {
      if (!Object.hasOwn(served, task)) {
        throw new Error(`dv-fastvideo serves model "${model}" for no task "${task}"; its tasks: ${Object.keys(served).join(', ')}.`)
      }
    }
  }
}

/**
 * The name of a frame input in a load refusal.
 * @param role - the frame input.
 * @returns `a first frame` or `a last frame`.
 */
function frameName(role: 'first_frame' | 'last_frame'): string {
  return `a ${role === 'first_frame' ? 'first' : 'last'} frame`
}

/**
 * The count limits of a task's inputs, from the server's reference limits. The server counts frame inputs among its
 * references, so each declared frame input (`first_frame`, `last_frame`) takes one slot of the server's total and one
 * slot of each media type it accepts, and the `reference` input keeps the rest. A media type that the `reference` input
 * declares and the server does not accept has a limit of 0.
 * @param name - the model and task, such as `fasth3 ref2v`, for the error message.
 * @param inputs - the inputs the task declares.
 * @param facts - the server's facts.
 * @returns the limits by declared input; empty for a task without inputs.
 * @throws Error when the facts leave a frame input no slot in a media type it takes, or fewer slots than the frame
 *   inputs and the `reference` input's `min` together.
 */
function deriveInputLimits(name: string, inputs: TaskInputs, facts: ModelFacts): TaskInputLimits {
  const frames = (['first_frame', 'last_frame'] as const).flatMap((role) => {
    const frame = inputs[role]
    return frame === undefined ? [] : [{ role, frame }]
  })
  const reference = inputs.reference
  const limits: TaskInputLimits = {}
  for (const { role, frame } of frames) {
    for (const type of frame.mediaTypes) {
      const count = frames.filter(other => other.frame.mediaTypes.includes(type)).length
      if ((facts.referenceMediaTypes[type]?.maxCount ?? 0) < count) {
        const label = frames.length === 1 ? frameName(role) : `${count} frame inputs`
        throw new Error(`dv-fastvideo: ${name} takes ${label} of type ${type}, so modelFacts.referenceMediaTypes.${type}.maxCount must be at least ${count}.`)
      }
    }
    limits[role] = { maxCount: 1, maxCountByMediaType: {} }
  }
  const minimum = frames.length + (reference?.min ?? 0)
  if (facts.maxReferences < minimum) {
    // Only a task with a `reference` input gets here: every served frame input takes only `image`, the check above
    // gives `image` a maxCount of at least the frame count, and deriveModelFacts caps each maxCount at maxReferences.
    const detail = [`at least ${(reference as InputDeclaration).min} reference`, ...frames.map(({ role }) => frameName(role))].join(' and ')
    throw new Error(`dv-fastvideo: ${name} takes ${detail}, so modelFacts.maxReferences must be at least ${minimum}; it is ${facts.maxReferences}.`)
  }
  if (reference !== undefined) {
    limits.reference = {
      maxCount: facts.maxReferences - frames.length,
      maxCountByMediaType: Object.fromEntries(reference.mediaTypes.map(type => [type,
        Math.max(0, (facts.referenceMediaTypes[type]?.maxCount ?? 0)
          - frames.filter(({ frame }) => frame.mediaTypes.includes(type)).length),
      ])),
    }
  }
  return limits
}

/**
 * Describe each declared input of a task for `schema()`: its `min`, its total `max`, and each declared media type with
 * its `max` when the server limits that type.
 * @param inputs - the inputs the task declares.
 * @param limits - the input limits from the server's configured facts.
 * @returns the inputs by role.
 */
function describeInputs(inputs: TaskInputs, limits: TaskInputLimits): JsonValue {
  return Object.fromEntries(Object.entries(inputs).map(([role, input]) => {
    // deriveInputLimits gives every declared input its limits.
    const limit = limits[role as InputRole] as InputLimits
    const mediaTypes = input.mediaTypes.map((type): [string, JsonValue] => {
      const max = limit.maxCountByMediaType[type]
      return [type, max === undefined ? {} : { max }]
    })
    return [role, { min: input.min, max: limit.maxCount, media_types: Object.fromEntries(mediaTypes) }]
  }))
}

/**
 * The problems of one render request for a task: an input the task does not declare holding an asset, an input holding
 * fewer assets than its `min`, an asset whose media type its input does not declare, or an input holding more assets
 * in total or of one media type than the server's limits allow.
 * @param inputs - the inputs the task declares.
 * @param limits - the input limits from the server's configured facts.
 * @param request - the render request.
 * @param mediaTypeOf - the media type of an asset, read from the asset pool.
 * @returns the problems, each one sentence; empty when the server renders the request.
 */
function requestProblems(
  inputs: TaskInputs, limits: TaskInputLimits, request: RenderRequest,
  mediaTypeOf: (asset: RenderRequest['references'][number]) => string,
): string[] {
  const problems: string[] = []
  const roles: Array<[InputRole, RenderRequest['references']]> = [
    ['reference', request.references], ['first_frame', request.firstFrame === null ? [] : [request.firstFrame]],
    ['last_frame', request.lastFrame === null ? [] : [request.lastFrame]],
  ]
  for (const [role, assets] of roles) {
    const declared = inputs[role]
    if (declared === undefined) {
      if (assets.length > 0) problems.push(`It takes no ${role} input; this shot has ${assets.length}.`)
      continue
    }
    const accepted = declared.mediaTypes.join(', ')
    if (assets.length < declared.min) {
      problems.push(`Its ${role} input needs at least ${declared.min} of type ${accepted}; this shot has ${assets.length}.`)
    }
    const counts = new Map<string, number>()
    for (const asset of assets) {
      const mediaType = mediaTypeOf(asset)
      if (!declared.mediaTypes.includes(mediaType)) problems.push(`Its ${role} input takes assets of type ${accepted}; asset ${asset} is of type ${mediaType}.`)
      counts.set(mediaType, (counts.get(mediaType) ?? 0) + 1)
    }
    const limit = limits[role]
    if (limit !== undefined && assets.length > limit.maxCount) {
      problems.push(`Its ${role} input takes at most ${limit.maxCount} assets; this shot has ${assets.length}.`)
    }
    for (const [mediaType, count] of counts) {
      const max = limit?.maxCountByMediaType[mediaType]
      if (max !== undefined && count > max) problems.push(`Its ${role} input takes at most ${max} of type ${mediaType}; this shot has ${count}.`)
    }
  }
  return problems
}

/** The native task of each harness task, for a server configured without one. */
const NATIVE_TASKS: Readonly<Record<TaskId, string>> = { t2v: 't2va', i2v: 'i2va', l2v: 'l2va', fl2v: 'fl2va', ref2v: 'ref2va' }
/** Native task aliases that a FastVideo server accepts in a request, after it lowercases the task. */
const NATIVE_ALIASES: Readonly<Record<string, string>> = { t2v: 't2va', i2v: 'i2va' }

/**
 * The canonical native task of a task id, read the way a FastVideo server reads a request's `task`.
 * @param task - a native task id or alias, in any case.
 * @returns the lowercased task with `NATIVE_ALIASES` applied.
 */
function canonicalTask(task: string): string {
  const lower = task.toLowerCase()
  return NATIVE_ALIASES[lower] ?? lower
}

/**
 * The problems of one render request against what the server publishes: a native task the server does not list, or
 * more media than a Ref2VA server's reference limits allow. Facts without `tasks` or `referenceLimits` add none.
 * @param name - the model and task, such as `fasth3 ref2v`, for the message.
 * @param nativeTask - the native task the entry sends.
 * @param facts - the server's facts from `model()`.
 * @param request - the render request.
 * @param mediaTypeOf - the media type of an asset, read from the asset pool.
 * @returns the problems, each one sentence.
 */
function servedProblems(
  name: string, nativeTask: string, facts: ModelFacts, request: RenderRequest,
  mediaTypeOf: (asset: RenderRequest['references'][number]) => string,
): string[] {
  const problems: string[] = []
  const served = facts.tasks?.map(({ task }) => canonicalTask(task))
  const sent = canonicalTask(nativeTask)
  if (served !== undefined && !served.includes(sent)) {
    problems.push(`The server for ${name} serves ${served.join(', ')}; it does not serve ${sent}.`)
  }
  const limits = facts.referenceLimits
  if (limits === undefined) return problems
  const assets = [...request.references, ...request.firstFrame === null ? [] : [request.firstFrame],
    ...request.lastFrame === null ? [] : [request.lastFrame]]
  if (assets.length > limits.total) problems.push(`The server takes at most ${limits.total} references; this shot has ${assets.length}.`)
  const maxByType: Record<string, number> = { image: limits.images, video: limits.videos, audio: limits.audios }
  for (const [type, max] of Object.entries(maxByType)) {
    const count = assets.filter(asset => mediaTypeOf(asset) === type).length
    if (count > max) problems.push(`The server takes at most ${max} of type ${type}; this shot has ${count}.`)
  }
  return problems
}

/**
 * The problems of a request's `extra` values for a task: names the task does not take are refused in one sentence that
 * lists its parameters, and the values of known names are checked against their schema.
 * @param model - the model name.
 * @param task - the task.
 * @param schema - the task's extra parameters.
 * @param extra - the request's `extra` values.
 * @returns one sentence per problem; empty when the values are valid.
 */
function extraProblems(model: string, task: TaskId, schema: ParameterSchemaSpec, extra: Record<string, unknown>): string[] {
  const known = Object.keys(schema)
  const unknown = Object.keys(extra).filter(name => !known.includes(name))
  if (unknown.length > 0) {
    return [`${model} has no extra parameter ${unknown.map(name => `\`${name}\``).join(', ')} for task ${task}; `
      + `its extra parameters: ${known.join(', ') || 'none'}.`]
  }
  /* v8 ignore next -- every served task declares no extra parameter, so every name is refused as unknown above. */
  return validateArgs(schema, extra).map(message => `extra${message.startsWith('.') ? '' : '.'}${message}`)
}

/**
 * Assign a model's labels in the order the backend reads the media, and return them at the request's positions.
 * @param assign - the model's labels for media in the order that the model receives them.
 * @returns labels at the positions of the request's media: the references, then the first frame.
 */
function backendOrderLabels(assign: AssignReferenceLabels): AssignReferenceLabels {
  return (media) => {
    const ordered = backendOrder(media.map((item, index) => ({ item, index })), ({ item }) => item.mediaType)
    const labels = assign(ordered.map(({ item }) => item))
    // assign returns one label per medium it receives.
    const byPosition = new Map(ordered.map(({ index }, position) => [index, labels[position] as string | null]))
    return media.map((_, index) => byPosition.get(index) ?? null)
  }
}

/**
 * A catalog entry for one configured model and task, rendered through one generation client of the task's server.
 * @param ctx - the plugin context; the client lives in an isolated `dvFastvideoGeneration` scope, and `render` reads
 *   each input asset from `ctx.dvAssetPool` and the last frame through `ctx.dvFfmpeg`.
 * @param model - the model name.
 * @param task - the task.
 * @param server - the task's configured server.
 * @returns the entry.
 * @throws Error when the server's facts leave the task's inputs no room.
 */
function modelEntry(ctx: Context, model: string, task: TaskId, server: TaskServer): ModelEntry {
  const served = SERVED[model]?.[task]
  /* v8 ignore next -- checkConfig refuses unknown models and tasks before any entry is built. */
  if (served === undefined) throw new Error(`dv-fastvideo serves no model "${model}" for task "${task}".`)
  const { inputs, extra, assignReferenceLabels, skill } = served
  const labels = backendOrderLabels(assignReferenceLabels)
  const client = new DvFastvideoGeneration(ctx.isolate('dvFastvideoGeneration'), {
    ...server, task: served.nativeTask ?? server.task ?? null,
  })
  // A task that the config leaves unset is sent without `task`; the server's defaults map it as the harness task does.
  const nativeTask = served.nativeTask ?? server.task ?? NATIVE_TASKS[task]
  const limits = deriveInputLimits(`${model} ${task}`, inputs, client.facts)
  return {
    modality: 'video',
    task,
    provider: PROVIDER,
    model,
    ...server.displayName == null ? {} : { displayName: server.displayName },
    ...server.managed !== true ? {} : { runtime: {
      status: (signal?: AbortSignal) => client.modelStatus(signal),
      load: (signal?: AbortSignal) => client.loadModel(signal),
      unload: (signal?: AbortSignal) => client.unloadModel(signal),
    } },
    description: served.description,
    promptSkill: {
      name: skill.name, description: skill.description,
      content: readFileSync(new URL(`../skills/${skill.file}`, import.meta.url), 'utf8'),
    },
    async facts(): Promise<RenderModelFacts> {
      const {
        modelId, aspectRatios, resolutions, frameSizes, minDurationSec, maxDurationSec, numFramesByDurationSec,
      } = await client.model()
      return { modelId, aspectRatios, resolutions, frameSizes, minDurationSec, maxDurationSec, numFramesByDurationSec }
    },
    async schema(): Promise<JsonValue> {
      const facts = await client.model()
      return {
        duration_sec: { min: facts.minDurationSec, max: facts.maxDurationSec },
        aspect_ratios: facts.aspectRatios,
        resolutions: facts.resolutions,
        inputs: describeInputs(inputs, limits),
        extra: JSON.parse(JSON.stringify(extra)) as JsonValue,
        ...facts.tasks === undefined ? {} : { server_tasks: facts.tasks.map(({ task: served }) => served) },
      }
    },
    async validateGenerationRequest(request: RenderRequest): Promise<string[]> {
      const facts = await client.model()
      const mediaTypeOf = (asset: RenderRequest['references'][number]) => ctx.dvAssetPool.mediaType(asset)
      return [
        ...servedProblems(`${model} ${task}`, nativeTask, facts, request, mediaTypeOf),
        ...requestProblems(inputs, limits, request, mediaTypeOf),
        ...extraProblems(model, task, extra, request.extra),
        ...served.modelProblems?.(request, mediaTypeOf) ?? [],
      ]
    },
    render(request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      const assets = [...request.references, ...request.firstFrame === null ? [] : [request.firstFrame],
        ...request.lastFrame === null ? [] : [request.lastFrame]]
      return (async function* () {
        if (request.frameWidth === undefined || request.frameHeight === undefined || request.numFrames === undefined) {
          throw new Error('FastVideo requires native frame dimensions and a frame count from its configured facts.')
        }
        // Video and audio references can be tens of megabytes each, so they are read concurrently off the event loop.
        const references = await Promise.all(assets.map(async id => ({
          mimeType: ctx.dvAssetPool.get(id).mime, bytes: await readFile(ctx.dvAssetPool.path(id)),
        })))
        // The sound of a video changes only the labels of audio, so the pool reads it only when the media hold audio.
        const audio = assets.some(asset => ctx.dvAssetPool.mediaType(asset) === 'audio')
        const media = await Promise.all(assets.map(async asset => ({
          asset, mediaType: ctx.dvAssetPool.mediaType(asset), hasAudio: audio && await ctx.dvAssetPool.hasAudio(asset),
        })))
        const { video, mime, timings } = await client.generateSegment({
          prompt: modelPrompt(request, labels, media),
          references,
          frameWidth: request.frameWidth,
          frameHeight: request.frameHeight,
          numFrames: request.numFrames,
          seed: request.seed,
          ...signal === undefined ? {} : { signal },
        })
        const png = await ctx.dvFfmpeg.lastFrame(video)
        // ffmpeg runs to completion; an abort during it rejects here.
        signal?.throwIfAborted()
        yield { kind: 'last_frame', png }
        yield { kind: 'video_start', mime }
        yield { kind: 'chunk', bytes: video }
        yield { kind: 'done', timings }
      })()
    },
  }
}

/**
 * Register one entry into `ctx.dvModels` per configured model and task.
 * @param ctx - the plugin context.
 * @param config - the validated configuration.
 * @throws Error when the config names a model or task this plugin does not serve.
 */
export function apply(ctx: Context, config: Config): void {
  checkConfig(config)
  const configured = Object.entries(config.models).flatMap(([model, tasks]) =>
    Object.entries(tasks).map(([task, server]) => ({ model, task: task as TaskId, server })))
  for (const { model, task, server } of configured) {
    const entry = modelEntry(ctx, model, task, server)
    ctx.effect(() => ctx.dvModels.register(entry), `dvModels ${model} ${task}`)
  }
}
