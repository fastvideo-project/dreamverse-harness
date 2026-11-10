/**
 * The DreamVerse community-LoRA registry as the `dvLora` Cordis service: the adapters a creator may apply to a shot,
 * with the trigger words, strengths, target models and tasks, licence and source of each. The config gives the registry,
 * so a deployment decides which community LoRAs it vouches for and what the owner has to read before using them.
 *
 * The service owns the registry and two tools for the agent, `dv_lora_list` and `dv_lora_get`, and registers the
 * `community-lora` runtime skill: when a shot should use a LoRA, how the strengths of an adapter trained on 50-step base
 * H3 carry to 8-step FastH3, and why "turbo" adapters are not used here. It does not render; a provider plugin such as
 * `@dv/fastvideo` reads the registry when it validates the `extra.lora` parameter of a render request and applies the
 * adapter on its server.
 *
 * @module @dv/lora
 */
import { readFileSync } from 'node:fs'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type { TaskId } from '@dv/models'

/** One model that an adapter is meant for, and the tasks of it. */
export interface LoraTarget {
  /** The catalog's model name, such as `fasth3`. */
  model: string
  /** The tasks the adapter was trained for, such as `t2v` and `ref2v`. */
  tasks: TaskId[]
}

/**
 * One community LoRA that the deployment vouches for.
 *
 * `id` is both the registry key and the adapter id that the render server allow-lists: a Hugging Face repo id such as
 * `fal/MiniMax-H3-Realism-People-LoRA`, or a local path when the deployment serves a private file. The strengths
 * multiply the published adapter delta, so `0` is exactly the model without the adapter and `1` is the scale its author
 * published.
 */
export interface LoraDefinition {
  /** The adapter id: an HF repo id or a local path that the server loads, and the id that a render request names. */
  id: string
  /** The name the agent and the user see, such as `Realism People`. */
  displayName: string
  /** What the adapter changes in a shot, and what it was trained on. */
  description: string
  /** The words its author says to put in the prompt so the effect shows; empty when it needs none. */
  triggerWords: string[]
  /** The strength its author recommends, which a request uses when it names the adapter without one. */
  defaultStrength: number
  /** The lowest strength the deployment serves; `0` is the model without the adapter. */
  minStrength: number
  /** The highest strength the deployment serves; above the author's scale usually degrades the shot. */
  maxStrength: number
  /** The models and tasks the adapter is meant for. */
  targets: LoraTarget[]
  /** The licence of the adapter's weights, such as `Apache-2.0` or the H3 community licence note. */
  license: string
  /** The page the weights come from, for the attribution the licence asks for. */
  sourceUrl: string
}

/** One target as the config writes it: the service validates each task name against the catalog. */
export interface ConfigTarget {
  /** The catalog's model name, such as `fasth3`. */
  model: string
  /** The tasks of that model, such as `t2v`. */
  tasks: string[]
}

/** One adapter as the config writes it: a target's tasks are strings until the service validates them. */
export interface ConfigAdapter extends Omit<LoraDefinition, 'targets'> {
  /** The models and tasks the adapter is meant for. */
  targets: ConfigTarget[]
}

/** `dv-lora` configuration: the registry that the deployment serves. */
export interface Config {
  /** The community LoRAs a shot may use; an empty list leaves the registry empty. */
  adapters: ConfigAdapter[]
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  adapters: z.array(z.object({
    id: z.string().required(),
    displayName: z.string().required(),
    description: z.string().default(''),
    triggerWords: z.array(z.string()).default([]),
    defaultStrength: z.number().default(0.8),
    minStrength: z.number().default(0),
    maxStrength: z.number().default(2),
    targets: z.array(z.object({ model: z.string().required(), tasks: z.array(z.string()).required() })).required(),
    license: z.string().default(''),
    sourceUrl: z.string().default(''),
  })).required(),
})

/** The tasks the catalog declares; a target that names another task is a config error. */
const TASKS: readonly TaskId[] = ['t2v', 'ref2v']

/** Render a tool's JSON value as the text the agent reads. */
const JSON_TOOL_OUTPUT = {
  schema: { type: 'json' },
  render: (_args: unknown, value: JsonValue): { type: 'text'; text: string }[] => [
    { type: 'text', text: JSON.stringify(value, null, 1) },
  ],
} as const

/**
 * The fields of one adapter that the agent reads: what it changes, where it applies, its strengths, its trigger words
 * and the attribution. The wire format is JSON, so the tool output keeps these names.
 * @param adapter - the registry entry.
 * @returns the agent-facing record.
 */
function toRecord(adapter: LoraDefinition): Record<string, JsonValue> {
  return {
    id: adapter.id,
    display_name: adapter.displayName,
    description: adapter.description,
    trigger_words: [...adapter.triggerWords],
    default_strength: adapter.defaultStrength,
    strength_range: { min: adapter.minStrength, max: adapter.maxStrength },
    targets: adapter.targets.map(target => ({ model: target.model, tasks: [...target.tasks] })),
    license: adapter.license,
    source_url: adapter.sourceUrl,
  }
}

