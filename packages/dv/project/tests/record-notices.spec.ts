/**
 * Record notices through the `dvProject` service with the real DSH tool registry: a GPU operation call runs in the
 * background and returns `pending`, and the agent of the calling session gets the record's wake when it finishes, as a
 * followup that opens a turn while it is idle or an injection while it runs or still waits for its other records. The
 * `agents` registry is a stand-in whose agents record the messages they get.
 */
import { join } from 'node:path'
import { Context, FiberState } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { PENDING_LINE } from '../src/agent-tools.ts'
import DvProject, { type OperationSpec, type ProjectId, type RecordId, type SessionId } from '../src/index.ts'
import { RecordNotices } from '../src/record-notices.ts'
import { MemoryAssets, STAND_IN_COMPONENTS, tempRoot, textOf } from './support.ts'
import { chatProject, provideChatServices } from './workspaces.ts'

/** The chat session of the agent under test, and a second one. */
const SESSION = brandString<SessionId>('s1')
const OTHER = brandString<SessionId>('s2')
/** Passed as the session of a call without an agent. */
const ANONYMOUS = brandString<SessionId>('anonymous')

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** A stand-in agent: its status, and each message it got with how it got it. */
class FakeAgent {
  status: 'idle' | 'running' = 'idle'
  readonly got: Array<{ how: 'followup' | 'inject'; message: UserMessage }> = []
  /** The agent-scoped context; only its fiber state is read. */
  readonly ctx = { fiber: { state: FiberState.ACTIVE } }
  /** The inboxes, which stay empty: the record notices read them before a wake opens a turn. */
  readonly inbox = { nextStep: [] as UserMessage[], nextTurn: [] as UserMessage[] }

  constructor(readonly id: SessionId) {}

  get session(): { id: SessionId } {
    return { id: this.id }
  }

  followup(message: UserMessage): void {
    this.got.push({ how: 'followup', message })
  }

  inject(message: UserMessage): void {
    this.got.push({ how: 'inject', message })
  }

  /** How each message arrived, in order. */
  get hows(): string[] {
    return this.got.map(entry => entry.how)
  }
}

interface Fixture {
  context: Context
  project: DvProject
  projectId: ProjectId
  agents: Map<string, FakeAgent>
  /** The names of the images saved through the stand-in attachment service. */
  savedImages: string[]
  /** Run one tool as the agent of a session. */
  call(name: string, args: Record<string, unknown>, session?: SessionId): Promise<ToolExecutionResult>
  /** Let the render of `prompt` finish. */
  release(prompt: string): void
  /** Wait until every record of the project finished. */
  settle(): Promise<void>
}

/**
 * Mount the DSH tool registry and `dvProject` with an in-memory asset store, a stand-in `agents` registry with an agent
 * for {@link SESSION}, a stand-in attachment service that records each save, and two operations: a GPU `shot.render`
 * that waits until the test releases its prompt, outputs a video and a still, and fails for the prompt `broken`; and an
 * `asset.import` of resource `none`.
 * @param config - extra `dvProject` config.
 * @returns the fixture.
 */
