/**
 * The REAL composition of the `vllm-omni` specs, booted through the Loader from a test-only `cordis.yml` whose plugin
 * `models` config points each model at one server URL, and a fake vLLM-Omni server that answers with the bodies and
 * headers that running vLLM-Omni servers sent.
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
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvAudioGenerate from '@dv/audio-generate'
import DvFfmpeg from '@dv/ffmpeg'
import DvImageGenerate from '@dv/image-generate'
import DvModels, { servesTask, type ModelEntry } from '@dv/models'
import DvProject, { type OperationToolValue, type ProjectId, type ProjectRecord } from '@dv/project'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import * as VllmOmni from '../src/index.ts'

/** The key of the served Qwen-Image 2.1 Turbo entry. */
export const IMAGE_KEY = { modality: 'image', task: 't2i', provider: 'vllm-omni', model: 'qwen-image-2.1-turbo' } as const

/** The key of the served Qwen3-TTS CustomVoice entry. */
export const SPEECH_KEY = { modality: 'audio', task: 't2a', provider: 'vllm-omni', model: 'qwen3-tts-customvoice' } as const

/** The sentence that ends a refusal that other inputs or params can fix. */
export const REFUSAL_END = 'Nothing was generated; change the inputs or params, then call again.'

/** The sentence that ends the refusal of an unavailable model. */
export const UNAVAILABLE_END = 'Nothing was generated; no change to the call helps while the model is unavailable.'

/** The `GET /v1/models` body of the running Qwen-Image 2.1 Turbo server, without its permission list. */
export const IMAGE_MODELS = JSON.stringify({ object: 'list', data: [{
  id: 'Qwen/Qwen-Image-2.1-Turbo', object: 'model', created: 1795069570, owned_by: 'vllm', root: 'Qwen/Qwen-Image-2.1-Turbo', parent: null, max_model_len: null,
}] })

/** The `GET /v1/models` body of the running Qwen3-TTS CustomVoice server, without its permission list. */
export const SPEECH_MODELS = JSON.stringify({ object: 'list', data: [{
  id: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', object: 'model', created: 1795072536, owned_by: 'vllm', root: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
  parent: null, max_model_len: 4096,
}] })

/** The `GET /v1/audio/voices` body of the running Qwen3-TTS CustomVoice server. */
export const VOICES = JSON.stringify({
  voices: ['aiden', 'default', 'dylan', 'eric', 'ono_anna', 'ryan', 'serena', 'sohee', 'uncle_fu', 'vivian'], uploaded_voices: [],
})

/** A PNG signature followed by bytes that stand for the image. */
export const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('FAKE-IMAGE')])

/**
 * The `POST /v1/images/generations` body of the running server for one image.
 * @param size - the size that the answer reports.
 * @param bytes - the image bytes.
 * @returns the JSON body.
 */
export function generated(size: string, bytes: Buffer = PNG): string {
  return JSON.stringify({
    created: 1795069581, data: [{ b64_json: bytes.toString('base64'), url: null, revised_prompt: null }], output_format: 'png', size,
    cot_output: null, metrics: { stage_durations: { queue_wait_ms: 0.22, stage_0_gen_ms: 641.0 }, peak_memory_mb: 38160.0 },
  })
}

/** A WAV header and samples that stand for one clip. */
export const WAV = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVEfmt FAKE-CLIP', 'latin1')])

/**
 * The headers of a `POST /v1/audio/speech` answer of the running server.
 * @param duration - the `x-audio-duration-seconds` value, or null to leave it out.
 * @param truncated - the `x-audio-truncated` value.
 * @returns the headers.
 */
export function speechHeaders(duration: string | null, truncated = 'false'): Record<string, string> {
  return {
    'content-type': 'audio/wav', 'x-audio-sample-rate': '24000', 'x-audio-channels': '1', 'x-audio-truncated': truncated,
    ...duration === null ? {} : { 'x-audio-duration-seconds': duration },
  }
}

/** One answer of the fake server: the status, the headers and the body. */
export interface FakeAnswer { status: number; headers: Record<string, string>; body: string | Buffer }

/**
 * A JSON answer.
 * @param status - the HTTP status.
 * @param body - the JSON text.
 * @returns the answer.
 */
export function json(status: number, body: string): FakeAnswer {
  return { status, headers: { 'content-type': 'application/json' }, body }
}

