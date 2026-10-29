/**
 * Project messages: how the agent of a chat session learns about its project without a per-step system prompt.
 *
 * The agent gets the project state once, as the project state message: at the first step that has a bound project and
 * no view of it, and again when compaction or tool-result trimming shadowed that message. Afterwards each step whose
 * project changed in a way the agent has not seen gets one project update message: each record of the history list up
 * to the current position that the agent never saw, each such record it saw unfinished that has finished since, and
 * one line when the current position moved. Records that the agent's own tool results showed are not repeated, and a
 * step with nothing new gets no message.
 *
 * What the agent saw is the `dvProjectSight` session projection of the `project-sight` module, folded from the
 * session's own log. The `agent/pre-step` listener adds the message after the step's claimed messages; the agent loop
 * logs it as a `user/message`, appended after the cached history, so each request extends the previous one.
 *
 * Calls the `dvProject` service's public reads and the project summary of the `proj-tools` module. Called by the
 * service, which registers the listener and the projection while the DSH `sessionProjections` service is mounted.
 *
 * @module @dv/project/project-updates
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { outputLine, outputsOf } from './agent-tools.ts'
import type DvProject from './index.ts'
import {
  PROJECT_MESSAGE_KIND, SEEN_PROJECTION, ancestry, finished, seenProjection, type SessionSeen,
} from './project-sight.ts'
import { projectSummary, specOf, summaryOf, type ProjToolDeps } from './proj-tools.ts'
import type { ProjectId, ProjectRecord, SessionId, Surface } from './types.ts'

/** The first line of every project state message. */
export const STATE_HEAD = 'DreamVerse project state.'

/** The first line of every project update message. */
export const UPDATE_HEAD = 'DreamVerse project updates since your last step:'

/** Who a user record line names, by surface. */
const USER_SURFACE: Record<Surface, string> = {
  chat: 'user in chat', canvas: 'user on canvas', timeline: 'user on timeline', asset_pool: 'user in asset pool',
  api: 'user via API', history: 'user in history',
}

/** Who a record line names: the user's surface, `your call`, `another chat`, or `scheduled`. */
function whoOf(record: ProjectRecord, session: SessionId): string {
  switch (record.actor) {
    case 'user': return USER_SURFACE[record.surface]
    case 'agent': return record.session === session ? 'your call' : 'another chat'
    case 'system': return 'scheduled'
    default: return assertNever(record.actor)
  }
}

/** The lines of one record: `- <status> <record> (<who>): <text>`, then a done record's outputs, indented. */
function recordLines(project: DvProject, deps: ProjToolDeps, record: ProjectRecord, session: SessionId): string[] {
  const head = `- ${record.status} ${record.id} (${whoOf(record, session)}): `
  switch (record.status) {
    case 'done': {
      const outputs = outputsOf(specOf(project, record)?.outputs ?? [], record, deps.assets())
      return [`${head}${summaryOf(project, record)}`, ...outputs.map(output => `  ${outputLine(output)}`)]
    }
    case 'failed':
    case 'cancelled': return [`${head}${record.intent}: ${record.error?.message ?? record.status}`]
    case 'pending':
    case 'running': return [`${head}${record.intent}`]
    default: return assertNever(record.status)
  }
}

/**
 * The text of a project state message: the binding sentence, then the project summary of the current state without
 * the `report` of its recent records, as indented JSON (the format `dv_proj_state` returns).
 * @param project - the service.
 * @param deps - the asset store and the reducers' summaries.
 * @param id - the project.
 * @returns the text.
 */
export function renderState(project: DvProject, deps: ProjToolDeps, id: ProjectId): string {
  const summary = projectSummary(project, deps, id, project.getState(id), { written: null, reports: false })
  return [
    `${STATE_HEAD} This conversation belongs to project ${id}: do all work in it and never call dv_proj_create or `
      + 'dv_proj_open. Later changes that your own tool results did not show reach you as DreamVerse project updates. '
      + 'The project summary, as dv_proj_state returns it without the reports of recent records:',
    JSON.stringify(summary, null, 1),
  ].join('\n')
}

