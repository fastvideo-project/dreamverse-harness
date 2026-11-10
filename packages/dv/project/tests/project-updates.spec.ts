/**
 * The project messages through the `dvProject` service with the real DSH tool registry: the project state message, the
 * project update message for each kind of change, the records that the agent's own tool results showed, the
 * `dvProjectSight` fold over a session log built from the logged messages and tool results, and the `agent/pre-step`
 * listener with the wakes of the record notices. Expected texts are written from the rendering rules in
 * `project-updates.ts`.
 */
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type AgentEventDispatch } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId, createToolResultMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import DvProject, { type OperationSpec, type ProjectId, type ProjectRecord, type RecordId, type RecordOrigin, type SessionId } from '../src/index.ts'
import { STATE_HEAD, UPDATE_HEAD, foldSeen, projectMessage, seenProjection, wakeMessage, type SessionSeen } from '../src/project-updates.ts'
import type { ProjToolDeps } from '../src/proj-tools.ts'
import { MemoryAssets, STAND_IN_COMPONENTS, tempRoot } from './support.ts'
import { chatProject, provideChatServices, type TestChatServices } from './workspaces.ts'

/** The chat session of the agent under test. */
const SESSION = brandString<SessionId>('s1')

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** The asset ID of the bytes of a text. */
const assetOf = (text: string): string => createHash('sha256').update(text).digest('hex')

/** A user edit on the canvas. */
const user = (intent: string): RecordOrigin => ({ actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent })
/** A record the scheduler runs. */
const scheduler = (intent: string): RecordOrigin => ({ actor: 'system', surface: 'api', session: SESSION, turn: null, tool_call: null, intent })

/** The agent of {@link SESSION} as the record notices and the `agent/pre-step` listener read it. */
class FakeAgent {
  readonly id = SESSION
  readonly session = { id: SESSION }
  status: 'idle' | 'running' = 'idle'
  /** The messages queued for the agent and not claimed yet. */
  readonly queued: UserMessage[] = []

  followup(message: UserMessage): void {
    this.queued.push(message)
  }

  inject(message: UserMessage): void {
    this.queued.push(message)
  }

  /** Claim every queued message, as the agent loop claims its inbox at a step. */
  claim(): UserMessage[] {
    return this.queued.splice(0)
  }
}

/**
 * A session log of one agent: the events appended so far and the state folded from them, the way the agent loop logs
 * project messages and tool results.
 */
class AgentLog {
  readonly events: SessionEvent[] = []
  seen: SessionSeen = seenProjection().init({} as never, 0 as never)

  constructor(private readonly project: DvProject, private readonly deps: ProjToolDeps) {}

  /** Append an event and fold it. */
  append(event: SessionEvent): void {
    this.events.push(event)
    this.seen = foldSeen(this.seen, event)
  }

  /** The seq the next event gets. */
  get next(): SessionSeq {
    return SessionSeq(this.events.length)
  }

  /** Log a tool result with its persisted metadata. */
  toolResult(result: ToolExecutionResult): void {
    const message = createToolResultMessage({ callId: ToolCallId(`call-${String(this.next)}`), content: result.content, isError: result.isError })
    this.append({
      type: 'tool/result', seq: this.next, time: 0, surfaceOp: 'append',
      data: { turn: 1, step: 1, message, ...result.meta === undefined ? {} : { meta: result.meta } },
    })
  }

  /** Run the pre-step computation of one step and log its message; returns the message text, or null. */
  step(): string | null {
    const message = projectMessage(this.project, this.deps, SESSION, this.seen)
    if (message === null) return null
    this.logMessage(message)
    return textOf(message)
  }

  /** Log a user message, as the agent loop logs a step's messages. */
  logMessage(message: UserMessage): void {
    this.append({ type: 'user/message', seq: this.next, time: 0, surfaceOp: 'append', data: message })
  }
}

