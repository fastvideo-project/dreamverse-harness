/**
 * The `seed-vc` provider plugin in a REAL composition with the Voice component, booted through the Loader from a
 * test-only `cordis.yml`, against a fake Seed-VC server that answers as `dv-backend/seed-vc-server.py` does.
 */
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
import DvModels from '@dv/models'
import DvProject, { type AssetId, type OperationToolValue, type ProjectId, type RecordId } from '@dv/project'
import DvVoiceConvert from '@fastvideo/dreamverse-voice-convert'
import { afterEach, describe, expect, it } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import * as SeedVc from '../src/index.ts'

const KEY = { modality: 'audio', task: 'a2a', provider: 'seed-vc', model: 'seed-vc-v1' } as const

const REFUSAL_END = 'Nothing was generated; change the inputs or params, then call again.'

const HEALTH = '{"model": "seed-vc-v1-whisper-small-wavenet", "sample_rate": 22050}'

/** One answer of the fake server. */
interface Answer { status: number; headers: Record<string, string>; body: string | Buffer }

/** A fake Seed-VC server: `GET /health` answers `health`, `POST /v1/convert` answers `convert`. */
interface FakeServer {
  url: string
  health: Answer
  /** The convert answer; `hang` leaves the request open until the client aborts it. */
  convert: Answer | 'hang'
  /** The answer of `POST /v1/voices/build`. */
  build: Answer
  readonly routes: string[]
  readonly converts: Array<Record<string, unknown>>
  readonly builds: Array<Record<string, unknown>>
  close(): Promise<void>
}

const CONVERTED = Buffer.from('RIFF-CONVERTED')

const BUILT = Buffer.from('RIFF-BUILT-TARGET')

function json(status: number, body: string): Answer {
  return { status, headers: { 'content-type': 'application/json' }, body }
}

