/**
 * Record notices with the production agent loop: a wake that the record notices inject into a running turn stays queued
 * when a Stop that keeps the inbox aborts that turn before it claims the wake, and the next turn claims it; a wake that
 * a turn ending with an error leaves behind opens a turn; a wake past `maxConsecutiveWakes` waits for the user's next
 * message; a session archived with its work stopped gets no wake. The model is a scripted adapter, and the `dvProject`
 * service runs with the real session, projection, agent and tool services.
 */
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmAdapter, createUserMessage, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId as AgentSessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DvProject, { type OperationSpec, type ProjectId, type RecordId, type SessionId } from '../src/index.ts'
import { MemoryAssets, STAND_IN_COMPONENTS, tempRoot, textOf } from './support.ts'
import { TestWorkspaces } from './workspaces.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/**
 * A model whose first request streams until it is aborted, or with `failFirst` until {@link HangThenText.fail} makes it
 * throw, and whose later requests answer `ok`; with `hangFirst` false, every request answers `ok`.
 */
class HangThenText extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  failFirst = false
  hangFirst = true
  private readonly failure = Promise.withResolvers<undefined>()

  /** Make the first request throw. */
  fail(): void {
    this.failure.resolve(undefined)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.hangFirst && this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      if (this.failFirst) {
        await this.failure.promise
        throw new Error('the model failed')
      }
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** A started fixture: the service, the project, the agent, its model, and the claimed messages. */
interface Fixture {
  project: DvProject
  projectId: ProjectId
  agent: Agent
  session: SessionId
  adapter: HangThenText
  claimed: UserMessage[]
  /** Start a render as the agent's own call and watch it for the agent's session. */
  render(prompt: string): Promise<RecordId>
  /** Let the render of `prompt` finish and wait until its record finished. */
  finish(prompt: string, record: RecordId): Promise<void>
  /** Dispose the agent. */
  dispose(): Promise<void>
}

/**
 * Mount the agent loop services, `dvProject` with a gated GPU `shot.render`, the scripted model and one agent whose
 * session runs in the folder of a new project.
 * @param maxConsecutiveWakes - the service's wake budget, or undefined for none.
 * @returns the fixture.
 */
async function start(maxConsecutiveWakes?: number): Promise<Fixture> {
  const context = new Context()
  contexts.push(context)
  await mountAgentLoopTestDependencies(context)
  context.provide('workspaceRegistry', new TestWorkspaces() as never)
  const root = tempRoot()
  await context.plugin(DvProject, {
    projectsFolder: join(root, 'projects'), cpuConcurrency: 4, gpuConcurrency: 4, promptSectionOrder: 4900,
    ...maxConsecutiveWakes === undefined ? {} : { maxConsecutiveWakes },
  }).await()
  const project = context.dvProject
  project.registerAssetStore(new MemoryAssets())
  for (const key of STAND_IN_COMPONENTS) project.registerComponent(key)
  const gates = new Map<string, PromiseWithResolvers<undefined>>()
  const gate = (prompt: string): PromiseWithResolvers<undefined> => {
    const made = gates.get(prompt) ?? Promise.withResolvers<undefined>()
    gates.set(prompt, made)
    return made
  }
  project.registerOperation({
    name: 'shot.render', component: 'shot', version: '1', description: 'A test render.', inputs: {}, deterministic: false,
    params: { prompt: { type: 'string' } }, outputs: [{ role: 'video', type: 'video' }], resource: 'gpu',
    summarize: record => `shot ${String(record.params['prompt'])}`,
    execute: async (run) => {
      // A discard aborts the render, which then ends `cancelled` / `discarded`.
      await Promise.race([gate(String(run.params['prompt'])).promise, new Promise((_resolve, reject) => {
        if (run.signal.aborted) reject(new Error('aborted'))
        run.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })])
      return { outputs: [run.importAsset(Buffer.from(`video ${String(run.params['prompt'])}`), { mime: 'video/mp4', name: 'shot.mp4' })] }
    },
  } satisfies OperationSpec)
  await mountAgentLoopTestHarness(context)
  const adapter = new HangThenText()
  context.llm.registerAdapter(['mock'], adapter)
  const folder = await project.newProjectFolder('Dunk')
  const projectId = (await project.createProject(folder, 'Dunk', {
    actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'create',
  })).id
  const handle = await context.agentLoop.createAgent(context, {
    sessionId: AgentSessionId('s1'), agentOptions: { provider: 'mock', model: 'mock' }, meta: { cwd: folder },
  })
  const { agent } = handle
  const session = brandString<SessionId>(agent.id)
  const claimed: UserMessage[] = []
  context.on('agent/inbox/claimed', ({ message }) => { claimed.push(message) })
  return {
    project, projectId, agent, session, adapter, claimed,
    async render(prompt) {
      const started = await project.run({
        actor: 'agent', surface: 'chat', session, turn: null, tool_call: null, intent: `render ${prompt}`,
        project: projectId, operation: 'shot.render', params: { prompt }, inputs: [], after: [],
      })
      if (started.record === null) throw new Error('the render wrote no record')
      project['notices'].watch(projectId, started.record.id, session)
      return started.record.id
    },
    async finish(prompt, record) {
      gate(prompt).resolve(undefined)
      await project.wait(projectId, [record])
    },
    dispose: () => handle.dispose(),
  }
}

/** A message from the user. */
function userMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Send the user's message and wait until the model streams the reply that hangs until the turn is aborted. */
async function startHangingTurn(fixture: Fixture): Promise<void> {
  fixture.agent.followup(userMessage('render it'))
  await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(1) })
}

