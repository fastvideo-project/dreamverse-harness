/**
 * The Blender component in a REAL composition booted through the Loader from a test-only `cordis.yml`, with the DSH web
 * server on a test-owned port; Blender is the only fake: a WebSocket client that speaks the add-on's side of the link.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvProject, { type AssetId, type OperationToolValue, type ProjectId, type RecordId } from '@dv/project'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import DvBlender, {
  ADDON_ROUTE, LINK_PATH, NOT_LINKED, STATUS_ROUTE, TOKEN_ROUTE, VIEW_PATH, VIEWER_BACKLOG_BYTES, bridgeRoutes, encodeBinary,
  parseViewCommand, relayView, type BlenderStatus,
} from '../src/index.ts'

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, WebServer, DvBlender }

const HELLO = { blender_version: '5.3.0', addon_version: '0.1.0', file: 'shot.blend', allow_code: true }

type Answer = { result: Record<string, unknown>; file?: Uint8Array } | { error: string } | 'silent'

/** The add-on's side of the link. */
class FakeBlender {
  readonly requests: Array<{ id: string; op: string; params: Record<string, unknown> }> = []
  readonly streams: boolean[] = []
  readonly acks: number[] = []
  readonly views: Array<Record<string, unknown>> = []
  closed: { code: number; reason: string } | null = null
  answer: (op: string, params: Record<string, unknown>) => Answer = () => ({ result: {} })

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      const message = JSON.parse(Buffer.from(data as Buffer).toString()) as Record<string, unknown>
      if (message['type'] === 'stream') this.streams.push(message['on'] === true)
      if (message['type'] === 'frame_ack') this.acks.push(message['seq'] as number)
      if (message['type'] === 'view') this.views.push(message)
      if (message['type'] === 'request') this.respond(message['id'] as string, message['op'] as string, message['params'] as Record<string, unknown>)
    })
    socket.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() } })
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message))
  }

  frame(seq: number, bytes = new Uint8Array([0xff, 0xd8, seq])): void {
    this.socket.send(encodeBinary({ kind: 'frame', seq, width: 4, height: 3, mime: 'image/jpeg' }, bytes))
  }

  private respond(id: string, op: string, params: Record<string, unknown>): void {
    this.requests.push({ id, op, params })
    const answer = this.answer(op, params)
    if (answer === 'silent') return
    if ('error' in answer) {
      this.send({ type: 'response', id, ok: false, error: answer.error })
      return
    }
    if (answer.file !== undefined) {
      // Two chunks, as the add-on splits a file.
      const half = Math.ceil(answer.file.byteLength / 2)
      this.socket.send(encodeBinary({ kind: 'chunk', id }, answer.file.subarray(0, half)))
      this.socket.send(encodeBinary({ kind: 'chunk', id }, answer.file.subarray(half)))
    }
    this.send({ type: 'response', id, ok: true, result: answer.result })
  }
}

