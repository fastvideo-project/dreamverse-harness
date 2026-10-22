/**
 * The Audio component in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, Project, ffmpeg, the
 * asset pool, `dvModels` and `dvAudioGenerate` through the Loader. The speech model is the only fake: an in-process
 * model `fake` of provider `test` for task `t2a`, whose entry returns fixed WAV bytes and remembers its requests. The
 * specs pin the texts that the agent reads.
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
import DvModels, { type ModelEntry } from '@dv/models'
import DvProject, { type AssetId, type OperationSpec, type OperationToolValue, type ProjectId, type RecordId, type SessionId } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import DvAudioGenerate, { type AudioRequest, type GeneratedAudio } from '../src/index.ts'

/** The model key params of a call of the fake model. */
const KEY = { modality: 'audio', task: 't2a', provider: 'test', model: 'fake' }

/** The bytes that the fake model returns for every request. */
const CLIP = Buffer.from('RIFF-FAKE-CLIP')

/** The speech model of the tests: it answers every request with `CLIP` and remembers the requests. */
class FakeSpeech {
  readonly requests: AudioRequest[] = []
  /** The problems its validation reports for a request; none by default. */
  check: (request: AudioRequest) => string[] = () => []
  /** When set, `render` rejects with this error. */
  failure: Error | null = null

  render(request: AudioRequest): Promise<GeneratedAudio> {
    this.requests.push(request)
    if (this.failure !== null) return Promise.reject(this.failure)
    return Promise.resolve({ bytes: CLIP, mime: 'audio/wav', durationSec: 2.25, gpuSeconds: 0.4 })
  }
}

/**
 * A catalog entry of provider `test` for task `t2a`: 3 GPU seconds per clip, served by `speech`.
 * @param speech - the fake model that validates and renders the requests.
 * @param model - the model name.
 * @returns the entry.
 */
function fakeEntry(speech: FakeSpeech, model = 'fake'): ModelEntry<'t2a'> {
  return {
    modality: 'audio', task: 't2a', provider: 'test', model, description: 'Fixed clips', gpuSecondsPerCall: 3,
    facts: () => Promise.resolve({ modelId: 'test-speech' }),
    schema: () => Promise.resolve({}),
    validateGenerationRequest: request => Promise.resolve(speech.check(request)),
    render: request => speech.render(request),
  }
}

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvAudioGenerate }

