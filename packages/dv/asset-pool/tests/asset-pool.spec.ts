/**
 * The Asset pool component in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, `dvProject`,
 * `dvFfmpeg` and `dvAssetPool` through the Loader, with a stand-in web server as the only fake. The agent's
 * `dv_asset_*` calls and the human's `dvProject.run` calls write records whose outputs the pool holds.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, type ReadStream } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvCanvasNodes from '@dv/canvas'
import DvFfmpeg, { FfmpegError } from '@dv/ffmpeg'
import DvProject, {
  ProjectError, type AssetId, type OperationToolValue, type ProjectId, type ProjectRecord, type ProjectState, type RecordId,
  type RecordInput,
} from '@dv/project'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatProject, provideChatServices, type TestChatServices } from '../../project/tests/workspaces.ts'
import DvAssetPool, { importedAssets, placeable } from '../src/index.ts'

/**
 * The file streams the pool opens, and the files that fail on purpose: a file ID in `failOpen` throws that error code
 * from `open`, and a stream of a file ID in `failRead` fails after its first chunk.
 */
const files = vi.hoisted(() => ({ streams: [] as ReadStream[], failOpen: new Map<string, string>(), failRead: new Set<string>() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  /** Make an error that carries a Node error code. */
  const failure = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: failed on purpose`), { code })
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>): Promise<FileHandle> => {
      const path = String(args[0])
      const code = [...files.failOpen].find(([id]) => path.endsWith(id))?.[1]
      if (code !== undefined) throw failure(code)
      const handle = await fs.open(...args)
      const createReadStream = handle.createReadStream.bind(handle)
      handle.createReadStream = (options) => {
        const stream = createReadStream(options)
        files.streams.push(stream)
        if ([...files.failRead].some(id => path.endsWith(id))) stream.once('data', () => { stream.destroy(failure('EIO')) })
        return stream
      }
      return handle
    },
  }
})

const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

/** A stand-in for the DSH web server that keeps the registered prefix routes and serves them on a local port. */
class FakeWebServer {
  readonly routes = new Map<string, WebRoute>()
  server: Server | null = null

  register(route: WebRoute): () => void {
    this.routes.set(route.path, route)
    return () => { this.routes.delete(route.path) }
  }

  async listen(): Promise<string> {
    this.server = createServer((request, response) => {
      const route = [...this.routes.values()].find(candidate => (request.url ?? '').startsWith(candidate.path))
      if (route === undefined) response.writeHead(404).end()
      else void route.handler(request, response)
    })
    await new Promise<void>((resolve) => { this.server?.listen(0, '127.0.0.1', resolve) })
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => { this.server?.close(() => { resolve() }) })
  }
}

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
/**
 * The assets that the asset nodes of a state show, in node order.
 * @param state - a project state.
 * @returns the asset IDs.
 */
function placedOf(state: ProjectState): AssetId[] {
  const { nodes, order, assets } = state.components.canvas
  const shown = Object.entries(assets)
  return order.flatMap(node => nodes[node]?.kind === 'asset' ? shown.flatMap(([asset, by]) => by === node ? [brandString<AssetId>(asset)] : []) : [])
}

const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvCanvasNodes, DvAssetPool }

interface Fixture {
  ctx: Context
  dir: string
  web: FakeWebServer
  services: TestChatServices
  project: ProjectId
  /** Run one tool as the agent of chat session `s1`, which runs in the folder of `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Run an operation as the human on the canvas. */
  run(operation: string, params: Record<string, unknown>, inputs?: RecordInput[]): Promise<ProjectRecord>
  /** Dispose the composition and keep its directory. */
  stop(): Promise<void>
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param options - an existing directory to reuse, and the pool's `publicBaseUrl`.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(options: { dir?: string; publicBaseUrl?: string } = {}): Promise<Fixture> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'dv-asset-pool-'))
  const globals = globalThis as typeof globalThis & { __dvAssetPoolComposition?: typeof PLUGINS }
  globals.__dvAssetPoolComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvAssetPoolComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, `ffprobePath: ${FFPROBE}`])
  row('dv-canvas', 'DvCanvasNodes', [])
  row('dv-asset-pool', 'DvAssetPool', options.publicBaseUrl === undefined ? [] : [`publicBaseUrl: ${options.publicBaseUrl}`])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const services = provideChatServices(ctx)
  const web = new FakeWebServer()
  ctx.provide('webServer', web)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    await ctx.fiber.dispose()
  }
  disposers.push(async () => {
    await stop()
    rmSync(dir, { recursive: true, force: true })
  })
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null, intent: 'create' }
  const project = await chatProject(ctx.dvProject, services, 'pool', origin)
  let calls = 0
  return {
    ctx, dir, web, services, project, stop,
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    async run(operation, params, inputs = []) {
      const { record } = await ctx.dvProject.run({
        project, operation, params, inputs, actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: operation,
      })
      if (record === null) throw new Error(`${operation} wrote no record`)
      return record
    },
  }
}

/** The value of a successful operation tool call. */
function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

/** The error message of a failed tool call. */
function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

/** A video input of `asset.grab_still`. */
function videoInput(asset: AssetId): RecordInput {
  return { role: 'video', ref: { asset }, resolved_asset: asset }
}

