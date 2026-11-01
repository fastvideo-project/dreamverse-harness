/**
 * The Image component in a REAL composition booted through the Loader from a test-only `cordis.yml`; the image model and
 * the attachment service are the only fakes.
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
import DvImageGenerate, { type GeneratedImage, type ImageModelFacts, type ImageRequest } from '../src/index.ts'

const KEY = { modality: 'image', task: 't2i', provider: 'test', model: 'fake' }

const REFUSAL_END = 'Nothing was generated; change the inputs or params, then call again.'

const PNG = Buffer.from('PNG-FAKE')

class FakeImageModel {
  readonly requests: ImageRequest[] = []
  facts: () => Promise<ImageModelFacts> = () => Promise.resolve({ modelId: 'fake-image-1' })
  problems: (request: ImageRequest) => string[] = () => []
  failure: Error | null = null

  entry(): ModelEntry<'t2i'> {
    return {
      modality: 'image', task: 't2i', provider: 'test', model: 'fake', description: 'Fake images',
      facts: () => this.facts(),
      schema: () => Promise.resolve({}),
      validateGenerationRequest: request => Promise.resolve(this.problems(request)),
      render: request => this.render(request),
    }
  }

  private render(request: ImageRequest): Promise<GeneratedImage> {
    this.requests.push(request)
    if (this.failure !== null) return Promise.reject(this.failure)
    const { width, height } = request.size ?? { width: 1024, height: 1024 }
    return Promise.resolve({ bytes: PNG, mime: 'image/png', width, height })
  }
}

class FakeAttachments {
  readonly saved: Array<{ mediaType: string; name?: string }> = []

  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }) {
    this.saved.push(input)
    return Promise.resolve({ attachmentId: `att-${String(this.saved.length)}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1 })
  }
}

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvModels, DvImageGenerate }

interface Fixture {
  ctx: Context
  model: FakeImageModel
  attachments: FakeAttachments
  project: ProjectId
  tool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  spec(): OperationSpec | undefined
  history(): number
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`, with the fake model registered unless `serve` is false.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(serve = true): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-image-generate-'))
  const globals = globalThis as typeof globalThis & { __dvImageGenerate?: typeof PLUGINS }
  globals.__dvImageGenerate = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[] = []): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvImageGenerate.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt')
  row('tools', 'ToolRuntime')
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [])
  row('dv-models', 'DvModels')
  row('dv-image-generate', 'DvImageGenerate')
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  const services = provideChatServices(ctx)
  const attachments = new FakeAttachments()
  ctx.provide('attachments', attachments)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const model = new FakeImageModel()
  if (serve) ctx.effect(() => ctx.dvModels.register(model.entry()))
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null, intent: 'create' }
  const project = await chatProject(ctx.dvProject, services, 'posters', origin)
  let calls = 0
  return {
    ctx, model, attachments, project,
    tool(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    spec: () => ctx.dvProject.listOperations().find(spec => spec.name === 'image.generate'),
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

describe('dvImageGenerate', () => {
  it('registers image.generate and its tool while the catalog holds a t2i model, and removes them on disposal', async () => {
    const fixture = await start(false)
    const { ctx } = fixture
    expect(ctx.dvModels.taskLabels()).toEqual({ t2i: { zh: '文字生成图片', en: 'Image from text' } })
    expect(fixture.spec()).toBeUndefined()
    const remove = ctx.dvModels.register(fixture.model.entry())
    expect(fixture.spec()).toMatchObject({
      component: 'image', label: { zh: '生成图片', en: 'Generate image' }, outputs: [{ role: 'image', type: 'image' }], inputs: {},
      deterministic: false, resource: 'gpu',
    })
    const tool = ctx.tools.schemas().find(schema => schema.name === 'dv_image_generate')
    expect(tool?.description).toBe('Generate one image from the prompt with a t2i model from dv_models_list; modality, task, provider '
      + 'and model name it and are required. dv_models_get lists the sizes the model takes and its own parameters for extra. '
      + 'The image is the one output, and you see it in the result. Every call is a new take; a changed prompt for the same '
      + 'image passes based_on. Uses the GPU.')
    const params = fixture.spec()?.params ?? {}
    expect(Object.keys(params)).toEqual(['modality', 'task', 'provider', 'model', 'prompt', 'size', 'seed', 'extra'])
    expect(params['size']).toEqual({
      type: 'string',
      description: 'The image size as WIDTHxHEIGHT in pixels, such as 1024x768. It must meet the size rule that dv_models_get '
        + 'gives; every size it lists by aspect ratio meets it. Omitted, the model\'s default size.',
    })
    remove()
    expect(fixture.spec()).toBeUndefined()
    ctx.dvModels.register(fixture.model.entry())
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-image-generate.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.spec()).toBeUndefined()
    expect(ctx.tools.get('dv_image_generate')).toBeUndefined()
    expect(ctx.dvModels.taskLabels()).toEqual({})
  })

  it('generates one image per agent call in the background, and records it with its size and seed', async () => {
    const fixture = await start()
    const { ctx } = fixture
    const args = { ...KEY, reason: 'poster', prompt: 'A tea shop poster that reads "Moon Garden Tea"', size: '768x1024', seed: 7 }
    const result = value(await fixture.tool('dv_image_generate', args))
    // An agent call of a GPU operation runs in the background; its record notice shows the image to the agent.
    expect(result).toMatchObject({ status: 'pending', outputs: [] })
    await ctx.dvProject.wait(fixture.project)
    expect(fixture.model.requests).toEqual([{ prompt: 'A tea shop poster that reads "Moon Garden Tea"', size: { width: 768, height: 1024 }, seed: 7, extra: {} }])
    const record = ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(result.record))
    expect(record).toMatchObject({
      actor: 'agent', component: 'image', operation: 'image.generate', status: 'done', intent: 'poster',
      report: { seed: 7, model_id: 'fake-image-1', size: '768x1024' },
    })
    const assetId = record.outputs[0] ?? brandString<AssetId>('none')
    expect(ctx.dvAssetPool.get(assetId)).toMatchObject({
      mime: 'image/png', width: 768, height: 1024, name: `${record.id.slice(0, 8)}.png`, created_by: record.id,
    })
    expect(ctx.dvAssetPool.read(assetId)).toEqual(PNG)
    expect(fixture.spec()?.summarize(record)).toBe('image "A tea shop poster that reads \\"Moon Garden Tea\\"" (768x1024, seed 7)')
  })

  it('trims the prompt, leaves the size to the model when the call names none, and draws a seed', async () => {
    const fixture = await start()
    const result = value(await fixture.tool('dv_image_generate', { ...KEY, reason: 'square', prompt: ' a lantern\n' }))
    await fixture.ctx.dvProject.wait(fixture.project)
    const [request] = fixture.model.requests
    expect(request).toMatchObject({ prompt: 'a lantern', size: null, extra: {} })
    expect(Number.isInteger(request?.seed)).toBe(true)
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(result.record))
    expect(record.report).toEqual({ seed: request?.seed, model_id: 'fake-image-1', size: '1024x1024' })
    expect(fixture.spec()?.summarize(record)).toBe(`image "a lantern" (1024x1024, seed ${String(request?.seed)})`)
  })

  it('refuses an empty prompt, a malformed size and a request the model refuses, before any record', async () => {
    const fixture = await start()
    const before = fixture.history()
    const call = (args: Record<string, unknown>) => fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'a cat', ...args })
    expect(failure(await call({ prompt: '   ' }))).toBe(`The prompt is empty; describe the image to generate. ${REFUSAL_END}`)
    expect(failure(await call({ size: '1024' })))
      .toBe(`size must be WIDTHxHEIGHT in pixels with positive integers, such as 1024x768; got "1024". ${REFUSAL_END}`)
    expect(failure(await call({ size: '0x512' })))
      .toBe(`size must be WIDTHxHEIGHT in pixels with positive integers, such as 1024x768; got "0x512". ${REFUSAL_END}`)
    fixture.model.problems = request => request.size === null ? [] : ['Width and height must each be a multiple of 32.']
    expect(failure(await call({ size: '1000x1000' })))
      .toBe(`Model image/t2i/test/fake cannot generate this: Width and height must each be a multiple of 32. ${REFUSAL_END}`)
    const state = fixture.ctx.dvProject.getState(fixture.project)
    const check = (params: Record<string, unknown>) =>
      fixture.ctx.dvImageGenerate.check({ project: fixture.project, params: { ...KEY, ...params }, inputs: [] }, state)
    expect(await check({})).toEqual(['The prompt is empty; describe the image to generate.'])
    expect(await check({ prompt: 'a cat', size: 1024 }))
      .toEqual(['size must be WIDTHxHEIGHT in pixels with positive integers, such as 1024x768; got 1024.'])
    expect(fixture.history()).toBe(before)
    expect(fixture.model.requests).toEqual([])
  })

  it('names an unavailable model, and fails the record of a render that fails', async () => {
    const fixture = await start()
    fixture.model.facts = () => Promise.reject(new Error('The server at http://127.0.0.1:1 cannot be reached.'))
    expect(failure(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'a cat' }))).toBe(
      'Model image/t2i/test/fake is unavailable: The server at http://127.0.0.1:1 cannot be reached. '
      + 'Nothing was generated; no change to the call helps while the model is unavailable.')
    fixture.model.facts = () => Promise.resolve({ modelId: 'fake-image-1' })
    fixture.model.failure = new Error('The server at http://127.0.0.1:1 answered POST /v1/images/generations with HTTP 500: busy')
    expect(value(await fixture.tool('dv_image_generate', { ...KEY, reason: 'try', prompt: 'a cat' })).status).toBe('pending')
    await fixture.ctx.dvProject.wait(fixture.project)
    expect(fixture.ctx.dvProject.getState(fixture.project).components.proj.records.at(-1)).toMatchObject({
      operation: 'image.generate', status: 'failed',
      error: { message: 'The server at http://127.0.0.1:1 answered POST /v1/images/generations with HTTP 500: busy' },
    })
  })
})
