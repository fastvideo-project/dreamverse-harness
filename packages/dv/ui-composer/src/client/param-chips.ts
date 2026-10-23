/**
 * The chips of a call's parameter bar and the typing of a text chip. Every param that the operation declares has a
 * chip, other than the prompt and the four params of the model key, which the editor and the model chip edit: a menu
 * for a param with choices, a checkbox for a boolean, and a text field otherwise, such as the seed or the model's own
 * params in `extra` as JSON. A registered bar's chip replaces the chip of its key, and adds the chip of a param that the
 * operation does not declare.
 *
 * @module @dv/ui-composer/param-chips
 */
import { errorMessage } from '@dv/ui-kit/api.ts'
import { fieldsOf, valueOf, type FormField } from '@dv/ui-kit/form.ts'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import type { ParamChip, Text } from './contract/index.ts'

/** The params that the editor and the model chip edit. */
const NOT_CHIPS = new Set(['prompt', 'modality', 'task', 'provider', 'model'])

/** The names of the params that several operations share; any other param shows its key. */
const SHARED_LABELS: Readonly<Record<string, Text>> = { duration_sec: ['时长（秒）', 'Duration (s)'], seed: ['种子', 'Seed'] }

/** The chip of one declared param. */
function declaredChip(field: FormField): ParamChip {
  const { key } = field
  const label = SHARED_LABELS[key] ?? [key, key]
  switch (field.control) {
    case 'select':
      return {
        key, label, kind: 'menu', value: field.text,
        options: field.options.map(option => ({ label: option, patch: { [key]: valueOf({ ...field, text: option }) } })),
      }
    case 'checkbox':
      return { key, label, kind: 'toggle', checked: field.text === 'true' }
    default:
      // An empty seed lets the operation draw one.
      return { key, label, kind: 'text', value: field.text, ...key === 'seed' ? { placeholder: ['随机', 'random'] } : {} }
  }
}

/**
 * The chips of a call.
 * @param operation - the call's operation declaration.
 * @param params - the call's params.
 * @param own - the chips that the operation's registered bar gives under the selected model.
 * @returns one chip per declared param in declaration order, each replaced by the bar's chip of its key, then the bar's
 *   chips of undeclared params.
 */
export function paramChips(operation: WireOperation, params: Readonly<Record<string, unknown>>, own: readonly ParamChip[]): ParamChip[] {
  const declared = fieldsOf(operation.params, { ...params }).filter(field => !NOT_CHIPS.has(field.key))
  const chips = declared.map(field => own.find(chip => chip.key === field.key) ?? declaredChip(field))
  return [...chips, ...own.filter(chip => !declared.some(field => field.key === chip.key))]
}

/**
 * The value of a text chip's text, typed by the param's declaration.
 * @param operation - the call's operation declaration.
 * @param key - the chip's param key.
 * @param text - the text in the chip.
 * @returns the value, undefined for an empty text; or the problem of a text that the param's type cannot take. A param
 *   that the operation does not declare takes the text as it is, and the check names the refusal.
 */
export function typedValue(
  operation: WireOperation, key: string, text: string,
): { readonly value: unknown } | { readonly problem: string } {
  const field = fieldsOf(operation.params).find(candidate => candidate.key === key)
  if (field === undefined) return { value: text === '' ? undefined : text }
  try {
    return { value: valueOf({ ...field, text }) }
  } catch (unparsed) {
    return { problem: errorMessage(unparsed) }
  }
}
