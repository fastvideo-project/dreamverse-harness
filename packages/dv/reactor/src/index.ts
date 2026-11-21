/** Register Reactor video models through the DreamVerse model catalog. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import { assertModelAlias, catalogFailure, catalogMissingKey, registerAccountRoute, syncModelEntries, type ModelEntry, type RenderModelFacts, type RenderRequest, type RenderStreamEvent } from '@dv/models'
import { citedAsset, citedInput, replacePromptCitations, type AssetId } from '@dv/project'
import { checkAccess, listModels, ReactorCatalogError, readBalance } from './catalog.ts'
import { capture, type ClipRequest, type Upload } from './client.ts'
import { generateClip } from './generations.ts'
import type { ReactorModelConfig } from './types.ts'
import { profileFor, profiles, type ProfileName, type Workflow } from './profiles.ts'
import { checkSdk } from './setup.ts'

type ModelConfig = Omit<ReactorModelConfig, 'profile' | 'durationsSec'> & {
  /** Bundled Reactor command schema for this alias. */
  profile: ProfileName
  /** Supported durations that replace the profile defaults; the schema fills an empty list. */
  durationsSec: readonly number[]
}

const profileNames = Object.keys(profiles) as ProfileName[]
const defaultModels = Object.fromEntries(profileNames.map(profile => [profile, { profile }]))
const catalogProfiles = new Map(profileNames.map(key => [profiles[key].modelId, { key, name: profiles[key].name }] as const))

/** Host runtime, credential reference, and model aliases for the Reactor provider. */
export interface Config {
  /** Python interpreter on the DreamVerse host with reactor-sdk installed; only models that stream through the SDK use it. */
  pythonPath: string
  /** Name resolved by the harness credential store for each render. */
  credentialRef: string
  /**
   * Maximum lifetime of one paid Reactor render, in seconds. A Clip Generation render spans upload, generation and
   * download; an SDK session spans connection, upload, generation, streaming, capture and download. Registered
   * durations are shorter than this value.
   */
  timeoutSeconds: number
  /**
   * HTTPS origin of the Reactor API. It serves the model catalog, Clip Generation requests, the PixVerse saved-step
   * downloads, and the SDK session (`api_url`).
   */
  apiBaseUrl: string
  /** Wait between Clip Generation status polls, in milliseconds, unless Reactor sends a longer `Retry-After`. */
  pollIntervalMs: number
  /** Deadline for one model catalog request, in seconds. */
  catalogTimeoutSeconds: number
  /** Keys are DreamVerse aliases. Each names a published Reactor command schema. */
  models: Volatile<Record<string, ModelConfig>>
}

/** Loader schema for the host runtime and model aliases. */
export const Config = z.object({
  pythonPath: z.string().min(1).default('python3'),
  credentialRef: z.string().default('REACTOR_API_KEY'),
  timeoutSeconds: z.natural().min(1).max(3600).default(360),
  apiBaseUrl: z.string().default('https://api.reactor.inc'),
  pollIntervalMs: z.natural().min(1).max(60_000).default(5000),
  catalogTimeoutSeconds: z.natural().min(1).max(300).default(30),
  models: z.dict(z.object({
    profile: z.union(profileNames).required(),
    modelId: z.string(),
    durationsSec: z.array(z.number().min(0.001)),
  })).default(defaultModels).volatile(),
})

/** Cordis plugin name. */
export const name = 'dv-reactor'
/** Services that own model registration, input assets, encoding, and credentials. */
export const inject = ['dvModels', 'dvAssetPool', 'dvFfmpeg', 'credentials']

const TYPES = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp']),
  audio: new Set(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/aac', 'audio/mp4', 'audio/x-m4a',
    'audio/ogg', 'audio/opus', 'audio/flac', 'audio/webm']),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
}
type Media = keyof typeof TYPES
const MEDIA = ['image', 'video', 'audio'] as const
const MEDIA_LABEL = { image: 'Picture', audio: 'Audio', video: 'Video' }
const FRAME_INPUT = { max: 1, media_types: { image: { max: 1 } } }

