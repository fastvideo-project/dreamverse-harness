/**
 * Provider plugin `fastvideo` of DreamVerse for models served by FastVideo servers of the OpenAI-style video job API. It
 * registers into `ctx.dvModels` one entry per model that its `models` config names and per task the config gives a
 * server for; a model or task the config leaves out is not registered. Each task of a model is served by its own server:
 * the client of `@dv/fastvideo-generation-client` sends each render as one video job, with the reference images first
 * and the first frame after them, each with its MIME type and bytes read from `dvAssetPool`, and with each citation of a
 * reference in the prompt replaced by the label that the served model gives the reference. The plugin reads the last
 * frame of the finished video with `dvFfmpeg`. The job API reports no model facts, so each entry describes in `schema()`
 * the durations, aspect ratios and resolutions of its served task's facts and the inputs and `extra` parameters it
 * accepts, and checks the inputs and `extra` in `validateGenerationRequest`. Each entry carries the prompt skill of its
 * model and task, which the catalog registers.
 *
 * Served models: `fasth3` (MiniMax H3 as FastH3), for task `ref2v` (FastH3 Ref2VA) and task `t2v` (FastH3 8-Step V2).
 *
 * @module @dv/fastvideo
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import { DvFastvideoGeneration } from '@dv/fastvideo-generation-client'
import type {} from '@dv/asset-pool'
import type DvFfmpeg from '@dv/ffmpeg'
import type { ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent, TaskId } from '@dv/models'
import { FASTH3 } from './fasth3.ts'
import { modelPrompt } from './reference-labels.ts'
import type { InputRole, ServedFacts, ServedTask, TaskInputs } from './types.ts'

/** One task of one model: the video job server that renders it and its GPU rate. */
export interface TaskServer {
  /** HTTP base URL of the FastVideo video job server, such as `http://127.0.0.1:8029`. */
  baseUrl: string
  /** GPU seconds per rendered video second on this server, declared for the task for the GPU estimate. */
  gpuSecondsPerVideoSecond: number
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
    gpuSecondsPerVideoSecond: z.number().required(),
  }))).required(),
})

/** The provider name of every entry this plugin registers. */
const PROVIDER = 'fastvideo'

/** The most assets of each declared input, from the served task's facts; an input without an entry has no limit. */
type TaskInputLimits = Partial<Record<InputRole, number>>

/** The models this plugin can serve, with the tasks it can serve each for. */
const SERVED: Record<string, { [T in TaskId]?: ServedTask }> = {
  fasth3: FASTH3,
}

/** Plugin name. */
export const name = 'dv-fastvideo'

/**
 * Required services: the model catalog, the asset pool that holds the bytes and MIME type of each input asset, and
 * ffmpeg, which reads the last frame of each finished video.
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
 * The count limits of a task's inputs, from the model's reference limit. The model counts the first frame among its
 * references, so the first frame takes one slot of the model's total and the `reference` input keeps the rest.
 * @param inputs - the inputs the task declares; `SERVED` declares `reference` and `first_frame` together or neither.
 * @param facts - the served task's facts.
 * @returns the limits by declared input; empty for a task without references.
 */
function deriveInputLimits(inputs: TaskInputs, facts: ServedFacts): TaskInputLimits {
  if (inputs.reference === undefined || inputs.first_frame === undefined) return {}
  return { reference: facts.maxReferences - 1, first_frame: 1 }
}

/**
 * Describe each declared input of a task for `schema()`: its `min`, its `max`, and its declared media types.
 * @param inputs - the inputs the task declares.
 * @param limits - the input limits from the served task's facts.
 * @returns the inputs by role.
 */
function describeInputs(inputs: TaskInputs, limits: TaskInputLimits): JsonValue {
  return Object.fromEntries(Object.entries(inputs).map(([role, input]) => [role, {
    // deriveInputLimits gives every declared input its limit.
    min: input.min, max: limits[role as InputRole] as number,
    media_types: Object.fromEntries(input.mediaTypes.map(type => [type, {}])),
  }]))
}

