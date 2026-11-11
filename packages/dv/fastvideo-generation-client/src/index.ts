/**
 * `dvFastvideoGeneration`: the harness client for FastVideo generation. `model()` checks the served alias with
 * `GET /v1/model_info` and returns the configured facts; `generateSegment` sends one `POST /v1/videos/sync` with each
 * reference as a base64 `data:` URL and returns the whole MP4.
 *
 * @module @dv/fastvideo-generation-client
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { renderTimings } from '@dv/models'
import { fetch, getGlobalDispatcher, type Dispatcher, type Response } from 'undici'
import { GenerationSegmentError } from './errors.ts'
import { deriveModelFacts, modelFactsConfig, type ModelFactsConfig } from './model-facts.ts'
import { REFERENCE_FIELDS, referenceMediaType } from './references.ts'
import type { ModelFacts, SegmentRequest, SegmentVideo } from './types.ts'

export * from './errors.ts'
export * from './model-facts.ts'
export * from './references.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client for the FastVideo generation backend API. */
    dvFastvideoGeneration: DvFastvideoGeneration
  }
}

/** Generation backend location and the facts of the model it serves. */
export interface Config {
  /** HTTP base URL of the generation backend, such as `http://127.0.0.1:8029`. */
  baseUrl: string
  /** Optional task selector understood by the native FastVideo API. */
  task?: string | null
  /** The facts of the served model, which FastVideo does not publish. */
  modelFacts: ModelFactsConfig
}

/**
 * The text of a backend failure: `error.message` of an `application/json` body, else the body; a Python traceback
 * becomes its final exception line, and text longer than 2,048 characters is truncated.
 * @param response - the failed response.
 * @returns the text.
 */
async function backendErrorText(response: Response): Promise<string> {
  const body = await response.text()
  let value: unknown = null
  if (response.headers.get('content-type')?.startsWith('application/json') === true) {
    try {
      value = JSON.parse(body)
    } catch { /* SyntaxError: an `application/json` body that is not JSON is reported as sent, beside its HTTP status. */ }
  }
  let message = typeof value === 'object' && value !== null && 'error' in value
    && typeof value.error === 'object' && value.error !== null && 'message' in value.error
    && typeof value.error.message === 'string' ? value.error.message : body
  if (message.includes('Traceback (most recent call last)')) {
    // The trimmed traceback ends with its exception line.
    message = (message.trim().split('\n').at(-1) as string).trim()
  }
  const limit = 2048
  return message.length <= limit ? message : `${message.slice(0, limit)}… [truncated; see FastVideo server logs]`
}

/**
 * The installed global dispatcher with its headers timeout turned off for each request. `/v1/videos/sync` sends its
 * headers only after the whole video is generated, which can take longer than undici's 300-second default.
 * @returns the dispatcher; it shares the global dispatcher's connections and proxy routing, and is never closed.
 */
function untimedDispatcher(): Dispatcher {
  // FastVideo answers with a FileResponse of the finished MP4, so the body keeps the global body timeout.
  return getGlobalDispatcher().compose(dispatch => (options, handler) => dispatch({ ...options, headersTimeout: 0 }, handler))
}

/** Checks the served model and generates segments with the configured facts. */
export class DvFastvideoGeneration extends Service {
  static Config: z<Config> = z.object({
    baseUrl: z.string().required(),
    task: z.union([z.const(null), z.string()]).default(null),
    modelFacts: modelFactsConfig.required(),
  })

  private readonly baseUrl: URL
  /** The facts derived from `modelFacts` when the client is built. */
  readonly facts: ModelFacts
  /** Whether a `GET /v1/model_info` confirmed the served alias; the served model stays fixed for the backend's lifetime. */
  private checked = false

