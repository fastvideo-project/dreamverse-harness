/**
 * The SGLang diffusion provider plugin in a REAL composition booted through the Loader from a test-only `cordis.yml`,
 * against a fake SGLang diffusion server that answers with the bodies, content types and statuses of a running server.
 * An opt-in suite runs against the running server that `DV_SGLANG_DIFFUSION_TEST_URL` names.
 */
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
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
import DvImageGenerate, { type ImageRequest } from '@dv/image-generate'
import DvModels, { servesTask, type ModelEntry } from '@dv/models'
import DvProject, { type AssetId, type OperationToolValue, type ProjectId, type ProjectRecord } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import * as SglangDiffusion from '../src/index.ts'

const REAL_SERVER = process.env['DV_SGLANG_DIFFUSION_TEST_URL']
const OTHER_REAL_SERVER = process.env['DV_SGLANG_OMNI_TEST_URL']

const KEY = { modality: 'image', task: 't2i', provider: 'sglang-diffusion', model: 'qwen-image-2.1-turbo' } as const

const REFUSAL_END = 'Nothing was generated; change the inputs or params, then call again.'

const UNAVAILABLE_END = 'Nothing was generated; no change to the call helps while the model is unavailable.'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const IMAGE_MODELS = {
  object: 'list',
  data: [{
    id: 'Qwen/Qwen-Image-2.1-Turbo', object: 'model', created: 1792637139, owned_by: 'sglang', root: 'Qwen/Qwen-Image-2.1-Turbo',
    parent: null, max_model_len: null, num_gpus: 1, task_type: 'TI2I', supported_task_types: ['TI2I'], dit_precision: 'bf16',
    vae_precision: 'bf16', pipeline_name: 'QwenImage21Pipeline', pipeline_class: 'QwenImage21Pipeline',
  }],
}

const SPEECH_MODELS = {
  object: 'list',
  data: [{ id: 'fishaudio/drama-3', object: 'model', created: 0, owned_by: 'sglang-omni', root: 'fishaudio/drama-3' }],
}

const PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('FAKE-IMAGE')])

interface FakeAnswer { status: number; type: string; body: string }

function json(body: object): FakeAnswer {
  return { status: 200, type: 'application/json', body: JSON.stringify(body) }
}

const GENERATED = json({
  id: '72615b32-3bea-46f8-8321-2c36ac53d824', created: 1792637141,
  data: [{ b64_json: PNG.toString('base64'), url: null, revised_prompt: 'x', file_path: '/outputs/72615b32.png', resize: null }],
  peak_memory_mb: 38582.0, inference_time_s: 1.3613448347896338, usage: null,
})

interface FakeServer {
  url: string
  models: FakeAnswer
  generation: FakeAnswer
  routes: string[]
  generations: Array<Record<string, unknown>>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Start a fake SGLang diffusion server.
 * @returns the server, which answers with the image models list and `GENERATED` until a test changes its answers.
 */
async function startFakeServer(): Promise<FakeServer> {
  const fake: FakeServer = { url: '', models: json(IMAGE_MODELS), generation: GENERATED, routes: [], generations: [] }
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      fake.routes.push(`${String(request.method)} ${String(request.url)}`)
      const generation = request.method === 'POST'
      if (generation) fake.generations.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      const answer = generation ? fake.generation : fake.models
      response.writeHead(answer.status, { 'content-type': answer.type, connection: 'close' })
      response.end(answer.body)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  fake.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  return fake
}

async function closedUrl(): Promise<string> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  await new Promise(resolve => server.close(resolve))
  return `http://127.0.0.1:${String(port)}`
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvImageGenerate,
  SglangDiffusion: {
    name: SglangDiffusion.name, inject: SglangDiffusion.inject, Config: SglangDiffusion.Config, apply: SglangDiffusion.apply,
  },
}

interface Fixture {
  ctx: Context
  project: ProjectId
  tool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  entry(): ModelEntry<'t2i'>
  records(): ProjectRecord[]
}

