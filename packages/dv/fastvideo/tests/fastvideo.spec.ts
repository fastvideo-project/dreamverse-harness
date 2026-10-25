/**
 * The FastVideo provider plugin in a REAL composition: a test-only `cordis.yml` boots the DSH skill registry, Project,
 * ffmpeg, the asset pool, the model catalog and the plugin through the Loader. The FastVideo video job servers are the
 * only fakes: one HTTP server per task that accepts every job, reports it completed, and returns one sample MP4. An
 * opt-in test renders against a running server named by `DV_FASTVIDEO_TEST_URL`.
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
import DvModels, { type ModelEntry, type RenderStreamEvent, type TaskOfPrimitive } from '@dv/models'
import DvProject from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import * as FastVideo from '../src/index.ts'

/** A task of the video entries that fasth3 serves. */
type VideoTask = TaskOfPrimitive<'video'>

/** The reference image of the opt-in run against a running server. */
const REAL_REFERENCE = '/mnt/lustre/vlm-d1su/codes/dsh-dv-hub/elon-musk.jpg'
const REAL_BACKEND = process.env['DV_FASTVIDEO_TEST_URL']

/** The ffmpeg binary that makes the sample videos. */
const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const run = promisify(execFile)

/**
 * The bytes of a one-second sample video with a sound track, as MiniMax H3 returns a video with sound.
 * @returns the MP4 bytes.
 */
async function sampleVideo(): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-video-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'sample.mp4')
  const audio = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest']
  const video = ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1:r=8']
  await run(FFMPEG, ['-y', '-loglevel', 'error', ...video, ...audio, '-pix_fmt', 'yuv420p', path])
  return readFileSync(path)
}

/** The schema facts of both fasth3 tasks, from the MiniMax H3 table. */
const H3_SCHEMA = { duration_sec: { min: 5, max: 15 }, aspect_ratios: ['16:9'], resolutions: ['720p'] }

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Start a fake video job server: every job is completed at its first status poll, and its content is `video`.
 * @param video - the MP4 bytes that every job returns.
 * @returns the server URL and the job bodies.
 */
async function startFakeServer(video: Buffer = Buffer.alloc(0)): Promise<{ url: string; requests: Record<string, unknown>[] }> {
  const requests: Record<string, unknown>[] = []
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') {
      const content = (request.url ?? '').endsWith('/content')
      response.writeHead(200, { 'content-type': content ? 'video/mp4' : 'application/json', connection: 'close' })
      response.end(content ? video : JSON.stringify({ id: 'job', status: 'completed', inference_time_s: 0.4 }))
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
      response.end(JSON.stringify({ id: 'job', status: 'queued' }))
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
async function start(tasks: { ref2v?: string; t2v?: string }): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-'))
  const globals = globalThis as typeof globalThis & { __dvFastVideo?: typeof PLUGINS }
  globals.__dvFastVideo = PLUGINS
  const config = ['models:', '  fasth3:', ...Object.entries(tasks).flatMap(([task, url]) => [
    `    ${task}:`, `      baseUrl: ${url}`, `      gpuSecondsPerVideoSecond: ${task === 'ref2v' ? 4 : 1.5}`,
  ])]
  const rows: string[] = []
  const plugins = [
    ['skills', 'SkillRegistry', []],
    ['dv-project', 'DvProject', [`root: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`]],
    ['dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe']],
    ['dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`]],
    ['dv-models', 'DvModels', []],
    ['dv-fastvideo', 'FastVideo', config],
  ] as const
  for (const [id, key, lines] of plugins) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvFastVideo.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...lines.length === 0 ? [] : ['  config:', ...lines.map(line => `    ${line}`)])
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
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

/** Import bytes into the asset pool under a MIME type. */
function importAsset(ctx: Context, bytes: Buffer, mime: string): AssetId {
  return ctx.dvAssetPool.importAsset(bytes, { mime, name: 'asset' }, null)
}

/** A render request with the given input assets and `extra` values. */
function request(references: AssetId[], firstFrame: AssetId | null, extra: Record<string, unknown> = {}) {
  return { prompt: '<Picture 1> smiles', references, firstFrame, frameWidth: 1344, frameHeight: 768, numFrames: 124, seed: 7, extra }
}

