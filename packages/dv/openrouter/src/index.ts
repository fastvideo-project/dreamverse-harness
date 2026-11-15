/**
 * Register configured OpenRouter models in the model catalog: video models (tasks `t2v`, `ref2v`, `i2v`, `fl2v`) for
 * the shot-render workflow, image models (task `t2i`) for `image.generate`, and speech models (task `t2a`) for
 * `audio.generate`.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-subprocess'
import { replacePromptCitations, type AssetId } from '@dv/project'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import type { ModelEntry, RenderRequest, TaskOfPrimitive } from '@dv/models'
import type { GeneratedImage, ImageRequest } from '@dv/image-generate'
import type { AudioRequest, GeneratedAudio } from '@dv/audio-generate'
import { OpenRouterApi } from './client.ts'
import { openReferenceHost, publishedByAuthority, type TunnelProcess } from './reference-host.ts'
import type { ImageModel, ReferenceMedia, SpeechModel, VideoModel } from './types.ts'

export interface Config {
  baseUrl: string
  models: Volatile<Record<string, string>>
  imageModels: Volatile<Record<string, string>>
  audioModels: Volatile<Record<string, string>>
  credentialRef: Volatile<string>
  pollIntervalMs: number
  referenceHosting: 'none' | 'cloudflare-quick-tunnel'
  cloudflaredPath: string
  tunnelStartTimeoutMs: number
}
export const Config = z.object({
  baseUrl: z.string().default('https://openrouter.ai/api/v1/'),
  models: z.dict(z.string().required()).default({}).volatile(),
  imageModels: z.dict(z.string().required()).default({}).volatile(),
  audioModels: z.dict(z.string().required()).default({}).volatile(),
  credentialRef: z.string().default('OPENROUTER_API_KEY').volatile(),
  pollIntervalMs: z.natural().min(1).default(5000),
  referenceHosting: z.union([z.const('none'), z.const('cloudflare-quick-tunnel')]).default('none')
    .description('How audio and video references reach OpenRouter, which takes them only as public HTTPS links. '
      + '`none` refuses them; `cloudflare-quick-tunnel` serves each render\'s references through a temporary Cloudflare quick tunnel.'),
  cloudflaredPath: z.string().default('cloudflared').description('The cloudflared program that `cloudflare-quick-tunnel` runs.'),
  tunnelStartTimeoutMs: z.natural().min(1).default(60_000)
    .description('How long a quick tunnel may take to print its address and serve the first reference.'),
})
export const name = 'dv-openrouter'
export const inject = ['dvModels', 'dvAssetPool', 'dvFfmpeg', 'credentials']

/**
 * The video tasks a model serves: `ref2v` when it takes reference media the provider can send, `i2v` and `fl2v` from its
 * frame images.
 */
function tasks(model: VideoModel, references: readonly ReferenceMedia[]): Array<TaskOfPrimitive<'video'>> {
  return ['t2v', ...references.length > 0 ? ['ref2v' as const] : [],
    ...model.frames.includes('first_frame') ? ['i2v' as const] : [],
    ...model.frames.includes('first_frame') && model.frames.includes('last_frame') ? ['fl2v' as const] : []]
}

/** One input of a task as `schema()` describes it: its count and the media types it takes. */
type TaskInput = { min: number; max?: number; media_types: Record<string, { max?: number }> }

/**
 * The inputs of one task for `schema()`: none for `t2v`; one or more references of the given media for `ref2v`, with no
 * count limit because OpenRouter publishes none; frame images for `i2v` and `fl2v`.
 */
function taskInputs(task: TaskOfPrimitive<'video'>, references: readonly ReferenceMedia[]): Record<string, TaskInput> {
  if (task === 't2v') return {}
  if (task === 'ref2v') return { reference: { min: 1, media_types: Object.fromEntries(references.map(kind => [kind, {}])) } }
  const frame = { min: 1, max: 1, media_types: { image: { max: 1 } } }
  return task === 'fl2v' ? { first_frame: frame, last_frame: frame } : { first_frame: frame }
}

