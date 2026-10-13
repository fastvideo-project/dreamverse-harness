/**
 * Company plugin of DreamVerse for models served by local FastVideo streaming_v2 servers. It registers each model that
 * its `models` config names into `ctx.dvModels`, with the modes the config gives a server for; a model or mode the
 * config leaves out is not registered. Each mode of a model is served by its own server: the streaming_v2 client of
 * `@dv/fastvideo-generation-client` sends each render as one `POST /v1/streamv2/generate`, with the reference images
 * first and the first frame after them. While the DSH skill registry is mounted, the plugin registers the prompt skill
 * of every registered model and mode.
 *
 * Served models: `fasth3` (MiniMax H3 as FastH3), in mode `reference` (FastH3 Ref2VA) and mode `text` (FastH3 8-Step V2).
 *
 * @module @dv/fastvideo
 */
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { DvFastvideoGeneration } from '@dv/fastvideo-generation-client'
import type { ModeDeclaration, ModeId, ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent } from '@dv/models'

/** One mode of one model: the streaming_v2 server that renders it and its GPU rate. */
export interface ModeServer {
  /** HTTP base URL of the FastVideo streaming_v2 server, such as `http://127.0.0.1:8029`. */
  baseUrl: string
  /** GPU seconds per rendered video second on this server, declared for the mode for the GPU estimate. */
  gpuSecondsPerVideoSecond: number
}

/** `dv-fastvideo` configuration. */
export interface Config {
  /** The models to register, by model name, and for each the modes to serve it in, by mode, with their servers. */
  models: Record<string, Record<string, ModeServer>>
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  models: z.dict(z.dict(z.object({
    baseUrl: z.string().required(),
    gpuSecondsPerVideoSecond: z.number().required(),
  }))).required(),
})

/**
 * One mode this plugin can serve a model in: what the model accepts in it, and its prompt skill. The GPU rate comes
 * from the configured server of the mode.
 */
interface ServedMode extends Omit<ModeDeclaration, 'gpuSecondsPerVideoSecond'> {
  skill: { name: string; description: string; file: string }
}

/** The models this plugin can serve, with the modes it can serve each in. */
const SERVED: Record<string, { company: string; summary: string; modes: Partial<Record<ModeId, ServedMode>> }> = {
  fasth3: {
    company: 'local FastVideo',
    summary: 'MiniMax H3 (FastH3); video with sound, dialogue and music written in the prompt',
    modes: {
      reference: {
        inputs: { reference: { min: 1 }, first_frame: { min: 0 } },
        extra: {},
        skill: {
          name: 'fasth3-reference-prompting',
          description: 'Model limits and prompt rules for dv_shot_render with model fasth3 in mode reference: reference images, '
            + 'how the prompt names them, and how a shot continues the previous one.',
          file: 'fasth3-reference-prompting.md',
        },
      },
      text: {
        inputs: {},
        extra: {},
        skill: {
          name: 'fasth3-text-prompting',
          description: 'Model limits and prompt rules for dv_shot_render with model fasth3 in mode text: the three prompt fields, '
            + 'shot changes, camera motion, speakers and dialogue, sound and music.',
          file: 'fasth3-text-prompting.md',
        },
      },
    },
  },
}

/** Plugin name. */
export const name = 'dv-fastvideo'

/** Required services: the model catalog. */
export const inject = ['dvModels']

/**
 * Check the `models` config against the models and modes this plugin serves.
 * @param config - the validated configuration.
 * @throws Error naming an unknown model, an unknown mode, or a model without modes.
 */
function checkConfig(config: Config): void {
  for (const [model, modes] of Object.entries(config.models)) {
    const served = SERVED[model]
    if (served === undefined) throw new Error(`dv-fastvideo serves no model "${model}"; it serves: ${Object.keys(SERVED).join(', ')}.`)
    if (Object.keys(modes).length === 0) throw new Error(`dv-fastvideo: model "${model}" names no mode.`)
    for (const mode of Object.keys(modes)) {
      if (!Object.hasOwn(served.modes, mode)) {
        throw new Error(`dv-fastvideo serves model "${model}" in no mode "${mode}"; its modes: ${Object.keys(served.modes).join(', ')}.`)
      }
    }
  }
}

