/**
 * Record notices with the production agent loop: a wake that the record notices inject into a running turn is claimed
 * by a later turn when a Stop that keeps the inbox aborts the running turn before it claims the wake. The model is a
 * scripted adapter, and the `dvProject` service runs with the real session, projection, agent and tool services.
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
import { MemoryAssets, STAND_IN_COMPONENTS, tempRoot } from './support.ts'
import { TestWorkspaces } from './workspaces.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** A model whose first request streams until it is aborted and whose later requests answer `ok`. */
class HangThenText extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
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

/** The text of a message's text blocks. */
function textOf(message: { content: readonly { type: string; text?: string }[] } | undefined): string {
  return message?.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('') ?? ''
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
}

/**
 * Mount the agent loop services, `dvProject` with a gated GPU `shot.render`, the scripted model and one agent whose
 * session runs in the folder of a new project.
 * @returns the fixture.
 */
async function start(): Promise<Fixture> {
  const context = new Context()
  contexts.push(context)
  await mountAgentLoopTestDependencies(context)
  context.provide('workspaceRegistry', new TestWorkspaces() as never)
  const root = tempRoot()
  await context.plugin(DvProject, {
    projectsFolder: join(root, 'projects'), cpuConcurrency: 4, gpuConcurrency: 4, promptSectionOrder: 4900,
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
      await gate(String(run.params['prompt'])).promise
      return { outputs: [run.importAsset(Buffer.from(`video ${String(run.params['prompt'])}`), { mime: 'video/mp4', name: 'shot.mp4' })] }
    },
  } satisfies OperationSpec)
  const loop = await mountAgentLoopTestHarness(context)
  const adapter = new HangThenText()
  context.llm.registerAdapter(['mock'], adapter)
  const folder = await project.newProjectFolder('Dunk')
  const projectId = (await project.createProject(folder, 'Dunk', {
    actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'create',
  })).id
  const agent = await loop.create(AgentSessionId('s1'), { provider: 'mock', model: 'mock' }, { cwd: folder })
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
      project['notices'].watch(projectId, started.record.id, session)
      return started.record.id
    },
    async finish(prompt, record) {
      gate(prompt).resolve(undefined)
      await project.wait(projectId, [record])
    },
  }
}

/** Send the user's message and wait until the model streams the reply that hangs until the turn is aborted. */
async function startHangingTurn(fixture: Fixture): Promise<void> {
  fixture.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'render it' }], source: { kind: 'user' } }))
  await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(1) })
}

/** The wakes among the claimed messages. */
function wakes(fixture: Fixture): UserMessage[] {
  return fixture.claimed.filter(message => message.source.kind === 'dv-project-wake')
}

describe('record notices with the agent loop', () => {
  it('runs a turn that claims a wake injected into a turn that a Stop keeping the inbox aborted', async () => {
    const fixture = await start()
    const record = await fixture.render('dunk')
    await startHangingTurn(fixture)
    // The render finishes while the turn waits for the model, so the wake goes into the turn's next step.
    await fixture.finish('dunk', record)
    expect(fixture.agent.inbox.nextStep.map(message => message.source.kind)).toEqual(['dv-project-wake'])
    fixture.agent.cancel({ kind: 'user' }, { keepInbox: true })

    await vi.waitFor(() => { expect(fixture.adapter.requests).toHaveLength(2) })
    await fixture.agent.whenIdle()
    expect(wakes(fixture)).toHaveLength(1)
    expect(fixture.agent.inbox.nextStep).toEqual([])
    const messages = fixture.adapter.requests[1]?.messages ?? []
    const last = messages.at(-1)
    expect(last?.role).toBe('user')
    expect(textOf(last)).toContain(`- done ${record} (your call): shot dunk`)
    expect(messages.some(message => textOf(message).includes('DreamVerse operations you started have finished'))).toBe(false)
  })

  it('keeps a stranded wake while the session watches another record, and the last one claims both in one turn', async () => {
    const fixture = await start()
    const first = await fixture.render('one')
    const second = await fixture.render('two')
    await startHangingTurn(fixture)
    await fixture.finish('one', first)
    fixture.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await fixture.agent.whenIdle()
    await Promise.resolve()
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
})