async function start(config: { maxConsecutiveWakes?: number } = {}): Promise<Fixture> {
  const root = tempRoot()
  const context = new Context()
  contexts.push(context)
  const agents = new Map<string, FakeAgent>([[SESSION, new FakeAgent(SESSION)]])
  const savedImages: string[] = []
  const services = provideChatServices(context)
  context.provide('sessionProjections', { stateOf: () => undefined, register: () => () => {} } as never)
  context.provide('agents', { get: (id: string) => agents.get(id) } as never)
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
    ...config,
  }).await()
  const project = context.dvProject
  const assets = new MemoryAssets()
  project.registerAssetStore(assets)
  for (const key of STAND_IN_COMPONENTS) project.registerComponent(key)
  const gates = new Map<string, { promise: Promise<unknown>; resolve: () => void }>()
  const gate = (prompt: string): { promise: Promise<unknown>; resolve: () => void } => {
    const existing = gates.get(prompt)
    if (existing !== undefined) return existing
    let resolve = (): void => {}
    const made = { promise: new Promise((done) => { resolve = () => { done(prompt) } }), resolve: () => { resolve() } }
    gates.set(prompt, made)
    return made
  }
  const base = { version: '1', description: 'A test operation.', inputs: {}, deterministic: false } as const
  project.registerOperation({
    ...base, name: 'shot.render', component: 'shot', params: { prompt: { type: 'string' } },
    outputs: [{ role: 'video', type: 'video' }, { role: 'last_frame', type: 'image' }],
    resource: 'gpu', summarize: record => `shot ${String(record.params['prompt'])}`,
    execute: async (context) => {
      const prompt = String(context.params['prompt'])
      await Promise.race([gate(prompt).promise, new Promise((_resolve, reject) => {
        if (context.signal.aborted) reject(new Error('aborted'))
        context.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })])
      if (prompt === 'broken') throw new Error('The backend refused the request.')
      return { outputs: [
        context.importAsset(Buffer.from(`video ${prompt}`), { mime: 'video/mp4', name: 'shot.mp4' }),
        context.importAsset(Buffer.from(`frame ${prompt}`), { mime: 'image/png', name: 'last.png' }),
      ] }
    },
  } satisfies OperationSpec)
  project.registerOperation({
    ...base, name: 'bible.note', component: 'bible', params: {}, outputs: [{ role: 'note', type: 'text' }], resource: 'cpu',
    inputs: { source: { type: 'video', description: 'A rendered video.' } }, summarize: () => 'note',
    execute: context => Promise.resolve({ outputs: [context.importAsset(Buffer.from('note'), { mime: 'text/plain', name: 'note.txt' })] }),
  } satisfies OperationSpec)
  project.registerOperation({
    ...base, name: 'asset.import', component: 'asset', params: { name: { type: 'string' } }, outputs: [{ role: 'asset', type: 'image' }],
    resource: 'none', summarize: record => `imported ${String(record.params['name'])}`,
    execute: context => Promise.resolve({ outputs: [context.importAsset(Buffer.from(String(context.params['name'])), { mime: 'image/png', name: 'x.png' })] }),
  } satisfies OperationSpec)
  const projectId = await chatProject(project, services, 'Dunk', { actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'create' }, SESSION)
  // The second chat and the calls without an agent run in the same folder, so they work on the same project.
  const folder = services.chats.get(SESSION)?.header.cwd ?? ''
  services.chats.open(OTHER, folder)
  services.chats.open(ANONYMOUS, folder)
  let calls = 0
  return {
    context, project, projectId, agents, savedImages,
    call(name, args, session = SESSION) {
      calls += 1
      const agent = session === ANONYMOUS ? undefined : { id: session, session: { id: session } }
      return context.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: agent as never })
    },
    release(prompt) {
      gate(prompt).resolve()
    },
    async settle() {
      await project.wait(projectId)
    },
  }
}

/** The record ID of an operation tool result. */
function recordOf(result: ToolExecutionResult): RecordId {
  return brandString<RecordId>((result.value as { record: string }).record)
}

/** The text of the wake of one record. */
const wakeText = (record: RecordId): string =>
  `DreamVerse operations you started have finished: ${record}. A DreamVerse project update follows with their results.`

