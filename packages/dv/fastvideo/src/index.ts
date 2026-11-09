/**
 * Provider plugin `fastvideo` of DreamVerse for models served by local FastVideo servers. It registers into
 * `ctx.dvModels` one entry per model that its `models` config names and per task the config gives a server for; a model
 * or task the config leaves out is not registered. Each task of a model is served by its own server. The configured
 * transport of `@dv/fastvideo-generation-client` sends each render with MIME types and bytes from `dvAssetPool`.
 * It includes references and distinct first/last frame inputs, with each citation
 * of a reference in the prompt replaced by the label that the served model gives the reference. Each entry describes
 * in `schema()` the durations, aspect ratios and resolutions of its server and the inputs and `extra` parameters it
 * accepts, and checks the inputs and `extra` in `validateGenerationRequest`. Each entry carries the prompt skill of its
 * model and task, which the catalog registers.
 *
 * Served models: `fasth3` for `ref2v` and `t2v`, and `pika-h3-flex` for `t2v` and `fl2v`.
 *
 * @module @dv/fastvideo
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import { DvFastvideoGeneration, type Config as GenerationConfig, type ModelFacts } from '@dv/fastvideo-generation-client'
import type {} from '@dv/asset-pool'
import type { ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent, TaskId } from '@dv/models'
import { FASTH3 } from './fasth3.ts'
import { PIKA_H3_FLEX } from './pika-h3-flex.ts'
import { modelPrompt } from './reference-labels.ts'
import type { AssignReferenceLabels } from './reference-labels.ts'
import type { InputRole, MediaType, ServedTask, TaskInputs } from './types.ts'

/** One task of one model: the generation server and transport that render it. */
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

/** The count limits of one input, read from the server. */
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

/** Required services: the model catalog, and the asset pool that holds the bytes and media type of each input asset. */
export const inject = ['dvModels', 'dvAssetPool']

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
    for (const [task, server] of Object.entries(tasks)) {
      if (served[task as TaskId]?.openaiTask !== undefined && server.openai == null) {
        throw new Error(`dv-fastvideo: ${model} task ${task} requires the OpenAI transport.`)
      }
      if (!Object.hasOwn(served, task)) {
        throw new Error(`dv-fastvideo serves model "${model}" for no task "${task}"; its tasks: ${Object.keys(served).join(', ')}.`)
      }
    }
  }
}

/**
 * The server counts frame inputs among its references. Each declared frame role reserves one slot of the total
 * and of each media type it accepts; the reference role keeps the remaining slots. Reference-only tasks keep every
 * server reference slot. Frame roles accept at most one asset; undeclared media types have no server capacity.
 * @param inputs - the inputs the task declares.
 * @param facts - the server's facts.
 * @returns the limits by declared input; empty for a task without inputs.
 */
function deriveInputLimits(inputs: TaskInputs, facts: ModelFacts): TaskInputLimits {
  const frames = [inputs.first_frame, inputs.last_frame].filter(input => input !== undefined)
  const limits: TaskInputLimits = {}
  for (const role of ['first_frame', 'last_frame'] as const) {
    if (inputs[role] !== undefined) limits[role] = { maxCount: 1, maxCountByMediaType: {} }
  }
  const reference = inputs.reference
  if (reference !== undefined) {
    limits.reference = {
      maxCount: Math.max(0, facts.maxReferences - frames.length),
      maxCountByMediaType: Object.fromEntries(reference.mediaTypes.map(mediaType => [
        mediaType, Math.max(0, (facts.referenceMediaTypes[mediaType]?.maxCount ?? 0)
          - frames.filter(frame => frame.mediaTypes.includes(mediaType)).length),
      ])),
    }
  }
  return limits
}

/**
 * Describe each declared input of a task for `schema()`: its `min`, its total `max`, and each declared media type with
 * its `max` when the server limits that type.
 * @param inputs - the inputs the task declares.
 * @param limits - the input limits from the server's facts.
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
 * @param limits - the input limits from the server's facts.
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

/** OpenAI sends images, videos and audio in separate lists; return labels at the caller's original positions. */
function openAIReferenceLabels(assign: AssignReferenceLabels): AssignReferenceLabels {
  return (media) => {
    const order = ['image', 'video', 'audio']
    const ordered = media.map((item, index) => ({ item, index }))
      .sort((a, b) => order.indexOf(a.item.mediaType) - order.indexOf(b.item.mediaType))
    const labels = assign(ordered.map(({ item }) => item))
    const byPosition = new Map(ordered.map(({ index }, position) => [index, labels[position] ?? null]))
    return media.map((_, index) => byPosition.get(index) ?? null)
  }
}

