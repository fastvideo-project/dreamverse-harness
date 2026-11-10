/**
 * FastVideo's synchronous OpenAI video API, projected into DreamVerse render events. The MP4 arrives whole;
 * ffmpeg extracts its last frame locally. Cancelling the client does not interrupt an already running CUDA call.
 *
 * @module @dv/fastvideo-generation-client/openai
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import z from '@deepseek-ai/schemastery'
import { GenerationSegmentError } from './errors.ts'
import type { ModelFacts, SegmentOutput, SegmentRequest } from './types.ts'

/** Explicit deployment limits: FastVideo's OpenAI API does not publish generation capabilities. */
export interface OpenAIConfig {
  /** The served alias and verified limits of this deployment. */
  modelFacts: ModelFacts
  /** ffmpeg executable used to extract the last frame when requested. */
  ffmpegPath: string
  /** Use native catalog discovery, lifecycle controls, and tracked asynchronous jobs. */
  managed?: boolean
  /** Track native async jobs without requiring a dynamic model catalog, e.g. a fixed Ray deployment. */
  asyncJobs?: boolean
  /** Native task associated with this catalog entry. */
  task?: string | null
  /** Name shown in generation-model selectors. */
  displayName?: string | null
  /** Delay between asynchronous job-state reads. */
  pollIntervalMs?: number
}

// Schemastery's tuple output is typed as optional even when both elements are required.
const frameSize = z.tuple([z.natural().min(1).required(), z.natural().min(1).required()]).min(2).max(2) as z<[number, number]>

/** Loader validation for an explicitly selected OpenAI deployment. */
export const OpenAIConfig: z<OpenAIConfig> = z.object({
  modelFacts: z.object({
    modelId: z.string().required(),
    aspectRatios: z.array(z.string()).required(),
    resolutions: z.array(z.string()).required(),
    minSegmentDurationSec: z.natural().min(1).required(),
    maxSegmentDurationSec: z.natural().min(1).required(),
    maxReferences: z.natural().required(),
    referenceMediaTypes: z.dict(z.object({ maxCount: z.natural().required() })).required(),
    frameSizes: z.dict(z.dict(frameSize)).required(),
    numFramesByDurationSec: z.dict(z.natural().min(1)).required(),
  }).required(),
  ffmpegPath: z.string().required(),
  managed: z.boolean().default(false),
  asyncJobs: z.boolean().default(false),
  task: z.union([z.const(null), z.string()]).default(null),
  displayName: z.union([z.const(null), z.string()]).default(null),
  pollIntervalMs: z.natural().min(1).default(1000),
})

/** Submit once, follow its job id, and retrieve the resulting media. */
async function generateManaged(
  baseUrl: URL, config: OpenAIConfig, body: Record<string, unknown>, headers: Record<string, string>,
  signal: AbortSignal | undefined, fetchImpl: typeof fetch,
): Promise<Response> {
  const options = { headers, ...signal === undefined ? {} : { signal } }
  const response = await checkedResponse(await fetchImpl(new URL('/v1/videos', baseUrl), {
    ...options, method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  const created: unknown = await response.json()
  if (typeof created !== 'object' || created === null || !('id' in created) || typeof created.id !== 'string') {
    throw new Error('FastVideo did not return a generation job id')
  }
  const route = new URL(`/v1/videos/${encodeURIComponent(created.id)}`, baseUrl)
  try {
    for (;;) {
      const result = await checkedResponse(await fetchImpl(route, options))
      const state: unknown = await result.json()
      if (typeof state !== 'object' || state === null || !('status' in state)) throw new Error('Invalid FastVideo job state')
      if (state.status === 'completed') return await checkedResponse(await fetchImpl(new URL(route.href + '/content'), options))
      if (state.status === 'failed') {
        const error = 'error' in state ? state.error : null
        const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message : 'FastVideo generation failed'
        throw new Error(message)
      }
      if (state.status !== 'queued' && state.status !== 'in_progress') throw new Error('Unknown FastVideo job status')
      await delay(config.pollIntervalMs ?? 1000, undefined, options)
    }
  } catch (error) {
    if (signal?.aborted === true) {
      // Deletion cancels queued work; an active native generation retains its GPU lock until it settles.
      await fetchImpl(route, { method: 'DELETE', headers }).catch(() => undefined)
    }
    throw error
  }
}

/** Wait for ffmpeg to exit even when cancellation reports its error before process close. */
async function extractFrame(file: string, args: string[], signal?: AbortSignal): Promise<void> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)))
  const outcome: { error: Error | null } = { error: null }
  const child = execFile(file, args, { env, ...(signal === undefined ? {} : { signal }) }, (error) => { outcome.error = error })
  await new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
  if (outcome.error !== null) throw outcome.error
}

