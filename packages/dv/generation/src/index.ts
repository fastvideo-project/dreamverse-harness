/**
 * The generation helper of DreamVerse. `defineGeneration` turns the declaration of one generation primitive into a
 * Cordis service that owns one component key and one operation. Each call of the operation is one model call and one
 * project record, with the model key, the prompt, the seed and `extra` in its params. Workflows call the service
 * through `GenerationApi`. The helper names no primitive; each primitive package declares its own `PrimitiveTypes` row.
 *
 * @module @dv/generation
 */
import { randomInt } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@dv/canvas'
import {
  assertVideoSelection, formatModelKey, type ModelEntry, type ModelExecutionTarget,
  type PrimitiveId, type PrimitiveTypes, type TaskOfPrimitive,
} from '@dv/models'
import type {
  AssetId, OperationContext, OperationInput, OperationOutput, OperationResult, OperationSpec, OperationToolCall, ProjectId,
  ProjectRecord, ProjectState, RecordId, RecordInputRef, RecordOrigin, RunRequest, StartedBy,
} from '@dv/project'

/** One call of a generation operation by code, such as a workflow: who calls, the params, the inputs and the schedule. */
export interface GenerationCall extends RecordOrigin {
  project: ProjectId
  params: Record<string, unknown>
  inputs: RunRequest['inputs']
  /** Schedule the call after these records instead of running it now. */
  after?: RecordId[]
  based_on?: RecordId | null
  /** The record whose execute started the call, with its slot and lane; `render` passes it to `dvProject.run`. */
  started_by?: StartedBy
}

/**
 * One input as `toRequest` sees it. `resolved_asset` is null while the producer of a `{record, output}` reference has
 * not finished; `ref` and `resolved_asset` are both null for a chained role of `check`.
 */
export interface RequestInput { role: string; ref: RecordInputRef | null; resolved_asset: AssetId | null }

/** The methods of a generation service besides its operation, for workflows. */
export interface GenerationApi {
  /** Write one record of the operation and return its ID; a call with `after` is scheduled, and its record is pending. */
  render(call: GenerationCall): Promise<RecordId>
  /**
   * Whether the call would run on `state`; never writes. It reads only the project, the params and the inputs of the
   * call. The kernel counts inputs for agent calls; `toRequest` or the model's `validateGenerationRequest` counts them
   * for code calls.
   * @param chained - input roles whose producer the caller schedules before this call. Each reaches `toRequest` as
   *   `{ role, ref: null, resolved_asset: null }`, so role counts and citations see it; the model check waits for execute.
   * @returns [] when the call runs; else the first refusal, or the model problems joined as one reason. A rejected
   *   `facts()` or `validateGenerationRequest` of the entry reads `Model <key> is unavailable: <its message>`.
   */
  check(call: Pick<GenerationCall, 'project' | 'params' | 'inputs'>, state: ProjectState,
    chained?: readonly string[]): Promise<string[]>
  /** Parse reference text by role against the operation's input roles, as `dvProject.parseInputs` does. */
  parseInputs(raw: Record<string, string | string[]>, state: ProjectState): RunRequest['inputs']
}

interface GenerationSpecFields<P extends PrimitiveId> {
  /** The Cordis service name, such as `dvImageGenerate`. */
  service: string
  /** The component key that the service registers, such as `image`. */
  component: string
  /** The operation name, `<component>.<verb>`. */
  operation: string
  /**
   * The canvas nodes of the operation's records: the node type key that the browser draws them with, and their layout
   * column. The service registers them with `dvCanvasNodes` while the canvas is loaded.
   */
  node: { kind: string; column: number }
  primitive: P
  /**
   * The supported subset of catalog tasks, each with its label in Chinese and English. The operation is registered while
   * the catalog serves one of these tasks, and `dvModels.labelTasks` holds the labels while the service lives.
   */
  tasks: Readonly<Partial<Record<TaskOfPrimitive<P>, { zh: string; en: string }>>>
  label: { zh: string; en: string }
  description: string
  /** The params besides the model key, `prompt`, `seed` and `extra`; a declaration may restate `prompt` to describe it. */
  params: OperationSpec['params']
  inputs: Record<string, OperationInput>
  outputs: OperationOutput[]
  toolParams?: OperationSpec['params']
  /** Change an agent call before the check, such as a tool-only argument that becomes an input. */
  prepareToolCall?(call: OperationToolCall): void
  /** Import the model's result as the record's outputs. */
  toOutputs(ctx: Context, run: OperationContext, result: PrimitiveTypes[P]['result'],
    facts: PrimitiveTypes[P]['facts'], request: PrimitiveTypes[P]['request']): Promise<OperationResult>
  /** One line that describes a finished record. */
  summarize(record: ProjectRecord): string
}

