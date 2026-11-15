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
import DvProject, { type ProjectId } from '@dv/project'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvImageGenerate from '@dv/image-generate'
import DvAudioGenerate from '@dv/audio-generate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { provideChatServices } from '../../project/tests/workspaces.ts'
import { shotGeometry } from '../../shot-render/src/render.ts'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import * as OpenRouter from '../src/index.ts'
import { imageRows, speechRows } from './client.spec.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const CATALOG = { data: [{ id: 'fixture/video', name: 'Fixture Video', supported_durations: [4, 6, 8],
  supported_resolutions: ['720p'], supported_aspect_ratios: ['16:9'], supported_frame_images: ['first_frame', 'last_frame'],
  generate_audio: true, seed: true }] }
function isVideoEntry(entry: ModelEntry): entry is ModelEntry<TaskOfPrimitive<'video'>> { return entry.modality === 'video' }
const ffmpeg = process.env['DV_FFMPEG'] ?? 'ffmpeg'
const ffprobe = process.env['DV_FFPROBE'] ?? 'ffprobe'

async function fixture(options: { failCatalog?: boolean; models?: Record<string, string>; images?: boolean | Record<string, string>; speech?: 'mp3' | 'pcm' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dv-openrouter-'))
  cleanup.push(async () => { rmSync(dir, { recursive: true, force: true }) })
  const videoPath = join(dir, 'fixture.mp4')
  await promisify(execFile)(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1:r=8',
    '-pix_fmt', 'yuv420p', videoPath])
  const clip = readFileSync(videoPath)
  const remote = { failCatalog: options.failCatalog ?? false }
  const jpegPath = join(dir, 'fixture.jpg')
  await promisify(execFile)(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x36', '-frames:v', '1', jpegPath])
  const jpeg = readFileSync(jpegPath)
  const mp3Path = join(dir, 'fixture.mp3')
  await promisify(execFile)(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', mp3Path])
  // Half a second of 24 kHz mono 16-bit PCM, as a PCM-only provider sends it.
  const speech = options.speech === 'pcm' ? { mime: 'audio/pcm', bytes: Buffer.alloc(24_000) }
    : { mime: 'audio/mpeg', bytes: readFileSync(mp3Path) }
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null; key: string | undefined }> = []
  const server: Server = createServer(async (request, response) => {
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    const path = request.url ?? ''
    requests.push({ path, method: request.method ?? 'GET', body: parts.length === 0 ? null
      : JSON.parse(Buffer.concat(parts).toString()), key: request.headers.authorization })
    response.setHeader('content-type', 'application/json')
    if (path === '/api/v1/videos/models' && remote.failCatalog) { response.statusCode = 503; response.end('{}') }
    else if (path === '/api/v1/videos/models') response.end(JSON.stringify(CATALOG))
    else if (path === '/api/v1/images/models') response.end(JSON.stringify(imageRows))
    else if (path === '/api/v1/models?output_modalities=speech') response.end(JSON.stringify(speechRows))
    else if (path === '/api/v1/audio/speech') { response.setHeader('content-type', speech.mime); response.end(speech.bytes) }
    else if (path === '/api/v1/images') {
      response.end(JSON.stringify({ data: [{ b64_json: jpeg.toString('base64'), media_type: 'image/jpeg' }] }))
    }
    else if (request.method === 'POST') { response.statusCode = 202; response.end(JSON.stringify({ id: 'job1' })) }
    else if (path.endsWith('content?index=0')) { response.setHeader('content-type', 'video/mp4'); response.end(clip) }
    else response.end(JSON.stringify({ status: 'completed' }))
  })
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => { resolve() })) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  provideChatServices(ctx)
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => {
    routes.set(route.path, route)
    return () => { routes.delete(route.path); return Promise.resolve() }
  } } } as never)
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { include: Include, credentials: MemoryCredentials,
    project: DvProject, assetPool: DvAssetPool, ffmpeg: DvFfmpeg, models: DvModels, openrouter: OpenRouter, shotRender: DvShotRender,
    imageGenerate: DvImageGenerate, audioGenerate: DvAudioGenerate })
  const rows = [
    { id: 'credentials', name: 'cordis:credentials', config: { OPENROUTER_API_KEY: 'fixture-key' } },
    { id: 'project', name: 'cordis:project', config: { projectsFolder: join(dir, 'projects') } },
    { id: 'ffmpeg', name: 'cordis:ffmpeg', config: { ffmpegPath: ffmpeg, ffprobePath: ffprobe } },
    { id: 'assets', name: 'cordis:assetPool' }, { id: 'models', name: 'cordis:models' },
    { id: 'provider', name: 'cordis:openrouter', config: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/`, models: options.models ?? { cloud: 'fixture/video' }, pollIntervalMs: 1,
      ...options.images === true ? { imageModels: { flux: 'fixture/image' } } : typeof options.images === 'object' ? { imageModels: options.images } : {},
      ...options.speech === undefined ? {} : { audioModels: { narrator: 'fixture/speech', cloner: 'heygen/fixture-voice' } },
    } },
    { id: 'shot-render', name: 'cordis:shotRender' }, { id: 'image', name: 'cordis:imageGenerate' },
    { id: 'audio', name: 'cordis:audioGenerate' },
  ]
  const path = join(dir, 'cordis.yml'); writeFileSync(path, JSON.stringify(rows))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } }); await ctx.loader.await()
  const origin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'create' } as const
  const project = await ctx.dvProject.createProject(await ctx.dvProject.newProjectFolder('cloud'), 'cloud', origin)
  return { ctx, requests, clip, project, remote, routes }
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


it('withdraws removed cloud choices when replacement settings cannot register, still lists the catalogs, and recovers', async () => {
  const { ctx, routes } = await fixture()
  const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'provider')
  if (provider === undefined) throw new Error('Missing provider fixture')
  const original = provider.options.config
  await provider.update({ config: { ...original, models: { 'invalid alias': 'fixture/video' } } })
  await vi.waitFor(() => { expect(ctx.dvModels.list()).toEqual([]) })
  const response = await routes.get('/api/dv/openrouter/catalog')?.fetch(new Request('http://dsh.local/api/dv/openrouter/catalog'))
  expect(response?.status).toBe(200)
  expect(await response?.json()).toMatchObject({ data: [{ id: 'fixture/video' }],
    error: 'Could not register OpenRouter models. Check the saved key and catalog.' })
  await provider.update({ config: original })
  await vi.waitFor(() => { expect(ctx.dvModels.list().map(entry => entry.model)).toEqual(['cloud', 'cloud', 'cloud']) })
})

it('keeps catalog discovery available after a failed boot catalog sync, and registers models once it recovers', async () => {
  const { ctx, remote, routes } = await fixture({ failCatalog: true })
  expect(ctx.dvModels.list()).toEqual([])
  const route = routes.get('/api/dv/openrouter/catalog')
  if (route === undefined) throw new Error('Missing OpenRouter catalog route')
  remote.failCatalog = false
  const response = await route.fetch(new Request('http://dsh.local/api/dv/openrouter/catalog'))
  expect(await response.json()).toMatchObject({ data: [{ id: 'fixture/video' }], error: null })
  expect(ctx.dvModels.list().map(entry => entry.task)).toEqual(['t2v', 'i2v', 'fl2v'])
})

it('registers the configured models that their catalogs offer and names each unavailable one in the catalog answer', async () => {
  const { ctx, routes } = await fixture({ models: { cloud: 'fixture/video', gone: 'example/retired-video' },
    images: { flux: 'fixture/image', retired: 'example/retired-image-model' } })
  expect(ctx.dvModels.list().map(entry => [entry.model, entry.task])).toEqual([['cloud', 't2v'], ['cloud', 'i2v'], ['cloud', 'fl2v'], ['flux', 't2i']])
  const route = routes.get('/api/dv/openrouter/catalog')
  if (route === undefined) throw new Error('Missing OpenRouter catalog route')
  const answer = async () => {
    const response = await route.fetch(new Request('http://dsh.local/api/dv/openrouter/catalog'))
    return { status: response.status, body: await response.json() as { data: unknown[]; images: unknown[]; error: string | null } }
  }
  const partial = await answer()
  expect(partial.status).toBe(200)
  expect(partial.body).toMatchObject({ data: [{ id: 'fixture/video' }], images: expect.arrayContaining([expect.objectContaining({ id: 'fixture/image' })]) as unknown })
  expect(partial.body.error).toContain('OpenRouter video model example/retired-video is unavailable')
  expect(partial.body.error).toContain('OpenRouter image model example/retired-image-model is unavailable')
  expect(partial.body.error).toMatch(
    /Remove them from models, imageModels or audioModels of the dv-openrouter entry; Settings > Open configuration file opens it\.$/)
  const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'provider')
  if (provider === undefined) throw new Error('Missing provider fixture')
  const original = provider.options.config as Record<string, unknown>
  await provider.update({ config: { ...original, models: { cloud: 'fixture/video' }, imageModels: { flux: 'fixture/image' },
    audioModels: { gone: 'example/retired-speech' } } })
  await vi.waitFor(async () => { expect((await answer()).body.error).toContain('OpenRouter speech model example/retired-speech is unavailable') })
  await provider.update({ config: { ...original, models: { cloud: 'fixture/video' }, imageModels: { flux: 'fixture/image' } } })
  await vi.waitFor(async () => { expect(await answer()).toMatchObject({ status: 200, body: { error: null } }) })
  expect(ctx.dvModels.list().map(entry => entry.model)).toEqual(['cloud', 'cloud', 'cloud', 'flux'])
})

it('fails at load for a configured alias that breaks the alias rule', async () => {
  const { ctx } = await fixture({ models: { Bad: 'fixture/video' } })
  expect([...ctx.loader.entries()].find(entry => entry.options.id === 'provider')?.fiber?.state).toBe(3)
  expect(ctx.dvModels.list()).toEqual([])
})

it('applies saved model settings after a failed boot catalog sync', async () => {
  const { ctx, remote } = await fixture({ failCatalog: true })
  const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'provider')
  if (provider === undefined) throw new Error('Missing provider fixture')
  remote.failCatalog = false
  await provider.update({ config: { ...provider.options.config as Record<string, unknown>, models: { renamed: 'fixture/video' } } })
  await vi.waitFor(() => { expect(ctx.dvModels.list().map(entry => entry.model)).toEqual(['renamed', 'renamed', 'renamed']) })
})

describe('OpenRouter image provider composition', () => {
  it('registers a configured image model as t2i, refuses size and unlisted extra choices, and stores a PNG of a JPEG answer', async () => {
    const { ctx, requests, project } = await fixture({ images: true })
    const image = ctx.dvModels.list().find(entry => entry.task === 't2i')
    expect(image).toMatchObject({ modality: 'image', provider: 'openrouter', model: 'flux', displayName: 'Fixture Image' })
    expect(await image?.schema()).toEqual({
      size: { rule: 'not accepted; omit size and choose extra.aspect_ratio and extra.resolution where listed' },
      extra: { aspect_ratio: { type: 'string', values: ['1:1', '16:9'], description: 'The aspect ratio of the image.' },
        resolution: { type: 'string', values: ['1K', '2K'], description: 'The resolution tier; the provider chooses the pixel size from it and the aspect ratio.' } },
      seed_supported: true,
    })
    const run = (params: Record<string, unknown>) => ctx.dvProject.run({ project: project.id, operation: 'image.generate', actor: 'user',
      surface: 'api', session: null, turn: null, tool_call: null, intent: 'image', inputs: [],
      params: { modality: 'image', task: 't2i', provider: 'openrouter', model: 'flux', prompt: 'A lake', ...params } })
    await expect(run({ size: '1024x576' })).rejects.toThrow('OpenRouter image models take no size')
    await expect(run({ extra: { aspect_ratio: '3:2' } })).rejects.toThrow('Choose extra.aspect_ratio from 1:1, 16:9.')
    await expect(run({ extra: { quality: 'high' } })).rejects.toThrow('takes no extra parameter quality')
    expect(requests.filter(request => request.path === '/api/v1/images')).toHaveLength(0)
    const result = await run({ extra: { aspect_ratio: '16:9', resolution: '1K' }, seed: 5 })
    expect(result.record?.status).toBe('done')
    const [output] = result.record?.outputs ?? []
    if (output === undefined) throw new Error('Missing image output')
    expect(ctx.dvAssetPool.get(output)).toMatchObject({ mime: 'image/png', width: 64, height: 36 })
    expect(result.record?.report).toMatchObject({ model_id: 'fixture/image', size: '64x36' })
    expect(requests.filter(request => request.path === '/api/v1/images').map(request => request.body)).toEqual([{ model: 'fixture/image',
      prompt: 'A lake', n: 1, seed: 5, output_format: 'png', aspect_ratio: '16:9', resolution: '1K' }])
    await [...ctx.loader.entries()].find(row => row.options.id === 'provider')?.fiber?.dispose()
    expect(ctx.dvModels.list()).toEqual([])
  })
})

describe('OpenRouter speech provider composition', () => {
  const speak = (ctx: Context, project: ProjectId, model: string, params: Record<string, unknown>) => ctx.dvProject.run({
    project, operation: 'audio.generate', actor: 'user', surface: 'api', session: null, turn: null, tool_call: null,
    intent: 'audio', inputs: [], params: { modality: 'audio', task: 't2a', provider: 'openrouter', model, prompt: 'Hello there', ...params } })

  it('registers configured speech models as t2a, refuses unlisted voices and extras before paying, and stores a WAV of an MP3 answer', async () => {
    const { ctx, requests, project } = await fixture({ speech: 'mp3' })
    const narrator = ctx.dvModels.list().find(entry => entry.task === 't2a' && entry.model === 'narrator')
    expect(narrator).toMatchObject({ modality: 'audio', provider: 'openrouter', displayName: 'Fixture Speech' })
    expect(await narrator?.schema()).toEqual({ extra: {
      voice: { type: 'string', values: ['alloy', 'nova'], required: true, description: 'The voice that speaks the text.' },
      instructions: { type: 'string', description: expect.stringContaining('How to deliver the text') as unknown },
    } })
    await expect(speak(ctx, project.id, 'narrator', {})).rejects.toThrow('Choose extra.voice from alloy, nova.')
    await expect(speak(ctx, project.id, 'narrator', { extra: { voice: 'echo' } })).rejects.toThrow('Choose extra.voice from alloy, nova.')
    await expect(speak(ctx, project.id, 'narrator', { extra: { voice: 'nova', speed: 2 } })).rejects.toThrow('takes no extra parameter speed')
    expect(requests.filter(request => request.path === '/api/v1/audio/speech')).toHaveLength(0)
    const result = await speak(ctx, project.id, 'narrator', { extra: { voice: 'nova', instructions: 'Warm and slow.' } })
    expect(result.record?.status).toBe('done')
    const [output] = result.record?.outputs ?? []
    if (output === undefined) throw new Error('Missing audio output')
    expect(ctx.dvAssetPool.get(output)).toMatchObject({ mime: 'audio/wav' })
    expect(readFileSync(ctx.dvAssetPool.path(output)).subarray(0, 4).toString()).toBe('RIFF')
    const duration = result.record?.report?.['duration_sec']
    expect(typeof duration === 'number' && Math.abs(duration - 1) < 0.1).toBe(true)
    expect(result.record?.report).toMatchObject({ model_id: 'fixture/speech' })
    expect(requests.filter(request => request.path === '/api/v1/audio/speech').map(request => request.body)).toEqual([{
      model: 'fixture/speech', input: 'Hello there', response_format: 'mp3', voice: 'nova', instructions: 'Warm and slow.' }])
    await [...ctx.loader.entries()].find(row => row.options.id === 'provider')?.fiber?.dispose()
    expect(ctx.dvModels.list()).toEqual([])
  })

  it('reads a raw PCM answer as 24 kHz mono and lets a model without listed voices use the provider default', async () => {
    const { ctx, requests, project } = await fixture({ speech: 'pcm' })
    const result = await speak(ctx, project.id, 'cloner', {})
    expect(result.record?.status).toBe('done')
    expect(result.record?.report).toMatchObject({ model_id: 'heygen/fixture-voice', duration_sec: 0.5 })
    expect(requests.filter(request => request.path === '/api/v1/audio/speech').map(request => request.body)).toEqual([{
      model: 'heygen/fixture-voice', input: 'Hello there', response_format: 'pcm' }])
  })
})
