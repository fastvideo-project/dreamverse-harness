/**
 * The Shot render component in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, the asset
 * pool, `dvProject`, `dvFfmpeg`, `dvModels` and `dvShotRender` through the Loader. The video model is the only fake:
 * an in-process model `fake` whose modes render solid-color clips with ffmpeg. A test-only `bible` reducer stands
 * for the Story bible, so references can name character versions.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvProject, {
  type AssetId, type CharacterId, type OperationSpec, type OperationToolValue, type ProjectId, type ProjectRecord, type RecordId,
  type RecordInputRef, type Reducer, type RunRequest, type SessionId,
} from '@dv/project'
import DvModels, { type ModeId, type ModelEntry, type RenderModelFacts, type RenderRequest, type RenderStreamEvent } from '@dv/models'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DvShotRender from '../src/index.ts'
import { backendSeconds, imageLabels, shotGeometry } from '../src/render.ts'

const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

const run = promisify(execFile)

/** Frame counts for each whole-second duration from `min` to `max`. */
function framesByDuration(min: number, max: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: max - min + 1 }, (_value, index) => [String(min + index), (min + index) * 24 + 1]))
}

/** Facts with small frames so the fake model renders quickly; mode `reference` takes two reference images. */
function testFacts(mode: ModeId): RenderModelFacts {
  return {
    modelId: `test-${mode}`, aspectRatios: ['16:9', '9:16'], resolutions: ['720p'],
    frameSizes: { '16:9': { '720p': [192, 112] }, '9:16': { '720p': [112, 192] } }, minDurationSec: 1, maxDurationSec: 5,
    numFramesByDurationSec: framesByDuration(1, 5), maxReferenceImages: mode === 'reference' ? 2 : 0,
    imageLabels: mode === 'reference' ? ['Picture 1', 'Picture 2', 'Picture 3'] : [], gpuSecondsPerVideoSecond: mode === 'reference' ? 3 : 1.5,
  }
}

/** The model and mode params of a render of the fake model in mode `reference`. */
const REF = { model: 'fake', mode: 'reference' }

/** The model and mode params of a render of the fake model in mode `text`. */
const TXT = { model: 'fake', mode: 'text' }

/**
 * Render a solid-color clip and its last frame with ffmpeg.
 * @returns the bytes of the clip and the frame.
 */