/**
 * The declaration of one generation primitive: one component key, one operation, and the code that differs. `toRequest`
 * builds the request from the model's facts and the call's params and inputs; a throw refuses the call. A seeded
 * declaration's `toRequest` also takes the seed: the `seed` param, else a random one. With `seed: false`, the operation
 * has no `seed` param, draws no seed and reports none, for models without a seed.
 */
export type GenerationSpec<P extends PrimitiveId> = GenerationSpecFields<P> & ({
  seed?: undefined
  toRequest(facts: PrimitiveTypes[P]['facts'], params: Record<string, unknown>,
    inputs: readonly RequestInput[], seed: number): PrimitiveTypes[P]['request']
} | {
  seed: false
  toRequest(facts: PrimitiveTypes[P]['facts'], params: Record<string, unknown>,
    inputs: readonly RequestInput[]): PrimitiveTypes[P]['request']
})

/** The seed range of the generation backends. */
const SEED_LIMIT = 2 ** 31

const REFUSAL_END = 'Nothing was generated; change the inputs or params, then call again.'

const UNAVAILABLE_END = 'Nothing was generated; no change to the call helps while the model is unavailable.'

interface Refusal { reasons: string[]; end: string }

/** A required string param with its description. */
function requiredText(description: string): OperationSpec['params'][string] {
  return { type: 'string', required: true, description }
}

/** The params that come first in every generation operation: the model key and the prompt. */
const KEY_PARAMS: OperationSpec['params'] = {
  modality: requiredText('The modality of a model that dv_models_list lists.'),
  task: requiredText('The task of that model, as dv_models_list lists it.'),
  provider: requiredText('The provider of that model, as dv_models_list lists it.'),
  model: requiredText('The model name, as dv_models_list lists it.'),
  prompt: requiredText('The complete prompt; follow the prompt skill that dv_models_list names for the model, if any.'),
}

/** The `seed` param, which follows the declaration's params unless the declaration has no seed. */
const SEED_PARAM: OperationSpec['params'] = {
  seed: { type: 'integer', description: 'Fixed seed; omitted, a random seed is drawn and recorded.' },
}

/** The param that comes last in every generation operation: the model's own parameters. */
const EXTRA_PARAM: OperationSpec['params'] = {
  extra: {
    type: 'object', additionalProperties: true,
    description: 'The model\'s own parameters, as dv_models_get lists them; omit it when the model has none.',
  },
}

