/**
 * `dvFastvideoGeneration`: the harness client for FastVideo generation. The default transport uses streaming_v2
 * capabilities and SSE generation. An explicit `openai` deployment uses model_info and videos/sync, buffers the
 * complete MP4, and extracts its last frame locally when requested.
 *
 * @module @dv/fastvideo-generation-client
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { GenerationSegmentError } from './errors.ts'
import { generateSegment } from './generation-stream.ts'
import { checkedResponse, generateOpenAI, OpenAIConfig } from './openai.ts'
import type { ModelFacts, SegmentOutput, SegmentRequest } from './types.ts'

export * from './errors.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client for the FastVideo generation backend API. */
    dvFastvideoGeneration: DvFastvideoGeneration
  }
}

/** Generation backend location and optional OpenAI deployment. */
export interface Config {
  /** HTTP base URL of the generation backend, such as `http://127.0.0.1:8029`. */
  baseUrl: string
  /** Owner-only bearer credential file for an authenticated worker. Never put its contents in config. */
  apiKeyFile?: string | null
  /** Select the current OpenAI API with explicit deployment facts; omitted, use streaming_v2. */
  openai?: OpenAIConfig | null
}

/** `GET /v1/streamv2/capabilities` response fields: the served model's facts. */
interface CapabilitiesBody {
  model_id: string
  min_segment_duration_sec: number
  max_segment_duration_sec: number
  max_references: number
  reference_media_types: Record<string, { max_count: number }>
  frame_sizes: Record<string, Record<string, [number, number]>>
  num_frames_by_duration_sec: Record<string, number>
}

/** Reads deployment model facts and emits segment media events. */
export class DvFastvideoGeneration extends Service {
  static Config: z<Config> = z.object({
    baseUrl: z.string().required(),
    apiKeyFile: z.union([z.const(null), z.string()]).default(null),
    openai: z.union([z.const(null), OpenAIConfig]).default(null),
  })

  private readonly baseUrl: URL
  private readonly headers: Record<string, string>
  /** The first successfully checked model facts; the served model stays fixed for the backend's lifetime. */
  private modelFacts: ModelFacts | null = null

  /**
   * @param ctx - owning plugin context.
   * @param config - validated generation backend location.
   */
  constructor(ctx: Context, private readonly config: Config, private readonly fetchImpl: typeof fetch = globalThis.fetch) {
    super(ctx, 'dvFastvideoGeneration')
    this.baseUrl = new URL(config.baseUrl)
    const key = config.apiKeyFile == null ? null : readFileSync(config.apiKeyFile, 'utf8').trim()
    if (key !== null && !/^[\x21-\x7e]+$/.test(key)) throw new Error('Worker API key must contain printable non-space ASCII characters.')
    this.headers = key === null ? {} : { authorization: `Bearer ${key}` }
  }

  /**
   * Read capabilities, or verify the OpenAI served alias and use configured facts; cache the first success.
   * @returns the model facts.
   * @throws Error naming the route for a status other than 200, or the `fetch` error when the backend is unreachable.
   */
  async model(signal?: AbortSignal): Promise<ModelFacts> {
    if (this.modelFacts !== null) return this.modelFacts
    if (this.config.openai != null) {
      const infoUrl = new URL('/v1/model_info', this.baseUrl)
      if (this.config.openai.managed === true) {
        infoUrl.searchParams.set('model', this.config.openai.modelFacts.modelId)
        if (this.config.openai.task != null) infoUrl.searchParams.set('task', this.config.openai.task)
      }
      const response = await checkedResponse(await this.fetchImpl(infoUrl, {
        headers: this.headers, ...signal === undefined ? {} : { signal },
      }))
      const body = await response.json() as { served_model_name: string }
      if (body.served_model_name !== this.config.openai.modelFacts.modelId) {
        throw new Error(`FastVideo serves ${body.served_model_name}, expected ${this.config.openai.modelFacts.modelId}`)
      }
      this.modelFacts = this.config.openai.modelFacts
      return this.modelFacts
    }
    const route = '/v1/streamv2/capabilities'
    const body = await readBody<CapabilitiesBody>(await this.fetchImpl(new URL(route, this.baseUrl), { headers: this.headers, ...signal === undefined ? {} : { signal } }), `GET ${route}`)
    const referenceMediaTypes = Object.fromEntries(Object.entries(body.reference_media_types)
      .map(([mediaType, limit]) => [mediaType, { maxCount: limit.max_count }]))
    this.modelFacts = {
      modelId: body.model_id,
      aspectRatios: Object.keys(body.frame_sizes),
      resolutions: [...new Set(Object.values(body.frame_sizes).flatMap(sizes => Object.keys(sizes)))],
      minSegmentDurationSec: body.min_segment_duration_sec,
      maxSegmentDurationSec: body.max_segment_duration_sec,
      maxReferences: body.max_references,
      referenceMediaTypes,
      frameSizes: body.frame_sizes,
      numFramesByDurationSec: body.num_frames_by_duration_sec,
    }
    return this.modelFacts
  }

