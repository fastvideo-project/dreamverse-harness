/**
 * The DreamVerse model catalog as the `dvModels` Cordis service: a provider-neutral registry of model entries. Provider
 * plugins register one entry per task a model serves, keyed by modality, task, provider and model; consumers such as
 * Shot render register their operation while the catalog serves one of their tasks, and render with the entry that a
 * call's key names among those tasks. The catalog knows no specific model and adds
 * nothing to the system prompt: the agent reads entries through the `dv_models_list` and `dv_models_get` tools and
 * chooses one for each shot with the `video-model-selection` skill. The catalog registers the prompt skill that an
 * entry carries while the entry lives, and keeps the label of each task that a primitive declaration labels, for the
 * views.
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
import type { ModalityId, ModelEntry, ModelFilter, ModelKey, TaskId } from './types.ts'
import { installModelControls } from './selection.ts'
export { assertVideoSelection, videoSelection } from './selection.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The model catalog: the entries provider plugins register, by modality, task, provider and model. */
    dvModels: DvModels
  }
}

/** `dvModels` plugin configuration. */
export interface Config {
  /** How long `catalog()` waits for one entry's `schema()` before it lists the entry with schema null, in ms. */
  catalogSchemaTimeoutMs: number
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  catalogSchemaTimeoutMs: z.natural().min(1).default(5000),
})

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

/**
 * The catalog key that the params of a consumer's call name in their `modality`, `task`, `provider` and `model` fields.
 * A field that is not a string reads as an empty string, and a modality or task outside the vocabulary names no entry,
 * so `get` finds none for it.
 * @param params - the call's params.
 * @returns the key.
 */
export function modelKey(params: Record<string, unknown>): ModelKey {
  const field = (name: typeof MODEL_KEY_FIELDS[number]): string => {
    const value = params[name]
    return typeof value === 'string' ? value : ''
  }
  return { modality: field('modality') as ModalityId, task: field('task') as TaskId, provider: field('provider'), model: field('model') }
}

/**
 * Whether an entry serves one of the given tasks; narrows the entry to those tasks.
 * @param entry - the entry.
 * @param tasks - the tasks.
 * @returns true when the entry's task is in `tasks`.
 */
export function servesTask<E extends Pick<ModelEntry, 'task'>, T extends TaskId>(entry: E, tasks: readonly T[]): entry is E & ModelEntry<T> {
  return (tasks as readonly TaskId[]).includes(entry.task)
}

/** Convert an entry to its key and its description, as `dv_models_list` and `dv_models_get` return them. */
function toModelListItem(entry: ModelEntry): Record<string, JsonValue> {
  return { modality: entry.modality, task: entry.task, provider: entry.provider, model: entry.model, description: entry.description,
    ...entry.displayName === undefined ? {} : { display_name: entry.displayName } }
}

/** Render a tool's JSON value as the text the agent reads. */
const JSON_TOOL_OUTPUT = {
  schema: { type: 'json' },
  render: (_args: unknown, value: JsonValue): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
} as const

/**
 * The model catalog service: entries by key, the `dv_models_list` and `dv_models_get` tools, the selection skill, the
 * prompt skills of the entries, and the task labels.
 */
export default class DvModels extends Service {
  static Config = Config

