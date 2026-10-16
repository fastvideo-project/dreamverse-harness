/**
 * The Shot render component in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, the asset
 * pool, `dvProject`, `dvFfmpeg`, `dvModels` and `dvShotRender` through the Loader. The video model is the only fake:
 * an in-process model `fake` of provider `test`, registered once per task, whose entries render solid-color clips with
 * ffmpeg. A test-only `bible` reducer stands
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
import DvModels, { type ModelEntry, type RenderModelFacts, type RenderRequest, type RenderStreamEvent, type TaskId } from '@dv/models'
import { afterEach, describe, expect, it } from 'vitest'
import DvShotRender from '../src/index.ts'
import { backendSeconds, shotGeometry } from '../src/render.ts'

const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

const run = promisify(execFile)

/** Frame counts for each whole-second duration from `min` to `max`. */
function framesByDuration(min: number, max: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: max - min + 1 }, (_value, index) => [String(min + index), (min + index) * 24 + 1]))
}

/** Facts with small frames so the fake model renders quickly. */
function testFacts(task: TaskId): RenderModelFacts {
  return {
    modelId: `test-${task}`, aspectRatios: ['16:9', '9:16'], resolutions: ['720p'],
    frameSizes: { '16:9': { '720p': [192, 112] }, '9:16': { '720p': [112, 192] } }, minDurationSec: 1, maxDurationSec: 5,
    numFramesByDurationSec: framesByDuration(1, 5),
  }
}

/** The model key params of a render of the fake model in task `ref2v`. */
const REF = { modality: 'video', task: 'ref2v', provider: 'test', model: 'fake' }

/** The model key params of a render of the fake model in task `t2v`. */
const TXT = { ...REF, task: 't2v' }

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

/** One task of the fake model: it renders a solid-color clip for every request and remembers the requests. */
class FakeLane {
  readonly requests: RenderRequest[] = []
  /** When set, `render` rejects with this error before streaming. */
  failure: Error | null = null
  /** When set, `render` waits for it before rendering, so the record stays unfinished. */
  hold: Promise<void> | null = null
  /** An event to leave out of the stream, to exercise the stream checks. */
  omit: 'last_frame' | 'done' | null = null
  /** Extra zero bytes appended as one chunk, to exercise write backpressure. */
  padChunkBytes = 0
  /** Every request the entry's `validateGenerationRequest` received, in call order. */
  readonly validations: RenderRequest[] = []
  /** The problems the entry's `validateGenerationRequest` reports for a request; none by default. */
  check: (request: RenderRequest) => string[] = () => []

  validate(request: RenderRequest): Promise<string[]> {
    this.validations.push(request)
    return Promise.resolve(this.check(request))
  }

  constructor(public facts: RenderModelFacts) {}