/** The text of a message. */
function textOf(message: UserMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

interface Fixture {
  context: Context
  project: DvProject
  projectId: ProjectId
  services: TestChatServices
  deps: ProjToolDeps
  log: AgentLog
  /** The agent of {@link SESSION}, which the `agents` stand-in returns. */
  agent: FakeAgent
  /** The agent events of {@link agent}. */
  events: AgentEventDispatch
  /** Run one tool as the agent of {@link SESSION}. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Run one operation and return its record. */
  run(origin: RecordOrigin, operation: string, params: Record<string, unknown>, extra?: Partial<Parameters<DvProject['run']>[0]>): Promise<ProjectRecord>
  /** Let the render of `prompt` finish. */
  release(prompt: string): void
  /** The name of each image saved through the `attachments` stand-in, in order. */
  savedImages: string[]
}

/**
 * Mount the DSH tool registry and `dvProject` with an in-memory asset store, two operations (`asset.import`, and a GPU
 * `shot.render` that waits until the test releases its prompt and fails for the prompt `broken`), and a project bound
 * to {@link SESSION} unless `bound` is false. The `sessionProjections` stand-in answers the agent's session with the
 * fixture log's state, and the `agents` stand-in returns the fixture's agent for {@link SESSION}.
 * @param bound - whether {@link SESSION} starts bound to the project.
 * @returns the fixture.
 */
async function start(bound = true): Promise<Fixture> {
  const root = tempRoot()
  const context = new Context()
  contexts.push(context)
  const agent = new FakeAgent()
  const holder: { log?: AgentLog } = {}
  context.provide('sessionProjections', {
    stateOf: (session: unknown) => (session === agent.session ? holder.log?.seen : undefined), register: () => () => {},
  } as never)
  context.provide('agents', { get: (id: string) => (id === SESSION ? agent : undefined) } as never)
  const services = provideChatServices(context)
  const savedImages: string[] = []
  context.provide('attachments', {
    saveImage: (image: { mediaType: string; name: string }) => {
      savedImages.push(image.name)
      return Promise.resolve({ attachmentId: `att-${image.name}`, mediaType: image.mediaType })
    },
  } as never)
  await context.plugin(SystemPrompt, {}).await()
  await context.plugin(ToolRuntime).await()
  await context.plugin(DvProject, {
    projectsFolder: join(root, 'projects'), cpuConcurrency: 4, gpuConcurrency: 4, promptSectionOrder: 4900,
  }).await()
  const project = context.dvProject
  const assets = new MemoryAssets()
  project.registerAssetStore(assets)
  for (const key of STAND_IN_COMPONENTS) project.registerComponent(key)
  // One gate per prompt, made by whichever of the render and the release comes first.
  const gates = new Map<string, { promise: Promise<void>; resolve: () => void }>()
  const gate = (prompt: string): { promise: Promise<void>; resolve: () => void } => {
    const existing = gates.get(prompt)
    if (existing !== undefined) return existing
    let resolve = (): void => {}
    const made = { promise: new Promise<void>((done) => { resolve = done }), resolve: () => { resolve() } }
    gates.set(prompt, made)
    return made
  }
  const base = { version: '1', description: 'A test operation.', inputs: {}, deterministic: false } as const
  project.registerOperation({
    ...base, name: 'asset.import', component: 'asset', params: { name: { type: 'string' } }, outputs: [{ role: 'asset', type: 'image' }],
    resource: 'none', summarize: record => `imported ${String(record.params['name'])}`,
    inputs: { reference: { type: 'image', description: 'An earlier image.' } },
    execute: context => Promise.resolve({ outputs: [context.importAsset(Buffer.from(String(context.params['name'])), { mime: 'image/png', name: 'x.png' })] }),
  } satisfies OperationSpec)
  project.registerOperation({
    ...base, name: 'shot.render', component: 'shot', params: { prompt: { type: 'string' } }, outputs: [{ role: 'video', type: 'video' }],
    resource: 'gpu', summarize: record => `shot ${String(record.params['prompt'])}`,
    execute: async (context) => {
      const prompt = String(context.params['prompt'])
      await gate(prompt).promise
      if (prompt === 'broken') throw new Error('The backend refused the request.')
      return { outputs: [context.importAsset(Buffer.from(prompt), { mime: 'video/mp4', name: 'shot.mp4' })] }
    },
  } satisfies OperationSpec)
  project.registerOperation({
    ...base, name: 'shot.still', component: 'shot', params: { prompt: { type: 'string' } }, outputs: [{ role: 'still', type: 'image' }],
    resource: 'gpu', summarize: record => `still ${String(record.params['prompt'])}`,
    execute: async (context) => {
      const prompt = String(context.params['prompt'])
      await gate(prompt).promise
      return { outputs: [context.importAsset(Buffer.from(prompt), { mime: 'image/png', name: `${prompt}.png` })] }
    },
  } satisfies OperationSpec)
  // An unbound session runs in a folder of its own, which dv_proj_create can make a project.
  if (!bound) services.chats.open(SESSION, await project.newProjectFolder('From chat'))
  const projectId = bound
    ? await chatProject(project, services, 'Knife ad', user('create'))
    : (await project.createProject(await project.newProjectFolder('Knife ad'), 'Knife ad', user('create'))).id
  const deps: ProjToolDeps = { assets: () => assets, agentSummaries: () => [], turnOf: () => null, chatFolder: () => null }
  let calls = 0
  const log = new AgentLog(project, deps)
  holder.log = log
  return {
    context, project, projectId, services, deps, log, agent, savedImages, events: agentEvents(context, agent as never),
    call(name, args) {
      calls += 1
      const agent = { id: SESSION, session: { id: SESSION } }
      return context.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: agent as never })
    },
    async run(origin, operation, params, extra = {}) {
      const result = await project.run({ ...origin, project: projectId, operation, params, inputs: [], ...extra })
      if (result.record === null) throw new Error('the operation wrote no record')
      return result.record
    },
    release(prompt) {
      gate(prompt).resolve()
    },
  }
}