/** Keep a useful backend failure in the conversation without copying an entire server traceback. */
function backendErrorText(body: string): string {
  let message = body
  try {
    const value: unknown = JSON.parse(body)
    if (typeof value === 'object' && value !== null && 'error' in value
      && typeof value.error === 'object' && value.error !== null && 'message' in value.error
      && typeof value.error.message === 'string') message = value.error.message
  } catch { /* A plain-text backend failure is also supported. */ }
  if (message.includes('Traceback (most recent call last)')) {
    const lines = message.trim().split('\n').map(line => line.trim()).filter(Boolean)
    message = lines.at(-1) ?? 'FastVideo generation failed'
  }
  const limit = 2048
  return message.length <= limit ? message : `${message.slice(0, limit)}… [truncated; see FastVideo server logs]`
}

/**
 * Read a successful response or report the FastVideo error body.
 * @param response - the backend response.
 * @returns the successful response.
 * @throws GenerationSegmentError for a rejected request, or Error for another HTTP failure.
 */
export async function checkedResponse(response: Response): Promise<Response> {
  if (response.ok) return response
  const body = backendErrorText(await response.text())
  if (response.status === 400 || response.status === 422) throw new GenerationSegmentError(body, 'invalid_request')
  throw new Error(`FastVideo OpenAI backend returned HTTP ${response.status}: ${body}`)
}

/**
 * Generate a clip through the selected native video API and return its media and timing events.
 * @param baseUrl - FastVideo server location.
 * @param config - deployment limits and ffmpeg executable.
 * @param request - prompt, typed media, geometry, seed and cancellation signal.
 * @returns last frame when requested, MP4 bytes and timings after generation completes.
 * @throws the abort reason on cancellation; backend or ffmpeg errors otherwise. Temporary files are removed.
 */
export async function* generateOpenAI(
  baseUrl: URL, config: OpenAIConfig, request: SegmentRequest,
  headers: Record<string, string> = {}, fetchImpl: typeof fetch = globalThis.fetch,
): AsyncGenerator<SegmentOutput> {
  const { signal } = request
  signal?.throwIfAborted()
  const body: Record<string, unknown> = {
    model: config.modelFacts.modelId,
    ...(request.task === undefined && config.task == null ? {} : { task: request.task ?? config.task }),
    prompt: request.prompt,
    width: request.frameWidth,
    height: request.frameHeight,
    num_frames: request.numFrames,
    ...(request.seed === undefined ? {} : { seed: request.seed }),
  }
  const references: Record<string, Array<Record<string, string>>> = {}
  for (const reference of request.references) {
    const type = reference.mediaType
    if (type !== 'image' && type !== 'video' && type !== 'audio') {
      throw new GenerationSegmentError(`Unsupported reference media type ${type}`, 'invalid_request')
    }
    const mime = reference.mimeType ?? `${type}/octet-stream`
    if (mime.split('/')[0] !== type) throw new GenerationSegmentError('Reference MIME type does not match its media type', 'invalid_request')
    const field = `${type}_reference`
    ;(references[field] ??= []).push({ [`${type}_url`]: `data:${mime};base64,${reference.bytes.toString('base64')}` })
  }
  Object.assign(body, references)
  let response: Response
  try {
    response = config.managed === true || config.asyncJobs === true
      ? await generateManaged(baseUrl, config, body, headers, signal, fetchImpl)
      : await checkedResponse(await fetchImpl(new URL('/v1/videos/sync', baseUrl), {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      }))
    const video = Buffer.from(await response.arrayBuffer())
    signal?.throwIfAborted()
    const mime = response.headers.get('content-type') ?? ''
    if (!mime.startsWith('video/')) {
      throw new Error('FastVideo OpenAI backend returned a non-video response')
    }
    if (request.returnLastFrame) {
      const dir = await mkdtemp(join(tmpdir(), 'dv-fastvideo-openai-'))
      let png: Buffer
      try {
        const input = join(dir, 'video.mp4')
        const output = join(dir, 'last.png')
        await writeFile(input, video, { mode: 0o600 })
        await extractFrame(config.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-sseof', '-1', '-i', input,
          '-update', '1', '-y', output], signal)
        png = await readFile(output)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
      signal?.throwIfAborted()
      yield { kind: 'last_frame', png }
    }
    signal?.throwIfAborted()
    yield { kind: 'video_start', mime }
    yield { kind: 'chunk', bytes: video }
    const inference = Number(response.headers.get('x-inference-time-s'))
    const timings: Record<string, number> = {}
    if (response.headers.has('x-inference-time-s') && Number.isFinite(inference)) timings['inference_s'] = inference
    yield { kind: 'done', timings }
  } catch (error) {
    if (signal?.aborted === true) throw signal.reason
    throw error
  }
}