/**
 * The problems of one render request for a task: an input the task does not declare holding an asset, an input holding
 * fewer assets than its `min`, an asset whose media type its input does not declare, or an input holding more assets
 * than the model's limits allow.
 * @param inputs - the inputs the task declares.
 * @param limits - the input limits from the served task's facts.
 * @param request - the render request.
 * @param mediaTypeOf - the media type of an asset, read from the asset pool.
 * @returns the problems, each one sentence; empty when the model renders the request.
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
    for (const asset of assets) {
      const mediaType = mediaTypeOf(asset)
      if (!declared.mediaTypes.includes(mediaType)) problems.push(`Its ${role} input takes assets of type ${accepted}; asset ${asset} is of type ${mediaType}.`)
    }
    const limit = limits[role]
    if (limit !== undefined && assets.length > limit) problems.push(`Its ${role} input takes at most ${limit} assets; this shot has ${assets.length}.`)
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
 * The last frame of an MP4 as PNG bytes: ffmpeg decodes every frame and keeps the last one.
 * @param ffmpeg - the `dvFfmpeg` service.
 * @param video - the MP4 bytes.
 * @returns the PNG bytes.
 * @throws FfmpegError when ffmpeg cannot decode the video.
 */
async function lastFrame(ffmpeg: DvFfmpeg, video: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'dv-fastvideo-'))
  try {
    const input = join(dir, 'video.mp4')
    await writeFile(input, video)
    const argv = ['ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-an', '-update', '1', '{{out:last.png}}']
    return await readFile((await ffmpeg.run({ argv, inputs: [input], outputs: ['last.png'], dir })).outputs[0] as string)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * A catalog entry for one configured model and task, rendered as one job of the task's server.
 * @param ctx - the plugin context; the client lives in an isolated `dvFastvideoGeneration` scope, `render` reads each
 *   input asset from `ctx.dvAssetPool`, and the last frame comes from `ctx.dvFfmpeg`.
 * @param model - the model name.
 * @param task - the task.
 * @param server - the task's configured server.
 * @returns the entry.
 */
function modelEntry(ctx: Context, model: string, task: TaskId, server: TaskServer): ModelEntry {
  const served = SERVED[model]?.[task]
  /* v8 ignore next -- checkConfig refuses unknown models and tasks before any entry is built. */
  if (served === undefined) throw new Error(`dv-fastvideo serves no model "${model}" for task "${task}".`)
  const { inputs, extra, assignReferenceLabels, skill, facts } = served
  const limits = deriveInputLimits(inputs, facts)
  const client = new DvFastvideoGeneration(ctx.isolate('dvFastvideoGeneration'), { baseUrl: server.baseUrl })
  return {
    modality: 'video',
    task,
    provider: PROVIDER,
    model,
    description: served.description,
    gpuSecondsPerVideoSecond: server.gpuSecondsPerVideoSecond,
    promptSkill: {
      name: skill.name, description: skill.description,
      content: readFileSync(new URL(`../skills/${skill.file}`, import.meta.url), 'utf8'),
    },
    facts(): Promise<RenderModelFacts> {
      const { modelId, aspectRatios, resolutions, frameSizes, minDurationSec, maxDurationSec, numFramesByDurationSec } = facts
      return Promise.resolve({ modelId, aspectRatios, resolutions, frameSizes, minDurationSec, maxDurationSec, numFramesByDurationSec })
    },
    schema(): Promise<JsonValue> {
      return Promise.resolve({
        duration_sec: { min: facts.minDurationSec, max: facts.maxDurationSec },
        aspect_ratios: facts.aspectRatios,
        resolutions: facts.resolutions,
        inputs: describeInputs(inputs, limits),
        extra: JSON.parse(JSON.stringify(extra)) as JsonValue,
      })
    },
    validateGenerationRequest(request: RenderRequest): Promise<string[]> {
      return Promise.resolve([
        ...requestProblems(inputs, limits, request, asset => ctx.dvAssetPool.mediaType(asset)),
        ...extraProblems(model, task, extra, request.extra),
        ...served.promptProblems?.(request) ?? [],
      ])
    },
    render(request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      const assets = request.firstFrame === null ? request.references : [...request.references, request.firstFrame]
      return (async function* () {
        const images = await Promise.all(assets.map(async id => ({
          mime: ctx.dvAssetPool.get(id).mime, bytes: await readFile(ctx.dvAssetPool.path(id)),
        })))
        const media = assets.map(asset => ({ asset, mediaType: ctx.dvAssetPool.mediaType(asset) }))
        const { video, timings } = await client.generateVideo({
          task: served.jobTask,
          prompt: modelPrompt(request, assignReferenceLabels, media),
          images,
          frameWidth: request.frameWidth,
          frameHeight: request.frameHeight,
          numFrames: request.numFrames,
          seed: request.seed,
          ...signal === undefined ? {} : { signal },
        })
        yield { kind: 'video_start', mime: 'video/mp4' }
        yield { kind: 'chunk', bytes: video }
        yield { kind: 'last_frame', png: await lastFrame(ctx.dvFfmpeg, video) }
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
