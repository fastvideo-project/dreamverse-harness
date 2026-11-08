/**
 * Provider plugin `seed-vc` of DreamVerse for voice conversion on a Seed-VC server (`server/seed-vc-server.py` of
 * `@fastvideo/dreamverse-voice-acting`).
 * It registers one entry, model `seed-vc-v1` of task `a2a`, into `ctx.dvModels`. The config's `voices` are the only
 * voices the entry converts to: each names its label and a note on the permission to use it, and either a target clip,
 * a WAV file that the plugin reads at load and fails there when it is missing or empty, or nothing more, and then the
 * server builds the clip from the VoxCeleb1 clips of the speaker of that name on the voice's first conversion
 * (`POST /v1/voices/build`). The plugin sends the target clip with every request; the server keeps no voice list.
 * Each entry checks on every `facts()` and `schema()` that the server serves Seed-VC v1; it lists the voices and the
 * `extra` parameters in `schema()`, refuses before any record a voice outside the config, a `reference` input that is not
 * audio, and unknown or invalid `extra` values, and converts one recording per request through `POST /v1/convert`, with
 * the configured `diffusionSteps` unless `extra` sets `diffusion_steps`.
 *
 * @module @fastvideo/dreamverse-seed-vc
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type {} from '@dv/asset-pool'
import type { ModelEntry } from '@dv/models'
import type { ConvertedVoice, VoiceModelFacts, VoiceRequest } from '@fastvideo/dreamverse-voice-convert'

/** One allowed voice. */
export interface Voice {
  /** The name the voice picker and the agent show, such as `Miles Teller`. */
  label: string
  /** Who allowed this voice to be used, and for what. */
  note: string
  /**
   * Absolute path of a WAV clip of the voice: clean speech of one speaker, 10 to 25 seconds. Without it, the server builds
   * the clip from the VoxCeleb1 clips of the speaker named `speaker`.
   */
  target?: string
  /** The speaker's name in VoxCeleb1, for a voice without `target`; default `label`. */
  speaker?: string
}

/** `dv-seed-vc` configuration. */
export interface Config {
  /** HTTP base URL of the Seed-VC server, such as `http://127.0.0.1:8010`. */
  baseUrl: string
  /** The allowed voices by key, such as `jk-simmons`. A voice not listed here cannot be used. */
  voices: Record<string, Voice>
  /** Refinement steps of a conversion whose `extra` sets none, 1 to 200; default 50. */
  diffusionSteps: number
  /** Seconds of speech in a target clip that the server builds, 4 to 25; default 16. */
  targetSeconds: number
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  voices: z.dict(z.object({
    label: z.string().required(), note: z.string().required(), target: z.string(), speaker: z.string(),
  })).required(),
  diffusionSteps: z.natural().min(1).max(200).default(50),
  targetSeconds: z.natural().min(4).max(25).default(16),
})

export const name = 'dv-seed-vc'

export const inject = ['dvModels', 'dvAssetPool']

/** The model name of the catalog entry. */
const MODEL = 'seed-vc-v1'

/** The model ID that `GET /health` of the Seed-VC server of `@fastvideo/dreamverse-voice-acting` reports. */
const MODEL_ID = 'seed-vc-v1-whisper-small-wavenet'

/**
 * The request fields the agent may set in `extra`, as the server names them.
 * @param steps - the configured steps of a conversion whose `extra` sets none.
 * @returns the parameter schema.
 */
function extraSchema(steps: number): ParameterSchemaSpec {
  return {
    diffusion_steps: {
      type: 'integer', description: `Refinement steps, 1 to 200; ${String(steps)} when omitted. More steps are slower and change the take little.`,
    },
  }
}

/** The text of an error answer: `error` of an `application/json` body, else the body as sent. */
async function errorText(response: Response): Promise<string> {
  const text = await response.text()
  if (response.headers.get('content-type') !== 'application/json') return text
  let body: { error?: unknown } | null
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return text
  }
  return typeof body?.error === 'string' ? body.error : text
}

/**
 * Send one request to the server.
 * @throws the signal's reason on abort; else Error naming the method, the route and the HTTP status with the server's
 *   text, or the unreachable server.
 */
async function call(baseUrl: string, route: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(new URL(route, baseUrl), init)
  } catch (error) {
    if (init.signal?.aborted === true) throw init.signal.reason
    throw new Error(`The server at ${baseUrl} cannot be reached.`, { cause: error })
  }
  if (!response.ok) throw new Error(`The server at ${baseUrl} answered ${init.method ?? 'GET'} ${route} with HTTP ${String(response.status)}: ${await errorText(response)}`)
  return response
}

async function checkServed(baseUrl: string): Promise<void> {
  const { model } = await (await call(baseUrl, '/health')).json() as { model?: unknown }
  if (model !== MODEL_ID) {
    throw new Error(`The server at ${baseUrl} serves ${String(model)}, not ${MODEL_ID}; the dv-seed-vc baseUrl points at the wrong server.`)
  }
}

