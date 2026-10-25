/**
 * Provider plugin `uniserve` of DreamVerse for models served by UniServe servers. It registers into `ctx.dvModels` one
 * entry per model that its `models` config names and per task the config gives a server for. Each entry reads its facts
 * from the server's `GET /v1/capabilities`, renders each request as one `POST /v1/videos/sync` with the references
 * first and the first frame after them, each as a `data:` URI read from `dvAssetPool`, and with each citation of a
 * reference in the prompt replaced by the label that the served model gives the reference. The server answers with the
 * whole MP4; the entry reads its last frame with `dvFfmpeg` and yields the render stream at once.
 *
 * Served models: `fasth3` (MiniMax H3 as FastH3 Omni 8-Step V1), for task `ref2v`. The task's inputs, labels, prompt
 * rule and prompt skill are those of `fasth3` in `@dv/fastvideo`.
 *
 * @module @dv/uniserve
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import { FASTH3_REF2V, FASTH3_REF2V_ABILITIES } from '@dv/fastvideo/fasth3'
import { modelPrompt } from '@dv/fastvideo/reference-labels'
import {
  readPromptSkill, registerServedModels, requestAssets, ServedModels, servedTaskProblems, servedTaskSchema, type TaskServer,
} from '@dv/fastvideo/served-task'
import type { ReferenceLimits, ServedTask } from '@dv/fastvideo/types'
import type { ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent, TaskId } from '@dv/models'

/** `dv-uniserve` configuration. */
export interface Config {
  /** The models to register, by model name, and for each the tasks to serve it for, by task ID, with their UniServe servers. */
  models: ServedModels
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  models: ServedModels.required(),
})

/** The provider name of every entry this plugin registers. */
const PROVIDER = 'uniserve'

/** One task this plugin serves a model for: what the model accepts for it, and UniServe's name of the task. */
interface UniserveTask {
  served: ServedTask
  /** The `task` of a UniServe request, such as `ref2va`. */
  uniserveTask: string
}

/** The models this plugin can serve, with the tasks it can serve each for. */
const SERVED: Record<string, { [T in TaskId]?: UniserveTask }> = {
  fasth3: {
    ref2v: {
      served: { ...FASTH3_REF2V, description: `MiniMax H3 served as FastH3 Omni 8-Step V1 on UniServe: ${FASTH3_REF2V_ABILITIES}` },
      uniserveTask: 'ref2va',
    },
  },
}

/** The `GET /v1/capabilities` answer of a UniServe video server, with the fields this plugin reads. */
interface CapabilitiesBody {
  /** The served model name, which every request names in `model`. */
  model: string
  video: {
    tasks: string[]
    task_conditions: Record<string, { max_images: number; max_videos: number; max_audios: number; max_references: number }>
    canvas: {
      short_edges: number[]
      aspect_ratios: string[]
      /** The canvas by short edge and then by aspect ratio. */
      sizes: Record<string, Record<string, { width: number; height: number }>>
    }
    fps: number
    /** A video has `min_frames + n * clip_frames` frames for a whole `n` of at least 0. */
    frames: { min_frames: number; clip_frames: number }
    min_seconds: number
    max_seconds: number
  }
}

/** What an entry reads from its server once: the served model name, the render facts and the reference limits. */
interface ServerFacts {
  modelName: string
  facts: RenderModelFacts
  limits: ReferenceLimits
}

/** Plugin name. */
export const name = 'dv-uniserve'

/**
 * Required services: the model catalog, the asset pool that holds the bytes and media type of each input asset, and
 * ffmpeg, which reads the last frame of each rendered video.
 */
export const inject = ['dvModels', 'dvAssetPool', 'dvFfmpeg']

/**
 * The text of an error answer: `error.message` of a JSON body when it is a string, else the body as sent.
 * @param response - the server's answer.
 * @returns the text.
 */
async function errorText(response: Response): Promise<string> {
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // A body that is not JSON is reported as sent.
    return text
  }
  const error: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'error') : undefined
  const message: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined
  return typeof message === 'string' ? message : text
}

/**
 * Send one request to the server.
 * @param baseUrl - the server's base URL.
 * @param route - the route, such as `/v1/capabilities`.
 * @param init - the request; its `signal` cancels it.
 * @returns the answer, with status 200.
 * @throws the signal's reason on abort; else Error naming the server, the method, the route and the HTTP status with
 *   the server's text, or the server that cannot be reached.
 */
async function call(baseUrl: string, route: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(new URL(route, baseUrl), init)
  } catch {
    // fetch rejects with the abort reason when the signal aborts, and with a TypeError when the server cannot be reached.
    if (init.signal?.aborted === true) throw init.signal.reason
    throw new Error(`The server at ${baseUrl} cannot be reached.`)
  }
  if (response.status !== 200) {
    throw new Error(`The server at ${baseUrl} answered ${init.method ?? 'GET'} ${route} with HTTP ${String(response.status)}: `
      + await errorText(response))
  }
  return response
}

