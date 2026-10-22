/**
 * Provider plugin `sglang-diffusion` of DreamVerse for image models on local SGLang diffusion servers, each for task
 * `t2i`. It registers into `ctx.dvModels` one entry per model that its `models` config names. Each entry checks on every
 * `facts()` that its server serves the expected model, because the server ignores the `model` field of a request;
 * it describes the sizes the model takes in `schema()`, refuses a size the model cannot render in
 * `validateGenerationRequest` (the server answers such a size with HTTP 500 and no reason), and renders one PNG per
 * request through `POST /v1/images/generations`.
 *
 * Served models: `qwen-image-2.1-turbo` (Qwen-Image 2.1 Turbo, `Qwen/Qwen-Image-2.1-Turbo`).
 *
 * @module @dv/sglang-diffusion
 */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type { GeneratedImage, ImageModelFacts, ImageRequest, ImageSize } from '@dv/image-generate'
import type { ModelEntry } from '@dv/models'

/** The server of one model and its GPU rate. */
export interface ModelServer {
  /** HTTP base URL of the SGLang diffusion server, such as `http://127.0.0.1:30010`. */
  baseUrl: string
  /** GPU seconds per megapixel of an image on this server, for the GPU estimate. */
  gpuSecondsPerMegapixel: number
}

/** `dv-sglang-diffusion` configuration. */
export interface Config {
  /** The models to register, by model name, each with its server. */
  models: Record<string, ModelServer>
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  models: z.dict(z.object({ baseUrl: z.string().required(), gpuSecondsPerMegapixel: z.number().required() })).required(),
})

/** One served image model: the rules of the model that no server endpoint lists. */
interface ServedImageModel {
  /** The ID the server reports in `GET /v1/models`. */
  modelId: string
  description: string
  defaultSize: ImageSize
  /** Width and height must each be a multiple of this. */
  sizeMultiple: number
  /** The most pixels of one image: the area of the largest preset of the model card. */
  maxPixels: number
  /** The model card's sizes by aspect ratio, as `dv_models_get` lists them. */
  presets: Record<string, string>
}

/** The models this plugin can serve. */
const SERVED: Record<string, ServedImageModel> = {
  'qwen-image-2.1-turbo': {
    modelId: 'Qwen/Qwen-Image-2.1-Turbo',
    description: 'Qwen-Image 2.1 Turbo: a text-to-image model that renders legible text inside the image, such as '
      + 'posters, labels and interface layouts. The same seed, size and prompt give the same image.',
    defaultSize: { width: 1024, height: 1024 },
    sizeMultiple: 32,
    maxPixels: 2400 * 1792,
    presets: {
      '1:1': '2048x2048', '4:3': '2400x1792', '3:4': '1792x2400', '3:2': '2528x1696',
      '2:3': '1696x2528', '16:9': '2752x1536', '9:16': '1536x2752',
    },
  },
}

/** The `GET /v1/models` answer of the server, with the fields this plugin reads. */
interface ModelList { data: Array<{ id: string }> }

/** The first eight bytes of every PNG file. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Plugin name. */
export const name = 'dv-sglang-diffusion'

/** Required services: the model catalog. */
export const inject = ['dvModels']

/** `WIDTHxHEIGHT` of a size. */
function formatSize({ width, height }: ImageSize): string {
  return `${String(width)}x${String(height)}`
}

/** The field `key` of a parsed JSON value; undefined for a value that is not an object or has no such field. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/** The text of an error answer: `detail` of a JSON body when it is a string, else the body as sent. */
async function errorText(response: Response): Promise<string> {
  const text = await response.text()
  if (response.headers.get('content-type') !== 'application/json') return text
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return text
  }
  const detail = field(body, 'detail')
  return typeof detail === 'string' ? detail : text
}

/**
 * Send one request to the server and read its JSON answer.
 * @throws the signal's reason on abort; else Error naming the server, the method, the route and the HTTP status with
 *   the server's text, or the server that cannot be reached.
 */
async function call<T>(baseUrl: string, route: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(new URL(route, baseUrl), init)
  } catch {
    // fetch rejects with the abort reason when the signal aborts, and with a TypeError when the server cannot be reached.
    if (init.signal?.aborted === true) throw init.signal.reason
    throw new Error(`The server at ${baseUrl} cannot be reached.`)
  }
  if (!response.ok) {
    throw new Error(`The server at ${baseUrl} answered ${init.method ?? 'GET'} ${route} with HTTP ${String(response.status)}: `
      + await errorText(response))
  }
  return await response.json() as T
}

/**
 * Check that the server lists `modelId`.
 * @throws Error when the server cannot be reached, answers with an error, or serves another model.
 */
