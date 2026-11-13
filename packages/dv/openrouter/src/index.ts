/** Register configured OpenRouter video models through the existing catalog and shot-render workflow. */
import { readFile } from 'node:fs/promises'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { replacePromptCitations } from '@dv/project'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import type { ModelEntry, RenderRequest, TaskId } from '@dv/models'
import { OpenRouterVideos } from './client.ts'
import type { VideoModel } from './types.ts'

export interface Config {
  baseUrl: string
  models: Volatile<Record<string, string>>
  credentialRef: Volatile<string>
  pollIntervalMs: number
}
export const Config = z.object({
  baseUrl: z.string().default('https://openrouter.ai/api/v1/'),
  models: z.dict(z.string().required()).default({}).volatile(),
  credentialRef: z.string().default('OPENROUTER_API_KEY').volatile(),
  pollIntervalMs: z.natural().min(1).default(5000),
})
export const name = 'dv-openrouter'
export const inject = ['dvModels', 'dvAssetPool', 'dvFfmpeg', 'credentials']

function tasks(model: VideoModel): TaskId[] {
  return ['t2v', ...model.frames.includes('first_frame') ? ['i2v' as const] : [],
    ...model.frames.includes('first_frame') && model.frames.includes('last_frame') ? ['fl2v' as const] : []]
}

/** Throw for an alias that is not 1-120 lowercase letters, digits and hyphens, starting with a letter or digit. */
function checkAlias(alias: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(alias)) throw new Error('Choose a model alias using lowercase letters, numbers, and hyphens.')
}