/**
 * Boot the composition from a test-only `cordis.yml` whose plugin row serves `qwen-image-2.1-turbo` at `baseUrl`.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(baseUrl: string): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-sglang-diffusion-'))
  const globals = globalThis as typeof globalThis & { __dvSglangDiffusion?: typeof PLUGINS }
  globals.__dvSglangDiffusion = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[] = []): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvSglangDiffusion.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt')
  row('tools', 'ToolRuntime')
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [])
  row('dv-models', 'DvModels')
  row('dv-image-generate', 'DvImageGenerate')
  row('dv-sglang-diffusion', 'SglangDiffusion', ['models:', '  qwen-image-2.1-turbo:', `    baseUrl: ${baseUrl}`])
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
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null, intent: 'create' }
  const project = await chatProject(ctx.dvProject, services, 'images', origin)
  let calls = 0
  return {
    ctx, project,
    tool(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    entry() {
      const entry = ctx.dvModels.get(KEY)
      if (entry === undefined || !servesTask(entry, ['t2i'])) throw new Error('qwen-image-2.1-turbo is not registered')
      return entry
    },
    records: () => ctx.dvProject.getState(project).components.proj.records.filter(record => record.operation === 'image.generate'),
  }
}

function value(result: ToolExecutionResult): unknown {
  if (result.isError) throw new Error(result.error.message)
  return result.value
}

function operationValue(result: ToolExecutionResult): OperationToolValue {
  return value(result) as OperationToolValue
}

function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

function request(size: ImageRequest['size'], extra: Record<string, unknown> = {}): ImageRequest {
  return { prompt: 'a red paper lantern', size, seed: 7, extra }
}

describe('dv-sglang-diffusion', () => {
  it('registers the configured model with its description, rate and default size, and removes it on disposal', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    expect(value(await fixture.tool('dv_models_list', {}))).toEqual([{
      ...KEY,
      description: 'Qwen-Image 2.1 Turbo: a text-to-image model that renders legible text inside the image, such as posters, '
        + 'labels and interface layouts. The same seed, size and prompt give the same image.',
    }])
    expect(fixture.ctx.tools.get('dv_image_generate')).toBeDefined()
    const row = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-sglang-diffusion.mjs'))
    await row?.fiber?.dispose()
    expect(fixture.ctx.dvModels.list()).toEqual([])
    expect(fixture.ctx.tools.get('dv_image_generate')).toBeUndefined()
  })

  it('refuses a config that names a model it does not serve', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    expect(() => { SglangDiffusion.apply(fixture.ctx, { models: { 'flux-1': { baseUrl: server.url } } }) })
      .toThrow('dv-sglang-diffusion serves no model "flux-1"; it serves: qwen-image-2.1-turbo.')
    expect(fixture.ctx.dvModels.list().map(entry => entry.model)).toEqual(['qwen-image-2.1-turbo'])
  })

  it('reads the facts and the schema after the server lists the model, and names a server that does not', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    expect(await fixture.entry().facts()).toEqual({ modelId: 'Qwen/Qwen-Image-2.1-Turbo' })
    expect(value(await fixture.tool('dv_models_get', KEY))).toMatchObject({
      schema: {
        size: {
          default: '1024x1024', rule: 'width and height are positive multiples of 32, and width times height is at most 4300800',
          by_aspect_ratio: {
            '1:1': '2048x2048', '4:3': '2400x1792', '3:4': '1792x2400', '3:2': '2528x1696',
            '2:3': '1696x2528', '16:9': '2752x1536', '9:16': '1536x2752',
          },
        },
        extra: {},
      },
    })
    expect(server.routes).toEqual(['GET /v1/models', 'GET /v1/models'])
    server.models = json(SPEECH_MODELS)
    const misrouted = `The server at ${server.url} serves fishaudio/drama-3, not Qwen/Qwen-Image-2.1-Turbo; the dv-sglang-diffusion `
      + 'config points this model at the wrong server.'
    await expect(fixture.entry().facts()).rejects.toThrow(misrouted)
    expect(failure(await fixture.tool('dv_models_get', KEY))).toBe(misrouted)
    server.models = { status: 503, type: 'text/plain; charset=utf-8', body: 'busy' }
    await expect(fixture.entry().schema()).rejects.toThrow(`The server at ${server.url} answered GET /v1/models with HTTP 503: busy`)
    const closed = await start(await closedUrl())
    await expect(closed.entry().facts()).rejects.toThrow(/^The server at http:\/\/127\.0\.0\.1:\d+ cannot be reached\.$/)
  })

  it('refuses sizes that are not multiples of 32 or above the pixel limit with the nearest sizes, and any extra value, without a server call', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    const validate = (size: ImageRequest['size'], extra?: Record<string, unknown>) => fixture.entry().validateGenerationRequest(request(size, extra))
    expect(await validate(null)).toEqual([])
    const { schema } = value(await fixture.tool('dv_models_get', KEY)) as { schema: { size: { by_aspect_ratio: Record<string, string> } } }
    for (const preset of Object.values(schema.size.by_aspect_ratio)) {
      const [width = 0, height = 0] = preset.split('x').map(Number)
      expect(await validate({ width, height })).toEqual([])
    }
    const tooLarge = (size: string, pixels: number, preset: string) =>
      `The model renders at most 4300800 pixels, and ${size} has ${String(pixels)}; the preset nearest its aspect ratio is ${preset}.`
    expect(await validate({ width: 2432, height: 1792 })).toEqual([tooLarge('2432x1792', 4358144, '2400x1792 (4:3)')])
    expect(await validate({ width: 4096, height: 4096 })).toEqual([tooLarge('4096x4096', 16777216, '2048x2048 (1:1)')])
    expect(await validate({ width: 8224, height: 1024 })).toEqual([tooLarge('8224x1024', 8421376, '2752x1536 (16:9)')])
    expect(await validate({ width: 1024, height: 8224 })).toEqual([tooLarge('1024x8224', 8421376, '1536x2752 (9:16)')])
    expect(await validate({ width: 1000, height: 1000 }))
      .toEqual(['Width and height must each be a multiple of 32, and 1000x1000 is not; the nearest sizes are 992x992 and 1024x1024.'])
    expect(await validate({ width: 16, height: 16 }))
      .toEqual(['Width and height must each be a multiple of 32, and 16x16 is not; the nearest size is 32x32.'])
    expect(await validate(null, { steps: 8 })).toEqual(['This model takes no extra parameter; omit extra.'])
    expect(server.routes).toEqual(['GET /v1/models'])
  })

  it('renders through dv_image_generate: the request it sends, and the image it stores', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    const result = operationValue(await fixture.tool('dv_image_generate', { ...KEY, reason: 'lantern', prompt: 'a red paper lantern', size: '1024x768', seed: 1234 }))
    expect(server.generations).toEqual([
      { prompt: 'a red paper lantern', size: '1024x768', seed: 1234, n: 1, response_format: 'b64_json', output_format: 'png' },
    ])
    expect(server.routes).toEqual(['GET /v1/models', 'GET /v1/models', 'GET /v1/models', 'POST /v1/images/generations'])
    const record = fixture.records().at(-1)
    expect(record).toMatchObject({
      id: result.record, status: 'done',
      report: { seed: 1234, model_id: 'Qwen/Qwen-Image-2.1-Turbo', size: '1024x768' },
    })
    const asset = brandString<AssetId>(String(result.outputs[0]?.asset_id))
    expect(fixture.ctx.dvAssetPool.read(asset)).toEqual(PNG)
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'image/png', width: 1024, height: 768 })
    const square = operationValue(await fixture.tool('dv_image_generate', { ...KEY, reason: 'square', prompt: 'a lantern', seed: 1 }))
    expect(server.generations[1]).toMatchObject({ size: '1024x1024' })
    expect(square.report).toMatchObject({ size: '1024x1024' })
  })

  it('fails a render whose answer holds no PNG image', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    const noPng = `The server at ${server.url} answered POST /v1/images/generations without a PNG image.`
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
    for (const data of [[{ b64_json: jpeg.toString('base64') }], [], [{ b64_json: null, url: '/v1/images/1/content' }], null]) {
      server.generation = json({ data })
      await expect(fixture.entry().render(request(null))).rejects.toThrow(noPng)
    }
    expect(failure(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'x' }))).toBe(noPng)
    expect(fixture.records().at(-1)).toMatchObject({ status: 'failed', error: { message: noPng } })
  })

  it('refuses a size and a misrouted server before any record, with the closing sentence of each case', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    expect(failure(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'x', size: '1000x1000' }))).toBe(
      'Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo cannot generate this: Width and height must each be a multiple of 32, '
      + `and 1000x1000 is not; the nearest sizes are 992x992 and 1024x1024. ${REFUSAL_END}`)
    expect(failure(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'x', size: '4096x4096' }))).toBe(
      'Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo cannot generate this: The model renders at most 4300800 pixels, and '
      + `4096x4096 has 16777216; the preset nearest its aspect ratio is 2048x2048 (1:1). ${REFUSAL_END}`)
    server.models = json(SPEECH_MODELS)
    expect(failure(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'x' }))).toBe(
      `Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo is unavailable: The server at ${server.url} serves fishaudio/drama-3, `
      + `not Qwen/Qwen-Image-2.1-Turbo; the dv-sglang-diffusion config points this model at the wrong server. ${UNAVAILABLE_END}`)
    expect(fixture.records()).toEqual([])
    expect(server.generations).toEqual([])
  })

  it('fails a render with the server\'s answer, a server that cannot be reached, or the abort reason', async () => {
    const server = await startFakeServer()
    const fixture = await start(server.url)
    const route = `The server at ${server.url} answered POST /v1/images/generations with HTTP`
    server.generation = { status: 500, type: 'text/plain; charset=utf-8', body: 'Internal Server Error' }
    expect(failure(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'x' }))).toBe(`${route} 500: Internal Server Error`)
    expect(fixture.records().at(-1)).toMatchObject({ status: 'failed', error: { message: `${route} 500: Internal Server Error` } })
    server.generation = { status: 400, type: 'application/json', body: '{"detail":"size must be formatted as positive WIDTHxHEIGHT"}' }
    await expect(fixture.entry().render(request(null))).rejects.toThrow(`${route} 400: size must be formatted as positive WIDTHxHEIGHT`)
    const list = '{"detail":[{"type":"missing","loc":["body","prompt"],"msg":"Field required","input":{"size":"512x512"}}]}'
    server.generation = { status: 422, type: 'application/json', body: list }
    await expect(fixture.entry().render(request(null))).rejects.toThrow(`${route} 422: ${list}`)
    for (const body of ['Internal Server Error', 'null']) {
      server.generation = { status: 500, type: 'application/json', body }
      await expect(fixture.entry().render(request(null))).rejects.toThrow(`${route} 500: ${body}`)
    }
    const reason = new Error('stopped by the user')
    await expect(fixture.entry().render(request(null), AbortSignal.abort(reason))).rejects.toBe(reason)
    const closed = await start(await closedUrl())
    await expect(closed.entry().render(request(null), new AbortController().signal))
      .rejects.toThrow(/^The server at http:\/\/127\.0\.0\.1:\d+ cannot be reached\.$/)
  })
})

/** The width and the height in the IHDR chunk of PNG bytes. */
function pngSize(bytes: Uint8Array): string {
  const view = Buffer.from(bytes)
  return `${String(view.readUInt32BE(16))}x${String(view.readUInt32BE(20))}`
}