async function checkServed(baseUrl: string, modelId: string): Promise<void> {
  const ids = (await call<ModelList>(baseUrl, '/v1/models')).data.map(model => model.id)
  if (!ids.includes(modelId)) {
    throw new Error(`The server at ${baseUrl} serves ${ids.join(', ')}, not ${modelId}; the dv-sglang-diffusion config `
      + 'points this model at the wrong server.')
  }
}

/**
 * Generate one PNG through `POST /v1/images/generations`. The server renders this model at the requested size.
 * @returns the image at the requested size, with the answer's finite `inference_time_s` as its GPU seconds, else null.
 * @throws the signal's reason on abort, or Error for a server that answers with an error or without a PNG, or cannot be reached.
 */
async function generateImage(baseUrl: string, size: ImageSize, request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
  const body = JSON.stringify({
    prompt: request.prompt, size: formatSize(size), seed: request.seed, n: 1, response_format: 'b64_json', output_format: 'png',
  })
  const answer = await call<unknown>(baseUrl, '/v1/images/generations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body, ...signal === undefined ? {} : { signal },
  })
  const data = field(answer, 'data')
  const b64 = field(Array.isArray(data) ? data[0] : undefined, 'b64_json')
  const bytes = Buffer.from(typeof b64 === 'string' ? b64 : '', 'base64')
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`The server at ${baseUrl} answered POST /v1/images/generations without a PNG image.`)
  const seconds = field(answer, 'inference_time_s')
  const gpuSeconds = typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null
  return { bytes, mime: 'image/png', width: size.width, height: size.height, gpuSeconds }
}

/** The problems of a request's size and `extra`, each one agent-facing sentence. */
function requestProblems(served: ServedImageModel, request: ImageRequest): string[] {
  const { width, height } = request.size ?? served.defaultSize
  const step = served.sizeMultiple
  const problems: string[] = []
  if (width % step !== 0 || height % step !== 0) {
    // Both sides rounded down, and both rounded up, each side at least one step.
    const round = (value: number, up: boolean): number => Math.max(step, (up ? Math.ceil(value / step) : Math.floor(value / step)) * step)
    const sizes = [...new Set([false, true].map(up => formatSize({ width: round(width, up), height: round(height, up) })))]
    problems.push(`Width and height must each be a multiple of ${String(step)}, and ${formatSize({ width, height })} `
      + `is not; the nearest ${sizes.length === 1 ? 'size is' : 'sizes are'} ${sizes.join(' and ')}.`)
  }
  if (width * height > served.maxPixels) {
    const aspect = (size: string): number => Number(size.slice(0, size.indexOf('x'))) / Number(size.slice(size.indexOf('x') + 1))
    const [ratio, preset] = Object.entries(served.presets).reduce((best, next) =>
      Math.abs(aspect(next[1]) - width / height) < Math.abs(aspect(best[1]) - width / height) ? next : best)
    problems.push(`The model renders at most ${String(served.maxPixels)} pixels, and ${formatSize({ width, height })} has `
      + `${String(width * height)}; the preset nearest its aspect ratio is ${preset} (${ratio}).`)
  }
  if (Object.keys(request.extra).length > 0) problems.push('This model takes no extra parameter; omit extra.')
  return problems
}

/**
 * A catalog entry for one configured model.
 * @throws Error when `SERVED` has no such model.
 */
function modelEntry(model: string, server: ModelServer): ModelEntry<'t2i'> {
  const served = SERVED[model]
  if (served === undefined) throw new Error(`dv-sglang-diffusion serves no model "${model}"; it serves: ${Object.keys(SERVED).join(', ')}.`)
  const facts = async (): Promise<ImageModelFacts> => {
    await checkServed(server.baseUrl, served.modelId)
    return { modelId: served.modelId }
  }
  return {
    modality: 'image',
    task: 't2i',
    provider: 'sglang-diffusion',
    model,
    description: served.description,
    gpuSecondsPerMegapixel: server.gpuSecondsPerMegapixel,
    defaultSize: served.defaultSize,
    facts,
    async schema(): Promise<JsonValue> {
      await facts()
      return {
        size: {
          default: formatSize(served.defaultSize),
          rule: `width and height are positive multiples of ${String(served.sizeMultiple)}, and width times height is at most ${String(served.maxPixels)}`,
          by_aspect_ratio: served.presets,
        },
        extra: {},
      }
    },
    validateGenerationRequest: request => Promise.resolve(requestProblems(served, request)),
    render: (request, signal) => generateImage(server.baseUrl, request.size ?? served.defaultSize, request, signal),
  }
}

/**
 * Register one entry into `ctx.dvModels` per configured model.
 * @param ctx - the plugin context.
 * @param config - the validated configuration.
 * @throws Error when the config names a model this plugin does not serve.
 */
export function apply(ctx: Context, config: Config): void {
  const entries = Object.entries(config.models).map(([model, server]) => modelEntry(model, server))
  for (const entry of entries) ctx.effect(() => ctx.dvModels.register(entry), `dvModels ${entry.model} t2i`)
}
