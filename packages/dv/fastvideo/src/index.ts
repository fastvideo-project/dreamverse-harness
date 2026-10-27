/**
 * Provider plugin `fastvideo` of DreamVerse for models served by local FastVideo streaming_v2 servers. It registers into
 * `ctx.dvModels` one entry per model that its `models` config names and per task the config gives a server for; a model
 * or task the config leaves out is not registered. Each task of a model is served by its own server: the streaming_v2
 * client of `@dv/fastvideo-generation-client` sends each render as one `POST /v1/streamv2/generate`, with the references
 * first and the first frame after them, each as its media type and bytes read from `dvAssetPool`, and with each citation
 * of a reference in the prompt replaced by the label that the served model gives the reference. Each entry describes
 * in `schema()` the durations, aspect ratios and resolutions of its server and the inputs and `extra` parameters it
 * accepts, and checks the inputs and `extra` in `validateGenerationRequest`. While a task's server allows an adapter,
 * the entry also offers `extra.lora`, narrowed to the adapters of `dvLora` when that registry is mounted. Each entry
 * carries the prompt skill of its model and task, which the catalog registers.
 *
 * Served models: `fasth3` (MiniMax H3 as FastH3), for task `ref2v` (FastH3 Ref2VA) and task `t2v` (FastH3 8-Step V2).
 *
 * @module @dv/fastvideo
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { validateArgs, type ParameterPropertySpec, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import {
  DvFastvideoGeneration, type LoraAdapter, type LoraSelection, type ModelFacts,
} from '@dv/fastvideo-generation-client'
import type DvLora from '@dv/lora'
import type {} from '@dv/asset-pool'
import type { ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent, TaskId } from '@dv/models'
import { FASTH3 } from './fasth3.ts'
import { modelPrompt } from './reference-labels.ts'
import type { InputRole, MediaType, ServedTask, TaskInputs } from './types.ts'

/** One task of one model: the streaming_v2 server that renders it. */
export interface TaskServer {
  /** HTTP base URL of the FastVideo streaming_v2 server, such as `http://127.0.0.1:8029`. */
  baseUrl: string
}

/** `dv-fastvideo` configuration. */
export interface Config {
  /** The models to register, by model name, and for each the tasks to serve it for, by task ID, with their servers. */
  models: Record<string, Record<string, TaskServer>>
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  models: z.dict(z.dict(z.object({
    baseUrl: z.string().required(),
  }))).required(),
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
}

/** Plugin name. */
export const name = 'dv-fastvideo'

/**
 * Required services: the model catalog, and the asset pool that holds the bytes and media type of each input asset.
 * `dvLora` is optional and read per call, so it is not listed.
 */
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
    for (const task of Object.keys(tasks)) {
      if (!Object.hasOwn(served, task)) {
        throw new Error(`dv-fastvideo serves model "${model}" for no task "${task}"; its tasks: ${Object.keys(served).join(', ')}.`)
      }
    }
  }
}

/**
 * The count limits of a task's inputs, from the server's reference limits. The server counts the first frame among its
 * references, so the first frame takes one slot of the server's total and one slot of each media type that the
 * `first_frame` input accepts, and the `reference` input keeps the rest. A media type that the `reference` input
 * declares and the server does not accept has a limit of 0.
 * @param inputs - the inputs the task declares; `SERVED` declares `reference` and `first_frame` together or neither.
 * @param facts - the server's facts.
 * @returns the limits by declared input; empty for a task without references.
 */