interface Fixture {
  ctx: Context
  speech: FakeSpeech
  project: ProjectId
  /** Run one tool as the agent of chat session `s1`, which is bound to `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** The number of records in the project's history. */
  history(): number
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param options - whether the fake model is registered (by default it is), and the GPU budget of a turn.
 * @returns the fixture, with a project bound to chat session `s1`.
 */
async function start(options: { model?: boolean; budget?: number } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-audio-generate-'))
  const globals = globalThis as typeof globalThis & { __dvAudioGenerateComposition?: typeof PLUGINS }
  globals.__dvAudioGenerateComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvAudioGenerateComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [
    `root: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`, `confirmGpuSecondsThreshold: ${String(options.budget ?? 60)}`,
  ])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`])
  row('dv-models', 'DvModels', [])
  row('dv-audio-generate', 'DvAudioGenerate', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const speech = new FakeSpeech()
  if (options.model !== false) ctx.effect(() => ctx.dvModels.register(fakeEntry(speech)))
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null }
  const project = (await ctx.dvProject.createProject('voices', { ...origin, intent: 'create' })).id
  ctx.dvProject.bindSession(brandString<SessionId>('s1'), project)
  let calls = 0
  return {
    ctx, speech, project,
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    history: () => ctx.dvProject.listHistory({ project }).length,
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

/** The registered spec of `audio.generate`. */
function audioSpec(fixture: Fixture): OperationSpec | undefined {
  return fixture.ctx.dvProject.listOperations().find(spec => spec.name === 'audio.generate')
}

describe('dvAudioGenerate', () => {
  it('registers audio.generate and dv_audio_generate while the catalog holds a t2a model, and removes both on disposal', async () => {
    const fixture = await start()
    expect(audioSpec(fixture)).toMatchObject({
      component: 'audio', label: { zh: '生成音频', en: 'Generate audio' }, resource: 'gpu', confirm: 'over_gpu_budget', deterministic: false,
      inputs: {}, outputs: [{ role: 'audio', type: 'audio' }],
    })
    expect(audioSpec(fixture)?.estimate?.({ ...KEY, prompt: 'Hello.' })).toEqual({ gpu_seconds: 3 })
    expect(audioSpec(fixture)?.estimate?.({ ...KEY, model: 'other' })).toEqual({ gpu_seconds: 0 })
    const tool = fixture.ctx.tools.schemas().find(schema => schema.name === 'dv_audio_generate')
    expect(tool?.description).toBe('Generate one audio clip from the prompt with a t2a model from dv_models_list; modality, task, '
      + 'provider and model name it and are required. Before the first call for a model, load the prompt skill that '
      + 'dv_models_list names for it, because the prompt is written in the model\'s own markup. dv_models_get lists the '
      + 'model\'s own parameters for extra. The clip is the one output; the result gives its duration. You cannot hear the '
      + 'clip, so ask the user which take to keep. Every call is a new take, and the same prompt gives a different clip. Uses the GPU.')
    // The key, the prompt and extra: the operation has no seed param.
    const params = audioSpec(fixture)?.params ?? {}
    expect(Object.keys(params)).toEqual(['modality', 'task', 'provider', 'model', 'prompt', 'extra'])
    expect(params['prompt']).toEqual({
      type: 'string', required: true,
      description: 'The text to speak, in the markup of the prompt skill that dv_models_list names for the model.',
    })
    expect(fixture.ctx.dvModels.taskLabels()).toEqual({ t2a: { zh: '文字生成音频', en: 'Audio from text' } })
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-audio-generate.mjs'))
    await entry?.fiber?.dispose()
    expect(audioSpec(fixture)).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_audio_generate')).toBeUndefined()
    expect(fixture.ctx.dvModels.taskLabels()).toEqual({})
  })

  it('has no operation without a t2a model, and follows the catalog', async () => {
    const fixture = await start({ model: false })
    expect(audioSpec(fixture)).toBeUndefined()
    const remove = fixture.ctx.dvModels.register(fakeEntry(fixture.speech))
    expect(fixture.ctx.tools.get('dv_audio_generate')).toBeDefined()
    remove()
    expect(fixture.ctx.tools.get('dv_audio_generate')).toBeUndefined()
  })

  it('stores one clip with its duration and the backend time as its cost, and gives the agent the result text', async () => {
    const fixture = await start()
    const args = { ...KEY, reason: 'greeting', prompt: '  <|speaker:0|> Welcome, traveler.  ', extra: { speed: 1.1 } }
    const result = await fixture.call('dv_audio_generate', args)
    const take = value(result)
    expect(fixture.speech.requests).toEqual([{ prompt: '<|speaker:0|> Welcome, traveler.', extra: { speed: 1.1 } }])
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(take.record))
    expect(record).toMatchObject({ status: 'done', component: 'audio', operation: 'audio.generate', actor: 'agent', inputs: [] })
    expect(record.params).not.toHaveProperty('seed')
    expect(record.report).toEqual({ model_id: 'test-speech', duration_sec: 2.25 })
    expect(record.cost).toMatchObject({ gpu_seconds: 0.4 })
    const asset = record.outputs[0] as AssetId
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'audio/wav', duration_sec: 2.25, name: `${record.id.slice(0, 8)}.wav`, created_by: record.id })
    const blocks = fixture.ctx.tools.get('dv_audio_generate')?.output.render(args, take)
    expect(blocks).toEqual([{
      type: 'text',
      text: `done ${record.id}: audio "  <|speaker:0|> Welcome, traveler.  " (2.3s)\n`
        + `- audio: ${asset} (audio/wav) ${fixture.ctx.dvAssetPool.url(asset)}\n`
        + `params: ${JSON.stringify({ modality: 'audio', task: 't2a', provider: 'test', model: 'fake', prompt: args.prompt, extra: { speed: 1.1 } })}\n`
        + 'report: {"model_id":"test-speech","duration_sec":2.25}',
    }])
    const { report: _report, ...withoutReport } = record
    expect(audioSpec(fixture)?.summarize({ ...withoutReport, params: {} })).toBe('audio "" (?s)')
  })

  it('refuses an empty prompt and the problems of the model before any record', async () => {
    const fixture = await start()
    const before = fixture.history()
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'blank', prompt: '   ' })))
      .toBe('The prompt is empty; write the text to speak. Nothing was generated; change the inputs or params, then call again.')
    fixture.speech.check = request => request.prompt.includes('<|speaker:1|>') ? ['It speaks only <|speaker:0|>.'] : []
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'guard', prompt: '<|speaker:1|> Who goes there?' })))
      .toBe('Model audio/t2a/test/fake cannot generate this: It speaks only <|speaker:0|>. Nothing was generated; change the inputs or params, then call again.')
    // A workflow that calls the service without a prompt gets the same reason from `check`.
    const state = fixture.ctx.dvProject.getState(fixture.project)
    expect(await fixture.ctx.dvAudioGenerate.check({ project: fixture.project, params: KEY, inputs: [] }, state))
      .toEqual(['The prompt is empty; write the text to speak.'])
    expect(fixture.history()).toBe(before)
    expect(fixture.speech.requests).toEqual([])
  })

  it('asks for the user\'s agreement once a call passes the GPU budget', async () => {
    const fixture = await start({ budget: 2 })
    const args = { ...KEY, reason: 'speech', prompt: `<|speaker:0|> ${'Rest here tonight. '.repeat(6)}` }
    expect(failure(await fixture.call('dv_audio_generate', args))).toBe([
      'dv_audio_generate would bring this turn to about 3 GPU seconds, above the 2 s budget.',
      'What it will do:',
      'Generate audio with test/fake: "<|speaker:0|> Rest here tonight. Rest here tonight. Rest here tonight. Rest here…"',
      'Estimated GPU time: about 3 s.',
      'Show this to the user and ask in the conversation, with the question in bold (for example **Run this now?**). '
        + 'Wait for the user\'s answer, then call again with user_requested: true.',
    ].join('\n'))
    expect(fixture.speech.requests).toEqual([])
    expect(value(await fixture.call('dv_audio_generate', { ...args, user_requested: true })).status).toBe('done')
  })

  it('fails the record with the model\'s message when the render fails', async () => {
    const fixture = await start()
    fixture.speech.failure = new Error('The server at http://127.0.0.1:1 cannot be reached.')
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'x', prompt: 'Hello.' })))
      .toBe('The server at http://127.0.0.1:1 cannot be reached.')
    const [entry] = fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'audio.generate' })
    expect(entry?.record).toMatchObject({ status: 'failed', outputs: [] })
  })
})
