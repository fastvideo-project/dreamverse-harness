/**
 * The generation helper in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, `dvProject`,
 * `dvFfmpeg`, the asset pool, `dvModels` and a test primitive service that `defineGeneration` builds over the `video`
 * row. The models are the only fakes: entries of provider `test` whose streams carry the prompt as bytes.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvModels, { type ModelEntry, type RenderModelFacts, type RenderRequest, type RenderStreamEvent, type TaskOfPrimitive } from '@dv/models'
import DvProject, {
  type AssetId, type OperationSpec, type ProjectId, type ProjectRecord, type RecordId, type RecordOrigin, type RunRequest, type SessionId,
} from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { defineGeneration, importOne, type GenerationCall, type RequestInput } from '../src/index.ts'

const seen: Array<readonly RequestInput[]> = []

/** The test primitive service: component `probe`, operation `probe.generate`, tasks `t2v` and `ref2v`. */
const DvProbeGenerate = defineGeneration({
  service: 'dvProbeGenerate',
  component: 'probe',
  operation: 'probe.generate',
  primitive: 'video',
  tasks: { t2v: { zh: '探针文字', en: 'Probe from text' }, ref2v: { zh: '探针参考', en: 'Probe from references' } },
  label: { zh: '生成探针', en: 'Generate a probe' },
  description: 'Generate a probe clip.',
  params: {
    prompt: { type: 'string', required: true, description: 'The probe prompt.' },
    duration_sec: { type: 'integer', description: 'Whole seconds.' },
  },
  inputs: {
    reference: { type: 'any', many: true, versioned: true, description: 'Reference media.' },
    first_frame: { type: 'image', description: 'The first frame.' },
  },
  outputs: [{ role: 'clip', type: 'video' }],
  toolParams: { continue_from: { type: 'string', description: 'A record whose output #0 the clip starts from.' } },
  prepareToolCall(call) {
    const from = call.args['continue_from']
    if (typeof from === 'string') call.request.inputs.push({ role: 'first_frame', ref: { record: brandString<RecordId>(from), output: 0 } })
  },
  toRequest(facts, params, inputs, seed): RenderRequest {
    seen.push(inputs)
    const prompt = String(params['prompt'])
    // A prompt cites an input of the call as dv:input/<role>.
    for (const [, role] of prompt.matchAll(/dv:input\/(\w+)/g)) {
      if (!inputs.some(input => input.role === role)) throw new Error(`The prompt cites dv:input/${String(role)}, but the call has no such input.`)
    }
    const durationSec = typeof params['duration_sec'] === 'number' ? params['duration_sec'] : facts.minDurationSec
    if (durationSec > facts.maxDurationSec) throw new Error(`probe.generate takes at most ${String(facts.maxDurationSec)} s.`)
    const assets = (role: string) =>
      inputs.flatMap(input => input.role === role && input.resolved_asset !== null ? [input.resolved_asset] : [])
    return {
      prompt, references: assets('reference'), firstFrame: assets('first_frame')[0] ?? null,
      frameWidth: 16, frameHeight: 16, numFrames: durationSec * 24, seed, extra: {},
    }
  },
  async toOutputs(_ctx, run, result, facts, request) {
    const chunks: Buffer[] = []
    for await (const event of result) if (event.kind === 'chunk') chunks.push(event.bytes)
    const clip = run.importAsset(Buffer.concat(chunks), { mime: 'text/plain', name: 'probe.txt' })
    return { outputs: [clip], cost: { gpu_seconds: 1 }, report: { model_id: facts.modelId, references: request.references.length } }
  },
  estimate: (params, entry) => ({ gpu_seconds: Number(params['duration_sec'] ?? 1) * entry.gpuSecondsPerVideoSecond }),
  summarize: record => `probe "${String(record.params['prompt'])}"`,
})

/**
 * A declaration without a seed and without the optional members except `confirmText`: component `plain`, operation
 * `plain.generate`, the same video tasks as the probe, so a composition mounts one of the two.
 */
