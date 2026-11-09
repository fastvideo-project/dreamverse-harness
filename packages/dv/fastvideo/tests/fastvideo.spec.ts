/**
 * The FastVideo provider plugin in a REAL composition: a test-only `cordis.yml` boots the DSH skill registry, Project,
 * ffmpeg, the asset pool, the model catalog and the plugin through the Loader. The FastVideo streaming_v2 servers are
 * the only fakes: one HTTP server per task that answers the capabilities and health routes and streams fixed bytes for
 * every render. An opt-in test renders against a running server named by `DV_FASTVIDEO_TEST_URL`.
 */
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import DvAssetPool, { type AssetId } from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import type { ModelFacts } from '@dv/fastvideo-generation-client'
import DvModels, { type ModelEntry, type RenderStreamEvent, type TaskOfPrimitive } from '@dv/models'
import DvProject from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { provideChatServices } from '../../project/tests/workspaces.ts'
import * as FastVideo from '../src/index.ts'

/** A task of the video entries that fasth3 serves. */
type VideoTask = TaskOfPrimitive<'video'>

/** The reference image of the opt-in run against a running server. */
const REAL_REFERENCE = '/mnt/lustre/vlm-d1su/codes/dsh-dv-hub/elon-musk.jpg'
const REAL_BACKEND = process.env['DV_FASTVIDEO_TEST_URL']

/** The ffmpeg binary that makes the sample videos whose sound ffprobe reads. */
const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const run = promisify(execFile)

/**
 * The bytes of a one-second sample video.
 * @param sound - whether the video has a sound track.
 * @returns the MP4 bytes.
 */
async function sampleVideo(sound: boolean): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-video-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'sample.mp4')
  const audio = sound ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest'] : []
  const video = ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1:r=8']
  await run(FFMPEG, ['-y', '-loglevel', 'error', ...video, ...audio, '-pix_fmt', 'yuv420p', path])
  return readFileSync(path)
}

/**
 * The capabilities the fake reference server reports: 4 references, at most 3 images and 2 videos, and no audio. The
 * server counts the first frame among its references.
 */
const REFERENCE_CAPABILITIES = {
  model_id: 'fake-ref2va', name: 'Fake Ref2AV', min_segment_duration_sec: 5, max_segment_duration_sec: 6,
  max_references: 4, reference_media_types: { image: { max_count: 3 }, video: { max_count: 2 } }, max_reference_aspect_ratio: 4.0,
  frame_sizes: { '16:9': { '720p': [1344, 768] } }, num_frames_by_duration_sec: { 5: 124, 6: 158 },
}

/** The capabilities the fake text server reports. */
const TEXT_CAPABILITIES = {
  model_id: 'fake-t2va', name: 'Fake T2AV', min_segment_duration_sec: 5, max_segment_duration_sec: 6,
  max_references: 0, reference_media_types: {},
  frame_sizes: { '16:9': { '720p': [1344, 768] } }, num_frames_by_duration_sec: { 5: 124, 6: 158 },
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Start a fake streaming_v2 server that answers capabilities and health and streams fixed bytes for every render.
 * @param capabilities - the capabilities body it reports.
 * @returns the server URL and the render request bodies.
 */
async function startFakeServer(capabilities: object): Promise<{ url: string; requests: Record<string, unknown>[] }> {
  const requests: Record<string, unknown>[] = []
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
      response.end(JSON.stringify((request.url ?? '').endsWith('/health') ? { status: 'ready' } : capabilities))
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
      const events: Array<[string, object]> = [
        ['last_frame', { data: Buffer.from('LAST').toString('base64') }],
        ['video_start', { mime: 'video/mp4; codecs="avc1.64001f"' }],
        ['video_chunk', { data: Buffer.from('VIDEO').toString('base64') }],
        ['done', { timings: { total_s: 0.4 } }],
      ]
      for (const [event, data] of events) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SkillRegistry, DvProject, DvFfmpeg, DvAssetPool, DvModels,
  FastVideo: { name: FastVideo.name, inject: FastVideo.inject, Config: FastVideo.Config, apply: FastVideo.apply },
}

/**
 * Boot the skill registry, Project, ffmpeg, the asset pool, the catalog and the plugin from a test-only `cordis.yml`.
 * @param tasks - the server URL of each task of `fasth3` to configure.
 * @returns the root context.
 */
async function start(tasks: Partial<Record<VideoTask, string | FastVideo.TaskServer>>, model = 'fasth3'): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-'))
  const globals = globalThis as typeof globalThis & { __dvFastVideo?: typeof PLUGINS }
  globals.__dvFastVideo = PLUGINS
  const servers = Object.fromEntries(Object.entries(tasks).map(([task, server]) => [task,
    typeof server === 'string' ? { baseUrl: server } : server]))
  const config = [`models: ${JSON.stringify({ [model]: servers })}`]
  const rows: string[] = []
  const plugins = [
    ['skills', 'SkillRegistry', []],
    ['dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`]],
    ['dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe']],
    ['dv-asset-pool', 'DvAssetPool', []],
    ['dv-models', 'DvModels', []],
    ['dv-fastvideo', 'FastVideo', config],
  ] as const
  for (const [id, key, lines] of plugins) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvFastVideo.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...lines.length === 0 ? [] : ['  config:', ...lines.map(line => `    ${line}`)])
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const origin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'create' } as const
  await ctx.dvProject.createProject(await ctx.dvProject.newProjectFolder('render'), 'render', origin)
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return ctx
}

