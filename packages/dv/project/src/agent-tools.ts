/**
 * The agent tools of operations: the shared helper that turns each registered operation into its DSH tool
 * `dv_<operation name with _>`. A tool call is one `run` as the agent: the `reason` argument is the record's intent,
 * `inputs` names assets, versions of the registered reference kinds, or outputs of earlier records by role, and the
 * result names the record, its outputs with their URLs, and the records the call scheduled. Image outputs also reach
 * the model as image blocks through the attachment service. The result's presentation metadata also stores, as
 * `dv_seen`, the record in the status the result returned and each scheduled record as `pending` (a `records`
 * sighting of the `project-sight` module), so the project updates do not repeat them; a read stores none.
 *
 * Confirmation: an operation whose `confirm` is `always` gets the tool-only argument `user_approved`; a call that
 * lacks it is refused, before anything is written, with the operation's `confirmSummary` and the instruction to ask
 * the user in the conversation with the question in bold. The record's turn is the DSH turn number of the calling
 * agent's session, read from the `turnBoundary` session projection.
 *
 * Calls the sessions module (project binding, held work), the asset store (output types, bytes, URLs), and the
 * service's run, state, record, operation and history reads through {@link AgentToolDeps}. Called by the service,
 * which registers and removes the tools while the DSH `tools` registry is mounted.
 *
 * @module @dv/project/agent-tools
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ParameterSchemaSpec, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { splitInputRef } from './grammar.ts'
import type { OperationSpec, OperationToolCall } from './operation-types.ts'
import { SIGHTING_META_KEY } from './project-sight.ts'
import type { Sessions } from './sessions.ts'
import { ProjectError } from './shared.ts'
import type {
  AssetId, AssetStore, HistoryEntry, HistoryQuery, OperationOutput, ProjectId, ProjectRecord, ProjectState, RecordId,
  ProjectSighting, RecordInputRef, RecordOrigin, RecordStatus, RunRequest, RunResult, SessionId, TurnId,
} from './types.ts'

/** What the agent tools read and call. */
export interface AgentToolDeps {
  sessions: Sessions
  /** The registered asset store; throws when none is registered. */
  assets(): AssetStore
  /** The service's read of the project's current state, which every write follows. */
  currentState(project: ProjectId): ProjectState
  /** The registered reference kinds, in registration order. */
  listReferenceKinds(): readonly string[]
  /** The reference kinds that have version `version` of `id` in the state, in registration order. */
  kindsWithVersion(state: ProjectState, id: string, version: number): string[]
  run(request: RunRequest): Promise<RunResult>
  getRecord(project: ProjectId, record: RecordId): ProjectRecord
  listHistory(query: HistoryQuery): HistoryEntry[]
}

/** The session of a call without an agent: direct SDK calls. */
const ANONYMOUS_SESSION = 'anonymous'

/** The raster formats that can reach the model as image blocks. */
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set<ImageMediaType>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** The arguments every operation tool takes besides the operation's params; they never reach the run's params. */
const SHARED_ARGS = ['reason', 'project_id', 'inputs', 'supersedes', 'based_on'] as const

/** The tool-only confirmation argument of each `OperationSpec.confirm` value, as the model sees it. */
const CONFIRM_PARAMS: Record<OperationSpec['confirm'], ParameterSchemaSpec> = {
  never: {},
  always: {
    user_approved: {
      type: 'boolean',
      description: 'Set true only after the user agreed to this exact call in the conversation. Without it the call is refused '
        + 'with what to show the user and ask.',
    },
  },
}

/** The reference kinds as reference parsing reads them. */
export type ReferenceKindLookup = Pick<AgentToolDeps, 'listReferenceKinds' | 'kindsWithVersion'>

/** One output of a record in a tool result: its role, asset ID, media type and URL. */
export const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    role: { type: 'string', required: true }, asset_id: { type: 'string', required: true }, mime: { type: 'string', required: true },
    url: { type: 'string', required: true },
  },
} as const

/** The value every operation tool returns to the model. */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    project: { type: 'string', required: true, description: 'The project of this call; not shown to the model.' },
    record: { type: 'string', required: true, description: 'The record of this call; empty for a read, which writes no record.' },
    status: { type: 'string', required: true, description: 'done, or pending (scheduled behind records that have not finished).' },
    summary: { type: 'string', required: true },
    outputs: { type: 'array', required: true, items: OUTPUT_SCHEMA },
    scheduled: {
      type: 'array', required: true, items: { type: 'string' },
      description: 'Records this call scheduled to run later, after the records they wait for.',
    },
    params: { type: 'json', required: true, description: 'The recorded params.' },
    report: {
      type: 'json', description: 'What the operation found beyond its outputs: the seed it drew, the metadata it read, an answer.',
    },
    images: { type: 'array', items: { type: 'json' }, description: 'Attachment references of the image outputs, shown to you as images.' },
  },
} as const

