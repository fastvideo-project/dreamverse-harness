/**
 * Provider plugin `vllm-omni` of DreamVerse for image and speech models on local vLLM-Omni servers. It registers into
 * `ctx.dvModels` one entry per model that its `models` config names, one server per model, because each vLLM-Omni
 * server serves one model. Every `facts()` and `schema()` checks on `GET /v1/models` that the server serves the
 * expected model.
 *
 * Served models: `qwen-image-2.1-turbo` (task `t2i`, `Qwen/Qwen-Image-2.1-Turbo`) and `qwen3-tts-customvoice` (task
 * `t2a`, `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`).
 *
 * @module @dv/vllm-omni
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { IMAGES, imageEntry } from './image.ts'
import { SPEECHES, speechEntry } from './speech.ts'

/** `dv-vllm-omni` configuration. */
export interface Config {
  /** The models to register, by model name; a model left out is not registered. */
  models: Record<string, {
    /** HTTP base URL of the vLLM-Omni server that serves the model, such as `http://127.0.0.1:8091`. */
    baseUrl: string
  }>
}

export const Config: z<Config> = z.object({ models: z.dict(z.object({ baseUrl: z.string().required() })).required() })

export const name = 'dv-vllm-omni'

export const inject = ['dvModels']

/**
 * Register one entry into `ctx.dvModels` per configured model.
 * @param ctx - the plugin context.
 * @param config - the validated configuration.
 * @throws Error naming the model and the served models when the config names a model that this plugin does not serve.
 */
export function apply(ctx: Context, config: Config): void {
  const entries = Object.entries(config.models).map(([model, { baseUrl }]) => {
    // Object.hasOwn keeps a key such as `constructor` from resolving to an inherited property.
    const image = Object.hasOwn(IMAGES, model) ? IMAGES[model] : undefined
    if (image !== undefined) return imageEntry(model, image, baseUrl)
    const speech = Object.hasOwn(SPEECHES, model) ? SPEECHES[model] : undefined
    if (speech !== undefined) return speechEntry(model, speech, baseUrl)
    throw new Error(`dv-vllm-omni serves no model "${model}"; it serves: ${[...Object.keys(IMAGES), ...Object.keys(SPEECHES)].join(', ')}.`)
  })
  for (const entry of entries) ctx.effect(() => ctx.dvModels.register(entry), `dvModels ${entry.model} ${entry.task}`)
}