/**
 * The facts of one entry from its server's capabilities. A resolution is named by its short edge, such as `768p`. A
 * duration in whole seconds has the frame count that UniServe renders for it: `duration × fps` rounded up to the next
 * `min_frames + n × clip_frames`.
 * @param baseUrl - the server's base URL.
 * @param model - the model name, for the error message.
 * @param task - the catalog task, for the error message.
 * @param uniserveTask - the UniServe task the entry sends.
 * @returns the facts.
 * @throws Error when the server does not serve `uniserveTask`, or as `call` throws.
 */
async function readServerFacts(baseUrl: string, model: string, task: TaskId, uniserveTask: string): Promise<ServerFacts> {
  const body = await (await call(baseUrl, '/v1/capabilities')).json() as CapabilitiesBody
  const { video } = body
  const conditions = video.task_conditions[uniserveTask]
  if (!video.tasks.includes(uniserveTask) || conditions === undefined) {
    throw new Error(`The server at ${baseUrl} serves task ${video.tasks.join(', ') || 'none'}, not ${uniserveTask}; the `
      + `dv-uniserve config points model "${model}" for task "${task}" at the wrong server.`)
  }
  const frameSizes = Object.fromEntries(video.canvas.aspect_ratios.map(ratio => [ratio, Object.fromEntries(
    video.canvas.short_edges.map((edge) => {
      // The server lists every canvas it prepared, by short edge and aspect ratio.
      const { width, height } = video.canvas.sizes[String(edge)]?.[ratio] as { width: number; height: number }
      return [`${String(edge)}p`, [width, height] as [number, number]]
    }),
  )]))
  const { min_frames: minFrames, clip_frames: clipFrames } = video.frames
  const [minDurationSec, maxDurationSec] = [Math.ceil(video.min_seconds), Math.floor(video.max_seconds)]
  const numFramesByDurationSec: Record<string, number> = {}
  for (let seconds = minDurationSec; seconds <= maxDurationSec; seconds++) {
    numFramesByDurationSec[String(seconds)] = minFrames + Math.ceil(Math.max(0, seconds * video.fps - minFrames) / clipFrames) * clipFrames
  }
  return {
    modelName: body.model,
    facts: {
      modelId: body.model, aspectRatios: video.canvas.aspect_ratios, resolutions: video.canvas.short_edges.map(edge => `${String(edge)}p`),
      frameSizes, minDurationSec, maxDurationSec, numFramesByDurationSec,
    },
    limits: {
      maxReferences: conditions.max_references,
      referenceMediaTypes: {
        image: { maxCount: conditions.max_images }, video: { maxCount: conditions.max_videos }, audio: { maxCount: conditions.max_audios },
      },
    },
  }
}

/**
 * The `target` of a UniServe request for a render request's frame size and count.
 * @param facts - the entry's facts.
 * @param request - the render request.
 * @returns the short edge, the aspect ratio and the duration in whole seconds.
 * @throws Error when the facts list no canvas of the frame size or no duration of the frame count.
 */
function renderTarget(
  facts: RenderModelFacts, request: RenderRequest,
): { short_edge: number; aspect_ratio: string; duration_seconds: number } {
  const canvas = Object.entries(facts.frameSizes).flatMap(([ratio, sizes]) => Object.entries(sizes)
    .filter(([, [width, height]]) => width === request.frameWidth && height === request.frameHeight)
    .map(([resolution]) => ({ short_edge: Number.parseInt(resolution, 10), aspect_ratio: ratio })))[0]
  if (canvas === undefined) throw new Error(`UniServe renders no ${String(request.frameWidth)}x${String(request.frameHeight)} canvas.`)
  const duration = Object.entries(facts.numFramesByDurationSec).find(([, frames]) => frames === request.numFrames)?.[0]
  if (duration === undefined) throw new Error(`UniServe renders no video of ${String(request.numFrames)} frames.`)
  return { ...canvas, duration_seconds: Number(duration) }
}

/**
 * The backend timings of a rendered video, in seconds: `inference_s` from `x-inference-time-s`, and one `<stage>_s` per
 * stage of the JSON object in `x-stage-durations`. An absent header, and a value that is not a finite number, adds no
 * timing.
 * @param headers - the answer's headers.
 * @returns the timings.
 * @throws SyntaxError when `x-stage-durations` is not JSON.
 */