/** The result value of an operation tool call; a type literal so a validated `JsonValue` can be asserted to it. */
export type OperationToolValue = {
  project: string
  record: string
  status: string
  summary: string
  outputs: ToolOutput[]
  scheduled: string[]
  params: JsonValue
  report?: JsonValue
  images?: JsonValue[]
}

/** One output of a record in a tool result. */
export type ToolOutput = { role: string; asset_id: string; mime: string; url: string }

/**
 * The outputs of a record in a tool result, in the record's order.
 * @param outputs - the record's operation's declared outputs; a record output past them gets the role `output_<index>`.
 * @param record - the record.
 * @param assets - the asset store, for each output's media type and URL.
 * @returns one entry per record output.
 */
export function outputsOf(outputs: readonly OperationOutput[], record: ProjectRecord, assets: AssetStore): ToolOutput[] {
  return record.outputs.map((id, index) => ({
    role: outputs[index]?.role ?? `output_${index}`, asset_id: id, mime: assets.get(id).mime, url: assets.url(id),
  }))
}

/**
 * The result line of one output.
 * @param output - the output.
 * @returns `- <role>: <asset ID> (<media type>) <URL>`.
 */
export function outputLine(output: ToolOutput): string {
  return `- ${output.role}: ${output.asset_id} (${output.mime}) ${output.url}`
}

/**
 * The DSH tool name of an operation: dots become underscores because provider function names allow no dots.
 * @param spec - the operation.
 * @returns `dv_<name with _>`.
 */
export function toolNameOf(spec: Pick<OperationSpec, 'name'>): string {
  return `dv_${spec.name.replaceAll('.', '_')}`
}

/**
 * The chat session a tool call belongs to.
 * @param exec - the call.
 * @returns the calling agent's session ID, or the shared anonymous session for a call without an agent.
 */
export function sessionOf(exec: Pick<ToolRunContext, 'agent'>): SessionId {
  return brandString<SessionId>(exec.agent?.id ?? ANONYMOUS_SESSION)
}

/**
 * The agent turn a tool call belongs to: the DSH turn number of the calling agent's session, from the `turnBoundary`
 * session projection that the agent loop registers.
 * @param ctx - a context that may hold the `sessionProjections` registry.
 * @param exec - the call.
 * @returns the turn, or null for a call without an agent or outside any turn.
 */
export function turnOf(ctx: Context, exec: Pick<ToolRunContext, 'agent'>): TurnId | null {
  const session = exec.agent?.session
  const turn = session === undefined ? undefined : ctx.get('sessionProjections')?.stateOf(session, 'turnBoundary')?.lastTurn
  return turn === undefined || turn === 0 ? null : brandString<TurnId>(String(turn))
}

/**
 * Turn one input reference text into a record input reference: the syntax of `splitInputRef`, with the kind of a
 * version found among the registered reference kinds.
 * @param ref - the reference text.
 * @param state - the state the version is looked up in.
 * @param kinds - the registered reference kinds.
 * @returns the reference.
 * @throws ProjectError `invalid_inputs` for `<id>@<n>` that no reference kind, or more than one, has.
 */
export function parseInputRef(ref: string, state: ProjectState, kinds: ReferenceKindLookup): RecordInputRef {
  const syntax = splitInputRef(ref)
  if ('asset' in syntax) return { asset: brandString<AssetId>(syntax.asset) }
  if ('record' in syntax) return { record: brandString<RecordId>(syntax.record), output: syntax.output }
  const { id, version } = syntax
  const [kind, ...others] = kinds.kindsWithVersion(state, id, version)
  const known = kinds.listReferenceKinds().join(', ') || 'none'
  if (kind === undefined) throw new ProjectError('invalid_inputs', `Unknown version '${ref}'; reference kinds: ${known}.`)
  if (others.length > 0) {
    throw new ProjectError('invalid_inputs', `Version '${ref}' names more than one reference kind: ${[kind, ...others].join(', ')}.`)
  }
  const fields: Record<string, string | number> = { [kind]: id, version }
  return fields as RecordInputRef
}

/**
 * Turn the `inputs` argument of a tool call or a view request into run inputs, checking roles against the operation.
 * @param spec - the operation.
 * @param raw - role → reference text or a list of them; undefined for none.
 * @param state - the state the references are read against.
 * @param kinds - the registered reference kinds.
 * @param callerName - the name the error messages give the call: the tool name for an agent tool call, the operation
 *   name for a view request.
 * @returns the inputs in argument order.
 * @throws Error naming the role and `callerName` for an unknown role, a list on a single role, a non-string reference,
 *   or a missing required role; ProjectError `invalid_inputs` for an unknown or ambiguous version.
 */