describe('record notices', () => {
  it('runs a GPU call in the background and returns it pending; a call of a none operation still returns its final record', async () => {
    const fixture = await start()
    const render = await fixture.call('dv_shot_render', { reason: 'dunk', prompt: 'dunk' })
    expect(render.isError).toBe(false)
    expect(render.value).toMatchObject({ status: 'pending', outputs: [] })
    const text = render.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text.split('\n').at(-1)).toBe(PENDING_LINE)
    expect(fixture.project.getRecord(fixture.projectId, recordOf(render)).status).not.toBe('done')
    const imported = await fixture.call('dv_asset_import', { reason: 'photo', name: 'photo.png' })
    expect(imported.value).toMatchObject({ status: 'done' })
    fixture.release('dunk')
    await fixture.settle()
  })

  it('wakes an idle agent with a wake that names a done record and carries no result and no image', async () => {
    const fixture = await start()
    const agent = fixture.agents.get(SESSION)
    const record = recordOf(await fixture.call('dv_shot_render', { reason: 'dunk', prompt: 'dunk' }))
    expect(agent?.got).toEqual([])
    fixture.release('dunk')
    await fixture.settle()
    expect(agent?.hows).toEqual(['followup'])
    const message = agent?.got[0]?.message
    expect(message?.content).toEqual([{ type: 'text', text: wakeText(record) }])
    expect(message?.source).toEqual({ kind: 'dv-project-wake', form: 'notice', summary: `1 finished: ${record}`, records: [record] })
    // The render's last frame is an image output; no message the agent gets attaches it.
    expect(fixture.savedImages).toEqual([])
  })

  it('wakes an idle agent for a failed record', async () => {
    const fixture = await start()
    const record = recordOf(await fixture.call('dv_shot_render', { reason: 'a broken dunk', prompt: 'broken' }))
    fixture.release('broken')
    await fixture.settle()
    const agent = fixture.agents.get(SESSION)
    expect(agent?.hows).toEqual(['followup'])
    expect(textOf(agent?.got[0]?.message)).toBe(wakeText(record))
  })

  it('injects without a wake while other records of the session run, and wakes with the last one', async () => {
    const fixture = await start()
    const agent = fixture.agents.get(SESSION)
    const one = recordOf(await fixture.call('dv_shot_render', { reason: 'one', prompt: 'one' }))
    await fixture.call('dv_shot_render', { reason: 'two', prompt: 'two' })
    fixture.release('one')
    await fixture.project.wait(fixture.projectId, [one])
    expect(agent?.hows).toEqual(['inject'])
    fixture.release('two')
    await fixture.settle()
    expect(agent?.hows).toEqual(['inject', 'followup'])
  })

  it('wakes the agent for a CPU call behind an unfinished input that another chat started', async () => {
    const fixture = await start()
    const render = recordOf(await fixture.call('dv_shot_render', { reason: 'theirs', prompt: 'theirs' }, OTHER))
    const result = await fixture.call('dv_bible_note', { reason: 'note it', inputs: { source: `${render}#0` } })
    expect(result.value).toMatchObject({ status: 'pending' })
    const note = recordOf(result)
    const agent = fixture.agents.get(SESSION)
    expect(agent?.got).toEqual([])
    fixture.release('theirs')
    await fixture.settle()
    expect(fixture.project.getRecord(fixture.projectId, note).status).toBe('done')
    expect(agent?.hows).toEqual(['followup'])
    expect(textOf(agent?.got[0]?.message)).toBe(wakeText(note))
  })

  it('wakes the agent for a call that failed because its input\'s record failed', async () => {
    const fixture = await start()
    const render = recordOf(await fixture.call('dv_shot_render', { reason: 'theirs', prompt: 'broken' }, OTHER))
    const note = recordOf(await fixture.call('dv_bible_note', { reason: 'note it', inputs: { source: `${render}#0` } }))
    fixture.release('broken')
    await fixture.settle()
    expect(fixture.project.getRecord(fixture.projectId, note)).toMatchObject({ status: 'failed', error: { code: 'input_failed' } })
    const agent = fixture.agents.get(SESSION)
    expect(agent?.hows).toEqual(['followup'])
    expect(textOf(agent?.got[0]?.message)).toBe(wakeText(note))
  })

  it('drops the watch of a record that a write after an undo discarded, without a wake', async () => {
    const fixture = await start()
    const agent = fixture.agents.get(SESSION)
    const one = recordOf(await fixture.call('dv_shot_render', { reason: 'one', prompt: 'one' }))
    const two = recordOf(await fixture.call('dv_shot_render', { reason: 'two', prompt: 'two' }))
    await fixture.project.undo(fixture.projectId)
    await fixture.project.run({
      actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'import on the canvas',
      project: fixture.projectId, operation: 'asset.import', params: { name: 'photo.png' }, inputs: [], after: [],
    })
    await fixture.project.wait(fixture.projectId, [two])
    expect(fixture.project.getRecord(fixture.projectId, two)).toMatchObject({ status: 'cancelled', error: { code: 'discarded' } })
    expect(agent?.got).toEqual([])
    // The discarded record no longer counts as unfinished, so the last watched record wakes the idle agent.
    fixture.release('one')
    await fixture.settle()
    expect(agent?.hows).toEqual(['followup'])
    expect(textOf(agent?.got[0]?.message)).toBe(wakeText(one))
  })

  it('sends no wake for a record that finished while an undo left it after the current position', async () => {
    const fixture = await start()
    const agent = fixture.agents.get(SESSION)
    const record = recordOf(await fixture.call('dv_shot_render', { reason: 'dunk', prompt: 'dunk' }))
    await fixture.project.undo(fixture.projectId)
    fixture.release('dunk')
    await fixture.settle()
    expect(fixture.project.getRecord(fixture.projectId, record).status).toBe('done')
    expect(agent?.got).toEqual([])
  })

  it('injects into a running agent', async () => {
    const fixture = await start()
    const agent = fixture.agents.get(SESSION)
    await fixture.call('dv_shot_render', { reason: 'dunk', prompt: 'dunk' })
    if (agent !== undefined) agent.status = 'running'
    fixture.release('dunk')
    await fixture.settle()
    expect(agent?.hows).toEqual(['inject'])
  })

  it('injects past maxConsecutiveWakes until a message from the user refills the budget', async () => {
    const fixture = await start({ maxConsecutiveWakes: 1 })
    const agent = fixture.agents.get(SESSION)
    const render = async (prompt: string): Promise<void> => {
      await fixture.call('dv_shot_render', { reason: prompt, prompt })
      fixture.release(prompt)
      await fixture.settle()
    }
    await render('one')
    await render('two')
    expect(agent?.hows).toEqual(['followup', 'inject'])
    // Claiming its own wake does not refill the budget; the user's message does.
    const notice = agent?.got[1]?.message
    if (notice !== undefined) fixture.context.emit('agent/inbox/claimed', { agent: agent as never, message: notice, turn: 2 })
    await render('three')
    expect(agent?.hows).toEqual(['followup', 'inject', 'inject'])
    const typed = createUserMessage({ content: [{ type: 'text', text: 'more' }], source: { kind: 'user' } })
    fixture.context.emit('agent/inbox/claimed', { agent: agent as never, message: typed, turn: 3 })
    await render('four')
    expect(agent?.hows).toEqual(['followup', 'inject', 'inject', 'followup'])
  })

  it('delivers nothing for a session without an agent, and only to the calling session', async () => {
    const fixture = await start()
    const other = new FakeAgent(OTHER)
    await fixture.call('dv_shot_render', { reason: 'theirs', prompt: 'theirs' }, OTHER)
    fixture.release('theirs')
    await fixture.settle()
    expect(other.got).toEqual([])
    expect(fixture.agents.get(SESSION)?.got).toEqual([])
    fixture.agents.set(OTHER, other)
    await fixture.call('dv_shot_render', { reason: 'theirs again', prompt: 'again' }, OTHER)
    fixture.release('again')
    await fixture.settle()
    expect(other.hows).toEqual(['followup'])
    expect(fixture.agents.get(SESSION)?.got).toEqual([])
  })

  it('sends no wake for a record that no agent call started', async () => {
    const fixture = await start()
    await fixture.project.run({
      actor: 'user', surface: 'canvas', session: SESSION, turn: null, tool_call: null, intent: 'retry on the canvas',
      project: fixture.projectId, operation: 'shot.render', params: { prompt: 'canvas' }, inputs: [], after: [],
    })
    fixture.release('canvas')
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.got).toEqual([])
  })

  it('watches nothing for a call without an agent', async () => {
    const fixture = await start()
    const result = await fixture.call('dv_shot_render', { reason: 'sdk', prompt: 'sdk' }, ANONYMOUS)
    expect(result.value).toMatchObject({ status: 'pending' })
    fixture.release('sdk')
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.got).toEqual([])
  })

  it('delivers at once a record that finished before its watch, and ignores a watch of another project', async () => {
    const fixture = await start()
    const notices = new RecordNotices(fixture.context, fixture.project, undefined)
    const imported = recordOf(await fixture.call('dv_asset_import', { reason: 'photo', name: 'photo.png' }))
    const record = fixture.project.getRecord(fixture.projectId, imported)
    notices.recordFinished(brandString<ProjectId>('elsewhere'), record)
    notices.watch(fixture.projectId, imported, SESSION)
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.hows).toEqual(['followup'])
    expect(textOf(fixture.agents.get(SESSION)?.got[0]?.message)).toBe(wakeText(imported))
    notices.recordFinished(fixture.projectId, record)
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.hows).toEqual(['followup'])
  })
})