describe('dvAssetPool', () => {
  it('registers its operations with their dv_asset_* tools and the asset store, and removes them on disposal', async () => {
    const fixture = await start()
    const specs = fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'asset')
    expect(specs.map(spec => [spec.name, spec.deterministic, spec.resource])).toEqual([
      ['asset.import', true, 'none'], ['asset.grab_still', true, 'cpu'], ['asset.cut_segment', true, 'cpu'], ['asset.place', false, 'none'],
    ])
    expect(fixture.ctx.tools.get('dv_asset_unplace')).toBeUndefined()
    for (const tool of ['dv_asset_import', 'dv_asset_grab_still', 'dv_asset_cut_segment', 'dv_asset_place']) {
      expect(fixture.ctx.tools.get(tool)).toBeDefined()
    }
    expect(fixture.web.routes.has('/dv/assets')).toBe(true)
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-asset-pool.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'asset')).toEqual([])
    expect(fixture.ctx.tools.get('dv_asset_import')).toBeUndefined()
    expect(fixture.web.routes.size).toBe(0)
  })

  it('imports a file or base64 bytes as the agent, records who created the asset, and answers with its URL', async () => {
    const fixture = await start({ publicBaseUrl: 'https://demo.example/' })
    const path = join(fixture.dir, 'face.png')
    writeFileSync(path, 'png bytes')
    const imported = value(await fixture.call('dv_asset_import', { reason: 'bring the reference', path, mime: 'image/png' }))
    const asset = brandString<AssetId>(String(imported.outputs[0]?.asset_id))
    expect(imported).toMatchObject({ status: 'done', summary: 'imported face.png', outputs: [{ role: 'asset', mime: 'image/png', url: `https://demo.example/dv/assets/${asset}` }] })
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(imported.record))
    expect(record).toMatchObject({ actor: 'agent', component: 'asset', operation: 'asset.import', params: { path, mime: 'image/png' }, outputs: [asset] })
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ id: asset, mime: 'image/png', name: 'face.png', size_bytes: 9, created_by: record.id, width: null, duration_sec: null })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.proj.created_by[asset]).toBe(record.id)
    const inline = await fixture.run('asset.import', { base64: Buffer.from('hello').toString('base64'), mime: 'text/plain', name: 'note.txt' })
    expect(fixture.ctx.dvAssetPool.read(inline.outputs[0] as AssetId).toString()).toBe('hello')
    const bare = await fixture.run('asset.import', { base64: Buffer.from('x').toString('base64'), mime: 'text/plain' })
    expect(fixture.ctx.dvAssetPool.get(bare.outputs[0] as AssetId).name).toBe('imported')
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'asset.import')
    expect(spec?.summarize(inline)).toBe('imported note.txt')
    expect(spec?.summarize(bare)).toBe('imported bytes')
  })

  it('puts assets on the canvas as records, refuses a call that changes nothing, keeps a removed node\'s asset in the pool, and undo takes a placement back', async () => {
    const fixture = await start()
    const placed = (): AssetId[] => placedOf(fixture.ctx.dvProject.getState(fixture.project))
    const assetInput = (asset: AssetId): RecordInput => ({ role: 'asset', ref: { asset }, resolved_asset: asset })
    const a = (await fixture.run('asset.import', { base64: Buffer.from('a').toString('base64'), mime: 'image/png' })).outputs[0] as AssetId
    expect(placed()).toEqual([])
    // An import with `place` puts its output on the canvas.
    const b = (await fixture.run('asset.import', { base64: Buffer.from('b').toString('base64'), mime: 'image/png', place: true })).outputs[0] as AssetId
    expect(placed()).toEqual([b])
    // An import with `place` that fails makes no node.
    expect(await fixture.run('asset.import', { mime: 'image/png', place: true })).toMatchObject({ status: 'failed' })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.canvas.order).toHaveLength(1)
    const put = await fixture.run('asset.place', {}, [assetInput(a), assetInput(b)])
    expect(put).toMatchObject({ status: 'done', component: 'asset', operation: 'asset.place', outputs: [] })
    expect(fixture.ctx.dvProject.listOperations().find(spec => spec.name === 'asset.place')?.summarize(put)).toBe('placed 2 asset(s) on the canvas')
    expect(placed()).toEqual([b, a])
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.run('asset.place', {}, [assetInput(a)])).rejects.toMatchObject({ code: 'invalid_params' })
    await fixture.run('canvas.node_remove', { nodes: [fixture.ctx.dvProject.getState(fixture.project).components.canvas.assets[b]] })
    expect(placed()).toEqual([a])
    expect(fixture.ctx.dvAssetPool.get(b)).toMatchObject({ id: b })
    // An asset that no record of the current state created cannot go on the canvas.
    const outside = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('outside'), { mime: 'image/png', name: 'o.png' }, null)
    await expect(fixture.run('asset.place', {}, [assetInput(outside)])).rejects.toMatchObject({ code: 'invalid_inputs' })
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before + 1)
    await fixture.ctx.dvProject.undo(fixture.project)
    expect(placed()).toEqual([b, a])
  })

  it('keeps the first finished import of each asset, discarded steps included, and places imports and current-state assets', async () => {
    const fixture = await start()
    const bytes = Buffer.from('twice').toString('base64')
    const first = await fixture.run('asset.import', { base64: bytes, mime: 'image/png', name: 'first.png' })
    const second = await fixture.run('asset.import', { base64: bytes, mime: 'image/png', name: 'second.png' })
    const asset = first.outputs[0] as AssetId
    expect(second.outputs).toEqual([asset])
    await fixture.ctx.dvProject.undo(fixture.project)
    await fixture.ctx.dvProject.undo(fixture.project)
    // A write after two undos discards both imports; the project still imported the asset.
    const kept = (await fixture.run('asset.import', { base64: Buffer.from('kept').toString('base64'), mime: 'image/png' })).outputs[0] as AssetId
    const imported = importedAssets(fixture.ctx.dvProject.listRecords(fixture.project))
    expect(imported.get(asset)?.id).toBe(first.id)
    const state = fixture.ctx.dvProject.getState(fixture.project)
    expect(placeable(state, imported, asset)).toBe(true)
    expect(placeable(state, new Map(), asset)).toBe(false)
    expect(placeable(state, new Map(), kept)).toBe(true)
  })

  it('fails an import without bytes and refuses one without a media type before writing a record', async () => {
    const fixture = await start()
    const empty = await fixture.run('asset.import', { mime: 'text/plain' })
    expect(empty).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message: 'asset.import needs `path` or `base64`.' } })
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.run('asset.import', { base64: 'QQ==' })).rejects.toMatchObject({ code: 'invalid_params' })
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    expect(failure(await fixture.call('dv_asset_import', { reason: 'nothing', mime: 'text/plain' }))).toContain('needs `path` or `base64`')
  })

  it('stores identical bytes once in the project folder, finds them by ID after a restart, and refuses unknown assets', async () => {
    const first = await start()
    const pool = first.ctx.dvAssetPool
    const folder = first.ctx.dvProject.openProject(first.project).path
    const kept = pool.importAsset(first.project, Buffer.from('kept'), { mime: 'text/plain', name: 'a.txt' }, null)
    expect(pool.importAsset(first.project, Buffer.from('kept'), { mime: 'text/plain', name: 'b.txt' }, null)).toBe(kept)
    const lost = pool.importAsset(first.project, Buffer.from('lost'), { mime: 'text/plain', name: 'lost.txt', width: 4, height: 3, durationSec: 1.5 }, null)
    expect(pool.get(lost)).toMatchObject({ width: 4, height: 3, duration_sec: 1.5, created_by: null })
    expect(pool.get(kept).name).toBe('a.txt')
    expect(pool.path(kept)).toBe(join(folder, '.dreamverse', 'assets', 'objects', kept))
    expect(readFileSync(pool.path(kept), 'utf8')).toBe('kept')
    const index = readFileSync(join(folder, '.dreamverse', 'assets', 'index.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { id: string })
    expect(index.map(entry => entry.id)).toEqual([kept, lost])
    const missing = brandString<AssetId>('0'.repeat(64))
    expect(pool.has(missing)).toBe(false)
    expect(pool.mediaType(kept)).toBe('text')
    expect(() => pool.mediaType(missing)).toThrow(expect.objectContaining({ code: 'unknown_asset' }))
    expect(() => pool.get(missing)).toThrow(ProjectError)
    expect(() => pool.path(missing)).toThrow(expect.objectContaining({ code: 'unknown_asset' }))
    await first.stop()
    rmSync(join(folder, '.dreamverse', 'assets', 'objects', lost))
    // The Workspace registry of the next server lists the folder again.
    const second = await start({ dir: first.dir })
    await second.ctx.dvProject.createProject(folder, 'pool', { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'add' })
    expect(second.ctx.dvAssetPool.read(kept).toString()).toBe('kept')
    expect(second.ctx.dvAssetPool.get(kept).name).toBe('a.txt')
    expect(second.ctx.dvAssetPool.has(lost)).toBe(false)
  })

  it('stores the same bytes in two projects as two files, and refuses an import into a folder that is no project', async () => {
    const fixture = await start()
    const origin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'create' } as const
    const other = (await fixture.ctx.dvProject.createProject(await fixture.ctx.dvProject.newProjectFolder('other'), 'other', origin)).id
    const pool = fixture.ctx.dvAssetPool
    const one = pool.importAsset(fixture.project, Buffer.from('same'), { mime: 'text/plain', name: 'one.txt' }, null)
    expect(pool.importAsset(other, Buffer.from('same'), { mime: 'text/plain', name: 'two.txt' }, null)).toBe(one)
    for (const project of [fixture.project, other]) {
      expect(readFileSync(join(fixture.ctx.dvProject.openProject(project).path, '.dreamverse', 'assets', 'objects', one), 'utf8')).toBe('same')
    }
    const plain = join(fixture.dir, 'plain')
    mkdirSync(plain)
    const workspace = await fixture.services.workspaces.create(plain)
    expect(() => pool.importAsset(brandString<ProjectId>(workspace.id), Buffer.from('nowhere'), { mime: 'text/plain', name: 'n.txt' }, null))
      .toThrow(expect.objectContaining({ code: 'unknown_project' }))
    expect(readdirSync(plain)).toEqual([])
  })

  it('serves the assets of a copied folder that is added as a new project, after the original folder is gone', async () => {
    const first = await start()
    const original = first.ctx.dvProject.openProject(first.project).path
    const image = (await first.run('asset.import', { base64: Buffer.from('<svg/>').toString('base64'), mime: 'image/svg+xml', name: 'a.svg', place: true })).outputs[0] as AssetId
    await first.stop()
    const copy = join(first.dir, 'copy')
    cpSync(original, copy, { recursive: true })
    rmSync(original, { recursive: true })
    const second = await start({ dir: first.dir })
    const added = await second.ctx.dvProject.createProject(copy, 'copy', { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'add' })
    expect(added.id).not.toBe(first.project)
    expect(placedOf(second.ctx.dvProject.getState(added.id))).toEqual([image])
    expect(second.ctx.dvAssetPool.path(image)).toBe(join(added.path, '.dreamverse', 'assets', 'objects', image))
    const base = await second.web.listen()
    try {
      expect(await (await fetch(`${base}/dv/assets/${image}`)).text()).toBe('<svg/>')
    } finally {
      await second.web.close()
    }
  })

  it('serves asset files on /dv/assets/<AssetId>', async () => {
    const fixture = await start()
    const asset = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('<svg/>'), { mime: 'image/svg+xml', name: 'a.svg' }, null)
    expect(fixture.ctx.dvAssetPool.url(asset)).toBe(`/dv/assets/${asset}`)
    const base = await fixture.web.listen()
    try {
      const ok = await fetch(`${base}/dv/assets/${asset}`)
      expect(ok.status).toBe(200)
      expect(ok.headers.get('content-type')).toBe('image/svg+xml')
      expect(await ok.text()).toBe('<svg/>')
      expect((await fetch(`${base}/dv/assets/${'0'.repeat(64)}`)).status).toBe(404)
      expect((await fetch(`${base}/dv/assets/list`)).status).toBe(404)
      expect((await fetch(`${base}/dv/assets/${asset}`, { method: 'POST' })).status).toBe(404)
    } finally {
      await fixture.web.close()
    }
  })

  it('serves one byte range of a file, so a browser can start a sound or a video inside it', async () => {
    const fixture = await start()
    const asset = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('0123456789'), { mime: 'audio/mpeg', name: 'a.mp3' }, null)
    const empty = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from(''), { mime: 'audio/mpeg', name: 'e.mp3' }, null)
    const base = await fixture.web.listen()
    type Answer = { status: number; range: string | null; length: string | null; body: string }
    /** Fetch an asset with the given request headers and keep the status, the length headers and the body. */
    const get = async (headers: Record<string, string>, of: AssetId = asset, method = 'GET'): Promise<Answer> => {
      const response = await fetch(`${base}/dv/assets/${of}`, { method, headers })
      return { status: response.status, range: response.headers.get('content-range'), length: response.headers.get('content-length'), body: await response.text() }
    }
    const all: Answer = { status: 200, range: null, length: '10', body: '0123456789' }
    try {
      const whole = await fetch(`${base}/dv/assets/${asset}`)
      expect(Object.fromEntries(['accept-ranges', 'etag', 'cache-control'].map(name => [name, whole.headers.get(name)]))).toEqual({
        'accept-ranges': 'bytes', 'etag': `"${asset}"`, 'cache-control': 'public, max-age=31536000, immutable, no-transform',
      })
      expect(await whole.text()).toBe('0123456789')
      expect(await get({ range: 'bytes=2-4' })).toEqual({ status: 206, range: 'bytes 2-4/10', length: '3', body: '234' })
      expect(await get({ range: 'Bytes=7-' })).toEqual({ status: 206, range: 'bytes 7-9/10', length: '3', body: '789' })
      expect(await get({ range: 'bytes=8-100' })).toEqual({ status: 206, range: 'bytes 8-9/10', length: '2', body: '89' })
      expect(await get({ range: 'bytes=-3' })).toEqual({ status: 206, range: 'bytes 7-9/10', length: '3', body: '789' })
      expect(await get({ range: 'bytes=0-1,2-3' })).toEqual({ status: 206, range: 'bytes 0-3/10', length: '4', body: '0123' })
      expect(await get({ 'range': 'bytes=2-4', 'if-range': `"${asset}"` })).toMatchObject({ status: 206, body: '234' })
      expect(await get({ 'range': 'bytes=2-4', 'if-range': '"another"' })).toEqual(all)
      expect(await get({ range: 'bytes=-30' })).toEqual({ ...all, status: 206, range: 'bytes 0-9/10' })
      for (const unsatisfiable of ['bytes=10-', 'bytes=-0', 'bytes=4-2']) {
        expect(await get({ range: unsatisfiable })).toMatchObject({ status: 416, range: 'bytes */10', body: '' })
      }
      for (const ignored of ['bytes=0-1,4-5', 'items=0-1', 'bytes=x']) {
        expect(await get({ range: ignored })).toEqual(all)
      }
      expect(await get({ range: 'bytes=-1' }, empty)).toEqual({ status: 200, range: null, length: '0', body: '' })
      expect(await get({}, asset, 'HEAD')).toEqual({ ...all, body: '' })
      expect(await get({ range: 'bytes=2-4' }, asset, 'HEAD')).toEqual({ ...all, body: '' })
      for (const held of [`"${asset}"`, `W/"${asset}"`, `"another", "${asset}"`, '*']) {
        const fresh = await fetch(`${base}/dv/assets/${asset}`, { headers: { 'if-none-match': held } })
        expect([fresh.status, fresh.headers.get('etag'), await fresh.text()]).toEqual([304, `"${asset}"`, ''])
      }
      expect(await get({ 'if-none-match': '"another"' })).toEqual(all)
    } finally {
      await fixture.web.close()
    }
  })

  it('closes the file when the client cancels a request, and answers a file that cannot be read with an HTTP status', async () => {
    const fixture = await start()
    const pool = fixture.ctx.dvAssetPool
    const size = 8 * 1024 * 1024
    const big = pool.importAsset(fixture.project, Buffer.alloc(size, 1), { mime: 'video/mp4', name: 'big.mp4' }, null)
    const gone = pool.importAsset(fixture.project, Buffer.from('gone'), { mime: 'audio/mpeg', name: 'gone.mp3' }, null)
    const locked = pool.importAsset(fixture.project, Buffer.from('locked'), { mime: 'audio/mpeg', name: 'locked.mp3' }, null)
    const broken = pool.importAsset(fixture.project, Buffer.alloc(size, 2), { mime: 'video/mp4', name: 'broken.mp4' }, null)
    const base = await fixture.web.listen()
    const warnings: string[] = []
    fixture.ctx.logger.exporter({ levels: { default: 3 }, export: (message) => { if (message.type === 'warn') warnings.push(message.args.map(String).join(' ')) } })
    files.failOpen.set(locked, 'EACCES')
    files.failRead.add(broken)
    try {
      files.streams.length = 0
      const cancel = new AbortController()
      const started = await fetch(`${base}/dv/assets/${big}`, { headers: { range: 'bytes=0-' }, signal: cancel.signal })
      expect(started.status).toBe(206)
      const [file] = files.streams
      cancel.abort()
      await vi.waitFor(() => { expect(file?.closed).toBe(true) })
      expect([file?.readableEnded, (file?.bytesRead ?? size) < size]).toEqual([false, true])

      rmSync(pool.path(gone))
      const missing = await fetch(`${base}/dv/assets/${gone}`)
      expect([missing.status, missing.headers.get('cache-control'), await missing.text()]).toEqual([404, null, 'Not found'])
      const refused = await fetch(`${base}/dv/assets/${locked}`)
      expect([refused.status, await refused.text()]).toEqual([500, 'Could not read the file'])
      const cut = await fetch(`${base}/dv/assets/${broken}`)
      expect(cut.status).toBe(200)
      await expect(cut.text()).rejects.toThrow()
      await vi.waitFor(() => { expect(warnings.some(warning => warning.includes('could not read the file') && warning.includes('EIO'))).toBe(true) })
      expect(warnings.filter(warning => warning.includes('could not open the file')).map(warning => warning.includes(gone) || warning.includes(locked)))
        .toEqual([true, true])
      expect(warnings.some(warning => warning.includes(big))).toBe(false)
      expect((await fetch(`${base}/dv/assets/${big}`, { headers: { range: 'bytes=0-1' } })).status).toBe(206)
    } finally {
      files.failOpen.clear()
      files.failRead.clear()
      await fixture.web.close()
    }
  })

  describe.skipIf(!existsSync(FFMPEG))('with ffmpeg', () => {
    /**
     * Render a solid-color video into the pool; `fragmented` writes the fMP4 layout a streaming backend sends.
     * @returns the video asset.
     */
    async function video(fixture: Fixture, color: string, seconds: number, fragmented = false): Promise<AssetId> {
      const layout = fragmented ? ['-movflags', 'frag_keyframe+empty_moov+default_base_moof'] : []
      const name = `${color}-${String(seconds)}.mp4`
      const { outputs } = await fixture.ctx.dvFfmpeg.run({
        argv: ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:d=${String(seconds)}:r=10`, '-pix_fmt', 'yuv420p', ...layout, `{{out:${name}}}`],
        inputs: [], outputs: [name], dir: fixture.dir,
      })
      return fixture.ctx.dvAssetPool.importAsset(fixture.project, { path: outputs[0] as string }, { mime: 'video/mp4', name }, null)
    }

    it('grabs the first, last and a timed still of a video as records whose output is a PNG', async () => {
      const fixture = await start()
      const red = await video(fixture, 'red', 2)
      const first = value(await fixture.call('dv_asset_grab_still', { reason: 'look at the start', at: 'first', inputs: { video: red } }))
      expect(first).toMatchObject({ status: 'done', summary: 'still at first', outputs: [{ role: 'still', mime: 'image/png' }] })
      const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(first.record))
      expect(record).toMatchObject({ actor: 'agent', component: 'asset', operation: 'asset.grab_still', params: { at: 'first' } })
      expect(record.inputs).toEqual([videoInput(red)])
      const still = record.outputs[0] as AssetId
      expect(fixture.ctx.dvAssetPool.get(still)).toMatchObject({ mime: 'image/png', name: 'still.png', created_by: record.id })
      for (const at of [1, '0.5', 'last']) {
        const timed = await fixture.run('asset.grab_still', { at }, [videoInput(red)])
        expect(timed.status).toBe('done')
        expect(fixture.ctx.dvAssetPool.get(timed.outputs[0] as AssetId).mime).toBe('image/png')
      }
      const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'asset.grab_still')
      expect(['first', 2, ' 1.5 ', '', 'x', -1, true, undefined].map(at => spec?.summarize({ ...record, params: at === undefined ? {} : { at } })))
        .toEqual(['still at first', 'still at 2', 'still at 1.5', 'still at last', 'still at last', 'still at last', 'still at last', 'still at last'])
      await expect(fixture.run('asset.grab_still', { at: true }, [videoInput(red)])).rejects.toMatchObject({ code: 'invalid_params' })
      const text = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('notes'), { mime: 'text/plain', name: 'notes.txt' }, null)
      expect(await fixture.run('asset.grab_still', { at: 'first' }, [videoInput(text)])).toMatchObject({ status: 'failed', error: { code: 'operation_failed' } })
      expect(failure(await fixture.call('dv_asset_grab_still', { reason: 'no video' }))).toContain('needs input "video"')
    })

    it('cuts a segment of a video with its sound as a record whose output is an MP4 with known size and duration', async () => {
      const fixture = await start()
      const { outputs } = await fixture.ctx.dvFfmpeg.run({
        argv: [
          'ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=3:r=10', '-f', 'lavfi', '-i', 'sine=d=3',
          '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '{{out:talk.mp4}}',
        ],
        inputs: [], outputs: ['talk.mp4'], dir: fixture.dir,
      })
      const talk = fixture.ctx.dvAssetPool.importAsset(fixture.project, { path: outputs[0] as string }, { mime: 'video/mp4', name: 'talk.mp4' }, null)
      const cut = value(await fixture.call('dv_asset_cut_segment', { reason: 'the middle second as reference', in_sec: 1, out_sec: 2, inputs: { video: talk } }))
      expect(cut).toMatchObject({ status: 'done', summary: 'segment 1–2 s', outputs: [{ role: 'segment', mime: 'video/mp4' }] })
      const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(cut.record))
      expect(record).toMatchObject({ actor: 'agent', component: 'asset', operation: 'asset.cut_segment', params: { in_sec: 1, out_sec: 2 } })
      expect(record.inputs).toEqual([videoInput(talk)])
      const segment = record.outputs[0] as AssetId
      const stored = fixture.ctx.dvAssetPool.get(segment)
      expect(stored).toMatchObject({ mime: 'video/mp4', name: 'segment.mp4', created_by: record.id, width: 160, height: 90 })
      expect(stored.duration_sec).toBeCloseTo(1, 1)
      expect(fixture.ctx.dvAssetPool.mediaType(segment)).toBe('video')
      expect((await fixture.ctx.dvFfmpeg.probe(fixture.ctx.dvAssetPool.path(segment))).hasAudio).toBe(true)
      // Times outside 0 <= in_sec < out_sec are refused before any record.
      const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
      await expect(fixture.run('asset.cut_segment', { in_sec: -1, out_sec: 1 }, [videoInput(talk)])).rejects.toMatchObject({ code: 'invalid_params' })
      await expect(fixture.run('asset.cut_segment', { in_sec: 2, out_sec: 2 }, [videoInput(talk)])).rejects.toMatchObject({ code: 'invalid_params' })
      await expect(fixture.run('asset.cut_segment', { in_sec: 0 }, [videoInput(talk)])).rejects.toMatchObject({ code: 'invalid_params' })
      expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
      // A range after the video's end holds no frame; the record fails and no file enters the pool.
      const objects = join(fixture.ctx.dvProject.openProject(fixture.project).path, '.dreamverse', 'assets', 'objects')
      const files = readdirSync(objects).length
      expect(await fixture.run('asset.cut_segment', { in_sec: 5, out_sec: 6 }, [videoInput(talk)])).toMatchObject({
        status: 'failed', error: { code: 'operation_failed', message: 'The video has no frame between 5s and 6s.' },
      })
      expect(readdirSync(objects)).toHaveLength(files)
      expect(failure(await fixture.call('dv_asset_cut_segment', { reason: 'no video', in_sec: 0, out_sec: 1 }))).toContain('needs input "video"')
    })

    it('reads the size and duration of an imported video, decoding it when its header has no duration', async () => {
      const fixture = await start()
      const { outputs } = await fixture.ctx.dvFfmpeg.run({
        argv: ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=2:r=10', '-pix_fmt', 'yuv420p', '{{out:blue.mp4}}'],
        inputs: [], outputs: ['blue.mp4'], dir: fixture.dir,
      })
      const imported = await fixture.run('asset.import', { path: outputs[0], mime: 'video/mp4' })
      const asset = fixture.ctx.dvAssetPool.get(imported.outputs[0] as AssetId)
      expect(asset).toMatchObject({ width: 160, height: 90 })
      expect(asset.duration_sec).toBeCloseTo(2, 1)
      // The same bytes imported again keep the known size and duration without another probe.
      const known = vi.spyOn(fixture.ctx.dvFfmpeg, 'probe')
      const again = await fixture.run('asset.import', { base64: readFileSync(outputs[0] as string).toString('base64'), mime: 'video/mp4' })
      expect([again.outputs, known.mock.calls]).toEqual([imported.outputs, []])
      known.mockRestore()
      // A header without a duration (a WebM file a browser recorded) is measured by decoding the video stream.
      const probe = vi.spyOn(fixture.ctx.dvFfmpeg, 'probe').mockResolvedValue({
        durationSec: null, videoDurationSec: null, width: 160, height: 90, hasAudio: false, codec: 'h264',
      })
      const other = await fixture.ctx.dvFfmpeg.run({
        argv: ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x90:d=3:r=10', '-pix_fmt', 'yuv420p', '{{out:green.mp4}}'],
        inputs: [], outputs: ['green.mp4'], dir: fixture.dir,
      })
      const bare = await fixture.run('asset.import', { path: other.outputs[0], mime: 'video/mp4' })
      expect(probe).toHaveBeenCalled()
      probe.mockRestore()
      expect(fixture.ctx.dvAssetPool.get(bare.outputs[0] as AssetId).duration_sec).toBeCloseTo(3, 1)
    })

    it('reads the duration of an imported audio file once, and stores no pixel size for it', async () => {
      const fixture = await start()
      const { outputs } = await fixture.ctx.dvFfmpeg.run({
        argv: ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=1.5', '{{out:tone.wav}}'],
        inputs: [], outputs: ['tone.wav'], dir: fixture.dir,
      })
      const imported = await fixture.run('asset.import', { path: outputs[0], mime: 'audio/wav' })
      const asset = fixture.ctx.dvAssetPool.get(imported.outputs[0] as AssetId)
      expect(asset).toMatchObject({ mime: 'audio/wav', width: null, height: null })
      expect(asset.duration_sec).toBeCloseTo(1.5, 1)
      // The same bytes imported again keep the known duration without another probe.
      const probe = vi.spyOn(fixture.ctx.dvFfmpeg, 'probe')
      const again = await fixture.run('asset.import', { base64: readFileSync(outputs[0] as string).toString('base64'), mime: 'audio/wav' })
      expect(again.outputs).toEqual(imported.outputs)
      expect(probe).not.toHaveBeenCalled()
      probe.mockRestore()
    })

    it('stores no pixel size for an audio file with cover art, and decodes an audio file whose header has no duration', async () => {
      const fixture = await start()
      const run = (argv: string[], inputs: string[], output: string): Promise<string> => fixture.ctx.dvFfmpeg
        .run({ argv: ['ffmpeg', '-y', '-loglevel', 'error', ...argv, `{{out:${output}}}`], inputs, outputs: [output], dir: fixture.dir })
        .then(result => result.outputs[0] as string)
      // An M4A file whose second stream is a 32×32 cover picture.
      const cover = await run(['-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1'], [], 'cover.png')
      const song = await run(
        ['-f', 'lavfi', '-i', 'sine=d=2', '-i', '{{in:0}}', '-map', '0:a', '-map', '1:v', '-c:a', 'aac', '-c:v', 'png', '-disposition:v', 'attached_pic'],
        [cover], 'song.m4a',
      )
      expect(await fixture.ctx.dvFfmpeg.probe(song)).toMatchObject({ width: 32, height: 32 })
      const covered = await fixture.run('asset.import', { path: song, mime: 'audio/mp4' })
      const stored = fixture.ctx.dvAssetPool.get(covered.outputs[0] as AssetId)
      expect(stored).toMatchObject({ width: null, height: null })
      expect(stored.duration_sec).toBeCloseTo(2, 1)
      // A WebM file written as a live stream, the way a browser records one, has no duration in its header.
      const live = await run(['-f', 'lavfi', '-i', 'sine=d=1.5', '-c:a', 'opus', '-strict', '-2', '-ac', '2', '-ar', '48000', '-live', '1'], [], 'voice.webm')
      expect(await fixture.ctx.dvFfmpeg.probe(live)).toMatchObject({ durationSec: null, width: null })
      const bare = await fixture.run('asset.import', { path: live, mime: 'audio/webm' })
      const measured = fixture.ctx.dvAssetPool.get(bare.outputs[0] as AssetId)
      expect(measured).toMatchObject({ width: null, height: null })
      expect(measured.duration_sec).toBeCloseTo(1.5, 1)
    })

    it('leaves an audio file\'s duration unknown when decoding reports no time or a zero time, or when probing fails', async () => {
      const fixture = await start()
      const ffmpeg = fixture.ctx.dvFfmpeg
      const probe = vi.spyOn(ffmpeg, 'probe').mockResolvedValue({
        durationSec: null, videoDurationSec: null, width: null, height: null, hasAudio: true, codec: 'opus',
      })
      const decodes: string[][] = []
      const progress = ['', 'out_time=00:00:00.000000\n']
      vi.spyOn(ffmpeg, 'run').mockImplementation((request) => {
        decodes.push([...request.argv])
        return Promise.resolve({ stdout: progress.shift() ?? '', stderr: '', outputs: [], exitCode: 0 })
      })
      const imported = async (bytes: string): Promise<number | null> => {
        const record = await fixture.run('asset.import', { base64: Buffer.from(bytes).toString('base64'), mime: 'audio/webm' })
        return fixture.ctx.dvAssetPool.get(record.outputs[0] as AssetId).duration_sec
      }
      expect([await imported('silent'), await imported('zero')]).toEqual([null, null])
      // The decode reads the first audio stream.
      expect(decodes.map(argv => argv[argv.indexOf('-map') + 1])).toEqual(['0:a:0', '0:a:0'])
      probe.mockRejectedValue('ffprobe crashed')
      expect(await imported('broken')).toBeNull()
    })

    it('reads whether an asset holds sound, probing a video once and keeping the answer across a restart', async () => {
      const fixture = await start()
      const pool = fixture.ctx.dvAssetPool
      const { outputs } = await fixture.ctx.dvFfmpeg.run({
        argv: [
          'ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1:r=10', '-f', 'lavfi', '-i', 'sine=d=1',
          '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '{{out:talk.mp4}}',
        ],
        inputs: [], outputs: ['talk.mp4'], dir: fixture.dir,
      })
      const talk = pool.importAsset(fixture.project, { path: outputs[0] as string }, { mime: 'video/mp4', name: 'talk.mp4' }, null)
      const silent = await video(fixture, 'blue', 1)
      const audio = pool.importAsset(fixture.project, Buffer.from('AUD1'), { mime: 'audio/wav', name: 'a.wav' }, null)
      const image = pool.importAsset(fixture.project, Buffer.from('IMG1'), { mime: 'image/png', name: 'a.png' }, null)
      expect(pool.get(talk).has_audio).toBeUndefined()
      const answers = [await pool.hasAudio(talk), await pool.hasAudio(silent), await pool.hasAudio(audio), await pool.hasAudio(image)]
      expect(answers).toEqual([true, false, true, false])
      expect(pool.get(talk).has_audio).toBe(true)
      const folder = fixture.ctx.dvProject.openProject(fixture.project).path
      await fixture.stop()
      const second = await start({ dir: fixture.dir })
      await second.ctx.dvProject.createProject(folder, 'pool', { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'add' })
      const probe = vi.spyOn(second.ctx.dvFfmpeg, 'probe')
      expect([await second.ctx.dvAssetPool.hasAudio(talk), await second.ctx.dvAssetPool.hasAudio(silent)]).toEqual([true, false])
      expect(probe).not.toHaveBeenCalled()
    })

    it('puts an import of an undone step on the canvas, and refuses a generated asset whose step was undone', async () => {
      const fixture = await start()
      const red = await video(fixture, 'red', 1)
      const input = (asset: AssetId): RecordInput => ({ role: 'asset', ref: { asset }, resolved_asset: asset })
      const imported = (await fixture.run('asset.import', { base64: Buffer.from('later').toString('base64'), mime: 'image/png', name: 'later.png' })).outputs[0] as AssetId
      const still = (await fixture.run('asset.grab_still', { at: 'first' }, [videoInput(red)])).outputs[0] as AssetId
      await fixture.ctx.dvProject.undo(fixture.project)
      await fixture.ctx.dvProject.undo(fixture.project)
      // Both steps are undone: the import still belongs to the project, the still does not.
      await expect(fixture.run('asset.place', {}, [input(still)])).rejects.toMatchObject({ code: 'invalid_inputs' })
      expect((await fixture.run('asset.place', {}, [input(imported)])).status).toBe('done')
      expect(placedOf(fixture.ctx.dvProject.getState(fixture.project))).toEqual([imported])
    })

    it('reads the last frame of a fragmented video, falls through the seek attempts, and rethrows other failures', async () => {
      const fixture = await start()
      const fragmented = await video(fixture, 'green', 2, true)
      const pool = fixture.ctx.dvAssetPool
      expect(existsSync(await pool.grabStill(fragmented, 'last', mkdtempSync(join(fixture.dir, 'still-'))))).toBe(true)
      // ffprobe keeps running for real; only the ffmpeg attempts are scripted.
      const ffmpeg = fixture.ctx.dvFfmpeg
      const original = ffmpeg.run.bind(ffmpeg)
      const failing = (error: Error, times: number) => {
        let left = times
        return vi.spyOn(ffmpeg, 'run').mockImplementation((request) => {
          if (request.argv[0] === 'ffprobe' || left <= 0) return original(request)
          left -= 1
          return Promise.reject(error)
        })
      }
      // The first attempt (an input seek near the probed duration) fails; the full decode still yields a frame. The
      // counts include the ffprobe call.
      const once = failing(new FfmpegError('ffmpeg did not write declared output', ''), 1)
      expect(existsSync(await pool.grabStill(fragmented, 'last', mkdtempSync(join(fixture.dir, 'still-'))))).toBe(true)
      expect(once).toHaveBeenCalledTimes(3)
      once.mockRestore()
      const always = failing(new FfmpegError('no frame', 'stderr'), Number.POSITIVE_INFINITY)
      await expect(pool.grabStill(fragmented, 'last', fixture.dir)).rejects.toThrow('no frame')
      always.mockRestore()
      const broken = failing(new TypeError('not ffmpeg'), Number.POSITIVE_INFINITY)
      await expect(pool.grabStill(fragmented, 'last', fixture.dir)).rejects.toThrow(TypeError)
      expect(broken).toHaveBeenCalledTimes(2)
      broken.mockRestore()
    })
  })
})