function requestOf<P extends PrimitiveId>(spec: GenerationSpec<P>, facts: PrimitiveTypes[P]['facts'],
  params: Record<string, unknown>, inputs: readonly RequestInput[]): { request: PrimitiveTypes[P]['request']; seed: number | null } {
  if (spec.seed === false) return { request: spec.toRequest(facts, params, inputs), seed: null }
  const seed = typeof params['seed'] === 'number' ? params['seed'] : randomInt(SEED_LIMIT)
  return { request: spec.toRequest(facts, params, inputs, seed), seed }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class Unavailable extends Error {
  constructor(entry: ModelEntry, cause: unknown) {
    super(`Model ${formatModelKey(entry)} is unavailable: ${messageOf(cause)}`, { cause })
  }
}

/** Resolve explicit placement before reading capabilities or admitting a generation. */
function executionTarget(entry: ModelEntry, params: Record<string, unknown>): ModelExecutionTarget | undefined {
  if (params['worker'] === undefined) return undefined
  if (typeof params['worker'] !== 'string' || params['worker'].trim() === '') throw new Error('Choose an enabled worker ID or omit worker for automatic placement.')
  if (entry.workerRouting !== true) throw new Error('This provider does not support explicit worker placement.')
  return { worker: params['worker'] }
}

/** The reason for the problems that a model finds in a request. */
function modelReason(entry: ModelEntry, problems: readonly string[]): string {
  return `Model ${formatModelKey(entry)} cannot generate this: ${problems.join(' ')}`
}

/**
 * A prompt as one quoted line of a summary: trimmed, cut after `limit` characters (grapheme clusters, so that no emoji
 * is split) with `…` when longer, and written as a JSON string, so that its quotes and line breaks are escaped.
 * @param prompt - the prompt.
 * @param limit - the most characters to keep.
 * @returns the quoted prompt.
 */
export function quotePrompt(prompt: string, limit: number): string {
  const characters = Array.from(new Intl.Segmenter().segment(prompt.trim()), ({ segment }) => segment)
  return JSON.stringify(characters.length > limit ? `${characters.slice(0, limit).join('')}…` : characters.join(''))
}

/**
 * Import one output of a generation as an asset of the running record, named `<record ID, 8 characters>.<mime
 * subtype>`, such as `a1b2c3d4.png`.
 * @param run - the running call of the operation.
 * @param file - the bytes, the media type, and the duration and pixel size when the model gives them.
 * @returns the asset's ID.
 * @throws Error when the call has no record.
 */
export function importOne(run: OperationContext,
  file: { bytes: Uint8Array; mime: string; durationSec?: number; width?: number; height?: number }): AssetId {
  if (run.record === null) throw new Error('importOne needs the record of a running generation.')
  const { bytes, ...meta } = file
  const name = `${run.record.id.slice(0, 8)}.${file.mime.slice(file.mime.indexOf('/') + 1)}`
  return run.importAsset(bytes, { ...meta, name })
}

/**
 * Define the service of one generation primitive.
 * @param spec - the declaration.
 * @returns a Cordis service class named `spec.service`. It registers the component and, with `dvModels.labelTasks`,
 *   the task labels; registers the operation while the catalog serves one of `spec.tasks`, with `deterministic: false`,
 *   `resource: 'gpu'` and the spec's label; draws and reports the seed unless `spec.seed`
 *   is false; refuses a call before its record with every reason of `check` and a closing sentence, which for an
 *   unavailable model says that no change to the call helps; imports the outputs through `spec.toOutputs`; and
 *   implements `GenerationApi`.
 */
export function defineGeneration<P extends PrimitiveId>(spec: GenerationSpec<P>): new (ctx: Context) => Service & GenerationApi {
  // The task names are the keys of the label record; Object.keys loses their type.
  const tasks = Object.keys(spec.tasks) as Array<TaskOfPrimitive<P>>
  // Under exactOptionalPropertyTypes each key present in the partial record holds a label.
  const taskLabels = spec.tasks as Readonly<Record<string, { zh: string; en: string }>>
  const operationParams: OperationSpec['params'] = {
    ...KEY_PARAMS, ...spec.params, ...spec.seed === false ? {} : SEED_PARAM, ...EXTRA_PARAM,
  }
  return class GenerationService extends Service implements GenerationApi {
    static inject = ['dvProject', 'dvModels']

    constructor(ctx: Context) {
      super(ctx, spec.service)
      ctx.effect(() => ctx.dvProject.registerComponent(spec.component), `${spec.service} component`)
      ctx.effect(() => ctx.dvModels.labelTasks(taskLabels), `${spec.service} task labels`)
      ctx.effect(() => ctx.dvModels.whileServing(tasks, () => ctx.dvProject.registerOperation(this.operation())),
        `${spec.service} ${spec.operation}`)
      ctx.inject(['dvCanvasNodes'], (canvas) => {
        canvas.effect(() => canvas.dvCanvasNodes.registerMaker({ operations: [spec.operation], ...spec.node }), `${spec.service} canvas nodes`)
      })
    }

    async render(call: GenerationCall): Promise<RecordId> {
      const { record } = await this.ctx.dvProject.run({ ...call, operation: spec.operation })
      /* v8 ignore next -- a generation operation is not a read, so it always writes a record. */
      if (record === null) throw new Error(`${spec.operation} wrote no record.`)
      return record.id
    }

    async check(call: Pick<GenerationCall, 'project' | 'params' | 'inputs'>, state: ProjectState,
      chained: readonly string[] = []): Promise<string[]> {
      return (await this.refusal(call, state, chained)).reasons
    }

    /** The reasons of `check`, and `UNAVAILABLE_END` for an unavailable model, else `REFUSAL_END`. */
    private async refusal(call: Pick<GenerationCall, 'project' | 'params' | 'inputs'>, state: ProjectState,
      chained: readonly string[]): Promise<Refusal> {
      try {
        const entry = this.ctx.dvModels.resolve(tasks, call.params)
        const unavailable = (error: unknown): never => { throw new Unavailable(entry, error) }
        const target = executionTarget(entry, call.params)
        const facts = await entry.facts(target).catch(unavailable)
        const inputs: RequestInput[] = [
          ...call.inputs.flatMap(({ role, ref }) =>
            this.assetsOf(call.project, state, ref).map(asset => ({ role, ref, resolved_asset: asset }))),
          ...chained.map(role => ({ role, ref: null, resolved_asset: null })),
        ]
        const { request } = requestOf(spec, facts, call.params, inputs)
        // An input without an asset yet (its producer has not finished, or the role is chained): execute checks the
        // full request before the model runs.
        if (inputs.some(input => input.resolved_asset === null)) return { reasons: [], end: REFUSAL_END }
        const problems = await entry.validateGenerationRequest(request, target).catch(unavailable)
        return { reasons: problems.length === 0 ? [] : [modelReason(entry, problems)], end: REFUSAL_END }
      } catch (error) {
        return { reasons: [messageOf(error)], end: error instanceof Unavailable ? UNAVAILABLE_END : REFUSAL_END }
      }
    }

    parseInputs(raw: Record<string, string | string[]>, state: ProjectState): RunRequest['inputs'] {
      return this.ctx.dvProject.parseInputs(spec.operation, raw, state)
    }

    /** The assets that one input reference stands for; null for an output of a record that has not finished. */
    private assetsOf(project: ProjectId, state: ProjectState, ref: RecordInputRef): Array<AssetId | null> {
      if (!('record' in ref)) return 'asset' in ref ? [ref.asset] : this.ctx.dvProject.assetsOf(state, ref) ?? []
      const producer = this.ctx.dvProject.getRecord(project, ref.record)
      return [producer.status === 'done' ? producer.outputs[ref.output] ?? null : null]
    }

    /** Throw the refusal of a call that `check` finds reasons against; no role is chained on this path. */
    private async refuse(call: GenerationCall, state: ProjectState): Promise<void> {
      const { reasons, end } = await this.refusal(call, state, [])
      if (reasons.length > 0) throw new Error(`${reasons.join(' ')} ${end}`)
    }

    /**
     * Run one model call and store its outputs. The model checks the request again, with every input asset known.
     * The record carries the seed in its report.
     */
    private async execute(run: OperationContext): Promise<OperationResult> {
      const entry = this.ctx.dvModels.resolve(tasks, run.params)
      const target = executionTarget(entry, run.params)
      const facts = await entry.facts(target)
      const { request, seed } = requestOf(spec, facts, run.params, run.inputs)
      const problems = await entry.validateGenerationRequest(request, target)
      if (problems.length > 0) throw new Error(`${modelReason(entry, problems)} ${REFUSAL_END}`)
      const result = await spec.toOutputs(this.ctx, run, entry.render(request, run.signal, target), facts, request)
      return seed === null ? result : { ...result, report: { seed, ...result.report } }
    }

    /** The operation of the declaration. */
    private operation(): OperationSpec {
      const { label, toolParams } = spec
      return {
        name: spec.operation, component: spec.component, version: '1', label, description: spec.description,
        params: operationParams,
        inputs: spec.inputs, outputs: spec.outputs, ...toolParams === undefined ? {} : { toolParams },
        deterministic: false, resource: 'gpu',
        isConcurrencySafe: params => this.ctx.dvModels.list().some(entry => entry.concurrentRenders === true
          && entry.modality === params['modality'] && entry.task === params['task']
          && entry.provider === params['provider'] && entry.model === params['model']),
        summarize: record => spec.summarize(record),
        prepareToolCall: async (call) => {
          spec.prepareToolCall?.(call)
          assertVideoSelection(call.request, call.state)
          await this.refuse(call.request, call.state)
        },
        precondition: (request, state) => {
          assertVideoSelection(request, state)
          return this.refuse(request, state)
        },
        execute: run => this.execute(run),
      }
    }
  }
}
