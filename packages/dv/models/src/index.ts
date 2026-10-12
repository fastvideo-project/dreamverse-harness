/**
 * The DreamVerse model catalog as the `dvModels` Cordis service. Company plugins register one entry per model they
 * serve, with the generation modes they serve it in; consumers such as Shot render list the models and render with the
 * model and mode a call names. The catalog also gives the agent the model list as the `dv:models` prompt section and
 * the `dv_models_get` tool, which returns one model's limits in each of its modes.
 *
 * A model and a mode are separate choices: `MODES` defines each generation mode once, and each model declares the
 * modes it supports. Ten models and ten modes are ten entries, not a hundred.
 *
 * @module @dv/models
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, validateArgs } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type { InputRole, ModeDefinition, ModeId, ModelEntry } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The model catalog: the models company plugins serve, by name. */
    dvModels: DvModels
  }
}

/** Every generation mode, defined once; a model declares the modes it supports. */
export const MODES: Readonly<Record<ModeId, ModeDefinition>> = {
  reference: {
    description: 'From reference images (character, location and style versions, or imported images) and the prompt; '
      + 'optionally a first frame, such as the last still of the previous shot.',
    inputs: ['reference', 'first_frame'],
  },
  text: { description: 'From the prompt alone; no images.', inputs: [] },
}

/** The name of the model list prompt section. */
export const PROMPT_SECTION = 'dv:models'

/** `dvModels` plugin configuration. */
export interface Config {
  /** The order of the `dv:models` prompt section among the system prompt sections. */
  promptSectionOrder: number
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  promptSectionOrder: z.number().default(4890),
})

/**
 * Refuse a model entry that names an unknown mode, an input role its mode does not allow, or no mode at all.
 * @param entry - the entry to register.
 * @throws Error naming the problem.
 */
function checkEntry(entry: ModelEntry): void {
  const modes = Object.entries(entry.modes)
  if (modes.length === 0) throw new Error(`dvModels: model "${entry.id}" declares no mode.`)
  for (const [mode, declaration] of modes) {
    const definition = Object.hasOwn(MODES, mode) ? MODES[mode as ModeId] : undefined
    if (definition === undefined) throw new Error(`dvModels: model "${entry.id}" declares unknown mode "${mode}"; modes: ${Object.keys(MODES).join(', ')}.`)
    for (const role of Object.keys(declaration.inputs)) {
      if (!definition.inputs.includes(role as InputRole)) {
        throw new Error(`dvModels: mode "${mode}" of model "${entry.id}" accepts input "${role}", which the mode does not allow.`)
      }
    }
  }
}

/**
 * The extra parameters of a mode as text for the model list, such as `cfg, steps`, or `—` when it has none.
 * @param entry - the model.
 * @returns the text.
 */
function extraNames(entry: ModelEntry): string {
  const names = Object.entries(entry.modes).flatMap(([mode, declaration]) =>
    Object.keys(declaration.extra).map(name => `${name} (${mode})`))
  return names.length === 0 ? '—' : names.join(', ')
}

/** The model catalog service: model entries by name, the model list prompt section, and the `dv_models_get` tool. */
export default class DvModels extends Service {
  static Config = Config

