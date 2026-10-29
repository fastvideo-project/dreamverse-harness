/**
 * `dvChatReferences` over the real Project service and components: `dv:` mentions of a step's user messages become a
 * `dv-mentions` context message read from the project's current state, chat attachments of any media type become
 * `asset.import` records of the session's project that put them on its canvas, mentioned assets go on the canvas, and
 * disposal removes both listeners.
 */
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { basename } from 'node:path'
import type { FileAttachmentRef, ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { AssetId, ProjectId, RecordOrigin, RunRequest, SessionId } from '@dv/project'
import type { CharacterId } from '@dv/character'
import { afterEach, describe, expect, it } from 'vitest'
import DvChatReferences from '../src/index.ts'
import { startBase, type BaseFixture } from '../../api/tests/support.ts'

/** A DSH attachment store that writes every image to a host file and keeps other files at their host paths. */
class FakeAttachments {
  readonly images = new Map<string, string>()
  readonly files = new Map<string, string>()

  /** @param writeFile - writes one host file and returns its path. */
  constructor(private readonly writeFile: (name: string, content: Buffer) => string) {}

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const attachmentId = brandString<ImageAttachmentRef['attachmentId']>(`att-${this.images.size + 1}`)
    this.images.set(attachmentId, this.writeFile(attachmentId, Buffer.from(input.data)))
    return Promise.resolve({
      attachmentId, mediaType: input.mediaType,
      bytes: input.data.byteLength, width: 192, height: 112, ...input.name === undefined ? {} : { name: input.name },
    })
  }

  /** The host path of a saved image. */
  imageHostPath(ref: ImageAttachmentRef): string | undefined {
    return this.images.get(ref.attachmentId)
  }

  /** Keep a file that already lies on this machine as a verbatim file attachment. */
  saveFile(path: string, bytes: number): FileAttachmentRef {
    const attachmentId = brandString<FileAttachmentRef['attachmentId']>(`file-${this.files.size + 1}`)
    this.files.set(attachmentId, path)
    return { attachmentId, name: basename(path), bytes }
  }

  /** The host path of a kept file. */
  fileHostPath(ref: FileAttachmentRef): string | undefined {
    return this.files.get(ref.attachmentId)
  }
}