/** Wait until a record has the status. */
async function until(project: DvProject, projectId: ProjectId, record: RecordId, status: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && project.getRecord(projectId, record).status !== status; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(project.getRecord(projectId, record).status).toBe(status)
}

/** The update text of the given body lines. */
const update = (...lines: string[]): string => [UPDATE_HEAD, ...lines].join('\n')

describe('project state message', () => {
  it('starts with the binding sentence and the project summary without reports, and logs what it showed', async () => {
    const fixture = await start()
    const record = await fixture.run(user('import knife'), 'asset.import', { name: 'knife.png' })
    const render = await fixture.run(user('render'), 'shot.render', { prompt: 'held' }, { after: [] })
    await until(fixture.project, fixture.projectId, render.id, 'running')
    const message = projectMessage(fixture.project, fixture.deps, SESSION, fixture.log.seen)
    const text = message === null ? '' : textOf(message)
    const [head, ...json] = text.split('\n')
    const { title, path } = fixture.project.openProject(fixture.projectId)
    expect(head).toBe(`${STATE_HEAD} This conversation belongs to the project "${title}" in the folder ${path}: do all work in it `
      + 'and never call dv_proj_create. Later changes that your own tool results did not show reach you as DreamVerse project updates. '
      + 'The project summary, as dv_proj_state returns it without the reports of recent records:')
    const summary = JSON.parse(json.join('\n')) as { project_id: string; head: string; recent: Array<Record<string, unknown>> }
    expect(summary).toMatchObject({ project_id: fixture.projectId, head: render.id })
    expect(summary.recent.at(-2)).toEqual({
      record: record.id, operation: 'asset.import', status: 'done', intent: 'import knife', summary: 'imported knife.png',
      outputs: [`https://assets.example/${assetOf('knife.png')}`], based_on: null, supersedes: [],
    })
    expect(message?.source).toEqual({
      kind: 'dv-project', form: 'snapshot', sections: [{ name: 'dv-project', text }],
      shown: { project: fixture.projectId, base: 3, at: render.id, records: { [render.id]: 'running' } },
    })
  })

  it('sends nothing for a session without a project, and a state message when the session saw another project', async () => {
    const fixture = await start()
    expect(projectMessage(fixture.project, fixture.deps, brandString<SessionId>('unbound'), fixture.log.seen)).toBeNull()
    expect(fixture.log.step()).toMatch(/^DreamVerse project state\./)
    // What the agent of SESSION saw, read for a session whose folder is another project.
    await chatProject(fixture.project, fixture.services, 'Other', user('create'), 's2')
    const message = projectMessage(fixture.project, fixture.deps, brandString<SessionId>('s2'), fixture.log.seen)
    expect(message === null ? '' : textOf(message)).toContain('This conversation belongs to the project "Other"')
  })

  it('sends the state message after the agent binds an unbound conversation with dv_proj_create', async () => {
    const fixture = await start(false)
    expect(fixture.log.step()).toBeNull()
    fixture.log.toolResult(await fixture.call('dv_proj_create', { title: 'From chat' }))
    expect(fixture.log.step()).toMatch(/^DreamVerse project state\. This conversation belongs to the project "From chat" /)
    expect(fixture.log.step()).toBeNull()
  })
})

