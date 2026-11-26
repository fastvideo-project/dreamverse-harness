/** Exercise the Reactor model through the bundle Loader, shot tool, and real asset pipeline. */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { formatModelKey, type RenderRequest } from '@dv/models'
import { formatCitation, type AssetId, type OperationToolValue } from '@dv/project'
import { afterEach, expect, it, vi } from 'vitest'
import { FFMPEG } from '../../../dv/api/tests/support.ts'
import { bootBundle, type Bundle } from './bundle.ts'
import { installFakeReactor } from '../../../dv/reactor/tests/fake-reactor-api.ts'
import { boot, disposeBooted, model } from './reactor-support.ts'

let bundle: Bundle | undefined

afterEach(async () => {
  await bundle?.dispose()
  bundle = undefined
  await disposeBooted()
})

it('renders through the configured provider and imports the video and last still', async () => {
  const { ctx, services, recording, trace } = await boot()
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1344x768:r=24',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '5.875', '-c:v', 'libx264', '-c:a', 'aac', recording])
  const calls = installFakeReactor({ video: readFileSync(recording) })
  const submissions = () => calls.filter(call => call.method === 'POST' && call.url.endsWith('/generations')).map(call => call.json)
  expect(ctx.dvModels.list({ provider: 'reactor' }).map(formatModelKey)).toEqual(expect.arrayContaining([
    'video/t2v/reactor/fast-h3-omni', 'video/ref2v/reactor/fast-h3-omni', 'video/fl2v/reactor/fast-h3',
    'video/ref2v/reactor/h3-reference-to-video-turbo-realtime', 'video/l2v/reactor/pika-h3-flex',
    'video/t2v/reactor/pixverse-r2-director', 'video/i2v/reactor/ltx2', 'video/i2v/reactor/helios',
    'video/t2v/reactor/longlive-v2', 'video/i2v/reactor/visko-orbis-dynamic', 'video/t2v/reactor/visko-orbis-stable',
  ]))
  services.chats.open('anonymous', await ctx.dvProject.newProjectFolder('reactor'))
  const call = async (name: string, args: Record<string, unknown>): Promise<OperationToolValue> => {
    const result = await ctx.tools.execute({ name, arguments: args, callId: ToolCallId(name), signal: AbortSignal.timeout(15000) })
    if (result.isError) throw new Error(result.error.message)
    return result.value as OperationToolValue
  }
  await call('dv_proj_create', { title: 'Reactor shot' })
  const imported = await call('dv_asset_import', { reason: 'reference', mime: 'image/png', base64: 'aW1hZ2U=' })
  const image = imported.outputs[0]!.asset_id as AssetId
  const audioImported = await call('dv_asset_import', { reason: 'sound reference', mime: 'audio/wav', base64: 'YXVkaW8=' })
  const audio = audioImported.outputs[0]!.asset_id as AssetId
  const result = await call('dv_shot_render', {
    ...model, task: 'ref2v',
    prompt: `${formatCitation('Person', 'asset', image)} speaks like ${formatCitation('Voice', 'asset', audio)}`,
    duration_sec: 5.875, seed: 42, reason: 'Render a shot with image and sound references',
    inputs: { reference: [audio, image], first_frame: image, last_frame: image },
  })
  expect(result.status).toBe('done')
  const outputIds = result.outputs.map(({ asset_id }) => asset_id as AssetId)
  expect(outputIds.map(asset => ctx.dvAssetPool.get(asset).mime)).toEqual(['video/mp4', 'image/png'])
  const video = ctx.dvAssetPool.get(outputIds[0]!)
  expect(video.duration_sec).toBeCloseTo(5.875)
  expect(await ctx.dvFfmpeg.probe(ctx.dvAssetPool.path(video.id))).toMatchObject({ hasAudio: true, width: 1344, height: 768 })
  expect(submissions()).toEqual([{ model: 'reactor/fast-h3-omni', input: {
    prompt: '<Picture 1> speaks like <Audio 1>', seconds: 5.875, aspect: '16:9', seed: 42,
    reference_images: ['file-1'], reference_audios: ['file-2'], first_frame_image: 'file-3', last_frame_image: 'file-4',
  } }])
  expect(calls.filter(call => call.method === 'POST' && call.url.endsWith('/files')).map(call => call.json)).toEqual([
    { name: 'imported', size: 5, mime_type: 'image/png' }, { name: 'imported', size: 5, mime_type: 'audio/wav' },
    { name: 'imported', size: 5, mime_type: 'image/png' }, { name: 'imported', size: 5, mime_type: 'image/png' },
  ])
  expect(existsSync(trace)).toBe(false)

  expect(ctx.dvHardware.list()).toEqual([])
  expect(ctx.dvModels.resolve(['t2v'], { ...model, task: 't2v' })).toMatchObject({ hosting: 'managed' })
  await call('dv_models_select', { modality: model.modality, provider: model.provider, model: model.model, reason: 'Use Reactor' })
  const direct = await call('dv_shot_render', {
    ...model, task: 't2v', prompt: 'A panda poses in a courtyard', duration_sec: 5.875, seed: 42,
    reason: 'Render one shot from text',
  })
  expect(direct.status).toBe('done')
  const { timings } = direct.report as { timings: Record<string, unknown> }
  expect(Object.keys(timings).sort()).toEqual(['reactor_download_s', 'reactor_generation_s', 'reactor_upload_s'])
  expect(Object.values(timings).every(value => typeof value === 'number')).toBe(true)
  expect(submissions()[1]).toEqual({ model: 'reactor/fast-h3-omni', input: { prompt: 'A panda poses in a courtyard', seconds: 5.875, aspect: '16:9', seed: 42 } })
  expect(calls.filter(call => call.url.endsWith('/files'))).toHaveLength(4)
}, 20_000)

