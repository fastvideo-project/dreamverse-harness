/**
 * The parameter bar of `shot.render` in the composer: the aspect ratio, the resolution and the duration that the
 * selected video model's `schema()` offers, the `@` filter of its `reference` input, and the words of a shot's take
 * editor.
 *
 * @module @dv/ui-shot-render/param-bar
 */
import type { ParamBar, ParamChip } from '@dv/ui-composer/contract'

/** The fields of a JSON object, else none. */
function fieldsOf(value: unknown): ReadonlyMap<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? new Map(Object.entries(value)) : new Map()
}

/** The strings of a JSON list. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** One menu chip over a list of choices; a text field when the schema lists none. */
function menu(key: string, label: ParamChip['label'], value: unknown, choices: readonly (string | number)[]): ParamChip {
  const shown = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (choices.length === 0) return { key, label, kind: 'text', value: shown }
  return { key, label, kind: 'menu', value: shown, options: choices.map(choice => ({ label: String(choice), patch: { [key]: choice } })) }
}

/** The bar descriptor, registered into `dvComposer.paramBars`. */
export const shotRenderBar: ParamBar = {
  operation: 'shot.render',
  owner: '@dv/ui-shot-render',
  copy: {
    placeholder: ['描述画面，输入 @ 引用素材', 'Describe the shot; type @ to cite an item'],
    send: ['渲染新版本', 'Render new take'],
    sending: ['渲染中…', 'Rendering…'],
  },
  chips({ schema, params }) {
    const fields = fieldsOf(schema)
    const duration = fieldsOf(fields.get('duration_sec'))
    const low = duration.get('min')
    const high = duration.get('max')
    const min = typeof low === 'number' ? Math.ceil(low) : 1
    const max = typeof high === 'number' ? Math.floor(high) : min
    const seconds = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index)
    return [
      menu('aspect_ratio', ['画幅', 'Aspect ratio'], params['aspect_ratio'], strings(fields.get('aspect_ratios'))),
      menu('resolution', ['清晰度', 'Resolution'], params['resolution'], strings(fields.get('resolutions'))),
      menu('duration_sec', ['时长', 'Duration'], params['duration_sec'], seconds),
    ]
  },
  candidates(schema) {
    const reference = fieldsOf(fieldsOf(fieldsOf(schema).get('inputs')).get('reference'))
    const declared = reference.get('media_types')
    const max = reference.get('max')
    // A schema lists the media types of an input, or keys them with their limits.
    const mediaTypes = Array.isArray(declared) ? strings(declared) : [...fieldsOf(declared).keys()]
    return { mediaTypes, maxReferences: typeof max === 'number' ? max : null }
  },
}