const DvPlainGenerate = defineGeneration({
  service: 'dvPlainGenerate', component: 'plain', operation: 'plain.generate', primitive: 'video',
  tasks: { t2v: { zh: '普通文字', en: 'Plain from text' }, ref2v: { zh: '普通参考', en: 'Plain from references' } },
  label: { zh: '普通生成', en: 'Generate plainly' }, description: 'Generate a plain clip.', params: {}, inputs: {},
  outputs: [{ role: 'clip', type: 'video' }], seed: false,
  toRequest(_facts, params, inputs): RenderRequest {
    seen.push(inputs)
    if (params['prompt'] === 'boom') throw 'The prompt is a bomb.'
    return { prompt: String(params['prompt']), references: [], firstFrame: null, frameWidth: 16, frameHeight: 16, numFrames: 24, seed: 0, extra: {} }
  },
  toOutputs: async (_ctx, run, _result, _facts, request) => ({
    outputs: [importOne(run, { bytes: Buffer.from(`plain ${request.prompt}`), mime: 'text/plain' })],
  }),
  estimate: () => ({ gpu_seconds: 2 }),
  confirmText: params => `Plain clip of ${String(params['prompt'])}.`,
  summarize: () => 'plain',
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    dvProbeGenerate: InstanceType<typeof DvProbeGenerate>
    dvPlainGenerate: InstanceType<typeof DvPlainGenerate>
  }
}

/** The facts of every fake model. */
const FACTS: RenderModelFacts = {
  modelId: 'probe-1', aspectRatios: ['16:9'], resolutions: ['720p'], frameSizes: { '16:9': { '720p': [16, 16] } },
  minDurationSec: 1, maxDurationSec: 5, numFramesByDurationSec: { 1: 24, 5: 120 },
}

/** The key params of the fake model in task `t2v`. */
const TXT = { modality: 'video', task: 't2v', provider: 'test', model: 'fake' }

/**
 * One fake model: it reads its facts from `facts`, streams the prompt as bytes, and finds the problems that `problems`
 * returns; a throw of `problems` rejects the validation, as an unreachable model does.
 */
class FakeModel {
  readonly requests: RenderRequest[] = []
  facts: () => Promise<RenderModelFacts> = () => Promise.resolve(FACTS)
  problems: (request: RenderRequest) => string[] = () => []
  /** When set, a render waits for it before streaming, so its record stays unfinished. */
  hold: Promise<void> | null = null

  entry(task: TaskOfPrimitive<'video'>): ModelEntry<TaskOfPrimitive<'video'>> {
    return {
      modality: 'video', task, provider: 'test', model: 'fake', description: 'Probe clips', gpuSecondsPerVideoSecond: 3,
      facts: () => this.facts(),
      schema: () => Promise.resolve({}),
      validateGenerationRequest: request => new Promise((resolve) => { resolve(this.problems(request)) }),
      render: request => this.stream(request),
    }
  }

  private async *stream(request: RenderRequest): AsyncIterable<RenderStreamEvent> {
    this.requests.push(request)
    if (this.hold !== null) await this.hold
    yield { kind: 'video_start', mime: 'video/mp4' }
    yield { kind: 'chunk', bytes: Buffer.from(request.prompt) }
    yield { kind: 'done', timings: {} }
  }
}

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvProbeGenerate, DvPlainGenerate }

const ORIGIN: RecordOrigin = { actor: 'user', surface: 'api', session: null, turn: null, tool_call: null, intent: 'test' }