/**
 * The project message one step of a session needs, or null.
 * - No bound project: null.
 * - No project state message in the state, or one of another project: the project state message, whose source shows
 *   every record written so far (`base`), the unfinished ones in their status, and the current position.
 * - Otherwise the project update message, or null when it would be empty. It lists, in write order, each record of the
 *   history list up to the current position that the session never saw, or saw unfinished and is finished now. Before
 *   them, when the current position changed and the listed records do not explain it (the new position is a record the
 *   session saw, or the old one left the history list), it says
 *   `- history: the current step is <at>; dv_proj_history_list shows which steps are undone or discarded.`
 *   Its source shows the listed records in their status and the current position.
 * ```
 * DreamVerse project updates since your last step:
 * - done r_5a10 (user on canvas): imported knife.png
 *   - asset: 7be3… (image/png) https://…/dv/assets/7be3…
 * - failed r_7c22 (scheduled): shot 3 of plan p1 v2: The backend refused the request.
 * - running r_5b20 (user on canvas): render shot 3 again
 * ```
 * A record line names the user's surface for a user record, `your call` for an agent record of this session,
 * `another chat` for an agent record of another session, and `scheduled` for a system record; its text is the
 * operation's summary for a done record, `<intent>: <error message>` for a failed or cancelled one, and the intent for
 * an unfinished one. A done record's outputs follow in the output line format of the operation tool results.
 * @param project - the service.
 * @param deps - the asset store and the reducers' summaries.
 * @param session - the agent's session ID.
 * @param seen - the session's `dvProjectSight` state.
 * @returns the message, or null.
 */
export function projectMessage(project: DvProject, deps: ProjToolDeps, session: SessionId, seen: SessionSeen): UserMessage | null {
  const id = project.sessionProject(session)
  if (id === null) return null
  const records = project.listRecords(id)
  const { at } = project.line(id)
  if (seen.from === null || seen.project !== id) {
    const text = renderState(project, deps, id)
    const open = Object.fromEntries(records.filter(record => !finished(record.status)).map(record => [record.id, record.status]))
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: PROJECT_MESSAGE_KIND, shown: { project: id, base: records.length, at, records: open }, form: 'snapshot',
        sections: [{ name: PROJECT_MESSAGE_KIND, text }],
      },
    })
  }
  const chain = ancestry(new Map(records.map(record => [record.id, record])), at)
  const shown = new Map(records.map((record, index) => [record.id, seen.records[record.id] ?? (index < seen.base ? 'done' : undefined)]))
  const listed = records.filter((record) => {
    const status = shown.get(record.id)
    return chain.has(record.id) && (status === undefined || (!finished(status) && finished(record.status)))
  })
  const moved = at !== seen.at && (shown.get(at) !== undefined || !chain.has(seen.at))
  if (listed.length === 0 && !moved) return null
  const lines = [
    UPDATE_HEAD,
    ...moved ? [`- history: the current step is ${at}; dv_proj_history_list shows which steps are undone or discarded.`] : [],
    ...listed.flatMap(record => recordLines(project, deps, record, session)),
  ]
  const ids = [...moved ? [at] : [], ...listed.map(record => record.id)]
  return createUserMessage({
    content: [{ type: 'text', text: lines.join('\n') }],
    source: {
      kind: PROJECT_MESSAGE_KIND, form: 'notice', summary: boundContextSummary(`${String(ids.length)} project changes: ${ids.join(', ')}`),
      shown: { project: id, at, records: Object.fromEntries(listed.map(record => [record.id, record.status])) },
    },
  })
}

/**
 * Register the `dvProjectSight` projection and the `agent/pre-step` listener under `ctx`. The listener awaits `next()`
 * and returns a reject decision, an aborted step, and an empty decision of a step that will not run (the first step of
 * a turn, or a step whose claimed messages a later listener removed) unchanged; otherwise it inserts
 * {@link projectMessage}'s message right after the last claimed message, so the user's own message precedes it.
 * @param ctx - a context with the `sessionProjections` service; disposal removes both.
 * @param project - the service.
 * @param deps - the asset store and the reducers' summaries.
 */
export function registerProjectUpdates(ctx: Context, project: DvProject, deps: ProjToolDeps): void {
  ctx.sessionProjections.register(seenProjection())
  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision
    const seen = ctx.sessionProjections.stateOf(agent.session, SEEN_PROJECTION)
    if (seen === undefined) return decision
    const message = projectMessage(project, deps, brandString<SessionId>(agent.id), seen)
    if (message === null) return decision
    const last = decision.messages.findLastIndex(entry => messages.includes(entry))
    return { ...decision, messages: decision.messages.toSpliced(last + 1, 0, message) }
  })
}
