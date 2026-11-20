/** Check which shot requests each Reactor model accepts, how prompts cite assets, and the published input slots. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { formatModelKey, type RenderRequest } from '@dv/models'
import { formatCitation, type AssetId } from '@dv/project'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FFMPEG } from '../../../dv/api/tests/support.ts'
import { installFakeReactor } from '../../../dv/reactor/tests/fake-reactor-api.ts'
import { boot, disposeBooted } from './reactor-support.ts'

afterEach(async () => {
  vi.restoreAllMocks()
  await disposeBooted()
})

const request: RenderRequest = {
  prompt: 'A lake at dawn', references: [], firstFrame: null, lastFrame: null,
  durationSec: 8, aspectRatio: '16:9', resolution: '768p', seed: 1, extra: {},
}
const origin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'create' } as const

/** The request without the named optional fields. */
function without(base: RenderRequest, ...keys: Array<'durationSec' | 'aspectRatio' | 'resolution'>): RenderRequest {
  const { durationSec, aspectRatio, resolution, ...rest } = base
  return {
    ...rest,
    ...durationSec === undefined || keys.includes('durationSec') ? {} : { durationSec },
    ...aspectRatio === undefined || keys.includes('aspectRatio') ? {} : { aspectRatio },
    ...resolution === undefined || keys.includes('resolution') ? {} : { resolution },
  }
}
type App = Awaited<ReturnType<typeof boot>>
type Task = 't2v' | 'i2v' | 'l2v' | 'fl2v' | 'ref2v'

async function setup(reactor: Record<string, unknown> = {}) {
  const app = await boot(reactor)
  const project = await app.ctx.dvProject.createProject(await app.ctx.dvProject.newProjectFolder('reactor-requests'), 'requests', origin)
  let count = 0
  const asset = (mime: string, durationSec?: number): AssetId => app.ctx.dvAssetPool.importAsset(
    project.id, Buffer.from(`${mime}${count++}`), { mime, name: mime.replace('/', '-'), ...durationSec === undefined ? {} : { durationSec } }, null)
  const entry = (model: string, task: Task) => app.ctx.dvModels.resolve([task], { modality: 'video', provider: 'reactor', model, task })
  const problems = (model: string, task: Task, over: Partial<RenderRequest>, ...omit: Parameters<typeof without>[1][]): Promise<string[]> =>
    entry(model, task).validateGenerationRequest(without({ ...request, ...over }, ...omit))
  return { ...app, asset, entry, problems }
}

