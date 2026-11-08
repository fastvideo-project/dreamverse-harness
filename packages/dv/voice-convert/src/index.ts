/**
 * The Voice component of DreamVerse as the `dvVoiceConvert` Cordis service. It declares the `voice` generation primitive
 * and task `a2a` in the catalog of `@dv/models`, and owns one operation, `voice.convert` (tool `dv_voice_convert`): one
 * speech recording, the `reference` input, spoken again in one allowed voice of the catalog entry whose key the call names.
 * The converted clip keeps the recording's words, timing and intonation and becomes the record's one output with its
 * duration. The `prompt` param holds the words the recording speaks; the model does not read it, and it titles the take
 * and gives a later shot its dialogue text. Each call draws a seed, so every call is a new take and a seed repeats one.
 * The operation exists while the catalog holds a model of task `a2a`.
 *
 * @module @fastvideo/dreamverse-voice-convert
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineGeneration, importOne, quotePrompt, type RequestInput } from '@dv/generation'
import type { AssetId, OperationContext, OperationResult, ProjectRecord } from '@dv/project'

declare module '@dv/models' {
  interface PrimitiveTypes {
    voice: {
      modality: 'audio'
      facts: VoiceModelFacts
      request: VoiceRequest
      result: Promise<ConvertedVoice>
      entry: Record<never, never>
    }
  }
  interface TaskMap {
    a2a: 'voice'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Voice component: one converted clip per `voice.convert` call. */
    dvVoiceConvert: DvVoiceConvert
  }
}

/** The facts of a voice entry that a request is built from. */
export interface VoiceModelFacts {
  /** The backend's model ID, which the record report keeps (`model_id`). */
  modelId: string
}

/** One conversion request: the recording, the voice to speak it in, and the seed. */
export interface VoiceRequest {
  /** The recording to convert; null while the record that produces it has not finished. */
  speech: AssetId | null
  /** The key of one voice that the entry's `schema()` lists. */
  voice: string
  seed: number
  /** Values of the model's own parameters, which the entry's `schema()` describes. */
  extra: Record<string, unknown>
}

/** One converted clip with its duration, read from the audio the backend returned. */
export interface ConvertedVoice {
  bytes: Uint8Array
  mime: 'audio/wav'
  durationSec: number
}

function voiceRequest(params: Record<string, unknown>, inputs: readonly RequestInput[], seed: number): VoiceRequest {
  const voice = typeof params['voice'] === 'string' ? params['voice'].trim() : ''
  if (voice === '') throw new Error('The voice is empty; name one voice that dv_models_get lists for the model.')
  const speech = inputs.filter(input => input.role === 'reference')
  if (speech.length !== 1) throw new Error('voice.convert takes exactly one speech recording in inputs.reference.')
  return { speech: (speech[0] as RequestInput).resolved_asset, voice, seed, extra: (params['extra'] ?? {}) as Record<string, unknown> }
}

async function storeVoice(_ctx: Context, run: OperationContext, result: Promise<ConvertedVoice>,
  facts: VoiceModelFacts, request: VoiceRequest): Promise<OperationResult> {
  const clip = await result
  const asset = importOne(run, { bytes: clip.bytes, mime: clip.mime, durationSec: clip.durationSec })
  return { outputs: [asset], report: { model_id: facts.modelId, voice: request.voice, duration_sec: clip.durationSec } }
}

function summarize(record: ProjectRecord): string {
  const duration = record.report?.['duration_sec']
  return `voice ${String(record.params['voice']).trim()} ${quotePrompt(String(record.params['prompt']), 60)} `
    + `(${typeof duration === 'number' ? duration.toFixed(1) : '?'}s)`
}

/** The Voice service: the `voice.convert` operation and the `GenerationApi` methods for workflows. */
export default class DvVoiceConvert extends defineGeneration({
  service: 'dvVoiceConvert',
  component: 'voice',
  operation: 'voice.convert',
  primitive: 'voice',
  tasks: { a2a: { zh: '音色转换', en: 'Voice conversion' } },
  label: { zh: '转换音色', en: 'Convert voice' },
  description: 'Speak one speech recording again in an allowed voice with an a2a model from dv_models_list; modality, task, '
    + 'provider and model name it and are required. dv_models_get lists the model\'s voices; voice names one of them. The '
    + 'converted clip keeps the recording\'s words, timing and intonation, so use it as the dialogue track of a shot, '
    + 'reused unchanged. The clip is the one output; the result gives its duration. You cannot hear the clip, so ask the '
    + 'user which take to keep. Every call is a new take; the same seed repeats one.',
  params: {
    prompt: {
      type: 'string', required: true,
      description: 'The words the recording speaks, as plain text. The model does not read them; they title the take and '
        + 'are the dialogue text of a shot that uses it.',
    },
    voice: {
      type: 'string', required: true,
      description: 'The key of one voice that dv_models_get lists for the model.',
    },
  },
  inputs: {
    reference: { type: 'audio', required: true, description: 'The speech recording to convert, such as the user\'s own reading of the line.' },
  },
  outputs: [{ role: 'audio', type: 'audio' }],
  toRequest: (_facts, params, inputs, seed) => voiceRequest(params, inputs, seed),
  toOutputs: storeVoice,
  summarize,
}) {}