export function parseInputs(
  spec: OperationSpec, raw: unknown, state: ProjectState, kinds: ReferenceKindLookup, callerName: string,
): RunRequest['inputs'] {
  const inputs: RunRequest['inputs'] = []
  if (raw !== undefined) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('inputs must be an object of role to reference(s).')
    for (const [role, value] of Object.entries(raw)) {
      const input = spec.inputs[role]
      if (input === undefined) {
        throw new Error(`Unknown input role "${role}" for ${callerName}; roles: ${Object.keys(spec.inputs).join(', ') || 'none'}.`)
      }
      const refs: unknown[] = Array.isArray(value) ? value : [value]
      if (refs.length > 1 && input.many !== true) throw new Error(`Input "${role}" of ${callerName} takes one reference.`)
      for (const ref of refs) {
        if (typeof ref !== 'string' || ref === '') {
          throw new Error(`Input "${role}" of ${callerName} must be <asset>, <record>#<output>, or <id>@<version>.`)
        }
        inputs.push({ role, ref: parseInputRef(ref, state, kinds) })
      }
    }
  }
  for (const [role, input] of Object.entries(spec.inputs)) {
    if (input.required === true && !inputs.some(entry => entry.role === role)) throw new Error(`${callerName} needs input "${role}".`)
  }
  return inputs
}

/** A JSON copy of a record's params, report, a project summary, or an attachment reference. */
export function toJson(value: object): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** A string argument, or undefined when absent or empty. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The project a tool call works on.
 * @param argument - the call's `project_id` argument.
 * @param bound - the project the call's chat session is bound to, or null.
 * @returns the argument, else the bound project.
 * @throws Error telling the model to create or open a project first when neither names one.
 */
export function callProject(argument: unknown, bound: ProjectId | null): ProjectId {
  const id = optionalString(argument) ?? bound
  if (id === null) throw new Error('No project selected: call dv_proj_create or dv_proj_open first, or pass project_id.')
  return brandString<ProjectId>(id)
}

/**
 * The registered reference kinds as one phrase of agent text, such as "test_location, test_style or test_character".
 * @param kinds - the kinds in registration order.
 * @returns the phrase; empty when no kind is registered.
 */
export function kindListText(kinds: readonly string[]): string {
  return [kinds.slice(0, -1).join(', '), ...kinds.slice(-1)].filter(part => part !== '').join(' or ')
}

/**
 * The params every operation tool shares, as the model sees them.
 * @param spec - the operation.
 * @param kinds - the registered reference kinds, which the `inputs` text lists.
 * @returns the shared params.
 */
function sharedParams(spec: OperationSpec, kinds: readonly string[]): ParameterSchemaSpec {
  // The `inputs` text names `<id>@<version>` only while a reference kind is registered, such as "a prop version".
  const versionText = kinds.length === 0 ? '' : `, or <id>@<version> (a ${kindListText(kinds)} version; dv_proj_state lists IDs)`
  const roles = Object.entries(spec.inputs).map(([role, input]) => `${role}${input.required === true ? '' : '?'}: ${input.type}`
    + `${input.many === true ? '[]' : ''}${input.versioned === true ? ' (<asset> or <id>@<version>)' : ''}`)
  return {
    reason: {
      type: 'string', required: true,
      description: 'Why you call this, in the user\'s words or your own summary; recorded as the intent of the record.',
    },
    project_id: {
      type: 'string', description: 'The project; defaults to this conversation\'s project from dv_proj_create or dv_proj_open.',
    },
    ...Object.keys(spec.inputs).length === 0 ? {} : {
      inputs: {
        type: 'object', additionalProperties: true,
        description: 'Input references by role: <asset> (an asset ID), <record>#<output> (an output of an earlier record)'
          + `${versionText}; a list for roles marked []. Roles: ${roles.join('; ')}.`,
      },
    },
    ...spec.readOnly === true ? {} : {
      supersedes: {
        type: 'array', items: { type: 'string' },
        description: 'Records whose outputs this call replaces, such as an earlier take; their consumers become stale.',
      },
      based_on: { type: 'string', description: 'The record this call is a changed copy of; the takes of one original share it.' },
    },
  }
}

/**
 * The content blocks the model reads for an operation tool result: one text block, then the image outputs.
 * @param value - the result.
 * @param spec - the operation; `omitParamsFromResult` leaves out the `params:` line.
 * @returns the content blocks.
 */