/**
 * A catalog entry for one configured model: one streaming_v2 client per configured mode.
 * @param ctx - the plugin context; each client lives in an isolated `dvFastvideoGeneration` scope.
 * @param id - the model name.
 * @param modes - the configured modes and their servers.
 * @returns the entry.
 */
function modelEntry(ctx: Context, id: string, modes: Record<string, ModeServer>): ModelEntry {
  const served = SERVED[id]
  /* v8 ignore next -- checkConfig refuses unknown models before any entry is built. */
  if (served === undefined) throw new Error(`dv-fastvideo serves no model "${id}".`)
  const clients = new Map<string, DvFastvideoGeneration>()
  for (const [mode, server] of Object.entries(modes)) {
    clients.set(mode, new DvFastvideoGeneration(ctx.isolate('dvFastvideoGeneration'), { baseUrl: server.baseUrl }))
  }
  const clientOf = (mode: ModeId): DvFastvideoGeneration => {
    const found = clients.get(mode)
    if (found === undefined) throw new Error(`Model ${id} is not served in mode ${mode}.`)
    return found
  }
  const declared = Object.fromEntries(Object.entries(modes).map(([mode, server]) => {
    const { inputs, extra } = served.modes[mode as ModeId] as ServedMode
    return [mode, { inputs, extra, gpuSecondsPerVideoSecond: server.gpuSecondsPerVideoSecond }]
  }))
  return {
    id,
    company: served.company,
    summary: served.summary,
    modes: declared,
    // The server counts the first frame among its request images, so a reference render keeps one image for it.
    async facts(mode: ModeId): Promise<RenderModelFacts> {
      const facts = await clientOf(mode).model()
      const images = declared[mode]?.inputs.reference !== undefined
      return {
        modelId: facts.modelId, aspectRatios: facts.aspectRatios, resolutions: facts.resolutions, frameSizes: facts.frameSizes,
        minDurationSec: facts.minSegmentDurationSec, maxDurationSec: facts.maxSegmentDurationSec,
        numFramesByDurationSec: facts.numFramesByDurationSec,
        maxReferenceImages: images ? facts.maxReferenceImages - 1 : 0, imageLabels: images ? facts.referenceLabels : [],
      }
    },
    render(mode: ModeId, request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      return clientOf(mode).generateSegment({
        prompt: request.prompt,
        referenceImages: request.firstFrame === null ? request.references : [...request.references, request.firstFrame],
        frameWidth: request.frameWidth,
        frameHeight: request.frameHeight,
        numFrames: request.numFrames,
        seed: request.seed,
        returnLastFrame: true,
        ...signal === undefined ? {} : { signal },
      })
    },
  }
}

/**
 * Register every configured model into `ctx.dvModels`, and the prompt skill of each configured model and mode while
 * the DSH skill registry is mounted.
 * @param ctx - the plugin context.
 * @param config - the validated configuration.
 * @throws Error when the config names a model or mode this plugin does not serve.
 */
export function apply(ctx: Context, config: Config): void {
  checkConfig(config)
  for (const [id, modes] of Object.entries(config.models)) {
    const entry = modelEntry(ctx, id, modes)
    ctx.effect(() => ctx.dvModels.register(entry), `dvModels ${id}`)
  }
  const skills = Object.entries(config.models).flatMap(([id, modes]) => Object.keys(modes).map((mode) => {
    const skill = (SERVED[id]?.modes[mode as ModeId] as ServedMode).skill
    return {
      name: skill.name, description: skill.description, source: 'runtime',
      content: readFileSync(new URL(`../skills/${skill.file}`, import.meta.url), 'utf8'),
      // The agent's own procedure: the model loads it, and the composer's / menu and the Skills page do not list it.
      invocation: { modelInvocable: true, userInvocable: false },
    }
  }))
  ctx.inject(['skills'], (child) => {
    for (const definition of skills) child.effect(() => child.skills.register(definition), `dvModels ${definition.name}`)
  })
}
