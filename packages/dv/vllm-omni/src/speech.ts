/**
 * The `t2a` entries of `@dv/vllm-omni`. An entry reads the voices of its server from `GET /v1/audio/voices`, refuses a
 * voice that the server does not list, and renders one WAV clip per request through `POST /v1/audio/speech`, with the
 * duration from the `x-audio-duration-seconds` header.
 *
 * @module @dv/vllm-omni/speech
 */
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { AudioModelFacts, AudioRequest, GeneratedAudio } from '@dv/audio-generate'
import type { ModelEntry } from '@dv/models'
import { checkServed, post, send } from './http.ts'

/** One speech model that the plugin serves: the rules that no vLLM-Omni endpoint lists. */
interface ServedSpeech {
  /** The ID that the server lists in `GET /v1/models`. */
  modelId: string
  description: string
  /** The request fields that the agent may set in `extra`, as the server names them; `voice` is checked against the
   *  voices that the server lists. */
  extra: ParameterSchemaSpec
}

/** The speech models that the plugin serves, by model name. */
export const SPEECHES: Record<string, ServedSpeech> = {
  'qwen3-tts-customvoice': {
    modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    description: 'Qwen3-TTS 1.7B CustomVoice: speech from text in ten languages with a choice of preset voices, and a '
      + 'style instruction such as "speak slowly and sadly". One voice per clip; it makes no sound effects or music.',
    extra: {
      voice: { type: 'string', description: 'A voice from voices; the server picks its default voice without one.' },
      language: {
        type: 'string', description: 'The language of the text; Auto detects it.',
        enum: ['Auto', 'Chinese', 'English', 'Japanese', 'Korean', 'German', 'French', 'Russian', 'Portuguese', 'Spanish', 'Italian'],
      },
      instructions: { type: 'string', description: 'How to speak: emotion, pace and tone, in plain words; at most 500 characters.' },
      speed: { type: 'number', description: 'Playback speed from 0.25 to 4; 1 is normal.' },
    },
  },
}

const RIFF = Buffer.from('RIFF', 'latin1')

/**
 * Read the preset voices that a server lists. The server lists uploaded voices too, but an uploaded voice is a
 * voice-cloning input that only a Base checkpoint speaks, so the result leaves them out.
 * @returns the preset voice names.
 * @throws as `send` throws.
 */
async function voices(baseUrl: string): Promise<string[]> {
  const listed = await (await send(baseUrl, '/v1/audio/voices')).json() as { voices: string[]; uploaded_voices: Array<{ id: string }> }
  // `voices` lists an uploaded voice by its lowercase `id`, not by the `name` it was uploaded with.
  const uploaded = new Set(listed.uploaded_voices.map(voice => voice.id))
  return listed.voices.filter(name => !uploaded.has(name))
}

/**
 * The problems of one request, each one agent-facing sentence: the `extra` names that the model does not take, each
 * `extra` value that fails its schema, and a voice that the server does not list.
 * @throws as `send` throws, when the request names a voice.
 */
async function problems(served: ServedSpeech, baseUrl: string, request: AudioRequest): Promise<string[]> {
  const known = Object.keys(served.extra)
  const unknown = Object.keys(request.extra).filter(name => !known.includes(name))
  const found = [
    ...unknown.length === 0 ? [] : [`This model takes no extra parameter ${unknown.join(', ')}; it takes ${known.join(', ')}.`],
    ...validateArgs(served.extra, request.extra).map(message => `extra.${message}.`),
  ]
  // ParameterSchemaSpec has no numeric range or length limit, and the server answers a speed outside 0.25 to 4 and
  // instructions over its default limit of 500 code points, which Array.from counts, with HTTP 400.
  const { speed, instructions, voice } = request.extra
  if (typeof speed === 'number' && !(speed >= 0.25 && speed <= 4)) found.push('extra."speed" must be from 0.25 to 4.')
  if (typeof instructions === 'string' && Array.from(instructions).length > 500) found.push('extra."instructions" must be at most 500 characters.')
  if (typeof voice === 'string') {
    const listed = await voices(baseUrl)
    // The server compares voice names in lowercase.
    if (!listed.includes(voice.toLowerCase())) found.push(`The server has no voice ${JSON.stringify(voice)}; it has ${listed.join(', ')}.`)
  }
  return found
}

/**
 * Speak one request through `POST /v1/audio/speech`.
 * @returns the WAV clip and the duration that the server reports.
 * @throws Error when the server cut the clip at its token budget, or answered without a WAV body or a positive
 *   duration; else as `post` throws.
 */
async function speak(baseUrl: string, served: ServedSpeech, request: AudioRequest, signal?: AbortSignal): Promise<GeneratedAudio> {
  const route = '/v1/audio/speech'
  const answer = await post(baseUrl, route, {
    ...request.extra, model: served.modelId, input: request.prompt, response_format: 'wav',
  }, signal)
  const bytes = new Uint8Array(await answer.arrayBuffer())
  if (answer.headers.get('x-audio-truncated') === 'true') {
    throw new Error('The server stopped the clip at its token budget before the text ended; split the text into shorter clips.')
  }
  if (!Buffer.from(bytes.subarray(0, RIFF.length)).equals(RIFF)) throw new Error(`The server at ${baseUrl} answered POST ${route} with a body that is not a WAV file.`)
  const duration = answer.headers.get('x-audio-duration-seconds')
  const durationSec = Number(duration ?? Number.NaN)
  if (!(durationSec > 0)) {
    throw new Error(`The server at ${baseUrl} answered POST ${route} with x-audio-duration-seconds `
      + `${JSON.stringify(duration)}, not a positive number of seconds.`)
  }
  return { bytes, mime: 'audio/wav', durationSec }
}

/**
 * The catalog entry of one speech model.
 * @param model - a model name of `SPEECHES`.
 * @param served - the rules of the model.
 * @param baseUrl - the HTTP base URL of the server of the model.
 * @returns the `t2a` entry.
 */
export function speechEntry(model: string, served: ServedSpeech, baseUrl: string): ModelEntry<'t2a'> {
  return {
    modality: 'audio', task: 't2a', provider: 'vllm-omni', model, description: served.description,
    async facts(): Promise<AudioModelFacts> {
      await checkServed(baseUrl, served.modelId)
      return { modelId: served.modelId }
    },
    async schema(): Promise<JsonValue> {
      await checkServed(baseUrl, served.modelId)
      return { voices: await voices(baseUrl), extra: JSON.parse(JSON.stringify(served.extra)) as JsonValue }
    },
    validateGenerationRequest: request => problems(served, baseUrl, request),
    render: (request, signal) => speak(baseUrl, served, request, signal),
  }
}
