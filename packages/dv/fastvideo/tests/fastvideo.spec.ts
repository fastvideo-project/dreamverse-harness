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
import DvLora, { type Config as LoraConfig } from '@dv/lora'
import DvModels, { type ModelEntry, type RenderStreamEvent, type TaskOfPrimitive } from '@dv/models'
import DvProject from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import * as FastVideo from '../src/index.ts'

/** A task of the video entries that fasth3 serves. */
type VideoTask = TaskOfPrimitive<'video'>

/** The `extra.lora` entry that `schema()` reports while the server serves an adapter. */
interface LoraSchema {
  extra: Record<string, { type?: string; description?: string; properties?: Record<string, unknown> }>
}

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

/** The adapters the fake text server allow-lists when it serves LoRA. */
const LORA_ADAPTERS = {
  supported: true, runtime_switching: true, base_strength: 0,
  adapters: [
    { id: 'fal/MiniMax-H3-Realism-People-LoRA', default_strength: 0.8, min_strength: 0, max_strength: 1.5,
      description: 'Photoreal skin and faces.' },
    { id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA', default_strength: 1, min_strength: 0.2, max_strength: 2 },
  ],
}

/** The capabilities of a text server that serves the two adapters above. */
const LORA_CAPABILITIES = { ...TEXT_CAPABILITIES, model_id: 'fake-t2va-lora', lora: LORA_ADAPTERS }

/** The DreamVerse registry the deployment mounts in these tests: one adapter for t2v, one for ref2v. */
const LORA_REGISTRY: LoraConfig = {
  adapters: [
    { id: 'fal/MiniMax-H3-Realism-People-LoRA', displayName: 'Realism People', description: 'Photoreal people.',
      triggerWords: ['photoreal skin'], defaultStrength: 0.8, minStrength: 0, maxStrength: 1.5,
      targets: [{ model: 'fasth3', tasks: ['t2v'] }], license: 'Apache-2.0',
      sourceUrl: 'https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA' },
    { id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA', displayName: '360 Orbit', description: 'A camera that circles.',
      triggerWords: [], defaultStrength: 1, minStrength: 0.2, maxStrength: 2,
      targets: [{ model: 'fasth3', tasks: ['ref2v'] }], license: 'MIT',
      sourceUrl: 'https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA' },
  ],
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
  SkillRegistry, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvLora,
  FastVideo: { name: FastVideo.name, inject: FastVideo.inject, Config: FastVideo.Config, apply: FastVideo.apply },
}

/**
 * Boot the skill registry, Project, ffmpeg, the asset pool, the catalog and the plugin from a test-only `cordis.yml`.
 * @param tasks - the server URL of each task of `fasth3` to configure.
 * @returns the root context.
 */
async function start(tasks: { ref2v?: string; t2v?: string }, registry?: LoraConfig): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-'))
  const globals = globalThis as typeof globalThis & { __dvFastVideo?: typeof PLUGINS }
  globals.__dvFastVideo = PLUGINS
  const config = ['models:', '  fasth3:', ...Object.entries(tasks).flatMap(([task, url]) => [
    `    ${task}:`, `      baseUrl: ${url}`,
  ])]
  const rows: string[] = []
  const plugins = [
    ['skills', 'SkillRegistry', []],
    ['dv-project', 'DvProject', [`root: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`]],
    ['dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe']],
    ['dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`]],
    ['dv-models', 'DvModels', []],
    ...registry === undefined ? [] : [['dv-lora', 'DvLora', [`adapters: ${JSON.stringify(registry.adapters)}`]] as const],
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
    expect(() => { FastVideo.apply(ctx, { models: { wan: { t2v: server } } }) }).toThrow('dv-fastvideo serves no model "wan"; it serves: fasth3.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: { reference: server } } }) })
      .toThrow('dv-fastvideo serves model "fasth3" for no task "reference"; its tasks: ref2v, t2v.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: {} } }) }).toThrow('dv-fastvideo: model "fasth3" names no task.')
    expect(ctx.dvModels.list().map(entry => entry.task)).toEqual(['ref2v'])
  })

  it('declares extra.lora only while the server serves an adapter, with each default and range', async () => {
    const text = await startFakeServer(LORA_CAPABILITIES)
    const plain = await startFakeServer(TEXT_CAPABILITIES)
    const ctx = await start({ t2v: text.url, ref2v: plain.url })
    const lora = (await fasth3(ctx, 't2v').schema() as unknown as LoraSchema).extra['lora']
    expect(lora?.['type']).toBe('object')
    expect(lora?.['description']).toContain('fal/MiniMax-H3-Realism-People-LoRA (default 0.8, from 0 to 1.5: Photoreal skin and faces.)')
    expect(lora?.['description']).toContain('pablodawson/MiniMax-H3-360-Orbit-LoRA (default 1, from 0.2 to 2)')
    expect(lora?.['properties']).toEqual({
      id: { type: 'string', required: true, description: 'The adapter id: fal/MiniMax-H3-Realism-People-LoRA, pablodawson/MiniMax-H3-360-Orbit-LoRA.' },
      strength: { type: 'number', description: "Multiplier of the adapter's delta, inside that adapter's range; omitted, its default." },
    })
    expect((await fasth3(ctx, 'ref2v').schema() as unknown as { extra: Record<string, unknown> }).extra).toEqual({})
  })

  it('validates extra.lora against the server allow-list and the adapter range', async () => {
    const text = await startFakeServer(LORA_CAPABILITIES)
    const ctx = await start({ t2v: text.url })
    const task = fasth3(ctx, 't2v')
    const check = (lora: unknown) => task.validateGenerationRequest(request([], null, { lora }))
    expect(await check({ id: 'fal/MiniMax-H3-Realism-People-LoRA', strength: 0.8 })).toEqual([])
    expect(await check({ id: 'fal/MiniMax-H3-Realism-People-LoRA' })).toEqual([])
    expect(await check({ id: 'nobody/none' })).toEqual([
      'Its extra.lora id "nobody/none" is not an adapter of this server; the server serves: '
      + 'fal/MiniMax-H3-Realism-People-LoRA, pablodawson/MiniMax-H3-360-Orbit-LoRA.',
    ])
    expect(await check({ id: 'fal/MiniMax-H3-Realism-People-LoRA', strength: 2 })).toEqual([
      'Its extra.lora strength 2 is outside fal/MiniMax-H3-Realism-People-LoRA\'s range of 0 to 1.5.',
    ])
    expect((await check({ id: 'fal/MiniMax-H3-Realism-People-LoRA', strength: 'high' }))[0]).toContain('must be a number')
    expect((await check({ strength: 0.8 }))[0]).toContain('lora')
    // A server without an allow-list advertises no such parameter, so the name is refused with the other unknown names.
    const plain = await startFakeServer(TEXT_CAPABILITIES)
    const other = await start({ t2v: plain.url })
    expect(await fasth3(other, 't2v').validateGenerationRequest(request([], null, { lora: { id: 'fal/MiniMax-H3-Realism-People-LoRA' } })))
      .toEqual(['fasth3 has no extra parameter `lora` for task t2v; its extra parameters: none.'])
  })

  it('narrows extra.lora to the adapters the mounted DreamVerse registry publishes for the model and task', async () => {
    const text = await startFakeServer(LORA_CAPABILITIES)
    const ctx = await start({ t2v: text.url }, LORA_REGISTRY)
    const task = fasth3(ctx, 't2v')
    const lora = (await task.schema() as unknown as LoraSchema).extra['lora']
    expect(lora?.['description']).toContain('fal/MiniMax-H3-Realism-People-LoRA')
    expect(lora?.['description']).not.toContain('pablodawson')
    expect(await task.validateGenerationRequest(request([], null, { lora: { id: 'fal/MiniMax-H3-Realism-People-LoRA' } })))
      .toEqual([])
    expect(await task.validateGenerationRequest(request([], null, { lora: { id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA' } })))
      .toEqual(['Its extra.lora id "pablodawson/MiniMax-H3-360-Orbit-LoRA" is not meant for model fasth3 task t2v: '
        + '360 Orbit serves fasth3 ref2v.'])
    const unknown = await start({ t2v: text.url }, { adapters: [LORA_REGISTRY.adapters[0]!] })
    expect(await fasth3(unknown, 't2v').validateGenerationRequest(request([], null, { lora: { id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA' } })))
      .toEqual(['Its extra.lora id "pablodawson/MiniMax-H3-360-Orbit-LoRA" is not one this deployment publishes for model '
        + 'fasth3 task t2v; call dv_lora_list for the adapters you can use.'])
  })

  it('picks up a dvLora mounted after the plugin and drops it when it is removed', async () => {
    const text = await startFakeServer(LORA_CAPABILITIES)
    const ctx = await start({ t2v: text.url })
    const task = fasth3(ctx, 't2v')
    const offered = async () => (await task.schema() as unknown as LoraSchema).extra['lora']?.['description']
    expect(await offered()).toContain('pablodawson')
    const registry = await ctx.plugin(DvLora, LORA_REGISTRY)
    expect(await offered()).not.toContain('pablodawson')
    await registry.dispose()
    expect(await offered()).toContain('pablodawson')
  })

  it('sends the selected adapter and strength with the segment, and nothing when the shot names none', async () => {
    const text = await startFakeServer(LORA_CAPABILITIES)
    const ctx = await start({ t2v: text.url })
    const events = await collect(fasth3(ctx, 't2v').render(request([], null, { lora: { id: 'fal/MiniMax-H3-Realism-People-LoRA', strength: 0.6 } })))
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    expect(text.requests[0]?.['lora']).toEqual({ id: 'fal/MiniMax-H3-Realism-People-LoRA', strength: 0.6 })
    await collect(fasth3(ctx, 't2v').render(request([], null)))
    expect(text.requests[1]).not.toHaveProperty('lora')
    expect(() => fasth3(ctx, 't2v').render(request([], null, { lora: 'photoreal' })))
      .toThrow('extra.lora must be an object with a string id and an optional number strength.')
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
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['last_frame', 'video_start', 'chunk', 'done']))
  }, 600_000)
})