/** The `input_references` part type of each reference medium. */
const REFERENCE_PART: Record<ReferenceMedia, 'image_url' | 'video_url' | 'audio_url'> = {
  image: 'image_url', video: 'video_url', audio: 'audio_url',
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const IMAGE_PARAMETER_TEXT: Record<string, string> = {
  aspect_ratio: 'The aspect ratio of the image.',
  resolution: 'The resolution tier; the provider chooses the pixel size from it and the aspect ratio.',
  quality: 'The rendering quality.',
  background: 'The background; transparent keeps an alpha channel.',
}

/**
 * The sample rate of raw PCM speech. OpenRouter documents `audio/pcm` as 16-bit little-endian without a rate; Gemini
 * TTS and MAI-Voice send 24 kHz mono, so the harness reads all PCM at that rate.
 */
const PCM_SAMPLE_RATE = 24_000

/**
 * Model vendors whose speech OpenRouter returns only as PCM; it answers HTTP 400 when they are asked for MP3, and the
 * models API names no output formats. Other vendors are asked for MP3, which MiniMax requires.
 * https://openrouter.ai/docs/guides/overview/multimodal/tts
 */
const PCM_ONLY_VENDORS: readonly string[] = ['google', 'heygen']

/** Voices an error message names before it points at dv_models_get for the rest. */
const VOICES_NAMED = 30

/** The speech options the harness passes through `extra`, besides `voice`. */
const SPEECH_INSTRUCTIONS = 'How to deliver the text: tone, pace, emotion or accent. Only some models use it (OpenAI '
  + 'gpt-4o-mini-tts, Gemini TTS, Fish Audio); others ignore it.'

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
  /** The reference media of a model the provider can send: images as `data:` URLs, audio and video only through a host. */
  const sendable = (selected: VideoModel): ReferenceMedia[] =>
    config.referenceHosting === 'none' ? selected.references.filter(kind => kind === 'image') : selected.references
  const model = async (id: string, task: TaskOfPrimitive<'video'>): Promise<VideoModel> => {
    const found = (await client.videoCatalog()).find(row => row.id === id)
    if (found === undefined || !tasks(found, sendable(found)).includes(task)) {
      throw new Error('The selected OpenRouter model no longer supports this task.')
    }
    return found
  }
  const spawnTunnel = (target: string): TunnelProcess => {
    const argv = [config.cloudflaredPath, 'tunnel', '--no-autoupdate', '--url', target]
    const subprocess = ctx.get('subprocess')
    if (subprocess !== undefined) {
      const handle = subprocess.spawn({ argv, cwd: tmpdir(), graceMs: 5_000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: 'pipe' } })
      if (handle.stderr === undefined) { handle.terminate(); throw new Error('cloudflared started without a stderr pipe.') }
      return { stderr: handle.stderr, done: handle.done, terminate: () => { handle.terminate() } }
    }
    const child = spawn(config.cloudflaredPath, argv.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    return { stderr: child.stderr, done: once(child, 'close'), terminate: () => { child.kill() } }
  }
  const entry = (alias: string, selected: VideoModel, task: TaskOfPrimitive<'video'>): ModelEntry<TaskOfPrimitive<'video'>> => ({
    modality: 'video', provider: 'openrouter', model: alias, task, displayName: selected.name,
    description: `OpenRouter: ${selected.name}, task ${task}. Cloud generation billed by the provider. `
      + (task === 'ref2v' ? `Takes reference ${sendable(selected).join(', ')} with no first or last frame. ` : '')
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
        inputs: taskInputs(task, sendable(caps)),
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
      if (task !== 'ref2v' && request.references.length > 0) {
        problems.push('This OpenRouter task accepts endpoint images, not general reference media.'
          + (sendable(caps).length > 0 ? ' Use task ref2v for reference media.' : ''))
      }
      if (task === 'ref2v') {
        if (request.references.length === 0) problems.push('Its reference input requires at least one asset.')
        for (const asset of request.references) {
          const kind = ctx.dvAssetPool.mediaType(asset)
          if (!sendable(caps).some(accepted => accepted === kind)) {
            problems.push(`Its reference input accepts only ${sendable(caps).join(', ')}; asset ${asset} is ${kind}.`
              + (caps.references.some(accepted => accepted === kind) ? ` OpenRouter takes ${kind} references only as public `
                + 'HTTPS links, and reference hosting is off in the OpenRouter provider settings.' : ''))
          }
        }
      }
      for (const [role, asset, required] of [
        ['first_frame', request.firstFrame, task !== 't2v' && task !== 'ref2v'], ['last_frame', request.lastFrame, task === 'fl2v'],
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
      const dataUrl = async (asset: AssetId): Promise<string> => 'data:' + ctx.dvAssetPool.get(asset).mime + ';base64,'
        + (await readFile(ctx.dvAssetPool.path(asset))).toString('base64')
      const kinds = request.references.map((asset) => {
        const kind = ctx.dvAssetPool.mediaType(asset)
        const part = sendable(caps).find(accepted => accepted === kind)
        if (part === undefined) throw new Error(`OpenRouter model ${selected.name} takes no ${kind} reference here.`)
        return part
      })
      // Audio and video go through a temporary public host, which stays open until the job ends, because the provider
      // may download them after submission.
      const hosted = request.references.filter((_, index) => kinds[index] !== 'image')
      const host = hosted.length === 0 ? null : await openReferenceHost(hosted.map(asset => ({ path: ctx.dvAssetPool.path(asset),
        mime: ctx.dvAssetPool.get(asset).mime, name: ctx.dvAssetPool.get(asset).name })),
      { spawn: spawnTunnel, startTimeoutMs: config.tunnelStartTimeoutMs, published: publishedByAuthority,
        fetcher: globalThis.fetch, signal })
      let result: { video: Buffer; mime: string }
      try {
        const references = await Promise.all(request.references.map(async (asset, index) => {
          const part = REFERENCE_PART[kinds[index] ?? 'image']
          const url = host === null || kinds[index] === 'image' ? await dataUrl(asset) : host.urls[hosted.indexOf(asset)]
          return { type: part, [part]: { url } }
        }))
        const images = await Promise.all(([
          ['first_frame', request.firstFrame], ['last_frame', request.lastFrame],
        ] as const).flatMap(([frame_type, asset]) => asset === null ? [] : [(async () => ({ type: 'image_url', frame_type,
          image_url: { url: await dataUrl(asset) },
        }))()]))
        result = await client.generate({ model: selected.id,
          prompt: replacePromptCitations(request.prompt, citation => citation.label),
          duration: request.durationSec, aspect_ratio: request.aspectRatio, resolution: request.resolution,
          ...caps.seed ? { seed: request.seed } : {}, ...request.extra,
          ...images.length === 0 ? {} : { frame_images: images },
          ...references.length === 0 ? {} : { input_references: references },
        }, signal)
      } finally {
        await host?.close()
      }
      const { video, mime } = result
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
  const speechModel = async (id: string): Promise<SpeechModel> => {
    const found = (await client.speechCatalog()).find(row => row.id === id)
    if (found === undefined) throw new Error('The selected OpenRouter speech model is no longer in the speech catalog.')
    return found
  }
  /** A WAV file and its duration from OpenRouter's MP3 or raw PCM answer, through ffmpeg. */
  const asWav = async (bytes: Buffer, mime: string): Promise<GeneratedAudio> => {
    const dir = await mkdtemp(join(tmpdir(), 'dv-openrouter-'))
    try {
      const input = join(dir, 'speech')
      await writeFile(input, bytes)
      const raw = mime === 'audio/pcm' || mime === 'audio/l16'
      const argv = ['ffmpeg', '-y', '-loglevel', 'error',
        ...raw ? ['-f', 's16le', '-ar', String(PCM_SAMPLE_RATE), '-ac', '1'] : [],
        '-i', '{{in:0}}', '-vn', '-c:a', 'pcm_s16le', '{{out:speech.wav}}']
      const [output] = (await ctx.dvFfmpeg.run({ argv, inputs: [input], outputs: ['speech.wav'], dir })).outputs
      const durationSec = (await ctx.dvFfmpeg.probe(output as string)).durationSec
      if (durationSec === null || durationSec <= 0) throw new Error('OpenRouter returned an empty audio clip.')
      return { bytes: await readFile(output as string), mime: 'audio/wav', durationSec }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  const speechEntry = (alias: string, selected: SpeechModel): ModelEntry<'t2a'> => ({
    modality: 'audio', provider: 'openrouter', model: alias, task: 't2a', displayName: selected.name,
    description: `OpenRouter: ${selected.name}, speech from text. Cloud generation billed by the provider. The prompt is `
      + 'the plain text to speak, without markup; extra.voice chooses the voice.',
    facts: async () => ({ modelId: (await speechModel(selected.id)).id }),
    schema: async () => {
      const caps = await speechModel(selected.id)
      return {
        extra: {
          voice: caps.voices.length === 0
            ? { type: 'string', description: 'The provider\'s voice name. The catalog lists none for this model; omit it for the provider default.' }
            : { type: 'string', values: caps.voices, required: true, description: 'The voice that speaks the text.' },
          instructions: { type: 'string', description: SPEECH_INSTRUCTIONS },
        },
      }
    },
    validateGenerationRequest: async (request: AudioRequest) => {
      const caps = await speechModel(selected.id)
      const problems: string[] = []
      const voice = request.extra['voice']
      const named = caps.voices.length > VOICES_NAMED
        ? `${caps.voices.slice(0, VOICES_NAMED).join(', ')} (dv_models_get lists all ${caps.voices.length})` : caps.voices.join(', ')
      if (voice === undefined) {
        if (caps.voices.length > 0) problems.push(`Choose extra.voice from ${named}.`)
      } else if (typeof voice !== 'string' || voice.trim() === '') problems.push('extra.voice must be a voice name.')
      else if (caps.voices.length > 0 && !caps.voices.includes(voice)) problems.push(`Choose extra.voice from ${named}.`)
      const instructions = request.extra['instructions']
      if (instructions !== undefined && typeof instructions !== 'string') problems.push('extra.instructions must be text.')
      for (const key of Object.keys(request.extra)) {
        if (key !== 'voice' && key !== 'instructions') problems.push(`OpenRouter model ${selected.name} takes no extra parameter ${key}.`)
      }
      return problems
    },
    render: async (request: AudioRequest, signal?: AbortSignal) => {
      await speechModel(selected.id)
      const { voice, instructions } = request.extra
      const { bytes, mime } = await client.speak({ model: selected.id,
        input: replacePromptCitations(request.prompt, citation => citation.label),
        response_format: PCM_ONLY_VENDORS.includes(selected.id.split('/')[0] ?? '') ? 'pcm' : 'mp3',
        ...typeof voice === 'string' ? { voice } : {},
        ...typeof instructions === 'string' && instructions.trim() !== '' ? { instructions } : {},
      }, signal)
      signal?.throwIfAborted()
      return await asWav(bytes, mime)
    },
  })
  const sync = async (): Promise<void> => {
    const stamp = JSON.stringify([config.models.get(), config.imageModels.get(), config.audioModels.get()])
    if (current === stamp) return
    const version = ++revision
    try {
      const configuredVideos = Object.entries(config.models.get())
      const configuredImages = Object.entries(config.imageModels.get())
      const configuredSpeech = Object.entries(config.audioModels.get())
      for (const [alias] of [...configuredVideos, ...configuredImages, ...configuredSpeech]) {
        if (!ALIAS.test(alias)) throw new Error('Choose a model alias using lowercase letters, numbers, and hyphens.')
      }
      const [videos, images, speech] = await Promise.all([
        configuredVideos.length === 0 ? [] : client.videoCatalog(lifetime.signal),
        configuredImages.length === 0 ? [] : client.imageCatalog(lifetime.signal),
        configuredSpeech.length === 0 ? [] : client.speechCatalog(lifetime.signal),
      ])
      const next: ModelEntry[] = [...configuredVideos.flatMap(([alias, id]) => {
        const caps = videos.find(row => row.id === id)
        if (caps === undefined) throw new Error(`OpenRouter video model ${id} is unavailable or lacks supported output choices.`)
        return tasks(caps, sendable(caps)).map(task => entry(alias, caps, task))
      }), ...configuredImages.map(([alias, id]) => {
        const caps = images.find(row => row.id === id)
        if (caps === undefined) throw new Error(`OpenRouter image model ${id} is unavailable or offers no raster output.`)
        return imageEntry(alias, caps)
      }), ...configuredSpeech.map(([alias, id]) => {
        const caps = speech.find(row => row.id === id)
        if (caps === undefined) throw new Error(`OpenRouter speech model ${id} is unavailable or offers no speech endpoint.`)
        return speechEntry(alias, caps)
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
        const [data, images, speech] = await Promise.all([client.videoCatalog(request.signal), client.imageCatalog(request.signal),
          client.speechCatalog(request.signal)])
        await sync()
        return Response.json({ data, images, speech, error: registrationError })
      } catch { return Response.json({ error: 'Could not load OpenRouter models. Check the saved API key and connection.' }, { status: 502 }) }
    },
  }), 'OpenRouter model discovery'))
}