/** Whether a catalog entry serves a video task; narrows its facts, request and result to the video row. */
function isVideoEntry(entry: ModelEntry): entry is ModelEntry<VideoTask> {
  return entry.modality === 'video'
}

/** The registered `fasth3` entry for a task. */
function fasth3(ctx: Context, task: VideoTask): ModelEntry<VideoTask> {
  const entry = ctx.dvModels.get({ modality: 'video', task, provider: 'fastvideo', model: 'fasth3' })
  if (entry === undefined || !isVideoEntry(entry)) throw new Error(`fasth3 is not registered for task ${task}`)
  return entry
}

/** Collect a render stream. */
async function collect(stream: AsyncIterable<RenderStreamEvent>): Promise<RenderStreamEvent[]> {
  const events: RenderStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

/** Import bytes into the asset pool, in the folder of the fixture's project, under a MIME type. */
function importAsset(ctx: Context, bytes: Buffer, mime: string): AssetId {
  const [project] = ctx.dvProject.listProjects()
  if (project === undefined) throw new Error('The fixture has no project.')
  return ctx.dvAssetPool.importAsset(project.id, bytes, { mime, name: 'asset' }, null)
}

/** A render request with the given input assets and `extra` values. */
function request(references: AssetId[], firstFrame: AssetId | null, extra: Record<string, unknown> = {}) {
  return { prompt: '<Picture 1> smiles', references, firstFrame, lastFrame: null, frameWidth: 1344, frameHeight: 768, numFrames: 124, seed: 7, extra }
}

/** The wire form of one reference: its media type and its base64 bytes. */
function encodeWireReference(mediaType: string, bytes: string | Buffer) {
  return { media_type: mediaType, data: Buffer.from(bytes).toString('base64') }
}

describe('dv-fastvideo', () => {
  it('registers fasth3 once per configured task, each with the facts and schema of its own server', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_CAPABILITIES), startFakeServer(TEXT_CAPABILITIES)])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    expect(ctx.dvModels.list().filter(isVideoEntry).map(({ modality, task, provider, model }) =>
      ({ modality, task, provider, model }))).toEqual([
      { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3' },
      { modality: 'video', task: 't2v', provider: 'fastvideo', model: 'fasth3' },
    ])
    expect(fasth3(ctx, 'ref2v').description).toContain('Needs at least one reference.')
    expect(fasth3(ctx, 't2v').description).toContain('a face that must stay the same needs fasth3 for task ref2v')
    expect(await fasth3(ctx, 'ref2v').facts()).toEqual({
      modelId: 'fake-ref2va', aspectRatios: ['16:9'], resolutions: ['720p'], frameSizes: { '16:9': { '720p': [1344, 768] } },
      minDurationSec: 5, maxDurationSec: 6, numFramesByDurationSec: { 5: 124, 6: 158 },
    })
    expect(await fasth3(ctx, 't2v').facts()).toMatchObject({ modelId: 'fake-t2va' })
    // The first image frame takes one of the server's references and one of its images; audio the server does not accept.
    expect(await fasth3(ctx, 'ref2v').schema()).toEqual({
      duration_sec: { min: 5, max: 6 }, aspect_ratios: ['16:9'], resolutions: ['720p'],
      inputs: {
        reference: { min: 1, max: 3, media_types: { image: { max: 2 }, video: { max: 2 }, audio: { max: 0 } } },
        first_frame: { min: 0, max: 1, media_types: { image: {} } },
      },
      extra: {},
    })
    expect(await fasth3(ctx, 't2v').schema()).toEqual({
      duration_sec: { min: 5, max: 6 }, aspect_ratios: ['16:9'], resolutions: ['720p'], inputs: {}, extra: {},
    })
    // The streaming_v2 clients stay private to the plugin.
    expect(ctx.get('dvFastvideoGeneration')).toBeUndefined()
  })

  it('validates a request for each task against what the task declares and the limits of its own server', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_CAPABILITIES), startFakeServer(TEXT_CAPABILITIES)])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    const [referenceTask, textTask] = [fasth3(ctx, 'ref2v'), fasth3(ctx, 't2v')]
    const asset = (bytes: string, mime: string) => importAsset(ctx, Buffer.from(bytes), mime)
    const [video, otherVideo] = [asset('VID1', 'video/mp4'), asset('VID2', 'video/mp4')]
    const [image, otherImage, thirdImage] = [asset('IMG1', 'image/png'), asset('IMG2', 'image/png'), asset('IMG3', 'image/png')]
    const [audio, json] = [asset('AUD1', 'audio/mpeg'), asset('{}', 'application/json')]
    // A request with a first frame cites it, as the fasth3 prompt rule asks.
    const check = (entry: ModelEntry<VideoTask>, references: AssetId[], firstFrame: AssetId | null) => entry.validateGenerationRequest({
      ...request(references, firstFrame), prompt: firstFrame === null ? '<Picture 1> smiles' : '@[first frame](dv:input/first_frame) smiles',
    })
    expect(await check(referenceTask, [video, image], image)).toEqual([])
    expect(await referenceTask.validateGenerationRequest({ ...request([image], null), lastFrame: image }))
      .toEqual(['It takes no last_frame input; this shot has 1.'])
    expect(await referenceTask.validateGenerationRequest(request([image], image))).toEqual([
      'Its prompt does not cite the first frame; write "@[first frame](dv:input/first_frame) is the first frame of [Shot 1]".',
    ])
    expect(await check(referenceTask, [], null)).toEqual(['Its reference input needs at least 1 of type image, video, audio; this shot has 0.'])
    expect(await check(referenceTask, [json], null)).toEqual([`Its reference input takes assets of type image, video, audio; asset ${json} is of type application.`])
    // The server lists no audio, so its audio limit is 0; the first frame takes one of the server's three references and two images.
    expect(await check(referenceTask, [audio], null)).toEqual(['Its reference input takes at most 0 of type audio; this shot has 1.'])
    expect(await check(referenceTask, [video, otherVideo, image, otherImage], null)).toEqual(['Its reference input takes at most 3 assets; this shot has 4.'])
    expect(await check(referenceTask, [image, otherImage, thirdImage], null)).toEqual(['Its reference input takes at most 2 of type image; this shot has 3.'])
    expect(await check(referenceTask, [image], video)).toEqual([`Its first_frame input takes assets of type image; asset ${video} is of type video.`])
    expect(await check(textTask, [], null)).toEqual([])
    expect(await check(textTask, [image], video)).toEqual(['It takes no reference input; this shot has 1.', 'It takes no first_frame input; this shot has 1.'])
  })

  it('refuses extra parameters that the task does not take, after the input problems', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_CAPABILITIES), startFakeServer(TEXT_CAPABILITIES)])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    expect(await fasth3(ctx, 'ref2v').validateGenerationRequest(request([image], null, { cfg: 5, steps: 8 })))
      .toEqual(['fasth3 has no extra parameter `cfg`, `steps` for task ref2v; its extra parameters: none.'])
    expect(await fasth3(ctx, 't2v').validateGenerationRequest(request([image], null, { cfg: 5 }))).toEqual([
      'It takes no reference input; this shot has 1.', 'fasth3 has no extra parameter `cfg` for task t2v; its extra parameters: none.',
    ])
  })

  it.skipIf(!existsSync(FFMPEG))('sends each task to its own server: the references with media types, then the first frame', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_CAPABILITIES), startFakeServer(TEXT_CAPABILITIES)])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    const silent = await sampleVideo(false)
    const video = importAsset(ctx, silent, 'video/mp4')
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const audio = importAsset(ctx, Buffer.from('AUD1'), 'audio/mpeg')
    const first = importAsset(ctx, Buffer.from('FIRST'), 'image/png')
    const events = await collect(fasth3(ctx, 'ref2v').render(request([video, image, audio], first)))
    expect(reference.requests[0]).toEqual({
      prompt: '<Picture 1> smiles', width: 1344, height: 768, num_frames: 124, seed: 7, return_last_frame: true,
      references: [
        encodeWireReference('video', silent), encodeWireReference('image', 'IMG1'), encodeWireReference('audio', 'AUD1'),
        encodeWireReference('image', 'FIRST'),
      ],
    })
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    expect(events[2]).toEqual({ kind: 'chunk', bytes: Buffer.from('VIDEO') })
    await collect(fasth3(ctx, 'ref2v').render(request([video], null), new AbortController().signal))
    expect(reference.requests[1]?.['references']).toEqual([encodeWireReference('video', silent)])
    await collect(fasth3(ctx, 't2v').render(request([], null)))
    expect(text.requests).toHaveLength(1)
    expect(text.requests[0]?.['references']).toEqual([])
  })

  it.skipIf(!existsSync(FFMPEG))('replaces each citation of a reference with its label, counting each media type in order', async () => {
    const reference = await startFakeServer(REFERENCE_CAPABILITIES)
    const ctx = await start({ ref2v: reference.url })
    const video = importAsset(ctx, await sampleVideo(true), 'video/mp4')
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const other = importAsset(ctx, Buffer.from('IMG2'), 'image/png')
    const audio = importAsset(ctx, Buffer.from('AUD1'), 'audio/mpeg')
    // A citation of an asset outside the references, or of anything other than an asset, becomes its label.
    const prompt = `@[Mia](dv:asset/${other}) meets @[Bo](dv:asset/${image}) and @[Mia](dv:asset/${other}) in @[the walk](dv:asset/${video}), `
      + `to @[the song](dv:asset/${audio}), @[a cat](dv:asset/missing) and @[the lake](dv:element/e1@2)`
    const firstFrame = '@[first frame](dv:input/first_frame)'
    await collect(fasth3(ctx, 'ref2v').render({ ...request([video, image, other, audio], null), prompt: `${prompt} from ${firstFrame}` }))
    expect(reference.requests[0]?.['prompt'])
      .toBe('<Picture 2> meets <Picture 1> and <Picture 2> in <Video 1>, to <Audio 2>, a cat and the lake from first frame')
    // The sound of a video takes the audio number before the audio files after it; a silent video takes none.
    const silent = importAsset(ctx, await sampleVideo(false), 'video/mp4')
    const song = `@[the walk](dv:asset/${silent}) to @[the song](dv:asset/${audio})`
    await collect(fasth3(ctx, 'ref2v').render({ ...request([silent, audio], null), prompt: song }))
    expect(reference.requests[1]?.['prompt']).toBe('<Video 1> to <Audio 1>')
    // The first frame is the image after the reference images, even when it is also one of them.
    const continued = `@[Bo](dv:asset/${image}) from ${firstFrame}`
    await collect(fasth3(ctx, 'ref2v').render({ ...request([video, image, other], image), prompt: continued }))
    expect(reference.requests[2]?.['prompt']).toBe('<Picture 1> from <Picture 3>')
  })

  it('registers only the configured tasks and their prompt skills, and removes them on disposal', async () => {
    const reference = await startFakeServer(REFERENCE_CAPABILITIES)
    const ctx = await start({ ref2v: reference.url })
    expect(ctx.dvModels.list().map(entry => entry.task)).toEqual(['ref2v'])
    const skill = await ctx.skills.get('fasth3-reference-prompting')
    expect(skill?.description).toContain('model fasth3 for task ref2v')
    expect(skill?.content).toContain('Every shot needs at least one reference.')
    expect(await ctx.skills.get('fasth3-text-prompting')).toBeUndefined()
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-fastvideo.mjs'))
    await entry?.fiber?.dispose()
    expect(await ctx.skills.get('fasth3-reference-prompting')).toBeUndefined()
    expect(ctx.dvModels.list()).toEqual([])
  })

  it('refuses a config that names a model or task it does not serve', async () => {
    const reference = await startFakeServer(REFERENCE_CAPABILITIES)
    const ctx = await start({ ref2v: reference.url })
    const server = { baseUrl: reference.url }
    expect(() => { FastVideo.apply(ctx, { models: { wan: { t2v: server } } }) }).toThrow('dv-fastvideo serves no model "wan"; it serves: fasth3, pika-h3-flex.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: { reference: server } } }) })
      .toThrow('dv-fastvideo serves model "fasth3" for no task "reference"; its tasks: ref2v, t2v.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: {} } }) }).toThrow('dv-fastvideo: model "fasth3" names no task.')
    expect(ctx.dvModels.list().map(entry => entry.task)).toEqual(['ref2v'])
  })

  it.skipIf(!existsSync(FFMPEG))('maps Pika endpoints to native fl2va in first/last order and preserves text mode', async () => {
    const video = await sampleVideo(false)
    const requests: Record<string, unknown>[] = []
    const server = createServer((incoming, response) => {
      if (incoming.url === '/v1/model_info') {
        response.end(JSON.stringify({ served_model_name: 'pika-test' }))
        return
      }
      const parts: Buffer[] = []
      incoming.on('data', (part: Buffer) => { parts.push(part) })
      incoming.once('end', () => {
        requests.push(JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'video/mp4' })
        response.end(video)
      })
    })
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const facts: ModelFacts = {
      modelId: 'pika-test', aspectRatios: ['16:9'], resolutions: ['480p'], minSegmentDurationSec: 5, maxSegmentDurationSec: 5,
      maxReferences: 2, referenceMediaTypes: { image: { maxCount: 2 } }, frameSizes: { '16:9': { '480p': [832, 480] } }, numFramesByDurationSec: { 5: 124 },
    }
    const config = { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, openai: { modelFacts: facts, ffmpegPath: FFMPEG } }
    const referenceConfig = { ...config, openai: { ...config.openai, modelFacts: { ...facts, maxReferences: 12,
      referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } } } } }
    const ctx = await start({ fl2v: config, t2v: config, i2v: config, l2v: config, ref2v: referenceConfig }, 'pika-h3-flex')
    const entry = ctx.dvModels.list().filter(isVideoEntry).find(item => item.task === 'fl2v')!
    const text = ctx.dvModels.list().filter(isVideoEntry).find(item => item.task === 't2v')!
    const first = importAsset(ctx, Buffer.from('FIRST'), 'image/png')
    const last = importAsset(ctx, Buffer.from('LAST'), 'image/jpeg')
    const audio = importAsset(ctx, Buffer.from('SOUND'), 'audio/mpeg')
    const render = { ...request([], first), lastFrame: last, prompt: '@[start](dv:input/first_frame) to @[end](dv:input/last_frame)' }
    expect(await entry.schema()).toMatchObject({ inputs: {
      first_frame: { min: 1, max: 1, media_types: { image: {} } }, last_frame: { min: 1, max: 1, media_types: { image: {} } },
    } })
    expect(await entry.validateGenerationRequest(render)).toEqual([])
    const limited = await start({ fl2v: { ...config, openai: { ...config.openai, modelFacts: { ...facts, maxReferences: 1 } } } }, 'pika-h3-flex')
    const limitedEntry = limited.dvModels.list().filter(isVideoEntry)[0]!
    const limitedFirst = importAsset(limited, Buffer.from('FIRST'), 'image/png')
    const limitedLast = importAsset(limited, Buffer.from('LAST'), 'image/png')
    expect(await limitedEntry.validateGenerationRequest({ ...render, firstFrame: limitedFirst, lastFrame: limitedLast }))
      .toContain('The server accepts fewer keyframe images than this shot needs.')
    expect(await entry.validateGenerationRequest({ ...render, firstFrame: null })).toContain('Its first_frame input needs at least 1 of type image; this shot has 0.')
    expect(await entry.validateGenerationRequest({ ...render, lastFrame: null })).toContain('Its last_frame input needs at least 1 of type image; this shot has 0.')
    expect(await entry.validateGenerationRequest({ ...render, lastFrame: audio })).toContain(`Its last_frame input takes assets of type image; asset ${audio} is of type audio.`)
    expect(await entry.validateGenerationRequest({ ...render, references: [first] })).toContain('It takes no reference input; this shot has 1.')
    await collect(entry.render(render))
    expect(requests[0]).toMatchObject({ task: 'fl2va', prompt: '<Picture 1> to <Picture 2>', image_reference: [
      { image_url: `data:image/png;base64,${Buffer.from('FIRST').toString('base64')}` },
      { image_url: `data:image/jpeg;base64,${Buffer.from('LAST').toString('base64')}` },
    ] })
    await collect(text.render(request([], null)))
    expect(requests[1]).toMatchObject({ task: 't2va' })
    expect(requests[1]).not.toHaveProperty('image_reference')
    const entries = ctx.dvModels.list().filter(isVideoEntry)
    const imageEntry = entries.find(item => item.task === 'i2v')!
    const lastEntry = entries.find(item => item.task === 'l2v')!
    const referenceEntry = entries.find(item => item.task === 'ref2v')!
    expect(await imageEntry.validateGenerationRequest(request([], first))).toEqual([])
    expect(await lastEntry.validateGenerationRequest({ ...request([], null), lastFrame: last })).toEqual([])
    await collect(imageEntry.render(request([], first)))
    await collect(lastEntry.render({ ...request([], null), lastFrame: last }))
    expect(requests[2]).toMatchObject({ task: 'i2va', image_reference: [{ image_url: `data:image/png;base64,${Buffer.from('FIRST').toString('base64')}` }] })
    expect(requests[3]).toMatchObject({ task: 'l2va', image_reference: [{ image_url: `data:image/jpeg;base64,${Buffer.from('LAST').toString('base64')}` }] })
    expect(await referenceEntry.schema()).toMatchObject({ inputs: {
      reference: { min: 1, max: 12, media_types: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } } },
    } })
    expect(await referenceEntry.validateGenerationRequest(request([first, audio], null))).toEqual([])
    expect(await referenceEntry.validateGenerationRequest(request([audio], null)))
      .toContain('Its reference input needs at least one image or video; audio alone is insufficient.')
    expect(await referenceEntry.validateGenerationRequest(request([first], first)))
      .toContain('It takes no first_frame input; this shot has 1.')
    await collect(referenceEntry.render(request([first, audio], null)))
    expect(requests[4]).toMatchObject({ task: 'ref2va', image_reference: [{ image_url: `data:image/png;base64,${Buffer.from('FIRST').toString('base64')}` }] })

    expect(await text.validateGenerationRequest(render)).toContain('It takes no last_frame input; this shot has 1.')
    expect(() => { FastVideo.apply(ctx, { models: { 'pika-h3-flex': { fl2v: { baseUrl: config.baseUrl } } } }) }).toThrow('requires the OpenAI transport')
    const mounted = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'dv-fastvideo')
    await mounted?.fiber?.dispose()
    expect(ctx.dvModels.list()).toEqual([])
  })

  it.skipIf(!existsSync(FFMPEG))('renders through the OpenAI API and numbers references in the backend media order', async () => {
    const video = await sampleVideo(true)
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const server = createServer((incoming, response) => {
      if (incoming.method === 'GET') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ served_model_name: 'fake-openai-ref2va' }))
        return
      }
      const parts: Buffer[] = []
      incoming.on('data', (part: Buffer) => { parts.push(part) })
      incoming.once('end', () => {
        requests.push({ path: incoming.url ?? '', body: JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown> })
        response.writeHead(200, { 'content-type': 'video/mp4', 'x-inference-time-s': '1.5' })
        response.end(video)
      })
    })
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const facts: ModelFacts = {
      modelId: 'fake-openai-ref2va', aspectRatios: ['16:9'], resolutions: ['480p'],
      minSegmentDurationSec: 5, maxSegmentDurationSec: 5, maxReferences: 12,
      referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } },
      frameSizes: { '16:9': { '480p': [832, 480] } }, numFramesByDurationSec: { 5: 124 },
    }
    const ctx = await start({ ref2v: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      openai: { modelFacts: facts, ffmpegPath: FFMPEG },
    } })
    const entry = fasth3(ctx, 'ref2v')
    expect(await entry.facts()).toMatchObject({ modelId: 'fake-openai-ref2va', numFramesByDurationSec: { 5: 124 } })
    expect(await entry.schema()).toMatchObject({ duration_sec: { min: 5, max: 5 }, resolutions: ['480p'] })
    const audio = importAsset(ctx, Buffer.from('SOUND'), 'audio/mpeg')
    const clip = importAsset(ctx, video, 'video/mp4')
    const image = importAsset(ctx, Buffer.from('IMAGE'), 'image/jpeg')
    const prompt = `@[song](dv:asset/${audio}) behind @[clip](dv:asset/${clip}) with @[portrait](dv:asset/${image}) from @[first](dv:input/first_frame)`
    const events = await collect(entry.render({ ...request([audio, clip, image], image), prompt, frameWidth: 832, frameHeight: 480 }))
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    expect(requests[0]?.path).toBe('/v1/videos/sync')
    expect(requests[0]?.body).toMatchObject({
      model: 'fake-openai-ref2va', width: 832, height: 480, num_frames: 124,
      prompt: '<Audio 2> behind <Video 1> with <Picture 1> from <Picture 2>',
      image_reference: [
        { image_url: `data:image/jpeg;base64,${Buffer.from('IMAGE').toString('base64')}` },
        { image_url: `data:image/jpeg;base64,${Buffer.from('IMAGE').toString('base64')}` },
      ],
      audio_reference: [{ audio_url: `data:audio/mpeg;base64,${Buffer.from('SOUND').toString('base64')}` }],
    })
    expect(events[3]).toEqual({ kind: 'done', timings: { inference_s: 1.5 } })
    const mounted = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'dv-fastvideo')
    await mounted?.fiber?.dispose()
    expect(ctx.dvModels.list()).toEqual([])
  })

  it.skipIf(REAL_BACKEND === undefined || !existsSync(REAL_REFERENCE))('renders a real five-second shot against the running server', async () => {
    const ctx = await start({ ref2v: REAL_BACKEND as string })
    const facts = await fasth3(ctx, 'ref2v').facts()
    const [width, height] = facts.frameSizes[facts.aspectRatios[0] ?? '']?.[facts.resolutions[0] ?? ''] ?? [0, 0]
    const events = await collect(fasth3(ctx, 'ref2v').render({
      prompt: '<Picture 1> is a man speaking to the camera in a bright office, slow push-in, natural light.',
      references: [importAsset(ctx, readFileSync(REAL_REFERENCE), 'image/jpeg')], firstFrame: null, lastFrame: null, frameWidth: width, frameHeight: height,
      numFrames: facts.numFramesByDurationSec['5'] ?? 0, seed: 1, extra: {},
    }))
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['last_frame', 'video_start', 'chunk', 'done']))
  }, 600_000)
})
