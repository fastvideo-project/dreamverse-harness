/**
 * Record notices through the `dvProject` service with the real DSH tool registry: a GPU operation call runs in the
 * background and returns `pending`, and the agent of the calling session gets the record's notice when it finishes,
 * as a wake while it is idle or an injection while it runs or still waits for its other records. The `agents`
 * registry is a stand-in whose agents record the messages they get.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { PENDING_LINE } from '../src/agent-tools.ts'
import DvProject, { type OperationSpec, type ProjectId, type RecordId, type SessionId } from '../src/index.ts'
import { NOTICE_HEAD } from '../src/project-updates.ts'
import { RecordNotices } from '../src/record-notices.ts'
import { MemoryAssets, STAND_IN_COMPONENTS, tempRoot } from './support.ts'
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
  assets: MemoryAssets
  agents: Map<string, FakeAgent>
  /** Images saved through the stand-in attachment service; a hook runs before each save. */
  beforeSave: { hook: () => void }
  /** Run one tool as the agent of a session. */
  call(name: string, args: Record<string, unknown>, session?: SessionId): Promise<ToolExecutionResult>
  /** Let the render of `prompt` finish. */
  release(prompt: string): void
  /** Wait until every record of the project finished and every notice was delivered. */
  settle(): Promise<void>
}

/**
 * Mount the DSH tool registry and `dvProject` with an in-memory asset store, a stand-in `agents` registry with an agent
 * for {@link SESSION}, a stand-in attachment service, and two operations: a GPU `shot.render` that waits until the test
 * releases its prompt, outputs a video and a still, and fails for the prompt `broken`; and an `asset.import` of resource
 * `none`.
 * @param config - extra `dvProject` config.
 * @returns the fixture.
 */
async function start(config: { maxConsecutiveWakes?: number } = {}): Promise<Fixture> {
  const root = tempRoot()
  const context = new Context()
  contexts.push(context)
  const agents = new Map<string, FakeAgent>([[SESSION, new FakeAgent(SESSION)]])
  const beforeSave = { hook: (): void => {} }
  const services = provideChatServices(context)
  context.provide('sessionProjections', { stateOf: () => undefined, register: () => () => {} } as never)
  context.provide('agents', { get: (id: string) => agents.get(id) } as never)
  context.provide('attachments', {
    saveImage: (image: { mediaType: string; name: string }) => {
      beforeSave.hook()
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
      await gate(prompt).promise
      if (prompt === 'broken') throw new Error('The backend refused the request.')
      return { outputs: [
        context.importAsset(Buffer.from(`video ${prompt}`), { mime: 'video/mp4', name: 'shot.mp4' }),
        context.importAsset(Buffer.from(`frame ${prompt}`), { mime: 'image/png', name: 'last.png' }),
      ] }
    },
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
    context, project, projectId, assets, agents, beforeSave,
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
      // Delivery awaits the image attachments before it hands the notice over.
      for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve))
    },
  }
}

/** The text of a message's text blocks. */
function textOf(message: UserMessage | undefined): string {
  return message?.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
}

/** The record ID of an operation tool result. */
function recordOf(result: ToolExecutionResult): RecordId {
  return brandString<RecordId>((result.value as { record: string }).record)
}

/** The asset ID of the bytes of a text. */
const assetOf = (text: string): string => createHash('sha256').update(text).digest('hex')

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

  it('wakes an idle agent with the notice of a done record: its line, its outputs and its image', async () => {
    const fixture = await start()
    const agent = fixture.agents.get(SESSION)
    const record = recordOf(await fixture.call('dv_shot_render', { reason: 'dunk', prompt: 'dunk' }))
    expect(agent?.got).toEqual([])
    fixture.release('dunk')
    await fixture.settle()
    expect(agent?.hows).toEqual(['followup'])
    const message = agent?.got[0]?.message
    const video = assetOf('video dunk')
    const frame = assetOf('frame dunk')
    expect(textOf(message)).toBe([
      NOTICE_HEAD,
      `- done ${record} (your call): shot dunk`,
      `  - video: ${video} (video/mp4) https://assets.example/${video}`,
      `  - last_frame: ${frame} (image/png) https://assets.example/${frame}`,
    ].join('\n'))
    expect(message?.content.at(-1)).toEqual({ type: 'image', attachment: { attachmentId: 'att-last.png', mediaType: 'image/png' } })
    expect(message?.source).toEqual({
      kind: 'dv-project', form: 'notice', summary: `done ${record}`, shown: { project: fixture.projectId, records: { [record]: 'done' } },
    })
  })

  it('reports a failed record with its intent and error', async () => {
    const fixture = await start()
    const record = recordOf(await fixture.call('dv_shot_render', { reason: 'a broken dunk', prompt: 'broken' }))
    fixture.release('broken')
    await fixture.settle()
    const agent = fixture.agents.get(SESSION)
    expect(agent?.hows).toEqual(['followup'])
    expect(textOf(agent?.got[0]?.message)).toBe(`${NOTICE_HEAD}\n- failed ${record} (your call): a broken dunk: The backend refused the request.`)
  })

  it('injects without a wake while other records of the session run, and wakes with the last one', async () => {
    const fixture = await start()
    const agent = fixture.agents.get(SESSION)
    await fixture.call('dv_shot_render', { reason: 'one', prompt: 'one' })
    await fixture.call('dv_shot_render', { reason: 'two', prompt: 'two' })
    fixture.release('one')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(agent?.hows).toEqual(['inject'])
    fixture.release('two')
    await fixture.settle()
    expect(agent?.hows).toEqual(['inject', 'followup'])
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
    // Claiming its own notice does not refill the budget; the user's message does.
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

  it('sends no notice for a record that no agent call started', async () => {
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

  it('drops the notice when the agent leaves while its images are saved', async () => {
    const fixture = await start()
    await fixture.call('dv_shot_render', { reason: 'dunk', prompt: 'dunk' })
    const agent = fixture.agents.get(SESSION)
    fixture.beforeSave.hook = () => { fixture.agents.delete(SESSION) }
    fixture.release('dunk')
    await fixture.settle()
    expect(agent?.got).toEqual([])
  })

  it('logs a delivery that fails and keeps delivering others', async () => {
    const fixture = await start()
    await fixture.call('dv_shot_render', { reason: 'dunk', prompt: 'dunk' })
    fixture.beforeSave.hook = () => { throw new Error('disk full') }
    fixture.release('dunk')
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.got).toEqual([])
    fixture.beforeSave.hook = () => {}
    await fixture.call('dv_shot_render', { reason: 'again', prompt: 'again' })
    fixture.release('again')
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.hows).toEqual(['followup'])
  })

  it('delivers at once a record that finished before its watch, and ignores a watch of another project', async () => {
    const fixture = await start()
    const notices = new RecordNotices(fixture.context, fixture.project, {
      assets: () => fixture.assets, agentSummaries: () => [], turnOf: () => null,
    }, undefined)
    const imported = recordOf(await fixture.call('dv_asset_import', { reason: 'photo', name: 'photo.png' }))
    const record = fixture.project.getRecord(fixture.projectId, imported)
    notices.recordFinished(brandString<ProjectId>('elsewhere'), record)
    notices.watch(fixture.projectId, imported, SESSION)
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.hows).toEqual(['followup'])
    expect(textOf(fixture.agents.get(SESSION)?.got[0]?.message)).toContain(`- done ${imported} (your call): imported photo.png`)
    notices.recordFinished(fixture.projectId, record)
    await fixture.settle()
    expect(fixture.agents.get(SESSION)?.hows).toEqual(['followup'])
  })
})
