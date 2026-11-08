/**
 * The parameter bar of `shot.render` in the composer: the aspect ratio, the resolution and the duration that the
 * selected video model's `schema()` offers, the `@` filter of its `reference` input, and the words of a shot's take
 * editor. A schema that the catalog does not know gives no chip and no filter, so the declared params' chips show and
 * `@` offers every media type.
 *
 * @module @dv/ui-shot-render/param-bar
 */
import type { ParamChip } from '@dv/ui-composer/contract'
import type { GenerationBar } from '@dv/ui-generation/generation-kit.tsx'

function fieldsOf(value: unknown): ReadonlyMap<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? new Map(Object.entries(value)) : new Map()
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** One menu chip over a list of choices; a text field when the schema lists none. */
function menu(key: string, label: ParamChip['label'], value: unknown, choices: readonly (string | number)[]): ParamChip {
  const shown = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (choices.length === 0) return { key, label, kind: 'text', value: shown }
  return { key, label, kind: 'menu', value: shown, options: choices.map(choice => ({ label: String(choice), patch: { [key]: choice } })) }
}

/** Whether a schema is a JSON object, the form of a schema that the catalog knows. */
function known(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema)
}

/** The bar of the declaration's `bar` field; the kit registers it for `shot.render`. */
export const shotRenderBar = {
  copy: {
    placeholder: ['描述画面，输入 @ 引用素材', 'Describe the shot; type @ to cite an item'],
    send: ['渲染新版本', 'Render new version'],
  },
  chips({ schema, params }) {
    if (!known(schema)) return []
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
    if (!known(schema)) return null
    const reference = fieldsOf(fieldsOf(fieldsOf(schema).get('inputs')).get('reference'))
    const declared = reference.get('media_types')
    const max = reference.get('max')
    // A schema lists the media types of an input, or keys them with their limits.
    const mediaTypes = Array.isArray(declared) ? strings(declared) : [...fieldsOf(declared).keys()]
    return { mediaTypes, maxReferences: typeof max === 'number' ? max : null }
  },
} satisfies GenerationBar