  private readonly entries = new Map<string, ModelEntry>()
  private readonly labels = new Map<string, { zh: string; en: string }>()
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dvModels')
    installModelControls(ctx, this)
    ctx.inject(['tools'], (child) => {
      child.effect(() => child.tools.register(this.defineModelsListTool()), 'dvModels dv_models_list')
      child.effect(() => child.tools.register(this.defineModelsGetTool()), 'dvModels dv_models_get')
    })
    const skill = {
      name: 'video-model-selection',
      description: 'How to choose the video model for each shot: the task of the shot, the candidate models and their '
        + 'limits, and when to ask the user.',
      source: 'runtime',
      content: readFileSync(new URL('../skills/video-model-selection.md', import.meta.url), 'utf8'),
      // The agent's own procedure: the model loads it, and the composer's / menu and the Skills page do not list it.
      invocation: { modelInvocable: true, userInvocable: false },
    }
    ctx.inject(['skills'], (child) => {
      child.effect(() => child.skills.register(skill), `dvModels ${skill.name}`)
      child.effect(() => this.registerPromptSkills(child), 'dvModels prompt skills')
    })
  }

  /**
   * Keep the prompt skill of each registered entry in the skill registry while the entry lives.
   * @param child - the context in which the DSH skill registry is mounted.
   * @returns a function that stops listening and removes the prompt skills; pass it to `ctx.effect`.
   */
  private registerPromptSkills(child: Context): () => void {
    const registered = new Map<ModelEntry, () => void>()
    // Each change removes the skills of removed entries and registers the skills of added entries.
    const sync = (): void => {
      const live = new Set(this.entries.values())
      for (const [entry, remove] of registered) {
        if (live.has(entry)) continue
        remove()
        registered.delete(entry)
      }
      for (const entry of live) {
        if (entry.promptSkill === undefined || registered.has(entry)) continue
        // Like the selection skill, a prompt skill is for the agent only.
        const invocation = { modelInvocable: true, userInvocable: false }
        registered.set(entry, child.skills.register({ ...entry.promptSkill, source: 'runtime', invocation }))
      }
    }
    sync()
    const unlisten = this.onChanged(sync)
    return () => {
      unlisten()
      for (const remove of registered.values()) remove()
      registered.clear()
    }
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
   * Read the entry that the params of a consumer's call name, among the entries of the consumer's tasks.
   * @param tasks - the tasks that the consumer runs, such as `['t2v', 'ref2v']`.
   * @param params - the call's params, with the key in `modality`, `task`, `provider` and `model`.
   * @returns the entry.
   * @throws Error naming the key and `dv_models_list` when no entry of one of `tasks` has the key.
   */
  resolve<T extends TaskId>(tasks: readonly T[], params: Record<string, unknown>): ModelEntry<T> {
    const key = modelKey(params)
    const entry = this.get(key)
    if (entry === undefined || !servesTask(entry, tasks)) {
      throw new Error(`Unknown model "${formatModelKey(key)}"; call dv_models_list for the models.`)
    }
    return entry
  }

  /**
   * Keep a registration of a consumer, such as its operation, while the catalog holds an entry of one of its tasks.
   * @param tasks - the tasks that the consumer runs.
   * @param start - registers the consumer's part when the first entry of one of `tasks` arrives; returns its disposer.
   * @returns a function that stops listening and disposes the registration; pass it to `ctx.effect`.
   */
  whileServing(tasks: readonly TaskId[], start: () => () => void): () => void {
    let stop: (() => void) | null = null
    // The registration starts with the first entry of one of the tasks and stops when the last one is removed.
    const sync = (): void => {
      const serving = this.list().some(entry => servesTask(entry, tasks))
      if (serving === (stop !== null)) return
      stop?.()
      stop = serving ? start() : null
    }
    sync()
    const unlisten = this.onChanged(sync)
    return () => {
      unlisten()
      stop?.()
      stop = null
    }
  }

  /**
   * Register the labels of tasks, as a primitive declaration lists them, for the views that show a task.
   * @param labels - the Chinese and the English label of each task, by task name.
   * @returns a function that removes these labels; a second call does nothing.
   * @throws Error when one of the tasks already has a label; then no label of `labels` is registered.
   */
  labelTasks(labels: Readonly<Record<string, { zh: string; en: string }>>): () => void {
    const added = Object.entries(labels)
    for (const [task] of added) {
      if (this.labels.has(task)) throw new Error(`dvModels: task "${task}" already has a label.`)
    }
    for (const [task, label] of added) this.labels.set(task, label)
    let live = true
    return () => {
      if (!live) return
      live = false
      for (const [task] of added) this.labels.delete(task)
    }
  }

  /**
   * Read the label of every task that a declaration labeled.
   * @returns the labels by task name; `@dv/api` serves them at `GET /api/dv/tasks`.
   */
  taskLabels(): Readonly<Record<string, { zh: string; en: string }>> {
    return Object.fromEntries(this.labels)
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

  /**
   * The catalog the browser reads: each entry as `dv_models_get` returns it, in registration order, so the agent and the
   * browser read one catalog.
   * @returns the entries; an entry whose `schema()` fails or does not answer within `catalogSchemaTimeoutMs`, such as one
   *   whose backend cannot be reached, has schema null.
   */
  async catalog(): Promise<Array<Record<string, JsonValue>>> {
    return await Promise.all(this.list().map(async (entry) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<null>((resolve) => { timer = setTimeout(() => { resolve(null) }, this.config.catalogSchemaTimeoutMs) })
      // The schema of an unreachable or slow backend is unknown; the entry still lists its key and description.
      const metadata = await Promise.race([Promise.all([
        entry.schema().catch((_unreachable: unknown) => null),
        entry.runtime === undefined ? undefined : entry.runtime.status().catch((_unreachable: unknown) => null),
      ]), late])
      clearTimeout(timer)
      const schema = metadata?.[0] ?? null
      const runtime = metadata?.[1]
      return { ...toModelListItem(entry), schema,
        ...entry.runtime === undefined ? {} : { runtime: runtime == null ? null : { ...runtime } } }
    }))
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /** The `dv_models_list` tool. */
  private defineModelsListTool() {
    return defineTool({
      name: 'dv_models_list',
      description: 'List the models you can generate with, each with its key (modality, task, provider, model), its description '
        + 'and the name of its prompt skill, if it has one.',
      parameters: {
        modality: { type: 'string', description: 'Only models of this modality.' },
        task: { type: 'string', description: 'Only models for this task.' },
        provider: { type: 'string', description: 'Only models of this provider.' },
      },
      output: JSON_TOOL_OUTPUT,
      execute: args => Promise.resolve(this.list().filter(entry => entryMatchesFilter(entry, args)).map(entry => ({
        ...toModelListItem(entry), ...entry.promptSkill === undefined ? {} : { prompt_skill: entry.promptSkill.name },
      }))),
    })
  }

  /** The `dv_models_get` tool. */
  private defineModelsGetTool() {
    return defineTool({
      name: 'dv_models_get',
      description: 'Read one model by its key from dv_models_list: its description and its schema (its limits, '
        + 'such as durations, aspect ratios and resolutions; the inputs it accepts with their media types and counts; '
        + 'and the parameters it takes in `extra`).',
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
          throw new Error(`No model has the key ${args.modality}/${args.task}/${args.provider}/${args.model}; `
            + 'call dv_models_list for the models you can use.')
        }
        return { ...toModelListItem(entry), schema: await entry.schema() }
      },
    })
  }
}
