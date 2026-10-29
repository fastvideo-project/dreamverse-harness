/**
 * Project messages: how the agent of a chat session learns about its project without a per-step system prompt.
 *
 * The agent gets the project state once, as the project state message: at the first step that has a bound project and
 * no view of it, and again when compaction or tool-result trimming shadowed the view it relied on. Afterwards each step
 * whose project changed in a way the agent has not seen gets one project update message: records that the user,
 * another chat or the scheduler wrote, finishes of records the agent saw unfinished, moves of the current position, new
 * stale marks, and a new title. Records that the agent's own tool results showed are not repeated, and a step with
 * nothing new gets no message. What the agent saw is the `dvProjectSight` session projection of the `project-sight`
 * module, so an update is a pure function of that sight and the project store.
 *
 * The `agent/pre-step` listener adds the message after the step's claimed messages; the agent loop logs it as a
 * `user/message` whose source carries the mark it reported up to, appended after the cached history, so each request
 * extends the previous one and a replay reads the same text from the log.
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
  PROJECT_MESSAGE_KIND, SIGHT_PROJECTION, ancestry, finished, markOf, readProject, sightProjection, type ProjectReads,
  type SessionSight,
} from './project-sight.ts'
import { RECENT_RECORDS, projectSummary, specOf, summaryOf, type ProjToolDeps } from './proj-tools.ts'
import type { ProjectId, ProjectMark, ProjectRecord, RecordId, SessionId, Surface } from './types.ts'

/** The first line of every project state message. */
export const STATE_HEAD = 'DreamVerse project state.'

/** The first line of every project update message. */
export const UPDATE_HEAD = 'DreamVerse project updates since your last step:'

/**
 * One change of the project that the agent has not seen. The update message renders one line per change: moves first,
 * then records in write order, then stale marks, then the title.
 */
export type ProjectChange =
  /** The current position moved by undo, redo or a move to a step; who moved it is not recorded. */
  | { kind: 'moved'; at: RecordId; undone: RecordId[]; discarded: RecordId[]; back: RecordId[] }
  /** A record the agent never saw, in its status now, or a record it saw unfinished that has finished since. */
  | { kind: 'record'; record: ProjectRecord }
  /** Records that became stale, each with the record that replaced one of its inputs. */
  | { kind: 'stale'; records: Array<{ record: RecordId; reason: RecordId }> }
  | { kind: 'title'; title: string }

/** Who a user record line names, by surface. */
const USER_SURFACE: Record<Surface, string> = {
  chat: 'user in chat', canvas: 'user on canvas', timeline: 'user on timeline', asset_pool: 'user in asset pool',
  api: 'user via API', history: 'user in history',
}

/**
 * The changes between what the agent saw and the project as it stands, and the mark after them. Pure: running it twice
 * on the same inputs gives the same answer, and a later run on a store that moved forward gives a superset of the net
 * changes, because statuses only move forward and records are only appended.
 *
 * With `believed` = the history list up to `mark.at` plus the records written since the mark that `seen` names (the
 * agent's own calls appended them):
 * - a record written since the mark (index ≥ `mark.written`) that is on the history list up to the current position is
 *   reported unless `seen` names it, and its finish is reported when `seen` names it unfinished; one that is not on
 *   that list is skipped (it left the state before the agent saw it);
 * - a record written before the mark that the mark or `seen` shows unfinished is reported when it has finished, unless
 *   `seen` shows it finished;
 * - `moved` lists the records of `believed` that left the history list up to the current position (`undone` while
 *   they stay on the list after it, else `discarded`) and the records written before the mark that came back to it
 *   (`back`);
 * - `stale` lists stale records that the mark does not; `title` reports a changed title.
 * @param reads - the project reads.
 * @param sight - what the agent saw; its mark is for this project.
 * @returns the changes in render order, and the mark after them, whose `open` holds the records still unfinished among
 *   the history list up to the current position, the mark's open records, and the unfinished records `seen` names.
 */