/** The wire form of one PNG image reference: a `data:` URL of its bytes. */
function encodeWireImage(bytes: string) {
  return { image_url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` }
}

describe('dv-fastvideo', () => {
  it('registers fasth3 once per configured task, each with the facts and schema of the MiniMax H3 table', async () => {
    const [reference, text] = await Promise.all([startFakeServer(), startFakeServer()])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    expect(ctx.dvModels.list().filter(isVideoEntry).map(({ modality, task, provider, model, gpuSecondsPerVideoSecond }) =>
      ({ modality, task, provider, model, gpuSecondsPerVideoSecond }))).toEqual([
      { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', gpuSecondsPerVideoSecond: 4 },
      { modality: 'video', task: 't2v', provider: 'fastvideo', model: 'fasth3', gpuSecondsPerVideoSecond: 1.5 },
    ])
    expect(fasth3(ctx, 'ref2v').description).toContain('Needs at least one reference image.')
    expect(fasth3(ctx, 't2v').description).toContain('a face that must stay the same needs fasth3 for task ref2v')
    expect(await fasth3(ctx, 'ref2v').facts()).toEqual({
      modelId: 'fasth3-ref2va', aspectRatios: ['16:9'], resolutions: ['720p'], frameSizes: { '16:9': { '720p': [1344, 768] } },
      minDurationSec: 5, maxDurationSec: 15,
      numFramesByDurationSec: { 5: 124, 6: 158, 7: 175, 8: 192, 9: 226, 10: 243, 11: 277, 12: 294, 13: 328, 14: 345, 15: 362 },
    })
    expect(await fasth3(ctx, 't2v').facts()).toMatchObject({ modelId: 'fasth3-t2va' })
    // The first frame takes one of the model's nine images.
    expect(await fasth3(ctx, 'ref2v').schema()).toEqual({
      ...H3_SCHEMA,
      inputs: {
        reference: { min: 1, max: 8, media_types: { image: {} } },
        first_frame: { min: 0, max: 1, media_types: { image: {} } },
      },
      extra: {},
    })
    expect(await fasth3(ctx, 't2v').schema()).toEqual({ ...H3_SCHEMA, inputs: {}, extra: {} })
    // The video job clients stay private to the plugin, and reading facts sends no request.
    expect(ctx.get('dvFastvideoGeneration')).toBeUndefined()
    expect([...reference.requests, ...text.requests]).toEqual([])
  })

  it('validates a request for each task against what the task declares and the limits of the model', async () => {
    const [reference, text] = await Promise.all([startFakeServer(), startFakeServer()])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    const [referenceTask, textTask] = [fasth3(ctx, 'ref2v'), fasth3(ctx, 't2v')]
    const asset = (bytes: string, mime: string) => importAsset(ctx, Buffer.from(bytes), mime)
    const images = Array.from({ length: 9 }, (_, index) => asset(`IMG${String(index + 1)}`, 'image/png'))
    const [image] = images as [AssetId]
    const [video, json] = [asset('VID1', 'video/mp4'), asset('{}', 'application/json')]
    // A request with a first frame cites it, as the fasth3 prompt rule asks.
    const check = (entry: ModelEntry<VideoTask>, references: AssetId[], firstFrame: AssetId | null) => entry.validateGenerationRequest({
      ...request(references, firstFrame), prompt: firstFrame === null ? '<Picture 1> smiles' : '@[首帧](dv:input/first_frame) smiles',
    })
    expect(await check(referenceTask, images.slice(0, 8), image)).toEqual([])
    expect(await referenceTask.validateGenerationRequest(request([image], image))).toEqual([
      'Its prompt does not cite the first frame; write "@[首帧](dv:input/first_frame) is the first frame of [Shot 1]".',
    ])
    expect(await check(referenceTask, [], null)).toEqual(['Its reference input needs at least 1 of type image; this shot has 0.'])
    expect(await check(referenceTask, [json], null)).toEqual([`Its reference input takes assets of type image; asset ${json} is of type application.`])
    // The job API reads no video or audio references.
    expect(await check(referenceTask, [video], null)).toEqual([`Its reference input takes assets of type image; asset ${video} is of type video.`])
    // The first frame takes one of the model's nine images, so the references keep eight.
    expect(await check(referenceTask, images, null)).toEqual(['Its reference input takes at most 8 assets; this shot has 9.'])
    expect(await check(referenceTask, [image], video)).toEqual([`Its first_frame input takes assets of type image; asset ${video} is of type video.`])
    expect(await check(textTask, [], null)).toEqual([])
    expect(await check(textTask, [image], video)).toEqual(['It takes no reference input; this shot has 1.', 'It takes no first_frame input; this shot has 1.'])
  })

  it('refuses extra parameters that the task does not take, after the input problems', async () => {
    const [reference, text] = await Promise.all([startFakeServer(), startFakeServer()])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    expect(await fasth3(ctx, 'ref2v').validateGenerationRequest(request([image], null, { cfg: 5, steps: 8 })))
      .toEqual(['fasth3 has no extra parameter `cfg`, `steps` for task ref2v; its extra parameters: none.'])
    expect(await fasth3(ctx, 't2v').validateGenerationRequest(request([image], null, { cfg: 5 }))).toEqual([
      'It takes no reference input; this shot has 1.', 'fasth3 has no extra parameter `cfg` for task t2v; its extra parameters: none.',
    ])
  })

  it.skipIf(!existsSync(FFMPEG))('sends each task to its own server as one job: the reference images, then the first frame', async () => {
    const sample = await sampleVideo()
    const [reference, text] = await Promise.all([startFakeServer(sample), startFakeServer(sample)])
    const ctx = await start({ ref2v: reference.url, t2v: text.url })
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const other = importAsset(ctx, Buffer.from('IMG2'), 'image/png')
    const first = importAsset(ctx, Buffer.from('FIRST'), 'image/png')
    const events = await collect(fasth3(ctx, 'ref2v').render(request([image, other], first)))
    expect(reference.requests[0]).toEqual({
      task: 'ref2va', prompt: '<Picture 1> smiles', size: '1344x768', num_frames: 124, seed: 7,
      image_reference: [encodeWireImage('IMG1'), encodeWireImage('IMG2'), encodeWireImage('FIRST')],
    })
    // The whole video is one chunk; the last frame, decoded from it, follows.
    expect(events.map(event => event.kind)).toEqual(['video_start', 'chunk', 'last_frame', 'done'])
    expect(events[0]).toEqual({ kind: 'video_start', mime: 'video/mp4' })
    expect(events[1]).toEqual({ kind: 'chunk', bytes: sample })
    expect(events[2]?.kind === 'last_frame' && events[2].png.subarray(1, 4).toString()).toBe('PNG')
    expect(events[3]).toEqual({ kind: 'done', timings: { e2e_latency_ms: expect.any(Number) as number, generation_ms: 400 } })
    await collect(fasth3(ctx, 'ref2v').render(request([image], null), new AbortController().signal))
    expect(reference.requests[1]?.['image_reference']).toEqual([encodeWireImage('IMG1')])
    await collect(fasth3(ctx, 't2v').render(request([], null)))
    expect(text.requests).toEqual([{ task: 't2va', prompt: '<Picture 1> smiles', size: '1344x768', num_frames: 124, seed: 7 }])
  })

  it.skipIf(!existsSync(FFMPEG))('replaces each citation of a reference with its label, counting the images in order', async () => {
    const reference = await startFakeServer(await sampleVideo())
    const ctx = await start({ ref2v: reference.url })
    const image = importAsset(ctx, Buffer.from('IMG1'), 'image/png')
    const other = importAsset(ctx, Buffer.from('IMG2'), 'image/png')
    // A citation of an asset outside the references, or of anything other than an asset, becomes its label.
    const prompt = `@[Mia](dv:asset/${other}) meets @[Bo](dv:asset/${image}) and @[Mia](dv:asset/${other}), `
      + '@[a cat](dv:asset/missing) and @[the lake](dv:element/e1@2)'
    const firstFrame = '@[首帧](dv:input/first_frame)'
    await collect(fasth3(ctx, 'ref2v').render({ ...request([image, other], null), prompt: `${prompt} from ${firstFrame}` }))
    expect(reference.requests[0]?.['prompt']).toBe('<Picture 2> meets <Picture 1> and <Picture 2>, a cat and the lake from 首帧')
    // The first frame is the image after the reference images, even when it is also one of them.
    const continued = `@[Bo](dv:asset/${image}) from ${firstFrame}`
    await collect(fasth3(ctx, 'ref2v').render({ ...request([image, other], image), prompt: continued }))
    expect(reference.requests[1]?.['prompt']).toBe('<Picture 1> from <Picture 3>')
  })

  it('registers only the configured tasks and their prompt skills, and removes them on disposal', async () => {
    const reference = await startFakeServer()
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
    const reference = await startFakeServer()
    const ctx = await start({ ref2v: reference.url })
    const server = { baseUrl: reference.url, gpuSecondsPerVideoSecond: 1 }
    expect(() => { FastVideo.apply(ctx, { models: { wan: { t2v: server } } }) }).toThrow('dv-fastvideo serves no model "wan"; it serves: fasth3.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: { reference: server } } }) })
      .toThrow('dv-fastvideo serves model "fasth3" for no task "reference"; its tasks: ref2v, t2v.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: {} } }) }).toThrow('dv-fastvideo: model "fasth3" names no task.')
    expect(ctx.dvModels.list().map(entry => entry.task)).toEqual(['ref2v'])
  })

  it.skipIf(REAL_BACKEND === undefined || !existsSync(REAL_REFERENCE))('renders a real five-second shot against the running server', async () => {
    const ctx = await start({ ref2v: REAL_BACKEND as string })
    const facts = await fasth3(ctx, 'ref2v').facts()
    const [width, height] = facts.frameSizes[facts.aspectRatios[0] ?? '']?.[facts.resolutions[0] ?? ''] ?? [0, 0]
    const events = await collect(fasth3(ctx, 'ref2v').render({
      prompt: '<Picture 1> is a man speaking to the camera in a bright office, slow push-in, natural light.',
      references: [importAsset(ctx, readFileSync(REAL_REFERENCE), 'image/jpeg')], firstFrame: null, frameWidth: width, frameHeight: height,
      numFrames: facts.numFramesByDurationSec['5'] ?? 0, seed: 1, extra: {},
    }))
    expect(events.map(event => event.kind)).toEqual(['video_start', 'chunk', 'last_frame', 'done'])
  }, 600_000)
})