const worldRequest: RenderRequest = {
  prompt: 'A lake at dawn', references: [], firstFrame: null, lastFrame: null,
  durationSec: 8, aspectRatio: '16:9', resolution: '720p', seed: 1, extra: {},
}

const textRequest: RenderRequest = {
  prompt: 'A lake at dawn', references: [], firstFrame: null, lastFrame: null,
  durationSec: 8, aspectRatio: '16:9', resolution: '768p', seed: 1, extra: {},
}

it('extracts the last video frame when the recording audio runs longer', async () => {
  const { ctx, recording } = await boot()
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=3', '-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4', recording])
  installFakeReactor({ video: readFileSync(recording) })
  const entry = ctx.dvModels.resolve(['t2v'], { ...model, task: 't2v' })
  const events = await Array.fromAsync(entry.render(textRequest))
  expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
  expect(events.filter(event => event.kind === 'last_frame' || event.kind === 'chunk').every((event) => {
    return Buffer.isBuffer('png' in event ? event.png : 'bytes' in event ? event.bytes : null)
  })).toBe(true)
  expect(events.at(-1)).toMatchObject({ kind: 'done', durationSec: 1 })
})

it.each([
  { alias: 'helios', aspectRatio: '5:3', resolution: '768p', mode: 'helios-per-chunk', counts: [0, 33, 66, 99, 132] },
  { alias: 'helios', aspectRatio: '5:3', resolution: '768p', mode: 'helios-cumulative', counts: [0, 33, 66, 99, 132] },
  { alias: 'longlive-v2', aspectRatio: '20:11', resolution: '704p', mode: 'chunks', counts: [33, 66, 99, 132] },
  { alias: 'visko-orbis-stable', aspectRatio: '16:9', resolution: '1080p', mode: 'chunks', counts: [0, 44, 44, 44] },
  { alias: 'visko-orbis-dynamic', aspectRatio: '16:9', resolution: '1080p', mode: 'chunks', counts: [0, 44, 44, 44] },
])('waits for enough video from $alias before requesting a recording ($mode)', async (row) => {
  const { alias, aspectRatio, resolution, counts, mode } = row
  const { ctx, recording, readTrace } = await boot()
  vi.stubEnv('DV_REACTOR_MODE', mode)
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=5', '-c:v', 'libx264', recording])
  const entry = ctx.dvModels.resolve(['t2v'], { ...model, model: alias, task: 't2v' })
  await Array.fromAsync(entry.render({ ...textRequest, durationSec: 5, aspectRatio, resolution }))
  const field = alias === 'helios' ? 'current_frame' : 'frames_emitted'
  const trace = readTrace().filter(entry => entry['event'] === 'read_progress' || entry['event'] === 'capture')
  expect(trace).toEqual([...counts.map(frames => ({ event: 'read_progress', field, frames })), { event: 'capture', seconds: 5 }])
})