  /**
   * Generate one segment with its own HTTP request. OpenAI emits media after its full MP4 arrives; streaming_v2
   * forwards SSE events as they arrive. Request errors reject with `GenerationSegmentError`; aborts reject with
   * `signal.reason`. Local OpenAI frame extraction exits and removes its temporary files before cancellation settles.
   * @param request - the segment inputs and an optional abort signal.
   * @returns last frame when requested, video start, video bytes and completion timings.
   * @throws GenerationSegmentError when a native task selector is used without OpenAI transport.
   */
  generateSegment(request: SegmentRequest): AsyncIterable<SegmentOutput> {
    if (this.config.openai != null) return generateOpenAI(this.baseUrl, this.config.openai, request, this.headers, this.fetchImpl)
    if (request.task !== undefined) throw new GenerationSegmentError('A native task selector requires the OpenAI transport', 'invalid_request')
    return generateSegment(new URL('/v1/streamv2/generate', this.baseUrl), request, this.headers, this.fetchImpl)
  }

  /** Read native residency without loading a model or changing generation state. */
  async modelStatus(signal?: AbortSignal): Promise<{ installed: boolean; loaded: boolean; loading: boolean; busy: boolean }> {
    const config = this.config.openai
    if (config?.managed !== true) throw new Error('This endpoint has no managed model catalog')
    const url = new URL('/v1/model_state', this.baseUrl)
    url.searchParams.set('model', config.modelFacts.modelId)
    const response = await checkedResponse(await this.fetchImpl(url, { headers: this.headers, ...signal === undefined ? {} : { signal } }))
    const state: unknown = await response.json()
    if (typeof state !== 'object' || state === null || !('loaded_model' in state) || !('busy' in state) || typeof state.busy !== 'boolean'
      || !('installed' in state) || typeof state.installed !== 'boolean') {
      throw new Error('Invalid FastVideo model state')
    }
    return { installed: state.installed, loaded: state.loaded_model === config.modelFacts.modelId,
      loading: 'loading_model' in state && state.loading_model === config.modelFacts.modelId, busy: state.busy }
  }

  /** Load an installed model through the native single-device manager. */
  async loadModel(signal?: AbortSignal): Promise<void> { await this.modelAction('load', signal) }

  /** Release the model's GPU residency while retaining downloaded weights. */
  async unloadModel(signal?: AbortSignal): Promise<void> { await this.modelAction('unload', signal) }

  private async modelAction(action: 'load' | 'unload', signal?: AbortSignal): Promise<void> {
    const config = this.config.openai
    if (config?.managed !== true) throw new Error('This endpoint has no managed model catalog')
    await checkedResponse(await this.fetchImpl(new URL(`/v1/models/${action}`, this.baseUrl), {
      method: 'POST', headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.modelFacts.modelId, task: config.task }), ...signal === undefined ? {} : { signal },
    }))
  }
}

/**
 * Parse a successful JSON response.
 * @param response - the backend response.
 * @param route - method and path for the failure message.
 * @returns the parsed body.
 * @throws Error naming the route, status, and body for any status other than 200.
 */
async function readBody<T>(response: Response, route: string): Promise<T> {
  if (response.status !== 200) {
    throw new Error(`FastVideo generation backend ${route} returned HTTP ${response.status}: ${await response.text()}`)
  }
  return await response.json() as T
}

export default DvFastvideoGeneration