interface Fixture {
  ctx: Context
  model: FakeModel
  project: ProjectId
  /** A call of `probe.generate` on the project. */
  call(params: Record<string, unknown>, inputs?: RunRequest['inputs'], extra?: Partial<GenerationCall>): GenerationCall
  /** Run one tool as the agent of chat session `s1`, which is bound to the project. */
  tool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  spec(): OperationSpec | undefined
  record(id: string): ProjectRecord
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml` with one test declaration, because both label the video tasks,
 * and with the fake model registered in task `t2v` unless `serve` is false.
 * @returns the fixture, with a project bound to chat session `s1`.
 */
async function start(serve = true, declaration: 'DvProbeGenerate' | 'DvPlainGenerate' = 'DvProbeGenerate'): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-generation-'))
  const globals = globalThis as typeof globalThis & { __dvGenerationComposition?: typeof PLUGINS }
  globals.__dvGenerationComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[] = []): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvGenerationComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt')
  row('tools', 'ToolRuntime')
  row('dv-project', 'DvProject', [`root: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`, 'confirmGpuSecondsThreshold: 10'])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`])
  row('dv-models', 'DvModels')
  row('dv-generate', declaration)
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const model = new FakeModel()
  if (serve) ctx.effect(() => ctx.dvModels.register(model.entry('t2v')))
  const project = (await ctx.dvProject.createProject('probes', ORIGIN)).id
  ctx.dvProject.bindSession(brandString<SessionId>('s1'), project)
  let calls = 0
  return {
    ctx, model, project,
    call: (params, inputs = [], extra = {}) => ({ ...ORIGIN, project, params: { ...TXT, ...params }, inputs, ...extra }),
    tool(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    spec: () => ctx.dvProject.listOperations().find(spec => spec.name === 'probe.generate'),
    record: id => ctx.dvProject.getRecord(project, brandString<RecordId>(id)),
  }
}