it('closes the session after a build failure or cancellation', async () => {
  const { ctx, trace, readTrace } = await boot()
  const entry = ctx.dvModels.resolve(['t2v'], { ...model, model: 'pixverse-r2-director', task: 't2v' })
  vi.stubEnv('DV_REACTOR_MODE', 'fail')
  await expect(entry.render(worldRequest)[Symbol.asyncIterator]().next()).rejects.toThrow('Reactor could not finish')
  expect(readTrace().at(-2)).toEqual({ event: 'disconnect' })
  vi.stubEnv('DV_REACTOR_MODE', 'wait')
  const controller = new AbortController()
  const result = entry.render(worldRequest, controller.signal)[Symbol.asyncIterator]().next()
  const reason = new Error('Cancelled by operator')
  try {
    await expect.poll(() => existsSync(trace) && readTrace().filter(row => row['event'] === 'enqueue').length).toBe(2)
  } finally {
    controller.abort(reason)
    await expect(result).rejects.toBe(reason)
  }
  expect(readTrace().slice(-2)).toEqual([{ event: 'disconnect' }, { event: 'close' }])
})

it('waits for local media processing and scratch cleanup when Reactor unloads', async () => {
  const { ctx, recording } = await boot()
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=8', '-c:v', 'libx264', recording])
  installFakeReactor({ video: readFileSync(recording) })
  const fiber = [...ctx.loader.entries()].find(entry => entry.options.id === 'dv-reactor')?.fiber
  if (fiber === undefined) throw new Error('Missing Reactor plugin fiber')
  const entry = ctx.dvModels.resolve(['t2v'], { ...model, task: 't2v' })
  const started = Promise.withResolvers<string>()
  const release = Promise.withResolvers<undefined>()
  const run = ctx.dvFfmpeg.run.bind(ctx.dvFfmpeg)
  const remux = vi.spyOn(ctx.dvFfmpeg, 'run').mockImplementation(async (request) => {
    started.resolve(request.dir)
    await release.promise
    return await run(request)
  })
  const outcome = entry.render(textRequest)[Symbol.asyncIterator]().next().then(() => null, (error: unknown) => error)
  let unload: Promise<void> | undefined
  try {
    const scratch = await Promise.race([
      started.promise,
      outcome.then((error) => { throw new Error('Render settled before remux', { cause: error }) }),
    ])
    expect(existsSync(scratch)).toBe(true)
    unload = Promise.resolve(fiber.dispose())
    const first = await Promise.race([
      unload.then(() => 'unloaded'),
      new Promise((resolve) => { setImmediate(resolve, 'waiting') }),
    ])
    expect(first).toBe('waiting')
    release.resolve(undefined)
    await unload
    expect(existsSync(scratch)).toBe(false)
    expect(await outcome).toMatchObject({ message: 'The Reactor provider was unloaded.' })
  } finally {
    release.resolve(undefined)
    await outcome
    await unload
    remux.mockRestore()
  }
})

