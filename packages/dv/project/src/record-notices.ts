/**
 * Record notices: a step for the agent when a call that it started in the background finishes. An operation tool call
 * whose result is `pending` watches its record for the calling session; when the record finishes (`done`, `failed` or
 * `cancelled`), the agent registered for that session gets the record's wake (`wakeMessage` of `project-updates`). A
 * wake names the record and carries no result: the step that claims it gets the record's result from the project
 * update message, and the `agent/pre-step` listener of `project-updates` removes the wake.
 *
 * Delivery follows the agent's status when the record finishes:
 * - A running agent gets the wake injected into its next step. The agent loop does not end a turn while its next-step
 *   inbox holds a message, so a record that finishes during the last step of a turn still reaches that turn.
 * - An idle agent whose session watches no other unfinished record is woken: the wake opens a turn. An idle agent
 *   whose session still watches another record gets the wake injected without waking it, so the turn that the last of
 *   them opens claims them together.
 * - With `maxConsecutiveWakes` set, an agent that has already opened that many turns by wakes since its last message
 *   from the user gets further wakes injected without waking it; the next message from the user claims them.
 *
 * Watches live in memory: a restart cancels every unfinished record (`Runner.recover`) while no agent turn is open. A
 * session without a registered agent when its record finishes gets no wake; the project update message shows the record
 * to the session's next step. Removing a project drops the watches of its records, and closing the module (when the
 * service stops) drops every watch and delivers nothing afterwards. A delivery that throws is logged on the `dvProject`
 * logger and never fails the record write that finished the record.
 *
 * Calls the `agents` registry, read at delivery time, and `dvProject.getRecord`. Called by the service: `watch` from the
 * operation tools, `recordFinished` from the record store's change callback.
 *
 * @module @dv/project/record-notices
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import { SessionId as AgentSessionId } from '@deepseek-ai/dsh-session'
import type DvProject from './index.ts'
import { wakeMessage } from './project-updates.ts'
import type { ProjectId, ProjectRecord, RecordId, SessionId } from './types.ts'

/** One watched record: its project and the session whose agent gets its wake. */
interface Watch {
  project: ProjectId
  session: SessionId
}

/** Watches records for sessions and delivers their wakes. */
export class RecordNotices {
  private readonly watches = new Map<RecordId, Watch>()
  /** Turns each agent opened by wakes since it last claimed a message from the user. */
  private readonly spentWakes = new WeakMap<Agent, number>()
  /** False once {@link RecordNotices.close} ran: no watch is kept and no wake is delivered. */
  private open = true

  /**
   * @param ctx - the service context; the `agents` registry is read from it at delivery time.
   * @param project - the service, for `getRecord`.
   * @param wakeBudget - `maxConsecutiveWakes`, or undefined for no limit.
   */
  constructor(
    private readonly ctx: Context,
    private readonly project: DvProject,
    private readonly wakeBudget: number | undefined,
  ) {
    if (wakeBudget !== undefined) {
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        // A wake this module queued must not refill the budget it spent; only the user's own input does.
        if (message.source.kind === 'user') this.spentWakes.delete(agent)
      })
    }
  }

  /**
   * Deliver the wake of a record to the agent of a session when the record finishes; a record that already finished
   * is delivered now.
   * @param project - the record's project.
   * @param record - the record, which the session's tool result showed as `pending`.
   * @param session - the session.
   */
  watch(project: ProjectId, record: RecordId, session: SessionId): void {
    if (!this.open) return
    this.watches.set(record, { project, session })
    const current = this.project.getRecord(project, record)
    if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') this.recordFinished(project, current)
  }

  /**
   * Deliver the wake of a watched record that finished to the session's agent, if one is registered; other records are
   * ignored.
   * @param project - the project.
   * @param record - the record in its final status.
   */
  recordFinished(project: ProjectId, record: ProjectRecord): void {
    const watch = this.watches.get(record.id)
    if (!this.open || watch?.project !== project) return
    this.watches.delete(record.id)
    // The caller is the record store's change callback: a failing delivery must not fail the write that finished the record.
    try {
      const agent = this.ctx.get('agents')?.get(AgentSessionId(watch.session))
      if (agent === undefined) return
      const message = wakeMessage([record.id])
      const othersPending = [...this.watches.values()].some(other => other.session === watch.session)
      if (agent.status === 'idle' && !othersPending && this.spendWake(agent)) agent.followup(message)
      else agent.inject(message)
    } catch (error) {
      this.ctx.logger('dvProject').warn('could not deliver the wake of record %s: %s', record.id, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Drop the watches of a project's records; their wakes are never delivered.
   * @param project - the removed project.
   */
  forget(project: ProjectId): void {
    for (const [record, watch] of this.watches) if (watch.project === project) this.watches.delete(record)
  }

  /** Drop every watch and deliver no wake afterwards; the service calls it when it stops. */
  close(): void {
    this.open = false
    this.watches.clear()
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
