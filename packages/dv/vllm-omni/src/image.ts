/**
 * The `t2i` entries of `@dv/vllm-omni`. vLLM-Omni rounds a size off the model's grid down without an error, so an
 * entry refuses such a size before the render, and it fails a render whose answer reports another size than it sent.
 *
 * @module @dv/vllm-omni/image
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { GeneratedImage, ImageModelFacts, ImageRequest, ImageSize } from '@dv/image-generate'
import type { ModelEntry } from '@dv/models'
import { checkServed, post } from './http.ts'

/** One image model that the plugin serves: the rules that no vLLM-Omni endpoint lists. */
interface ServedImage {
  /** The ID that the server lists in `GET /v1/models`. */
  modelId: string
  description: string
  defaultSize: ImageSize
  /** Width and height are multiples of this number of pixels. */
  grid: number
  /** The model card's sizes by aspect ratio; the largest area is the pixel limit. */
  presets: Record<string, string>
}

/** The image models that the plugin serves, by model name. */
export const IMAGES: Record<string, ServedImage> = {
  'qwen-image-2.1-turbo': {
    modelId: 'Qwen/Qwen-Image-2.1-Turbo',
    description: 'Qwen-Image 2.1 Turbo: a fast text-to-image model that renders legible text inside the image, such as posters, '
      + 'labels and interface layouts. The same seed, size and prompt give the same image.',
    defaultSize: { width: 1024, height: 1024 },
    grid: 32,
    presets: { '1:1': '2048x2048', '4:3': '2400x1792', '3:4': '1792x2400', '3:2': '2528x1696', '2:3': '1696x2528', '16:9': '2752x1536', '9:16': '1536x2752' },
  },
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

function formatSize({ width, height }: ImageSize): string {
  return `${String(width)}x${String(height)}`
}

function parseSize(size: string): ImageSize {
  const [width = 0, height = 0] = size.split('x').map(Number)
  return { width, height }
}

function pixels(size: string): number {
  const { width, height } = parseSize(size)
  return width * height
}

/** How far the aspect ratio of `preset` is from that of `size`, as the absolute log of the ratio of the two. */
function aspectDistance(preset: string, size: ImageSize): number {
  const { width, height } = parseSize(preset)
  return Math.abs(Math.log((width / height) / (size.width / size.height)))
}

/**
 * The problems of one request, each one agent-facing sentence: a side off the grid with the nearest grid sizes within the
 * pixel limit, else the preset nearest the requested aspect ratio; an area above the largest preset with that preset;
 * and any `extra` value.
 */
function problems(served: ServedImage, request: ImageRequest): string[] {
  const size = request.size ?? served.defaultSize
  const { grid } = served
  const limit = Math.max(...Object.values(served.presets).map(pixels))
  const over = size.width * size.height > limit
  const [aspect, preset] = Object.entries(served.presets)
    .reduce((best, next) => aspectDistance(next[1], size) < aspectDistance(best[1], size) ? next : best)
  const found: string[] = []
  if (size.width % grid !== 0 || size.height % grid !== 0) {
    const snap = (round: (value: number) => number): string =>
      formatSize({ width: Math.max(grid, round(size.width / grid) * grid), height: Math.max(grid, round(size.height / grid) * grid) })
    const nearest = [...new Set([snap(Math.floor), snap(Math.ceil)])].filter(candidate => pixels(candidate) <= limit).join(' or ')
    // With no grid size within the limit, the preset names the size to use; above the limit, the sentence below names it.
    if (nearest !== '' || !over) found.push(`Width and height must be multiples of ${String(grid)}; use ${nearest || preset} instead of ${formatSize(size)}.`)
  }
  if (over) {
    found.push(`${formatSize(size)} has ${String(size.width * size.height)} pixels, above the limit of ${String(limit)}; the largest `
      + `size of aspect ratio ${aspect} is ${preset}.`)
  }
  if (Object.keys(request.extra).length > 0) found.push('This model takes no extra parameter; omit extra.')
  return found
}

/**
 * Render one PNG through `POST /v1/images/generations`.
 * @returns the image at the size it sent.
 * @throws Error for an answer without a PNG or with another size, or as `post` throws.
 */
async function generate(baseUrl: string, served: ServedImage, request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
  const size = request.size ?? served.defaultSize
  const route = '/v1/images/generations'
  const answer = await (await post(baseUrl, route, {
    model: served.modelId, prompt: request.prompt, size: formatSize(size), seed: request.seed, n: 1, response_format: 'b64_json', output_format: 'png',
  }, signal)).json() as { size?: string; data?: Array<{ b64_json?: string }> }
  const bytes = Buffer.from(answer.data?.[0]?.b64_json ?? '', 'base64')
  if (!bytes.subarray(0, PNG.length).equals(PNG)) throw new Error(`The server at ${baseUrl} answered POST ${route} without a PNG image.`)
  if (answer.size !== formatSize(size)) {
    throw new Error(`The server at ${baseUrl} answered POST ${route} with an image of size ${String(answer.size)}, not ${formatSize(size)}.`)
  }
  return { bytes, mime: 'image/png', ...size }
}

/**
 * The catalog entry of one image model.
 * @param model - a model name of `IMAGES`.
 * @param served - the rules of the model.
 * @param baseUrl - the HTTP base URL of the server of the model.
 * @returns the `t2i` entry.
 */
export function imageEntry(model: string, served: ServedImage, baseUrl: string): ModelEntry<'t2i'> {
  const facts = async (): Promise<ImageModelFacts> => {
    await checkServed(baseUrl, served.modelId)
    return { modelId: served.modelId }
  }
  return {
    modality: 'image', task: 't2i', provider: 'vllm-omni', hosting: 'self-hosted', model, description: served.description, facts,
    async schema(): Promise<JsonValue> {
      await facts()
      const rule = `width and height are multiples of ${String(served.grid)}, and width times height is at most `
        + String(Math.max(...Object.values(served.presets).map(pixels)))
      return { size: { default: formatSize(served.defaultSize), rule, by_aspect_ratio: served.presets }, extra: {} }
    },
    validateGenerationRequest: request => Promise.resolve(problems(served, request)),
    render: (request, signal) => generate(baseUrl, served, request, signal),
  }
}