describe('Reactor request validation', () => {
  it('names each part of a request that the model cannot take', async () => {
    const { problems } = await setup()
    expect(await problems('fast-h3', 't2v', {})).toEqual([])
    expect(await problems('fast-h3', 't2v', { prompt: ' ', durationSec: 7, aspectRatio: '2:1', seed: -1, extra: { style: 'x' } }))
      .toEqual([
        'FastH3 requires a prompt.', 'Choose a duration from the model’s listed duration choices.',
        'Choose an aspect ratio and resolution from the model’s listed choices.', 'Choose a nonnegative integer seed.',
        'Unsupported extra parameter or value: style.',
      ])
    expect(await problems('fast-h3', 't2v', {}, 'aspectRatio')).toEqual([
      'Choose an aspect ratio and resolution from the model’s listed choices.',
    ])
    expect(await problems('fast-h3', 't2v', { seed: 1.5 }, 'durationSec', 'resolution')).toEqual([
      'Choose a duration from the model’s listed duration choices.',
      'Choose an aspect ratio and resolution from the model’s listed choices.', 'Choose a nonnegative integer seed.',
    ])
  })

  it('checks the frame inputs of each task', async () => {
    const { asset, problems } = await setup()
    const image = asset('image/png')
    expect(await problems('fast-h3', 'i2v', {})).toEqual(['This task requires one first_frame image.'])
    expect(await problems('fast-h3', 'l2v', {})).toEqual(['This task requires one last_frame image.'])
    expect(await problems('fast-h3', 'fl2v', { firstFrame: image, lastFrame: image })).toEqual([])
    expect(await problems('fast-h3', 't2v', { firstFrame: image })).toEqual(['This task takes no first_frame input.'])
    expect(await problems('fast-h3', 'i2v', { firstFrame: asset('audio/wav') }))
      .toEqual(['first_frame must be a JPEG, PNG, or WebP no larger than 25 MiB.'])
  })

  it('refuses an oversized frame at the upload limit of the model', async () => {
    const { ctx, asset, problems } = await setup()
    const image = asset('image/png')
    const get = ctx.dvAssetPool.get.bind(ctx.dvAssetPool)
    vi.spyOn(ctx.dvAssetPool, 'get').mockImplementation(id => ({ ...get(id), size_bytes: 21 * 1024 * 1024 }))
    expect(await problems('fast-h3', 'i2v', { firstFrame: image })).toEqual([])
    expect(await problems('pixverse-r2-director', 'ref2v', { references: [image], resolution: '720p' }))
      .toEqual(['Reference ' + image + ' must be no larger than 20 MiB.'])
  })

  it('accepts a scene only for models that take one', async () => {
    const { problems } = await setup()
    expect(await problems('pixverse-r2-director', 't2v', { aspectRatio: '16:9', resolution: '720p', seed: -5, extra: { scene: 'A town' } }))
      .toEqual([])
    expect(await problems('pixverse-r2-director', 't2v', { resolution: '720p', extra: { scene: 3 } }))
      .toEqual(['Unsupported extra parameter or value: scene.'])
    expect(await problems('fast-h3', 't2v', { extra: { scene: 'A town' } })).toEqual(['Unsupported extra parameter or value: scene.'])
  })

  it('checks reference counts, media types, lengths, and totals', async () => {
    const { asset, problems } = await setup()
    const image = asset('image/png')
    expect(await problems('fast-h3-omni', 'ref2v', { references: [image], firstFrame: image, lastFrame: image })).toEqual([])
    expect(await problems('fast-h3-omni', 'ref2v', {})).toEqual(['This task requires at least one reference.', 'Include at least one reference image.'])
    expect(await problems('fast-h3-omni', 'ref2v', { references: [asset('audio/wav', 5)] })).toEqual(['Include at least one reference image.'])
    expect(await problems('fast-h3-omni', 'ref2v', { references: [image, asset('text/plain'), asset('video/mp4', 5)] })).toEqual([
      expect.stringMatching(/is not a supported media type for FastH3-Omni/),
      expect.stringMatching(/is not a supported media type for FastH3-Omni/),
    ])
    for (const length of [1, 20]) {
      expect(await problems('fast-h3-omni', 'ref2v', { references: [image, asset('audio/wav', length)] }))
        .toEqual([expect.stringMatching(/must be 2 to 15 seconds long/)])
    }
    const tenImages = Array.from({ length: 10 }, () => image)
    expect(await problems('fast-h3-omni', 'ref2v', { references: tenImages })).toEqual(['Use at most 9 image references.'])
    expect(await problems('fast-h3-omni', 't2v', { references: [image] })).toEqual(['This task takes no reference assets.'])
    expect(await problems('pika-h3-flex', 'ref2v', { references: [asset('video/mp4', 10), asset('video/webm', 10), asset('audio/wav', 3)] }))
      .toEqual(['Keep all audio references and all video references to 15 seconds total per media type.'])
    expect(await problems('pika-h3-flex', 'ref2v', { references: [asset('video/mp4', 10), asset('video/webm', 4), asset('audio/ogg')] })).toEqual([])
  })

  it('rejects a render when the host has no Reactor key, without opening a session', async () => {
    const { entry, trace } = await setup({ credentialRef: 'REACTOR_MISSING_KEY' })
    await expect(entry('fast-h3', 't2v').render(request)[Symbol.asyncIterator]().next())
      .rejects.toThrow('Set the Reactor credential REACTOR_MISSING_KEY on the DreamVerse host.')
    expect(() => execFileSync('test', ['-e', trace])).toThrow()
  })

  it('rejects a render of an invalid request without opening a session', async () => {
    const { entry, trace } = await setup()
    await expect(entry('fast-h3', 't2v').render({ ...without(request, 'durationSec'), prompt: '' })[Symbol.asyncIterator]().next())
      .rejects.toThrow('FastH3 requires a prompt. Choose a duration from the model’s listed duration choices.')
    await expect(entry('fast-h3', 'i2v').render(without(request, 'aspectRatio', 'resolution'))[Symbol.asyncIterator]().next())
      .rejects.toThrow('requires one first_frame image')
    expect(() => execFileSync('test', ['-e', trace])).toThrow()
  })
})