function mediaOf(mime: string): Media | undefined {
  return MEDIA.find(kind => TYPES[kind].has(mime))
}

function countLimits(profile: ReturnType<typeof profileFor>): Record<Media, number> {
  return { image: profile.references?.images ?? 0, audio: profile.references?.audio ?? 0, video: profile.references?.video ?? 0 }
}

function modelFacts(alias: string, config: ModelConfig, timeoutSeconds: number): RenderModelFacts & { durationsSec: number[] } {
  const profile = profileFor(config.profile)
  const modelId = config.modelId ?? profile.modelId
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(modelId)) throw new Error('Reactor model IDs use owner/name.')
  const durationsSec = [...new Set(config.durationsSec.length > 0 ? config.durationsSec : profile.durations)]
    .filter(duration => duration < timeoutSeconds).sort((a, b) => a - b)
  if (durationsSec.length === 0) {
    throw new Error(`Reactor model ${alias} has no duration shorter than timeoutSeconds (${timeoutSeconds}). Raise timeoutSeconds or choose shorter durations.`)
  }
  return {
    modelId, ...profile.geometry, durationsSec, minDurationSec: Math.min(...durationsSec), maxDurationSec: Math.max(...durationsSec),
  }
}

/** Whether Reactor's catalog refused the key with HTTP 401 or 403. */
function isKeyRefused(error: unknown): boolean {
  return error instanceof ReactorCatalogError && (error.status === 401 || error.status === 403)
}

function apiOrigin(value: string): string {
  const url = URL.canParse(value) ? new URL(value) : undefined
  if (url?.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new Error('Configure apiBaseUrl as an HTTPS origin such as https://api.reactor.inc.')
  }
  return url.origin
}