export function formatToolResult(value: OperationToolValue, spec: Pick<OperationSpec, 'omitParamsFromResult'>): ContentBlock[] {
  const lines = [value.record === '' ? `${value.status}: ${value.summary}` : `${value.status} ${value.record}: ${value.summary}`]
  lines.push(...value.outputs.map(outputLine))
  if (value.scheduled.length > 0) lines.push(`scheduled: ${value.scheduled.join(', ')}`)
  if (spec.omitParamsFromResult !== true) lines.push(`params: ${JSON.stringify(value.params)}`)
  if (value.report !== undefined) lines.push(`report: ${JSON.stringify(value.report)}`)
  const images = (value.images ?? []).flatMap((image): ContentBlock[] => isImageRef(image) ? [{ type: 'image', attachment: image }] : [])
  return [{ type: 'text', text: lines.join('\n') }, ...images]
}

/** Whether a JSON value is an attachment reference. */
function isImageRef(value: JsonValue): value is JsonValue & ImageAttachmentRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value['attachmentId'] === 'string'
    && typeof value['mediaType'] === 'string'
}

/** Builds the DSH tool of an operation and runs its calls. */
export class AgentTools {
  /**
   * @param ctx - the service context; the attachment service is read from it at call time.
   * @param deps - what the tools read and call.
   */
  constructor(private readonly ctx: Context, private readonly deps: AgentToolDeps) {}

  /**
   * The DSH tool of an operation.
   * @param spec - the operation.
   * @returns the tool definition.
   */
  define(spec: OperationSpec): ToolDefinition {
    const name = toolNameOf(spec)
    const parameters: ParameterSchemaSpec = {
      ...spec.params, ...spec.toolParams, ...CONFIRM_PARAMS[spec.confirm], ...sharedParams(spec, this.deps.listReferenceKinds()),
    }
    // The description ends with where the operation runs and whether it writes a record or reuses earlier results.
    const hints = [
      spec.resource === 'gpu' ? 'Uses the GPU.' : spec.resource === 'cpu' ? 'Runs on the CPU.' : '',
      spec.readOnly === true ? 'A read that writes no record.'
        : spec.deterministic ? 'Repeating a call with the same inputs and params reuses the earlier result.' : '',
    ].filter(hint => hint !== '')
    return defineTool({
      name,
      description: [spec.description, ...hints].join(' '),
      parameters,
      output: {
        schema: RESULT_SCHEMA,
        render: (_args, value) => formatToolResult(value, spec),
        presentationMeta: (_args, value) => {
          const card = { record: value.record, tool: spec.name, status: value.status, outputs: value.outputs }
          if (value.record === '') return card
          const sighting: ProjectSighting = {
            kind: 'records', project: brandString<ProjectId>(value.project),
            records: [
              { record: brandString<RecordId>(value.record), status: value.status as RecordStatus },
              ...value.scheduled.map(id => ({ record: brandString<RecordId>(id), status: 'pending' as const })),
            ],
          }
          return { ...card, [SIGHTING_META_KEY]: toJson(sighting) }
        },
      },
      execute: (args, exec) => this.call(spec, args, exec),
    })
  }

  /**
   * Run one tool call: wait for the session's held work, resolve the project and the inputs against the project's
   * current state, let the operation prepare the call, refuse it when it needs the user's agreement, run it as the
   * agent, and describe the record.
   */
  private async call(spec: OperationSpec, args: Record<string, unknown>, exec: ToolRunContext): Promise<OperationToolValue> {
    const { sessions } = this.deps
    const session = sessionOf(exec)
    await sessions.ready(session)
    const project = callProject(args['project_id'], sessions.project(session))
    const origin: RecordOrigin = {
      actor: 'agent', surface: 'chat', session, turn: turnOf(this.ctx, exec), tool_call: exec.callId,
      intent: optionalString(args['reason']) ?? spec.name,
    }
    const state = this.deps.currentState(project)
    const toolOnly = new Set<string>([...SHARED_ARGS, ...Object.keys(spec.toolParams ?? {}), ...Object.keys(CONFIRM_PARAMS[spec.confirm])])
    const params = Object.fromEntries(Object.entries(args).filter(([key]) => !toolOnly.has(key)))
    const basedOn = optionalString(args['based_on'])
    const supersedes = args['supersedes']
    const request: RunRequest = {
      ...origin, project, operation: spec.name, params,
      inputs: parseInputs(spec, args['inputs'], state, this.deps, toolNameOf(spec)),
      signal: exec.signal,
      ...basedOn === undefined ? {} : { based_on: brandString<RecordId>(basedOn) },
      ...Array.isArray(supersedes) ? { supersedes: supersedes.map(id => brandString<RecordId>(String(id))) } : {},
    }
    await spec.prepareToolCall?.({ args, request, state, exec })
    this.confirm(spec, { args, request, state, exec })
    if (this.waitsForProducer(project, spec, request.inputs)) request.after = []
    const before = new Set(this.deps.listHistory({ project }).map(entry => entry.record.id))
    const result = await this.deps.run(request)
    const record = result.record
    // A read writes no record: its answer is the report.
    if (record === null) {
      return {
        project, record: '', status: 'done', summary: `${toolNameOf(spec)} answered`, outputs: [], scheduled: [], params: toJson(request.params),
        ...result.report === null ? {} : { report: toJson(result.report) },
      }
    }
    if (record.status === 'failed' || record.status === 'cancelled') throw failureOf(spec, record)
    // The records this call scheduled: `system` records of the same session that did not exist before the call.
    const scheduled = this.deps.listHistory({ project, actor: 'system', kind: 'operation' })
      .map(entry => entry.record).filter(other => !before.has(other.id) && other.session === session)
      .map(other => other.id).reverse()
    return await this.valueOf(spec, project, record, scheduled)
  }