/** A stand-in attachment store that keeps saved images in memory. */
class MemoryAttachments {
  readonly saved: Array<{ data: Uint8Array; mediaType: string; name?: string }> = []

  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<Record<string, unknown>> {
    this.saved.push(input)
    return Promise.resolve({ attachmentId: `att-${String(this.saved.length)}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 4, height: 3 })
  }
}

interface Fixture {
  ctx: Context
  port: number
  attachments: MemoryAttachments
  project: ProjectId
  connect(options?: { token?: string; origin?: string; hello?: boolean }): Promise<FakeBlender>
  call(name: string, args: Record<string, unknown>, session?: string): Promise<ToolExecutionResult>
  route(path: string, method?: 'GET' | 'POST'): (request?: Request) => Promise<Response>
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const until = async (check: () => boolean, label: string): Promise<void> => {
  for (let tries = 0; tries < 300; tries += 1) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param config - extra `dv-blender` config lines.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(config: string[] = []): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-blender-'))
  const globals = globalThis as typeof globalThis & { __dvBlenderComposition?: typeof PLUGINS }
  globals.__dvBlenderComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, lines: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvBlenderComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...lines.length === 0 ? [] : ['  config:', ...lines.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [])
  row('web-server', 'WebServer', ['host: 127.0.0.1', 'port: 0'])
  row('dv-blender', 'DvBlender', config)
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const services = provideChatServices(ctx)
  const attachments = new MemoryAttachments()
  ctx.provide('attachments', attachments as never)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null }
  const project = await chatProject(ctx.dvProject, services, 'blender', { ...origin, intent: 'create' })
  const port = ctx.webServer.port
  let calls = 0
  return {
    ctx, port, attachments, project,
    async connect(options = {}) {
      const token = options.token ?? await ctx.dvBlender.token.current()
      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${LINK_PATH}`, {
        headers: { authorization: `Bearer ${token}`, ...options.origin === undefined ? {} : { origin: options.origin } },
      })
      cleanups.push(() => { socket.terminate() })
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => { resolve() })
        socket.once('unexpected-response', (_request, response) => { reject(new Error(`HTTP ${String(response.statusCode)}`)) })
        socket.once('error', reject)
      })
      const blender = new FakeBlender(socket)
      if (options.hello !== false) {
        blender.send({ type: 'hello', ...HELLO })
        await until(() => ctx.dvBlender.link.linked, 'the hello')
      }
      return blender
    },
    call(name, args, session) {
      calls += 1
      return ctx.tools.execute({
        callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal,
        ...session === undefined ? {} : { agent: { id: session } as never },
      })
    },
    route(path, method = 'GET') {
      const routes = bridgeRoutes(ctx.dvBlender.link, ctx.dvBlender.token, { addonDir: join(import.meta.dirname, '../addon') })
      const found = routes.find(candidate => candidate.path === path && candidate.methods.includes(method))
      if (found === undefined) throw new Error(`no route ${method} ${path}`)
      return request => found.fetch(request ?? new Request(`http://harness${path}`, { method }))
    },
  }
}

function value(result: ToolExecutionResult): unknown {
  if (result.isError) throw new Error(result.error.message)
  return result.value
}

function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