/** The mounted base fixture with the chat references plugin, a live session `s1`, and its fake agent. */
interface ChatFixture {
  fixture: BaseFixture
  attachments: FakeAttachments
  plugin: { dispose(): Promise<void> }
  session: { id: string }
  /** Emit one session event for the live session. */
  emit(type: string, data: Record<string, unknown>): void
  /** Call a DSH tool on behalf of the live session's agent. */
  callAs(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Run the `agent/pre-step` waterfall for one user message; returns the step's messages. */
  preStep(text: string): Promise<UserMessage[]>
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/**
 * Mount the components, a fake attachment service, a fake agent registry that reports session `s1` as live, and the
 * chat references plugin.
 * @returns the fixture.
 */
async function start(): Promise<ChatFixture> {
  const fixture = await startBase({ generation: 'none' })
  cleanups.push(() => fixture.dispose())
  const attachments = new FakeAttachments((name, content) => fixture.writeFile(name, content))
  fixture.context.provide('attachments', attachments)
  const session = { id: 's1' }
  const agent = { id: 's1', session, options: {} }
  fixture.context.provide('agents', { get: (id: string) => (id === 's1' ? agent : undefined), roots: () => [agent] })
  const plugin = fixture.context.plugin(DvChatReferences)
  await plugin.await()
  let calls = 0
  return {
    fixture, attachments, plugin, session,
    emit(type, data) {
      fixture.context.emit('session/event', session as never, { type, data } as never)
    },
    callAs(name, args) {
      calls += 1
      const call = { callId: ToolCallId(`as-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: agent as never }
      return fixture.context.tools.execute(call)
    },
    async preStep(text) {
      const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
      const decision = await agentEvents(fixture.context, agent as never).waterfall('agent/pre-step',
        { messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ kind: 'enter' as const, messages: [message] }))
      if (decision.kind !== 'enter') throw new Error('expected step entry')
      return decision.messages
    },
  }
}

/** The text of a message's text blocks. */
function textOf(message: UserMessage | undefined): string {
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
}

describe('mention expansion', () => {
  it('appends a dv-mentions message that reads the character from the project\'s current state, after an undo too', async () => {
    const { fixture, preStep } = await start()
    const session = brandString<SessionId>('s1')
    const user: RecordOrigin = { actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'set up' }
    const info = await fixture.project.createProject('mentions', user)
    fixture.project.bindSession(session, info.id)
    const picture = await fixture.project.run({
      ...user, project: info.id, operation: 'asset.import', inputs: [],
      params: { path: fixture.writeFile('face.png'), mime: 'image/png' },
    })
    const reference: RunRequest['inputs'] = picture.outputs.map(asset => ({ role: 'reference', ref: { asset } }))
    await fixture.project.run({
      ...user, project: info.id, operation: 'character.create', inputs: reference, params: { character: 'c1', name: 'Lead' },
    })
    const update = await fixture.project.run({
      actor: 'agent', surface: 'chat', session, turn: null, tool_call: 'call-update', intent: 'rename the lead',
      project: info.id, operation: 'character.update', inputs: reference, params: { character: 'c1', name: 'Lead renamed' },
    })

    const messages = await preStep('make @[Lead](dv:character/c1) wave')
    const assets = picture.outputs.join(', ')
    expect(messages).toHaveLength(2)
    expect(messages[1]?.source).toMatchObject({ kind: 'dv-mentions' })
    expect(textOf(messages[1])).toContain(`character c1@2, reference assets [${assets}]; pass it as input c1@2`)
    // After an undo of the update, the mention reads version 1 again.
    await fixture.project.undo(info.id)
    expect(fixture.project.getState(info.id).components.character[brandString<CharacterId>('c1')]).toHaveLength(1)
    expect(textOf((await preStep('make @[Lead](dv:character/c1) wave'))[1])).toContain(`character c1@1, reference assets [${assets}]`)
    expect(update.record?.status).toBe('done')
    // A message without mentions enters unchanged.
    expect(await preStep('hello')).toHaveLength(1)
  })

  it('expands a mention in a chat without a project to the no-project line, even when a project made the asset', async () => {
    const chat = await start()
    const { fixture } = chat
    const user: RecordOrigin = { actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'set up' }
    const info = await fixture.project.createProject('elsewhere', user)
    const picture = await fixture.project.run({
      ...user, project: info.id, operation: 'asset.import', inputs: [], params: { path: fixture.writeFile('face.png'), mime: 'image/png' },
    })
    const messages = await chat.preStep(`look at @[face](dv:asset/${String(picture.outputs[0])})`)
    expect(textOf(messages[1])).toBe(
      `The user referenced these project items:\n- face (dv:asset/${String(picture.outputs[0])}): this conversation has no project yet; call dv_proj_create first`,
    )
  })

  it('removes the expansion and the image import on disposal', async () => {
    const { fixture, plugin, preStep } = await start()
    expect(await preStep('@[a](dv:asset/none)')).toHaveLength(2)
    await plugin.dispose()
    expect(fixture.context.get('dvChatReferences')).toBeUndefined()
    expect(await preStep('@[a](dv:asset/none)')).toHaveLength(1)
  })
})

describe('chat attachments', () => {
  it('imports the images a user attached in a bound chat as project assets and puts them on the canvas', async () => {
    const { fixture, attachments, emit, callAs } = await start()
    const image = await attachments.saveImage({ data: Buffer.from('chat-image'), mediaType: 'image/png', name: 'cat.png' })
    const message = { source: { kind: 'user' }, content: [{ type: 'image', attachment: image }] }
    // Without a bound project the image stays in the chat only.
    emit('user/message', message)
    const created = await callAs('dv_proj_create', { title: 'dance' })
    if (created.isError) throw new Error(created.error.message)
    const projectId = (created.value as { project_id: ProjectId }).project_id
    emit('user/message', message)
    // A message the user did not type imports nothing.
    emit('user/message', { source: { kind: 'plugin' }, content: [{ type: 'image', attachment: image }] })
    // The session's next tool call waits for the import.
    const timeline = await callAs('dv_timeline_create', { reason: 'order', assets: [] })
    if (timeline.isError) throw new Error(timeline.error.message)
    const imported = fixture.project.listHistory({ project: projectId, actor: 'user', operation: 'asset.import' }).map(entry => entry.record)
    expect(imported).toEqual([expect.objectContaining({
      surface: 'chat', turn: null, session: 's1', params: expect.objectContaining({ name: 'cat.png', mime: 'image/png', place: true }),
    })])
    const asset = imported[0]?.outputs[0] as AssetId
    expect(fixture.assets.read(asset).toString()).toBe('chat-image')
    expect(fixture.project.getState(projectId).components.asset.placed).toEqual([asset])
  })

  it('imports the other files a user attached from their host paths, with the media type their extension names', async () => {
    const { fixture, attachments, emit, callAs } = await start()
    const created = await callAs('dv_proj_create', { title: 'files' })
    if (created.isError) throw new Error(created.error.message)
    const projectId = (created.value as { project_id: ProjectId }).project_id
    const contents = { 'clip.mp4': 'chat-video', 'notes.txt': 'chat-notes', 'blob': 'chat-blob' }
    const files = Object.entries(contents).map(([name, content]) => attachments.saveFile(fixture.writeFile(name, content), content.length))
    emit('user/message', { source: { kind: 'user' }, content: files.map(attachment => ({ type: 'file', attachment })) })
    // The session's next tool call waits for the import.
    const timeline = await callAs('dv_timeline_create', { reason: 'order', assets: [] })
    if (timeline.isError) throw new Error(timeline.error.message)
    // The history lists the newest record first; reverse it into import order.
    const imported = fixture.project.listHistory({ project: projectId, actor: 'user', operation: 'asset.import' }).map(entry => entry.record).reverse()
    expect(imported.map(record => record.params)).toEqual([
      expect.objectContaining({ name: 'clip.mp4', mime: 'video/mp4', place: true }),
      expect.objectContaining({ name: 'notes.txt', mime: 'text/plain', place: true }),
      expect.objectContaining({ name: 'blob', mime: 'application/octet-stream', place: true }),
    ])
    const assets = imported.flatMap(record => record.outputs as AssetId[])
    expect(assets.map(asset => fixture.assets.read(asset).toString())).toEqual(Object.values(contents))
    expect(fixture.project.getState(projectId).components.asset.placed).toEqual(assets)
  })

  it('imports nothing for a file the DSH attachment store keeps off this machine, and the next tool call still runs', async () => {
    const { fixture, emit, callAs } = await start()
    const created = await callAs('dv_proj_create', { title: 'remote file' })
    if (created.isError) throw new Error(created.error.message)
    const projectId = (created.value as { project_id: ProjectId }).project_id
    const remote: FileAttachmentRef = { attachmentId: brandString<FileAttachmentRef['attachmentId']>('remote'), name: 'clip.mp4', bytes: 1 }
    emit('user/message', { source: { kind: 'user' }, content: [{ type: 'file', attachment: remote }] })
    const timeline = await callAs('dv_timeline_create', { reason: 'order', assets: [] })
    expect(timeline.isError).toBe(false)
    expect(fixture.project.listHistory({ project: projectId, operation: 'asset.import' })).toEqual([])
  })

  it('puts the assets a user message mentions on the canvas once, with one asset.place by the user in the chat', async () => {
    const { fixture, emit, callAs } = await start()
    const created = await callAs('dv_proj_create', { title: 'mentions' })
    if (created.isError) throw new Error(created.error.message)
    const projectId = (created.value as { project_id: ProjectId }).project_id
    const user: RecordOrigin = { actor: 'user', surface: 'asset_pool', session: null, turn: null, tool_call: null, intent: 'import' }
    const picture = await fixture.project.run({ ...user, project: projectId, operation: 'asset.import', inputs: [], params: { path: fixture.writeFile('face.png'), mime: 'image/png' } })
    const asset = picture.outputs[0] as AssetId
    const text = `use @[face.png](dv:asset/${asset}) and @[x](dv:asset/${'0'.repeat(64)})`
    emit('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
    const places = () => fixture.project.listHistory({ project: projectId, operation: 'asset.place' }).map(entry => entry.record)
    await expect.poll(() => places().length).toBe(1)
    expect(places()[0]).toMatchObject({ actor: 'user', surface: 'chat', session: 's1', inputs: [expect.objectContaining({ role: 'asset', resolved_asset: asset })] })
    expect(fixture.project.getState(projectId).components.asset.placed).toEqual([asset])
    // A second mention of an asset already on the canvas writes nothing.
    emit('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(places()).toHaveLength(1)
  })

  it('puts a mentioned import of a discarded step on the canvas', async () => {
    const { fixture, emit, callAs } = await start()
    const created = await callAs('dv_proj_create', { title: 'discarded import' })
    if (created.isError) throw new Error(created.error.message)
    const projectId = (created.value as { project_id: ProjectId }).project_id
    const user: RecordOrigin = { actor: 'user', surface: 'asset_pool', session: null, turn: null, tool_call: null, intent: 'import' }
    const picture = await fixture.project.run({ ...user, project: projectId, operation: 'asset.import', inputs: [], params: { path: fixture.writeFile('old.png'), mime: 'image/png' } })
    const asset = picture.outputs[0] as AssetId
    // The undo and the next write discard the import step.
    await fixture.project.undo(projectId)
    await fixture.project.run({ ...user, project: projectId, operation: 'asset.import', inputs: [], params: { path: fixture.writeFile('new.png'), mime: 'image/png' } })
    emit('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `use @[old.png](dv:asset/${asset})` }] })
    await expect.poll(() => fixture.project.getState(projectId).components.asset.placed).toEqual([asset])
  })
})