/** Wait until the agent is idle and the record notices checked it. */
async function settleIdle(fixture: Fixture): Promise<void> {
  await fixture.agent.whenIdle()
  await new Promise(resolve => setImmediate(resolve))
}

/** The texts of a request's user messages. */
function userTexts(request: GenerateOptions | undefined): string[] {
  return (request?.messages ?? []).filter(message => message.role === 'user').map(message => textOf(message))
}

/** The records that a wake names; none for another message. */
function recordsOf(message: UserMessage): readonly RecordId[] {
  return message.source.kind === 'dv-project-wake' ? message.source.records : []
}

/** The wakes among the claimed messages. */
function wakes(fixture: Fixture): UserMessage[] {
  return fixture.claimed.filter(message => message.source.kind === 'dv-project-wake')
}

describe('record notices with the agent loop', () => {
  it('leaves a wake that a Stop stranded queued, and the turn of the user\'s next message claims it', async () => {
    const fixture = await start()
    const record = await fixture.render('dunk')
    await startHangingTurn(fixture)
    // The render finishes while the turn waits for the model, so the wake goes into the turn's next step.
    await fixture.finish('dunk', record)
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['dv-project-wake'])
    fixture.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['dv-project-wake'])

    fixture.agent.followup(userMessage('and now?'))
    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(2) })
    await fixture.agent.whenIdle()
    expect(wakes(fixture)).toHaveLength(1)
    expect(fixture.agent.inbox.nextStep).toEqual([])
    const messages = fixture.adapter.requests[1]?.messages ?? []
    const last = messages.at(-1)
    expect(last?.role).toBe('user')
    expect(textOf(last)).toContain(`- done ${record} (your call): shot dunk`)
    expect(userTexts(fixture.adapter.requests[1]).at(-2)).toBe('and now?')
    expect(messages.some(message => textOf(message).includes('DreamVerse operations you started have finished'))).toBe(false)
  })

  it('leaves a wake that a Stop stranded queued, and the turn that the next finished record opens claims both', async () => {
    const fixture = await start()
    const first = await fixture.render('one')
    await startHangingTurn(fixture)
    await fixture.finish('one', first)
    fixture.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)

    const second = await fixture.render('two')
    await fixture.finish('two', second)
    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(2) })
    await fixture.agent.whenIdle()
    expect(wakes(fixture)).toHaveLength(2)
    expect(fixture.agent.inbox.nextStep).toEqual([])
    const update = textOf(fixture.adapter.requests[1]?.messages.at(-1))
    expect(update).toContain(`- done ${first} (your call): shot one`)
    expect(update).toContain(`- done ${second} (your call): shot two`)
  })

  it('opens no turn after a Stop while the user\'s message waits in the next-turn inbox', async () => {
    const fixture = await start()
    const record = await fixture.render('dunk')
    await startHangingTurn(fixture)
    fixture.agent.followup(userMessage('queued'))
    await fixture.finish('dunk', record)
    fixture.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)
    expect(fixture.agent.inbox.nextTurn.map(message => textOf(message))).toEqual(['queued'])
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['dv-project-wake'])
  })

  it('opens no turn for a record that finishes after a Stop while the user\'s message waits in the next-turn inbox', async () => {
    const fixture = await start()
    const first = await fixture.render('one')
    const second = await fixture.render('two')
    await startHangingTurn(fixture)
    fixture.agent.followup(userMessage('queued'))
    await fixture.finish('one', first)
    fixture.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await settleIdle(fixture)

    await fixture.finish('two', second)
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)
    expect(fixture.agent.inbox.nextTurn.map(message => textOf(message))).toEqual(['queued'])
    expect(fixture.agent.inbox.nextStep.map(recordsOf)).toEqual([[first], [second]])
  })

  it('opens no turn for a record that finishes after a Stop while the user\'s steer waits in the next-step inbox', async () => {
    const fixture = await start()
    await startHangingTurn(fixture)
    fixture.agent.inject(userMessage('steer'))
    fixture.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await settleIdle(fixture)
    expect(fixture.agent.inbox.nextStep.map(message => textOf(message))).toEqual(['steer'])

    const record = await fixture.render('dunk')
    await fixture.finish('dunk', record)
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['user', 'dv-project-wake'])
  })

  it('sends no wake for a render that finishes after its session is archived with its work stopped', async () => {
    const fixture = await start()
    fixture.adapter.hangFirst = false
    const record = await fixture.render('dunk')
    await fixture.agent.ctx.parallel('workspace/session-stop', { sessionId: fixture.agent.id })
    await fixture.finish('dunk', record)
    await settleIdle(fixture)
    expect(fixture.project.getRecord(fixture.projectId, record).status).toBe('done')
    expect(fixture.adapter.requests).toEqual([])
    expect(fixture.agent.inbox.nextStep).toEqual([])
    expect(fixture.agent.inbox.nextTurn).toEqual([])
  })

  it('delivers no wake to an agent whose disposal is unwinding its scope', async () => {
    const fixture = await start()
    const record = await fixture.render('dunk')
    const followup = vi.spyOn(fixture.agent, 'followup')
    const inject = vi.spyOn(fixture.agent, 'inject')
    // The agent stays registered until its scope has unwound; the record finishes in that window.
    fixture.agent.ctx.effect(() => () => {
      fixture.project['notices'].recordFinished(fixture.projectId, { ...fixture.project.getRecord(fixture.projectId, record), status: 'done' })
    }, 'finish the render while the agent is disposed')
    await fixture.dispose()
    expect(followup).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
    expect(fixture.adapter.requests).toEqual([])
    await fixture.finish('dunk', record)
  })

  it('opens a turn for a wake injected into the idle agent when a discard drops the session\'s other watch', async () => {
    const fixture = await start()
    const first = await fixture.render('one')
    await fixture.render('two')
    // The idle agent's session still watches the second render, so the first one's wake waits without waking it.
    await fixture.finish('one', first)
    expect(fixture.adapter.requests).toEqual([])
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['dv-project-wake'])
    await fixture.project.undo(fixture.projectId)
    const write = await fixture.project.run({
      actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'render on the canvas',
      project: fixture.projectId, operation: 'shot.render', params: { prompt: 'canvas' }, inputs: [], after: [],
    })

    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(1) })
    expect(wakes(fixture).map(recordsOf)).toEqual([[first]])
    expect(fixture.agent.inbox.nextStep).toEqual([])
    // The session's first step gets the project state message, which shows the finished render.
    expect(textOf(fixture.adapter.requests[0]?.messages.at(-1))).toContain(`"record": "${first}"`)
    // The model's first request streams until the turn is aborted.
    fixture.agent.cancel({ kind: 'user' })
    await fixture.agent.whenIdle()
    if (write.record !== null) await fixture.finish('canvas', write.record.id)
  })

  it('opens a turn for the held-back wake alone when the session\'s other render finishes undone', async () => {
    const fixture = await start()
    const first = await fixture.render('one')
    const second = await fixture.render('two')
    await fixture.finish('one', first)
    await fixture.project.undo(fixture.projectId)
    await fixture.finish('two', second)

    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(1) })
    expect(wakes(fixture).map(recordsOf)).toEqual([[first]])
    expect(fixture.agent.inbox.nextStep).toEqual([])
    fixture.agent.cancel({ kind: 'user' })
    await fixture.agent.whenIdle()
  })

  it('opens a turn for a wake that a turn ending with an error left behind', async () => {
    const fixture = await start()
    fixture.adapter.failFirst = true
    const record = await fixture.render('dunk')
    await startHangingTurn(fixture)
    await fixture.finish('dunk', record)
    fixture.adapter.fail()

    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(2) })
    await fixture.agent.whenIdle()
    expect(wakes(fixture)).toHaveLength(1)
    expect(fixture.agent.inbox.nextStep).toEqual([])
    expect(textOf(fixture.adapter.requests[1]?.messages.at(-1))).toContain(`- done ${record} (your call): shot dunk`)
  })

  it('opens no turn for a wake that an error left behind while the user\'s message waits in the next-turn inbox', async () => {
    const fixture = await start()
    fixture.adapter.failFirst = true
    const record = await fixture.render('dunk')
    await startHangingTurn(fixture)
    fixture.agent.followup(userMessage('queued'))
    await fixture.finish('dunk', record)
    fixture.adapter.fail()
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)
    expect(fixture.agent.inbox.nextTurn.map(message => textOf(message))).toEqual(['queued'])
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['dv-project-wake'])
  })

  it('keeps a wake that an error left behind while the session watches another record, and the last one claims both', async () => {
    const fixture = await start()
    fixture.adapter.failFirst = true
    const first = await fixture.render('one')
    const second = await fixture.render('two')
    await startHangingTurn(fixture)
    await fixture.finish('one', first)
    fixture.adapter.fail()
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['dv-project-wake'])

    await fixture.finish('two', second)
    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(2) })
    await fixture.agent.whenIdle()
    expect(wakes(fixture)).toHaveLength(2)
    const update = textOf(fixture.adapter.requests[1]?.messages.at(-1))
    expect(update).toContain(`- done ${first} (your call): shot one`)
    expect(update).toContain(`- done ${second} (your call): shot two`)
  })

  it('injects a wake past maxConsecutiveWakes until the user\'s message, claimed with it, refills the budget', async () => {
    const fixture = await start(1)
    fixture.adapter.hangFirst = false
    const one = await fixture.render('one')
    await fixture.finish('one', one)
    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(1) })
    await settleIdle(fixture)

    const two = await fixture.render('two')
    await fixture.finish('two', two)
    await settleIdle(fixture)
    expect(fixture.adapter.requests).toHaveLength(1)
    expect(fixture.agent.inbox.nextStep.map(recordsOf)).toEqual([[two]])

    fixture.agent.followup(userMessage('more'))
    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(2) })
    await settleIdle(fixture)
    expect(fixture.claimed.slice(1).map(message => message.source.kind)).toEqual(['dv-project-wake', 'user'])
    expect(textOf(fixture.adapter.requests[1]?.messages.at(-1))).toContain(`- done ${two} (your call): shot two`)

    const three = await fixture.render('three')
    await fixture.finish('three', three)
    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(3) })
    await settleIdle(fixture)
    expect(wakes(fixture).map(recordsOf)).toEqual([[one], [two], [three]])
  })
})