/** A browser viewer on the viewport route: its messages in arrival order, a binary message as `bytes:<base64>`. */
async function openViewer(port: number): Promise<{ socket: WebSocket; messages: unknown[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${VIEW_PATH}`)
  cleanups.push(() => { socket.terminate() })
  const messages: unknown[] = []
  socket.on('message', (data, isBinary) => {
    const bytes = Buffer.from(data as Buffer)
    messages.push(isBinary ? `bytes:${bytes.toString('base64')}` : JSON.parse(bytes.toString()) as unknown)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => { resolve() })
    socket.once('error', reject)
  })
  return { socket, messages }
}

describe('dvBlender link', () => {
  it('admits a Blender with the pairing token and refuses a wrong token and any request with an Origin header', async () => {
    const fixture = await start()
    await expect(fixture.connect({ token: 'wrong' })).rejects.toThrow('HTTP 401')
    await expect(fixture.connect({ origin: 'http://evil.example' })).rejects.toThrow('HTTP 403')
    expect(fixture.ctx.dvBlender.link.linked).toBe(false)
    await fixture.connect()
    expect(fixture.ctx.dvBlender.link.state).toEqual(HELLO)
  })

  it('keeps one Blender: a second one replaces the first, which is told why', async () => {
    const fixture = await start()
    const first = await fixture.connect()
    const second = await fixture.connect()
    await until(() => first.closed !== null, 'the first link to close')
    expect(first.closed).toEqual({ code: 4000, reason: 'Another Blender connected to the harness.' })
    second.send({ type: 'state', ...HELLO, file: 'other.blend' })
    await until(() => fixture.ctx.dvBlender.link.state?.file === 'other.blend', 'the new state')
  })

  it('serves the status, and a new pairing token disconnects the Blender and refuses the old token', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    const old = await fixture.ctx.dvBlender.token.current()
    const status = await (await fixture.route(STATUS_ROUTE)()).json() as BlenderStatus
    expect(status).toEqual({ linked: true, state: HELLO, token: old, link_path: LINK_PATH, viewers: 0 })
    const renewed = await (await fixture.route(TOKEN_ROUTE, 'POST')()).json() as BlenderStatus
    expect(renewed.token).not.toBe(old)
    expect(renewed.linked).toBe(false)
    await until(() => blender.closed !== null, 'the link to close')
    expect(blender.closed?.code).toBe(4001)
    await expect(fixture.connect({ token: old })).rejects.toThrow('HTTP 401')
    await fixture.connect({ token: renewed.token })
  })

  it('serves the add-on as a zip with the manifest at its root', async () => {
    const fixture = await start()
    const response = await fixture.route(ADDON_ROUTE)()
    expect(response.headers.get('content-type')).toBe('application/zip')
    const files = Object.keys(unzipSync(new Uint8Array(await response.arrayBuffer())))
    expect(files).toEqual(expect.arrayContaining(['blender_manifest.toml', '__init__.py', 'link.py', 'commands.py', 'viewport.py', 'protocol.py']))
    expect(files.some(name => name.includes('__pycache__'))).toBe(false)
  })
})

describe('dvBlender viewport stream', () => {
  it('asks Blender to stream while a viewer watches, relays frames, acknowledges each, and reports a disconnect', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    expect(blender.streams).toEqual([false])
    const viewer = await openViewer(fixture.port)
    await until(() => blender.streams.length === 2, 'the stream request')
    expect(blender.streams).toEqual([false, true])
    blender.frame(1)
    await until(() => blender.acks.includes(1), 'the frame ack')
    blender.socket.close(1000, 'bye')
    await until(() => viewer.messages.length === 4, 'four viewer messages')
    expect(viewer.messages).toEqual([
      { type: 'status', linked: true, state: HELLO },
      { type: 'frame', seq: 1, width: 4, height: 3, mime: 'image/jpeg' },
      `bytes:${Buffer.from([0xff, 0xd8, 1]).toString('base64')}`,
      { type: 'status', linked: false, state: null },
    ])
    viewer.socket.close()
    await until(() => fixture.ctx.dvBlender.link.viewerCount === 0, 'the viewer to leave')
  })

  it('stops the stream when the last viewer leaves', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    const first = await openViewer(fixture.port)
    const second = await openViewer(fixture.port)
    await until(() => fixture.ctx.dvBlender.link.viewerCount === 2, 'two viewers')
    first.socket.close()
    await until(() => fixture.ctx.dvBlender.link.viewerCount === 1, 'one viewer')
    expect(blender.streams).toEqual([false, true])
    second.socket.close()
    await until(() => blender.streams.at(-1) === false, 'the stream to stop')
  })

  it('relays a viewer\'s view changes to Blender and drops the ones that do not parse', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    const viewer = await openViewer(fixture.port)
    await until(() => fixture.ctx.dvBlender.link.viewerCount === 1, 'the viewer')
    const sends = [
      { type: 'view', action: 'orbit', dx: 0.25, dy: -0.1 },
      { type: 'view', action: 'orbit', dx: 11, dy: 0 },
      { type: 'view', action: 'spin', dx: 1, dy: 1 },
      { type: 'view', action: 'preset', preset: 'side' },
      { type: 'stream', on: false },
      { type: 'view', action: 'zoom', steps: -2 },
      { type: 'view', action: 'preset', preset: 'camera' },
      { type: 'view', action: 'frame', target: 'selected' },
    ]
    for (const message of sends) viewer.socket.send(JSON.stringify(message))
    viewer.socket.send('not json')
    viewer.socket.send(Buffer.from([1, 2, 3]))
    viewer.socket.send(JSON.stringify({ type: 'view', action: 'pan', dx: 0.5, dy: 0.5 }))
    await until(() => blender.views.length === 5, 'five view changes')
    expect(blender.views).toEqual([
      { type: 'view', action: 'orbit', dx: 0.25, dy: -0.1 },
      { type: 'view', action: 'zoom', steps: -2 },
      { type: 'view', action: 'preset', preset: 'camera' },
      { type: 'view', action: 'frame', target: 'selected' },
      { type: 'view', action: 'pan', dx: 0.5, dy: 0.5 },
    ])
    expect(blender.streams).toEqual([false, true])
  })

  it('reads a view change field by field and drops it while no Blender is connected', async () => {
    expect(parseViewCommand('{"type":"view","action":"zoom","steps":10}')).toEqual({ action: 'zoom', steps: 10 })
    expect(parseViewCommand('{"type":"view","action":"zoom","steps":10.5}')).toBeNull()
    expect(parseViewCommand('{"type":"view","action":"pan","dx":"1","dy":0}')).toBeNull()
    expect(parseViewCommand('{"type":"view","action":"frame","target":"none"}')).toBeNull()
    expect(parseViewCommand('{"action":"zoom","steps":1}')).toBeNull()
    expect(parseViewCommand('[1]')).toBeNull()
    const fixture = await start()
    expect(fixture.ctx.dvBlender.link.navigate({ action: 'zoom', steps: 1 })).toBe(false)
    const blender = await fixture.connect()
    expect(fixture.ctx.dvBlender.link.navigate({ action: 'zoom', steps: 1 })).toBe(true)
    await until(() => blender.views.length === 1, 'the view change')
  })

  it('skips a frame for a viewer with a large backlog, and always sends a status', () => {
    const sent: unknown[] = []
    const viewer = { bufferedAmount: VIEWER_BACKLOG_BYTES + 1, send: (data: unknown) => { sent.push(data) } }
    const frame = { type: 'frame' as const, seq: 2, width: 4, height: 3, mime: 'image/jpeg' as const, data: new Uint8Array([1]) }
    expect(relayView(viewer as never, frame)).toBe(false)
    expect(relayView(viewer as never, { type: 'status', linked: true, state: HELLO })).toBe(true)
    viewer.bufferedAmount = 0
    expect(relayView(viewer as never, frame)).toBe(true)
    expect(sent).toEqual([JSON.stringify({ type: 'status', linked: true, state: HELLO }), JSON.stringify({ type: 'frame', seq: 2, width: 4, height: 3, mime: 'image/jpeg' }), frame.data])
  })
})

describe('dvBlender tools', () => {
  it('describes the six tools to the model in the words the README quotes', async () => {
    const fixture = await start()
    const described = Object.fromEntries(fixture.ctx.tools.schemas().filter(schema => schema.name.startsWith('dv_blender')).map(schema => [schema.name, schema.description]))
    expect(described).toEqual({
      dv_blender_scene: 'Read the scene of the Blender that the user connected to the harness: the open file, the frame range and '
        + 'frames per second, the render engine and resolution, the active camera, the selection, and every object with its type, '
        + 'parent, location, rotation (degrees), scale, dimensions, visibility and materials. Read it before you change the scene, '
        + 'and again when the user may have changed it.',
      dv_blender_run: 'Run Python in the connected Blender, with bpy, mathutils and math imported. The user sees each change in '
        + 'their Blender at once. Make one small change per call. Assign a JSON value to `result` to return it; print() output '
        + 'returns as stdout. A Python error returns its traceback, and the changes made before the error stay. The user can undo '
        + 'a call in Blender with Ctrl+Z.',
      dv_blender_look: 'Look at the connected Blender: a PNG of the 3D viewport as the user sees it (`viewport`, the default), or '
        + 'of what the scene camera frames (`camera`), at most 1280 px wide. Look after a visible change to check it.',
      dv_blender_render: 'Render one frame of the connected Blender\'s scene with its scene camera, render engine and resolution, '
        + 'as a PNG image in the project, for use as a still or as the reference image of a shot. Check the framing with '
        + 'dv_blender_look view camera first. Blender is busy until the render finishes.',
      dv_blender_animation_render: 'Render a frame range of the connected Blender\'s scene with its scene camera, render engine, '
        + 'resolution and frame rate, as an MP4 video in the project that the timeline can use as a shot. Rendering many frames '
        + 'takes long; keep ranges short and the resolution modest unless the user asks for more. Blender is busy until it finishes.',
      dv_blender_viewport: 'Put the live viewport of the user\'s Blender on the project canvas as a node (on: true), or take it '
        + 'off (on: false). The node shows what Blender\'s 3D viewport shows, and the user can open it to orbit, pan and zoom the '
        + 'view; it changes nothing in the scene.',
    })
  })

  it('fails every tool with one sentence while no Blender is connected', async () => {
    const fixture = await start()
    for (const name of ['dv_blender_scene', 'dv_blender_run', 'dv_blender_look']) {
      expect(failure(await fixture.call(name, name === 'dv_blender_run' ? { code: 'pass' } : {}))).toBe(NOT_LINKED)
    }
  })

  it('reads the scene and runs code in Blender, returning what Blender answers', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    blender.answer = op => op === 'scene'
      ? { result: { file: 'shot.blend', objects: [{ name: 'Cube', type: 'MESH' }] } }
      : { result: { stdout: 'hi\n', result: 3 } }
    expect(value(await fixture.call('dv_blender_scene', {}))).toEqual({ file: 'shot.blend', objects: [{ name: 'Cube', type: 'MESH' }] })
    expect(value(await fixture.call('dv_blender_run', { code: 'print("hi"); result = 3' }))).toEqual({ stdout: 'hi\n', result: 3 })
    expect(blender.requests.map(request => [request.op, request.params])).toEqual([['scene', {}], ['run', { code: 'print("hi"); result = 3' }]])
    blender.answer = () => ({ error: 'Traceback (most recent call last): NameError: name "x" is not defined' })
    expect(failure(await fixture.call('dv_blender_run', { code: 'x' }))).toBe('Traceback (most recent call last): NameError: name "x" is not defined')
  })

  it('refuses code while the add-on has code from the harness switched off, without asking Blender', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    blender.send({ type: 'state', ...HELLO, allow_code: false })
    await until(() => fixture.ctx.dvBlender.link.state?.allow_code === false, 'the state')
    expect(failure(await fixture.call('dv_blender_run', { code: 'pass' }))).toContain('switched off "Allow code from the harness"')
    expect(blender.requests).toEqual([])
  })

  it('returns a look as an image the model sees', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    blender.answer = (_op, params) => ({ result: { view: params['view'], width: 4, height: 3 }, file: png })
    const result = await fixture.call('dv_blender_look', { view: 'camera' })
    expect(value(result)).toEqual({ view: 'camera', image: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 7, width: 4, height: 3 } })
    expect(fixture.attachments.saved).toEqual([{ data: Buffer.from(png), mediaType: 'image/png', name: 'blender-camera.png' }])
    expect(result.isError ? [] : result.content).toEqual([
      { type: 'text', text: 'A picture of the scene camera\'s view, 4x3 px.' },
      { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 7, width: 4, height: 3 } },
    ])
  })

  it('fails a call when Blender does not answer in time, and a waiting call when Blender disconnects', async () => {
    const fixture = await start(['requestTimeoutMs: 100'])
    const blender = await fixture.connect()
    blender.answer = () => 'silent'
    expect(failure(await fixture.call('dv_blender_scene', {}))).toBe('Blender did not answer within 0.1 s; it may still be working.')
    const waiting = fixture.call('dv_blender_scene', {})
    await until(() => blender.requests.length === 2, 'the second request')
    blender.socket.close(1000, 'bye')
    expect(failure(await waiting)).toBe('Blender disconnected before it answered.')
  })

  it('refuses a file over the byte limit', async () => {
    const fixture = await start(['maxFileBytes: 4'])
    const blender = await fixture.connect()
    blender.answer = () => ({ result: { view: 'viewport', width: 4, height: 3 }, file: new Uint8Array(9) })
    expect(failure(await fixture.call('dv_blender_look', {}))).toBe('Blender sent a file over the 4-byte limit.')
  })
})

describe('dvBlender render operations', () => {
  it('renders a still and an animation into the project as records with an image and a video output', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9])
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])
    blender.answer = (_op, params) => params['kind'] === 'still'
      ? { result: { mime: 'image/png', width: 640, height: 360, frame: 12, engine: 'BLENDER_EEVEE' }, file: png }
      : { result: { mime: 'video/mp4', width: 640, height: 360, frame_start: 1, frame_end: 48, fps: 24, duration_sec: 2, engine: 'CYCLES' }, file: mp4 }
    const still = value(await fixture.call('dv_blender_render', { reason: 'still', frame: 12 }, 's1')) as OperationToolValue
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(still.record))
    expect(record).toMatchObject({ status: 'done', component: 'blender', operation: 'blender.render', actor: 'agent' })
    expect(record.report).toEqual({ width: 640, height: 360, frame: 12, engine: 'BLENDER_EEVEE' })
    const image = record.outputs[0] as AssetId
    expect(fixture.ctx.dvAssetPool.get(image)).toMatchObject({ mime: 'image/png', name: `${record.id.slice(0, 8)}.png`, created_by: record.id })
    expect(still.summary).toBe('Blender frame 12 (640x360)')

    const animation = value(await fixture.call('dv_blender_animation_render', { reason: 'clip', frame_start: 1, frame_end: 48 }, 's1')) as OperationToolValue
    const clip = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(animation.record))
    expect(clip).toMatchObject({ status: 'done', operation: 'blender.animation_render' })
    expect(fixture.ctx.dvAssetPool.get(clip.outputs[0] as AssetId)).toMatchObject({ mime: 'video/mp4', duration_sec: 2 })
    expect(animation.summary).toBe('Blender frames 1–48 (640x360, 2.0s)')
    expect(blender.requests.map(request => request.params)).toEqual([{ kind: 'still', frame: 12 }, { kind: 'animation', frame_start: 1, frame_end: 48 }])
  })

  it('refuses a reversed frame range and fails the record when Blender returns no file', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    expect(failure(await fixture.call('dv_blender_animation_render', { reason: 'bad', frame_start: 9, frame_end: 3 }, 's1')))
      .toBe('frame_end must not come before frame_start.')
    blender.answer = () => ({ result: { mime: 'image/png', width: 1, height: 1 } })
    expect(failure(await fixture.call('dv_blender_render', { reason: 'empty' }, 's1'))).toBe('Blender answered the render without the file it rendered.')
    expect(blender.requests).toHaveLength(1)
  })
})

describe('dvBlender viewport node', () => {
  it('puts the viewport on the canvas and takes it off, without a connected Blender, and refuses a call that changes nothing', async () => {
    const fixture = await start()
    const placed = () => fixture.ctx.dvProject.getState(fixture.project).components.blender.viewport
    expect(placed()).toBeNull()
    const on = value(await fixture.call('dv_blender_viewport', { reason: 'show it', on: true }, 's1')) as OperationToolValue
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(on.record))
    expect(record).toMatchObject({ status: 'done', component: 'blender', operation: 'blender.viewport', outputs: [], report: { on: true } })
    expect(on.summary).toBe('put the Blender viewport on the canvas')
    expect(placed()).toBe(record.id)
    expect(failure(await fixture.call('dv_blender_viewport', { reason: 'again', on: true }, 's1'))).toBe('The Blender viewport is already on the canvas.')
    const off = value(await fixture.call('dv_blender_viewport', { reason: 'hide it', on: false }, 's1')) as OperationToolValue
    expect(off.summary).toBe('took the Blender viewport off the canvas')
    expect(placed()).toBeNull()
    expect(failure(await fixture.call('dv_blender_viewport', { reason: 'again', on: false }, 's1'))).toBe('The Blender viewport is not on the canvas.')
  })
})

describe('dvBlender disposal', () => {
  it('removes the link route, the tools and the operations, and closes the link, when its fiber is disposed', async () => {
    const fixture = await start()
    const blender = await fixture.connect()
    const token = await fixture.ctx.dvBlender.token.current()
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-blender.mjs'))
    await entry?.fiber?.dispose()
    await until(() => blender.closed !== null, 'the link to close')
    expect(blender.closed?.code).toBe(1001)
    for (const name of ['dv_blender_scene', 'dv_blender_run', 'dv_blender_look', 'dv_blender_render', 'dv_blender_animation_render', 'dv_blender_viewport']) {
      expect(fixture.ctx.tools.get(name)).toBeUndefined()
    }
    expect(fixture.ctx.dvProject.listOperations().map(spec => spec.name).filter(name => name.startsWith('blender.'))).toEqual([])
    // The web server drops an upgrade that no route claims.
    await expect(fixture.connect({ token })).rejects.toThrow('socket hang up')
  })
})
