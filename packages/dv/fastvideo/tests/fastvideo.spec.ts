/**
 * The FastVideo provider plugin in a REAL composition: a test-only `cordis.yml` boots the DSH skill registry, Project,
 * ffmpeg, the asset pool, the model catalog and the plugin through the Loader. The FastVideo servers are the only fakes:
 * one HTTP server per task that answers `GET /v1/model_info` and answers every `POST /v1/videos/sync` with one MP4. An
 * opt-in test renders an image, a video with sound and an audio file against a running server named by
 * `DV_FASTVIDEO_TEST_URL`, with the facts of `REAL_FACTS` and the served alias named by `DV_FASTVIDEO_TEST_MODEL`.
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
import type { ModelFactsConfig } from '@dv/fastvideo-generation-client'
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
const REAL_MODEL = process.env['DV_FASTVIDEO_TEST_MODEL'] ?? 'fasth3'

/** The ffmpeg binary that makes the sample videos whose sound ffprobe reads. */
const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const run = promisify(execFile)

/** A port in the owned test range on which nothing listens until a test starts a server on it. */
const UNREACHABLE_PORT = 18503

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
 * The bytes of a one-second WAV tone.
 * @returns the WAV bytes.
 */
async function sampleAudio(): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-audio-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'tone.wav')
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path])
  return readFileSync(path)
}

/**
 * A one-second 64x64 MP4 that is red for its first half and blue for its second, so its last frame is blue.
 * @returns the MP4 bytes.
 */
async function redThenBlueVideo(): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-video-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'red-blue.mp4')
  const graph = 'color=c=red:s=64x64:d=0.5:r=8[a];color=c=blue:s=64x64:d=0.5:r=8[b];[a][b]concat=n=2:v=1[v]'
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-filter_complex', graph, '-map', '[v]', '-pix_fmt', 'yuv420p', path])
  return readFileSync(path)
}

/**
 * The facts of the fake reference server: 4 references, at most 3 images and 2 videos, and no audio. The server counts
 * the first frame among its references.
 */
const REFERENCE_FACTS: ModelFactsConfig = {
  modelId: 'fake-ref2va', frameSizes: { '16:9': { '720p': [1344, 768] } }, numFramesByDurationSec: { 5: 124, 6: 158 },
  maxReferences: 4, referenceMediaTypes: { image: { maxCount: 3 }, video: { maxCount: 2 } },
}

/** The facts of the opt-in running server: FastH3 Ref2VA, which takes images, videos and audio. */
const REAL_FACTS: ModelFactsConfig = {
  ...REFERENCE_FACTS, modelId: REAL_MODEL, maxReferences: 12,
  referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } },
}

