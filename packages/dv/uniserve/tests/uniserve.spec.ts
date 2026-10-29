/**
 * The UniServe provider plugin in a REAL composition: a test-only `cordis.yml` boots the DSH skill registry, Project,
 * ffmpeg, the asset pool, the model catalog and the plugin through the Loader. The UniServe server is the only fake: an
 * HTTP server that answers `GET /v1/capabilities` with the fields of a running FastH3 Omni server and every
 * `POST /v1/videos/sync` with a real MP4 and the timing headers of a running server. An opt-in test renders against a
 * running server named by `DV_UNISERVE_TEST_URL`.
 */
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http'
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
import DvModels, { type ModelEntry, type RenderRequest, type RenderStreamEvent, type TaskOfPrimitive } from '@dv/models'
import DvProject from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { provideChatServices } from '../../project/tests/workspaces.ts'
import * as Uniserve from '../src/index.ts'

/** The reference image of the opt-in run against a running server. */
const REAL_REFERENCE = '/mnt/lustre/vlm-d1su/codes/dsh-dv-hub/vh-run/backend-omni-ref2va/smoke/reference.png'
const REAL_SERVER = process.env['DV_UNISERVE_TEST_URL']

/** The media binaries: ffmpeg makes the sample videos and reads the last frame, ffprobe reads the sound of a video. */
const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-8.1.2/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-8.1.2/bin/ffprobe'
const HAS_FFMPEG = existsSync(FFMPEG) && existsSync(FFPROBE)
const run = promisify(execFile)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * The capabilities of a FastH3 Omni server, as `GET /v1/capabilities` answers them, cut to 4 and 5 seconds and to two
 * canvases of the 768 short edge and one of the 480 short edge.
 */
const CAPABILITIES = {
  model: 'FastH3-Omni',
  video: {
    tasks: ['ref2va'],
    task_conditions: {
      ref2va: {
        max_images: 9, max_videos: 3, max_audios: 3, max_references: 12, keyframe_frame_indices: [[], [0], [-1], [0, -1]],
        reference_image_short_edge: 2048, enlarge_references: false,
      },
    },
    canvas: {
      short_edges: [768, 480], multiple: 32, max_pixels: 1032192, aspect_ratios: ['16:9', '9:16'],
      sizes: {
        768: { '16:9': { width: 1344, height: 768 }, '9:16': { width: 768, height: 1344 } },
        480: { '16:9': { width: 832, height: 480 }, '9:16': { width: 480, height: 832 } },
      },
    },
    fps: 24, audio_sample_rate: 32000, frames: { min_frames: 22, clip_frames: 17, clip_latent_frames: 5, tail_latent_frames: 2 },
    min_seconds: 4.0, max_seconds: 5.0, model_max_seconds: 15.0,
    request_fields: ['model', 'prompt', 'task', 'conditions', 'target', 'seed'],
  },
}

/** The timing headers of a running server's video answer. */
const TIMING_HEADERS = {
  'server-timing': 'generation;dur=6311.5',
  'x-inference-time-s': '6.282',
  'x-stage-durations': '{"decoding":0.565,"denoising":4.854,"encoding":0.226,"finalizing":0.094,"preparing":0.543}',
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * The bytes of a one-second sample video.
 * @param sound - whether the video has a sound track.
 * @returns the MP4 bytes.
 */
async function sampleVideo(sound: boolean): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-uniserve-video-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'sample.mp4')
  const audio = sound ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest'] : []
  const video = ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1:r=8']
  await run(FFMPEG, ['-y', '-loglevel', 'error', ...video, ...audio, '-pix_fmt', 'yuv420p', path])
  return readFileSync(path)
}

/** One answer of the fake server: its status, headers and body. */
interface FakeAnswer { status: number; headers: OutgoingHttpHeaders; body: string | Buffer }

