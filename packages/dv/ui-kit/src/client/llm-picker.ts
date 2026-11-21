/**
 * Which language models the composer's LLM picker offers. A provider can list dozens of models, so the picker offers
 * the first few of each provider until the user switches models on or off in Settings → Models. The choices live in
 * this browser's local storage, shared by the Settings table and every composer through one store.
 *
 * @module @dv/ui-kit/llm-picker
 */
import { readStored, writeStored } from './storage.ts'

/** The local-storage key of the picker choices. */
const STORAGE_KEY = 'dv.llm-picker'

/**
 * How many models of each provider the picker offers before the user chooses. The provider lists its models in its own
 * order of preference, and an empty default would leave a freshly connected provider with nothing to pick.
 */
export const LLM_PICKER_DEFAULT_COUNT = 3

/** The user's explicit choices by {@link llmPickerKey}; a model without an entry keeps the default. */
export type LlmPickerChoices = Readonly<Record<string, boolean>>

/** The providers of an LLM catalog with their models, in listing order. */
export interface LlmPickerGroup {
  id: string
  models: readonly { id: string }[]
}

const NONE: LlmPickerChoices = {}
const listeners = new Set<() => void>()
let cache: { raw: string | null; choices: LlmPickerChoices } = { raw: null, choices: NONE }

/**
 * The key of one model in the picker choices.
 * @param provider - the provider id.
 * @param model - the model id.
 * @returns `provider/model`.
 */
export const llmPickerKey = (provider: string, model: string): string => `${provider}/${model}`

/** Parse stored text, keeping only boolean entries; anything else reads as no choices. */
function parse(raw: string): LlmPickerChoices {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    // Text that is not JSON reads as no choices, so the picker keeps its defaults.
    void error
    return NONE
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NONE
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
}

/**
 * Read the choices; the result keeps its identity until the stored text changes.
 * @returns the user's explicit choices.
 */
export function readLlmPickerChoices(): LlmPickerChoices {
  const raw = readStored('local', STORAGE_KEY)
  if (raw !== cache.raw) cache = { raw, choices: raw === null ? NONE : parse(raw) }
  return cache.choices
}

/**
 * Switch one model on or off in the picker.
 * @param key - the {@link llmPickerKey} of the model.
 * @param enabled - whether the picker offers it.
 */
export function setLlmPickerModel(key: string, enabled: boolean): void {
  writeStored('local', STORAGE_KEY, JSON.stringify({ ...readLlmPickerChoices(), [key]: enabled }))
  for (const listener of [...listeners]) listener()
}

/**
 * Observe changes made here or in another tab.
 * @param listener - called after each change.
 * @returns the disposer.
 */
export function subscribeLlmPicker(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => { if (event.key === STORAGE_KEY || event.key === null) listener() }
  listeners.add(listener)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * The models the picker offers.
 * @param choices - the user's explicit choices.
 * @param groups - the LLM providers that can serve a request, with their models.
 * @returns the {@link llmPickerKey} of every offered model.
 */
export function llmPickerEnabled(choices: LlmPickerChoices, groups: readonly LlmPickerGroup[]): ReadonlySet<string> {
  return new Set(groups.flatMap(group => group.models.flatMap((model, index) => {
    const key = llmPickerKey(group.id, model.id)
    return (choices[key] ?? index < LLM_PICKER_DEFAULT_COUNT) ? [key] : []
  })))
}
