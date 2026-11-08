/**
 * The Voice component in a REAL composition booted through the Loader from a test-only `cordis.yml`; the voice model is
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
import DvVoiceConvert, { type ConvertedVoice, type VoiceRequest } from '../src/index.ts'

const KEY = { modality: 'audio', task: 'a2a', provider: 'test', model: 'fake' }

const CLIP = Buffer.from('RIFF-FAKE-VOICE')

class FakeVoices {
  readonly requests: VoiceRequest[] = []
  check: (request: VoiceRequest) => string[] = () => []
  failure: Error | null = null

  render(request: VoiceRequest): Promise<ConvertedVoice> {
    this.requests.push(request)
    if (this.failure !== null) return Promise.reject(this.failure)
    return Promise.resolve({ bytes: CLIP, mime: 'audio/wav', durationSec: 3.5 })
  }
}

function fakeEntry(voices: FakeVoices): ModelEntry<'a2a'> {
  return {
    modality: 'audio', task: 'a2a', provider: 'test', model: 'fake', description: 'Fixed voices',
    facts: () => Promise.resolve({ modelId: 'test-voice' }),
    schema: () => Promise.resolve({ voices: [{ key: 'narrator', label: 'Narrator' }] }),
    validateGenerationRequest: request => Promise.resolve(voices.check(request)),
    render: request => voices.render(request),
  }
}

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvVoiceConvert }

interface Fixture {
  ctx: Context
  voices: FakeVoices
  project: ProjectId
  recording: AssetId
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
 * @returns the fixture, with a project whose folder chat session `s1` runs in and one recording in its asset pool.
 */