describe('Reactor prompt citations', () => {
  async function enqueuedPrompt(app: App, model: string, over: (assets: { image: AssetId; audio: AssetId; video: AssetId; other: AssetId }) => Partial<RenderRequest>, task: Task = 'ref2v'): Promise<unknown> {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=8', '-c:v', 'libx264', app.recording])
    const project = await app.ctx.dvProject.createProject(await app.ctx.dvProject.newProjectFolder(`citations-${model}`), 'citations', origin)
    const asset = (mime: string, durationSec?: number): AssetId => app.ctx.dvAssetPool.importAsset(
      project.id, Buffer.from(mime + model), { mime, name: mime.replace('/', '-'), ...durationSec === undefined ? {} : { durationSec } }, null)
    const assets = { image: asset('image/png'), audio: asset('audio/wav', 4), video: asset('video/mp4', 4), other: asset('image/webp') }
    const entry = app.ctx.dvModels.resolve([task], { modality: 'video', provider: 'reactor', model, task })
    const calls = installFakeReactor({ video: readFileSync(app.recording) })
    await Array.fromAsync(entry.render({ ...request, ...over(assets) }))
    const submitted = calls.find(call => call.method === 'POST' && call.url.endsWith('/generations'))?.json as { input?: { prompt?: unknown } } | undefined
    return submitted?.input?.prompt ?? app.readTrace().find(row => row['event'] === 'create_world')?.['prompt']
  }
  const cite = (label: string, kind: string, id: string): string => formatCitation(label, kind, id)

  it('writes bracketed picture and audio labels, counting the audio track of a video reference', async () => {
    const app = await setup()
    vi.spyOn(app.ctx.dvAssetPool, 'hasAudio').mockResolvedValue(true)
    const prompt = await enqueuedPrompt(app, 'fast-h3-omni', a => ({
      references: [a.image, a.audio], prompt: `${cite('Hero', 'asset', a.image)} sings ${cite('Song', 'asset', a.audio)} near ${cite('Stranger', 'asset', a.other)} and ${cite('Friend', 'person', 'p1')}`,
    }))
    expect(prompt).toBe('<Picture 1> sings <Audio 1> near Stranger and Friend')
  })

  it('writes plain labels for models that read them without brackets', async () => {
    const app = await setup()
    const prompt = await enqueuedPrompt(app, 'h3-reference-to-video-turbo-realtime', a => ({
      references: [a.image], prompt: `${cite('Hero', 'asset', a.image)} walks`,
    }))
    expect(prompt).toBe('Picture 1 walks')
  })

  it('numbers audio after the video tracks that carry audio', async () => {
    const app = await setup()
    vi.spyOn(app.ctx.dvAssetPool, 'hasAudio').mockResolvedValue(true)
    const prompt = await enqueuedPrompt(app, 'pika-h3-flex', a => ({
      references: [a.image, a.video, a.audio],
      prompt: `${cite('Hero', 'asset', a.image)} ${cite('Clip', 'asset', a.video)} ${cite('Voice', 'asset', a.audio)} ${cite('Other', 'input', 'reference')}`,
    }))
    expect(prompt).toBe('<Picture 1> <Video 1> <Audio 2> Other')
  })

  it('numbers audio from one when no video reference carries audio', async () => {
    const app = await setup()
    vi.spyOn(app.ctx.dvAssetPool, 'hasAudio').mockResolvedValue(false)
    const prompt = await enqueuedPrompt(app, 'pika-h3-flex', a => ({
      references: [a.image, a.video, a.audio], prompt: `${cite('Clip', 'asset', a.video)} ${cite('Voice', 'asset', a.audio)}`,
    }))
    expect(prompt).toBe('<Video 1> <Audio 1>')
  })

  it('names the keyframes of a frame task as pictures', async () => {
    const app = await setup()
    const prompt = await enqueuedPrompt(app, 'pika-h3-flex', a => ({
      firstFrame: a.image, lastFrame: a.other, prompt: `${cite('Start', 'input', 'first_frame')} ${cite('End', 'input', 'last_frame')} ${cite('Other', 'input', 'reference')}`,
    }), 'fl2v')
    expect(prompt).toBe('<Picture 1> <Picture 2> Other')
  })

  it('points the last keyframe at the first picture when there is no first keyframe', async () => {
    const app = await setup()
    const prompt = await enqueuedPrompt(app, 'pika-h3-flex', a => ({
      lastFrame: a.other, prompt: `${cite('End', 'input', 'last_frame')} ${cite('Element', 'person', 'p1')}`,
    }), 'l2v')
    expect(prompt).toBe('<Picture 1> Element')
  })

  it('keeps the written label for models that create a world from the prompt', async () => {
    const app = await setup()
    const prompt = await enqueuedPrompt(app, 'pixverse-r2-director', a => ({
      references: [a.image], resolution: '720p', prompt: `${cite('Hero', 'asset', a.image)} enters`,
    }))
    expect(prompt).toBe('Hero enters')
  })
})