describe('defineGeneration', () => {
  it('registers the component, the task labels, and the operation while the catalog serves one of its tasks', async () => {
    const fixture = await start(false)
    const { ctx } = fixture
    expect(() => ctx.dvProject.registerComponent('probe')).toThrow(/probe/)
    expect(ctx.dvModels.taskLabels()).toEqual({ t2v: { zh: '探针文字', en: 'Probe from text' }, ref2v: { zh: '探针参考', en: 'Probe from references' } })
    expect(fixture.spec()).toBeUndefined()
    const remove = ctx.dvModels.register(fixture.model.entry('ref2v'))
    expect(fixture.spec()).toMatchObject({
      component: 'probe', version: '1', label: { zh: '生成探针', en: 'Generate a probe' }, outputs: [{ role: 'clip', type: 'video' }],
      deterministic: false, resource: 'gpu', confirm: 'over_gpu_budget', toolParams: { continue_from: { type: 'string' } },
    })
    // The key and the prompt come first and the seed and extra last; the declaration restated the prompt.
    const params = fixture.spec()?.params ?? {}
    expect(Object.keys(params)).toEqual(['modality', 'task', 'provider', 'model', 'prompt', 'duration_sec', 'seed', 'extra'])
    expect(params['prompt']?.description).toBe('The probe prompt.')
    expect(params['seed']).toEqual({ type: 'integer', description: 'Fixed seed; omitted, a random seed is drawn and recorded.' })
    expect(ctx.tools.get('dv_probe_generate')).toBeDefined()
    remove()
    expect(fixture.spec()).toBeUndefined()
    ctx.dvModels.register(fixture.model.entry('t2v'))
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-generate.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.spec()).toBeUndefined()
    expect(ctx.tools.get('dv_probe_generate')).toBeUndefined()
    expect(ctx.dvModels.taskLabels()).toEqual({})
    expect(() => ctx.effect(() => ctx.dvProject.registerComponent('probe'))).not.toThrow()
  })

  it('renders one record per call, with the seed drawn or given, and schedules a call with after', async () => {
    const fixture = await start()
    const { ctx } = fixture
    const first = fixture.record(await ctx.dvProbeGenerate.render(fixture.call({ prompt: 'dawn' })))
    expect(first).toMatchObject({ component: 'probe', operation: 'probe.generate', status: 'done', params: { ...TXT, prompt: 'dawn' } })
    expect(first.report).toMatchObject({ model_id: 'probe-1', references: 0 })
    expect(Object.keys(first.report ?? {})).toEqual(['seed', 'model_id', 'references'])
    expect(first.cost?.gpu_seconds).toBe(1)
    expect(fixture.model.requests[0]).toMatchObject({ prompt: 'dawn', seed: first.report?.['seed'], numFrames: 24 })
    // A scheduled call resolves its record and asset inputs when it runs, keeps the seed it names, and stores its starter.
    const image = ctx.dvAssetPool.importAsset(Buffer.from('face'), { mime: 'text/plain', name: 'face.txt' }, null)
    let release = (): void => {}
    fixture.model.hold = new Promise((resolve) => { release = resolve })
    const startedBy = { record: first.id, slot: 2, lane: '9:16' }
    const second = await ctx.dvProbeGenerate.render(fixture.call({ prompt: 'dusk', seed: 7 }, [
      { role: 'reference', ref: { record: first.id, output: 0 } }, { role: 'reference', ref: { asset: image } },
    ], { after: [first.id], started_by: startedBy }))
    expect(fixture.record(second).status).not.toBe('done')
    release()
    await ctx.dvProject.wait(fixture.project, [second])
    expect(fixture.record(second)).toMatchObject({
      status: 'done', report: { seed: 7, references: 2 }, inputs: [{ resolved_asset: first.outputs[0] }, { resolved_asset: image }],
      started_by: startedBy,
    })
    expect(ctx.dvProject.getState(fixture.project).components.proj.records.map(record => fixture.spec()?.summarize(record)))
      .toEqual(expect.arrayContaining(['probe "dawn"', 'probe "dusk"']))
  })

  it('finds every reason a call is refused, and refuses it before any record', async () => {
    const fixture = await start()
    const { ctx, project } = fixture
    const state = () => ctx.dvProject.getState(project)
    fixture.model.problems = request => request.prompt.includes('cat') ? ['It draws no cats.', 'It needs a dog.'] : []
    expect(await ctx.dvProbeGenerate.check(fixture.call({ prompt: 'dog' }), state())).toEqual([])
    expect(await ctx.dvProbeGenerate.check(fixture.call({ prompt: 'cat' }), state()))
      .toEqual(['Model video/t2v/test/fake cannot generate this: It draws no cats. It needs a dog.'])
    expect(await ctx.dvProbeGenerate.check(fixture.call({ prompt: 'dog', model: 'nope' }), state()))
      .toEqual(['Unknown model "video/t2v/test/nope"; call dv_models_list for the models.'])
    expect(await ctx.dvProbeGenerate.check(fixture.call({ prompt: 'dog', task: 'ref2v' }), state()))
      .toEqual(['Unknown model "video/ref2v/test/fake"; call dv_models_list for the models.'])
    expect(await ctx.dvProbeGenerate.check(fixture.call({ prompt: 'dog', duration_sec: 9 }), state())).toEqual(['probe.generate takes at most 5 s.'])
    const before = ctx.dvProject.listHistory({ project }).length
    await expect(ctx.dvProbeGenerate.render(fixture.call({ prompt: 'cat' }))).rejects.toThrow(
      'Model video/t2v/test/fake cannot generate this: It draws no cats. It needs a dog. Nothing was generated; change the inputs or params, then call again.')
    expect(ctx.dvProject.listHistory({ project })).toHaveLength(before)
    // A version stands for the assets that its kind answers; a kind that is not loaded answers none.
    const version = { role: 'reference', ref: { prop: 'p1', version: 1 } as never }
    expect(await ctx.dvProbeGenerate.check(fixture.call({ prompt: 'dog' }, [version]), state())).toEqual([])
    expect(fixture.model.requests).toEqual([])
  })

  it('names an unavailable model, and ends its refusal with the sentence that no change to the call helps', async () => {
    const fixture = await start()
    const { ctx, project } = fixture
    const state = () => ctx.dvProject.getState(project)
    const unavailableEnd = 'Nothing was generated; no change to the call helps while the model is unavailable.'
    fixture.model.facts = () => Promise.reject(new Error('The server at http://127.0.0.1:1 cannot be reached.'))
    expect(await ctx.dvProbeGenerate.check(fixture.call({ prompt: 'dog' }), state()))
      .toEqual(['Model video/t2v/test/fake is unavailable: The server at http://127.0.0.1:1 cannot be reached.'])
    const before = ctx.dvProject.listHistory({ project }).length
    await expect(ctx.dvProbeGenerate.render(fixture.call({ prompt: 'dog' }))).rejects.toHaveProperty('message',
      `Model video/t2v/test/fake is unavailable: The server at http://127.0.0.1:1 cannot be reached. ${unavailableEnd}`)
    expect(ctx.dvProject.listHistory({ project })).toHaveLength(before)
    fixture.model.facts = () => Promise.resolve(FACTS)
    fixture.model.problems = () => { throw 'busy' }
    const refused = await fixture.tool('dv_probe_generate', { ...TXT, reason: 'try', prompt: 'dog' })
    expect(refused.isError ? refused.error.message : '').toContain(`Model video/t2v/test/fake is unavailable: busy ${unavailableEnd}`)
    expect(fixture.model.requests).toEqual([])
  })

  it('checks a chained role as an input without an asset, and only through check', async () => {
    const fixture = await start()
    const { ctx, project } = fixture
    const state = ctx.dvProject.getState(project)
    fixture.model.problems = () => ['It needs the first frame itself.']
    const call = fixture.call({ prompt: 'From @[the frame](dv:input/first_frame).' })
    // The citation sees the chained role, and the model check waits for execute.
    expect(await ctx.dvProbeGenerate.check(call, state, ['first_frame'])).toEqual([])
    expect(seen.at(-1)).toEqual([{ role: 'first_frame', ref: null, resolved_asset: null }])
    expect(await ctx.dvProbeGenerate.check(call, state)).toEqual(['The prompt cites dv:input/first_frame, but the call has no such input.'])
    await expect(ctx.dvProbeGenerate.render(call)).rejects.toThrow(
      'The prompt cites dv:input/first_frame, but the call has no such input. Nothing was generated; change the inputs or params, then call again.')
    expect(fixture.model.requests).toEqual([])
  })

  it('checks an input whose producer has not finished when it runs, and fails the record for model problems', async () => {
    const fixture = await start()
    const { ctx, project } = fixture
    let release = (): void => {}
    fixture.model.hold = new Promise((resolve) => { release = resolve })
    const first = await ctx.dvProbeGenerate.render(fixture.call({ prompt: 'held' }, [], { after: [] }))
    const call = fixture.call({ prompt: 'cat' }, [{ role: 'first_frame', ref: { record: first, output: 0 } }], { after: [first] })
    fixture.model.problems = request => request.prompt === 'cat' ? ['It draws no cats.'] : []
    expect(await ctx.dvProbeGenerate.check(call, ctx.dvProject.getState(project))).toEqual([])
    const second = await ctx.dvProbeGenerate.render(call)
    release()
    await ctx.dvProject.wait(project, [first, second])
    expect(fixture.record(second)).toMatchObject({
      status: 'failed',
      error: { message: 'Model video/t2v/test/fake cannot generate this: It draws no cats. Nothing was generated; change the inputs or params, then call again.' },
    })
    // A done record without the named output gives no asset either, so the model does not check the call yet.
    const missing = fixture.call({ prompt: 'cat' }, [{ role: 'first_frame', ref: { record: first, output: 3 } }])
    expect(await ctx.dvProbeGenerate.check(missing, ctx.dvProject.getState(project))).toEqual([])
  })

  it('estimates the GPU time, and describes an agent call that passes the budget', async () => {
    const fixture = await start()
    const { ctx } = fixture
    expect(ctx.dvProbeGenerate.estimate({ params: { ...TXT, duration_sec: 2 } })).toEqual({ gpu_seconds: 6 })
    expect(ctx.dvProbeGenerate.estimate({ params: { ...TXT, task: 'ref2v' } })).toEqual({ gpu_seconds: 0 })
    expect(fixture.spec()?.estimate?.({ ...TXT })).toEqual({ gpu_seconds: 3 })
    const refused = await fixture.tool('dv_probe_generate', { ...TXT, reason: 'try', prompt: 'long', duration_sec: 4 })
    // The refusal states the estimate once, on its own line under the summary.
    expect(refused.isError ? refused.error.message : '').toContain('Generate a probe with test/fake: "long"\nEstimated GPU time: about 12 s.')
    const summary = (prompt: string) =>
      fixture.spec()?.confirmSummary?.({ request: { params: { ...TXT, prompt } } } as never, ctx.dvProject.getState(fixture.project))
    expect(summary(`  ${'👍🏽'.repeat(80)}tail\n`)).toEqual({ text: `Generate a probe with test/fake: "${'👍🏽'.repeat(80)}…"`, gpu_seconds: 3 })
    expect(summary(' A sign that reads "Moon Garden"\nat night ')?.text).toBe('Generate a probe with test/fake: "A sign that reads \\"Moon Garden\\"\\nat night"')
  })

  it('turns tool arguments into inputs before the check, and refuses an agent call with its reasons', async () => {
    const fixture = await start()
    const { ctx } = fixture
    const first = await ctx.dvProbeGenerate.render(fixture.call({ prompt: 'dawn' }))
    const result = await fixture.tool('dv_probe_generate', { ...TXT, reason: 'next', prompt: 'noon', continue_from: first })
    expect(result.isError).toBe(false)
    const next = ctx.dvProject.getState(fixture.project).components.proj.records.at(-1)
    expect(next?.inputs).toEqual([{ role: 'first_frame', ref: { record: first, output: 0 }, resolved_asset: fixture.record(first).outputs[0] }])
    expect(fixture.model.requests.at(-1)?.firstFrame).toBe(fixture.record(first).outputs[0])
    fixture.model.problems = () => ['It takes no first frame.']
    const refused = await fixture.tool('dv_probe_generate', { ...TXT, reason: 'again', prompt: 'noon', continue_from: first })
    expect(refused.isError ? refused.error.message : '').toContain('cannot generate this: It takes no first frame. Nothing was generated;')
  })

  it('finds the newest equal take among the records the caller accepts', async () => {
    const fixture = await start()
    const { ctx, project } = fixture
    const a = await ctx.dvProbeGenerate.render(fixture.call({ prompt: 'dawn', duration_sec: 1 }))
    const b = await ctx.dvProbeGenerate.render(fixture.call({ duration_sec: 2, prompt: 'dawn' }))
    const c = await ctx.dvProbeGenerate.render(fixture.call({ prompt: 'dawn' }, [
      { role: 'reference', ref: { record: a, output: 0 } }, { role: 'first_frame', ref: { record: b, output: 0 } },
    ]))
    const d = await ctx.dvProbeGenerate.render(fixture.call({ duration_sec: 1, prompt: 'dawn' }))
    const state = ctx.dvProject.getState(project)
    const take = (params: Record<string, unknown>, inputs: RunRequest['inputs'], where: (record: ProjectRecord) => boolean = () => true) =>
      ctx.dvProbeGenerate.findTake(state, { params: { ...TXT, ...params }, inputs }, where)
    // The newest equal take wins unless the caller's test leaves it out; key order does not matter.
    expect(take({ prompt: 'dawn', duration_sec: 1 }, [])).toBe(d)
    expect(take({ prompt: 'dawn', duration_sec: 1 }, [], record => record.id !== d)).toBe(a)
    expect(take({ prompt: 'dawn', duration_sec: 2 }, [])).toBe(b)
    expect(take({ prompt: 'dawn', duration_sec: 3 }, [])).toBeNull()
    expect(take({ prompt: 'dawn' }, [])).toBeNull()
    // Inputs match role by role, so the order of the roles does not matter.
    expect(take({ prompt: 'dawn' }, ctx.dvProbeGenerate.parseInputs({ first_frame: `${b}#0`, reference: [`${a}#0`] }, state))).toBe(c)
    expect(take({ prompt: 'dawn' }, [{ role: 'reference', ref: { record: b, output: 0 } }])).toBeNull()
  })

  it('compares only the declared params, so a stray seed changes no take', async () => {
    const fixture = await start(true, 'DvPlainGenerate')
    const { ctx, project } = fixture
    // The declaration has no seed param; the kernel still stores a seed that a call names.
    const stray = await ctx.dvPlainGenerate.render(fixture.call({ prompt: 'rain', seed: 7 }))
    expect(fixture.record(stray)).toMatchObject({ status: 'done', params: { prompt: 'rain', seed: 7 } })
    const state = ctx.dvProject.getState(project)
    const take = (params: Record<string, unknown>) =>
      ctx.dvPlainGenerate.findTake(state, { params: { ...TXT, ...params }, inputs: [] }, () => true)
    expect(take({ prompt: 'rain' })).toBe(stray)
    expect(take({ prompt: 'rain', seed: 8 })).toBe(stray)
    expect(take({ prompt: 'snow', seed: 7 })).toBeNull()
  })

  it('runs a declaration without a seed, records its estimate as the cost, and names its output after the record', async () => {
    const fixture = await start(true, 'DvPlainGenerate')
    const { ctx, project } = fixture
    const spec = ctx.dvProject.listOperations().find(operation => operation.name === 'plain.generate')
    expect(spec).toMatchObject({ confirm: 'over_gpu_budget', inputs: {} })
    expect(spec).not.toHaveProperty('toolParams')
    // The shared params as the model reads them, without a seed.
    expect(Object.keys(spec?.params ?? {})).toEqual(['modality', 'task', 'provider', 'model', 'prompt', 'extra'])
    expect(spec?.params).toEqual({
      modality: { type: 'string', required: true, description: 'The modality of a model that dv_models_list lists.' },
      task: { type: 'string', required: true, description: 'The task of that model, as dv_models_list lists it.' },
      provider: { type: 'string', required: true, description: 'The provider of that model, as dv_models_list lists it.' },
      model: { type: 'string', required: true, description: 'The model name, as dv_models_list lists it.' },
      prompt: { type: 'string', required: true, description: 'The complete prompt; follow the prompt skill that dv_models_list names for the model, if any.' },
      extra: { type: 'object', additionalProperties: true, description: 'The model\'s own parameters, as dv_models_get lists them; omit it when the model has none.' },
    })
    expect(ctx.dvPlainGenerate.estimate({ params: { ...TXT } })).toEqual({ gpu_seconds: 2 })
    expect(spec?.confirmSummary?.({ request: { params: { ...TXT, prompt: 'rain' } } } as never, ctx.dvProject.getState(project)))
      .toEqual({ text: 'Plain clip of rain.', gpu_seconds: 2 })
    expect(await ctx.dvPlainGenerate.check(fixture.call({ prompt: 'boom' }), ctx.dvProject.getState(project))).toEqual(['The prompt is a bomb.'])
    const result = await fixture.tool('dv_plain_generate', { ...TXT, reason: 'plain', prompt: 'rain' })
    expect(result.isError).toBe(false)
    const record = ctx.dvProject.getState(project).components.proj.records.at(-1)
    expect(record).toMatchObject({ operation: 'plain.generate', status: 'done', cost: { gpu_seconds: 2 } })
    expect(record?.report ?? {}).not.toHaveProperty('seed')
    const asset = ctx.dvAssetPool.get(record?.outputs[0] ?? brandString<AssetId>('none'))
    expect(asset).toMatchObject({ name: `${String(record?.id.slice(0, 8))}.plain`, mime: 'text/plain', created_by: record?.id })
    expect(() => importOne({ record: null } as never, { bytes: Buffer.from('x'), mime: 'image/png' }))
      .toThrow('importOne needs the record of a running generation.')
  })
})
