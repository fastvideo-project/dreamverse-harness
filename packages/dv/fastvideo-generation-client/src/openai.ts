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
import z from '@deepseek-ai/schemastery'
import { GenerationSegmentError } from './errors.ts'
import type { ModelFacts, SegmentOutput, SegmentRequest } from './types.ts'

/** Explicit deployment limits: FastVideo's OpenAI API does not publish generation capabilities. */
export interface OpenAIConfig {
  /** The served alias and verified limits of this deployment. */
  modelFacts: ModelFacts
  /** ffmpeg executable used to extract the last frame when requested. */
  ffmpegPath: string
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
})

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
 * Generate a clip through the supported synchronous API and return its media and timing events.
 * @param baseUrl - FastVideo server location.
 * @param config - deployment limits and ffmpeg executable.
 * @param request - prompt, typed media, geometry, seed and cancellation signal.
 * @returns last frame when requested, MP4 bytes and timings after generation completes.
 * @throws the abort reason on cancellation; backend or ffmpeg errors otherwise. Temporary files are removed.
 */
export async function* generateOpenAI(
  baseUrl: URL, config: OpenAIConfig, request: SegmentRequest,
): AsyncGenerator<SegmentOutput> {
  const { signal } = request
  signal?.throwIfAborted()
  const body: Record<string, unknown> = {
    model: config.modelFacts.modelId,
    ...(request.task === undefined ? {} : { task: request.task }),
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
    response = await checkedResponse(await fetch(new URL('/v1/videos/sync', baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
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
