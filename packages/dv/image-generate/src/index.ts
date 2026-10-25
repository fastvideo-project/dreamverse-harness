/**
 * The Image component of DreamVerse as the `dvImageGenerate` Cordis service. It declares the `image` generation
 * primitive and task `t2i` in the catalog of `@dv/models`, and owns one operation, `image.generate` (tool
 * `dv_image_generate`): one image from a prompt, rendered by the catalog entry whose key the call names. The call's
 * prompt, `size` (`WIDTHxHEIGHT`; null when the call names none) and seed reach the model as one `ImageRequest`; the PNG
 * becomes the record's one output with its pixel size. The operation exists while the catalog holds a model of task
 * `t2i`.
 *
 * @module @dv/image-generate
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineGeneration, importOne, quotePrompt } from '@dv/generation'
import type { OperationContext, OperationResult, ProjectRecord } from '@dv/project'

declare module '@dv/models' {
  interface PrimitiveTypes {
    image: {
      modality: 'image'
      facts: ImageModelFacts
      request: ImageRequest
      result: Promise<GeneratedImage>
      entry: {
        /** The size that the model renders for a call that names none. */
        defaultSize: ImageSize
      }
    }
  }
  interface TaskMap {
    t2i: 'image'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Image component: one image per `image.generate` call. */
    dvImageGenerate: DvImageGenerate
  }
}

/** The pixel size of one image. */
export interface ImageSize { width: number; height: number }

/** The facts of an image entry that a request is built from. */
export interface ImageModelFacts {
  /** The backend's model ID, which the record report keeps as `model_id`. */
  modelId: string
}

/** One image request: the prompt, the pixel size, the seed, and the model's own parameters. */
export interface ImageRequest {
  prompt: string
  /** Null when the call names no size; the entry then renders its `defaultSize`. */
  size: ImageSize | null
  seed: number
  /** Values of the model's own parameters, which the entry's `schema()` describes. */
  extra: Record<string, unknown>
}

/** One rendered PNG image with its pixel size. */
export interface GeneratedImage {
  bytes: Uint8Array
  mime: 'image/png'
  width: number
  height: number
}

function parseSize(value: unknown): ImageSize {
  const match = typeof value === 'string' ? /^([1-9]\d*)x([1-9]\d*)$/u.exec(value) : null
  if (match === null) {
    throw new Error(`size must be WIDTHxHEIGHT in pixels with positive integers, such as 1024x768; got ${JSON.stringify(value)}.`)
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

function imageRequest(params: Record<string, unknown>, seed: number): ImageRequest {
  const prompt = typeof params['prompt'] === 'string' ? params['prompt'].trim() : ''
  if (prompt === '') throw new Error('The prompt is empty; describe the image to generate.')
  const size = params['size'] === undefined ? null : parseSize(params['size'])
  return { prompt, size, seed, extra: (params['extra'] ?? {}) as Record<string, unknown> }
}

async function storeImage(_ctx: Context, run: OperationContext, result: Promise<GeneratedImage>,
  facts: ImageModelFacts): Promise<OperationResult> {
  const image = await result
  const asset = importOne(run, { bytes: image.bytes, mime: image.mime, width: image.width, height: image.height })
  return {
    outputs: [asset],
    report: { model_id: facts.modelId, size: `${String(image.width)}x${String(image.height)}` },
  }
}

function summarize(record: ProjectRecord): string {
  const { prompt } = record.params
  const { size, seed } = { ...record.report }
  return `image ${quotePrompt(String(prompt), 60)} (${String(size)}, seed ${String(seed)})`
}

/** The Image service: the `image.generate` operation and the `GenerationApi` methods for workflows. */
export default class DvImageGenerate extends defineGeneration({
  service: 'dvImageGenerate',
  component: 'image',
  operation: 'image.generate',
  primitive: 'image',
  tasks: { t2i: { zh: '文字生成图片', en: 'Image from text' } },
  label: { zh: '生成图片', en: 'Generate image' },
  description: 'Generate one image from the prompt with a t2i model from dv_models_list; modality, task, provider and '
    + 'model name it and are required. dv_models_get lists the sizes the model takes and its own parameters for extra. '
    + 'The image is the one output, and you see it in the result. Every call is a new take; a changed prompt for the '
    + 'same image passes based_on.',
  params: {
    size: {
      type: 'string',
      description: 'The image size as WIDTHxHEIGHT in pixels, such as 1024x768. It must meet the size rule that '
        + 'dv_models_get gives; every size it lists by aspect ratio meets it. Omitted, the model\'s default size.',
    },
  },
  inputs: {},
  outputs: [{ role: 'image', type: 'image' }],
  toRequest: (_facts, params, _inputs, seed) => imageRequest(params, seed),
  toOutputs: storeImage,
  summarize,
}) {}