/**
 * Register configured models. Model selection and request validation do not start a paid session.
 * @param ctx - the plugin context.
 * @param config - host interpreter, credential reference, model aliases and the session and catalog deadlines.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.pythonPath.trim() === '') throw new Error('Configure a Python interpreter for Reactor.')
  if (!isCredentialRefName(config.credentialRef)) throw new Error('Configure an environment variable name for the Reactor credential.')
  const keyRef = credentialRef(config.credentialRef)
  const apiBaseUrl = apiOrigin(config.apiBaseUrl)
  const configured = () => Object.entries(config.models.get()).map(([alias, model]) => {
    assertModelAlias(alias, 'Reactor model aliases use lowercase letters, numbers and hyphens.')
    return { alias, profile: profileFor(model.profile), facts: modelFacts(alias, model, config.timeoutSeconds) }
  })
  ctx.inject(['connection'], scope => scope.effect(() => scope.connection.fetch.register({
    path: '/api/dv/reactor/catalog', methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      const credential = await scope.credentials.resolve(keyRef)
      if (credential === undefined) return catalogMissingKey('Reactor')
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(config.catalogTimeoutSeconds * 1000)])
      try {
        const models = await listModels(credential.value, signal, apiBaseUrl)
        const selected = configured()
        return Response.json({ models: models.map((model) => {
          const profile = catalogProfiles.get(model.name)
          return {
            ...model, ...profile === undefined ? {} : { profile: profile.key, displayName: profile.name },
            shotModels: selected.filter(entry => entry.facts.modelId === model.name).map(entry => entry.alias),
          }
        }) })
      } catch (error) {
        return catalogFailure('Reactor', isKeyRefused(error))
      }
    },
  }), 'Reactor model discovery'))
  registerAccountRoute(ctx, {
    provider: 'reactor', description: 'Reactor account status', timeoutSeconds: config.catalogTimeoutSeconds,
    savedKey: async () => (await ctx.credentials.resolve(keyRef))?.value,
    check: async (key, signal) => {
      if (configured().some(entry => entry.profile.workflow.kind !== 'generation')) {
        await checkSdk(config.pythonPath, signal, config.catalogTimeoutSeconds)
      }
      await checkAccess(key, signal, apiBaseUrl)
      return { ...await readBalance(key, signal, apiBaseUrl), limitRemainingUsd: null }
    },
    isRejected: isKeyRefused,
  })
  const lifetime = new AbortController()
  const active = new Set<Promise<unknown>>()
  ctx.effect(() => async () => {
    lifetime.abort(new Error('The Reactor provider was unloaded.'))
    await Promise.allSettled(active)
  }, 'Reactor renders')

  const mimeOf = (asset: AssetId): string => ctx.dvAssetPool.get(asset).mime.replace(/;.*$/, '').trim().toLowerCase()
  const toUpload = (asset: AssetId): Upload => ({
    path: ctx.dvAssetPool.path(asset), mime: mimeOf(asset), name: ctx.dvAssetPool.get(asset).name,
  })

  const generateToFile = async (
    dir: string, apiKey: string, workflow: Extract<Workflow, { kind: 'generation' }>, clip: ClipRequest, signal: AbortSignal,
  ) => {
    const { kind: _kind, ...fields } = workflow
    const { bytes, timings } = await generateClip({
      apiBaseUrl, apiKey, model: clip.model, fields, request: clip, pollMs: config.pollIntervalMs, timeoutSeconds: config.timeoutSeconds,
    }, signal)
    const recording = join(dir, 'generated.mp4')
    await writeFile(recording, bytes, { signal })
    return { recording, timings }
  }

  const entries = ({ alias, profile, facts }: ReturnType<typeof configured>[number]): ModelEntry[] => {
    const { workflow, references } = profile
    const limits = countLimits(profile)
    const durations = facts.durationsSec
    const maxMiB = profile.maxUploadMiB ?? 25
    const hasScene = workflow.kind === 'take' || workflow.kind === 'queue'

    return profile.tasks.map((task): ModelEntry<typeof task> => {
      const first = task === 'i2v' || task === 'fl2v'
      const last = task === 'l2v' || task === 'fl2v'
      const useReferences = task === 'ref2v'
      const optionalFrames = useReferences && references?.keyframes === true
      const mediaTypes = Object.fromEntries(MEDIA.filter(kind => limits[kind] > 0)
        .map(kind => [kind, { max: limits[kind], ...kind === 'image' && references?.imageRequired === true ? { min: 1 } : {} }]))
      const extra = hasScene ? { scene: { type: 'string', description: workflow.kind === 'take'
        ? 'Describe the setting and delivery. The main prompt is the script the avatar speaks.'
        : 'Describe the world that the clip takes place in. Defaults to the shot prompt.' } } : {}

      const problemsOf = (request: RenderRequest): string[] => {
        const problems: string[] = []
        if (request.prompt.trim() === '') problems.push(`${profile.name} requires a prompt.`)
        if (request.durationSec === undefined || !durations.includes(request.durationSec)) {
          problems.push('Choose a duration from the model’s listed duration choices.')
        }
        if (!facts.resolutions.includes(request.resolution ?? '') || !facts.aspectRatios.includes(request.aspectRatio ?? '')) {
          problems.push('Choose an aspect ratio and resolution from the model’s listed choices.')
        }
        if (profile.seed !== false && (!Number.isSafeInteger(request.seed) || request.seed < 0)) {
          problems.push('Choose a nonnegative integer seed.')
        }
        for (const [key, value] of Object.entries(request.extra)) {
          if (!hasScene || key !== 'scene' || typeof value !== 'string') problems.push(`Unsupported extra parameter or value: ${key}.`)
        }
        for (const [field, asset, required] of [
          ['first_frame', request.firstFrame, first], ['last_frame', request.lastFrame, last],
        ] as const) {
          if (asset === null) {
            if (required) problems.push(`This task requires one ${field} image.`)
          } else if (!required && !optionalFrames) problems.push(`This task takes no ${field} input.`)
          else if (!TYPES.image.has(mimeOf(asset)) || ctx.dvAssetPool.get(asset).size_bytes > maxMiB * 1024 * 1024) {
            problems.push(`${field} must be a JPEG, PNG, or WebP no larger than ${maxMiB} MiB.`)
          }
        }
        if (!useReferences) {
          if (request.references.length > 0) problems.push('This task takes no reference assets.')
          return problems
        }

        const counts = { image: 0, audio: 0, video: 0 }
        const total = { audio: 0, video: 0 }
        for (const asset of request.references) {
          const { duration_sec, size_bytes } = ctx.dvAssetPool.get(asset)
          const kind = mediaOf(mimeOf(asset))
          if (kind === undefined || limits[kind] === 0) {
            problems.push(`Reference ${asset} is not a supported media type for ${profile.name}.`)
            continue
          }
          counts[kind]++
          if (kind !== 'image' && duration_sec !== null) {
            total[kind] += duration_sec
            if (duration_sec < 2 || duration_sec > 15) problems.push(`Reference ${asset} must be 2 to 15 seconds long.`)
          }
          if (size_bytes > maxMiB * 1024 * 1024) problems.push(`Reference ${asset} must be no larger than ${maxMiB} MiB.`)
        }
        if (request.references.length === 0) problems.push('This task requires at least one reference.')
        if (counts.image === 0 && references?.imageRequired === true) problems.push('Include at least one reference image.')
        for (const kind of MEDIA) {
          if (counts[kind] > limits[kind]) problems.push(`Use at most ${limits[kind]} ${kind} references.`)
        }
        if (references?.aggregateSeconds === true && (total.audio > 15 || total.video > 15)) {
          problems.push('Keep all audio references and all video references to 15 seconds total per media type.')
        }
        return problems
      }

      const prepareRecording = async (request: RenderRequest, signal: AbortSignal) => {
        signal.throwIfAborted()
        const { durationSec, aspectRatio, resolution } = request
        const problems = problemsOf(request)
        if (problems.length > 0 || durationSec === undefined || aspectRatio === undefined || resolution === undefined) {
          throw new Error(problems.join(' '))
        }
        const credential = await ctx.credentials.resolve(keyRef)
        if (credential === undefined) throw new Error(`Set the Reactor credential ${keyRef} on the DreamVerse host.`)
        const ofKind = (kind: Media): AssetId[] => request.references.filter(asset => mediaOf(mimeOf(asset)) === kind)
        const assets: Record<Media, AssetId[]> = { image: ofKind('image'), audio: ofKind('audio'), video: ofKind('video') }
        let audioOffset = 0
        for (const video of assets.video) {
          if (await ctx.dvAssetPool.hasAudio(video)) audioOffset++
        }
        const prompt = replacePromptCitations(request.prompt, (citation) => {
          const asset = citedAsset(citation.uri)
          if (asset === null) {
            if (profile.labels === 'frame-pictures') {
              const role = citedInput(citation.uri)
              if (role === 'first_frame') return '<Picture 1>'
              if (role === 'last_frame') return request.firstFrame === null ? '<Picture 1>' : '<Picture 2>'
            }
            return citation.label
          }
          for (const kind of MEDIA) {
            const index = assets[kind].indexOf(asset)
            if (index < 0) continue
            const label = `${MEDIA_LABEL[kind]} ${index + 1 + (kind === 'audio' ? audioOffset : 0)}`
            if (workflow.kind === 'queue') return citation.label
            return profile.labels === 'plain' ? label : `<${label}>`
          }
          return citation.label
        })
        signal.throwIfAborted()
        const scene = request.extra['scene']
        const dir = await mkdtemp(join(tmpdir(), 'dv-reactor-'))
        try {
          const clip: ClipRequest = {
            apiBaseUrl, model: facts.modelId, workflow, aspect: aspectRatio, resolution, seconds: durationSec, prompt,
            ...profile.seed === false ? {} : { seed: request.seed },
            ...typeof scene === 'string' ? { scene } : {},
            images: assets.image.map(toUpload), audio: assets.audio.map(toUpload), videos: assets.video.map(toUpload),
            ...request.firstFrame === null ? {} : { firstFrame: toUpload(request.firstFrame) },
            ...request.lastFrame === null ? {} : { lastFrame: toUpload(request.lastFrame) },
          }
          const { recording, timings } = workflow.kind === 'generation'
            ? await generateToFile(dir, credential.value, workflow, clip, signal)
            : await capture(config.pythonPath, dir, credential.value, config.timeoutSeconds, clip, signal)
          signal.throwIfAborted()
          await ctx.dvFfmpeg.run({
            argv: ['ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
              '-movflags', '+faststart', '{{out:video.mp4}}'],
            dir, inputs: [recording], outputs: ['video.mp4'],
          })
          signal.throwIfAborted()
          const output = join(dir, 'video.mp4')
          const { videoDurationSec, durationSec: containerDuration } = await ctx.dvFfmpeg.probe(output)
          const deliveredSeconds = videoDurationSec ?? containerDuration
          if (deliveredSeconds === null || deliveredSeconds <= 0) throw new Error('Reactor returned an empty recording.')
          const bytes = await readFile(output, { signal })
          const png = await ctx.dvFfmpeg.lastFrame(bytes, videoDurationSec)
          return { png, bytes, timings, durationSec: deliveredSeconds }
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      }

      return {
        modality: 'video', provider: 'reactor', hosting: 'managed', model: alias, task, displayName: profile.name,
        description: `${profile.name} on Reactor. ${workflow.kind === 'generation'
          ? 'Reactor runs the clip as a Clip Generation request; cancelling asks Reactor to cancel it.'
          : 'Reactor bills for the session lifetime.'}`
          + (workflow.kind === 'take' ? ' Give the avatar photo as the first frame and the spoken script as the prompt.' : '')
          + (useReferences && references?.imageRequired === true ? ' Include at least one reference image.' : ''),
        facts: () => Promise.resolve(facts),
        schema: () => Promise.resolve({
          duration_sec: { min: facts.minDurationSec, max: facts.maxDurationSec, values: durations },
          aspect_ratios: facts.aspectRatios, resolutions: facts.resolutions,
          inputs: {
            ...useReferences ? { reference: { min: 1, max: limits.image + limits.video + limits.audio, media_types: mediaTypes } } : {},
            ...first || optionalFrames ? { first_frame: { min: Number(first), ...FRAME_INPUT } } : {},
            ...last || optionalFrames ? { last_frame: { min: Number(last), ...FRAME_INPUT } } : {},
          },
          extra,
          seed_supported: profile.seed !== false,
        }),
        validateGenerationRequest: request => Promise.resolve(problemsOf(request)),
        async *render(request, callerSignal): AsyncGenerator<RenderStreamEvent> {
          const signal = callerSignal === undefined ? lifetime.signal : AbortSignal.any([callerSignal, lifetime.signal])
          signal.throwIfAborted()
          const processing = Promise.resolve().then(() => prepareRecording(request, signal))
          active.add(processing)
          const { png, bytes, timings, durationSec } = await processing.finally(() => { active.delete(processing) })
          signal.throwIfAborted()
          yield { kind: 'last_frame', png }
          yield { kind: 'video_start', mime: 'video/mp4' }
          yield { kind: 'chunk', bytes }
          yield { kind: 'done', timings, durationSec }
        },
      }
    })
  }

  syncModelEntries(ctx, {
    label: 'Reactor models',
    conflict: 'Another plugin already registered this Reactor model.',
    groups: () => configured().map(model => ({ id: model.alias, stamp: JSON.stringify(model), entries: () => entries(model) })),
  })
}