describe('project update message', () => {
  it('sends nothing when nothing changed since the last message', async () => {
    const fixture = await start()
    expect(fixture.log.step()).toMatch(/^DreamVerse project state\./)
    expect(fixture.log.step()).toBeNull()
  })

  it('reports a user import on the canvas with its output line, in the operation tool result output format', async () => {
    const fixture = await start()
    fixture.log.step()
    const record = await fixture.run(user('import knife'), 'asset.import', { name: 'knife.png' })
    const asset = assetOf('knife.png')
    expect(fixture.log.step()).toBe(update(
      `- done ${record.id} (user on canvas): imported knife.png`,
      `  - asset: ${asset} (image/png) https://assets.example/${asset}`,
    ))
    expect(fixture.log.step()).toBeNull()
  })

  it('repeats nothing that the agent\'s own tool results showed: an operation call and dv_proj_undo', async () => {
    const fixture = await start()
    fixture.log.step()
    fixture.log.toolResult(await fixture.call('dv_asset_import', { reason: 'product', name: 'product.png' }))
    expect(fixture.log.step()).toBeNull()
    fixture.log.toolResult(await fixture.call('dv_proj_undo', {}))
    expect(fixture.log.step()).toBeNull()
  })

  it('reports the finish of a scheduled record the agent saw pending once, and a failure with its intent and error', async () => {
    const fixture = await start()
    fixture.log.step()
    const one = await fixture.run(scheduler('shot 1 of plan p1'), 'shot.render', { prompt: 'one' }, { after: [] })
    const broken = await fixture.run(scheduler('shot 2 of plan p1'), 'shot.render', { prompt: 'broken' }, { after: [] })
    // The approval result listed both renders under scheduled.
    fixture.log.toolResult({
      isError: false, value: {}, content: [],
      meta: { dv_seen: { project: fixture.projectId, at: broken.id, records: { [one.id]: 'pending', [broken.id]: 'pending' } } },
    })
    expect(fixture.log.step()).toBeNull()
    await until(fixture.project, fixture.projectId, broken.id, 'running')
    fixture.release('one')
    fixture.release('broken')
    await fixture.project.wait(fixture.projectId)
    const asset = assetOf('one')
    expect(fixture.log.step()).toBe(update(
      `- done ${one.id} (scheduled): shot one`,
      `  - video: ${asset} (video/mp4) https://assets.example/${asset}`,
      `- failed ${broken.id} (scheduled): shot 2 of plan p1: The backend refused the request.`,
    ))
    expect(fixture.log.step()).toBeNull()
  })

  it('reports a user render once while it runs and once when it finishes', async () => {
    const fixture = await start()
    fixture.log.step()
    const render = await fixture.run(user('render shot 3 again'), 'shot.render', { prompt: 'three' }, { after: [] })
    await until(fixture.project, fixture.projectId, render.id, 'running')
    expect(fixture.log.step()).toBe(update(`- running ${render.id} (user on canvas): render shot 3 again`))
    expect(fixture.log.step()).toBeNull()
    fixture.release('three')
    await fixture.project.wait(fixture.projectId)
    expect(fixture.log.step()).toBe(update(
      `- done ${render.id} (user on canvas): shot three`, `  - video: ${assetOf('three')} (video/mp4) https://assets.example/${assetOf('three')}`,
    ))
    expect(fixture.log.step()).toBeNull()
  })

  it('reports an undo and a redo as moves, and an undo followed by a write as a move with the new record', async () => {
    const fixture = await start()
    const first = await fixture.run(user('a'), 'asset.import', { name: 'a.png' })
    const second = await fixture.run(user('b'), 'asset.import', { name: 'b.png' })
    await fixture.run(user('c'), 'asset.import', { name: 'c.png' })
    fixture.log.step()
    await fixture.project.undo(fixture.projectId)
    await fixture.project.undo(fixture.projectId)
    expect(fixture.log.step()).toBe(update(`- history: the current step is ${first.id}; dv_proj_history_list shows which steps are undone or discarded.`))
    await fixture.project.redo(fixture.projectId)
    expect(fixture.log.step()).toBe(update(`- history: the current step is ${second.id}; dv_proj_history_list shows which steps are undone or discarded.`))
    await fixture.project.undo(fixture.projectId)
    const written = await fixture.run(user('d'), 'asset.import', { name: 'd.png' })
    expect(fixture.log.step()).toBe(update(
      `- history: the current step is ${written.id}; dv_proj_history_list shows which steps are undone or discarded.`,
      `- done ${written.id} (user on canvas): imported d.png`, `  - asset: ${assetOf('d.png')} (image/png) https://assets.example/${assetOf('d.png')}`,
    ))
  })

  it('reports the user\'s undo of a record the agent\'s own call wrote, and skips a record written and undone before the agent saw it', async () => {
    const fixture = await start()
    fixture.log.step()
    const own = await fixture.call('dv_asset_import', { reason: 'product', name: 'product.png' })
    fixture.log.toolResult(own)
    await fixture.project.undo(fixture.projectId)
    const head = fixture.project.line(fixture.projectId).at
    expect(fixture.log.step()).toBe(update(`- history: the current step is ${head}; dv_proj_history_list shows which steps are undone or discarded.`))
    await fixture.project.moveTo(fixture.projectId, head)
    await fixture.run(user('passing'), 'asset.import', { name: 'passing.png' })
    await fixture.project.undo(fixture.projectId)
    expect(fixture.log.step()).toBeNull()
  })

  it('names a record of another chat session and an unreported record of this session\'s agent', async () => {
    const fixture = await start()
    fixture.log.step()
    const agent = (session: string): RecordOrigin => ({
      actor: 'agent', surface: 'chat', session: brandString<SessionId>(session), turn: null, tool_call: 'call-x', intent: 'agent import',
    })
    const other = await fixture.run(agent('s2'), 'asset.import', { name: 'other.png' })
    const stopped = await fixture.run(agent(SESSION), 'asset.import', { name: 'stopped.png' })
    expect(fixture.log.step()).toBe(update(
      `- done ${other.id} (another chat): imported other.png`, `  - asset: ${assetOf('other.png')} (image/png) https://assets.example/${assetOf('other.png')}`,
      `- done ${stopped.id} (your call): imported stopped.png`, `  - asset: ${assetOf('stopped.png')} (image/png) https://assets.example/${assetOf('stopped.png')}`,
    ))
  })

  it('nets out an undo followed by a redo', async () => {
    const fixture = await start()
    await fixture.run(user('a'), 'asset.import', { name: 'a.png' })
    fixture.log.step()
    await fixture.project.undo(fixture.projectId)
    await fixture.project.redo(fixture.projectId)
    expect(fixture.log.step()).toBeNull()
  })
})