function renderTimings(headers: Headers): Record<string, number> {
  const stages = JSON.parse(headers.get('x-stage-durations') ?? '{}') as Record<string, unknown>
  const values = { inference: Number(headers.get('x-inference-time-s') ?? Number.NaN), ...stages }
  return Object.fromEntries(Object.entries(values)
    .filter((value): value is [string, number] => typeof value[1] === 'number' && Number.isFinite(value[1]))
    .map(([name, seconds]) => [`${name}_s`, seconds]))
}

/**
 * The last frame of a video as PNG bytes, read by ffmpeg from a temporary copy that is removed afterwards.
 * @param ctx - the plugin context, with `dvFfmpeg`.
 * @param video - the MP4 bytes.
 * @returns the PNG bytes.
 * @throws FfmpegError when ffmpeg cannot read the video or writes no frame.
 */
async function lastFrame(ctx: Context, video: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'dv-uniserve-'))
  try {
    const input = join(dir, 'video.mp4')
    await writeFile(input, video)
    // -sseof seeks into the final second, and -update keeps overwriting the one output frame until the last.
    const argv = ['ffmpeg', '-y', '-loglevel', 'error', '-sseof', '-1', '-i', '{{in:0}}', '-update', '1', '{{out:last.png}}']
    const [still] = (await ctx.dvFfmpeg.run({ argv, inputs: [input], outputs: ['last.png'], dir })).outputs
    return await readFile(still as string)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * A catalog entry for one configured model and task, rendered by the task's UniServe server.
 * @param ctx - the plugin context; `render` reads each input asset from `ctx.dvAssetPool` and the last frame through
 *   `ctx.dvFfmpeg`.
 * @param model - the model name.
 * @param task - the task.
 * @param server - the task's configured server.
 * @returns the entry.
 */
function modelEntry(ctx: Context, model: string, task: TaskId, server: TaskServer): ModelEntry {
  const uniserve = SERVED[model]?.[task]
  /* v8 ignore next -- registerServedModels refuses unknown models and tasks before any entry is built. */
  if (uniserve === undefined) throw new Error(`dv-uniserve serves no model "${model}" for task "${task}".`)
  const { served, uniserveTask } = uniserve
  const { assignReferenceLabels } = served
  // The first successful capabilities answer; the served model stays fixed for the server's lifetime.
  let serverFacts: ServerFacts | null = null
  const readFacts = async (): Promise<ServerFacts> => {
    serverFacts ??= await readServerFacts(server.baseUrl, model, task, uniserveTask)
    return serverFacts
  }
  return {
    modality: 'video',
    task,
    provider: PROVIDER,
    model,
    description: served.description,
    gpuSecondsPerVideoSecond: server.gpuSecondsPerVideoSecond,
    promptSkill: readPromptSkill(served),
    async facts(): Promise<RenderModelFacts> {
      return (await readFacts()).facts
    },
    async schema(): Promise<JsonValue> {
      const { facts, limits } = await readFacts()
      return servedTaskSchema(served, facts, limits)
    },
    async validateGenerationRequest(request: RenderRequest): Promise<string[]> {
      const { limits } = await readFacts()
      return servedTaskProblems(model, task, served, limits, request, asset => ctx.dvAssetPool.mediaType(asset))
    },
    render(request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      const assets = requestAssets(request)
      return (async function* () {
        const { modelName, facts } = await readFacts()
        // Video and audio references can be tens of megabytes each, so they are read concurrently off the event loop.
        const conditions = await Promise.all(assets.map(async (asset) => {
          const { mime } = ctx.dvAssetPool.get(asset)
          const uri = `data:${mime};base64,${(await readFile(ctx.dvAssetPool.path(asset))).toString('base64')}`
          return { type: ctx.dvAssetPool.mediaType(asset), uri, role: 'reference' }
        }))
        // The sound of a video changes only the labels of audio, so the pool reads it only when the media hold audio.
        const audio = assets.some(asset => ctx.dvAssetPool.mediaType(asset) === 'audio')
        const media = await Promise.all(assets.map(async asset => ({
          asset, mediaType: ctx.dvAssetPool.mediaType(asset), hasAudio: audio && await ctx.dvAssetPool.hasAudio(asset),
        })))
        const body = JSON.stringify({
          model: modelName, task: uniserveTask, prompt: modelPrompt(request, assignReferenceLabels, media), conditions,
          target: renderTarget(facts, request), seed: request.seed,
        })
        const response = await call(server.baseUrl, '/v1/videos/sync', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body, ...signal === undefined ? {} : { signal },
        })
        const video = Buffer.from(await response.arrayBuffer())
        yield { kind: 'last_frame', png: await lastFrame(ctx, video) }
        yield { kind: 'video_start', mime: response.headers.get('content-type') ?? 'video/mp4' }
        yield { kind: 'chunk', bytes: video }
        yield { kind: 'done', timings: renderTimings(response.headers) }
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