  private readonly entries = new Map<string, ModelEntry>()
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'dvModels')
    ctx.inject(['systemPrompt'], (child) => {
      child.effect(() => child.systemPrompt.section({
        name: PROMPT_SECTION, order: config.promptSectionOrder, interpolate: false, text: () => this.modelList(),
      }), 'dvModels prompt section')
    })
    ctx.inject(['tools'], (child) => {
      child.effect(() => child.tools.register(this.getTool()), 'dvModels dv_models_get')
    })
  }

  /**
   * Register a model.
   * @param entry - the model and the modes it supports.
   * @returns a function that removes the model.
   * @throws Error when a model with the same `id` is registered, or when the entry declares no mode, an unknown mode,
   *   or an input role its mode does not allow.
   */
  register(entry: ModelEntry): () => void {
    if (this.entries.has(entry.id)) throw new Error(`dvModels: model "${entry.id}" is already registered.`)
    checkEntry(entry)
    this.entries.set(entry.id, entry)
    this.notify()
    return () => {
      if (this.entries.get(entry.id) !== entry) return
      this.entries.delete(entry.id)
      this.notify()
    }
  }

  /**
   * Read one model.
   * @param id - the model name.
   * @returns the entry, or undefined when no model is registered under `id`.
   */
  get(id: string): ModelEntry | undefined {
    return this.entries.get(id)
  }

  /** @returns every registered model, in registration order. */
  list(): ModelEntry[] {
    return [...this.entries.values()]
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
   * Check the `extra` param of a render against the model's parameters in the mode: an unknown name or a value of the
   * wrong type is refused.
   * @param entry - the model.
   * @param mode - a mode the model supports.
   * @param extra - the `extra` param of the call.
   * @returns one sentence per problem; empty when the values are valid.
   */
  checkExtra(entry: ModelEntry, mode: ModeId, extra: Record<string, unknown>): string[] {
    const schema = entry.modes[mode]?.extra ?? {}
    const known = Object.keys(schema)
    const unknown = Object.keys(extra).filter(name => !known.includes(name))
    if (unknown.length > 0) {
      return [`${entry.id} has no extra parameter ${unknown.map(name => `\`${name}\``).join(', ')} in mode ${mode}; `
        + `its extra parameters: ${known.length === 0 ? 'none' : known.join(', ')}.`]
    }
    return validateArgs(schema, extra).map(message => `extra${message.startsWith('.') ? '' : '.'}${message}`)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /** The `dv:models` prompt section: the modes, then one row per model; empty while no model is registered. */
  private modelList(): string {
    const models = this.list()
    if (models.length === 0) return ''
    return [
      '## Video models',
      'Every dv_shot_render call names a `model` and a `mode` from this list; a call without them is refused. Modes:',
      ...Object.entries(MODES).map(([mode, definition]) => `- ${mode}: ${definition.description}`),
      'Call dv_models_get with a model for its limits in each of its modes: durations, aspect ratios, resolutions, '
        + 'reference images, and the extra parameters it takes in `extra`.',
      '',
      '| model | company | modes | extra parameters | about |',
      '| --- | --- | --- | --- | --- |',
      ...models.map(entry => `| ${entry.id} | ${entry.company} | ${Object.keys(entry.modes).join(', ')} | ${extraNames(entry)} | ${entry.summary} |`),
    ].join('\n')
  }

  /**
   * One model's limits in each of its modes, read from its backend, with its extra parameters.
   * @param id - the model name.
   * @returns the model, its company, and per mode the accepted inputs, durations, aspect ratios, resolutions, the
   *   reference image limit, and the extra parameter schema.
   * @throws Error naming the registered models when `id` is unknown, or the backend's error.
   */
  async describe(id: string): Promise<JsonValue> {
    const entry = this.get(id)
    if (entry === undefined) throw new Error(`Unknown model "${id}"; models: ${this.list().map(model => model.id).join(', ') || 'none'}.`)
    // Each mode may be served by its own backend, so the modes' facts are read together.
    const modes = await Promise.all(Object.entries(entry.modes).map(async ([mode, declaration]): Promise<[string, JsonValue]> => {
      const facts = await entry.facts(mode as ModeId)
      return [mode, {
        inputs: Object.fromEntries(Object.entries(declaration.inputs).map(([role, limit]) => [role, {
          min: limit.min, ...role === 'reference' ? { max: facts.maxReferenceImages } : { max: 1 },
        }])),
        duration_sec: { min: facts.minDurationSec, max: facts.maxDurationSec },
        aspect_ratios: facts.aspectRatios,
        resolutions: facts.resolutions,
        extra: JSON.parse(JSON.stringify(declaration.extra)) as JsonValue,
      }]
    }))
    return { model: entry.id, company: entry.company, about: entry.summary, modes: Object.fromEntries(modes) }
  }

  /** The `dv_models_get` tool. */
  private getTool() {
    return defineTool({
      name: 'dv_models_get',
      description: 'Read one video model\'s limits in each of its modes: the inputs it accepts, durations, aspect ratios, '
        + 'resolutions, and the extra parameters it takes in the `extra` param of dv_shot_render.',
      parameters: { model: { type: 'string', required: true, description: 'A model from the video model list.' } },
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: JsonValue): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
      },
      execute: args => this.describe(args.model),
    })
  }
}