async function startServer(): Promise<FakeServer> {
  const fake: FakeServer = {
    url: '', health: json(200, HEALTH), routes: [], converts: [], builds: [],
    build: { status: 200, headers: { 'content-type': 'audio/wav', 'x-speaker-id': 'id10824' }, body: BUILT },
    convert: { status: 200, headers: { 'content-type': 'audio/wav', 'x-duration-sec': '13.073', 'x-inference-time-s': '4.4', 'x-seed': '7' }, body: CONVERTED },
    close: () => Promise.resolve(),
  }
  const send = (response: ServerResponse, answer: Answer): void => {
    response.writeHead(answer.status, { ...answer.headers, connection: 'close' })
    response.end(answer.body)
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    fake.routes.push(`${String(request.method)} ${String(request.url)}`)
    if (request.method === 'GET') {
      send(response, fake.health)
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>
      if (request.url === '/v1/voices/build') {
        fake.builds.push(body)
        send(response, fake.build)
        return
      }
      fake.converts.push(body)
      if (fake.convert !== 'hang') send(response, fake.convert)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  fake.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  fake.close = async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  return fake
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvVoiceConvert,
  SeedVc: { name: SeedVc.name, inject: SeedVc.inject, Config: SeedVc.Config, apply: SeedVc.apply },
}

interface Fixture {
  ctx: Context
  fake: FakeServer
  dir: string
  project: ProjectId
  recording: AssetId
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  history(): number
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const TARGET = Buffer.from('RIFF-TARGET-VOICE')

/**
 * Boot the composition with one allowed voice, `narrator`, whose target clip the fixture writes.
 * @returns the fixture, with a project whose folder chat session `s1` runs in and one recording in its asset pool.
 */
async function start(): Promise<Fixture> {
  const fake = await startServer()
  cleanups.push(() => fake.close())
  const dir = mkdtempSync(join(tmpdir(), 'dv-seed-vc-'))
  writeFileSync(join(dir, 'narrator.wav'), TARGET)
  const globals = globalThis as typeof globalThis & { __dvSeedVc?: typeof PLUGINS }
  globals.__dvSeedVc = PLUGINS
  const rows: string[] = []
  const plugins: Array<[string, keyof typeof PLUGINS, string[]]> = [
    ['system-prompt', 'SystemPrompt', []],
    ['tools', 'ToolRuntime', []],
    ['dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`]],
    ['dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe']],
    ['dv-asset-pool', 'DvAssetPool', []],
    ['dv-models', 'DvModels', []],
    ['dv-voice-convert', 'DvVoiceConvert', []],
    ['dv-seed-vc', 'SeedVc', [`baseUrl: ${fake.url}`, 'voices:', '  narrator:', '    label: The Narrator',
      `    target: ${join(dir, 'narrator.wav')}`, '    note: Recorded and allowed by the narrator for tests.',
      '  teller:', '    label: Miles Teller', '    note: Allowed by the speaker for tests.',
      '  teller-interview:', '    label: Miles Teller (interview)', '    speaker: Miles Teller', '    note: Allowed by the speaker for tests.',
      'diffusionSteps: 100']],
  ]
  for (const [id, key, lines] of plugins) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvSeedVc.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...lines.length === 0 ? [] : ['  config:', ...lines.map(line => `    ${line}`)])
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  const services = provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null }
  const project = await chatProject(ctx.dvProject, services, 'voices', { ...origin, intent: 'create' })
  const recording = await importInto(ctx, project, Buffer.from('RIFF-MY-LINE'), 'audio/wav', 'my-line.wav')
  let calls = 0
  return {
    ctx, fake, dir, project, recording,
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    history: () => ctx.dvProject.listHistory({ project }).length,
  }
}

/** Store bytes in the project's asset pool and record their `asset.import` as the user. */
async function importInto(ctx: Context, project: ProjectId, bytes: Buffer, mime: string, name: string): Promise<AssetId> {
  const asset = ctx.dvAssetPool.importAsset(project, bytes, { mime, name }, null)
  await ctx.dvProject.run({
    project, operation: 'asset.import', inputs: [], actor: 'user', surface: 'api', session: null, turn: null, tool_call: null,
    intent: `import ${name}`, params: { path: ctx.dvAssetPool.path(asset), mime, name, place: false },
  })
  return asset
}

function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

function dataUri(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

describe('dv-seed-vc', () => {
  it('registers seed-vc-v1 for task a2a with its allowed voices, checks the server, and removes the entry on disposal', async () => {
    const fixture = await start()
    expect(value(await fixture.call('dv_models_list', {}))).toEqual([{
      ...KEY,
      description: 'Seed-VC v1: speaks a speech recording again in another voice, keeping its words, timing and intonation; '
        + 'voices: narrator (The Narrator), teller (Miles Teller), teller-interview (Miles Teller (interview)).',
    }])
    expect(await fixture.ctx.dvModels.get(KEY)?.schema()).toEqual({
      voices: [
        { key: 'narrator', label: 'The Narrator' }, { key: 'teller', label: 'Miles Teller' },
        { key: 'teller-interview', label: 'Miles Teller (interview)' },
      ],
      extra: { diffusion_steps: { type: 'integer', description: 'Refinement steps, 1 to 200; 100 when omitted. More steps are slower and change the take little.' } },
    })
    expect(fixture.fake.routes).toEqual(['GET /health'])
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-seed-vc.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.dvModels.get(KEY)).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_voice_convert')).toBeUndefined()
  })

  it('converts the recording to the voice\'s target clip through POST /v1/convert and stores the clip with its duration', async () => {
    const fixture = await start()
    const take = value(await fixture.call('dv_voice_convert', {
      ...KEY, reason: 'take 1', prompt: 'One. Mistake.', voice: 'narrator', seed: 7, extra: { diffusion_steps: 30 },
      inputs: { reference: fixture.recording },
    }))
    expect(fixture.fake.converts).toEqual([{
      diffusion_steps: 30, seed: 7,
      source: dataUri('audio/wav', Buffer.from('RIFF-MY-LINE')),
      target: dataUri('audio/wav', TARGET),
    }])
    // A call without diffusion_steps sends the configured steps.
    value(await fixture.call('dv_voice_convert', { ...KEY, reason: 'take 2', prompt: 'One. Mistake.', voice: 'narrator', inputs: { reference: fixture.recording } }))
    expect(fixture.fake.converts[1]?.['diffusion_steps']).toBe(100)
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(take.record))
    expect(record.report).toEqual({ seed: 7, model_id: 'seed-vc-v1-whisper-small-wavenet', voice: 'narrator', duration_sec: 13.073 })
    const asset = record.outputs[0] as AssetId
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'audio/wav', duration_sec: 13.073 })
  })

  it('builds the target of a voice without a clip from its speaker\'s name once, and asks again after a failed build', async () => {
    const fixture = await start()
    const convert = (voice: string) => fixture.call('dv_voice_convert', {
      ...KEY, reason: voice, prompt: 'One.', voice, inputs: { reference: fixture.recording },
    })
    value(await convert('teller'))
    value(await convert('teller'))
    expect(fixture.fake.builds).toEqual([{ name: 'Miles Teller', seconds: 16 }])
    expect(fixture.fake.converts.map(body => body['target'])).toEqual([dataUri('audio/wav', BUILT), dataUri('audio/wav', BUILT)])
    fixture.fake.build = json(404, '{"error": "VoxCeleb1 has no speaker named \\"Miles Teller\\"."}')
    expect(failure(await convert('teller-interview')))
      .toBe(`The server at ${fixture.fake.url} answered POST /v1/voices/build with HTTP 404: VoxCeleb1 has no speaker named "Miles Teller".`)
    fixture.fake.build = { status: 200, headers: { 'content-type': 'audio/wav' }, body: BUILT }
    value(await convert('teller-interview'))
    expect(fixture.fake.builds.slice(1)).toEqual([{ name: 'Miles Teller', seconds: 16 }, { name: 'Miles Teller', seconds: 16 }])
  })

  it('refuses a voice outside its config, a speech input that is not audio, and unknown extra before any record', async () => {
    const fixture = await start()
    const before = fixture.history()
    const image = await importInto(fixture.ctx, fixture.project, Buffer.from('PNG'), 'image/png', 'face.png')
    const args = { ...KEY, reason: 'guard', prompt: 'One.', voice: 'narrator', inputs: { reference: fixture.recording } }
    expect(failure(await fixture.call('dv_voice_convert', { ...args, voice: 'famous-actor' })))
      .toBe(`Model audio/a2a/seed-vc/seed-vc-v1 cannot generate this: This model has no voice "famous-actor"; its voices are narrator, teller, teller-interview. ${REFUSAL_END}`)
    expect(failure(await fixture.call('dv_voice_convert', { ...args, inputs: { reference: image }, extra: { pitch: 2 } })))
      .toBe(`Model audio/a2a/seed-vc/seed-vc-v1 cannot generate this: The reference input ${image} is not audio; give one recording `
        + `of the spoken line. This model takes no extra parameter pitch; it takes diffusion_steps. ${REFUSAL_END}`)
    expect(failure(await fixture.call('dv_voice_convert', { ...args, extra: { diffusion_steps: 'many' } })))
      .toBe(`Model audio/a2a/seed-vc/seed-vc-v1 cannot generate this: extra."diffusion_steps" must be an integer. ${REFUSAL_END}`)
    // A recording whose record has not finished is checked when the conversion runs.
    expect(await fixture.ctx.dvModels.get(KEY)?.validateGenerationRequest({ speech: null, voice: 'narrator', seed: 1, extra: {} })).toEqual([])
    expect(fixture.history()).toBe(before + 1)
    expect(fixture.fake.converts).toEqual([])
  })

  it('fails the record with the server\'s error, and reports a server of another model as unavailable', async () => {
    const fixture = await start()
    const args = { ...KEY, reason: 'x', prompt: 'One.', voice: 'narrator', inputs: { reference: fixture.recording } }
    fixture.fake.convert = json(400, '{"error": "diffusion_steps must be between 1 and 200."}')
    expect(failure(await fixture.call('dv_voice_convert', { ...args, extra: { diffusion_steps: 500 } })))
      .toBe(`The server at ${fixture.fake.url} answered POST /v1/convert with HTTP 400: diffusion_steps must be between 1 and 200.`)
    fixture.fake.convert = { status: 500, headers: { 'content-type': 'text/plain' }, body: 'Internal Server Error' }
    expect(failure(await fixture.call('dv_voice_convert', args)))
      .toBe(`The server at ${fixture.fake.url} answered POST /v1/convert with HTTP 500: Internal Server Error`)
    fixture.fake.convert = json(500, 'not json')
    expect(failure(await fixture.call('dv_voice_convert', args)))
      .toBe(`The server at ${fixture.fake.url} answered POST /v1/convert with HTTP 500: not json`)
    fixture.fake.convert = json(500, '{"detail": "busy"}')
    expect(failure(await fixture.call('dv_voice_convert', args)))
      .toBe(`The server at ${fixture.fake.url} answered POST /v1/convert with HTTP 500: {"detail": "busy"}`)
    fixture.fake.convert = { status: 200, headers: { 'content-type': 'audio/wav' }, body: CONVERTED }
    expect(failure(await fixture.call('dv_voice_convert', args)))
      .toBe(`The server at ${fixture.fake.url} answered POST /v1/convert without a positive x-duration-sec.`)
    fixture.fake.health = json(503, '{"error": "The model is loading."}')
    expect(failure(await fixture.call('dv_voice_convert', args))).toBe('Model audio/a2a/seed-vc/seed-vc-v1 is unavailable: The server at '
      + `${fixture.fake.url} answered GET /health with HTTP 503: The model is loading. Nothing was generated; no change to the call helps while the model is unavailable.`)
    fixture.fake.health = json(200, '{"model": "other-model"}')
    expect(failure(await fixture.call('dv_voice_convert', args))).toBe('Model audio/a2a/seed-vc/seed-vc-v1 is unavailable: The server at '
      + `${fixture.fake.url} serves other-model, not seed-vc-v1-whisper-small-wavenet; the dv-seed-vc baseUrl points at the wrong server. `
      + 'Nothing was generated; no change to the call helps while the model is unavailable.')
    await fixture.fake.close()
    expect(failure(await fixture.call('dv_voice_convert', args)))
      .toMatch(new RegExp(`^Model audio/a2a/seed-vc/seed-vc-v1 is unavailable: The server at ${fixture.fake.url} cannot be reached\\.`))
  })

  it('stops a conversion when its signal aborts, and converts without a signal', async () => {
    const fixture = await start()
    const entry = fixture.ctx.dvModels.get(KEY)
    const request = { speech: fixture.recording, voice: 'narrator', seed: 3, extra: {} }
    expect(await entry?.render(request)).toEqual({ bytes: new Uint8Array(CONVERTED), mime: 'audio/wav', durationSec: 13.073 })
    expect(await entry?.render({ ...request, voice: 'teller' })).toEqual({ bytes: new Uint8Array(CONVERTED), mime: 'audio/wav', durationSec: 13.073 })
    fixture.fake.convert = 'hang'
    const controller = new AbortController()
    const converting = entry?.render(request, controller.signal)
    while (fixture.fake.converts.length < 3) await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('stopped by the user'))
    await expect(converting).rejects.toThrow('stopped by the user')
  })

  it('fails at load for a config without voices or with a missing or empty target clip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dv-seed-vc-config-'))
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true })
      return Promise.resolve()
    })
    writeFileSync(join(dir, 'empty.wav'), '')
    const ctx = new Context()
    const config = (target: string): SeedVc.Config => ({
      baseUrl: 'http://127.0.0.1:1', voices: { narrator: { label: 'N', target, note: 'test' } }, diffusionSteps: 50, targetSeconds: 16,
    })
    expect(() => { SeedVc.apply(ctx, { baseUrl: 'http://127.0.0.1:1', voices: {}, diffusionSteps: 50, targetSeconds: 16 }) }).toThrow('dv-seed-vc lists no voice; add at least one to voices.')
    expect(() => { SeedVc.apply(ctx, config(join(dir, 'missing.wav'))) })
      .toThrow(`dv-seed-vc voice "narrator" has no readable target clip at ${join(dir, 'missing.wav')}.`)
    expect(() => { SeedVc.apply(ctx, config(join(dir, 'empty.wav'))) })
      .toThrow(`dv-seed-vc voice "narrator" has an empty target clip at ${join(dir, 'empty.wav')}.`)
  })
})