/** The OpenAI error body that vLLM-Omni sends with an HTTP error. */
export function errorBody(message: string, code: number): string {
  return JSON.stringify({ error: { message, type: 'Bad Request', param: null, code } })
}

/** A fake vLLM-Omni server: one answer per route; `hang` leaves a request open until the client aborts it. */
export interface FakeServer {
  url: string
  answers: Record<string, FakeAnswer | 'hang'>
  /** The method and route of each request, in order. */
  readonly routes: string[]
  /** The JSON body of each `POST`, in order. */
  readonly bodies: Array<Record<string, unknown>>
  close(): Promise<void>
}

/**
 * Start a fake vLLM-Omni server on a free loopback port.
 * @param models - the `GET /v1/models` body.
 * @returns the server; by default it answers like the server that `models` names.
 */
export async function startFake(models: string): Promise<FakeServer> {
  const fake: FakeServer = {
    url: '', routes: [], bodies: [], close: () => Promise.resolve(),
    answers: {
      'GET /v1/models': json(200, models), 'GET /v1/audio/voices': json(200, VOICES),
      'POST /v1/images/generations': json(200, generated('1024x1024')),
      'POST /v1/audio/speech': { status: 200, headers: speechHeaders('1.840'), body: WAV },
    },
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      const route = `${String(request.method)} ${String(request.url)}`
      fake.routes.push(route)
      if (request.method === 'POST') fake.bodies.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      const answer = fake.answers[route] ?? json(404, errorBody(`no route ${route}`, 404))
      if (answer === 'hang') return
      response.writeHead(answer.status, { ...answer.headers, connection: 'close' })
      response.end(answer.body)
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

/**
 * A loopback URL where no server listens.
 * @returns the URL of a port that was free a moment ago.
 */
export async function closedUrl(): Promise<string> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  await new Promise(resolve => server.close(resolve))
  return `http://127.0.0.1:${String(port)}`
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvImageGenerate, DvAudioGenerate,
  VllmOmni: { name: VllmOmni.name, inject: VllmOmni.inject, Config: VllmOmni.Config, apply: VllmOmni.apply },
}

/** The booted composition and a project whose folder chat session `s1` runs in. */
export interface Fixture {
  ctx: Context
  project: ProjectId
  image(): ModelEntry<'t2i'>
  speech(): ModelEntry<'t2a'>
  tool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** The `image.generate` and `audio.generate` records of the project. */
  records(): ProjectRecord[]
  /** Dispose the `dv-vllm-omni` row alone. */
  disposePlugin(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param servers - the server URL of each configured model, by model name.
 * @returns the fixture; the caller disposes it.
 */
export async function start(servers: Record<string, string>): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-vllm-omni-'))
  const globals = globalThis as typeof globalThis & { __dvVllmOmni?: typeof PLUGINS }
  globals.__dvVllmOmni = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[] = []): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvVllmOmni.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt')
  row('tools', 'ToolRuntime')
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool')
  row('dv-models', 'DvModels')
  row('dv-image-generate', 'DvImageGenerate')
  row('dv-audio-generate', 'DvAudioGenerate')
  row('dv-vllm-omni', 'VllmOmni', ['models:', ...Object.entries(servers).flatMap(([model, url]) => [`  ${model}:`, `    baseUrl: ${url}`])])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  const services = provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null, intent: 'create' }
  const project = await chatProject(ctx.dvProject, services, 'omni', origin)
  let calls = 0
  return {
    ctx, project,
    image() {
      const entry = ctx.dvModels.get(IMAGE_KEY)
      if (entry === undefined || !servesTask(entry, ['t2i'])) throw new Error('qwen-image-2.1-turbo is not registered')
      return entry
    },
    speech() {
      const entry = ctx.dvModels.get(SPEECH_KEY)
      if (entry === undefined || !servesTask(entry, ['t2a'])) throw new Error('qwen3-tts-customvoice is not registered')
      return entry
    },
    tool(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    records: () => ctx.dvProject.getState(project).components.proj.records.filter(record => record.operation?.endsWith('.generate') === true),
    async disposePlugin() {
      const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-vllm-omni.mjs'))
      await entry?.fiber?.dispose()
    },
    async dispose() {
      await ctx.fiber.dispose()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * The value of a successful operation tool call.
 * @throws Error with the tool's message for a failed call.
 */
export function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

/** The error message of a failed tool call; empty for a successful one. */
export function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}
