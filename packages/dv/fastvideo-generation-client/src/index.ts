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
import { backendErrorText, GenerationSegmentError } from './errors.ts'
import { outputFacts } from './output-capabilities.ts'
import { followVideoJob, type NativeRequestInit } from './native-jobs.ts'
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
  /** The facts of the served model, which FastVideo does not publish. */
  modelFacts: ModelFactsConfig
  /** Discover native output metadata when available; reference limits remain configured. */
  discoverOutputCapabilities?: boolean
  /** Native managed catalog and model residency support; off for ordinary fixed servers. */
  managed?: boolean
  /** Use tracked asynchronous native video jobs. */
  asyncJobs?: boolean
  /** Native task selector for this model entry. */
  task?: string | null
  /** Optional creator-facing name. */
  displayName?: string | null
  /** Interval between native asynchronous job-state reads. */
  pollIntervalMs?: number
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
    modelFacts: modelFactsConfig.required(),
    discoverOutputCapabilities: z.boolean().default(true),
    managed: z.boolean().default(false), asyncJobs: z.boolean().default(false),
    task: z.union([z.const(null), z.string()]).default(null),
    displayName: z.union([z.const(null), z.string()]).default(null),
    pollIntervalMs: z.natural().min(1).default(1000),
  })

  private readonly baseUrl: URL
  /** The facts derived from `modelFacts` when the client is built. */
  facts: ModelFacts
  /** Whether a `GET /v1/model_info` confirmed the served alias; the served model stays fixed for the backend's lifetime. */
  private checked = false

  /**
   * @param ctx - owning plugin context.
   * @param config - generation backend location and model facts.
   * @throws Error naming the inconsistency of the configured facts.
   */
  constructor(ctx: Context, private readonly config: Config,
    private readonly fetchImpl?: typeof globalThis.fetch) {
    super(ctx, 'dvFastvideoGeneration')
    this.baseUrl = new URL(config.baseUrl)
    this.facts = deriveModelFacts(config.modelFacts)
  }

  /**
   * Check once that the backend serves the configured model.
   * @param signal - aborts the read.
   * @returns the model facts.
   * @throws Error naming the route and the HTTP status for a status other than 200, Error naming the route for a body
   *   that is not JSON, Error naming the served alias when it is missing or differs from `modelFacts.modelId`, or the
   *   `fetch` error when the backend is unreachable.
   */
  async model(signal?: AbortSignal): Promise<ModelFacts> {
    if (this.checked) return this.facts
    const route = 'GET /v1/model_info'
    const url = new URL('/v1/model_info', this.baseUrl)
    if (this.config.managed) {
      url.searchParams.set('model', this.facts.modelId)
      if (this.config.task != null) url.searchParams.set('task', this.config.task)
    }
    const response = await this.request(url, { ...signal === undefined ? {} : { signal } })
    if (response.status !== 200) {
      throw new Error(`FastVideo ${route} returned HTTP ${response.status}: ${await backendErrorText(response)}`)
    }
    const text = await response.text()
    let info: { served_model_name?: unknown; video_output_capabilities?: unknown } | null
    try {
      info = JSON.parse(text) as { served_model_name?: unknown; video_output_capabilities?: unknown } | null
    } catch (error) {
      throw new Error(`FastVideo ${route} answered no JSON: ${(error as SyntaxError).message}`, { cause: error })
    }
    const served = info?.served_model_name
    if (typeof served !== 'string') throw new Error(`FastVideo ${route} reports no served_model_name; expected ${this.facts.modelId}.`)
    if (served !== this.facts.modelId) throw new Error(`FastVideo serves ${served}; modelFacts.modelId is ${this.facts.modelId}.`)
    if (this.config.discoverOutputCapabilities !== false) this.facts = outputFacts(this.facts, info?.video_output_capabilities)
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
      const response = this.config.managed || this.config.asyncJobs
        ? await followVideoJob(this.baseUrl, body, this.config.pollIntervalMs ?? 1000,
          (url, init) => this.request(url, init), signal)
        : await this.request(new URL('/v1/videos/sync', this.baseUrl), {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          ...signal === undefined ? {} : { signal },
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
  private async request(url: URL, init: NativeRequestInit = {}): Promise<Response | globalThis.Response> {
    if (this.fetchImpl !== undefined) return this.fetchImpl(url, init)
    return fetch(url, { ...init, dispatcher: untimedDispatcher() })
  }

  /**
   * Read native model residency without loading or downloading weights.
   * @param signal - aborts the read.
   * @returns whether the configured model is installed, loaded with the configured task, or loading; whether the
   *   server is busy; and whether it manages its model catalog.
   * @throws Error when `managed` is off, for a status other than 2xx, or for an invalid state body.
   */
  async modelStatus(signal?: AbortSignal): Promise<{
    installed: boolean
    loaded: boolean
    loading: boolean
    busy: boolean
    managed: boolean
  }> {
    if (!this.config.managed) throw new Error('This endpoint has no managed model catalog')
    const url = new URL('/v1/model_state', this.baseUrl)
    url.searchParams.set('model', this.facts.modelId)
    const response = await this.request(url, { ...signal === undefined ? {} : { signal } })
    if (!response.ok) throw new Error(`FastVideo model status refused (HTTP ${response.status})`)
    const state: unknown = await response.json()
    if (typeof state !== 'object' || state === null || !('busy' in state) || typeof state.busy !== 'boolean'
      || !('installed' in state) || typeof state.installed !== 'boolean' || !('loaded_model' in state)) throw new Error('Invalid native model state')
    const taskMatches = this.config.task == null || !('loaded_task' in state) || state.loaded_task === this.config.task
    return { installed: state.installed, loaded: state.loaded_model === this.facts.modelId && taskMatches,
      loading: 'loading_model' in state && state.loading_model === this.facts.modelId, busy: state.busy,
      managed: !('managed' in state) || state.managed !== false }
  }

  /**
   * Load the configured installed model and task without rendering.
   * @param signal - aborts the status read and the load request.
   */
  async loadModel(signal?: AbortSignal): Promise<void> { await this.modelAction('load', signal) }

  /**
   * Release the model while retaining its downloaded files.
   * @param signal - aborts the status read and the release request.
   */
  async unloadModel(signal?: AbortSignal): Promise<void> { await this.modelAction('unload', signal) }

  private async modelAction(action: 'load' | 'unload', signal?: AbortSignal): Promise<void> {
    const state = await this.modelStatus(signal)
    if (!state.managed && action === 'load') {
      if (state.loaded) return
      throw new Error('This fixed distributed endpoint does not serve the selected model.')
    }
    const url = new URL(state.managed ? `/v1/models/${action}` : '/v1/runtime/release', this.baseUrl)
    const response = await this.request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.facts.modelId, task: this.config.task }), ...signal === undefined ? {} : { signal } })
    if (!response.ok) throw new Error(`FastVideo model ${action} refused (HTTP ${response.status}): ${await backendErrorText(response)}`)
  }

}

export default DvFastvideoGeneration
