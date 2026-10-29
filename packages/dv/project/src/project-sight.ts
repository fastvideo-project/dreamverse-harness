/**
 * What the agent of a chat session has seen of its project: the `dvProjectSight` session projection, folded from the
 * agent's own session log, which stores a {@link ProjectShown} in the source of each project message and as `dv_seen`
 * in the persisted metadata of each DreamVerse tool result. Nothing else stores it, so a restart, a resume and a replay
 * recover the same state from the log.
 *
 * Called by the `project-updates` module, which reads the state and registers the projection while the DSH
 * `sessionProjections` service is mounted.
 *
 * @module @dv/project/project-sight
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { isReplacementSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import { SEEN_META_KEY } from './shared.ts'
import type { ProjectId, ProjectRecord, ProjectShown, RecordId, RecordStatus } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A project message: the project state message (`snapshot`) or a project update message (`notice`). */
    'dv-project': { kind: 'dv-project'; shown: ProjectShown } & Extract<ContextFormed, { form: 'snapshot' | 'notice' }>
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** What the agent of the session has seen of its project (host only). */
    dvProjectSight: SessionSeen
  }
}

/**
 * What the agent of one session has seen of its project. `from` is null until a project state message is logged, and
 * again after a surface replacement (compaction, tool-result trimming) whose range reaches that message.
 */
export type SessionSeen =
  | { from: null }
  | {
    /** The session seq of the project state message. */
    from: number
    project: ProjectId
    /** Records `[0, base)` in write order count as seen in a final status unless `records` names them. */
    base: number
    /** The current position the agent last saw. */
    at: RecordId
    /** Each record the agent saw after or unfinished at the state message, in the status it saw last. */
    records: Partial<Record<RecordId, RecordStatus>>
  }

/** The message source kind of the project state message and the project update message. */
export const PROJECT_MESSAGE_KIND = 'dv-project'

/** The projection key. */
export const SEEN_PROJECTION = 'dvProjectSight'

const recordId = zod.string().transform(value => brandString<RecordId>(value))
const projectId = zod.string().transform(value => brandString<ProjectId>(value))
const shownRecords = zod.record(zod.string(), zod.enum(['pending', 'running', 'done', 'failed', 'cancelled']))
const shownSchema = zod.object({ project: projectId, records: shownRecords, at: recordId.optional() })
const seenSchema = zod.union([
  zod.object({ from: zod.null() }),
  zod.object({
    from: zod.number().int().nonnegative(), project: projectId, base: zod.number().int().nonnegative(), at: recordId,
    records: shownRecords,
  }),
])

/** The state of a session whose log holds no project state message. */
const UNSEEN: SessionSeen = { from: null }

/**
 * Whether a record status is final.
 * @param status - the status.
 * @returns true for `done`, `failed` and `cancelled`.
 */
export function finished(status: RecordStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/**
 * The records of the `parents[0]` ancestry of one record, which is the history list up to it.
 * @param byId - every record by ID.
 * @param last - the record the list ends at.
 * @returns the record IDs.
 */
export function ancestry(byId: ReadonlyMap<RecordId, ProjectRecord>, last: RecordId): Set<RecordId> {
  const chain = new Set<RecordId>()
  for (let id: RecordId | undefined = last; id !== undefined && byId.has(id) && !chain.has(id); id = byId.get(id)?.parents[0]) {
    chain.add(id)
  }
  return chain
}

/** What one session event showed the agent: a project message's source, or a tool result's `dv_seen`; else null. */
function shownBy(event: SessionEvent): ProjectShown | null {
  if (event.type === 'user/message') return event.data.source.kind === PROJECT_MESSAGE_KIND ? event.data.source.shown : null
  if (event.type !== 'tool/result') return null
  const meta = event.data.meta
  if (typeof meta !== 'object' || meta === null || !(SEEN_META_KEY in meta)) return null
  const parsed = shownSchema.safeParse(meta[SEEN_META_KEY])
  return parsed.success ? parsed.data : null
}

/**
 * The next state after one session event.
 * - A surface replacement whose range ends at or after `from` resets the state.
 * - A project state message starts the state from its source.
 * - A project update message or a tool result of the state's project adds its records, in the status shown, and moves
 *   `at` to the position it showed, if any.
 * Every other event returns the same state reference.
 * @param state - the state before the event.
 * @param event - the event.
 * @returns the state after it.
 */
export function foldSeen(state: SessionSeen, event: SessionEvent): SessionSeen {
  if (isReplacementSurfaceEvent(event)) return state.from !== null && event.surfaceOp.endSeq >= state.from ? UNSEEN : state
  const shown = shownBy(event)
  if (shown === null) return state
  if (shown.base !== undefined) return { from: event.seq, project: shown.project, base: shown.base, at: shown.at, records: shown.records }
  if (state.from === null || state.project !== shown.project) return state
  return { ...state, at: shown.at ?? state.at, records: { ...state.records, ...shown.records } }
}

/**
 * The `dvProjectSight` projection definition: the pure fold {@link foldSeen}.
 * @returns the definition.
 */
export function seenProjection(): Omit<ProjectionDefinition<'dvProjectSight'>, 'wire'> {
  return { key: SEEN_PROJECTION, stateVersion: 1, stateSchema: seenSchema, init: () => UNSEEN, apply: foldSeen }
}
