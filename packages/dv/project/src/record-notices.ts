/**
 * Record notices: delivery of the result of each call that an agent started in the background. An operation tool call
 * whose result is `pending` watches its record for the calling session; when the record finishes (`done`, `failed` or
 * `cancelled`), the agent registered for that session gets the record's notice (`recordNotice` of `project-updates`).
 *
 * Delivery follows the agent's status when the notice is ready:
 * - A running agent gets the notice injected into its next step. The agent loop does not end a turn while its next-step
 *   inbox holds a message, so a record that finishes during the last step of a turn still reaches that turn.
 * - An idle agent whose session watches no other unfinished record is woken: the notice opens a turn. An idle agent
 *   whose session still watches another record gets the notice injected without a wake, so the turn that the last of
 *   them opens claims them together.
 * - With `maxConsecutiveWakes` set, an agent that has already opened that many turns by notice wakes since its last
 *   message from the user gets further notices injected without a wake; the next message from the user claims them.
 *
 * Watches live in memory: a restart cancels every unfinished record (`Runner.recover`) while no agent turn is open. A
 * session without a registered agent when its notice is ready gets none; the record stays in the project, and the
 * project messages show it to the session's next step.
 *
 * Calls the `agents` registry (read at delivery time), the attachment service through `imagesOf`, and the `dvProject`
 * reads that `recordNotice` uses. Called by the service: `watch` from the operation tools, `recordFinished` from the record
 * store's change callback.
 *
 * @module @dv/project/record-notices
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import { SessionId as AgentSessionId } from '@deepseek-ai/dsh-session'
import { imagesOf } from './agent-tools.ts'
import type DvProject from './index.ts'
import type { ProjToolDeps } from './proj-tools.ts'
import { recordNotice } from './project-updates.ts'
import type { ProjectId, ProjectRecord, RecordId, SessionId } from './types.ts'

/** One watched record: its project and the session whose agent gets its notice. */
interface Watch {
  project: ProjectId
  session: SessionId
}

/** Watches records for sessions and delivers their notices. */
export class RecordNotices {
  private readonly watches = new Map<RecordId, Watch>()
  /** Turns each agent opened by notice wakes since it last claimed a message from the user. */
  private readonly spentWakes = new WeakMap<Agent, number>()

  /**
   * @param ctx - the service context; the `agents` registry and the attachment service are read from it at delivery time.
   * @param project - the service, for the reads of `recordNotice`.
   * @param deps - the asset store and the reducers' summaries.
   * @param wakeBudget - `maxConsecutiveWakes`, or undefined for no limit.
   */
  constructor(
    private readonly ctx: Context,
    private readonly project: DvProject,
    private readonly deps: ProjToolDeps,
    private readonly wakeBudget: number | undefined,
  ) {
    if (wakeBudget !== undefined) {
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        // A notice this module queued must not refill the budget it spent; only the user's own input does.
        if (message.source.kind === 'user') this.spentWakes.delete(agent)
      })
    }
  }

  /**
   * Deliver the notice of a record to the agent of a session when the record finishes; a record that already finished
   * is delivered now.
   * @param project - the record's project.
   * @param record - the record, which the session's tool result showed as `pending`.
   * @param session - the session.
   */
  watch(project: ProjectId, record: RecordId, session: SessionId): void {
    this.watches.set(record, { project, session })
    const current = this.project.getRecord(project, record)
    if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') this.recordFinished(project, current)
  }

  /**
   * Deliver the notice of a watched record that finished; other records are ignored.
   * @param project - the project.
   * @param record - the record in its final status.
   */
  recordFinished(project: ProjectId, record: ProjectRecord): void {
    const watch = this.watches.get(record.id)
    if (watch?.project !== project) return
    this.watches.delete(record.id)
    this.deliver(watch, record).catch((error: unknown) => {
      this.ctx.logger('dvProject').warn('could not deliver the notice of record %s: %s', record.id, error)
    })
  }

  /** Build the notice of a finished record and hand it to the session's agent, if one is registered. */
  private async deliver(watch: Watch, record: ProjectRecord): Promise<void> {
    if (this.ctx.get('agents')?.get(AgentSessionId(watch.session)) === undefined) return
    const assets = this.deps.assets()
    const images = record.status === 'done' ? await imagesOf(this.ctx, assets, record.outputs) : []
    // The agent is read again: building the images awaited, and the registry may have replaced or removed it.
    const agent = this.ctx.get('agents')?.get(AgentSessionId(watch.session))
    if (agent === undefined) return
    const message = recordNotice(this.project, this.deps, watch.session, watch.project, record, images)
    const othersPending = [...this.watches.values()].some(other => other.session === watch.session)
    if (agent.status === 'idle' && !othersPending && this.spendWake(agent)) agent.followup(message)
    else agent.inject(message)
  }

  /** Take one wake from the agent's budget; always true without a budget. */
  private spendWake(agent: Agent): boolean {
    if (this.wakeBudget === undefined) return true
    const spent = this.spentWakes.get(agent) ?? 0
    if (spent >= this.wakeBudget) return false
    this.spentWakes.set(agent, spent + 1)
    return true
  }
}
