/** Real Loader composition with a fake OpenRouter HTTP API and real shared video extraction. */
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import DvModels, { type ModelEntry, type TaskOfPrimitive } from '@dv/models'
import DvShotRender from '@dv/shot-render'
import DvProject from '@dv/project'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { provideChatServices } from '../../project/tests/workspaces.ts'
import { shotGeometry } from '../../shot-render/src/render.ts'
import * as OpenRouter from '../src/index.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const CATALOG = { data: [{ id: 'fixture/video', name: 'Fixture Video', supported_durations: [4, 6, 8],
  supported_resolutions: ['720p'], supported_aspect_ratios: ['16:9'], supported_frame_images: ['first_frame', 'last_frame'],
  generate_audio: true, seed: true }] }
function isVideoEntry(entry: ModelEntry): entry is ModelEntry<TaskOfPrimitive<'video'>> { return entry.modality === 'video' }
const ffmpeg = process.env['DV_FFMPEG'] ?? 'ffmpeg'

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dv-openrouter-'))
  cleanup.push(async () => { rmSync(dir, { recursive: true, force: true }) })
  const videoPath = join(dir, 'fixture.mp4')
  await promisify(execFile)(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1:r=8',
    '-pix_fmt', 'yuv420p', videoPath])
  const clip = readFileSync(videoPath)
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null; key: string | undefined }> = []
  const server: Server = createServer(async (request, response) => {
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    const path = request.url ?? ''
    requests.push({ path, method: request.method ?? 'GET', body: parts.length === 0 ? null
      : JSON.parse(Buffer.concat(parts).toString()), key: request.headers.authorization })
    response.setHeader('content-type', 'application/json')
    if (path === '/api/v1/videos/models') response.end(JSON.stringify(CATALOG))
    else if (request.method === 'POST') { response.statusCode = 202; response.end(JSON.stringify({ id: 'job1' })) }
    else if (path.endsWith('content?index=0')) { response.setHeader('content-type', 'video/mp4'); response.end(clip) }
    else response.end(JSON.stringify({ status: 'completed' }))
  })
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => { resolve() })) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  provideChatServices(ctx)
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { include: Include, credentials: MemoryCredentials,
    project: DvProject, assetPool: DvAssetPool, ffmpeg: DvFfmpeg, models: DvModels, openrouter: OpenRouter, shotRender: DvShotRender })
  const rows = [
    { id: 'credentials', name: 'cordis:credentials', config: { OPENROUTER_API_KEY: 'fixture-key' } },
    { id: 'project', name: 'cordis:project', config: { projectsFolder: join(dir, 'projects') } },
    { id: 'ffmpeg', name: 'cordis:ffmpeg', config: { ffmpegPath: ffmpeg, ffprobePath: 'ffprobe' } },
    { id: 'assets', name: 'cordis:assetPool' }, { id: 'models', name: 'cordis:models' },
    { id: 'provider', name: 'cordis:openrouter', config: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/`, models: { cloud: 'fixture/video' }, pollIntervalMs: 1,
    } },
    { id: 'shot-render', name: 'cordis:shotRender' },
  ]
  const path = join(dir, 'cordis.yml'); writeFileSync(path, JSON.stringify(rows))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } }); await ctx.loader.await()
  const origin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'create' } as const
  const project = await ctx.dvProject.createProject(await ctx.dvProject.newProjectFolder('cloud'), 'cloud', origin)
  return { ctx, requests, clip, project }
}

describe('OpenRouter video provider composition', () => {
  it('registers only selected cloud models, publishes exact duration choices, and removes entries on disposal', async () => {
    const { ctx } = await fixture()
    expect(ctx.dvModels.list().map(entry => entry.task)).toEqual(['t2v', 'i2v', 'fl2v'])
    const entry = ctx.dvModels.list().filter(isVideoEntry)[0]
    if (entry === undefined || !isVideoEntry(entry)) throw new Error('Missing video entry')
    const facts = await entry.facts()
    expect(facts).toMatchObject({ durationsSec: [4, 6, 8] })
    expect(facts).not.toHaveProperty('numFramesByDurationSec')
    expect(facts).not.toHaveProperty('frameSizes')
    expect(shotGeometry(facts, { duration_sec: 6 })).toEqual({ aspectRatio: '16:9', resolution: '720p', durationSec: 6 })
    expect(() => shotGeometry(facts, { duration_sec: 5 })).toThrow('one of 4, 6, 8 seconds')
    await [...ctx.loader.entries()].find(row => row.options.id === 'provider')?.fiber?.dispose()
    expect(ctx.dvModels.list()).toEqual([])
  })

  it('validates endpoints before paid submission and renders a real MP4 through shared ffmpeg', async () => {
    const { ctx, requests, clip, project } = await fixture()
    const entry = ctx.dvModels.list().find(row => row.task === 'fl2v')
    if (entry === undefined || !isVideoEntry(entry)) throw new Error('Missing FL2V entry')
    const first = ctx.dvAssetPool.importAsset(project.id, Buffer.from('FIRST'), { name: 'first.jpg', mime: 'image/jpeg' }, null)
    const last = ctx.dvAssetPool.importAsset(project.id, Buffer.from('LAST'), { name: 'last.png', mime: 'image/png' }, null)
    const input = { prompt: '@[start](dv:input/first_frame) to @[end](dv:input/last_frame)', references: [],
      firstFrame: first, lastFrame: last, durationSec: 6, aspectRatio: '16:9', resolution: '720p', seed: 7, extra: { generate_audio: true } }
    expect(await entry.validateGenerationRequest(input)).toEqual([])
    expect(await entry.validateGenerationRequest({ ...input, lastFrame: null })).toContain('Its last_frame input requires one image.')
    expect(await entry.validateGenerationRequest({ ...input, extra: { bad: true } })).toHaveLength(1)
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(0)
    const events = []
    for await (const event of entry.render(input)) events.push(event)
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    expect(events.find(event => event.kind === 'chunk')?.bytes).toEqual(clip)
    expect(requests.find(request => request.method === 'POST')?.body).toEqual({ model: 'fixture/video', prompt: 'start to end',
      duration: 6, aspect_ratio: '16:9', resolution: '720p', seed: 7, generate_audio: true,
      frame_images: [{ type: 'image_url', frame_type: 'first_frame', image_url: { url: 'data:image/jpeg;base64,RklSU1Q=' } },
        { type: 'image_url', frame_type: 'last_frame', image_url: { url: 'data:image/png;base64,TEFTVA==' } }] })
    expect(requests.every(request => request.key === 'Bearer fixture-key')).toBe(true)
  })

  it('stores a completed cloud video through the ordinary shot workflow without invented frame geometry', async () => {
    const { ctx, project, requests } = await fixture()
    const result = await ctx.dvProject.run({ project: project.id, operation: 'shot.render', actor: 'user', surface: 'api',
      session: null, turn: null, tool_call: null, intent: 'render', inputs: [], params: { modality: 'video', task: 't2v',
        provider: 'openrouter', model: 'cloud', prompt: 'A lake', duration_sec: 6, resolution: '720p', aspect_ratio: '16:9' } })
    expect(result.record?.status).toBe('done')
    expect(result.record?.outputs).toHaveLength(2)
    expect(result.record?.report).toMatchObject({ model_id: 'fixture/video', duration_sec: 6 })
    expect(result.record?.report).not.toHaveProperty('num_frames')
    expect(result.record?.report).not.toHaveProperty('frame_width')
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(1)
  })

})