function deriveInputLimits(inputs: TaskInputs, facts: ModelFacts): TaskInputLimits {
  const { reference, first_frame: firstFrame } = inputs
  if (reference === undefined || firstFrame === undefined) return {}
  const firstFrameTypes = new Set(firstFrame.mediaTypes)
  const maxCountByMediaType = Object.fromEntries(reference.mediaTypes.map(mediaType => [
    mediaType, (facts.referenceMediaTypes[mediaType]?.maxCount ?? 0) - (firstFrameTypes.has(mediaType) ? 1 : 0),
  ]))
  return {
    reference: { maxCount: facts.maxReferences - 1, maxCountByMediaType },
    first_frame: { maxCount: 1, maxCountByMediaType: {} },
  }
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
 * The adapters of a task's server that one render may name: none unless the task takes `extra.lora` and the server
 * serves an adapter. With the `dvLora` registry mounted, only the adapters it publishes for this model and task.
 * @param facts - the task's server facts.
 * @param served - the task this plugin serves.
 * @param registry - the `dvLora` registry, when the deployment mounts it.
 * @param model - the model name.
 * @param task - the task.
 * @returns the adapters a request may select, in the server's order.
 */
function usableAdapters(
  facts: ModelFacts, served: ServedTask, registry: DvLora | undefined, model: string, task: TaskId,
): LoraAdapter[] {
  if (served.lora !== true || !facts.lora.supported) return []
  if (registry === undefined) return facts.lora.adapters
  const published = new Set(registry.list({ model, task }).map(adapter => adapter.id))
  return facts.lora.adapters.filter(adapter => published.has(adapter.id))
}

/**
 * Describe `extra.lora` for `schema()`: the adapters a request may name, each with its default strength and range, and
 * the strength multiplier itself.
 * @param adapters - the adapters a request may select; at least one.
 * @returns the parameter schema entry.
 */
function loraParameter(adapters: readonly LoraAdapter[]): ParameterPropertySpec {
  const catalogue = adapters.map(adapter => `${adapter.id} (default ${adapter.defaultStrength}, `
    + `from ${adapter.minStrength} to ${adapter.maxStrength}${adapter.description === undefined ? '' : `: ${adapter.description}`})`).join('; ')
  return {
    type: 'object',
    description: 'A community LoRA from this server and the strength to apply it at: {"id", "strength"}. Strength 0 '
      + `renders the model without the adapter. Adapters: ${catalogue}.`,
    properties: {
      id: { type: 'string', required: true, description: `The adapter id: ${adapters.map(adapter => adapter.id).join(', ')}.` },
      strength: { type: 'number', description: "Multiplier of the adapter's delta, inside that adapter's range; omitted, its default." },
    },
    additionalProperties: false,
  }
}

/**
 * The `extra` parameters of a task: the model's own, plus `extra.lora` while the task's server serves an adapter.
 * @param served - the task this plugin serves.
 * @param adapters - the adapters a request of this entry may select.
 * @returns the parameter schema of `extra`.
 */
function extraSchema(served: ServedTask, adapters: readonly LoraAdapter[]): ParameterSchemaSpec {
  return adapters.length === 0 ? served.extra : { ...served.extra, lora: loraParameter(adapters) }
}

/**
 * The `extra.lora` value as an adapter selection.
 * @param value - the request's `extra.lora`.
 * @returns the selection, or undefined when the value is absent or not an object with a string `id` and an optional
 *   number `strength`.
 */
function readLora(value: unknown): LoraSelection | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { id, strength } = value as Record<string, unknown>
  if (typeof id !== 'string' || (strength !== undefined && typeof strength !== 'number')) return undefined
  return { id, ...strength === undefined ? {} : { strength } }
}

/**
 * The problems of a request's `extra.lora`: an id the server does not serve, an adapter the DreamVerse registry does
 * not publish for this model and task, or a strength outside the adapter's range. A malformed value is left to the
 * parameter schema, which reports its type.
 * @param adapters - the adapters this entry offers.
 * @param serverAdapters - the server's whole allow-list.
 * @param registry - the `dvLora` registry, when the deployment mounts it.
 * @param model - the model name.
 * @param task - the task.
 * @param extra - the request's `extra` values.
 * @returns one sentence per problem; empty when the adapter is usable.
 */