async function renderClip(dir: string, width: number, height: number, numFrames: number): Promise<{ video: Buffer; lastFrame: Buffer }> {
  const video = join(dir, 'clip.mp4')
  const frame = join(dir, 'last.png')
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x3366cc:s=${width}x${height}:d=${(numFrames / 24).toFixed(3)}:r=24`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video])
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-sseof', '-0.05', '-i', video, '-frames:v', '1', frame])
  return { video: readFileSync(video), lastFrame: readFileSync(frame) }
}

/** One mode of the fake model: it renders a solid-color clip for every request and remembers the requests. */
class FakeLane {
  readonly requests: RenderRequest[] = []
  /** When set, `render` rejects with this error before streaming. */
  failure: Error | null = null
  /** An event to leave out of the stream, to exercise the stream checks. */
  omit: 'last_frame' | 'done' | null = null
  /** Extra zero bytes appended as one chunk, to exercise write backpressure. */
  padChunkBytes = 0

  constructor(public facts: RenderModelFacts) {}

  async *render(request: RenderRequest): AsyncIterable<RenderStreamEvent> {
    this.requests.push(request)
    if (this.failure !== null) throw this.failure
    const dir = mkdtempSync(join(tmpdir(), 'dv-fake-render-'))
    try {
      const rendered = await renderClip(dir, request.frameWidth, request.frameHeight, request.numFrames)
      if (this.omit !== 'last_frame') yield { kind: 'last_frame', png: rendered.lastFrame }
      yield { kind: 'video_start', mime: 'video/mp4; codecs="avc1.64001f"' }
      const half = Math.floor(rendered.video.length / 2)
      yield { kind: 'chunk', bytes: rendered.video.subarray(0, half) }
      yield { kind: 'chunk', bytes: rendered.video.subarray(half) }
      if (this.padChunkBytes > 0) yield { kind: 'chunk', bytes: Buffer.alloc(this.padChunkBytes) }
      if (this.omit !== 'done') yield { kind: 'done', timings: { generation_s: 0.25, encode_s: 0.05 } }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * The catalog entry of the fake model `fake`, in the modes its lanes serve; mode `reference` takes the extra parameter
 * `strength`.
 * @param lanes - the lane of each served mode.
 * @returns the entry.
 */
function fakeModel(lanes: Partial<Record<ModeId, FakeLane>>): ModelEntry {
  const modes: ModelEntry['modes'] = {}
  if (lanes.reference !== undefined) {
    modes.reference = {
      inputs: { reference: { min: 1 }, first_frame: { min: 0 } },
      extra: { strength: { type: 'number', description: 'How strongly the references bind.' } },
    }
  }
  if (lanes.text !== undefined) modes.text = { inputs: {}, extra: {} }
  const lane = (mode: ModeId): FakeLane => {
    const found = lanes[mode]
    if (found === undefined) throw new Error(`fake serves no mode ${mode}`)
    return found
  }
  return {
    id: 'fake', company: 'test', summary: 'Solid-color clips', modes,
    facts: mode => Promise.resolve(lane(mode).facts),
    render: (mode, request) => lane(mode).render(request),
  }
}

/** One live shot as the fake live stream service saw it. */
interface LiveShot {
  record: RecordId
  init: { mime: string; segmentIdx: number }
  bytes: number
  end: 'complete' | 'failed' | null
}

/** A live stream service that remembers what each shot sent. */
class FakeLiveStream {
  readonly shots: LiveShot[] = []

  openSegment(_project: ProjectId, record: RecordId, init: { mime: string; segmentIdx: number }) {
    const shot: LiveShot = { record, init, bytes: 0, end: null }
    this.shots.push(shot)
    return {
      chunk: (bytes: Uint8Array) => { shot.bytes += bytes.byteLength },
      complete: () => { shot.end = 'complete' },
      fail: () => { shot.end = 'failed' },
    }
  }
}

/** The test-only Story bible slice: each character's versions, each with its reference images and its record. */
type BibleSlice = Record<string, Array<{ references: AssetId[]; record: RecordId }>>

/** The test-only `bible.character_create`: records a character version whose references are its input assets. */
const characterCreate: OperationSpec = {
  name: 'bible.character_create', component: 'bible', version: '1', description: 'Register a character.',
  params: { character: { type: 'string', required: true, description: 'The character ID.' } },
  inputs: { reference: { type: 'image', many: true, description: 'Reference images.' } },
  outputs: [], deterministic: true, resource: 'none', confirm: 'never', summarize: () => 'character',
  execute: () => Promise.resolve({ outputs: [] }),
}

/** The version a character reference names in the test-only slice. */
function versionOf(slice: BibleSlice, ref: RecordInputRef) {
  return 'character' in ref ? slice[ref.character]?.[ref.version - 1] ?? null : null
}

/** The test-only `bible` reducer, which answers `createdBy` and `assetsOf` the way the Story bible does. */
const bibleReducer: Reducer<never> & { initial(): BibleSlice } = {
  initial: () => ({}),
  reduce(slice: BibleSlice, record: ProjectRecord): BibleSlice {
    if (record.operation !== 'bible.character_create' || record.status !== 'done') return slice
    const id = String(record.params['character'])
    const references = record.inputs.flatMap(input => input.resolved_asset === null ? [] : [input.resolved_asset])
    return { ...slice, [id]: [...slice[id] ?? [], { references, record: record.id }] }
  },
  createdBy: (slice: BibleSlice, ref: RecordInputRef) => versionOf(slice, ref)?.record ?? null,
  assetsOf: (slice: BibleSlice, ref: RecordInputRef) => versionOf(slice, ref)?.references ?? null,
} as never

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvShotRender }

interface Fixture {
  ctx: Context
  dir: string
  /** The fake model's lane of mode `reference`. */
  reference: FakeLane
  /** The fake model's lane of mode `text`. */
  text: FakeLane
  project: ProjectId
  /** Store bytes in the asset pool. */
  put(bytes: Uint8Array, mime: string, name: string): AssetId
  /** Run one operation as the human, on `main`. */
  record(operation: string, params: Record<string, unknown>, inputs?: RunRequest['inputs'], extra?: Partial<RunRequest>): Promise<ProjectRecord>
  /** Run one tool as the agent of chat session `s1`, which is bound to `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param options - the modes the fake model is registered in (both by default; none registers no model), whether a live
 *   stream service is provided, and the GPU budget of a turn.
 * @returns the fixture, with a project bound to chat session `s1` and the test-only character operation.
 */
async function start(options: { modes?: ModeId[]; live?: FakeLiveStream; budget?: number } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-shot-render-'))
  const globals = globalThis as typeof globalThis & { __dvShotRenderComposition?: typeof PLUGINS }
  globals.__dvShotRenderComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvShotRenderComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  const modes = options.modes ?? ['reference', 'text']
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [
    `root: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`, `confirmGpuSecondsThreshold: ${options.budget ?? 60}`,
  ])
  row('dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, `ffprobePath: ${FFPROBE}`])
  row('dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`])
  row('dv-models', 'DvModels', [])
  row('dv-shot-render', 'DvShotRender', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const reference = new FakeLane(testFacts('reference'))
  const text = new FakeLane(testFacts('text'))
  if (options.live !== undefined) ctx.provide('vhStream', options.live) // names:allow (the live stream service keeps its name)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const lanes = { ...modes.includes('reference') ? { reference } : {}, ...modes.includes('text') ? { text } : {} }
  if (Object.keys(lanes).length > 0) ctx.effect(() => ctx.dvModels.register(fakeModel(lanes)))
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  ctx.effect(() => ctx.dvProject.registerReducer('bible' as never, bibleReducer))
  ctx.effect(() => ctx.dvProject.registerOperation(characterCreate))
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null }
  const project = (await ctx.dvProject.createProject('shots', { ...origin, intent: 'create' })).id
  ctx.dvProject.bindSession(brandString<SessionId>('s1'), project)
  let calls = 0
  return {
    ctx, dir, reference, text, project,
    put: (bytes, mime, name) => ctx.dvAssetPool.importAsset(bytes, { mime, name }, null),
    async record(operation, params, inputs = [], extra = {}) {
      const result = await ctx.dvProject.run({ ...origin, project, operation, params, inputs, intent: operation, ...extra })
      if (result.record === null) throw new Error(`${operation} wrote no record`)
      return result.record
    },
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
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

/** A project whose character c1@1 has one reference image. */
async function withCharacter(fixture: Fixture, bytes: Uint8Array = Buffer.from('PNG-FAKE')): Promise<AssetId> {
  const image = fixture.put(bytes, 'image/png', 'face.png')
  await fixture.record('bible.character_create', { character: 'c1' }, [{ role: 'reference', ref: { asset: image } }])
  return image
}

/** The reference input of character c1 at version `version`. */
function c1(version = 1): RunRequest['inputs'][number] {
  return { role: 'reference', ref: { character: brandString<CharacterId>('c1'), version } }
}

/** The registered spec of a render operation. */
function renderSpec(fixture: Fixture, name = 'shot.render'): OperationSpec | undefined {
  return fixture.ctx.dvProject.listOperations().find(spec => spec.name === name)
}

describe.skipIf(!existsSync(FFMPEG))('dvShotRender', () => {
  it('registers shot.render while the catalog holds a model, follows the catalog, and removes it on disposal', async () => {
    const fixture = await start()
    expect(renderSpec(fixture)).toMatchObject({ component: 'shot', resource: 'gpu', confirm: 'over_gpu_budget', deterministic: false })
    // Each estimate uses the GPU rate the model reports for the call's mode.
    await vi.waitFor(() => { expect(renderSpec(fixture)?.estimate?.({ ...REF, duration_sec: 2 })).toEqual({ gpu_seconds: 6 }) })
    expect(renderSpec(fixture)?.estimate?.({ ...TXT })).toEqual({ gpu_seconds: 7.5 })
    expect(renderSpec(fixture)?.estimate?.({ model: 'other', mode: 'text' })).toEqual({ gpu_seconds: 0 })
    // An approved plan schedules renders with the params `plan`, `plan_version` and `shot`, so the spec declares them.
    expect(Object.keys(renderSpec(fixture)?.params ?? {})).toEqual(expect.arrayContaining(['model', 'mode', 'extra', 'plan', 'plan_version', 'shot']))
    expect(renderSpec(fixture)?.params['model']).toMatchObject({ enum: ['fake'], required: true })
    expect(renderSpec(fixture)?.params['mode']).toMatchObject({ enum: ['reference', 'text'], required: true })
    const tool = fixture.ctx.tools.schemas().find(schema => schema.name === 'dv_shot_render')
    expect(tool?.description).toContain('model and mode are required')
    expect(tool?.description).toContain('Uses the GPU.')
    expect(JSON.stringify(tool?.parameters)).toContain('continue_from')
    expect(JSON.stringify(tool?.parameters)).toContain('user_requested')
    // A second model joins the `model` enum; removing it takes it out again.
    const remove = fixture.ctx.dvModels.register({ ...fakeModel({ text: new FakeLane(testFacts('text')) }), id: 'other' })
    expect(renderSpec(fixture)?.params['model']).toMatchObject({ enum: ['fake', 'other'] })
    expect(JSON.stringify(fixture.ctx.tools.schemas().find(schema => schema.name === 'dv_shot_render')?.parameters)).toContain('"other"')
    remove()
    expect(renderSpec(fixture)?.params['model']).toMatchObject({ enum: ['fake'] })
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-shot-render.mjs'))
    await entry?.fiber?.dispose()
    expect(renderSpec(fixture)).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_shot_render')).toBeUndefined()
    // The reducer went with the plugin: a state no longer has the `shot` slice.
    expect(fixture.ctx.dvProject.getState(fixture.project).components).not.toHaveProperty('shot')
  })

  it('refuses a mode the model does not support, an unknown model, and unknown extra parameters', async () => {
    const fixture = await start({ modes: ['reference'] })
    await withCharacter(fixture)
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.record('shot.render', { ...TXT, prompt: 'a cat' })).rejects.toThrow('Model fake does not support mode "text"; its modes: reference.')
    await expect(fixture.record('shot.render', { model: 'nope', mode: 'reference', prompt: 'a cat' }, [c1()])).rejects.toMatchObject({ code: 'invalid_params' })
    await expect(fixture.record('shot.render', { ...REF, prompt: 'a cat', extra: { cfg: 7 } }, [c1()]))
      .rejects.toThrow('fake has no extra parameter `cfg` in mode reference; its extra parameters: strength.')
    await expect(fixture.record('shot.render', { ...REF, prompt: 'a cat', extra: { strength: 'high' } }, [c1()])).rejects.toThrow('extra')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    const shot = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves', extra: { strength: 0.5 } }, [c1()])
    expect(shot.status).toBe('done')
    expect(fixture.reference.requests[0]?.extra).toEqual({ strength: 0.5 })
  })

  it('refuses inputs a mode does not take, and continue_from where the model takes no first frame', async () => {
    const fixture = await start()
    await withCharacter(fixture)
    await expect(fixture.record('shot.render', { ...TXT, prompt: 'a cat' }, [c1()])).rejects.toThrow('Model fake in mode text takes no reference input; it takes: no inputs.')
    const shot = await fixture.record('shot.render', { ...TXT, prompt: 'A street at dawn' })
    expect(failure(await fixture.call('dv_shot_render', { ...TXT, reason: 'next', prompt: 'later', continue_from: shot.id })))
      .toContain('Model fake in mode text takes no first frame, so continue_from does not apply.')
  })

  it('has no render operation without a model', async () => {
    const fixture = await start({ modes: [] })
    expect(renderSpec(fixture)).toBeUndefined()
    expect(fixture.ctx.tools.schemas().filter(tool => tool.name.startsWith('dv_shot_render'))).toEqual([])
    expect(fixture.ctx.dvProject.getState(fixture.project).components.shot).toEqual({ takes: {}, roots: {} })
    const call = { record: { operation: 'shot.render' }, params: { ...REF, prompt: 'x' } } as never
    await expect(fixture.ctx.dvShotRender.renderShot(call)).rejects.toThrow('Unknown model "fake"; models: none.')
  })

  it('renders a take in mode reference with references and a first frame, keeps the seed, and stores both outputs', async () => {
    const fixture = await start()
    const image = await withCharacter(fixture)
    const shot = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves', duration_sec: 2, seed: 42 }, [c1()])
    expect(shot).toMatchObject({ status: 'done', component: 'shot', operation: 'shot.render', operation_version: '1', actor: 'user' })
    expect(shot.inputs).toEqual([{ role: 'reference', ref: { character: 'c1', version: 1 }, resolved_asset: image }])
    const pool = fixture.ctx.dvAssetPool
    const size = { width: 192, height: 112 }
    expect(pool.get(shot.outputs[0] as AssetId)).toMatchObject({ mime: 'video/mp4', duration_sec: 2, created_by: shot.id, ...size })
    expect(pool.get(shot.outputs[1] as AssetId)).toMatchObject({ mime: 'image/png', name: `${shot.id.slice(0, 8)}-last.png`, ...size })
    expect((await fixture.ctx.dvFfmpeg.probe(pool.path(shot.outputs[0] as AssetId))).durationSec).toBeCloseTo(2, 0)
    expect(shot.report).toMatchObject({ seed: 42, model: 'fake', mode: 'reference', model_id: 'test-reference', frame_width: 192, num_frames: 49, image_labels: { referenceLabels: ['Picture 1'], firstFrameLabel: null } })
    expect(shot.report).not.toHaveProperty('generation_mode')
    expect(shot.cost).toMatchObject({ gpu_seconds: 0.25, reused: false })
    expect(fixture.reference.requests[0]).toMatchObject({ prompt: 'Picture 1 waves', frameWidth: 192, frameHeight: 112, numFrames: 49, seed: 42, firstFrame: null })
    expect(fixture.reference.requests[0]?.references[0]?.equals(pool.read(image))).toBe(true)
    expect(renderSpec(fixture)?.summarize(shot)).toBe('shot "Picture 1 waves" (2s, seed 42)')
    const { report: _report, ...withoutReport } = shot
    expect(renderSpec(fixture)?.summarize({ ...withoutReport, params: {} })).toBe('shot "" (?s, seed ?)')
    expect(renderSpec(fixture)?.summarize({ ...withoutReport, params: { prompt: 'x', plan: 'p1', plan_version: 2, shot: 7 } }))
      .toBe('shot 7 of plan p1 v2 "x" (?s, seed ?)')
    // The next shot continues from the last still; the still is the first frame and gets the label after the references.
    const next = await fixture.record('shot.render', { ...REF, prompt: 'keeps waving' }, [c1(), { role: 'first_frame', ref: { record: shot.id, output: 1 } }])
    expect(fixture.reference.requests[1]?.references).toHaveLength(1)
    expect(fixture.reference.requests[1]?.firstFrame?.equals(pool.read(shot.outputs[1] as AssetId))).toBe(true)
    expect(next.report).toMatchObject({ duration_sec: 1, image_labels: { referenceLabels: ['Picture 1'], firstFrameLabel: 'Picture 2' } })
    expect(renderSpec(fixture)?.summarize(next)).toBe(`shot "keeps waving" (1s, seed ${String(next.report?.['seed'])})`)
  })

  it('renders a take in mode text from the prompt only', async () => {
    const fixture = await start()
    const shot = await fixture.record('shot.render', { ...TXT, prompt: 'A baker opens the shutters', duration_sec: 3, seed: 5, aspect_ratio: '9:16' })
    expect(shot).toMatchObject({ status: 'done', component: 'shot', operation: 'shot.render', inputs: [] })
    expect(fixture.text.requests).toEqual([{
      prompt: 'A baker opens the shutters', references: [], firstFrame: null, frameWidth: 112, frameHeight: 192, numFrames: 73, seed: 5, extra: {},
    }])
    expect(fixture.reference.requests).toHaveLength(0)
    expect(shot.report).toMatchObject({ seed: 5, model: 'fake', mode: 'text', model_id: 'test-text', aspect_ratio: '9:16', resolution: '720p', duration_sec: 3, frame_width: 112 })
    expect(shot.report).not.toHaveProperty('image_labels')
    expect(fixture.ctx.dvAssetPool.get(shot.outputs[1] as AssetId)).toMatchObject({ mime: 'image/png', width: 112, height: 192 })
    expect(renderSpec(fixture)?.summarize(shot)).toBe('shot "A baker opens the shutters" (3s, seed 5)')
    // A text take's last still can start a shot in mode reference.
    await withCharacter(fixture)
    const next = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 enters' }, [c1(), { role: 'first_frame', ref: { record: shot.id, output: 1 } }])
    expect(next.status).toBe('done')
  })

  it('groups the takes of a shot in the shot slice for every mode', async () => {
    const fixture = await start()
    await withCharacter(fixture)
    const first = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves' }, [c1()])
    const retake = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves slowly' }, [c1()], { based_on: first.id, supersedes: [first.id] })
    const third = await fixture.record('shot.render', { ...TXT, prompt: 'A man waves twice' }, [], { based_on: retake.id })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.shot).toEqual({
      takes: { [first.id]: [first.id, retake.id, third.id] }, roots: { [retake.id]: first.id, [third.id]: first.id },
    })
  })

  it('runs the agent tools at the end of the project\'s history, with continue_from as the first frame', async () => {
    const fixture = await start()
    const image = await withCharacter(fixture)
    const shot = value(await fixture.call('dv_shot_render', { ...REF, reason: 'first shot', prompt: 'Picture 1 waves', duration_sec: 1, inputs: { reference: 'c1@1' } }))
    expect(shot).toMatchObject({ status: 'done', scheduled: [], params: { prompt: 'Picture 1 waves', duration_sec: 1 } })
    expect(shot.outputs.map(output => output.role)).toEqual(['video', 'last_still'])
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(shot.record))
    expect(record).toMatchObject({ actor: 'agent', surface: 'chat', intent: 'first shot', component: 'shot', operation: 'shot.render' })
    expect(record.inputs).toEqual([{ role: 'reference', ref: { character: 'c1', version: 1 }, resolved_asset: image }])
    const next = value(await fixture.call('dv_shot_render', { ...REF, reason: 'second shot', prompt: 'keeps waving', inputs: { reference: [image] }, continue_from: shot.record }))
    expect(next.params).not.toHaveProperty('continue_from')
    expect(fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(next.record)).inputs.find(input => input.role === 'first_frame'))
      .toEqual({ role: 'first_frame', ref: { record: shot.record, output: 1 }, resolved_asset: shot.outputs[1]?.asset_id })
    const fromText = value(await fixture.call('dv_shot_render', { ...TXT, reason: 'establishing shot', prompt: 'A quiet street at dawn', duration_sec: 1 }))
    expect(fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(fromText.record)))
      .toMatchObject({ actor: 'agent', operation: 'shot.render', inputs: [] })
  })

  it('asks for the user\'s agreement once a turn passes the GPU budget', async () => {
    const fixture = await start({ budget: 5 })
    await withCharacter(fixture)
    const args = { ...REF, reason: 'long shot', prompt: 'Picture 1 walks a long way', duration_sec: 2, inputs: { reference: 'c1@1' } }
    const refused = failure(await fixture.call('dv_shot_render', args))
    expect(refused).toContain('dv_shot_render would bring this turn to about 6 GPU seconds, above the 5 s budget.')
    expect(refused).toContain('Render shot with fake (reference), 2 s: "Picture 1 walks a long way"')
    expect(fixture.reference.requests).toHaveLength(0)
    expect(value(await fixture.call('dv_shot_render', { ...args, user_requested: true })).status).toBe('done')
    const summary = renderSpec(fixture)?.confirmSummary?.({
      args: {}, request: { params: { ...TXT, prompt: 'x', plan: 'p1', plan_version: 1, shot: 3 } }, state: {}, exec: {},
    } as never, {} as never)
    expect(summary).toEqual({ text: 'Render shot 3 of plan p1 v1 with fake (text): "x"', gpu_seconds: 7.5 })
  })

  it('refuses an agent call without reference images before recording anything', async () => {
    const fixture = await start()
    await fixture.record('bible.character_create', { character: 'c2' })
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    const noImages = await fixture.call('dv_shot_render', { ...REF, reason: 'cat', prompt: 'a cat', inputs: { reference: 'c2@1' } })
    expect(failure(noImages)).toContain('from 1 to 2 reference images, and this shot has none. Nothing was rendered.')
    // With a model in mode text registered, the refusal names it.
    expect(failure(noImages)).toContain('A shot that needs no reference image can use mode text with fake.')
    expect(failure(await fixture.call('dv_shot_render', { ...REF, reason: 'cat', prompt: 'a cat' }))).toContain('this shot has none')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    expect(fixture.reference.requests).toHaveLength(0)
  })

  it('refuses a call of any caller without reference images before recording anything', async () => {
    const fixture = await start({ modes: ['reference'] })
    await fixture.record('bible.character_create', { character: 'c2' })
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    const c2 = { role: 'reference', ref: { character: brandString<CharacterId>('c2'), version: 1 } }
    await expect(fixture.record('shot.render', { ...REF, prompt: 'a cat' }, [c2])).rejects.toThrow(
      'Model fake in mode reference renders a shot from 1 to 2 reference images, and this shot has none. Nothing was rendered. Ask the user '
      + 'for a reference image of the subject (they can attach one in the chat; it appears under Imported images), add it as a '
      + 'reference or to the character, then call again.',
    )
    // A render that a plan scheduled is told to update the plan; the plan approval names its shots.
    await expect(fixture.record('shot.render', { ...REF, prompt: 'a cat', plan: 'p1', plan_version: 1, shot: 2 }, [c2]))
      .rejects.toThrow('from 1 to 2 reference images. Nothing was rendered.')
    await expect(fixture.record('shot.render', { ...REF, prompt: 'a cat', plan: 'p1', plan_version: 1, shot: 2 }, [c2]))
      .rejects.toThrow(/to the character, update the plan with dv_plan_update, then call again\.$/)
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    expect(fixture.reference.requests).toHaveLength(0)
    // The precondition counts a character version's reference images: one image is enough.
    await withCharacter(fixture)
    expect((await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves' }, [c1()])).status).toBe('done')
  })

  it('fails requests the model cannot serve and records stream failures', async () => {
    const fixture = await start()
    const image = await withCharacter(fixture)
    const failed = async (params: Record<string, unknown>, inputs: RunRequest['inputs'] = [c1()], mode: ModeId = 'reference'): Promise<string> => {
      const shot = await fixture.record('shot.render', { model: 'fake', mode, ...params }, inputs)
      expect(shot.status).toBe('failed')
      return shot.error?.message ?? ''
    }
    await expect(fixture.record('shot.render', { ...REF }, [c1()])).rejects.toMatchObject({ code: 'invalid_params' })
    expect(await failed({ prompt: '' })).toContain('shot.render needs a `prompt`')
    expect(await failed({ prompt: '' }, [], 'text')).toContain('shot.render needs a `prompt`')
    await expect(fixture.record('shot.render', { ...REF, prompt: 'x' }, [])).rejects.toThrow('this shot has none')
    const three = [c1(), { role: 'reference', ref: { asset: image } }, { role: 'reference', ref: { asset: image } }]
    expect(await failed({ prompt: 'x' }, three)).toContain('Model fake takes at most 2 reference images in mode reference; this shot has 3.')
    expect(await failed({ prompt: 'x', duration_sec: 7 })).toContain('duration_sec')
    expect(await failed({ prompt: 'x', resolution: '4k' }, [], 'text')).toContain('aspect_ratio and resolution')
    fixture.reference.omit = 'done'
    expect(await failed({ prompt: 'x' })).toContain('ended before the backend reported completion')
    fixture.reference.omit = 'last_frame'
    expect(await failed({ prompt: 'x' })).toContain('no last frame')
    fixture.reference.omit = null
    fixture.reference.failure = new Error('backend down')
    expect(await failed({ prompt: 'x' })).toBe('backend down')
    fixture.text.failure = new Error('text backend down')
    expect(await failed({ prompt: 'x' }, [], 'text')).toBe('text backend down')
    expect(fixture.ctx.dvProject.getState(fixture.project).components.shot).toEqual({ takes: {}, roots: {} })
  })

  it('drains large chunks into the video file', async () => {
    const fixture = await start()
    await withCharacter(fixture)
    fixture.reference.padChunkBytes = 256 * 1024
    const shot = await fixture.record('shot.render', { ...REF, prompt: 'big' }, [c1()])
    expect(fixture.ctx.dvAssetPool.get(shot.outputs[0] as AssetId).size_bytes).toBeGreaterThan(256 * 1024)
  })

  it('broadcasts the shot to the live stream service while the provider streams it', async () => {
    const live = new FakeLiveStream()
    const fixture = await start({ live })
    await withCharacter(fixture)
    const shot = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves', shot: 3 }, [c1()])
    expect(live.shots).toEqual([{ record: shot.id, init: { mime: 'video/mp4; codecs="avc1.64001f"', segmentIdx: 3 }, bytes: fixture.ctx.dvAssetPool.get(shot.outputs[0] as AssetId).size_bytes, end: 'complete' }])
    fixture.reference.omit = 'done'
    await fixture.record('shot.render', { ...REF, prompt: 'cut short' }, [c1()])
    expect(live.shots[1]).toMatchObject({ init: { segmentIdx: 0 }, end: 'failed' })
  })
})

describe('render geometry, image labels and timings', () => {
  it('derives the geometry from the model facts', () => {
    const facts = testFacts('reference')
    expect(shotGeometry(facts, {})).toEqual({ aspectRatio: '16:9', resolution: '720p', width: 192, height: 112, durationSec: 1, numFrames: 25 })
    expect(shotGeometry(facts, { aspect_ratio: '9:16', duration_sec: 3 })).toMatchObject({ width: 112, height: 192, numFrames: 73 })
    expect(() => shotGeometry(facts, { aspect_ratio: '4:3' })).toThrow('aspect_ratio and resolution')
    expect(() => shotGeometry(facts, { resolution: '480p' })).toThrow('aspect_ratio and resolution')
    expect(() => shotGeometry(facts, { duration_sec: 9 })).toThrow('duration_sec must be a whole number from 1 to 5')
    expect(() => shotGeometry({ ...facts, aspectRatios: [] }, {})).toThrow('aspect_ratio and resolution')
  })

  it('labels the reference images in order, then the first frame', () => {
    const facts = testFacts('reference')
    expect(imageLabels(facts, 2, true)).toEqual({ referenceLabels: ['Picture 1', 'Picture 2'], firstFrameLabel: 'Picture 3' })
    expect(imageLabels(facts, 1, false)).toEqual({ referenceLabels: ['Picture 1'], firstFrameLabel: null })
    expect(imageLabels(facts, 3, true)).toEqual({ referenceLabels: ['Picture 1', 'Picture 2', 'Picture 3'], firstFrameLabel: null })
  })

  it('reports the longest backend timing in seconds', () => {
    expect(backendSeconds({ generation_s: 0.25, total_ms: 1500 })).toBe(1.5)
    expect(backendSeconds({})).toBe(0)
  })
})