  /**
   * @param ctx - owning plugin context.
   * @param config - generation backend location and model facts.
   * @throws Error naming the inconsistency of the configured facts.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dvFastvideoGeneration')
    this.baseUrl = new URL(config.baseUrl)
    this.facts = deriveModelFacts(config.modelFacts)
  }

  /**
   * Check once that the backend serves the configured model.
   * @returns the model facts.
   * @throws Error naming the route and the HTTP status for a status other than 200, Error naming the route for a body
   *   that is not JSON, Error naming the served alias when it is missing or differs from `modelFacts.modelId`, or the
   *   `fetch` error when the backend is unreachable.
   */
  async model(): Promise<ModelFacts> {
    if (this.checked) return this.facts
    const route = 'GET /v1/model_info'
    const response = await fetch(new URL('/v1/model_info', this.baseUrl))
    if (response.status !== 200) {
      throw new Error(`FastVideo ${route} returned HTTP ${response.status}: ${await backendErrorText(response)}`)
    }
    const text = await response.text()
    let info: { served_model_name?: unknown } | null
    try {
      info = JSON.parse(text) as { served_model_name?: unknown } | null
    } catch (error) {
      throw new Error(`FastVideo ${route} answered no JSON: ${(error as SyntaxError).message}`, { cause: error })
    }
    const served = info?.served_model_name
    if (typeof served !== 'string') throw new Error(`FastVideo ${route} reports no served_model_name; expected ${this.facts.modelId}.`)
    if (served !== this.facts.modelId) throw new Error(`FastVideo serves ${served}; modelFacts.modelId is ${this.facts.modelId}.`)
    this.checked = true
    return this.facts
  }

  /**
   * Generate one segment with one `POST /v1/videos/sync`. The backend sends no response before the whole video is
   * generated; the request has no client-side headers timeout.
   * @param request - the segment inputs and an optional abort signal.
   * @returns the MP4 bytes, their content type and the backend timings.
   * @throws GenerationSegmentError for a reference of another media type, or for HTTP 400;
   *   Error for another HTTP failure or a response that is not `video/*`; `signal.reason` on abort.
   */
  async generateSegment(request: SegmentRequest): Promise<SegmentVideo> {
    const { signal } = request
    signal?.throwIfAborted()
    const unsupported = request.references.find(reference => referenceMediaType(reference.mimeType) === undefined)
    if (unsupported !== undefined) throw new GenerationSegmentError(`FastVideo takes no reference of type ${unsupported.mimeType}.`)
    // One list per media type, in the caller's order within the type.
    const references = Object.fromEntries(Object.entries(REFERENCE_FIELDS).flatMap(([type, { field, urlKey }]) => {
      const urls = request.references.filter(reference => referenceMediaType(reference.mimeType) === type)
        .map(reference => ({ [urlKey]: `data:${reference.mimeType};base64,${reference.bytes.toString('base64')}` }))
      return urls.length === 0 ? [] : [[field, urls]]
    }))
    const body = {
      model: this.facts.modelId, ...this.config.task == null ? {} : { task: this.config.task },
      prompt: request.prompt, width: request.frameWidth, height: request.frameHeight,
      num_frames: request.numFrames, ...request.seed === undefined ? {} : { seed: request.seed }, ...references,
    }
    try {
      const response = await fetch(new URL('/v1/videos/sync', this.baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        // proxy-exempt: the installed global dispatcher, composed to turn off only its headers timeout.
        dispatcher: untimedDispatcher(), ...signal === undefined ? {} : { signal },
      })
      if (response.status !== 200) {
        const text = await backendErrorText(response)
        if (response.status === 400) throw new GenerationSegmentError(text)
        throw new Error(`FastVideo POST /v1/videos/sync returned HTTP ${response.status}: ${text}`)
      }
      const mime = response.headers.get('content-type') ?? ''
      if (!mime.startsWith('video/')) {
        throw new Error(`FastVideo POST /v1/videos/sync answered ${mime || 'no content type'}, not video: ${await backendErrorText(response)}`)
      }
      const video = Buffer.from(await response.arrayBuffer())
      return { video, mime, timings: renderTimings(response.headers) }
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason
      throw error
    }
  }
}

export default DvFastvideoGeneration
