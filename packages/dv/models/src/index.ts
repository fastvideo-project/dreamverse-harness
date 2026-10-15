/**
 * The DreamVerse model catalog as the `dvModels` Cordis service: a provider-neutral registry of model entries. Provider
 * plugins register one entry per task a model serves, keyed by modality, task, provider and model; consumers such as
 * Shot render list the entries and render with the entry a key names. The catalog knows no specific model and adds
 * nothing to the system prompt: the agent reads entries through the `dv_models_list` and `dv_models_get` tools and
 * chooses one for each shot with the `video-model-selection` skill.
 *
 * @module @dv/models
 */
import { readFileSync } from 'node:fs'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type { ModelEntry, ModelFilter, ModelKey } from './types.ts'

export type * from './types.ts'
export { citedAsset, parsePromptCitations, promptAssets, replacePromptCitations, type PromptCitation } from './citations.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The model catalog: the entries provider plugins register, by modality, task, provider and model. */
    dvModels: DvModels
  }
}

/** `dvModels` plugin configuration: none. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

/** The fields of a model key. */
const MODEL_KEY_FIELDS = ['modality', 'task', 'provider', 'model'] as const

/**
 * Format a model key as one string, such as `video/ref2v/fastvideo/fasth3`.
 * @param key - the key.
 * @returns `modality/task/provider/model`.
 */
export function formatModelKey(key: ModelKey): string {
  return `${key.modality}/${key.task}/${key.provider}/${key.model}`
}

/**
 * Whether an entry equals every given field of a filter; a field that is absent or undefined matches every entry.
 * @param entry - the entry.
 * @param filter - the key fields to match, as plain strings so that tool arguments can be passed unchanged.
 * @returns true when the entry matches.
 */
function entryMatchesFilter(entry: ModelKey, filter: Partial<Record<typeof MODEL_KEY_FIELDS[number], string>>): boolean {
  return MODEL_KEY_FIELDS.every(field => filter[field] === undefined || entry[field] === filter[field])
}

/** Convert an entry to one item of the `dv_models_list` result: its key and its description. */
function toModelListItem(entry: ModelEntry): Record<string, JsonValue> {
  return { modality: entry.modality, task: entry.task, provider: entry.provider, model: entry.model, description: entry.description }
}

/** Render a tool's JSON value as the text the agent reads. */
const JSON_TOOL_OUTPUT = {
  schema: { type: 'json' },
  render: (_args: unknown, value: JsonValue): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
} as const

/** The model catalog service: entries by key, the `dv_models_list` and `dv_models_get` tools, and the selection skill. */
export default class DvModels extends Service {
  static Config = Config

  private readonly entries = new Map<string, ModelEntry>()
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context) {
    super(ctx, 'dvModels')
    ctx.inject(['tools'], (child) => {
      child.effect(() => child.tools.register(this.defineModelsListTool()), 'dvModels dv_models_list')
      child.effect(() => child.tools.register(this.defineModelsGetTool()), 'dvModels dv_models_get')
    })
    const skill = {
      name: 'video-model-selection',
      description: 'How to choose the video model for each shot of a plan: the task of the shot, the candidates from '
        + 'dv_models_list and dv_models_get, and when to ask the user.',
      source: 'runtime',
      content: readFileSync(new URL('../skills/video-model-selection.md', import.meta.url), 'utf8'),
      // The agent's own procedure: the model loads it, and the composer's / menu and the Skills page do not list it.
      invocation: { modelInvocable: true, userInvocable: false },
    }
    ctx.inject(['skills'], (child) => {
      child.effect(() => child.skills.register(skill), `dvModels ${skill.name}`)
    })
  }

  /**
   * Register an entry.
   * @param entry - one model of one provider serving one task.
   * @returns a function that removes the entry.
   * @throws Error when an entry with the same key is registered.
   */
  register(entry: ModelEntry): () => void {
    const key = formatModelKey(entry)
    if (this.entries.has(key)) throw new Error(`dvModels: model "${key}" is already registered.`)
    this.entries.set(key, entry)
    this.notify()
    return () => {
      if (this.entries.get(key) !== entry) return
      this.entries.delete(key)
      this.notify()
    }
  }

  /**
   * Read one entry.
   * @param key - the entry's modality, task, provider and model.
   * @returns the entry, or undefined when no entry is registered under `key`.
   */
  get(key: ModelKey): ModelEntry | undefined {
    return this.entries.get(formatModelKey(key))
  }

  /**
   * Read the entries that match a filter.
   * @param filter - the modality, task and provider to match; an absent field matches every entry.
   * @returns the matching entries, in registration order.
   */
  list(filter: ModelFilter = {}): ModelEntry[] {
    return [...this.entries.values()].filter(entry => entryMatchesFilter(entry, filter))
  }

  /**
   * Listen to registrations and removals.
   * @param listener - called after each change.
   * @returns a function that removes the listener.
   */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /** The `dv_models_list` tool. */
  private defineModelsListTool() {
    return defineTool({
      name: 'dv_models_list',
      description: 'List the video models you can render with, each with its key (modality, task, provider, model) and '
        + 'its description. To choose the model of a shot, follow the video-model-selection skill.',
      parameters: {
        modality: { type: 'string', description: 'Only models of this modality, such as video.' },
        task: { type: 'string', description: 'Only models for this task: t2v (prompt only) or ref2v (reference media and prompt).' },
        provider: { type: 'string', description: 'Only models of this provider.' },
      },
      output: JSON_TOOL_OUTPUT,
      execute: args => Promise.resolve(this.list().filter(entry => entryMatchesFilter(entry, args)).map(toModelListItem)),
    })
  }

  /** The `dv_models_get` tool. */
  private defineModelsGetTool() {
    return defineTool({
      name: 'dv_models_get',
      description: 'Read one video model by its key from dv_models_list: its description; its facts (durations, aspect '
        + 'ratios and resolutions); and its schema (the inputs it accepts with their media types and counts, and the '
        + 'parameters it takes in `extra`).',
      parameters: {
        modality: { type: 'string', required: true, description: 'The modality of the model, as dv_models_list lists it.' },
        task: { type: 'string', required: true, description: 'The task of the model, as dv_models_list lists it.' },
        provider: { type: 'string', required: true, description: 'The provider of the model, as dv_models_list lists it.' },
        model: { type: 'string', required: true, description: 'The model name, as dv_models_list lists it.' },
      },
      output: JSON_TOOL_OUTPUT,
      execute: async (args) => {
        const entry = this.list().find(candidate => entryMatchesFilter(candidate, args))
        if (entry === undefined) {
          throw new Error(`No video model has the key ${args.modality}/${args.task}/${args.provider}/${args.model}; `
            + 'call dv_models_list for the models you can use.')
        }
        const [facts, schema] = await Promise.all([entry.facts(), entry.schema()])
        return {
          ...toModelListItem(entry),
          facts: {
            duration_sec: { min: facts.minDurationSec, max: facts.maxDurationSec },
            aspect_ratios: facts.aspectRatios,
            resolutions: facts.resolutions,
          },
          schema,
        }
      },
    })
  }
}
