/**
 * The Audio component in a REAL composition booted through the Loader from a test-only `cordis.yml`; the speech model is
 * the only fake.
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
import DvProject, { type AssetId, type OperationSpec, type OperationToolValue, type ProjectId, type RecordId } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import DvAudioGenerate, { type AudioRequest, type GeneratedAudio } from '../src/index.ts'

const KEY = { modality: 'audio', task: 't2a', provider: 'test', model: 'fake' }

const CLIP = Buffer.from('RIFF-FAKE-CLIP')

class FakeSpeech {
  readonly requests: AudioRequest[] = []
  check: (request: AudioRequest) => string[] = () => []
  failure: Error | null = null

  render(request: AudioRequest): Promise<GeneratedAudio> {
    this.requests.push(request)
    if (this.failure !== null) return Promise.reject(this.failure)
    return Promise.resolve({ bytes: CLIP, mime: 'audio/wav', durationSec: 2.25 })
  }
}

function fakeEntry(speech: FakeSpeech, model = 'fake'): ModelEntry<'t2a'> {
  return {
    modality: 'audio', task: 't2a', provider: 'test', model, description: 'Fixed clips',
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
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  history(): number
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param options - whether the fake model is registered (by default it is).
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(options: { model?: boolean } = {}): Promise<Fixture> {
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
    `projectsFolder: ${join(dir, 'projects')}`,
  ])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [])
  row('dv-models', 'DvModels', [])
  row('dv-audio-generate', 'DvAudioGenerate', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const services = provideChatServices(ctx)
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
  const project = await chatProject(ctx.dvProject, services, 'voices', { ...origin, intent: 'create' })
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

function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

function audioSpec(fixture: Fixture): OperationSpec | undefined {
  return fixture.ctx.dvProject.listOperations().find(spec => spec.name === 'audio.generate')
}

describe('dvAudioGenerate', () => {
  it('registers audio.generate and dv_audio_generate while the catalog holds a t2a model, and removes both on disposal', async () => {
    const fixture = await start()
    expect(audioSpec(fixture)).toMatchObject({
      component: 'audio', label: { zh: '生成音频', en: 'Generate audio' }, resource: 'gpu', deterministic: false,
      inputs: {}, outputs: [{ role: 'audio', type: 'audio' }],
    })
    const tool = fixture.ctx.tools.schemas().find(schema => schema.name === 'dv_audio_generate')
    expect(tool?.description).toBe('Generate one audio clip from the prompt with a t2a model from dv_models_list; modality, task, '
      + 'provider and model name it and are required. Before the first call for a model, load the prompt skill that '
      + 'dv_models_list names for it, because the prompt is written in the model\'s own markup. dv_models_get lists the '
      + 'model\'s own parameters for extra. The clip is the one output; the result gives its duration. You cannot hear the '
      + 'clip, so ask the user which take to keep. Every call is a new take, and the same prompt gives a different clip. Uses the GPU.')
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

  it('stores one clip with its duration and the backend time as its cost, and summarizes it for the agent', async () => {
    const fixture = await start()
    const args = { ...KEY, reason: 'greeting', prompt: '  <|speaker:0|> Welcome, traveler.  ', extra: { speed: 1.1 } }
    const result = await fixture.call('dv_audio_generate', args)
    const take = value(result)
    // An agent call of a GPU operation runs in the background; a project update reports the summary and outputs.
    expect(take.status).toBe('pending')
    await fixture.ctx.dvProject.wait(fixture.project)
    expect(fixture.speech.requests).toEqual([{ prompt: '<|speaker:0|> Welcome, traveler.', extra: { speed: 1.1 } }])
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(take.record))
    expect(record).toMatchObject({ status: 'done', component: 'audio', operation: 'audio.generate', actor: 'agent', inputs: [] })
    expect(record.params).not.toHaveProperty('seed')
    expect(record.report).toEqual({ model_id: 'test-speech', duration_sec: 2.25 })
    const asset = record.outputs[0] as AssetId
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'audio/wav', duration_sec: 2.25, name: `${record.id.slice(0, 8)}.wav`, created_by: record.id })
    expect(audioSpec(fixture)?.summarize(record)).toBe('audio "<|speaker:0|> Welcome, traveler." (2.3s)')
    const { report: _report, ...withoutReport } = record
    expect(audioSpec(fixture)?.summarize(withoutReport)).toBe('audio "<|speaker:0|> Welcome, traveler." (?s)')
  })

  it('refuses an empty prompt and the problems of the model before any record', async () => {
    const fixture = await start()
    const before = fixture.history()
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'blank', prompt: '   ' })))
      .toBe('The prompt is empty; write the text to speak. Nothing was generated; change the inputs or params, then call again.')
    fixture.speech.check = request => request.prompt.includes('<|speaker:1|>') ? ['It speaks only <|speaker:0|>.'] : []
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'guard', prompt: '<|speaker:1|> Who goes there?' })))
      .toBe('Model audio/t2a/test/fake cannot generate this: It speaks only <|speaker:0|>. Nothing was generated; change the inputs or params, then call again.')
    const state = fixture.ctx.dvProject.getState(fixture.project)
    expect(await fixture.ctx.dvAudioGenerate.check({ project: fixture.project, params: KEY, inputs: [] }, state))
      .toEqual(['The prompt is empty; write the text to speak.'])
    expect(fixture.history()).toBe(before)
    expect(fixture.speech.requests).toEqual([])
  })

  it('fails the record with the model\'s message when the render fails', async () => {
    const fixture = await start()
    fixture.speech.failure = new Error('The server at http://127.0.0.1:1 cannot be reached.')
    expect(value(await fixture.call('dv_audio_generate', { ...KEY, reason: 'x', prompt: 'Hello.' })).status).toBe('pending')
    await fixture.ctx.dvProject.wait(fixture.project)
    const [entry] = fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'audio.generate' })
    expect(entry?.record).toMatchObject({ status: 'failed', outputs: [], error: { message: 'The server at http://127.0.0.1:1 cannot be reached.' } })
  })
})
