/**
 * The Audio component of DreamVerse as the `dvAudioGenerate` Cordis service. It declares the `audio` generation
 * primitive and task `t2a` in the catalog of `@dv/models`, and owns one operation, `audio.generate` (tool
 * `dv_audio_generate`): one audio clip from a prompt, rendered by the catalog entry whose key the call names. The prompt
 * is the text to speak in the model's own markup, which the model's prompt skill describes. The clip becomes the
 * record's one output with its duration. The operation has no seed, because the speech backends draw their own; every
 * call is a new take. The operation exists while the catalog holds a model of task `t2a`.
 *
 * @module @dv/audio-generate
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineGeneration, importOne, quotePrompt } from '@dv/generation'
import type { OperationContext, OperationResult, ProjectRecord } from '@dv/project'

declare module '@dv/models' {
  interface PrimitiveTypes {
    audio: {
      modality: 'audio'
      facts: AudioModelFacts
      request: AudioRequest
      result: Promise<GeneratedAudio>
      entry: Record<never, never>
    }
  }
  interface TaskMap {
    t2a: 'audio'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Audio component: one clip per `audio.generate` call. */
    dvAudioGenerate: DvAudioGenerate
  }
}

/** The facts of an audio entry that a request is built from. */
export interface AudioModelFacts {
  /** The backend's model ID, which the record report keeps (`model_id`). */
  modelId: string
}

/** One audio request: the text to speak in the model's markup, and the model's own parameters. */
export interface AudioRequest {
  prompt: string
  /** Values of the model's own parameters, which the entry's `schema()` describes. */
  extra: Record<string, unknown>
}

/**
 * One rendered clip. Its duration is required, because generated assets are never probed and an audio asset without a
 * duration shows none on the canvas and in the agent's tool result.
 */
export interface GeneratedAudio {
  bytes: Uint8Array
  mime: 'audio/wav'
  /** The clip's length in seconds, read from the audio the backend returned. */
  durationSec: number
}

function audioRequest(params: Record<string, unknown>): AudioRequest {
  const prompt = typeof params['prompt'] === 'string' ? params['prompt'].trim() : ''
  if (prompt === '') throw new Error('The prompt is empty; write the text to speak.')
  return { prompt, extra: (params['extra'] ?? {}) as Record<string, unknown> }
}

async function storeAudio(_ctx: Context, run: OperationContext, result: Promise<GeneratedAudio>,
  facts: AudioModelFacts): Promise<OperationResult> {
  const clip = await result
  const asset = importOne(run, { bytes: clip.bytes, mime: clip.mime, durationSec: clip.durationSec })
  return { outputs: [asset], report: { model_id: facts.modelId, duration_sec: clip.durationSec } }
}

function summarize(record: ProjectRecord): string {
  const duration = record.report?.['duration_sec']
  return `audio ${quotePrompt(String(record.params['prompt']), 60)} (${typeof duration === 'number' ? duration.toFixed(1) : '?'}s)`
}

/** The Audio service: the `audio.generate` operation and the `GenerationApi` methods for workflows. */
export default class DvAudioGenerate extends defineGeneration({
  service: 'dvAudioGenerate',
  component: 'audio',
  operation: 'audio.generate',
  primitive: 'audio',
  tasks: { t2a: { zh: '文字生成音频', en: 'Audio from text' } },
  label: { zh: '生成音频', en: 'Generate audio' },
  description: 'Generate one audio clip from the prompt with a t2a model from dv_models_list; modality, task, provider '
    + 'and model name it and are required. Before the first call for a model, load the prompt skill that dv_models_list '
    + 'names for it, because the prompt is written in the model\'s own markup. dv_models_get lists the model\'s own '
    + 'parameters for extra. The clip is the one output; the result gives its duration. You cannot hear the clip, so '
    + 'ask the user which take to keep. Every call is a new take, and the same prompt gives a different clip.',
  params: {
    prompt: {
      type: 'string', required: true,
      description: 'The text to speak, in the markup of the prompt skill that dv_models_list names for the model.',
    },
  },
  inputs: {},
  outputs: [{ role: 'audio', type: 'audio' }],
  seed: false,
  toRequest: (_facts, params) => audioRequest(params),
  toOutputs: storeAudio,
  summarize,
}) {}
