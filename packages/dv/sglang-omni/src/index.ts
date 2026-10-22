/**
 * Provider plugin `sglang-omni` of DreamVerse for speech models on local SGLang-Omni servers, each for task `t2a`. It
 * registers into `ctx.dvModels` one entry per model that its `models` config names. Each entry checks on every
 * `facts()` and `schema()` that its server serves the expected model, because the server ignores the `model` field of a
 * request; it describes its speakers and `extra` parameters in `schema()`, refuses before any record a speaker tag the
 * server would refuse, a prompt with no text besides its speaker tags, and unknown or invalid `extra` values, and
 * renders one WAV clip with its duration per request through `POST /v1/audio/speech`. Each entry carries the prompt
 * skill of its model, which the catalog registers.
 *
 * Served models: `fish-audio-drama-3` (Fish Audio Drama 3, `fishaudio/drama-3`).
 *
 * @module @dv/sglang-omni
 */
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type { AudioModelFacts, AudioRequest, GeneratedAudio } from '@dv/audio-generate'
import type { ModelEntry } from '@dv/models'

/** The server of one model and its GPU rate. */
export interface ModelServer {
  /** HTTP base URL of the SGLang-Omni server, such as `http://127.0.0.1:8000`. */
  baseUrl: string
  /** GPU seconds of one clip on this server, for the GPU estimate before a call runs. */
  gpuSecondsPerCall: number
}

/** `dv-sglang-omni` configuration. */
export interface Config {
  /** The models to register, by model name, each with its server. */
  models: Record<string, ModelServer>
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  models: z.dict(z.object({ baseUrl: z.string().required(), gpuSecondsPerCall: z.number().required() })).required(),
})

/** One served speech model: its server ID, its catalog text, its speakers, its `extra` parameters and its prompt skill. */
interface ServedSpeechModel {
  /** The ID the server reports in `GET /v1/models`. */
  modelId: string
  description: string
  /** The speaker numbers of `<|speaker:N|>` tags that the server speaks; `schema()` and the speaker refusal read it. */
  speakers: readonly number[]
  /** The request fields the agent may set in `extra`, as the server names them. */
  extra: ParameterSchemaSpec
  skill: { name: string; description: string; file: string }
}

/** A speaker tag of the model's markup, well-formed or not; the server refuses a malformed one. */
const SPEAKER_TAG = /<\|speaker[^|]*\|>/gu

/** The models this plugin can serve. */
const SERVED: Record<string, ServedSpeechModel> = {
  'fish-audio-drama-3': {
    modelId: 'fishaudio/drama-3',
    description: 'Fish Audio Drama 3: expressive speech from text in many languages, with sound events such as laughs and '
      + 'sighs written into the text.',
    speakers: [0],
    extra: { speed: { type: 'number', description: 'Speaking rate; 1 is normal.' } },
    skill: {
      name: 'fish-audio-drama-3-prompting',
      description: 'Prompt markup of model fish-audio-drama-3 for task t2a: speaker tags, sound events, clip length, and voices.',
      file: 'fish-audio-drama-3-prompting.md',
    },
  },
}

/** Plugin name. */
export const name = 'dv-sglang-omni'

/** Required services: the model catalog. */
export const inject = ['dvModels']

/** The text of an error answer: `error.message` of an `application/json` body, else `detail`, else the body as sent. */
async function errorText(response: Response): Promise<string> {
  const text = await response.text()
  if (response.headers.get('content-type') !== 'application/json') return text
  let body: { error?: { message?: unknown }; detail?: unknown } | null
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    // A body that is not JSON despite its content type is shown as sent.
    return text
  }
  const message = body?.error?.message ?? body?.detail
  return typeof message === 'string' ? message : text
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
  } catch {
    if (init.signal?.aborted === true) throw init.signal.reason
    throw new Error(`The server at ${baseUrl} cannot be reached.`)
  }
  if (!response.ok) throw new Error(`The server at ${baseUrl} answered ${init.method ?? 'GET'} ${route} with HTTP ${String(response.status)}: ${await errorText(response)}`)
  return response
}

/**
 * Check that the server lists `modelId`.
 * @throws Error when the server cannot be reached, answers with an error, or serves another model.
 */
async function checkServed(baseUrl: string, modelId: string): Promise<void> {
  const { data } = await (await call(baseUrl, '/v1/models')).json() as { data: Array<{ id: string }> }
  const ids = data.map(model => model.id)
  if (!ids.includes(modelId)) {
    throw new Error(`The server at ${baseUrl} serves ${ids.join(', ')}, not ${modelId}; the dv-sglang-omni config points `
      + 'this model at the wrong server.')
  }
}

/**
 * The duration of a PCM WAV file from its header: the size of its `data` chunk divided by the byte rate of its `fmt `
 * chunk. It walks the chunks by their sizes, with the pad byte of an odd size, so a chunk such as `LIST` before `data`
 * is skipped, and it stops at a chunk that the bytes do not hold in full.
 * @returns the seconds; null when the bytes are not RIFF/WAVE or hold no complete `data` chunk after a `fmt ` chunk of at
 *   least the 16 bytes of PCM.
 */
