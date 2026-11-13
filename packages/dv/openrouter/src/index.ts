/**
 * Register configured OpenRouter models in the model catalog: video models (tasks `t2v`, `i2v`, `fl2v`) for the
 * shot-render workflow, and image models (task `t2i`) for `image.generate`.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { replacePromptCitations } from '@dv/project'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import type { ModelEntry, RenderRequest, TaskOfPrimitive } from '@dv/models'
import type { GeneratedImage, ImageRequest } from '@dv/image-generate'
import { OpenRouterApi } from './client.ts'
import type { ImageModel, VideoModel } from './types.ts'

export interface Config {
  baseUrl: string
  models: Volatile<Record<string, string>>
  imageModels: Volatile<Record<string, string>>
  credentialRef: Volatile<string>
  pollIntervalMs: number
}
export const Config = z.object({
  baseUrl: z.string().default('https://openrouter.ai/api/v1/'),
  models: z.dict(z.string().required()).default({}).volatile(),
  imageModels: z.dict(z.string().required()).default({}).volatile(),
  credentialRef: z.string().default('OPENROUTER_API_KEY').volatile(),
  pollIntervalMs: z.natural().min(1).default(5000),
})
export const name = 'dv-openrouter'
export const inject = ['dvModels', 'dvAssetPool', 'dvFfmpeg', 'credentials']

function tasks(model: VideoModel): Array<TaskOfPrimitive<'video'>> {
  return ['t2v', ...model.frames.includes('first_frame') ? ['i2v' as const] : [],
    ...model.frames.includes('first_frame') && model.frames.includes('last_frame') ? ['fl2v' as const] : []]
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const IMAGE_PARAMETER_TEXT: Record<string, string> = {
  aspect_ratio: 'The aspect ratio of the image.',
  resolution: 'The resolution tier; the provider chooses the pixel size from it and the aspect ratio.',
  quality: 'The rendering quality.',
  background: 'The background; transparent keeps an alpha channel.',
}

const ALIAS = /^[a-z0-9][a-z0-9-]{0,119}$/

/** Register only explicitly configured models. A dormant installation makes no network call. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const client = new OpenRouterApi(config.baseUrl, async () => {
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
  const model = async (id: string, task: TaskOfPrimitive<'video'>): Promise<VideoModel> => {
    const found = (await client.catalog()).find(row => row.id === id)
    if (found === undefined || !tasks(found).includes(task)) throw new Error('The selected OpenRouter model no longer supports this task.')
    return found
  }
  const entry = (alias: string, selected: VideoModel, task: TaskOfPrimitive<'video'>): ModelEntry<TaskOfPrimitive<'video'>> => ({
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
  const imageModel = async (id: string): Promise<ImageModel> => {
    const found = (await client.imageCatalog()).find(row => row.id === id)
    if (found === undefined) throw new Error('The selected OpenRouter image model is no longer in the image catalog.')
    return found
  }
  /** The PNG bytes and pixel size of a generated image; other raster formats go through ffmpeg. */
  const asPng = async (bytes: Buffer): Promise<GeneratedImage> => {
    let png = bytes
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      const dir = await mkdtemp(join(tmpdir(), 'dv-openrouter-'))
      try {
        const input = join(dir, 'image')
        await writeFile(input, bytes)
        const argv = ['ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-frames:v', '1', '{{out:image.png}}']
        const [output] = (await ctx.dvFfmpeg.run({ argv, inputs: [input], outputs: ['image.png'], dir })).outputs
        png = await readFile(output as string)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('OpenRouter returned an image that is not a raster image.')
    return { bytes: png, mime: 'image/png', width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
  }
  const imageEntry = (alias: string, selected: ImageModel): ModelEntry<'t2i'> => ({
    modality: 'image', provider: 'openrouter', model: alias, task: 't2i', displayName: selected.name,
    description: `OpenRouter: ${selected.name}, an image from text. Cloud generation billed by the provider. The provider `
      + 'chooses the pixel size from extra.aspect_ratio and extra.resolution where the model offers them; size is not accepted.',
    facts: async () => ({ modelId: (await imageModel(selected.id)).id }),
    schema: async () => {
      const caps = await imageModel(selected.id)
      return {
        size: { rule: 'not accepted; omit size and choose extra.aspect_ratio and extra.resolution where listed' },
        extra: Object.fromEntries(Object.entries(caps.parameters).map(([key, values]) => [key,
          { type: 'string', values, description: IMAGE_PARAMETER_TEXT[key] ?? key }])),
        seed_supported: caps.seed,
      }
    },
    validateGenerationRequest: async (request: ImageRequest) => {
      const caps = await imageModel(selected.id)
      const problems: string[] = []
      if (request.size !== null) {
        problems.push('OpenRouter image models take no size; omit it and choose extra.aspect_ratio and extra.resolution from dv_models_get.')
      }
      for (const [key, value] of Object.entries(request.extra)) {
        const values = caps.parameters[key]
        if (values === undefined) problems.push(`OpenRouter model ${selected.name} takes no extra parameter ${key}.`)
        else if (!values.some(choice => String(choice) === String(value))) problems.push(`Choose extra.${key} from ${values.join(', ')}.`)
      }
      return problems
    },
    render: async (request: ImageRequest, signal?: AbortSignal) => {
      const caps = await imageModel(selected.id)
      const extra = Object.fromEntries(Object.entries(request.extra).map(([key, value]) => [key,
        caps.parameters[key]?.find(choice => String(choice) === String(value)) ?? value]))
      const { bytes } = await client.generateImage({ model: selected.id,
        prompt: replacePromptCitations(request.prompt, citation => citation.label), n: 1,
        ...caps.seed ? { seed: request.seed } : {}, ...caps.outputFormats.includes('png') ? { output_format: 'png' } : {},
        ...extra,
      }, signal)
      signal?.throwIfAborted()
      return await asPng(bytes)
    },
  })
  const sync = async (): Promise<void> => {
    const stamp = JSON.stringify([config.models.get(), config.imageModels.get()])
    if (current === stamp) return
    const version = ++revision
    try {
      const configured = Object.entries(config.models.get())
      const configuredImages = Object.entries(config.imageModels.get())
      for (const [alias] of [...configured, ...configuredImages]) {
        if (!ALIAS.test(alias)) throw new Error('Choose a model alias using lowercase letters, numbers, and hyphens.')
      }
      const [catalog, images] = await Promise.all([
        configured.length === 0 ? [] : client.catalog(lifetime.signal),
        configuredImages.length === 0 ? [] : client.imageCatalog(lifetime.signal),
      ])
      const next: ModelEntry[] = [...configured.flatMap(([alias, id]) => {
        const caps = catalog.find(row => row.id === id)
        if (caps === undefined) throw new Error(`OpenRouter video model ${id} is unavailable or lacks supported output choices.`)
        return tasks(caps).map(task => entry(alias, caps, task))
      }), ...configuredImages.map(([alias, id]) => {
        const caps = images.find(row => row.id === id)
        if (caps === undefined) throw new Error(`OpenRouter image model ${id} is unavailable or offers no raster output.`)
        return imageEntry(alias, caps)
      })]
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
  await sync()
  ctx.on('loader/volatile-update', update)
  ctx.inject(['connection'], scope => scope.effect(() => scope.connection.fetch.register({
    path: '/api/dv/openrouter/catalog', methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const [data, images] = await Promise.all([client.catalog(request.signal), client.imageCatalog(request.signal)])
        await sync()
        return Response.json({ data, images, error: registrationError })
      } catch { return Response.json({ error: 'Could not load OpenRouter models. Check the saved API key and connection.' }, { status: 502 }) }
    },
  }), 'OpenRouter model discovery'))
}