describe('Reactor delivery checks', () => {
  it('uses the container duration when the recording has no video duration and rejects an empty recording', async () => {
    const app = await setup()
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=2', '-c:v', 'libx264', app.recording])
    installFakeReactor({ video: readFileSync(app.recording) })
    const entry = app.entry('fast-h3', 't2v')
    const probe = app.ctx.dvFfmpeg.probe.bind(app.ctx.dvFfmpeg)
    const mocked = vi.spyOn(app.ctx.dvFfmpeg, 'probe')
    mocked.mockImplementationOnce(async path => ({ ...await probe(path), videoDurationSec: null, durationSec: 7 }))
    expect((await Array.fromAsync(entry.render(request))).at(-1)).toMatchObject({ kind: 'done', durationSec: 7 })
    mocked.mockImplementationOnce(async path => ({ ...await probe(path), videoDurationSec: null, durationSec: null }))
    await expect(Array.fromAsync(entry.render(request))).rejects.toThrow('Reactor returned an empty recording.')
  })
})

describe('Reactor input slots', () => {
  it('publishes the frame and reference slots that each task takes', async () => {
    const { ctx } = await setup()
    const slots = async (model: string, task: Task): Promise<unknown> =>
      (await ctx.dvModels.resolve([task], { modality: 'video', provider: 'reactor', model, task }).schema() as { inputs: unknown }).inputs
    expect(await slots('fast-h3', 't2v')).toEqual({})
    expect(await slots('fast-h3', 'i2v')).toEqual({ first_frame: { min: 1, max: 1, media_types: { image: { max: 1 } } } })
    expect(await slots('fast-h3', 'l2v')).toEqual({ last_frame: { min: 1, max: 1, media_types: { image: { max: 1 } } } })
    expect(Object.keys(await slots('fast-h3', 'fl2v') as object)).toEqual(['first_frame', 'last_frame'])
    expect(await slots('fast-h3-omni', 'ref2v')).toEqual({
      reference: { min: 1, max: 12, media_types: { image: { max: 9, min: 1 }, audio: { max: 3 } } },
      first_frame: { min: 0, max: 1, media_types: { image: { max: 1 } } },
      last_frame: { min: 0, max: 1, media_types: { image: { max: 1 } } },
    })
    expect(await slots('pika-h3-flex', 'ref2v')).toMatchObject({ reference: { max: 15, media_types: { video: { max: 3 } } } })
    expect(await slots('pixverse-r2-director', 'ref2v')).toMatchObject({ reference: { max: 6, media_types: { image: { max: 6 } } } })
    expect(ctx.dvModels.list({ provider: 'reactor' }).map(formatModelKey)).toContain('video/ref2v/reactor/pika-h3-flex')
  })
})

describe('Reactor API origin', () => {
  it.each([
    ['https://api.reactor.inc', 'https://api.reactor.inc'],
    ['https://reactor.example.test/', 'https://reactor.example.test'],
  ])('gives the SDK session and the saved-step download the origin %s', async (apiBaseUrl, origin) => {
    const app = await setup({ apiBaseUrl })
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=8', '-c:v', 'libx264', app.recording])
    const entry = app.entry('pixverse-r2-director', 't2v')
    await Array.fromAsync(entry.render({ ...request, resolution: '720p' }))
    const trace = app.readTrace()
    expect(trace.find(row => row['event'] === 'init')).toMatchObject({ api_url: origin })
    expect(trace.some(row => row['event'] === 'get_saved_step')).toBe(true)
  })
})

describe('Reactor Clip Generation origin', () => {
  it.each(['https://api.reactor.inc', 'https://reactor.example.test'])('sends every authenticated request to %s', async (apiBaseUrl) => {
    const app = await setup({ apiBaseUrl })
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=8', '-c:v', 'libx264', app.recording])
    const calls = installFakeReactor({ origin: apiBaseUrl, video: readFileSync(app.recording) })
    await Array.fromAsync(app.entry('fast-h3', 't2v').render(request))
    const authenticated = calls.filter(call => call.headers.has('authorization')).map(call => new URL(call.url).origin)
    expect(authenticated.length).toBeGreaterThan(0)
    expect(new Set(authenticated)).toEqual(new Set([apiBaseUrl]))
    expect(() => execFileSync('test', ['-e', app.trace])).toThrow()
  })
})