/** The facts of the fake text server. */
const TEXT_FACTS: ModelFactsConfig = {
  modelId: 'fake-t2va', frameSizes: { '16:9': { '720p': [1344, 768] } }, numFramesByDurationSec: { 5: 124, 6: 158 },
  maxReferences: 0, referenceMediaTypes: {},
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** A running fake FastVideo server and the task config that names it. */
interface FakeServer {
  server: FastVideo.TaskServer
  /** The `POST /v1/videos/sync` request bodies. */
  requests: Record<string, unknown>[]
  /** Settles when a `POST /v1/videos/sync` arrives; the server then holds its answer until `release` is called. */
  held?: Promise<{ release: () => void; closed: Promise<void> }>
  /** The port the server listens on. */
  port: number
}

/**
 * Start a fake FastVideo server that answers `GET /v1/model_info` with the facts' alias and every
 * `POST /v1/videos/sync` with `video`.
 * @param facts - the facts of the served model.
 * @param options - `video` is the MP4 it answers with; `hold` holds each render answer until it is released; `failure`
 *   answers each render with that HTTP status and an OpenAI error envelope instead; `port` is the port to listen on.
 * @returns the task config of the server and the render request bodies.
 */
async function startFakeServer(facts: ModelFactsConfig, options: {
  video?: Buffer
  hold?: boolean
  failure?: { status: number; message: string }
  port?: number
} = {}): Promise<FakeServer> {
  const requests: Record<string, unknown>[] = []
  let arrived!: (value: { release: () => void; closed: Promise<void> }) => void
  const held = new Promise<{ release: () => void; closed: Promise<void> }>((resolve) => { arrived = resolve })
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
      response.end(JSON.stringify({ model_path: '/weights', served_model_name: facts.modelId, lora: null }))
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      const { failure } = options
      if (failure !== undefined) {
        response.writeHead(failure.status, { 'content-type': 'application/json', connection: 'close' })
        response.end(JSON.stringify({ error: { message: failure.message, type: 'server_error', param: null, code: failure.status } }))
        return
      }
      const answer = () => {
        response.writeHead(200, { 'content-type': 'video/mp4', 'x-inference-time-s': '0.4', 'x-stage-durations': '{"denoise": 0.3}', connection: 'close' })
        response.end(options.video ?? Buffer.from('VIDEO'))
      }
      if (options.hold !== true) answer()
      else arrived({ release: answer, closed: new Promise((resolve) => { response.once('close', () => { resolve() }) }) })
    })
  })
  server.listen(options.port ?? 0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const { port } = server.address() as AddressInfo
  return { server: { baseUrl: `http://127.0.0.1:${port}`, modelFacts: facts }, requests, port, ...options.hold === true ? { held } : {} }
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
async function start(tasks: { ref2v?: FastVideo.TaskServer; t2v?: FastVideo.TaskServer }): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-'))
  const globals = globalThis as typeof globalThis & { __dvFastVideo?: typeof PLUGINS }
  globals.__dvFastVideo = PLUGINS
  const config = [`models: ${JSON.stringify({ fasth3: tasks })}`]
  const rows: string[] = []
  const plugins = [
    ['skills', 'SkillRegistry', []],
    ['dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`]],
    ['dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, 'ffprobePath: ffprobe']],
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
  return { prompt: '<Picture 1> smiles', references, firstFrame, frameWidth: 1344, frameHeight: 768, numFrames: 124, seed: 7, extra }
}

/** The `data:` URL of one reference. */
function dataUrl(mime: string, bytes: string | Buffer): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

/** The PNG's top-left pixel as `[r, g, b]`, decoded by ffmpeg. */
async function firstPixel(png: Buffer): Promise<number[]> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-png-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'frame.png'), png)
  const { stdout } = await run(FFMPEG, ['-loglevel', 'error', '-i', join(dir, 'frame.png'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer' })
  return [...stdout.subarray(0, 3)]
}

describe('dv-fastvideo', () => {
  it('registers fasth3 once per configured task, each with the facts and schema of its own server', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_FACTS), startFakeServer(TEXT_FACTS)])
    const ctx = await start({ ref2v: reference.server, t2v: text.server })
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
    // The generation clients stay private to the plugin.
    expect(ctx.get('dvFastvideoGeneration')).toBeUndefined()
  })

  it('validates a request for each task against what the task declares and the limits of its own server', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_FACTS), startFakeServer(TEXT_FACTS)])
    const ctx = await start({ ref2v: reference.server, t2v: text.server })
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
    expect(await referenceTask.validateGenerationRequest(request([image], image))).toEqual([
      'Its prompt does not cite the first frame; write "@[first frame](dv:input/first_frame) is the first frame of [Shot 1]".',
    ])
    expect(await check(referenceTask, [], null)).toEqual(['Its reference input needs at least 1 of type image, video, audio; this shot has 0.'])
    expect(await check(referenceTask, [json], null)).toEqual([`Its reference input takes assets of type image, video, audio; asset ${json} is of type application.`])
    // The server lists no audio, so its audio limit is 0; the first frame takes one of the server's three references and two images.
    expect(await check(referenceTask, [audio], null)).toEqual([
      'Its reference input takes at most 0 of type audio; this shot has 1.',
      'Its audio references need at least one image or video reference or a first frame beside them; this shot has only audio.',
    ])
    expect(await check(referenceTask, [video, otherVideo, image, otherImage], null)).toEqual(['Its reference input takes at most 3 assets; this shot has 4.'])
    expect(await check(referenceTask, [image, otherImage, thirdImage], null)).toEqual(['Its reference input takes at most 2 of type image; this shot has 3.'])
    expect(await check(referenceTask, [image], video)).toEqual([`Its first_frame input takes assets of type image; asset ${video} is of type video.`])
    expect(await check(textTask, [], null)).toEqual([])
    expect(await check(textTask, [image], video)).toEqual(['It takes no reference input; this shot has 1.', 'It takes no first_frame input; this shot has 1.'])
  })

  it('refuses a shot whose only media are audio, because FastVideo pairs audio with an image or a video', async () => {
    const referenceMediaTypes = { ...REFERENCE_FACTS.referenceMediaTypes, audio: { maxCount: 2 } }
    const reference = await startFakeServer({ ...REFERENCE_FACTS, referenceMediaTypes })
    const ctx = await start({ ref2v: reference.server })
    const [audio, otherAudio] = [importAsset(ctx, Buffer.from('AUD1'), 'audio/mpeg'), importAsset(ctx, Buffer.from('AUD2'), 'audio/wav')]
    const [image, video] = [importAsset(ctx, Buffer.from('IMG1'), 'image/png'), importAsset(ctx, Buffer.from('VID1'), 'video/mp4')]
    const check = (references: AssetId[], firstFrame: AssetId | null) => fasth3(ctx, 'ref2v').validateGenerationRequest({
      ...request(references, firstFrame), prompt: firstFrame === null ? 'A song' : '@[first frame](dv:input/first_frame) sings',
    })
    const audioOnly = 'Its audio references need at least one image or video reference or a first frame beside them; this shot has only audio.'
    expect(await check([audio, otherAudio], null)).toEqual([audioOnly])
    expect(await check([audio], image)).toEqual([])
    expect(await check([audio, image], null)).toEqual([])
    expect(await check([video, audio], null)).toEqual([])
  })

  it('refuses extra parameters that the task does not take, after the input problems', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_FACTS), startFakeServer(TEXT_FACTS)])
    const ctx = await start({ ref2v: reference.server, t2v: text.server })
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    expect(await fasth3(ctx, 'ref2v').validateGenerationRequest(request([image], null, { cfg: 5, steps: 8 })))
      .toEqual(['fasth3 has no extra parameter `cfg`, `steps` for task ref2v; its extra parameters: none.'])
    expect(await fasth3(ctx, 't2v').validateGenerationRequest(request([image], null, { cfg: 5 }))).toEqual([
      'It takes no reference input; this shot has 1.', 'fasth3 has no extra parameter `cfg` for task t2v; its extra parameters: none.',
    ])
  })

  it.skipIf(!existsSync(FFMPEG))('sends each task to its own server with each reference as a data URL, the first frame after the reference images', async () => {
    const clip = await redThenBlueVideo()
    const [reference, text] = await Promise.all([
      startFakeServer(REFERENCE_FACTS, { video: clip }), startFakeServer(TEXT_FACTS, { video: clip }),
    ])
    const ctx = await start({ ref2v: reference.server, t2v: text.server })
    const silent = await sampleVideo(false)
    const video = importAsset(ctx, silent, 'video/mp4')
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const audio = importAsset(ctx, Buffer.from('AUD1'), 'audio/mpeg')
    const first = importAsset(ctx, Buffer.from('FIRST'), 'image/jpeg')
    const events = await collect(fasth3(ctx, 'ref2v').render(request([video, image, audio], first)))
    expect(reference.requests[0]).toEqual({
      model: 'fake-ref2va', prompt: '<Picture 1> smiles', width: 1344, height: 768, num_frames: 124, seed: 7,
      image_reference: [{ image_url: dataUrl('image/png', 'IMG1') }, { image_url: dataUrl('image/jpeg', 'FIRST') }],
      video_reference: [{ video_url: dataUrl('video/mp4', silent) }],
      audio_reference: [{ audio_url: dataUrl('audio/mpeg', 'AUD1') }],
    })
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    expect(events.slice(1)).toEqual([
      { kind: 'video_start', mime: 'video/mp4' }, { kind: 'chunk', bytes: clip }, { kind: 'done', timings: { inference_s: 0.4, denoise_s: 0.3 } },
    ])
    // ffmpeg read the final frame of the answered MP4: blue, after its red first half.
    const still = events[0]
    if (still?.kind !== 'last_frame') throw new Error('The render yielded no last frame first.')
    const [red, green, blue] = await firstPixel(still.png)
    expect({ red: (red ?? 255) < 40, green: (green ?? 255) < 40, blue: (blue ?? 0) > 200 }).toEqual({ red: true, green: true, blue: true })
    await collect(fasth3(ctx, 't2v').render(request([], null)))
    expect(text.requests).toEqual([{ model: 'fake-t2va', prompt: '<Picture 1> smiles', width: 1344, height: 768, num_frames: 124, seed: 7 }])
  })

  it.skipIf(!existsSync(FFMPEG))('labels image, video with sound and audio references in the order of the request lists', async () => {
    const clip = await redThenBlueVideo()
    const referenceMediaTypes = { image: { maxCount: 3 }, video: { maxCount: 2 }, audio: { maxCount: 2 } }
    const reference = await startFakeServer({ ...REFERENCE_FACTS, maxReferences: 6, referenceMediaTypes }, { video: clip })
    const ctx = await start({ ref2v: reference.server })
    const sound = await sampleVideo(true)
    const audio = importAsset(ctx, Buffer.from('SOUND'), 'audio/mpeg')
    const walk = importAsset(ctx, sound, 'video/mp4')
    const image = importAsset(ctx, Buffer.from('IMAGE'), 'image/jpeg')
    const prompt = `@[song](dv:asset/${audio}) behind @[walk](dv:asset/${walk}) with @[portrait](dv:asset/${image}) from @[first](dv:input/first_frame)`
    await collect(fasth3(ctx, 'ref2v').render({ ...request([audio, walk, image], image), prompt }))
    // The backend reads the images, then the video, whose sound is <Audio 1>, then the audio file.
    expect(reference.requests[0]).toMatchObject({
      prompt: '<Audio 2> behind <Video 1> with <Picture 1> from <Picture 2>',
      image_reference: [{ image_url: dataUrl('image/jpeg', 'IMAGE') }, { image_url: dataUrl('image/jpeg', 'IMAGE') }],
      video_reference: [{ video_url: dataUrl('video/mp4', sound) }],
      audio_reference: [{ audio_url: dataUrl('audio/mpeg', 'SOUND') }],
    })
  })

  it('rejects a render with the abort reason while the server generates, and closes the request', async () => {
    const reference = await startFakeServer(REFERENCE_FACTS, { hold: true })
    const ctx = await start({ ref2v: reference.server })
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const controller = new AbortController()
    const reason = new Error('Cancelled by user')
    const events: RenderStreamEvent[] = []
    const rendered = (async () => {
      for await (const event of fasth3(ctx, 'ref2v').render(request([image], null), controller.signal)) events.push(event)
    })()
    const result = expect(rendered).rejects.toBe(reason)
    const held = await reference.held
    controller.abort(reason)
    await result
    await held?.closed
    expect(events).toEqual([])
  })

  it.skipIf(!existsSync(FFMPEG))('replaces each citation of a reference with its label, counting each media type in order', async () => {
    const reference = await startFakeServer(REFERENCE_FACTS, { video: await redThenBlueVideo() })
    const ctx = await start({ ref2v: reference.server })
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
    // The sound of a video takes an audio number before every audio file; a silent video takes none.
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
    const reference = await startFakeServer(REFERENCE_FACTS)
    const ctx = await start({ ref2v: reference.server })
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

  it.each([
    ['no image slot for the first frame', { referenceMediaTypes: { video: { maxCount: 2 } } },
      'dv-fastvideo: fasth3 ref2v takes a first frame of type image, so modelFacts.referenceMediaTypes.image.maxCount must be at least 1.'],
    ['no reference slot', { maxReferences: 0, referenceMediaTypes: {} },
      'dv-fastvideo: fasth3 ref2v takes a first frame of type image, so modelFacts.referenceMediaTypes.image.maxCount must be at least 1.'],
    ['one reference slot', { maxReferences: 1, referenceMediaTypes: { image: { maxCount: 1 } } },
      'dv-fastvideo: fasth3 ref2v takes at least 1 reference and a first frame, so modelFacts.maxReferences must be at least 2; it is 1.'],
    ['a gap in the durations', { numFramesByDurationSec: { 5: 124, 7: 190 } },
      'FastVideo modelFacts of fake-ref2va: numFramesByDurationSec has a gap; it needs every duration from 5 to 7.'],
  ] as const)('refuses ref2v model facts with %s when the plugin is applied', async (_case, update, message) => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_FACTS), startFakeServer(TEXT_FACTS)])
    const ctx = await start({ t2v: text.server })
    const server = { ...reference.server, modelFacts: { ...REFERENCE_FACTS, ...update } }
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: { ref2v: server } } }) }).toThrow(message)
  })

  it.each([
    [400, 'MiniMax-H3 accepts at most 9 image references.', { name: 'GenerationSegmentError', message: 'MiniMax-H3 accepts at most 9 image references.' }],
    [500, 'Video generation failed: CUDA out of memory', { message: 'FastVideo POST /v1/videos/sync returned HTTP 500: Video generation failed: CUDA out of memory' }],
  ] as const)('rejects a render that the server answers with HTTP %s with the server message', async (status, message, error) => {
    const reference = await startFakeServer(REFERENCE_FACTS, { failure: { status, message } })
    const ctx = await start({ ref2v: reference.server })
    const events: RenderStreamEvent[] = []
    const failure: unknown = await (async () => {
      for await (const event of fasth3(ctx, 'ref2v').render(request([importAsset(ctx, Buffer.from('IMG1'), 'image/png')], null))) events.push(event)
    })().catch((cause: unknown) => cause)
    expect(failure).toMatchObject(error)
    expect(events).toEqual([])
  })

  it('rejects a render of a reference whose media type FastVideo does not take, without sending it', async () => {
    const reference = await startFakeServer(REFERENCE_FACTS)
    const ctx = await start({ ref2v: reference.server })
    const json = importAsset(ctx, Buffer.from('{}'), 'application/json')
    await expect(collect(fasth3(ctx, 'ref2v').render(request([json], null))))
      .rejects.toMatchObject({ name: 'GenerationSegmentError', message: 'FastVideo takes no reference of type application/json.' })
    expect(reference.requests).toEqual([])
  })

  it.skipIf(!existsSync(FFMPEG))('rejects a render with the abort reason when the abort comes while ffmpeg reads the last frame', async () => {
    const reference = await startFakeServer(REFERENCE_FACTS, { video: await redThenBlueVideo() })
    const ctx = await start({ ref2v: reference.server })
    const controller = new AbortController()
    const reason = new Error('Cancelled during the last frame')
    const ffmpeg = ctx.dvFfmpeg
    const runFfmpeg = ffmpeg.run.bind(ffmpeg)
    ffmpeg.run = async (...args) => {
      controller.abort(reason)
      return await runFfmpeg(...args)
    }
    const events: RenderStreamEvent[] = []
    const rendered = (async () => {
      for await (const event of fasth3(ctx, 'ref2v').render(request([importAsset(ctx, Buffer.from('IMG1'), 'image/png')], null), controller.signal)) events.push(event)
    })()
    await expect(rendered).rejects.toBe(reason)
    expect(reference.requests).toHaveLength(1)
    expect(events).toEqual([])
  })

  it('reports an unreachable server as unavailable through facts and schema, and serves both once the server answers', async () => {
    const baseUrl = `http://127.0.0.1:${UNREACHABLE_PORT}`
    const ctx = await start({ ref2v: { baseUrl, modelFacts: REFERENCE_FACTS } })
    const entry = fasth3(ctx, 'ref2v')
    await expect(entry.facts()).rejects.toThrow('fetch failed')
    await expect(entry.schema()).rejects.toThrow('fetch failed')
    expect((await ctx.dvModels.catalog()).map(item => item['schema'])).toEqual([null])
    await startFakeServer(REFERENCE_FACTS, { port: UNREACHABLE_PORT })
    expect(await entry.facts()).toMatchObject({ modelId: 'fake-ref2va', minDurationSec: 5, maxDurationSec: 6 })
    expect(await entry.schema()).toMatchObject({ duration_sec: { min: 5, max: 6 }, inputs: { reference: { max: 3 } } })
  })

  it('refuses a config that names a model or task it does not serve', async () => {
    const reference = await startFakeServer(REFERENCE_FACTS)
    const ctx = await start({ ref2v: reference.server })
    const { server } = reference
    expect(() => { FastVideo.apply(ctx, { models: { wan: { t2v: server } } }) }).toThrow('dv-fastvideo serves no model "wan"; it serves: fasth3.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: { reference: server } } }) })
      .toThrow('dv-fastvideo serves model "fasth3" for no task "reference"; its tasks: ref2v, t2v.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: {} } }) }).toThrow('dv-fastvideo: model "fasth3" names no task.')
    expect(ctx.dvModels.list().map(entry => entry.task)).toEqual(['ref2v'])
  })

  it.skipIf(REAL_BACKEND === undefined || !existsSync(REAL_REFERENCE) || !existsSync(FFMPEG))('renders a real five-second shot from an image, a video with sound and an audio file against the running server', async () => {
    const ctx = await start({ ref2v: { baseUrl: REAL_BACKEND as string, modelFacts: REAL_FACTS } })
    const facts = await fasth3(ctx, 'ref2v').facts()
    const [width, height] = facts.frameSizes[facts.aspectRatios[0] ?? '']?.[facts.resolutions[0] ?? ''] ?? [0, 0]
    const image = importAsset(ctx, readFileSync(REAL_REFERENCE), 'image/jpeg')
    const video = importAsset(ctx, await sampleVideo(true), 'video/mp4')
    const audio = importAsset(ctx, await sampleAudio(), 'audio/wav')
    const events = await collect(fasth3(ctx, 'ref2v').render({
      prompt: `@[the man](dv:asset/${image}) speaks to the camera in a bright office with the framing of @[the clip](dv:asset/${video}), `
        + `slow push-in, natural light, @[the tone](dv:asset/${audio}) playing softly.`,
      references: [image, video, audio], firstFrame: null, frameWidth: width, frameHeight: height,
      numFrames: facts.numFramesByDurationSec['5'] ?? 0, seed: 1, extra: {},
    }))
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['last_frame', 'video_start', 'chunk', 'done']))
  }, 600_000)
})