async function start(options: { model?: boolean } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-voice-convert-'))
  const globals = globalThis as typeof globalThis & { __dvVoiceConvertComposition?: typeof PLUGINS }
  globals.__dvVoiceConvertComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvVoiceConvertComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [])
  row('dv-models', 'DvModels', [])
  row('dv-voice-convert', 'DvVoiceConvert', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const services = provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const voices = new FakeVoices()
  if (options.model !== false) ctx.effect(() => ctx.dvModels.register(fakeEntry(voices)))
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null }
  const project = await chatProject(ctx.dvProject, services, 'voices', { ...origin, intent: 'create' })
  const recording = ctx.dvAssetPool.importAsset(project, Buffer.from('RIFF-MY-LINE'), { mime: 'audio/wav', name: 'my-line.wav' }, null)
  await ctx.dvProject.run({
    project, operation: 'asset.import', inputs: [], ...origin, intent: 'import my-line.wav',
    params: { path: ctx.dvAssetPool.path(recording), mime: 'audio/wav', name: 'my-line.wav', place: false },
  })
  let calls = 0
  return {
    ctx, voices, project, recording,
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

function voiceSpec(fixture: Fixture): OperationSpec | undefined {
  return fixture.ctx.dvProject.listOperations().find(spec => spec.name === 'voice.convert')
}

describe('dvVoiceConvert', () => {
  it('registers voice.convert and dv_voice_convert while the catalog holds an a2a model, and removes both on disposal', async () => {
    const fixture = await start()
    expect(voiceSpec(fixture)).toMatchObject({
      component: 'voice', label: { zh: '转换音色', en: 'Convert voice' }, resource: 'gpu', deterministic: false,
      inputs: { reference: { type: 'audio', required: true, description: 'The speech recording to convert, such as the user\'s own reading of the line.' } },
      outputs: [{ role: 'audio', type: 'audio' }],
    })
    const tool = fixture.ctx.tools.schemas().find(schema => schema.name === 'dv_voice_convert')
    expect(tool?.description).toBe('Speak one speech recording again in an allowed voice with an a2a model from dv_models_list; '
      + 'modality, task, provider and model name it and are required. dv_models_get lists the model\'s voices; voice names one '
      + 'of them. The converted clip keeps the recording\'s words, timing and intonation, so use it as the dialogue track of a '
      + 'shot, reused unchanged. The clip is the one output; the result gives its duration. You cannot hear the clip, so ask '
      + 'the user which take to keep. Every call is a new take; the same seed repeats one. Uses the GPU.')
    expect(Object.keys(voiceSpec(fixture)?.params ?? {})).toEqual(['modality', 'task', 'provider', 'model', 'prompt', 'voice', 'seed', 'extra'])
    expect(fixture.ctx.dvModels.taskLabels()).toEqual({ a2a: { zh: '音色转换', en: 'Voice conversion' } })
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-voice-convert.mjs'))
    await entry?.fiber?.dispose()
    expect(voiceSpec(fixture)).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_voice_convert')).toBeUndefined()
    expect(fixture.ctx.dvModels.taskLabels()).toEqual({})
  })

  it('has no operation without an a2a model, and follows the catalog', async () => {
    const fixture = await start({ model: false })
    expect(voiceSpec(fixture)).toBeUndefined()
    const remove = fixture.ctx.dvModels.register(fakeEntry(fixture.voices))
    expect(fixture.ctx.tools.get('dv_voice_convert')).toBeDefined()
    remove()
    expect(fixture.ctx.tools.get('dv_voice_convert')).toBeUndefined()
  })

  it('converts the recording into the voice, stores the clip with its duration, and reports the voice and seed', async () => {
    const fixture = await start()
    const args = { ...KEY, reason: 'take 1', prompt: 'One. Fucking. Mistake.', voice: ' narrator ', seed: 7, extra: { steps: 30 }, inputs: { reference: fixture.recording } }
    const take = value(await fixture.call('dv_voice_convert', args))
    expect(fixture.voices.requests).toEqual([{ speech: fixture.recording, voice: 'narrator', seed: 7, extra: { steps: 30 } }])
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(take.record))
    expect(record).toMatchObject({ status: 'done', component: 'voice', operation: 'voice.convert', actor: 'agent' })
    expect(record.inputs).toMatchObject([{ role: 'reference', resolved_asset: fixture.recording }])
    expect(record.report).toEqual({ seed: 7, model_id: 'test-voice', voice: 'narrator', duration_sec: 3.5 })
    const asset = record.outputs[0] as AssetId
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'audio/wav', duration_sec: 3.5, name: `${record.id.slice(0, 8)}.wav`, created_by: record.id })
    expect(voiceSpec(fixture)?.summarize(record)).toBe('voice narrator "One. Fucking. Mistake." (3.5s)')
    const { report: _report, ...withoutReport } = record
    expect(voiceSpec(fixture)?.summarize(withoutReport)).toBe('voice narrator "One. Fucking. Mistake." (?s)')
    // Without a seed, the call draws one and reports it.
    const { seed: _seed, ...unseeded } = args
    const second = value(await fixture.call('dv_voice_convert', { ...unseeded, reason: 'take 2' }))
    const drawn = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(second.record)).report?.['seed']
    expect(typeof drawn).toBe('number')
    expect(fixture.voices.requests[1]?.seed).toBe(drawn)
  })

  it('refuses an empty voice, a call without its recording, and the problems of the model before any record', async () => {
    const fixture = await start()
    const before = fixture.history()
    const args = { ...KEY, reason: 'guard', prompt: 'One.', voice: 'narrator', inputs: { reference: fixture.recording } }
    expect(failure(await fixture.call('dv_voice_convert', { ...args, voice: '  ' })))
      .toBe('The voice is empty; name one voice that dv_models_get lists for the model. Nothing was generated; change the inputs or params, then call again.')
    const state = fixture.ctx.dvProject.getState(fixture.project)
    expect(await fixture.ctx.dvVoiceConvert.check({ project: fixture.project, params: { ...KEY, prompt: 'One.', voice: 'narrator' }, inputs: [] }, state))
      .toEqual(['voice.convert takes exactly one speech recording in inputs.reference.'])
    expect(await fixture.ctx.dvVoiceConvert.check({ project: fixture.project, params: { ...KEY, prompt: 'One.' }, inputs: [] }, state))
      .toEqual(['The voice is empty; name one voice that dv_models_get lists for the model.'])
    fixture.voices.check = request => request.voice === 'narrator' ? [] : [`It has no voice "${request.voice}".`]
    expect(failure(await fixture.call('dv_voice_convert', { ...args, voice: 'someone-else' })))
      .toBe('Model audio/a2a/test/fake cannot generate this: It has no voice "someone-else". Nothing was generated; change the inputs or params, then call again.')
    expect(fixture.history()).toBe(before)
    expect(fixture.voices.requests).toEqual([])
  })

  it('fails the record with the model\'s message when the conversion fails', async () => {
    const fixture = await start()
    fixture.voices.failure = new Error('The server at http://127.0.0.1:1 cannot be reached.')
    expect(failure(await fixture.call('dv_voice_convert', { ...KEY, reason: 'x', prompt: 'One.', voice: 'narrator', inputs: { reference: fixture.recording } })))
      .toBe('The server at http://127.0.0.1:1 cannot be reached.')
    const [entry] = fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'voice.convert' })
    expect(entry?.record).toMatchObject({ status: 'failed', outputs: [] })
  })
})