function wavDurationSec(wav: Uint8Array): number | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (at: number): string => String.fromCharCode(...wav.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let byteRate = 0
  for (let at = 12; at + 8 <= wav.byteLength;) {
    const size = view.getUint32(at + 4, true)
    if (at + 8 + size > wav.byteLength) return null
    if (tag(at) === 'fmt ') byteRate = size >= 16 ? view.getUint32(at + 16, true) : 0
    if (tag(at) === 'data') return byteRate > 0 ? size / byteRate : null
    at += 8 + size + size % 2
  }
  return null
}

/**
 * Speak one request through `POST /v1/audio/speech`.
 * @returns the WAV clip, its duration from its header, and the request's wall-clock seconds as its GPU seconds.
 * @throws Error when the clip stopped at the length limit (`x-finish-reason` `length`), when `x-finish-reason` is
 *   missing or another value than `stop`, when the body is not a WAV file with a duration or holds no samples, or as
 *   `call` throws.
 */
async function speak(baseUrl: string, request: AudioRequest, signal?: AbortSignal): Promise<GeneratedAudio> {
  const started = performance.now()
  const response = await call(baseUrl, '/v1/audio/speech', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...request.extra, input: request.prompt, response_format: 'wav' }),
    ...signal === undefined ? {} : { signal },
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  const finish = response.headers.get('x-finish-reason')
  if (finish === 'length') throw new Error('The server stopped the clip at its length limit before the text ended; split the text into shorter clips.')
  if (finish !== 'stop') {
    throw new Error(`The server at ${baseUrl} answered POST /v1/audio/speech with x-finish-reason ${JSON.stringify(finish)}, not "stop", `
      + 'so the clip may not hold the whole text.')
  }
  const durationSec = wavDurationSec(bytes)
  if (durationSec === null) throw new Error(`The server at ${baseUrl} answered POST /v1/audio/speech with a body that is not a WAV file.`)
  if (durationSec === 0) throw new Error(`The server at ${baseUrl} answered POST /v1/audio/speech with an empty WAV clip.`)
  return { bytes, mime: 'audio/wav', durationSec, gpuSeconds: (performance.now() - started) / 1000 }
}

/**
 * The problems of a request, one per check that holds, in this order: the speaker tags the server does not speak, no
 * text besides the speaker tags (the server answers that prompt with HTTP 200 and a near-silent clip), the `extra`
 * names the model does not take, and each `extra` value that fails its schema.
 */
function requestProblems(served: ServedSpeechModel, request: AudioRequest): string[] {
  const allowed = served.speakers.map(speaker => `<|speaker:${String(speaker)}|>`)
  const refused = [...new Set(request.prompt.match(SPEAKER_TAG))].filter(tag => !allowed.includes(tag))
  const known = Object.keys(served.extra)
  const unknown = Object.keys(request.extra).filter(key => !known.includes(key))
  return [
    ...refused.length === 0 ? [] : [`This server speaks only ${allowed.join(', ')}, and the prompt has ${refused.join(', ')}. `
      + `Write one clip per character, each with ${allowed.join(', ')} or no speaker tag.`],
    ...request.prompt.replace(SPEAKER_TAG, '').trim() !== '' ? []
      : ['The prompt has no text to speak besides its speaker tags; write the words to speak after the tag.'],
    ...unknown.length === 0 ? [] : [`This model takes no extra parameter ${unknown.join(', ')}; it takes ${known.join(', ')}.`],
    ...validateArgs(served.extra, request.extra).map(message => `extra.${message}`),
  ]
}

/**
 * A catalog entry for one configured model.
 * @throws Error when `SERVED` has no such model.
 */
function modelEntry(model: string, server: ModelServer): ModelEntry<'t2a'> {
  const served = SERVED[model]
  if (served === undefined) throw new Error(`dv-sglang-omni serves no model "${model}"; it serves: ${Object.keys(SERVED).join(', ')}.`)
  return {
    modality: 'audio',
    task: 't2a',
    provider: 'sglang-omni',
    model,
    description: served.description,
    gpuSecondsPerCall: server.gpuSecondsPerCall,
    promptSkill: {
      name: served.skill.name, description: served.skill.description,
      content: readFileSync(new URL(`../skills/${served.skill.file}`, import.meta.url), 'utf8'),
    },
    async facts(): Promise<AudioModelFacts> {
      await checkServed(server.baseUrl, served.modelId)
      return { modelId: served.modelId }
    },
    async schema(): Promise<JsonValue> {
      await checkServed(server.baseUrl, served.modelId)
      return { speakers: [...served.speakers], extra: JSON.parse(JSON.stringify(served.extra)) as JsonValue }
    },
    validateGenerationRequest: (request: AudioRequest) => Promise.resolve(requestProblems(served, request)),
    render: (request: AudioRequest, signal?: AbortSignal) => speak(server.baseUrl, request, signal),
  }
}

/**
 * Register one entry into `ctx.dvModels` per configured model.
 * @throws Error when the config names a model this plugin does not serve.
 */
export function apply(ctx: Context, config: Config): void {
  const entries = Object.entries(config.models).map(([model, server]) => modelEntry(model, server))
  for (const entry of entries) ctx.effect(() => ctx.dvModels.register(entry), `dvModels ${entry.model} t2a`)
}