/**
 * A catalog entry for one configured model and task, rendered through one generation client of the task's server.
 * @param ctx - the plugin context; the client lives in an isolated `dvFastvideoGeneration` scope, and `render` reads
 *   each input asset from `ctx.dvAssetPool`.
 * @param model - the model name.
 * @param task - the task.
 * @param server - the task's configured server.
 * @returns the entry.
 */
function modelEntry(ctx: Context, model: string, task: TaskId, server: TaskServer): ModelEntry {
  const served = SERVED[model]?.[task]
  /* v8 ignore next -- checkConfig refuses unknown models and tasks before any entry is built. */
  if (served === undefined) throw new Error(`dv-fastvideo serves no model "${model}" for task "${task}".`)
  const { inputs, extra, assignReferenceLabels, skill } = served
  const labels = server.openai == null ? assignReferenceLabels : openAIReferenceLabels(assignReferenceLabels)
  const client = new DvFastvideoGeneration(ctx.isolate('dvFastvideoGeneration'), server)
  return {
    modality: 'video',
    task,
    provider: PROVIDER,
    model,
    description: served.description,
    promptSkill: {
      name: skill.name, description: skill.description,
      content: readFileSync(new URL(`../skills/${skill.file}`, import.meta.url), 'utf8'),
    },
    async facts(): Promise<RenderModelFacts> {
      const facts = await client.model()
      return {
        modelId: facts.modelId, aspectRatios: facts.aspectRatios, resolutions: facts.resolutions, frameSizes: facts.frameSizes,
        minDurationSec: facts.minSegmentDurationSec, maxDurationSec: facts.maxSegmentDurationSec,
        numFramesByDurationSec: facts.numFramesByDurationSec,
      }
    },
    async schema(): Promise<JsonValue> {
      const capabilities = await client.model()
      return {
        duration_sec: { min: capabilities.minSegmentDurationSec, max: capabilities.maxSegmentDurationSec },
        aspect_ratios: capabilities.aspectRatios,
        resolutions: capabilities.resolutions,
        inputs: describeInputs(inputs, deriveInputLimits(inputs, capabilities)),
        extra: JSON.parse(JSON.stringify(extra)) as JsonValue,
      }
    },
    async validateGenerationRequest(request: RenderRequest): Promise<string[]> {
      const facts = await client.model()
      const limits = deriveInputLimits(inputs, facts)
      const frameCount = (request.firstFrame === null ? 0 : 1) + (request.lastFrame === null ? 0 : 1)
      const frameOnly = inputs.reference === undefined && (inputs.first_frame !== undefined || inputs.last_frame !== undefined)
      const frameCapacity = Math.min(facts.maxReferences, facts.referenceMediaTypes['image']?.maxCount ?? 0)
      return [
        ...requestProblems(inputs, limits, request, asset => ctx.dvAssetPool.mediaType(asset)),
        ...frameOnly && frameCount > frameCapacity
          ? ['The server accepts fewer keyframe images than this shot needs.'] : [],
        ...served.inputProblems?.(request, asset => ctx.dvAssetPool.mediaType(asset)) ?? [],
        ...extraProblems(model, task, extra, request.extra),
        ...served.promptProblems?.(request) ?? [],
      ]
    },
    render(request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      const assets = [...request.references, ...request.firstFrame === null ? [] : [request.firstFrame],
        ...request.lastFrame === null ? [] : [request.lastFrame]]
      return (async function* () {
        // Video and audio references can be tens of megabytes each, so they are read concurrently off the event loop.
        const references = await Promise.all(assets.map(async id => ({
          mediaType: ctx.dvAssetPool.mediaType(id), mimeType: ctx.dvAssetPool.get(id).mime, bytes: await readFile(ctx.dvAssetPool.path(id)),
        })))
        // The sound of a video changes only the labels of audio, so the pool reads it only when the media hold audio.
        const audio = references.some(reference => reference.mediaType === 'audio')
        const media = await Promise.all(assets.map(async asset => ({
          asset, mediaType: ctx.dvAssetPool.mediaType(asset), hasAudio: audio && await ctx.dvAssetPool.hasAudio(asset),
        })))
        yield* client.generateSegment({
          prompt: modelPrompt(request, labels, media),
          references,
          ...served.openaiTask === undefined ? {} : { task: served.openaiTask },
          frameWidth: request.frameWidth,
          frameHeight: request.frameHeight,
          numFrames: request.numFrames,
          seed: request.seed,
          returnLastFrame: true,
          ...signal === undefined ? {} : { signal },
        })
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
