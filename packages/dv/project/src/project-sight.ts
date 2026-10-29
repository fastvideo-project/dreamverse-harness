/**
 * What the agent of a chat session has seen of its project: the {@link ProjectMark} of a complete view, the
 * {@link ProjectSighting} that a DreamVerse tool result stores in its persisted metadata, and the `dvProjectSight`
 * session projection that folds both from the agent's own session log. Nothing else stores it, so a restart, a resume
 * and a replay recover the same sight from the log.
 *
 * Called by the `dv_proj_*` tools and the operation tools (which take marks and write sightings) and by the
 * `project-updates` module (which reads the sight); the service registers the projection while the DSH
 * `sessionProjections` service is mounted.
 *
 * @module @dv/project/project-sight
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { isReplacementSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import type DvProject from './index.ts'
import type { ProjectId, ProjectMark, ProjectRecord, ProjectSighting, RecordId, RecordStatus } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * A project message: the project state message (`snapshot`) or a project update message (`notice`), with the mark it
     * reported up to.
     */
    'dv-project': { kind: 'dv-project'; mark: ProjectMark } & Extract<ContextFormed, { form: 'snapshot' | 'notice' }>
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** What the agent of the session has seen of its project (host only). */
    dvProjectSight: SessionSight
  }
}

/** The projection key. */
export const SIGHT_PROJECTION = 'dvProjectSight'

/** The key of a DreamVerse tool result's metadata that holds its {@link ProjectSighting}. */
export const SIGHTING_META_KEY = 'dv_seen'

/** The message source kind of the project state message and the project update message. */
export const PROJECT_MESSAGE_KIND = 'dv-project'

/**
 * What the agent of one session has seen of its project. `mark` is null exactly when `from` is null, and `seen` is
 * empty while `mark` is null.
 */
export interface SessionSight {
  /**
   * The session seq of the self-contained view that `mark` builds on: the project state message, or the newest `whole`
   * tool sighting. A surface replacement whose range ends at or after it (compaction, tool-result trimming) resets the
   * sight, because the agent may no longer read that view verbatim.
   */
  from: number | null
  /** The mark of the newest project message or `whole` tool sighting; null when the agent has no view to build on. */
  mark: ProjectMark | null
  /** Record ID → the status that the newest `records` tool sighting after the mark showed. */
  seen: Readonly<Record<string, RecordStatus>>
}

/** The project reads that a mark and an update need, taken together so that they describe one moment. */
export interface ProjectReads {
  /** Every record in write order, discarded ones included, in its current form. */
  records: readonly ProjectRecord[]
  /** The last step of the history list. */
  tip: RecordId
  /** The current position. */
  at: RecordId
  title: string
  /** Stale record → the record that made it stale, at the current position. */
  stale: Readonly<Record<RecordId, RecordId>>
}

const recordId = zod.string().transform(value => brandString<RecordId>(value))
const projectId = zod.string().transform(value => brandString<ProjectId>(value))
const recordStatus = zod.enum(['pending', 'running', 'done', 'failed', 'cancelled'])
const markSchema = zod.object({
  project: projectId, title: zod.string(), written: zod.number().int().nonnegative(), at: recordId,
  open: zod.array(recordId), stale: zod.array(recordId),
})
const sightingSchema = zod.discriminatedUnion('kind', [
  zod.object({ kind: zod.literal('whole'), mark: markSchema }),
  zod.object({
    kind: zod.literal('records'), project: projectId,
    records: zod.array(zod.object({ record: recordId, status: recordStatus })),
  }),
])
const sightSchema = zod.object({
  from: zod.number().int().nonnegative().nullable(),
  mark: markSchema.nullable(),
  seen: zod.record(zod.string(), recordStatus),
})

/** The sight of a session whose log holds no view of a project. */
const EMPTY_SIGHT: SessionSight = { from: null, mark: null, seen: {} }

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
  for (let id: RecordId | undefined = last; id !== undefined && !chain.has(id); id = byId.get(id)?.parents[0]) {
    if (!byId.has(id)) break
    chain.add(id)
  }
  return chain
}

/**
 * The project reads of one project from the service, all taken synchronously.
 * @param project - the service.
 * @param id - the project.
 * @returns the reads.
 */
export function readProject(project: DvProject, id: ProjectId): ProjectReads {
  return {
    records: project.listRecords(id), ...project.line(id), title: project.openProject(id).title,
    stale: project.getState(id).components.proj.stale,
  }
}

/**
 * The mark of a project as it stands: what a complete view taken now shows.
 * @param reads - the project reads.
 * @param id - the project.
 * @returns the mark; `open` holds every unfinished record of the history list up to the current position.
 */
export function markOf(reads: ProjectReads, id: ProjectId): ProjectMark {
  const chain = ancestry(new Map(reads.records.map(record => [record.id, record])), reads.at)
  return {
    project: id, title: reads.title, written: reads.records.length, at: reads.at,
    open: reads.records.filter(record => chain.has(record.id) && !finished(record.status)).map(record => record.id),
    stale: reads.records.filter(record => Object.hasOwn(reads.stale, record.id)).map(record => record.id),
  }
}

/** The sighting in a tool result's metadata, or null when the metadata holds none (any other tool). */
function readSighting(meta: unknown): ProjectSighting | null {
  if (typeof meta !== 'object' || meta === null || !(SIGHTING_META_KEY in meta)) return null
  const parsed = sightingSchema.safeParse(meta[SIGHTING_META_KEY])
  return parsed.success ? parsed.data : null
}

/**
 * The next sight after one session event.
 * - A surface replacement whose range ends at or after `from` resets the sight.
 * - A `dv-project` user message sets the mark to its source's mark and clears `seen`; a state message also sets `from`.
 * - A tool result whose `dv_seen` is `whole` for the mark's project (or while there is no mark) sets `from` and the
 *   mark and clears `seen`; `records` for the mark's project records each status in `seen`.
 * Every other event returns the same state reference.
 * @param state - the sight before the event.
 * @param event - the event.
 * @returns the sight after it.
 */
export function foldSight(state: SessionSight, event: SessionEvent): SessionSight {
  if (isReplacementSurfaceEvent(event)) {
    return state.from !== null && event.surfaceOp.endSeq >= state.from ? EMPTY_SIGHT : state
  }
  if (event.type === 'user/message') {
    const source = event.data.source
    if (source.kind !== PROJECT_MESSAGE_KIND) return state
    return { from: source.form === 'snapshot' ? event.seq : state.from, mark: source.mark, seen: {} }
  }
  if (event.type !== 'tool/result') return state
  const sighting = readSighting(event.data.meta)
  if (sighting === null) return state
  if (sighting.kind === 'whole') {
    if (state.mark !== null && state.mark.project !== sighting.mark.project) return state
    return { from: event.seq, mark: sighting.mark, seen: {} }
  }
  if (state.mark === null || state.mark.project !== sighting.project) return state
  const seen = { ...state.seen }
  for (const entry of sighting.records) seen[entry.record] = entry.status
  return { ...state, seen }
}

/**
 * The `dvProjectSight` projection definition: the pure fold {@link foldSight}.
 * @returns the definition.
 */
export function sightProjection(): Omit<ProjectionDefinition<'dvProjectSight'>, 'wire'> {
  return { key: SIGHT_PROJECTION, stateVersion: 1, stateSchema: sightSchema, init: () => EMPTY_SIGHT, apply: foldSight }
}