/**
 * The registry service: the adapters by id, `list` and `get` for the provider plugins, the `dv_lora_list` and `dv_lora_get`
 * tools, and the `community-lora` skill.
 */
export default class DvLora extends Service {
  static Config = Config

  private readonly adapters = new Map<string, LoraDefinition>()

  /**
   * @param ctx - owning plugin context.
   * @param config - the registry the deployment serves; validated before the service is created.
   * @throws Error naming the adapter and the problem when an id repeats, a strength is not finite or ordered, or a
   *   target names a task the catalog does not declare.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dvLora')
    for (const adapter of config.adapters) {
      if (this.adapters.has(adapter.id)) throw new Error(`dv-lora: adapter "${adapter.id}" is configured twice.`)
      if (!adapter.id.trim()) throw new Error('dv-lora: an adapter has an empty id.')
      if (!(adapter.minStrength <= adapter.defaultStrength && adapter.defaultStrength <= adapter.maxStrength)) {
        throw new Error(`dv-lora: adapter "${adapter.id}" needs minStrength <= defaultStrength <= maxStrength.`)
      }
      for (const target of adapter.targets) {
        for (const task of target.tasks) {
          if (!(TASKS as readonly string[]).includes(task)) {
            throw new Error(`dv-lora: adapter "${adapter.id}" names unknown task "${task}".`)
          }
        }
      }
      const targets = adapter.targets.map(target => ({ model: target.model, tasks: [...target.tasks] as TaskId[] }))
      this.adapters.set(adapter.id, Object.freeze({ ...adapter, triggerWords: [...adapter.triggerWords], targets }))
    }
    ctx.inject(['tools'], (child) => {
      child.effect(() => child.tools.register(this.defineListTool()), 'dvLora dv_lora_list')
      child.effect(() => child.tools.register(this.defineGetTool()), 'dvLora dv_lora_get')
    })
    const skill = {
      name: 'community-lora',
      description: 'When and how to apply a community LoRA to a shot: choosing an adapter, its trigger words and '
        + 'strength, and why step-reduction adapters are not used on FastH3.',
      source: 'runtime',
      content: readFileSync(new URL('../skills/community-lora.md', import.meta.url), 'utf8'),
      // The agent's own procedure: the model loads it, and the composer's / menu and the Skills page do not list it.
      invocation: { modelInvocable: true, userInvocable: false },
    }
    ctx.inject(['skills'], (child) => {
      child.effect(() => child.skills.register(skill), `dvLora ${skill.name}`)
    })
  }

  /**
   * Read every adapter, or the adapters of one model and task.
   * @param filter - the model and task whose adapters to read; omitted, every adapter.
   * @returns the adapters in registry order.
   */
  list(filter: { model?: string; task?: TaskId } = {}): LoraDefinition[] {
    return [...this.adapters.values()].filter(adapter => adapter.targets.some(target =>
      (filter.model === undefined || target.model === filter.model)
      && (filter.task === undefined || target.tasks.includes(filter.task))))
  }

  /**
   * Read one adapter by the id that a render request names.
   * @param id - the adapter id, an HF repo id or a local path.
   * @returns the adapter, or undefined when the registry does not serve it.
   */
  get(id: string): LoraDefinition | undefined {
    return this.adapters.get(id)
  }

  /** The `dv_lora_list` tool. */
  private defineListTool() {
    return defineTool({
      name: 'dv_lora_list',
      description: 'List the community LoRAs this deployment vouches for, each with its id, what it changes, its trigger '
        + 'words, its default and allowed strength, and the models and tasks it is meant for. Pass model and task to '
        + 'see only the adapters a shot of that model and task can use.',
      parameters: {
        model: { type: 'string', description: 'Only adapters meant for this model, such as fasth3.' },
        task: { type: 'string', description: 'Only adapters meant for this task, such as t2v or ref2v.' },
      },
      output: JSON_TOOL_OUTPUT,
      execute: args => Promise.resolve(this.list({
        ...args.model === undefined ? {} : { model: args.model },
        ...args.task === undefined ? {} : { task: args.task as TaskId },
      }).map(toRecord)),
    })
  }

  /** The `dv_lora_get` tool. */
  private defineGetTool() {
    return defineTool({
      name: 'dv_lora_get',
      description: 'Read one community LoRA by the id that dv_lora_list shows: what it changes, its trigger words, its '
        + 'default and allowed strength, the models and tasks it is meant for, and its licence and source.',
      parameters: {
        id: { type: 'string', required: true, description: 'The adapter id, as dv_lora_list lists it.' },
      },
      output: JSON_TOOL_OUTPUT,
      execute: (args) => {
        const adapter = this.get(args.id)
        if (adapter === undefined) {
          const known = this.list().map(candidate => candidate.id).join(', ') || 'none'
          throw new Error(`dv-lora serves no adapter "${args.id}"; it serves: ${known}. Call dv_lora_list.`)
        }
        return Promise.resolve(toRecord(adapter))
      },
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The community-LoRA registry that this deployment publishes. */
    dvLora: DvLora
  }
}
