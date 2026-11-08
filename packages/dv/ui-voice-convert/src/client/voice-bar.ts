/**
 * The parameter bar of `voice.convert` in the composer: the voices that the selected model's `schema()` lists, the `@`
 * filter of one audio recording, and the words of a voice take's editor. A schema that the catalog does not know gives
 * no chip and no filter.
 *
 * @module @fastvideo/dreamverse-ui-voice-convert/voice-bar
 */
import type { ParamChip } from '@dv/ui-composer/contract'
import type { GenerationBar } from '@dv/ui-generation/generation-kit.tsx'

/** One voice that a model's schema lists. */
export interface SchemaVoice {
  key: string
  label: string
}

/**
 * The voices of a model's schema, in schema order; none for a schema that is not an object with a `voices` list.
 * @param schema - the model's `schema()`.
 * @returns the voices.
 */
export function schemaVoices(schema: unknown): SchemaVoice[] {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return []
  const voices = (schema as { voices?: unknown }).voices
  if (!Array.isArray(voices)) return []
  return voices.flatMap((voice: unknown) => {
    if (typeof voice !== 'object' || voice === null) return []
    const { key, label } = voice as { key?: unknown; label?: unknown }
    return typeof key === 'string' ? [{ key, label: typeof label === 'string' ? label : key }] : []
  })
}

/** The bar of the declaration's `bar` field; the kit registers it for `voice.convert`. */
export const voiceBar = {
  copy: {
    placeholder: ['写下台词的文字，输入 @ 引用你的录音', 'Write the words of the line; type @ to cite your recording'],
    send: ['转换新版本', 'Convert new take'],
  },
  chips({ schema, params }) {
    const voices = schemaVoices(schema)
    if (voices.length === 0) return []
    const current = voices.find(voice => voice.key === params['voice'])
    const chip: ParamChip = {
      key: 'voice', label: ['音色', 'Voice'], kind: 'menu', value: current?.label ?? '',
      options: voices.map(voice => ({ label: voice.label, patch: { voice: voice.key } })),
    }
    return [chip]
  },
  candidates(schema) {
    return schemaVoices(schema).length === 0 ? null : { mediaTypes: ['audio'], maxReferences: 1 }
  },
} satisfies GenerationBar
