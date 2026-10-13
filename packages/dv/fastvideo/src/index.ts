/**
 * Company plugin of DreamVerse for models served by local FastVideo streaming_v2 servers. It registers each model that
 * its `models` config names into `ctx.dvModels`, with the modes the config gives a server for; a model or mode the
 * config leaves out is not registered. Each mode of a model is served by its own server: the streaming_v2 client of
 * `@dv/fastvideo-generation-client` sends each render as one `POST /v1/streamv2/generate`, with the references first and
 * the first frame after them, each as its media type and bytes read from `dvAssetPool`. While the DSH skill registry is
 * mounted, the plugin registers the prompt skill of every registered model and mode.
 *
 * Served models: `fasth3` (MiniMax H3 as FastH3), in mode `reference` (FastH3 Ref2VA) and mode `text` (FastH3 8-Step V2).
 *
 * @module @dv/fastvideo
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { DvFastvideoGeneration, type ModelFacts } from '@dv/fastvideo-generation-client'
import type {} from '@dv/asset-pool'
import type {
  InputRole, ModeDeclaration, ModeId, ModeInputs, ModelEntry, RenderModelFacts, RenderRequest, RenderStreamEvent,
} from '@dv/models'

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
interface ServedMode extends Pick<ModeDeclaration, 'inputs' | 'extra'> {
  skill: { name: string; description: string; file: string }
}

/** The models this plugin can serve, with the modes it can serve each in. */
const SERVED: Record<string, { company: string; summary: string; modes: Partial<Record<ModeId, ServedMode>> }> = {
  fasth3: {
    company: 'local FastVideo',
    summary: 'MiniMax H3 (FastH3); video with sound, dialogue and music written in the prompt',
    modes: {
      reference: {
        inputs: { reference: { min: 1, mediaTypes: ['image', 'video', 'audio'] }, first_frame: { min: 0, mediaTypes: ['image'] } },
        extra: {},
        skill: {
          name: 'fasth3-reference-prompting',
          description: 'Model limits and prompt rules for dv_shot_render with model fasth3 in mode reference: reference images, '
            + 'videos and audio, how the prompt names them, and how a shot continues the previous one.',
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

/** Required services: the model catalog, and the asset pool that holds the bytes and media type of each input asset. */
export const inject = ['dvModels', 'dvAssetPool']

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
 * The count limits of a mode's input roles, from the server's reference limits. The server counts the first frame among
 * its references, so the first frame takes one slot of the server's total and one slot of each media type that the
 * `first_frame` role accepts, and the `reference` role keeps the rest. A media type that the `reference` role declares
 * and the server does not accept has a limit of 0.
 * @param inputs - the inputs the mode declares; `SERVED` declares `reference` and `first_frame` together or neither.
 * @param facts - the server's facts.
 * @returns the limits by declared role; empty in a mode without references.
 */
function deriveInputLimits(inputs: ModeInputs, facts: ModelFacts): RenderModelFacts['inputLimits'] {
  const { reference, first_frame: firstFrame } = inputs
  if (reference === undefined || firstFrame === undefined) return {}
  const firstFrameTypes = new Set(firstFrame.mediaTypes)
  const maxCountByMediaType = Object.fromEntries(reference.mediaTypes.map(mediaType => [
    mediaType, (facts.referenceMediaTypes[mediaType]?.maxCount ?? 0) - (firstFrameTypes.has(mediaType) ? 1 : 0),
  ]))
  return {
    reference: { maxCount: facts.maxReferences - 1, maxCountByMediaType },
    first_frame: { maxCount: 1, maxCountByMediaType: {} },
  }
}

/**
 * The problems of one render request in a mode: an input role the mode does not declare holding an asset, a role
 * holding fewer assets than its `min`, an asset whose media type its role does not declare, or a role holding more
 * assets in total or of one media type than the server's limits allow.
 * @param inputs - the inputs the mode declares.
 * @param limits - the input limits from the server's facts.
 * @param request - the render request.
 * @param mediaTypeOf - the media type of an asset, read from the asset pool.
 * @returns the problems, each one sentence; empty when the server renders the request.
 */
function requestProblems(
  inputs: ModeInputs, limits: RenderModelFacts['inputLimits'], request: RenderRequest,
  mediaTypeOf: (asset: RenderRequest['references'][number]) => string,
): string[] {
  const problems: string[] = []
  const roles: Array<[InputRole, RenderRequest['references']]> = [
    ['reference', request.references], ['first_frame', request.firstFrame === null ? [] : [request.firstFrame]],
  ]
  for (const [role, assets] of roles) {
    const declared = inputs[role]
    if (declared === undefined) {
      if (assets.length > 0) problems.push(`It takes no ${role} input; this shot has ${assets.length}.`)
      continue
    }
    const accepted = declared.mediaTypes.join(', ')
    if (assets.length < declared.min) {
      problems.push(`Its ${role} input needs at least ${declared.min} of type ${accepted}; this shot has ${assets.length}.`)
    }
    const counts = new Map<string, number>()
    for (const asset of assets) {
      const mediaType = mediaTypeOf(asset)
      if (!declared.mediaTypes.includes(mediaType)) problems.push(`Its ${role} input takes assets of type ${accepted}; asset ${asset} is of type ${mediaType}.`)
      counts.set(mediaType, (counts.get(mediaType) ?? 0) + 1)
    }
    const limit = limits[role]
    if (limit?.maxCount !== undefined && assets.length > limit.maxCount) {
      problems.push(`Its ${role} input takes at most ${limit.maxCount} assets; this shot has ${assets.length}.`)
    }
    for (const [mediaType, count] of counts) {
      const max = limit?.maxCountByMediaType[mediaType]
      if (max !== undefined && count > max) problems.push(`Its ${role} input takes at most ${max} of type ${mediaType}; this shot has ${count}.`)
    }
  }
  return problems
}

/**
 * A catalog entry for one configured model: one streaming_v2 client per configured mode.
 * @param ctx - the plugin context; each client lives in an isolated `dvFastvideoGeneration` scope, and `render` reads
 *   each input asset from `ctx.dvAssetPool`.
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
  // Each mode checks requests against its own declared inputs and its own server's limits.
  const declared = Object.fromEntries(Object.entries(modes).map(([mode, server]): [string, ModeDeclaration] => {
    const { inputs, extra } = served.modes[mode as ModeId] as ServedMode
    return [mode, {
      inputs, extra, gpuSecondsPerVideoSecond: server.gpuSecondsPerVideoSecond,
      validateGenerationRequest: async request => requestProblems(
        inputs, deriveInputLimits(inputs, await clientOf(mode as ModeId).model()), request, asset => ctx.dvAssetPool.mediaType(asset)),
    }]
  }))
  return {
    id,
    company: served.company,
    summary: served.summary,
    modes: declared,
    async facts(mode: ModeId): Promise<RenderModelFacts> {
      const facts = await clientOf(mode).model()
      return {
        modelId: facts.modelId, aspectRatios: facts.aspectRatios, resolutions: facts.resolutions, frameSizes: facts.frameSizes,
        minDurationSec: facts.minSegmentDurationSec, maxDurationSec: facts.maxSegmentDurationSec,
        numFramesByDurationSec: facts.numFramesByDurationSec,
        inputLimits: deriveInputLimits((served.modes[mode] as ServedMode).inputs, facts),
      }
    },
    render(mode: ModeId, request: RenderRequest, signal?: AbortSignal): AsyncIterable<RenderStreamEvent> {
      const client = clientOf(mode)
      const assets = request.firstFrame === null ? request.references : [...request.references, request.firstFrame]
      return (async function* () {
        // Video and audio references can be tens of megabytes each, so they are read concurrently off the event loop.
        const references = await Promise.all(assets.map(async id => ({
          mediaType: ctx.dvAssetPool.mediaType(id), bytes: await readFile(ctx.dvAssetPool.path(id)),
        })))
        yield* client.generateSegment({
          prompt: request.prompt,
          references,
          frameWidth: request.frameWidth,
          frameHeight: request.frameHeight,
          numFrames: request.numFrames,
          seed: request.seed,
          returnLastFrame: true,
          ...signal === undefined ? {} : { signal },
        })
      })()
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