/** Register only explicitly configured models. A dormant installation makes no network call. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const client = new OpenRouterVideos(config.baseUrl, async () => {
    const ref = config.credentialRef.get()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error('Invalid OpenRouter credential reference.')
    const credential = await ctx.credentials.resolve(credentialRef(ref))
    if (credential === undefined) throw new Error('Save an OpenRouter API key in Video APIs settings.')
    return credential.value
  }, config.pollIntervalMs)
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  let disposed = false
  let revision = 0
  let current = ''
  let removers: Array<() => void> = []
  let registered: ModelEntry[] = []
  let registrationError: string | null = null
  const model = async (id: string, task: TaskId): Promise<VideoModel> => {
    const found = (await client.catalog()).find(row => row.id === id)
    if (found === undefined || !tasks(found).includes(task)) throw new Error('The selected OpenRouter model no longer supports this task.')
    return found
  }
  const entry = (alias: string, selected: VideoModel, task: TaskId): ModelEntry => ({
    modality: 'video', provider: 'openrouter', model: alias, task, displayName: selected.name,
    description: `OpenRouter: ${selected.name}, task ${task}. Cloud generation billed by the provider. `
      + 'Uses provider-published durations and output choices. Stopping local monitoring does not cancel the paid cloud job.',
    facts: async () => {
      const caps = await model(selected.id, task)
      return { modelId: caps.id, aspectRatios: caps.aspectRatios, resolutions: caps.resolutions,
        minDurationSec: Math.min(...caps.durations), maxDurationSec: Math.max(...caps.durations), durationsSec: caps.durations }
    },
    schema: async () => {
      const caps = await model(selected.id, task)
      return { duration_sec: { min: Math.min(...caps.durations), max: Math.max(...caps.durations), values: caps.durations },
        aspect_ratios: caps.aspectRatios, resolutions: caps.resolutions,
        inputs: task === 't2v' ? {} : { first_frame: { min: 1, max: 1, media_types: { image: { max: 1 } } },
          ...task === 'fl2v' ? { last_frame: { min: 1, max: 1, media_types: { image: { max: 1 } } } } : {} },
        extra: caps.audio ? { generate_audio: { type: 'boolean', description: 'Generate synchronized audio.' } } : {},
        seed_supported: caps.seed, cancellation: 'monitoring_only' }
    },
    validateGenerationRequest: async (request) => {
      const caps = await model(selected.id, task)
      const problems: string[] = []
      if (request.durationSec === undefined || !caps.durations.includes(request.durationSec)) {
        problems.push(`Choose a duration from ${caps.durations.join(', ')} seconds.`)
      }
      if (!caps.aspectRatios.includes(request.aspectRatio ?? '')) problems.push(`Choose an aspect ratio from ${caps.aspectRatios.join(', ')}.`)
      if (!caps.resolutions.includes(request.resolution ?? '')) problems.push(`Choose a resolution from ${caps.resolutions.join(', ')}.`)
      if (request.references.length > 0) problems.push('This OpenRouter task accepts endpoint images, not general reference media.')
      for (const [role, asset, required] of [
        ['first_frame', request.firstFrame, task !== 't2v'], ['last_frame', request.lastFrame, task === 'fl2v'],
      ] as const) {
        if (required && asset === null) problems.push(`Its ${role} input requires one image.`)
        if (!required && asset !== null) problems.push(`This task takes no ${role} input.`)
        if (asset !== null && ctx.dvAssetPool.mediaType(asset) !== 'image') problems.push(`Its ${role} input accepts only images.`)
      }
      for (const [key, value] of Object.entries(request.extra)) {
        if (key !== 'generate_audio' || !caps.audio) problems.push(`OpenRouter model ${selected.name} takes no extra parameter ${key}.`)
        else if (typeof value !== 'boolean') problems.push('extra.generate_audio must be a boolean.')
      }
      return problems
    },
    render: (request: RenderRequest, signal?: AbortSignal) => (async function* () {
      const caps = await model(selected.id, task)
      const images = await Promise.all(([
        ['first_frame', request.firstFrame], ['last_frame', request.lastFrame],
      ] as const).flatMap(([frame_type, asset]) => asset === null ? [] : [(async () => ({ type: 'image_url', frame_type,
        image_url: { url: 'data:' + ctx.dvAssetPool.get(asset).mime + ';base64,'
          + (await readFile(ctx.dvAssetPool.path(asset))).toString('base64') },
      }))()]))
      const { video, mime } = await client.generate({ model: selected.id,
        prompt: replacePromptCitations(request.prompt, citation => citation.label),
        duration: request.durationSec, aspect_ratio: request.aspectRatio, resolution: request.resolution,
        ...caps.seed ? { seed: request.seed } : {}, ...request.extra,
        ...images.length === 0 ? {} : { frame_images: images },
      }, signal)
      const png = await ctx.dvFfmpeg.lastFrame(video)
      signal?.throwIfAborted()
      yield { kind: 'last_frame', png } as const
      yield { kind: 'video_start', mime } as const
      yield { kind: 'chunk', bytes: video } as const
      yield { kind: 'done', timings: {} } as const
    })(),
  })
  const sync = async (): Promise<void> => {
    const stamp = JSON.stringify(config.models.get())
    if (current === stamp) return
    const version = ++revision
    try {
      const configured = Object.entries(config.models.get())
      const catalog = configured.length === 0 ? [] : await client.catalog(lifetime.signal)
      const next = configured.flatMap(([alias, id]) => {
        checkAlias(alias)
        const caps = catalog.find(row => row.id === id)
        if (caps === undefined) throw new Error(`OpenRouter video model ${id} is unavailable or lacks supported output choices.`)
        return tasks(caps).map(task => entry(alias, caps, task))
      })
      if (disposed || version !== revision) return
      for (const candidate of next) {
        const existing = ctx.dvModels.get(candidate)
        if (existing !== undefined && !registered.includes(existing)) throw new Error('Another plugin already registered this OpenRouter model.')
      }
      for (const remove of removers) remove()
      removers = next.map(candidate => ctx.dvModels.register(candidate))
      registered = next
      current = stamp
      registrationError = null
    } catch (error) {
      if (!disposed && version === revision) {
        for (const remove of removers) remove()
        removers = []; registered = []; current = ''
        registrationError = 'Could not register OpenRouter models. Check the saved key and catalog.'
      }
      throw error
    }
  }
  ctx.effect(() => async () => {
    disposed = true; revision++; lifetime.abort()
    await Promise.allSettled([...pending])
    for (const remove of removers) remove()
  }, 'OpenRouter models')
  const update = (): void => {
    const work = sync().catch(() => undefined)
    pending.add(work)
    void work.finally(() => { pending.delete(work) })
  }
  ctx.on('loader/volatile-update', update)
  ctx.inject(['connection'], scope => scope.effect(() => scope.connection.fetch.register({
    path: '/api/dv/openrouter/catalog', methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      try { const data = await client.catalog(request.signal); await sync(); return Response.json({ data, error: registrationError }) }
      catch { return Response.json({ error: 'Could not load OpenRouter video models. Check the saved API key and connection.' }, { status: 502 }) }
    },
  }), 'OpenRouter video discovery'))
  // A configured alias is checked without the network, so a bad alias in cordis.yml fails the load.
  for (const alias of Object.keys(config.models.get())) checkAlias(alias)
  // A failed boot catalog sync keeps discovery and settings updates registered so a saved key or catalog recovers it.
  await sync().catch((error: unknown) => {
    ctx.logger('dvOpenRouter').warn('could not register OpenRouter models: %s', error instanceof Error ? error.message : String(error))
  })
}