  /**
   * Refuse a call that needs the user's agreement and does not carry it (`OperationSpec.confirm`): `always` needs
   * `user_approved: true`. The refusal names what the call will do and tells the model to ask in the conversation,
   * with the question in bold.
   * @param spec - the operation.
   * @param call - the parsed call, after `prepareToolCall`.
   * @throws Error with the refusal text.
   */
  private confirm(spec: OperationSpec, call: OperationToolCall): void {
    if (spec.confirm === 'never' || spec.confirmSummary === undefined) return
    if (call.args.user_approved === true) return
    const summary = spec.confirmSummary(call, call.state)
    throw new Error([
      `${toolNameOf(spec)} needs the user's agreement.`,
      'What it will do:', summary.text,
      'Show this to the user and ask in the conversation, with the question in bold (for example **Run this now?**). '
        + 'Wait for the user\'s answer, then call again with user_approved: true.',
    ].join('\n'))
  }

  /**
   * Whether an input names the output of a record that has not finished, so the call must be scheduled behind it; an
   * input of one of the operation's `pendingInputRoles` never makes the call wait.
   */
  private waitsForProducer(project: ProjectId, spec: OperationSpec, inputs: RunRequest['inputs']): boolean {
    return inputs.some((input) => {
      if (!('record' in input.ref) || spec.pendingInputRoles?.includes(input.role) === true) return false
      try {
        return this.deps.getRecord(project, input.ref.record).status !== 'done'
      } catch {
        // An unknown record is refused by the run itself, with its own message.
        return false
      }
    })
  }

  /** Attachment references of the image outputs, when an attachment service is mounted. */
  private async imagesOf(outputs: AssetId[]): Promise<ImageAttachmentRef[]> {
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) return []
    const assets = this.deps.assets()
    const refs: ImageAttachmentRef[] = []
    for (const id of outputs) {
      const meta = assets.get(id)
      if (!IMAGE_MEDIA_TYPES.has(meta.mime)) continue
      refs.push(await attachments.saveImage({ data: assets.read(id), mediaType: meta.mime as ImageMediaType, name: meta.name }))
    }
    return refs
  }

  /** The result value of a record. */
  private async valueOf(
    spec: OperationSpec, project: ProjectId, record: ProjectRecord, scheduled: RecordId[],
  ): Promise<OperationToolValue> {
    const assets = this.deps.assets()
    const images = record.status === 'done' ? await this.imagesOf(record.outputs) : []
    return {
      project,
      record: record.id,
      status: record.status,
      summary: record.status === 'done' ? spec.summarize(record) : `${toolNameOf(spec)} ${record.status}`,
      outputs: outputsOf(spec.outputs, record, assets),
      scheduled,
      params: toJson(record.params),
      ...record.report === undefined ? {} : { report: toJson(record.report) },
      ...images.length === 0 ? {} : { images: images.map(toJson) },
    }
  }
}

/**
 * The error a call reports when its record did not finish `done`: the failure message, or that the turn was stopped.
 * @param spec - the operation.
 * @param record - the record in its final status.
 * @returns the error.
 */
function failureOf(spec: OperationSpec, record: ProjectRecord): Error {
  if (record.error?.code === 'stopped') return new Error(`${toolNameOf(spec)} was stopped before it finished.`)
  return new Error(record.error?.message ?? `${toolNameOf(spec)} ${record.status}`)
}