function loraProblems(
  adapters: readonly LoraAdapter[], serverAdapters: readonly LoraAdapter[], registry: DvLora | undefined, model: string,
  task: TaskId, extra: Record<string, unknown>,
): string[] {
  const selection = adapters.length === 0 ? undefined : readLora(extra['lora'])
  if (selection === undefined) return []
  const { id, strength } = selection
  const adapter = serverAdapters.find(candidate => candidate.id === id)
  if (adapter === undefined) {
    return [`Its extra.lora id "${id}" is not an adapter of this server; the server serves: `
      + `${serverAdapters.map(candidate => candidate.id).join(', ') || 'none'}.`]
  }
  if (!adapters.includes(adapter)) {
    const published = registry?.get(id)
    return [published === undefined
      ? `Its extra.lora id "${id}" is not one this deployment publishes for model ${model} task ${task}; call dv_lora_list for the adapters you can use.`
      : `Its extra.lora id "${id}" is not meant for model ${model} task ${task}: ${published.displayName} serves `
        + `${published.targets.map(target => `${target.model} ${target.tasks.join('/')}`).join(', ')}.`]
  }
  if (strength !== undefined && (strength < adapter.minStrength || strength > adapter.maxStrength)) {
    return [`Its extra.lora strength ${strength} is outside ${id}'s range of ${adapter.minStrength} to ${adapter.maxStrength}.`]
  }
  return []
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
  return validateArgs(schema, extra).map(message => `extra${message.startsWith('.') ? '' : '.'}${message}`)
}

/**
 * A catalog entry for one configured model and task, rendered through one streaming_v2 client of the task's server.
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
  const { inputs, assignReferenceLabels, skill } = served
  const client = new DvFastvideoGeneration(ctx.isolate('dvFastvideoGeneration'), { baseUrl: server.baseUrl })
  // The registry is optional and read on every call, so one mounted or removed later takes effect without a reload.
  const registry = (): DvLora | undefined => ctx.get('dvLora')
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
      const adapters = usableAdapters(capabilities, served, registry(), model, task)
      return {
        duration_sec: { min: capabilities.minSegmentDurationSec, max: capabilities.maxSegmentDurationSec },
        aspect_ratios: capabilities.aspectRatios,
        resolutions: capabilities.resolutions,
        inputs: describeInputs(inputs, deriveInputLimits(inputs, capabilities)),
        extra: JSON.parse(JSON.stringify(extraSchema(served, adapters))) as JsonValue,
      }
    },
    async validateGenerationRequest(request: RenderRequest): Promise<string[]> {
      const capabilities = await client.model()
      const adapters = usableAdapters(capabilities, served, registry(), model, task)
      return [
        ...requestProblems(inputs, deriveInputLimits(inputs, capabilities), request, asset => ctx.dvAssetPool.mediaType(asset)),
        ...extraProblems(model, task, extraSchema(served, adapters), request.extra),
        ...loraProblems(adapters, capabilities.lora.adapters, registry(), model, task, request.extra),
        ...served.promptProblems?.(request) ?? [],
      ]
    },
    render(request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      const assets = request.firstFrame === null ? request.references : [...request.references, request.firstFrame]
      const lora = readLora(request.extra['lora'])
      if (request.extra['lora'] !== undefined && lora === undefined) {
        throw new Error('extra.lora must be an object with a string id and an optional number strength.')
      }
      return (async function* () {
        // Video and audio references can be tens of megabytes each, so they are read concurrently off the event loop.
        const references = await Promise.all(assets.map(async id => ({
          mediaType: ctx.dvAssetPool.mediaType(id), bytes: await readFile(ctx.dvAssetPool.path(id)),
        })))
        // The sound of a video changes only the labels of audio, so the pool reads it only when the media hold audio.
        const audio = references.some(reference => reference.mediaType === 'audio')
        const media = await Promise.all(assets.map(async asset => ({
          asset, mediaType: ctx.dvAssetPool.mediaType(asset), hasAudio: audio && await ctx.dvAssetPool.hasAudio(asset),
        })))
        yield* client.generateSegment({
          prompt: modelPrompt(request, assignReferenceLabels, media),
          references,
          frameWidth: request.frameWidth,
          frameHeight: request.frameHeight,
          numFrames: request.numFrames,
          seed: request.seed,
          returnLastFrame: true,
          ...lora === undefined ? {} : { lora },
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