/** A fake UniServe server and what it received. */
interface FakeServer {
  url: string
  capabilities: FakeAnswer
  video: FakeAnswer
  /** Method and path of every request. */
  routes: string[]
  /** The JSON bodies of the video requests. */
  renders: Record<string, unknown>[]
}

/**
 * Start a fake UniServe server.
 * @param video - the MP4 bytes it answers every video request with.
 * @returns the server, which answers with `CAPABILITIES` and `video` until a test changes its answers.
 */
async function startFakeServer(video: Buffer): Promise<FakeServer> {
  const fake: FakeServer = {
    url: '',
    capabilities: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(CAPABILITIES) },
    video: { status: 200, headers: { 'content-type': 'video/mp4', ...TIMING_HEADERS }, body: video },
    routes: [],
    renders: [],
  }
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      fake.routes.push(`${String(request.method)} ${String(request.url)}`)
      const render = request.method === 'POST'
      if (render) fake.renders.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      const answer = render ? fake.video : fake.capabilities
      response.writeHead(answer.status, { ...answer.headers, connection: 'close' })
      response.end(answer.body)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  fake.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  return fake
}

/** A URL on which nothing listens. */
async function closedUrl(): Promise<string> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  await new Promise(resolve => server.close(resolve))
  return `http://127.0.0.1:${String(port)}`
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SkillRegistry, DvProject, DvFfmpeg, DvAssetPool, DvModels,
  Uniserve: { name: Uniserve.name, inject: Uniserve.inject, Config: Uniserve.Config, apply: Uniserve.apply },
}

/**
 * Boot the skill registry, Project, ffmpeg, the asset pool, the catalog and the plugin from a test-only `cordis.yml`.
 * @param baseUrl - the server of `fasth3` for task `ref2v`.
 * @returns the root context.
 */