describe.skipIf(REAL_SERVER === undefined)('dv-sglang-diffusion against a running server', () => {
  it('renders one PNG per seed and size, at the default size without one, and refuses an odd size', async () => {
    const fixture = await start(String(REAL_SERVER))
    const args = { ...KEY, reason: 'lantern', prompt: 'a red paper lantern on a wooden table, soft morning light', size: '1024x768', seed: 1234 }
    const first = operationValue(await fixture.tool('dv_image_generate', args))
    const second = operationValue(await fixture.tool('dv_image_generate', args))
    expect(second.outputs[0]?.asset_id).toBe(first.outputs[0]?.asset_id)
    const asset = brandString<AssetId>(String(first.outputs[0]?.asset_id))
    const bytes = fixture.ctx.dvAssetPool.read(asset)
    expect(Buffer.from(bytes).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(pngSize(bytes)).toBe('1024x768')
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'image/png', width: 1024, height: 768 })
    const square = operationValue(await fixture.tool('dv_image_generate', { ...KEY, reason: 'square', prompt: args.prompt, seed: 1234 }))
    expect(square.report).toMatchObject({ size: '1024x1024' })
    expect(pngSize(fixture.ctx.dvAssetPool.read(brandString<AssetId>(String(square.outputs[0]?.asset_id))))).toBe('1024x1024')
    const before = fixture.records().length
    expect(failure(await fixture.tool('dv_image_generate', { ...args, size: '1000x1000' }))).toBe(
      'Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo cannot generate this: Width and height must each be a multiple of 32, '
      + `and 1000x1000 is not; the nearest sizes are 992x992 and 1024x1024. ${REFUSAL_END}`)
    expect(fixture.records()).toHaveLength(before)
  }, 300_000)

  it.skipIf(OTHER_REAL_SERVER === undefined)('refuses a model whose config points at a server of another model', async () => {
    const fixture = await start(String(OTHER_REAL_SERVER))
    expect(failure(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'x' }))).toBe(
      `Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo is unavailable: The server at ${String(OTHER_REAL_SERVER)} serves `
      + `fishaudio/drama-3, not Qwen/Qwen-Image-2.1-Turbo; the dv-sglang-diffusion config points this model at the wrong server. ${UNAVAILABLE_END}`)
    expect(fixture.records()).toEqual([])
  })
})
