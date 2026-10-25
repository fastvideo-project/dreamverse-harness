/**
 * The config, registration, request checks, schema and prompt skill of served tasks, shared by the provider plugins that
 * serve the models of `SERVED` tables: the `models` config and its check, the registration of one catalog entry per
 * configured model and task, the input count limits derived from a server's reference limits, the `schema()` and the
 * problems of `validateGenerationRequest` of a catalog entry, and its `promptSkill`.
 *
 * @module @dv/fastvideo/served-task
 */
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type { ModelEntry, RenderModelFacts, RenderRequest, TaskId } from '@dv/models'
import type { InputRole, MediaType, ReferenceLimits, ServedTask, TaskInputs } from './types.ts'

/** One task of one model: the server that renders it and its GPU rate. */
export interface TaskServer {
  /** HTTP base URL of the server that renders the model for the task, such as `http://127.0.0.1:8029`. */
  baseUrl: string
  /** GPU seconds per rendered video second on this server, declared for the task for the GPU estimate. */
  gpuSecondsPerVideoSecond: number
}

/** The `models` config of a provider plugin: by model name, the tasks to serve it for, by task ID, with their servers. */
export type ServedModels = Record<string, Record<string, TaskServer>>

/** Loader validation of a `models` config. */
export const ServedModels: z<ServedModels> = z.dict(z.dict(z.object({
  baseUrl: z.string().required(),
  gpuSecondsPerVideoSecond: z.number().required(),
})))

/**
 * Register one catalog entry into `ctx.dvModels` per configured model and task, after checking the `models` config
 * against the models and tasks that the plugin serves.
 * @param ctx - the plugin context.
 * @param plugin - the plugin name, such as `dv-fastvideo`, which the error messages name.
 * @param served - the models the plugin can serve, each with the tasks it can serve the model for.
 * @param models - the validated `models` config.
 * @param modelEntry - builds the entry of one configured model and task.
 * @throws Error naming an unknown model, an unknown task, or a model without tasks; then no entry is registered.
 */
export function registerServedModels(
  ctx: Context, plugin: string, served: Record<string, object>, models: ServedModels,
  modelEntry: (model: string, task: TaskId, server: TaskServer) => ModelEntry,
): void {
  for (const [model, tasks] of Object.entries(models)) {
    const servedTasks = served[model]
    if (servedTasks === undefined) throw new Error(`${plugin} serves no model "${model}"; it serves: ${Object.keys(served).join(', ')}.`)
    if (Object.keys(tasks).length === 0) throw new Error(`${plugin}: model "${model}" names no task.`)
    for (const task of Object.keys(tasks)) {
      if (!Object.hasOwn(servedTasks, task)) {
        throw new Error(`${plugin} serves model "${model}" for no task "${task}"; its tasks: ${Object.keys(servedTasks).join(', ')}.`)
      }
    }
  }
  const configured = Object.entries(models).flatMap(([model, tasks]) =>
    Object.entries(tasks).map(([task, server]) => ({ model, task: task as TaskId, server })))
  for (const { model, task, server } of configured) {
    const entry = modelEntry(model, task, server)
    ctx.effect(() => ctx.dvModels.register(entry), `dvModels ${model} ${task}`)
  }
}

/** The count limits of one input, read from the server. */
interface InputLimits {
  /** The most assets in the input across all media types. */
  maxCount: number
  /** The most assets of each media type in the input; a declared media type without a key has no count limit. */
  maxCountByMediaType: Partial<Record<MediaType, number>>
}

/** The count limits by declared input; an input without an entry has no limit beyond its declaration. */
type TaskInputLimits = Partial<Record<InputRole, InputLimits>>

/**
 * The count limits of a task's inputs, from the server's reference limits. The server counts the first frame among its
 * references, so the first frame takes one slot of the server's total and one slot of each media type that the
 * `first_frame` input accepts, and the `reference` input keeps the rest. A media type that the `reference` input
 * declares and the server does not accept has a limit of 0.
 * @param inputs - the inputs the task declares; `SERVED` declares `reference` and `first_frame` together or neither.
 * @param limits - the server's reference limits.
 * @returns the limits by declared input; empty for a task without references.
 */
function deriveInputLimits(inputs: TaskInputs, limits: ReferenceLimits): TaskInputLimits {
  const { reference, first_frame: firstFrame } = inputs
  if (reference === undefined || firstFrame === undefined) return {}
  const firstFrameTypes = new Set(firstFrame.mediaTypes)
  const maxCountByMediaType = Object.fromEntries(reference.mediaTypes.map(mediaType => [
    mediaType, (limits.referenceMediaTypes[mediaType]?.maxCount ?? 0) - (firstFrameTypes.has(mediaType) ? 1 : 0),
  ]))
  return {
    reference: { maxCount: limits.maxReferences - 1, maxCountByMediaType },
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
 * The `schema()` of a served task's catalog entry: the duration range, aspect ratios and resolutions of the server's
 * facts, each declared input with its `min`, its total `max` and its media types with each type's `max` under the
 * server's reference limits, and the `extra` parameter schema.
 * @param served - the served task.
 * @param facts - the server's render facts.
 * @param limits - the server's reference limits.
 * @returns the schema.
 */
export function servedTaskSchema(served: ServedTask, facts: RenderModelFacts, limits: ReferenceLimits): JsonValue {
  return {
    duration_sec: { min: facts.minDurationSec, max: facts.maxDurationSec },
    aspect_ratios: facts.aspectRatios,
    resolutions: facts.resolutions,
    inputs: describeInputs(served.inputs, deriveInputLimits(served.inputs, limits)),
    extra: JSON.parse(JSON.stringify(served.extra)) as JsonValue,
  }
}

/**
 * Every problem of one render request for a served task: the input problems under the server's reference limits, then
 * the `extra` problems, then the problems under the model's own prompt rules.
 * @param model - the model name.
 * @param task - the task.
 * @param served - the served task.
 * @param limits - the server's reference limits.
 * @param request - the render request.
 * @param mediaTypeOf - the media type of an asset, read from the asset pool.
 * @returns the problems, each one sentence; empty when the server renders the request.
 */
export function servedTaskProblems(
  model: string, task: TaskId, served: ServedTask, limits: ReferenceLimits, request: RenderRequest,
  mediaTypeOf: (asset: RenderRequest['references'][number]) => string,
): string[] {
  return [
    ...requestProblems(served.inputs, deriveInputLimits(served.inputs, limits), request, mediaTypeOf),
    ...extraProblems(model, task, served.extra, request.extra),
    ...served.promptProblems?.(request) ?? [],
  ]
}

/**
 * The input assets of a render request in the order that the server receives them: the references in input order, then
 * the first frame when the request has one.
 * @param request - the render request.
 * @returns the assets.
 */
export function requestAssets(request: RenderRequest): RenderRequest['references'] {
  return request.firstFrame === null ? request.references : [...request.references, request.firstFrame]
}

/**
 * The prompt skill of a served task, with its body read from this package's `skills` directory.
 * @param served - the served task.
 * @returns the `promptSkill` of the task's catalog entry.
 */
export function readPromptSkill(served: ServedTask): NonNullable<ModelEntry['promptSkill']> {
  const { skill } = served
  return {
    name: skill.name, description: skill.description,
    content: readFileSync(new URL(`../skills/${skill.file}`, import.meta.url), 'utf8'),
  }
}