export function projectChanges(
  reads: ProjectReads, sight: SessionSight & { mark: ProjectMark },
): { changes: ProjectChange[]; mark: ProjectMark } {
  const { mark, seen } = sight
  const byId = new Map(reads.records.map(record => [record.id, record]))
  const chain = ancestry(byId, reads.at)
  const tipChain = ancestry(byId, reads.tip)
  const believed = ancestry(byId, mark.at)
  // `shownOpen`: a tool result showed the record unfinished and none showed it finished since the mark.
  const shownOpen = (id: RecordId): boolean => seen[id] !== undefined && !finished(seen[id])
  const records: ProjectChange[] = []
  const back: RecordId[] = []
  reads.records.forEach((record, index) => {
    const shown = seen[record.id]
    if (index >= mark.written) {
      if (shown !== undefined) believed.add(record.id)
      const unseen = shown === undefined || (shownOpen(record.id) && finished(record.status))
      if (chain.has(record.id) && unseen) records.push({ kind: 'record', record })
      return
    }
    const knownOpen = mark.open.includes(record.id) || shownOpen(record.id)
    if (knownOpen && finished(record.status) && (shown === undefined || shownOpen(record.id))) records.push({ kind: 'record', record })
    if (chain.has(record.id) && !believed.has(record.id)) back.push(record.id)
  })
  const left = reads.records.map(record => record.id).filter(id => believed.has(id) && !chain.has(id))
  const changes: ProjectChange[] = []
  if (left.length > 0 || back.length > 0) {
    changes.push({
      kind: 'moved', at: reads.at, undone: left.filter(id => tipChain.has(id)), discarded: left.filter(id => !tipChain.has(id)), back,
    })
  }
  changes.push(...records)
  const stale = reads.records.filter(record => Object.hasOwn(reads.stale, record.id) && !mark.stale.includes(record.id))
    .map(record => ({ record: record.id, reason: reads.stale[record.id] as RecordId }))
  if (stale.length > 0) changes.push({ kind: 'stale', records: stale })
  if (reads.title !== mark.title) changes.push({ kind: 'title', title: reads.title })
  const now = markOf(reads, mark.project)
  const open = reads.records.filter(record => !finished(record.status)
    && (chain.has(record.id) || mark.open.includes(record.id) || shownOpen(record.id))).map(record => record.id)
  return { changes, mark: { ...now, open } }
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

/** The line of a move: the current position, then the records that left the state or came back to it. */
function movedLine(change: Extract<ProjectChange, { kind: 'moved' }>): string {
  const parts = [`- history: the current step is ${change.at}.`]
  if (change.undone.length > 0) parts.push(`Undone (dv_proj_redo can bring them back): ${change.undone.join(', ')}.`)
  if (change.discarded.length > 0) parts.push(`Discarded for good: ${change.discarded.join(', ')}.`)
  if (change.back.length > 0) parts.push(`Back in the state: ${change.back.join(', ')}.`)
  return parts.join(' ')
}

/**
 * The text of a project update message.
 * ```
 * DreamVerse project updates since your last step:
 * - history: the current step is r_9f30. Undone (dv_proj_redo can bring them back): r_a1, r_a2. Discarded for good: r_c4.
 * - done r_5a10 (user on canvas): imported knife.png
 *   - asset: 7be3… (image/png) https://…/dv/assets/7be3…
 * - failed r_7c22 (scheduled): shot 3 of plan p1 v2: The backend refused the request.
 * - running r_5b20 (user on canvas): render shot 3 again
 * - stale: r_7c21 (an input was replaced by r_5a10)
 * - title: "Knife ad 2"
 * ```
 * A record line names the user's surface for a user record, `your call` for an agent record of this session,
 * `another chat` for an agent record of another session, and `scheduled` for a system record; its text is the
 * operation's summary for a done record, `<intent>: <error message>` for a failed or cancelled one, and the intent for
 * an unfinished one. A done record's outputs follow in the output line format of the operation tool results.
 * @param project - the service, for the operation summaries.
 * @param deps - the asset store, for output media types and URLs.
 * @param changes - the changes, not empty.
 * @param session - the agent's session.
 * @returns the text.
 */
export function renderUpdate(project: DvProject, deps: ProjToolDeps, changes: readonly ProjectChange[], session: SessionId): string {
  const lines = [UPDATE_HEAD]
  for (const change of changes) {
    switch (change.kind) {
      case 'moved': lines.push(movedLine(change)); break
      case 'record': lines.push(...recordLines(project, deps, change.record, session)); break
      case 'stale':
        lines.push(`- stale: ${change.records.map(entry => `${entry.record} (an input was replaced by ${entry.reason})`).join(', ')}`)
        break
      case 'title': lines.push(`- title: ${JSON.stringify(change.title)}`); break
      default: assertNever(change)
    }
  }
  return lines.join('\n')
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

/** The ID one change names in the notice summary. */
function changeId(change: ProjectChange): string {
  switch (change.kind) {
    case 'moved': return change.at
    case 'record': return change.record.id
    case 'stale': return change.records.map(entry => entry.record).join(', ')
    case 'title': return 'title'
    default: return assertNever(change)
  }
}

/**
 * The project message one step of a session needs, or null.
 * - No bound project: null.
 * - No mark, or a mark of another project: the project state message.
 * - Otherwise {@link projectChanges}: null without a change; the project state message instead of an update that would
 *   list more records than a project summary lists recent records, so one message never grows with the length of an
 *   absence; else the project update message.
 * The message's source is `{kind: 'dv-project', mark, form: 'snapshot', sections}` for a state message and
 * `{kind: 'dv-project', mark, form: 'notice', summary}` for an update, with the mark it reported up to.
 * @param project - the service.
 * @param deps - the asset store and the reducers' summaries.
 * @param session - the agent's session ID.
 * @param sight - the session's `dvProjectSight` state.
 * @returns the message, or null.
 */
export function projectMessage(project: DvProject, deps: ProjToolDeps, session: SessionId, sight: SessionSight): UserMessage | null {
  const id = project.sessionProject(session)
  if (id === null) return null
  const reads = readProject(project, id)
  const state = (): UserMessage => {
    const text = renderState(project, deps, id)
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: PROJECT_MESSAGE_KIND, mark: markOf(reads, id), form: 'snapshot', sections: [{ name: PROJECT_MESSAGE_KIND, text }] },
    })
  }
  if (sight.mark === null || sight.mark.project !== id) return state()
  const { changes, mark } = projectChanges(reads, { ...sight, mark: sight.mark })
  if (changes.length === 0) return null
  if (changes.filter(change => change.kind === 'record').length > RECENT_RECORDS) return state()
  const summary = boundContextSummary(`${String(changes.length)} project changes: ${changes.map(changeId).join(', ')}`)
  return createUserMessage({
    content: [{ type: 'text', text: renderUpdate(project, deps, changes, session) }],
    source: { kind: PROJECT_MESSAGE_KIND, mark, form: 'notice', summary },
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
  ctx.sessionProjections.register(sightProjection())
  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision
    const sight = ctx.sessionProjections.stateOf(agent.session, SIGHT_PROJECTION)
    if (sight === undefined) return decision
    const message = projectMessage(project, deps, brandString<SessionId>(agent.id), sight)
    if (message === null) return decision
    const last = decision.messages.findLastIndex(entry => messages.includes(entry))
    return { ...decision, messages: decision.messages.toSpliced(last + 1, 0, message) }
  })
}