  async *render(request: RenderRequest): AsyncIterable<RenderStreamEvent> {
    this.requests.push(request)
    if (this.failure !== null) throw this.failure
    if (this.hold !== null) await this.hold
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
 * A catalog entry of provider `test` that renders with a lane: 3 GPU seconds per video second in task `ref2v`, 1.5 in
 * task `t2v`.
 * @param task - the task the entry serves.
 * @param lane - the lane that validates and renders its requests.
 * @param model - the model name.
 * @returns the entry.
 */
function fakeEntry(task: TaskId, lane: FakeLane, model = 'fake'): ModelEntry {
  return {
    modality: 'video', task, provider: 'test', model, description: 'Solid-color clips',
    gpuSecondsPerVideoSecond: task === 'ref2v' ? 3 : 1.5,
    facts: () => Promise.resolve(lane.facts),
    schema: () => Promise.resolve({}),
    validateGenerationRequest: request => lane.validate(request),
    render: request => lane.render(request),
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
  /** The fake model's lane of task `ref2v`. */
  reference: FakeLane
  /** The fake model's lane of task `t2v`. */
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
 * @param options - the tasks the fake model is registered in (both by default; none registers no model), whether a live
 *   stream service is provided, and the GPU budget of a turn.
 * @returns the fixture, with a project bound to chat session `s1` and the test-only character operation.
 */
async function start(options: { tasks?: TaskId[]; live?: FakeLiveStream; budget?: number } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-shot-render-'))
  const globals = globalThis as typeof globalThis & { __dvShotRenderComposition?: typeof PLUGINS }
  globals.__dvShotRenderComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvShotRenderComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  const tasks = options.tasks ?? ['ref2v', 't2v']
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
  const reference = new FakeLane(testFacts('ref2v'))
  const text = new FakeLane(testFacts('t2v'))
  if (options.live !== undefined) ctx.provide('vhStream', options.live) // names:allow (the live stream service keeps its name)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const lanes: Record<TaskId, FakeLane> = { ref2v: reference, t2v: text }
  for (const task of tasks) ctx.effect(() => ctx.dvModels.register(fakeEntry(task, lanes[task])))
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
  it('registers shot.render while the catalog holds a model, and removes it on disposal', async () => {
    const fixture = await start()
    expect(renderSpec(fixture)).toMatchObject({ component: 'shot', resource: 'gpu', confirm: 'over_gpu_budget', deterministic: false })
    // Each estimate uses the GPU rate of the catalog entry the call's key names.
    expect(renderSpec(fixture)?.estimate?.({ ...REF, duration_sec: 2 })).toEqual({ gpu_seconds: 6 })
    expect(renderSpec(fixture)?.estimate?.({ ...TXT })).toEqual({ gpu_seconds: 7.5 })
    expect(renderSpec(fixture)?.estimate?.({ ...TXT, model: 'other' })).toEqual({ gpu_seconds: 0 })
    // An approved plan schedules renders with the params `plan`, `plan_version` and `shot`, so the spec declares them.
    const params = renderSpec(fixture)?.params ?? {}
    expect(Object.keys(params)).toEqual(expect.arrayContaining(['modality', 'task', 'provider', 'model', 'extra', 'plan', 'plan_version', 'shot']))
    // The key fields are free strings: dv_models_list lists their values and the precondition refuses an unknown key.
    for (const field of ['modality', 'task', 'provider', 'model']) {
      expect(params[field]).toMatchObject({ type: 'string', required: true })
      expect(params[field]).not.toHaveProperty('enum')
    }
    const tool = fixture.ctx.tools.schemas().find(schema => schema.name === 'dv_shot_render')
    expect(tool?.description).toContain('modality, task, provider and model name it and are required')
    expect(tool?.description).toContain('Uses the GPU.')
    expect(JSON.stringify(tool?.parameters)).toContain('continue_from')
    expect(JSON.stringify(tool?.parameters)).toContain('user_requested')
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-shot-render.mjs'))
    await entry?.fiber?.dispose()
    expect(renderSpec(fixture)).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_shot_render')).toBeUndefined()
    // The reducer went with the plugin: a state no longer has the `shot` slice.
    expect(fixture.ctx.dvProject.getState(fixture.project).components).not.toHaveProperty('shot')
  })

  it('refuses a key that names no catalog entry, and extra values the model\'s validation refuses', async () => {
    const fixture = await start({ tasks: ['ref2v'] })
    await withCharacter(fixture)
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.record('shot.render', { ...TXT, prompt: 'a cat' }))
      .rejects.toThrow('Unknown model "video/t2v/test/fake"; call dv_models_list for the models.')
    await expect(fixture.record('shot.render', { ...REF, model: 'nope', prompt: 'a cat' }, [c1()]))
      .rejects.toThrow('Unknown model "video/ref2v/test/nope"; call dv_models_list for the models.')
    // `extra` reaches the model's validation, which judges its parameters and values.
    fixture.reference.check = request => Object.hasOwn(request.extra, 'cfg') ? ['It has no extra parameter `cfg`; its extra parameters: strength.'] : []
    await expect(fixture.record('shot.render', { ...REF, prompt: 'a cat', extra: { cfg: 7 } }, [c1()]))
      .rejects.toThrow('Model video/ref2v/test/fake cannot render this shot: It has no extra parameter `cfg`; its extra parameters: strength.')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    const shot = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves', extra: { strength: 0.5 } }, [c1()])
    expect(shot.status).toBe('done')
    expect(fixture.reference.requests[0]?.extra).toEqual({ strength: 0.5 })
  })

  it('refuses inputs the model\'s validation refuses, continue_from included', async () => {
    const fixture = await start()
    await withCharacter(fixture)
    fixture.text.check = request => [
      ...request.references.length > 0 ? ['It takes no reference input.'] : [], ...request.firstFrame === null ? [] : ['It takes no first frame.'],
    ]
    await expect(fixture.record('shot.render', { ...TXT, prompt: 'a cat' }, [c1()]))
      .rejects.toThrow('Model video/t2v/test/fake cannot render this shot: It takes no reference input. Nothing was rendered;')
    const shot = await fixture.record('shot.render', { ...TXT, prompt: 'A street at dawn' })
    expect(failure(await fixture.call('dv_shot_render', { ...TXT, reason: 'next', prompt: 'later', continue_from: shot.id })))
      .toContain('Model video/t2v/test/fake cannot render this shot: It takes no first frame.')
  })

  it('has no render operation without a model, and follows the catalog', async () => {
    const fixture = await start({ tasks: [] })
    expect(renderSpec(fixture)).toBeUndefined()
    expect(fixture.ctx.tools.schemas().filter(tool => tool.name.startsWith('dv_shot_render'))).toEqual([])
    expect(fixture.ctx.dvProject.getState(fixture.project).components.shot).toEqual({ takes: {}, roots: {} })
    const call = { record: { operation: 'shot.render' }, params: { ...REF, prompt: 'x' } } as never
    await expect(fixture.ctx.dvShotRender.renderShot(call)).rejects.toThrow('Unknown model "video/ref2v/test/fake"; call dv_models_list for the models.')
    // The first model registers the operation and a second keeps it; removing the last model removes it.
    const removeFirst = fixture.ctx.dvModels.register(fakeEntry('t2v', fixture.text))
    const spec = renderSpec(fixture)
    expect(spec).toBeDefined()
    const removeSecond = fixture.ctx.dvModels.register(fakeEntry('t2v', fixture.text, 'other'))
    removeFirst()
    expect(renderSpec(fixture)).toBe(spec)
    removeSecond()
    expect(renderSpec(fixture)).toBeUndefined()
  })

  it('renders a take in task ref2v with references and a first frame, keeps the seed, and stores both outputs', async () => {
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
    expect(shot.report).toMatchObject({ seed: 42, ...REF, model_id: 'test-ref2v', frame_width: 192, num_frames: 49 })
    expect(shot.report).not.toHaveProperty('generation_mode')
    expect(shot.report).not.toHaveProperty('image_labels')
    expect(shot.cost).toMatchObject({ gpu_seconds: 0.25, reused: false })
    expect(fixture.reference.requests[0]).toMatchObject({ prompt: 'Picture 1 waves', frameWidth: 192, frameHeight: 112, numFrames: 49, seed: 42, firstFrame: null })
    // The model receives asset IDs and reads each asset from the pool itself.
    expect(fixture.reference.requests[0]?.references).toEqual([image])
    expect(renderSpec(fixture)?.summarize(shot)).toBe('shot "Picture 1 waves" (2s, seed 42)')
    const { report: _report, ...withoutReport } = shot
    expect(renderSpec(fixture)?.summarize({ ...withoutReport, params: {} })).toBe('shot "" (?s, seed ?)')
    expect(renderSpec(fixture)?.summarize({ ...withoutReport, params: { prompt: 'x', plan: 'p1', plan_version: 2, shot: 7 } }))
      .toBe('shot 7 of plan p1 v2 "x" (?s, seed ?)')
    // The next shot continues from the last still, which is the first frame.
    const next = await fixture.record('shot.render', { ...REF, prompt: 'keeps waving' }, [c1(), { role: 'first_frame', ref: { record: shot.id, output: 1 } }])
    expect(fixture.reference.requests[1]).toMatchObject({ references: [image], firstFrame: shot.outputs[1] })
    expect(next.report).toMatchObject({ duration_sec: 1 })
    expect(renderSpec(fixture)?.summarize(next)).toBe(`shot "keeps waving" (1s, seed ${String(next.report?.['seed'])})`)
  })

  it('renders a take in task t2v from the prompt only', async () => {
    const fixture = await start()
    const shot = await fixture.record('shot.render', { ...TXT, prompt: 'A baker opens the shutters', duration_sec: 3, seed: 5, aspect_ratio: '9:16' })
    expect(shot).toMatchObject({ status: 'done', component: 'shot', operation: 'shot.render', inputs: [] })
    expect(fixture.text.requests).toEqual([{
      prompt: 'A baker opens the shutters', references: [], firstFrame: null, frameWidth: 112, frameHeight: 192, numFrames: 73, seed: 5, extra: {},
    }])
    expect(fixture.reference.requests).toHaveLength(0)
    expect(shot.report).toMatchObject({ seed: 5, ...TXT, model_id: 'test-t2v', aspect_ratio: '9:16', resolution: '720p', duration_sec: 3, frame_width: 112 })
    expect(shot.report).not.toHaveProperty('image_labels')
    expect(fixture.ctx.dvAssetPool.get(shot.outputs[1] as AssetId)).toMatchObject({ mime: 'image/png', width: 112, height: 192 })
    expect(renderSpec(fixture)?.summarize(shot)).toBe('shot "A baker opens the shutters" (3s, seed 5)')
    // A t2v take's last still can start a shot in task ref2v.
    await withCharacter(fixture)
    const next = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 enters' }, [c1(), { role: 'first_frame', ref: { record: shot.id, output: 1 } }])
    expect(next.status).toBe('done')
  })

  it('groups the takes of a shot in the shot slice for every task', async () => {
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
    // The precondition counts an output the record does not have as one without an asset; Project then refuses the call.
    expect(failure(await fixture.call('dv_shot_render', { ...REF, reason: 'third shot', prompt: 'x', inputs: { reference: `${shot.record}#7` } })))
      .toContain('has no output 7')
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
    expect(refused).toContain('Render shot with video/ref2v/test/fake, 2 s: "Picture 1 walks a long way"')
    expect(fixture.reference.requests).toHaveLength(0)
    expect(value(await fixture.call('dv_shot_render', { ...args, user_requested: true })).status).toBe('done')
    const summary = renderSpec(fixture)?.confirmSummary?.({
      args: {}, request: { params: { ...TXT, prompt: 'x', plan: 'p1', plan_version: 1, shot: 3 } }, state: {}, exec: {},
    } as never, {} as never)
    expect(summary).toEqual({ text: 'Render shot 3 of plan p1 v1 with video/t2v/test/fake: "x"', gpu_seconds: 7.5 })
  })

  it('refuses a call that the model\'s validation refuses before recording anything, and tells the agent what to change', async () => {
    const fixture = await start()
    await fixture.record('bible.character_create', { character: 'c2' })
    fixture.reference.check = request => request.references.length === 0 ? ['It needs a reference asset; this shot has none.'] : []
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    const noImages = await fixture.call('dv_shot_render', { ...REF, reason: 'cat', prompt: 'a cat', inputs: { reference: 'c2@1' } })
    expect(failure(noImages)).toContain(
      'Model video/ref2v/test/fake cannot render this shot: It needs a reference asset; this shot has none. Nothing was rendered; '
      + 'change the inputs (ask the user for an asset the shot needs; they can attach it in the chat), then call again.',
    )
    // A render that a plan scheduled is told to update the plan.
    const c2 = { role: 'reference', ref: { character: brandString<CharacterId>('c2'), version: 1 } }
    await expect(fixture.record('shot.render', { ...REF, prompt: 'a cat', plan: 'p1', plan_version: 1, shot: 2 }, [c2]))
      .rejects.toThrow(/Nothing was rendered; update the plan with dv_plan_update, then call again\.$/)
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    expect(fixture.reference.requests).toHaveLength(0)
  })

  it('validates the request the model renders before recording and again before rendering', async () => {
    const fixture = await start()
    const image = await withCharacter(fixture)
    const video = fixture.put(Buffer.from('MP4-FAKE-1'), 'video/mp4', 'one.mp4')
    const still = fixture.put(Buffer.from('PNG-FAKE-2'), 'image/png', 'start.png')
    const shot = await fixture.record('shot.render', { ...REF, prompt: 'x', seed: 7 }, [
      { role: 'reference', ref: { asset: video } }, c1(), { role: 'first_frame', ref: { asset: still } },
    ])
    expect(shot.status).toBe('done')
    // A character version stands for its reference assets; the first frame is not a reference.
    expect(fixture.reference.validations).toHaveLength(2)
    expect(fixture.reference.validations[0]).toEqual(fixture.reference.requests[0])
    expect(fixture.reference.validations[1]).toEqual(fixture.reference.requests[0])
    expect(fixture.reference.requests[0]).toMatchObject({ references: [video, image], firstFrame: still, seed: 7 })
    // shot.render passes every input to the model, which judges them.
    fixture.text.check = request => request.firstFrame === null ? [] : ['It takes no first frame.']
    await expect(fixture.record('shot.render', { ...TXT, prompt: 'x' }, [{ role: 'first_frame', ref: { asset: still } }]))
      .rejects.toThrow('Model video/t2v/test/fake cannot render this shot: It takes no first frame.')
    await expect(fixture.record('shot.render', { ...REF, prompt: 'x' }, [c1(), { role: 'first_frame', ref: { asset: still } }, { role: 'first_frame', ref: { asset: still } }]))
      .rejects.toThrow('shot.render takes one first_frame input; this call has 2.')
  })

  it('validates a request with an output of an unfinished record once the output exists, before the model renders', async () => {
    const fixture = await start()
    await withCharacter(fixture)
    let release = (): void => {}
    fixture.text.hold = new Promise<void>((resolve) => { release = resolve })
    const producer = await fixture.record('shot.render', { ...TXT, prompt: 'a street' }, [], { after: [] })
    // The producer's video has no asset yet, so the request is incomplete and the precondition records the call unvalidated.
    fixture.reference.check = request => request.firstFrame !== null && fixture.ctx.dvAssetPool.mediaType(request.firstFrame) !== 'image'
      ? ['Its first frame must be an image.']
      : []
    const firstFrame = await fixture.record('shot.render', { ...REF, prompt: 'x' }, [c1(), { role: 'first_frame', ref: { record: producer.id, output: 0 } }], { after: [producer.id] })
    const planned = await fixture.record('shot.render', { ...REF, prompt: 'x', plan: 'p1', plan_version: 1, shot: 2 }, [
      c1(), { role: 'first_frame', ref: { record: producer.id, output: 0 } },
    ], { after: [producer.id] })
    expect(fixture.reference.validations).toHaveLength(0)
    release()
    await fixture.ctx.dvProject.wait(fixture.project, [producer.id, firstFrame.id, planned.id])
    // A render that a plan scheduled is told to update the plan, at render time as before recording.
    expect(fixture.ctx.dvProject.getRecord(fixture.project, planned.id).error?.message)
      .toMatch(/update the plan with dv_plan_update, then call again\.$/)
    const output = fixture.ctx.dvProject.getRecord(fixture.project, producer.id).outputs[0]
    expect(fixture.reference.validations.map(request => request.firstFrame)).toEqual([output, output])
    expect(fixture.ctx.dvProject.getRecord(fixture.project, firstFrame.id)).toMatchObject({
      status: 'failed', error: { message: expect.stringContaining('Model video/ref2v/test/fake cannot render this shot: Its first frame must be an image.') },
    })
    expect(fixture.reference.requests).toHaveLength(0)
  })

  it('passes a prompt that cites reference assets as written, and refuses a citation of anything else before recording', async () => {
    const fixture = await start()
    const image = await withCharacter(fixture)
    const other = fixture.put(Buffer.from('PNG-OTHER'), 'image/png', 'other.png')
    // A character version stands for its reference assets, so the prompt can cite them.
    const prompt = `@[face](dv:asset/${image}) waves`
    const shot = await fixture.record('shot.render', { ...REF, prompt }, [c1()])
    expect(fixture.reference.requests[0]).toMatchObject({ prompt, references: [image] })
    expect(shot.status).toBe('done')
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.record('shot.render', { ...REF, prompt: `@[other](dv:asset/${other}) waves` }, [c1()]))
      .rejects.toThrow(`The prompt cites asset ${other}, which is not in the reference input. `
        + 'Cite only the assets of inputs.reference and the inputs of the call.')
    const characterCited = { ...REF, reason: 'x', prompt: '@[Bo](dv:character/c9) waves', inputs: { reference: 'c1@1' } }
    expect(failure(await fixture.call('dv_shot_render', characterCited))).toContain('The prompt cites dv:character/c9; a shot prompt '
      + 'cites only the assets and elements of its reference input and the inputs of the call.')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
  })

  it('expands a citation of a character in the reference input into its reference images, and reports the expanded prompt', async () => {
    const fixture = await start()
    const face = await withCharacter(fixture)
    const side = fixture.put(Buffer.from('PNG-SIDE'), 'image/png', 'side.png')
    await fixture.record('bible.character_create', { character: 'c2' }, [
      { role: 'reference', ref: { asset: face } }, { role: 'reference', ref: { asset: side } },
    ])
    const c2 = { role: 'reference', ref: { character: brandString<CharacterId>('c2'), version: 1 } }
    const prompt = '@[Mia](dv:character/c2) waves at @[Bo](dv:character/c1)'
    const shot = await fixture.record('shot.render', { ...REF, prompt }, [c2, c1()])
    const expanded = `Mia (@[Mia · 1](dv:asset/${face}) @[Mia · 2](dv:asset/${side})) waves at Bo (@[Bo · 1](dv:asset/${face}))`
    expect(fixture.reference.requests[0]).toMatchObject({ prompt: expanded, references: [face, side, face] })
    // The record keeps the prompt as written; the report shows what the model plugin received.
    expect(shot.params['prompt']).toBe(prompt)
    expect(shot.report).toMatchObject({ expanded_prompt: expanded })
    const plain = await fixture.record('shot.render', { ...REF, prompt: 'Mia waves' }, [c2])
    expect(plain.report).not.toHaveProperty('expanded_prompt')
  })

  it('passes a prompt that cites the first_frame input of a call with continue_from, and refuses an input the call lacks', async () => {
    const fixture = await start()
    await withCharacter(fixture)
    const shot = await fixture.record('shot.render', { ...REF, prompt: 'Picture 1 waves' }, [c1()])
    const prompt = 'The shot starts from @[首帧](dv:input/first_frame).'
    const args = { ...REF, prompt, inputs: { reference: 'c1@1' } }
    const next = value(await fixture.call('dv_shot_render', { ...args, reason: 'next', continue_from: shot.id }))
    expect(next.status).toBe('done')
    expect(fixture.reference.requests[1]).toMatchObject({ prompt, firstFrame: shot.outputs[1] })
    expect(failure(await fixture.call('dv_shot_render', { ...args, reason: 'no frame' })))
      .toContain('The prompt cites the input first_frame, which this call does not have.')
    // The reference input is cited by its assets, not by its role.
    expect(failure(await fixture.call('dv_shot_render', { ...args, reason: 'role', prompt: '@[refs](dv:input/reference)' })))
      .toContain('The prompt cites the input reference, which this call does not have.')
  })

  it('refuses requests outside the model\'s facts before recording, and records stream failures', async () => {
    const fixture = await start()
    await withCharacter(fixture)
    const failed = async (params: Record<string, unknown>, inputs: RunRequest['inputs'] = [c1()], key: Record<string, string> = REF): Promise<string> => {
      const shot = await fixture.record('shot.render', { ...key, ...params }, inputs)
      expect(shot.status).toBe('failed')
      return shot.error?.message ?? ''
    }
    await expect(fixture.record('shot.render', { ...REF }, [c1()])).rejects.toMatchObject({ code: 'invalid_params' })
    // The precondition builds the render request it validates, so a missing prompt or a shot outside the facts is refused
    // before any record.
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.record('shot.render', { ...REF, prompt: '' }, [c1()])).rejects.toThrow('shot.render needs a `prompt`')
    await expect(fixture.record('shot.render', { ...TXT, prompt: '' })).rejects.toThrow('shot.render needs a `prompt`')
    await expect(fixture.record('shot.render', { ...REF, prompt: 'x', duration_sec: 7 }, [c1()])).rejects.toThrow('duration_sec')
    await expect(fixture.record('shot.render', { ...TXT, prompt: 'x', resolution: '4k' })).rejects.toThrow('aspect_ratio and resolution')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    fixture.reference.omit = 'done'
    expect(await failed({ prompt: 'x' })).toContain('ended before the backend reported completion')
    fixture.reference.omit = 'last_frame'
    expect(await failed({ prompt: 'x' })).toContain('no last frame')
    fixture.reference.omit = null
    fixture.reference.failure = new Error('backend down')
    expect(await failed({ prompt: 'x' })).toBe('backend down')
    fixture.text.failure = new Error('text backend down')
    expect(await failed({ prompt: 'x' }, [], TXT)).toBe('text backend down')
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

describe('render geometry and timings', () => {
  it('derives the geometry from the model facts', () => {
    const facts = testFacts('ref2v')
    expect(shotGeometry(facts, {})).toEqual({ aspectRatio: '16:9', resolution: '720p', width: 192, height: 112, durationSec: 1, numFrames: 25 })
    expect(shotGeometry(facts, { aspect_ratio: '9:16', duration_sec: 3 })).toMatchObject({ width: 112, height: 192, numFrames: 73 })
    expect(() => shotGeometry(facts, { aspect_ratio: '4:3' })).toThrow('aspect_ratio and resolution')
    expect(() => shotGeometry(facts, { resolution: '480p' })).toThrow('aspect_ratio and resolution')
    expect(() => shotGeometry(facts, { duration_sec: 9 })).toThrow('duration_sec must be a whole number from 1 to 5')
    expect(() => shotGeometry({ ...facts, aspectRatios: [] }, {})).toThrow('aspect_ratio and resolution')
  })

  it('reports the longest backend timing in seconds', () => {
    expect(backendSeconds({ generation_s: 0.25, total_ms: 1500 })).toBe(1.5)
    expect(backendSeconds({})).toBe(0)
  })
})
