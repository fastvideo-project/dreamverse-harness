/**
 * Provider plugin `fastvideo` of DreamVerse for models served by local FastVideo streaming_v2 servers. It registers into
 * `ctx.dvModels` one entry per model that its `models` config names and per task the config gives a server for; a model
 * or task the config leaves out is not registered. Each task of a model is served by its own server: the streaming_v2
 * client of `@dv/fastvideo-generation-client` sends each render as one `POST /v1/streamv2/generate`, with the references
 * first and the first frame after them, each as its media type and bytes read from `dvAssetPool`, and with each citation
 * of a reference in the prompt replaced by the label that the served model gives the reference. Each entry describes
 * in `schema()` the durations, aspect ratios and resolutions of its server and the inputs and `extra` parameters it
 * accepts, and checks the inputs and `extra` in `validateGenerationRequest`. Each entry carries the prompt skill of its
 * model and task, which the catalog registers.
 *
 * Served models: `fasth3` (MiniMax H3 as FastH3), for task `ref2v` (FastH3 Ref2VA) and task `t2v` (FastH3 8-Step V2).
 *
 * @module @dv/fastvideo
 */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import { DvFastvideoGeneration, type ModelFacts } from '@dv/fastvideo-generation-client'
import type {} from '@dv/asset-pool'
import type { ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent, TaskId } from '@dv/models'
import { FASTH3 } from './fasth3.ts'
import { modelPrompt } from './reference-labels.ts'
import {
  readPromptSkill, registerServedModels, requestAssets, ServedModels, servedTaskProblems, servedTaskSchema, type TaskServer,
} from './served-task.ts'
import type { ServedTask } from './types.ts'

/** `dv-fastvideo` configuration. */
export interface Config {
  /**
   * The models to register, by model name, and for each the tasks to serve it for, by task ID, with their FastVideo
   * streaming_v2 servers.
   */
  models: ServedModels
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  models: ServedModels.required(),
})

/** The provider name of every entry this plugin registers. */
const PROVIDER = 'fastvideo'

/** The models this plugin can serve, with the tasks it can serve each for. */
const SERVED: Record<string, { [T in TaskId]?: ServedTask }> = {
  fasth3: FASTH3,
}

/** Plugin name. */
export const name = 'dv-fastvideo'

/** Required services: the model catalog, and the asset pool that holds the bytes and media type of each input asset. */
export const inject = ['dvModels', 'dvAssetPool']

/**
 * The render facts of a streaming_v2 server's model facts.
 * @param facts - the server's model facts.
 * @returns the render facts.
 */
function renderFacts(facts: ModelFacts): RenderModelFacts {
  return {
    modelId: facts.modelId, aspectRatios: facts.aspectRatios, resolutions: facts.resolutions, frameSizes: facts.frameSizes,
    minDurationSec: facts.minSegmentDurationSec, maxDurationSec: facts.maxSegmentDurationSec,
    numFramesByDurationSec: facts.numFramesByDurationSec,
  }
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
  /* v8 ignore next -- registerServedModels refuses unknown models and tasks before any entry is built. */
  if (served === undefined) throw new Error(`dv-fastvideo serves no model "${model}" for task "${task}".`)
  const { assignReferenceLabels } = served
  const client = new DvFastvideoGeneration(ctx.isolate('dvFastvideoGeneration'), { baseUrl: server.baseUrl })
  return {
    modality: 'video',
    task,
    provider: PROVIDER,
    model,
    description: served.description,
    gpuSecondsPerVideoSecond: server.gpuSecondsPerVideoSecond,
    promptSkill: readPromptSkill(served),
    async facts(): Promise<RenderModelFacts> {
      return renderFacts(await client.model())
    },
    async schema(): Promise<JsonValue> {
      const capabilities = await client.model()
      return servedTaskSchema(served, renderFacts(capabilities), capabilities)
    },
    async validateGenerationRequest(request: RenderRequest): Promise<string[]> {
      return servedTaskProblems(model, task, served, await client.model(), request, asset => ctx.dvAssetPool.mediaType(asset))
    },
    render(request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      const assets = requestAssets(request)
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
  registerServedModels(ctx, name, SERVED, config.models, (model, task, server) => modelEntry(ctx, model, task, server))
}