/** A base64 `data:` URI of a WAV file or another audio file. */
function dataUri(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/**
 * Read every configured target clip once, so a missing or empty file fails at load.
 * @throws Error naming the voice and its path.
 */
function readTargets(voices: Record<string, Voice>): Map<string, string> {
  const targets = new Map<string, string>()
  for (const [key, voice] of Object.entries(voices)) {
    if (voice.target === undefined) continue
    let bytes: Buffer
    try {
      bytes = readFileSync(voice.target)
    } catch (error) {
      throw new Error(`dv-seed-vc voice "${key}" has no readable target clip at ${voice.target}.`, { cause: error })
    }
    if (bytes.length === 0) throw new Error(`dv-seed-vc voice "${key}" has an empty target clip at ${voice.target}.`)
    targets.set(key, dataUri('audio/wav', bytes))
  }
  return targets
}

/**
 * Ask the server to build a speaker's target clip from VoxCeleb1 through `POST /v1/voices/build`.
 * @returns the clip as a `data:` URI.
 * @throws Error as `call` throws, such as HTTP 404 for a name that VoxCeleb1 does not hold.
 */
async function buildTarget(baseUrl: string, speaker: string, seconds: number, signal?: AbortSignal): Promise<string> {
  const response = await call(baseUrl, '/v1/voices/build', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: speaker, seconds }),
    ...signal === undefined ? {} : { signal },
  })
  return dataUri('audio/wav', Buffer.from(await response.arrayBuffer()))
}

/**
 * The catalog entry of Seed-VC v1.
 * @param ctx - the plugin context; `render` reads the recording from `ctx.dvAssetPool`.
 * @param config - the server and the allowed voices.
 * @returns the entry.
 */
function modelEntry(ctx: Context, config: Config): ModelEntry<'a2a'> {
  const files = readTargets(config.voices)
  const keys = Object.keys(config.voices)
  const extraSpec = extraSchema(config.diffusionSteps)
  // A built clip is asked for once and kept; a failed build is forgotten, so the next conversion asks again.
  const built = new Map<string, Promise<string>>()
  const target = (key: string, signal?: AbortSignal): Promise<string> => {
    const file = files.get(key)
    if (file !== undefined) return Promise.resolve(file)
    const voice = config.voices[key] as Voice
    let pending = built.get(key)
    if (pending === undefined) {
      pending = buildTarget(config.baseUrl, voice.speaker ?? voice.label, config.targetSeconds, signal)
      pending.catch(() => { built.delete(key) })
      built.set(key, pending)
    }
    return pending
  }
  return {
    modality: 'audio',
    task: 'a2a',
    provider: 'seed-vc',
    model: MODEL,
    description: 'Seed-VC v1: speaks a speech recording again in another voice, keeping its words, timing and intonation; '
      + `voices: ${keys.map(key => `${key} (${(config.voices[key] as Voice).label})`).join(', ')}.`,
    async facts(): Promise<VoiceModelFacts> {
      await checkServed(config.baseUrl)
      return { modelId: MODEL_ID }
    },
    async schema(): Promise<JsonValue> {
      await checkServed(config.baseUrl)
      return {
        voices: keys.map(key => ({ key, label: (config.voices[key] as Voice).label })),
        extra: JSON.parse(JSON.stringify(extraSpec)) as JsonValue,
      }
    },
    validateGenerationRequest(request: VoiceRequest): Promise<string[]> {
      const unknown = Object.keys(request.extra).filter(key => !(key in extraSpec))
      return Promise.resolve([
        ...keys.includes(request.voice) ? [] : [`This model has no voice "${request.voice}"; its voices are ${keys.join(', ')}.`],
        ...request.speech === null || ctx.dvAssetPool.mediaType(request.speech) === 'audio' ? []
          : [`The reference input ${request.speech} is not audio; give one recording of the spoken line.`],
        ...unknown.length === 0 ? [] : [`This model takes no extra parameter ${unknown.join(', ')}; it takes ${Object.keys(extraSpec).join(', ')}.`],
        ...validateArgs(extraSpec, request.extra).map(message => `extra.${message}.`),
      ])
    },
    async render(request: VoiceRequest, signal?: AbortSignal): Promise<ConvertedVoice> {
      /* v8 ignore next -- the Voice component runs the model only after every input has its asset. */
      if (request.speech === null) throw new Error('voice.convert ran without its speech recording.')
      const { mime } = ctx.dvAssetPool.get(request.speech)
      const source = dataUri(mime, await readFile(ctx.dvAssetPool.path(request.speech)))
      const voiceTarget = await target(request.voice, signal)
      const response = await call(config.baseUrl, '/v1/convert', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          diffusion_steps: config.diffusionSteps, ...request.extra, source, target: voiceTarget, seed: request.seed,
        }),
        ...signal === undefined ? {} : { signal },
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      const durationSec = Number(response.headers.get('x-duration-sec'))
      if (!(durationSec > 0)) throw new Error(`The server at ${config.baseUrl} answered POST /v1/convert without a positive x-duration-sec.`)
      return { bytes, mime: 'audio/wav', durationSec }
    },
  }
}

/**
 * Register the Seed-VC v1 entry into `ctx.dvModels`.
 * @throws Error when the config lists no voice, or a voice's target clip is missing or empty.
 */
export function apply(ctx: Context, config: Config): void {
  if (Object.keys(config.voices).length === 0) throw new Error('dv-seed-vc lists no voice; add at least one to voices.')
  const entry = modelEntry(ctx, config)
  ctx.effect(() => ctx.dvModels.register(entry), `dvModels ${MODEL} a2a`)
}