describe('dvProjectSight fold', () => {
  it('ignores the metadata of other tools and returns the same state for events it does not read', async () => {
    const fixture = await start()
    fixture.log.step()
    const before = fixture.log.seen
    fixture.log.toolResult({ isError: false, value: {}, content: [], meta: { record: 'r1', tool: 'other' } })
    fixture.log.toolResult({ isError: false, value: {}, content: [], meta: { dv_seen: { kind: 'unknown' } } })
    fixture.log.toolResult({ isError: false, value: {}, content: [], meta: { dv_seen: { project: 'other', records: {} } } })
    fixture.log.append({ type: 'turn/start', seq: fixture.log.next, time: 0, data: { turn: 2 } })
    expect(fixture.log.seen).toBe(before)
  })

  it('resets when a surface replacement reaches the project state message, and only then', async () => {
    const fixture = await start()
    fixture.log.append({ type: 'turn/start', seq: fixture.log.next, time: 0, data: { turn: 1 } })
    fixture.log.step()
    const from = fixture.log.seen.from ?? -1
    expect(from).toBe(1)
    const checkpoint = (endSeq: number): SessionEvent => ({
      type: 'user/message', seq: fixture.log.next, time: 0, surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(endSeq) },
      data: createUserMessage({ content: [{ type: 'text', text: 'Summary of the earlier conversation.' }], source: { kind: 'user' } }),
    })
    const before = fixture.log.seen
    fixture.log.append(checkpoint(0))
    expect(fixture.log.seen).toBe(before)
    fixture.log.append(checkpoint(from))
    expect(fixture.log.seen).toEqual({ from: null })
    expect(fixture.log.step()).toMatch(/^DreamVerse project state\./)
  })

  it('recovers the same state and the same next message when the log is folded again after a restart', async () => {
    const fixture = await start()
    fixture.log.step()
    fixture.log.toolResult(await fixture.call('dv_asset_import', { reason: 'product', name: 'product.png' }))
    const render = await fixture.run(user('render'), 'shot.render', { prompt: 'four' }, { after: [] })
    await until(fixture.project, fixture.projectId, render.id, 'running')
    fixture.log.step()
    const definition = seenProjection()
    const replayed = fixture.log.events.reduce(definition.apply, definition.init({} as never, 0 as never))
    expect(replayed).toEqual(fixture.log.seen)
    expect(definition.stateSchema.parse(JSON.parse(JSON.stringify(replayed)))).toEqual(replayed)
    fixture.release('four')
    await fixture.project.wait(fixture.projectId)
    expect(projectMessage(fixture.project, fixture.deps, SESSION, replayed)).toEqual(
      expect.objectContaining({ content: projectMessage(fixture.project, fixture.deps, SESSION, fixture.log.seen)?.content }),
    )
  })
})

