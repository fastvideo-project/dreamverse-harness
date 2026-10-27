/**
 * `dvFastvideoGeneration`: the harness client for the FastVideo generation backend's streaming_v2 API, which
 * `fastvideo serve` serves with a `streaming_v2:` config block. HTTP calls use `fetch`; each segment request is one
 * `POST /v1/streamv2/generate` whose response is a server-sent event stream.
 *
 * @module @dv/fastvideo-generation-client
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { generateSegment } from './generation-stream.ts'
import type { ModelFacts, SegmentOutput, SegmentRequest } from './types.ts'

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

/** `GET /v1/streamv2/capabilities` response fields: the served model's facts. */
interface CapabilitiesBody {
  model_id: string
  min_segment_duration_sec: number
  max_segment_duration_sec: number
  max_references: number
  reference_media_types: Record<string, { max_count: number }>
  frame_sizes: Record<string, Record<string, [number, number]>>
  num_frames_by_duration_sec: Record<string, number>
  lora?: CapabilitiesLoraBody
}

/** The `lora` block of the capabilities; a server that predates it supports no adapter. */
interface CapabilitiesLoraBody {
  supported: boolean
  runtime_switching?: boolean
  base_strength?: number
  adapters?: Array<{
    id: string
    default_strength: number
    min_strength: number
    max_strength: number
    description?: string
    license?: string
    source_url?: string
  }>
}

/** Reads the backend's model facts and streams segments. */
export class DvFastvideoGeneration extends Service {
  static Config: z<Config> = z.object({
    baseUrl: z.string().required(),
  })

  private readonly baseUrl: URL
  /** The first successful capabilities result; the served model stays fixed for the backend's lifetime. */
  private modelFacts: ModelFacts | null = null

  /**
   * @param ctx - owning plugin context.
   * @param config - validated generation backend location.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dvFastvideoGeneration')
    this.baseUrl = new URL(config.baseUrl)
  }

  /**
   * Read the served model's facts; the first successful response is reused afterwards.
   * @returns the model facts.
   * @throws Error naming the route for a status other than 200, or the `fetch` error when the backend is unreachable.
   */
  async model(): Promise<ModelFacts> {
    if (this.modelFacts !== null) return this.modelFacts
    const route = '/v1/streamv2/capabilities'
    const body = await readBody<CapabilitiesBody>(await fetch(new URL(route, this.baseUrl)), `GET ${route}`)
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
      lora: {
        supported: body.lora?.supported ?? false,
        runtimeSwitching: body.lora?.runtime_switching ?? false,
        baseStrength: body.lora?.base_strength ?? 0,
        adapters: (body.lora?.adapters ?? []).map(adapter => ({
          id: adapter.id,
          defaultStrength: adapter.default_strength,
          minStrength: adapter.min_strength,
          maxStrength: adapter.max_strength,
          ...(adapter.description === undefined ? {} : { description: adapter.description }),
          ...(adapter.license === undefined ? {} : { license: adapter.license }),
          ...(adapter.source_url === undefined ? {} : { sourceUrl: adapter.source_url }),
        })),
      },
    }
    return this.modelFacts
  }

  /**
   * Stream one segment with its own HTTP request. The iteration ends after `done` and rejects with
   * `GenerationSegmentError` after HTTP 400 or an `error` event. Leaving the iteration or aborting `request.signal`
   * cancels the request; an abort rejects with `signal.reason`.
   * @param request - the segment inputs and an optional abort signal.
   * @returns the backend outputs in arrival order.
   */
  generateSegment(request: SegmentRequest): AsyncIterable<SegmentOutput> {
    return generateSegment(new URL('/v1/streamv2/generate', this.baseUrl), request)
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
