/**
 * The REAL composition of the `sglang-omni` specs, booted through the Loader from a test-only `cordis.yml` whose plugin
 * `models` config points at one server URL, and a fake SGLang-Omni server that answers with the bodies and headers that
 * a running server sent.
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
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvAudioGenerate from '@dv/audio-generate'
import DvFfmpeg from '@dv/ffmpeg'
import DvModels, { type ModelEntry } from '@dv/models'
import DvProject, { type OperationToolValue, type ProjectId } from '@dv/project'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import * as SglangOmni from '../src/index.ts'

/** The key of the served Fish Audio Drama 3 entry. */
export const KEY = { modality: 'audio', task: 't2a', provider: 'sglang-omni', model: 'fish-audio-drama-3' } as const

/** The opening of every refusal of a request that the entry's validation rejects. */
export const CANNOT = 'Model audio/t2a/sglang-omni/fish-audio-drama-3 cannot generate this: '

/** The sentence that ends a refusal that other inputs or params can fix. */
export const REFUSAL_END = 'Nothing was generated; change the inputs or params, then call again.'

/** The opening of a refusal whose model check failed, such as a server that serves another model. */
export const UNAVAILABLE = 'Model audio/t2a/sglang-omni/fish-audio-drama-3 is unavailable: '

/** The sentence that ends the refusal of an unavailable model. */
export const UNAVAILABLE_END = 'Nothing was generated; no change to the call helps while the model is unavailable.'

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SkillRegistry, SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvAudioGenerate,
  SglangOmni: { name: SglangOmni.name, inject: SglangOmni.inject, Config: SglangOmni.Config, apply: SglangOmni.apply },
}

/** The booted composition and a project whose folder chat session `s1` runs in. */
export interface Fixture {
  ctx: Context
  project: ProjectId
  entry(): ModelEntry<'t2a'>
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  history(): number
  dispose(): Promise<void>
}

function isSpeechEntry(entry: ModelEntry): entry is ModelEntry<'t2a'> {
  return entry.task === 't2a'
}

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param baseUrl - the server of `fish-audio-drama-3` in the plugin config.
 * @returns the fixture; the caller disposes it.
 */
export async function start(baseUrl: string): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-sglang-omni-'))
  const globals = globalThis as typeof globalThis & { __dvSglangOmni?: typeof PLUGINS }
  globals.__dvSglangOmni = PLUGINS
  const rows: string[] = []
  const plugins: Array<[string, keyof typeof PLUGINS, string[]]> = [
    ['skills', 'SkillRegistry', []],
    ['system-prompt', 'SystemPrompt', []],
    ['tools', 'ToolRuntime', []],
    ['dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`]],
    ['dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe']],
    ['dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`]],
    ['dv-models', 'DvModels', []],
    ['dv-audio-generate', 'DvAudioGenerate', []],
    ['dv-sglang-omni', 'SglangOmni', ['models:', '  fish-audio-drama-3:', `    baseUrl: ${baseUrl}`]],
  ]
  for (const [id, key, lines] of plugins) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvSglangOmni.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...lines.length === 0 ? [] : ['  config:', ...lines.map(line => `    ${line}`)])
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  const services = provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null }
  const project = await chatProject(ctx.dvProject, services, 'voices', { ...origin, intent: 'create' })
  let calls = 0
  return {
    ctx, project,
    entry() {
      const entry = ctx.dvModels.get(KEY)
      if (entry === undefined || !isSpeechEntry(entry)) throw new Error('fish-audio-drama-3 is not registered')
      return entry
    },
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    history: () => ctx.dvProject.listHistory({ project }).length,
    async dispose() {
      await ctx.fiber.dispose()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** The value of a successful operation tool call. */
export function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

/** The error message of a failed tool call. */
export function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

/** One answer of the fake server: the status, the headers and the body. */
export interface FakeAnswer {
  status: number
  headers: Record<string, string>
  body: string | Buffer
}

/** The headers of a `POST /v1/audio/speech` answer of a running server, with its finish reason. */
export function speechHeaders(finishReason: 'stop' | 'length'): Record<string, string> {
  return { 'content-type': 'audio/wav', 'content-disposition': 'attachment; filename="speech.wav"', 'x-finish-reason': finishReason }
}

/**
 * A PCM WAV file in the format the server sends (mono, 16-bit, 44,100 Hz, so 88,200 bytes per second).
 * @param dataBytes - the size of the `data` chunk.
 * @param before - chunks to write between `fmt ` and `data`, such as a `LIST` chunk.
 * @returns the bytes.
 */
export function wav(dataBytes: number, before: Buffer[] = []): Buffer {
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'latin1')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10)
  fmt.writeUInt32LE(44_100, 12)
  fmt.writeUInt32LE(88_200, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, ...before, chunk('data', Buffer.alloc(dataBytes))])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(body.length, 4)
  return Buffer.concat([riff, body])
}

/** One RIFF chunk with its tag, its size and, for an odd size, its pad byte. */
export function chunk(tag: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.write(tag, 0, 'latin1')
  head.writeUInt32LE(data.length, 4)
  return Buffer.concat([head, data, Buffer.alloc(data.length % 2)])
}

/** The `GET /v1/models` body of the running SGLang-Omni server. */
export const OMNI_MODELS = '{"object":"list","data":[{"id":"fishaudio/drama-3","object":"model","created":0,"owned_by":"sglang-omni",'
  + '"permission":[{"id":"modelperm-default","object":"model_permission","allow_create_engine":false,"allow_sampling":true,'
  + '"allow_logprobs":true}],"root":"fishaudio/drama-3"}]}'

/** A fake SGLang-Omni server: it answers `GET /v1/models` with `models` and `POST /v1/audio/speech` with `speech`. */
export interface FakeOmni {
  url: string
  readonly requests: Array<Record<string, unknown>>
  models: FakeAnswer
  /** The speech answer; `hang` leaves the request open until the client aborts it. */
  speech: FakeAnswer | 'hang'
  close(): Promise<void>
}

/** A JSON answer with the given status. */
export function json(status: number, body: string): FakeAnswer {
  return { status, headers: { 'content-type': 'application/json' }, body }
}

/**
 * Start a fake SGLang-Omni server on a free loopback port.
 * @returns the server; by default it serves `fishaudio/drama-3` and answers speech with a 1.5-second WAV clip.
 */
export async function startFakeOmni(): Promise<FakeOmni> {
  const fake: FakeOmni = {
    url: '', requests: [], models: json(200, OMNI_MODELS),
    speech: { status: 200, headers: speechHeaders('stop'), body: wav(132_300) },
    close: () => Promise.resolve(),
  }
  const send = (response: ServerResponse, answer: FakeAnswer): void => {
    response.writeHead(answer.status, { ...answer.headers, connection: 'close' })
    response.end(answer.body)
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET') {
      send(response, fake.models)
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      fake.requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      if (fake.speech !== 'hang') send(response, fake.speech)
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
