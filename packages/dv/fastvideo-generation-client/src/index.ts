/**
 * `dvFastvideoGeneration`: the harness client for the FastVideo generation backend's OpenAI-style video job API, which
 * `fastvideo serve` serves. HTTP calls use `fetch`; each video is one job: `POST /v1/videos` submits it,
 * `GET /v1/videos/{id}` reports its status, and `GET /v1/videos/{id}/content` returns the finished MP4.
 *
 * @module @dv/fastvideo-generation-client
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GenerationSegmentError } from './errors.ts'
import type { VideoOutput, VideoRequest } from './types.ts'

export * from './errors.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client for the FastVideo generation backend API. */
    dvFastvideoGeneration: DvFastvideoGeneration
  }
}

/** Generation backend location. */
export interface Config {
  /** HTTP base URL of the generation backend, such as `http://127.0.0.1:8029`. */
  baseUrl: string
}

/** The fields of a `/v1/videos` job object that the client reads. */
interface JobBody {
  id: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  error?: { message: string } | null
  inference_time_s?: number | null
}

/** The time between two status reads of a running job; the backend reports no progress between 0 and 100. */
const POLL_MS = 1000

/** Submits video jobs and downloads their videos. */
export class DvFastvideoGeneration extends Service {
  static Config: z<Config> = z.object({
    baseUrl: z.string().required(),
  })

  private readonly baseUrl: URL

  /**
   * @param ctx - owning plugin context.
   * @param config - validated generation backend location.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dvFastvideoGeneration')
    this.baseUrl = new URL(config.baseUrl)
  }

  /**
   * Submit one job, poll its status until it completes, and download its video. HTTP 400 at submission and job status
   * `failed` reject with `GenerationSegmentError`. Aborting `request.signal` stops polling and rejects with
   * `signal.reason`; the backend finishes a job whose generation has started.
   * @param request - the job inputs and an optional abort signal.
   * @returns the MP4 bytes and the timings.
   * @throws Error naming the route for any other status than 200, or the `fetch` error when the backend is unreachable.
   */
  async generateVideo(request: VideoRequest): Promise<VideoOutput> {
    const { signal } = request
    signal?.throwIfAborted()
    const started = Date.now()
    const submitted = await this.call('POST', '/v1/videos', signal, JSON.stringify(jobBody(request)))
    const { id } = await submitted.json() as JobBody
    for (;;) {
      const job = await (await this.call('GET', `/v1/videos/${id}`, signal)).json() as JobBody
      if (job.status === 'failed') throw new GenerationSegmentError(job.error?.message ?? 'The video job failed.', 'generation_failed')
      if (job.status === 'completed') {
        const video = Buffer.from(await (await this.call('GET', `/v1/videos/${id}/content`, signal)).arrayBuffer())
        const generation = typeof job.inference_time_s === 'number' ? { generation_ms: Math.round(job.inference_time_s * 1000) } : {}
        return { video, timings: { e2e_latency_ms: Date.now() - started, ...generation } }
      }
      await pause(signal)
    }
  }

  /**
   * Send one request and return its successful response.
   * @param method - the HTTP method.
   * @param path - the route path.
   * @param signal - aborts the request.
   * @param body - the JSON body of a POST.
   * @returns the response with status 200.
   * @throws GenerationSegmentError for HTTP 400 at submission; Error naming the route for any other status than 200.
   */
  private async call(method: 'GET' | 'POST', path: string, signal: AbortSignal | undefined, body?: string): Promise<Response> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      ...body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body },
      ...signal === undefined ? {} : { signal },
    })
    if (response.status === 200) return response
    const text = await response.text()
    if (method === 'POST' && response.status === 400) throw new GenerationSegmentError(errorMessage(text), 'invalid_request')
    throw new Error(`FastVideo generation backend ${method} ${path} returned HTTP ${response.status}: ${text}`)
  }
}

/**
 * The `POST /v1/videos` body of one request: each image becomes an `image_reference` `data:` URL in model order.
 * @param request - the job inputs.
 * @returns the JSON body.
 */
function jobBody(request: VideoRequest): Record<string, unknown> {
  return {
    task: request.task,
    prompt: request.prompt,
    size: `${request.frameWidth}x${request.frameHeight}`,
    num_frames: request.numFrames,
    ...request.seed === undefined ? {} : { seed: request.seed },
    ...request.images.length === 0 ? {} : {
      image_reference: request.images.map(image => ({ image_url: `data:${image.mime};base64,${image.bytes.toString('base64')}` })),
    },
  }
}

/**
 * The failure message of an HTTP 400 body: FastAPI's `detail`, or the body itself when it holds none.
 * @param text - the response body.
 * @returns the message.
 */
function errorMessage(text: string): string {
  try {
    const { detail } = JSON.parse(text) as { detail?: unknown }
    if (detail !== undefined) return typeof detail === 'string' ? detail : JSON.stringify(detail)
  } catch {
    // SyntaxError: a body that is not JSON is its own message.
  }
  return text
}

/**
 * Wait one poll interval, or reject with the abort reason when the signal fires first.
 * @param signal - the job's abort signal.
 */
function pause(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason as Error)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, POLL_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export default DvFastvideoGeneration