async function start(baseUrl: string): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-uniserve-'))
  const globals = globalThis as typeof globalThis & { __dvUniserve?: typeof PLUGINS }
  globals.__dvUniserve = PLUGINS
  const rows: string[] = []
  const plugins = [
    ['skills', 'SkillRegistry', []],
    ['dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`]],
    ['dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, `ffprobePath: ${FFPROBE}`]],
    ['dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`]],
    ['dv-models', 'DvModels', []],
    ['dv-uniserve', 'Uniserve', [`baseUrl: ${baseUrl}`]],
  ] as const
  for (const [id, key, lines] of plugins) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvUniserve.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...lines.length === 0 ? [] : ['  config:', ...lines.map(line => `    ${line}`)])
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return ctx
}

/** Whether a catalog entry serves a video task; narrows its facts, request and result to the video row. */
function isVideoEntry(entry: ModelEntry): entry is ModelEntry<TaskOfPrimitive<'video'>> {
  return entry.modality === 'video'
}

/** The registered `fasth3` entry for task `ref2v`. */
function fasth3(ctx: Context): ModelEntry<TaskOfPrimitive<'video'>> {
  const entry = ctx.dvModels.get({ modality: 'video', task: 'ref2v', provider: 'uniserve', model: 'fasth3' })
  if (entry === undefined || !isVideoEntry(entry)) throw new Error('fasth3 is not registered for task ref2v')
  return entry
}

/** Collect a render stream. */
async function collect(stream: AsyncIterable<RenderStreamEvent>): Promise<RenderStreamEvent[]> {
  const events: RenderStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

/** Import bytes into the asset pool under a MIME type. */
function importAsset(ctx: Context, bytes: Buffer, mime: string): AssetId {
  return ctx.dvAssetPool.importAsset(bytes, { mime, name: 'asset' }, null)
}

/** A five-second 16:9 768p render request with the given input assets and `extra` values. */
function request(references: AssetId[], firstFrame: AssetId | null, extra: Record<string, unknown> = {}): RenderRequest {
  return { prompt: '<Picture 1> smiles', references, firstFrame, frameWidth: 1344, frameHeight: 768, numFrames: 124, seed: 7, extra }
}

/** The `data:` URI of bytes under a MIME type. */
function dataUri(mime: string, bytes: string | Buffer): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

describe.skipIf(!HAS_FFMPEG)('dv-uniserve', () => {
  it('registers fasth3 for task ref2v with the facts and schema of its server, read once', async () => {
    const fake = await startFakeServer(await sampleVideo(false))
    const ctx = await start(fake.url)
    expect(ctx.dvModels.list().filter(isVideoEntry).map(({ modality, task, provider, model }) =>
      ({ modality, task, provider, model }))).toEqual([
      { modality: 'video', task: 'ref2v', provider: 'uniserve', model: 'fasth3' },
    ])
    expect(fasth3(ctx).description).toMatch(/^MiniMax H3 served as FastH3 Omni 8-Step V1 on UniServe: video with sound/)
    expect(fasth3(ctx).description).toMatch(/Needs at least one reference\.$/)
    expect(await fasth3(ctx).facts()).toEqual({
      modelId: 'FastH3-Omni', aspectRatios: ['16:9', '9:16'], resolutions: ['768p', '480p'],
      frameSizes: { '16:9': { '768p': [1344, 768], '480p': [832, 480] }, '9:16': { '768p': [768, 1344], '480p': [480, 832] } },
      minDurationSec: 4, maxDurationSec: 5, numFramesByDurationSec: { 4: 107, 5: 124 },
    })
    // The first frame takes one of the server's twelve references and one of its nine images.
    expect(await fasth3(ctx).schema()).toEqual({
      duration_sec: { min: 4, max: 5 }, aspect_ratios: ['16:9', '9:16'], resolutions: ['768p', '480p'],
      inputs: {
        reference: { min: 1, max: 11, media_types: { image: { max: 8 }, video: { max: 3 }, audio: { max: 3 } } },
        first_frame: { min: 0, max: 1, media_types: { image: {} } },
      },
      extra: {},
    })
    expect(fake.routes).toEqual(['GET /v1/capabilities'])
  })

  it('validates a request against the fasth3 inputs, the server limits, extra and the first-frame prompt rule', async () => {
    const fake = await startFakeServer(await sampleVideo(false))
    const ctx = await start(fake.url)
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const json = importAsset(ctx, Buffer.from('{}'), 'application/json')
    const audios = ['AUD1', 'AUD2', 'AUD3', 'AUD4'].map(bytes => importAsset(ctx, Buffer.from(bytes), 'audio/mpeg'))
    const entry = fasth3(ctx)
    expect(await entry.validateGenerationRequest({ ...request([image], image), prompt: '@[first frame](dv:input/first_frame) smiles' })).toEqual([])
    expect(await entry.validateGenerationRequest(request([], null))).toEqual(['Its reference input needs at least 1 of type image, video, audio; this shot has 0.'])
    expect(await entry.validateGenerationRequest(request([json], null))).toEqual([`Its reference input takes assets of type image, video, audio; asset ${json} is of type application.`])
    expect(await entry.validateGenerationRequest(request(audios, null))).toEqual(['Its reference input takes at most 3 of type audio; this shot has 4.'])
    expect(await entry.validateGenerationRequest(request([image], image, { steps: 8 }))).toEqual([
      'Its prompt does not cite the first frame; write "@[first frame](dv:input/first_frame) is the first frame of [Shot 1]".',
      'fasth3 has no extra parameter `steps` for task ref2v; its extra parameters: none.',
    ])
    const images = Array.from({ length: 9 }, (_, index) => importAsset(ctx, Buffer.from(`IMG-${String(index)}`), 'image/png'))
    expect(await entry.validateGenerationRequest(request([...images, ...audios.slice(0, 3)], null))).toEqual([
      'Its reference input takes at most 11 assets; this shot has 12.',
      'Its reference input takes at most 8 of type image; this shot has 9.',
    ])
    expect(await entry.validateGenerationRequest({ ...request([image], audios[0] ?? image), prompt: '@[first frame](dv:input/first_frame) smiles' }))
      .toEqual([`Its first_frame input takes assets of type image; asset ${String(audios[0])} is of type audio.`])
  })

  it('renders through POST /v1/videos/sync with labeled citations and data URIs, and yields the last frame and timings', async () => {
    const rendered = await sampleVideo(true)
    const fake = await startFakeServer(rendered)
    const ctx = await start(fake.url)
    const walk = await sampleVideo(true)
    const video = importAsset(ctx, walk, 'video/mp4')
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const audio = importAsset(ctx, Buffer.from('AUD1'), 'audio/mpeg')
    const first = importAsset(ctx, Buffer.from('FIRST'), 'image/jpeg')
    const prompt = `@[Bo](dv:asset/${image}) walks in @[the walk](dv:asset/${video}) to @[the song](dv:asset/${audio}) from @[first frame](dv:input/first_frame)`
    const events = await collect(fasth3(ctx).render({ ...request([video, image, audio], first), prompt }))
    // The sound of the walk takes <Audio 1>, so the audio file is <Audio 2>; the first frame is the image after the references.
    expect(fake.renders).toEqual([{
      model: 'FastH3-Omni', task: 'ref2va', prompt: '<Picture 1> walks in <Video 1> to <Audio 2> from <Picture 2>',
      conditions: [
        { type: 'video', uri: dataUri('video/mp4', walk), role: 'reference' },
        { type: 'image', uri: dataUri('image/png', 'IMG1'), role: 'reference' },
        { type: 'audio', uri: dataUri('audio/mpeg', 'AUD1'), role: 'reference' },
        { type: 'image', uri: dataUri('image/jpeg', 'FIRST'), role: 'reference' },
      ],
      target: { short_edge: 768, aspect_ratio: '16:9', duration_seconds: 5 },
      seed: 7,
    }])
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    const [still, start_, chunk, done] = events
    expect(still?.kind === 'last_frame' && still.png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(start_).toEqual({ kind: 'video_start', mime: 'video/mp4' })
    expect(chunk).toEqual({ kind: 'chunk', bytes: rendered })
    expect(done).toEqual({
      kind: 'done',
      timings: { inference_s: 6.282, decoding_s: 0.565, denoising_s: 4.854, encoding_s: 0.226, finalizing_s: 0.094, preparing_s: 0.543 },
    })
    // A 9:16 480p request of 4 seconds; a timing that is absent or not a finite number is left out. A silent video takes
    // no audio number, and a citation of anything other than a reference keeps its label.
    fake.video = { status: 200, headers: { 'content-type': 'video/mp4', 'x-stage-durations': '{"denoising":"slow","encoding":0.2}' }, body: rendered }
    const silent = importAsset(ctx, await sampleVideo(false), 'video/mp4')
    const portrait = await collect(fasth3(ctx).render({
      ...request([silent, audio], null), frameWidth: 480, frameHeight: 832, numFrames: 107,
      prompt: `@[still](dv:asset/${silent}) hums @[the song](dv:asset/${audio}) beside @[Mia](dv:character/c1) and @[gone](dv:asset/${image})`,
    }))
    expect(fake.renders[1]?.['prompt']).toBe('<Video 1> hums <Audio 1> beside Mia and gone')
    expect(fake.renders[1]?.['target']).toEqual({ short_edge: 480, aspect_ratio: '9:16', duration_seconds: 4 })
    expect(portrait.at(-1)).toEqual({ kind: 'done', timings: { encoding_s: 0.2 } })
    // An answer without a media type is an MP4.
    fake.video = { status: 200, headers: {}, body: rendered }
    const plain = await collect(fasth3(ctx).render(request([image], null)))
    expect(plain.slice(1).map(event => event.kind === 'chunk' ? 'chunk' : event)).toEqual([
      { kind: 'video_start', mime: 'video/mp4' }, 'chunk', { kind: 'done', timings: {} },
    ])
  })

  it('rejects a render with the server error, a frame size or count the server does not render, or an abort', async () => {
    const fake = await startFakeServer(await sampleVideo(false))
    const ctx = await start(fake.url)
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const entry = fasth3(ctx)
    fake.video = {
      status: 400, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { message: 'conditions: ref2va needs at least one image or video reference', type: 'invalid_request_error' } }),
    }
    await expect(collect(entry.render(request([image], null)))).rejects.toThrow(
      `The server at ${fake.url} answered POST /v1/videos/sync with HTTP 400: conditions: ref2va needs at least one image or video reference`,
    )
    fake.video = { status: 500, headers: {}, body: 'worker crashed' }
    await expect(collect(entry.render(request([image], null)))).rejects.toThrow('with HTTP 500: worker crashed')
    fake.video = { status: 503, headers: { 'content-type': 'application/json' }, body: '{"detail":"overloaded"}' }
    await expect(collect(entry.render(request([image], null)))).rejects.toThrow('with HTTP 503: {"detail":"overloaded"}')
    await expect(collect(entry.render({ ...request([image], null), frameWidth: 1280, frameHeight: 720 }))).rejects.toThrow('UniServe renders no 1280x720 canvas.')
    await expect(collect(entry.render({ ...request([image], null), numFrames: 125 }))).rejects.toThrow('UniServe renders no video of 125 frames.')
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(collect(entry.render(request([image], null), controller.signal))).rejects.toThrow('stopped')
    expect(fake.renders).toHaveLength(3)
  })

  it('rejects the facts of a server that cannot be reached, answers with an error, or does not serve ref2va', async () => {
    const unreachable = await closedUrl()
    await expect(fasth3(await start(unreachable)).facts()).rejects.toThrow(`The server at ${unreachable} cannot be reached.`)
    const fake = await startFakeServer(await sampleVideo(false))
    fake.capabilities = { status: 503, headers: { 'content-type': 'application/json' }, body: '"starting up"' }
    await expect(fasth3(await start(fake.url)).facts()).rejects.toThrow(`The server at ${fake.url} answered GET /v1/capabilities with HTTP 503: "starting up"`)
    fake.capabilities = {
      status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...CAPABILITIES, video: { ...CAPABILITIES.video, tasks: [], task_conditions: {} } }),
    }
    await expect(fasth3(await start(fake.url)).schema()).rejects.toThrow(
      `The server at ${fake.url} serves task none, not ref2va; the dv-uniserve baseUrl names the wrong server.`,
    )
  })

  it('registers the fasth3 UniServe prompt skill and removes the entry and the skill on disposal', async () => {
    const fake = await startFakeServer(await sampleVideo(false))
    const ctx = await start(fake.url)
    const skill = await ctx.skills.get('fasth3-uniserve-prompting')
    expect(skill?.description).toContain('model fasth3 of provider uniserve for task ref2v')
    expect(skill?.content).toContain('Every shot needs at least one reference.')
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-uniserve.mjs'))
    await entry?.fiber?.dispose()
    expect(await ctx.skills.get('fasth3-uniserve-prompting')).toBeUndefined()
    expect(ctx.dvModels.list()).toEqual([])
  })

  it.skipIf(REAL_SERVER === undefined || !existsSync(REAL_REFERENCE))('renders a real five-second shot against the running server', async () => {
    const ctx = await start(REAL_SERVER as string)
    const facts = await fasth3(ctx).facts()
    const [width, height] = facts.frameSizes['16:9']?.['768p'] ?? [0, 0]
    const events = await collect(fasth3(ctx).render({
      prompt: 'The scene in <Picture 1> comes to life: the camera slowly pushes in while soft ambient sound plays.',
      references: [importAsset(ctx, readFileSync(REAL_REFERENCE), 'image/png')], firstFrame: null, frameWidth: width, frameHeight: height,
      numFrames: facts.numFramesByDurationSec['5'] ?? 0, seed: 1, extra: {},
    }))
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
  }, 600_000)
})