describe('finished records in the agent\'s messages', () => {
  /** Run the `agent/pre-step` waterfall of one step that claimed `messages`, and log the step's messages. */
  async function runStep(fixture: Fixture, messages: UserMessage[], step: number): Promise<UserMessage[]> {
    const decision = await fixture.events.waterfall('agent/pre-step', { messages, turn: 1, step, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages }))
    if (decision.kind !== 'enter') throw new Error('expected step entry')
    for (const message of decision.messages) fixture.log.logMessage(message)
    return decision.messages
  }

  /** The result lines of a record in every logged user message. */
  function resultLines(log: AgentLog, record: RecordId): string[] {
    return log.events.flatMap(event => (event.type === 'user/message' ? textOf(event.data).split('\n') : []))
      .filter(line => line.startsWith(`- done ${record} `))
  }

  /** Start a render as the agent's call, log its pending result, and wait until it finished and its notice was queued. */
  async function finishedRender(fixture: Fixture, prompt: string, tool = 'dv_shot_render'): Promise<RecordId> {
    const result = await fixture.call(tool, { reason: prompt, prompt })
    fixture.log.toolResult(result)
    const record = brandString<RecordId>((result.value as { record: string }).record)
    fixture.release(prompt)
    await fixture.project.wait(fixture.projectId, [record])
    for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve))
    expect(fixture.agent.queued).toHaveLength(1)
    return record
  }

  /** The `- done` line and the video output line of a finished render of `prompt`. */
  function doneLines(record: RecordId, prompt: string): string[] {
    return [`- done ${record} (your call): shot ${prompt}`, `  - video: ${assetOf(prompt)} (video/mp4) https://assets.example/${assetOf(prompt)}`]
  }

  it('lists a render once when a project update reported it before the step that claims the record notice', async () => {
    const fixture = await start()
    fixture.agent.status = 'running'
    fixture.log.step()
    const record = await finishedRender(fixture, 'one')
    expect((await runStep(fixture, [], 2)).map(textOf)).toEqual([update(...doneLines(record, 'one'))])
    // The busy agent's step that claims the late wake has no message, so the loop ends the turn without a model request.
    expect(await runStep(fixture, fixture.agent.claim(), 3)).toEqual([])
    expect(resultLines(fixture.log, record)).toHaveLength(1)
  })

  it('lists a render once when the step that claims the wake comes first, as the project update of that step', async () => {
    const fixture = await start()
    fixture.log.step()
    const record = await finishedRender(fixture, 'one')
    expect((await runStep(fixture, fixture.agent.claim(), 1)).map(textOf)).toEqual([update(...doneLines(record, 'one'))])
    expect(await runStep(fixture, [], 2)).toEqual([])
    expect(resultLines(fixture.log, record)).toHaveLength(1)
  })

  it('leaves the first step of a turn opened by a late wake empty, so an idle agent makes no model request', async () => {
    const fixture = await start()
    fixture.log.step()
    const record = await finishedRender(fixture, 'one')
    const wake = fixture.agent.claim()
    const typed = createUserMessage({ content: [{ type: 'text', text: 'how is it going?' }], source: { kind: 'user' } })
    // The user's message opened the turn before the wake: its step lists the finish after the message.
    expect((await runStep(fixture, [typed], 1)).map(textOf)).toEqual(['how is it going?', update(...doneLines(record, 'one'))])
    expect(await runStep(fixture, wake, 1)).toEqual([])
    expect(resultLines(fixture.log, record)).toHaveLength(1)
  })

  it('merges the wakes of one step into one project update after the user\'s message, and logs no wake', async () => {
    const fixture = await start()
    fixture.agent.status = 'running'
    fixture.log.step()
    const one = await finishedRender(fixture, 'one')
    const first = fixture.agent.claim()
    const two = await finishedRender(fixture, 'two')
    const typed = createUserMessage({ content: [{ type: 'text', text: 'and now?' }], source: { kind: 'user' } })
    const messages = await runStep(fixture, [...first, typed, ...fixture.agent.claim()], 2)
    expect(messages.map(textOf)).toEqual(['and now?', update(...doneLines(one, 'one'), ...doneLines(two, 'two'))])
    expect(fixture.log.events.some(event => event.type === 'user/message' && event.data.source.kind === 'dv-project-wake')).toBe(false)
  })

  it('carries only text for a finished call without an image output', async () => {
    const fixture = await start()
    fixture.log.step()
    await finishedRender(fixture, 'one')
    const messages = await runStep(fixture, fixture.agent.claim(), 1)
    expect(messages.flatMap(message => message.content.map(block => block.type))).toEqual(['text'])
    expect(fixture.savedImages).toEqual([])
  })

  it('shows the image outputs of the agent\'s own finished call as images after the update text, and logs them', async () => {
    const fixture = await start()
    fixture.log.step()
    const record = await finishedRender(fixture, 'frame', 'dv_shot_still')
    const [message] = await runStep(fixture, fixture.agent.claim(), 1)
    expect(message?.content).toEqual([
      { type: 'text', text: update(`- done ${record} (your call): still frame`, `  - still: ${assetOf('frame')} (image/png) https://assets.example/${assetOf('frame')}`) },
      { type: 'image', attachment: { attachmentId: 'att-frame.png', mediaType: 'image/png' } },
    ])
    expect(fixture.savedImages).toEqual(['frame.png'])
    // Model-visible ⟺ logged: the logged project update carries the same image.
    const logged = fixture.log.events.findLast(event => event.type === 'user/message')
    expect(logged?.type === 'user/message' ? logged.data.content : []).toEqual(message?.content)
  })

  it('shows no image for a finished record that the user started', async () => {
    const fixture = await start()
    fixture.log.step()
    const render = await fixture.run(user('still on the canvas'), 'shot.still', { prompt: 'canvas' }, { after: [] })
    fixture.release('canvas')
    await fixture.project.wait(fixture.projectId, [render.id])
    const messages = await runStep(fixture, [], 2)
    expect(messages.map(textOf)).toEqual([update(`- done ${render.id} (user on canvas): still canvas`, `  - still: ${assetOf('canvas')} (image/png) https://assets.example/${assetOf('canvas')}`)])
    expect(messages.flatMap(message => message.content.map(block => block.type))).toEqual(['text'])
    expect(fixture.savedImages).toEqual([])
  })

  it('removes a wake even when nothing is bound, and returns other steps unchanged', async () => {
    const fixture = await start(false)
    expect(await runStep(fixture, [wakeMessage([brandString<RecordId>('r1')])], 1)).toEqual([])
    expect(await runStep(fixture, [], 1)).toEqual([])
  })
})