it('uses the model workflow for a scripted take, a continuous stream, and a saved clip', async () => {
  const { ctx, recording, readTrace } = await boot()
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=24:d=8', '-c:v', 'libx264', recording])
  const origin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'create' } as const
  const project = await ctx.dvProject.createProject(await ctx.dvProject.newProjectFolder('reactor-workflows'), 'workflows', origin)
  const firstFrame = ctx.dvAssetPool.importAsset(project.id, Buffer.from('image'), { mime: 'image/png', name: 'avatar.png' }, null)
  const ltx = ctx.dvModels.resolve(['i2v'], { ...model, model: 'ltx2', task: 'i2v' })
  const longLive = ctx.dvModels.resolve(['t2v'], { ...model, model: 'longlive-v2', task: 't2v' })
  const pixverse = ctx.dvModels.resolve(['t2v'], { ...model, model: 'pixverse-r2-director', task: 't2v' })
  const render = async (entry: typeof ltx | typeof longLive, request: RenderRequest): Promise<void> => {
    const kinds: string[] = []
    for await (const event of entry.render(request)) kinds.push(event.kind)
    expect(kinds).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
  }
  await render(ltx, { ...textRequest, firstFrame, aspectRatio: '20:11', resolution: '352p', extra: { scene: 'Studio' } })
  await render(longLive, { ...textRequest, aspectRatio: '20:11', resolution: '704p' })
  await render(pixverse, { ...textRequest, resolution: '720p', extra: { scene: 'A coastal town' } })
  const trace = readTrace()
  expect(trace).toEqual(expect.arrayContaining([
    { event: 'set_script', script: textRequest.prompt },
    { event: 'set_duration_seconds', duration_seconds: 8 },
    { event: 'set_shot', prompt: textRequest.prompt },
    { event: 'create_world', prompt: 'A coastal town', aspect_ratio: '16:9' },
    { event: 'get_saved_step' },
    { event: 'download_saved_output' },
  ]))
  expect(trace.filter(row => row['event'] === 'disconnect')).toHaveLength(3)
  expect(trace.filter(row => row['event'] === 'capture')).toHaveLength(2)
}, 20_000)

it('reports a failed Clip Generation render and a cancelled one through the model entry', async () => {
  const { ctx, trace } = await boot()
  const entry = ctx.dvModels.resolve(['t2v'], { ...model, task: 't2v' })
  installFakeReactor({ statuses: [Response.json({
    status: 'failed', files: null, error: { code: 'moderated', message: 'The prompt was moderated' },
  })] })
  await expect(Array.fromAsync(entry.render(textRequest))).rejects.toThrow('Reactor generation gen-1 failed with moderated: The prompt was moderated.')
  const calls = installFakeReactor({ statuses: [Response.json({ status: 'running', files: null })] })
  const controller = new AbortController()
  const outcome = entry.render(textRequest, controller.signal)[Symbol.asyncIterator]().next()
  const reason = new Error('Cancelled by operator')
  await vi.waitFor(() => { expect(calls.some(call => call.url.endsWith('/generations/gen-1'))).toBe(true) })
  controller.abort(reason)
  await expect(outcome).rejects.toBe(reason)
  expect(calls.filter(call => call.method === 'DELETE').map(call => new URL(call.url).pathname)).toEqual(['/sessions/gen-1'])
  expect(existsSync(trace)).toBe(false)
})

it('adds and removes Reactor entries when the Loader applies new settings', async () => {
  bundle = await bootBundle()
  const { ctx } = bundle
  const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'dv-reactor')
  if (provider === undefined) throw new Error('Missing Reactor loader entry')
  const fiber = provider.fiber
  expect(ctx.dvModels.list({ provider: 'reactor' })).toEqual([])
  await provider.update({ config: { models: { 'fast-h3-omni': { profile: 'fast-h3-omni' } } } })
  expect(ctx.dvModels.list({ provider: 'reactor' }).map(formatModelKey)).toEqual([
    'video/t2v/reactor/fast-h3-omni', 'video/ref2v/reactor/fast-h3-omni',
  ])
  expect(provider.fiber).toBe(fiber)
  await provider.update({ config: { models: {} } })
  expect(ctx.dvModels.list({ provider: 'reactor' })).toEqual([])
})
