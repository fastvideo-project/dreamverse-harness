/**
 * Record notices: a step for the agent when a call that it started in the background finishes. An operation tool call
 * whose result is `pending` watches its record for the calling session; when the record finishes (`done`, `failed` or
 * `cancelled`), the agent registered for that session gets the record's wake (`wakeMessage` of `project-updates`). A
 * wake names the record and carries no result: the step that claims it gets the record's result from the project
 * update message, and the `agent/pre-step` listener of `project-updates` removes the wake.
 *
 * Delivery follows the agent's status when the record finishes:
 * - A running agent gets the wake injected into its next step. The agent loop does not end a turn while its next-step
 *   inbox holds a message, so a record that finishes during the last step of a turn reaches that turn, or the next one
 *   when it finishes while that turn unwinds (the last rule below).
 * - An idle agent whose session watches no other unfinished record is woken: the wake opens a turn. An idle agent
 *   whose session still watches another record, or whose next-step or next-turn inbox holds a message from the user,
 *   gets the wake injected without waking it: the turn that the last record opens, or the user's next action, claims
 *   them together.
 * - With `maxConsecutiveWakes` set, an agent that has already opened that many turns by wakes since its last message
 *   from the user gets further wakes injected without waking it; the next message from the user claims them.
 * - An agent that goes idle with wakes still in its next-step inbox (they arrived while its last turn unwound, or that
 *   turn ended with an error) is woken under the same rules: those wakes leave the next-step inbox and one wake that
 *   names all their records opens a turn. An agent whose last turn a cancellation ended (a user Stop that keeps the
 *   inbox) is not woken this way: its wakes stay in the next-step inbox, and the next turn claims them, opened by the
 *   user's next message or by the next wake.
 *
 * Watches live in memory: a restart cancels every unfinished record (`Runner.recover`) while no agent turn is open. A
 * session without a registered agent when its record finishes, or whose agent is being disposed (its `ctx` fiber is no
 * longer active), gets no wake; the project update message shows the record to the session's next step. A record that
 * finishes off the history list up to the current position (undone, or discarded by a write after an undo) gets no
 * wake: no project update reports it, until a redo brings an undone record back and the session's next step reports it.
 * When it was the last record that the session watched, the wakes that an idle agent holds for its other records open
 * a turn under the rules above. Archiving a session with its work stopped (`workspace/session-stop`) drops that
 * session's watches; its records keep running and send no wake.
 *
 * Calls the `agents` registry, read at delivery time, `dvProject.getRecord` and `dvProject.listHistory`. Called by the
 * service: `watch` from the operation tools, `recordFinished` from the record store's change callback.
 *
 * @module @dv/project/record-notices
 */
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId as AgentSessionId, type Session } from '@deepseek-ai/dsh-session'
import type DvProject from './index.ts'
import { WAKE_KIND, wakeMessage } from './project-updates.ts'
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
  /** Sessions whose last logged turn a cancellation ended (`turn/end` reason `aborted`). */
  private readonly cancelledTurns = new WeakSet<Session>()

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
    // The loop logs `turn/end` before the `idle` status of the activity that the turn belonged to.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      if (event.data.reason.kind === 'aborted') this.cancelledTurns.add(session)
      else this.cancelledTurns.delete(session)
    })
    // The `idle` status precedes the loop's own replay of a latched wake, so the check waits for that replay.
    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') queueMicrotask(() => { this.wakeStranded(agent) })
    })
    // An archived session's gate blocks every turn, so a wake would open an empty blocked turn; its renders keep running.
    ctx.on('workspace/session-stop', ({ sessionId }) => {
      const session = brandString<SessionId>(sessionId)
      for (const [record, watch] of this.watches) if (watch.session === session) this.watches.delete(record)
    })
  }

  /**
   * Deliver the wake of a record to the agent of a session when the record finishes; a record that already finished
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
   * Deliver the wake of a watched record that finished to the session's agent, if one is registered; other records are
   * ignored. A record that is off the history list up to the current position (undone, or discarded by a write after
   * an undo) drops its watch without a wake; an idle agent whose next-step inbox holds the wakes that this watch held
   * back is then woken for them.
   * @param project - the project.
   * @param record - the record in its final status.
   */
  recordFinished(project: ProjectId, record: ProjectRecord): void {
    const watch = this.watches.get(record.id)
    if (watch?.project !== project) return
    this.watches.delete(record.id)
    const agent = this.ctx.get('agents')?.get(AgentSessionId(watch.session))
    // An agent stays registered while its disposal unwinds its scope; a wake then would open a turn in it.
    if (agent === undefined || agent.ctx.fiber.state !== FiberState.ACTIVE) return
    // A project update lists only records of the history list up to the current position: the wake of an undone or
    // discarded record would open a turn that reports nothing of it. The wakes that this watch held back still need one.
    if (!this.onHistory(project, record.id)) {
      this.wakeStranded(agent)
      return
    }
    const message = wakeMessage([record.id])
    if (agent.status === 'idle' && this.mayOpenTurn(agent)) agent.followup(message)
    else agent.inject(message)
  }

  /**
   * Wake an idle agent whose next-step inbox still holds wakes: no step of a running turn will claim them. The wakes
   * leave the inbox and one wake naming all their records opens a turn, unless a cancellation ended the agent's last
   * turn or {@link RecordNotices.mayOpenTurn} refuses; then they stay for the turn that opens next.
   * @param agent - an agent that has just become idle, or whose session's watch was just dropped without a wake.
   */
  private wakeStranded(agent: Agent): void {
    if (agent.status !== 'idle') return
    try {
      const stranded = agent.inbox.nextStep
        .flatMap(message => message.source.kind === WAKE_KIND ? [{ message, source: message.source }] : [])
      if (stranded.length === 0 || this.ctx.get('agents')?.get(agent.id) !== agent) return
      // A Stop leaves queued work queued: the user's next message, or the next wake, opens the turn that claims them.
      if (this.cancelledTurns.has(agent.session) || !this.mayOpenTurn(agent)) return
      for (const { message } of stranded) agent.inbox.remove(message.id)
      agent.followup(wakeMessage(stranded.flatMap(({ source }) => source.records)))
    } catch (error) {
      this.ctx.logger('dvProject').warn('could not wake agent %s: %s', agent.id, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Whether a wake may open a turn in an idle agent, taking one wake from its budget when it may: neither its next-step
   * nor its next-turn inbox holds a message from the user (a turn would claim that held-back message with the wake),
   * its session watches no other record, and the budget allows.
   */
  private mayOpenTurn(agent: Agent): boolean {
    if ([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user')) return false
    const session = brandString<SessionId>(agent.id)
    return ![...this.watches.values()].some(watch => watch.session === session) && this.spendWake(agent)
  }

  /** Whether a record is on the project's history list at or before the current position. */
  private onHistory(project: ProjectId, record: RecordId): boolean {
    const [entry] = this.project.listHistory({ project, records: [record] })
    return entry !== undefined && entry.place !== 'after'
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
