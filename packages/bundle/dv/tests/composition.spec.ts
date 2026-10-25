/**
 * The REAL composition of the bundle: the component rows, the model catalog and video provider rows, the
 * `dv-chat-references` row and the `dv-api` row of `cordis.patch.yml`, with their `!!js` configuration and `disabled`
 * flags, boot through the Loader beside the DSH system prompt and tool registry, with the video provider rows replaced
 * by fakes, and a model-visible tool call becomes a durable record.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvAudioGenerate from '@dv/audio-generate'
import DvCharacter from '@dv/character'
import DvFfmpeg from '@dv/ffmpeg'
import DvInspector from '@dv/inspector'
import DvLocation from '@dv/location'
import DvProject, { type OperationToolValue, type ProjectId, type RecordId } from '@dv/project'
import DvShotPlan from '@dv/shot-plan'
import DvShotRender from '@dv/shot-render'
import DvStyle from '@dv/style'
import DvTimeline from '@dv/timeline'
import DvApi from '@dv/api'
import DvChatReferences from '@dv/chat-references'
import DvModels, { formatModelKey, type ModelEntry } from '@dv/models'
import DvImageGenerate from '@dv/image-generate'
import * as SglangDiffusion from '@dv/sglang-diffusion'
import * as SglangOmni from '@dv/sglang-omni'
import DvStory from '@dv/workflow-story'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeModel, FFMPEG, FFPROBE } from '../../../dv/api/tests/support.ts'

const disposers: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

/** Whether the stand-in FastVideo plugin was mounted. */
let fastVideoMounted = false

/** A stand-in for `@dv/fastvideo`: it records that it was mounted. */
const FakeFastVideo = {
  name: 'fake-fastvideo',
  apply(): void {
    fastVideoMounted = true
  },
}

/** The config the stand-in UniServe plugin received from the bundle row. */
let uniserveConfig: unknown = null

/** The renderer of the fake model; its `requests` lists the render requests of the fake model. */
const renderer = new FakeModel()

/** The fake model `fasth3` for task `ref2v` of provider `uniserve`, which renders through `renderer`. */
const fasth3: ModelEntry<'ref2v'> = Object.create(renderer, { provider: { value: 'uniserve' } }) as ModelEntry<'ref2v'>

/** A stand-in for `@dv/uniserve`: it keeps the row's config and registers the fake model `fasth3` for task `ref2v`. */
const FakeUniserve = {
  name: 'fake-uniserve',
  inject: ['dvModels'],
  apply(ctx: Context, config: unknown): void {
    uniserveConfig = config
    ctx.effect(() => ctx.dvModels.register(fasth3))
  },
}

/**
 * The plugin of each package a bundle row names, resolved through `globalThis` because Node imports the rows outside
 * Vite. The disabled FastVideo row names a stand-in that records a mount, and the UniServe row a stand-in that keeps
 * its config and registers a fake model.
 */
const PLUGINS: Record<string, object> = {
  '@deepseek-ai/dsh-system-prompt': SystemPrompt, '@deepseek-ai/dsh-tools': ToolRuntime, '@dv/project': DvProject,
  '@dv/ffmpeg': DvFfmpeg, '@dv/asset-pool': DvAssetPool, '@dv/inspector': DvInspector,
  '@dv/character': DvCharacter, '@dv/location': DvLocation, '@dv/style': DvStyle,
  '@dv/shot-plan': DvShotPlan, '@dv/shot-render': DvShotRender, '@dv/timeline': DvTimeline,
  '@dv/api': DvApi, '@dv/chat-references': DvChatReferences,
  '@dv/models': DvModels, '@dv/fastvideo': FakeFastVideo, '@dv/uniserve': FakeUniserve, '@dv/workflow-story': DvStory,
  '@dv/sglang-diffusion': SglangDiffusion, '@dv/image-generate': DvImageGenerate,
  '@dv/sglang-omni': SglangOmni, '@dv/audio-generate': DvAudioGenerate,
}

/** One row of a Loader entry list. */
interface Row { id: string; name: string; config?: unknown; disabled?: unknown }

/**
 * The rows of the bundle patch that mount host plugins of DreamVerse, as the bundle writes them.
 * @returns the `dv-*` rows of the patch's first insert list, without the interface plugins.
 */
function bundleRows(): Row[] {
  return insertRows().filter(row => row.id.startsWith('dv-') && !row.id.startsWith('dv-ui-'))
}

/** @returns every row of the bundle patch's first insert list, in patch order. */
function insertRows(): Row[] {
  const patch = yaml.load(readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8'), { schema: entryListSchema })
  const [first] = patch as Array<{ insert?: Row[] }>
  return first?.insert ?? []
}

describe('DreamVerse bundle composition', () => {
  it('mounts the reference nouns in the order character, location, style, on the host and in the browser', () => {
    const ids = insertRows().map(row => row.id)
    const nouns = ids.filter(id => /^dv-(ui-)?(character|location|style)$/.test(id))
    expect(nouns).toEqual(['dv-character', 'dv-location', 'dv-style', 'dv-ui-character', 'dv-ui-location', 'dv-ui-style'])
    expect(ids.indexOf('dv-ui-style')).toBe(ids.indexOf('dv-ui-shot-plan') - 1)
  })

  it('boots the bundle rows through the Loader and turns a model tool call into a durable record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dv-composition-'))
    disposers.push(() => { rmSync(dir, { recursive: true, force: true }) })
    // The environment the bundle's `!!js` configuration reads.
    vi.stubEnv('DV_STATE_ROOT', dir)
    vi.stubEnv('DV_FFMPEG', FFMPEG)
    vi.stubEnv('DV_FFPROBE', FFPROBE)
    disposers.push(() => { vi.unstubAllEnvs() })
    const globals = globalThis as typeof globalThis & { __dvComposition?: Record<string, object> }
    globals.__dvComposition = PLUGINS
    disposers.push(() => { delete globals.__dvComposition })
    const rows = bundleRows()
    expect(rows.map(row => row.id)).toEqual(expect.arrayContaining([
      'dv-models', 'dv-fastvideo', 'dv-uniserve', 'dv-project', 'dv-shot-plan', 'dv-shot-render', 'dv-timeline', 'dv-workflow-story', 'dv-chat-references', 'dv-api',
      'dv-sglang-diffusion', 'dv-image-generate', 'dv-sglang-omni', 'dv-audio-generate',
    ]))
    // Each row keeps its id and `!!js` config; its package name points at a module that re-exports the plugin class.
    const entries = [
      { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' }, { id: 'tools', name: '@deepseek-ai/dsh-tools' }, ...rows,
    ].map((row) => {
      const plugin = PLUGINS[row.name]
      if (plugin === undefined) throw new Error(`No plugin for bundle row ${row.id} (${row.name}).`)
      const file = join(dir, `${row.id}.mjs`)
      writeFileSync(file, `export default globalThis.__dvComposition[${JSON.stringify(row.name)}]\n`)
      return { ...row, name: pathToFileURL(file).href }
    })
    writeFileSync(join(dir, 'cordis.yml'), yaml.dump(entries, { schema: entryListSchema }))

    const ctx = new Context()
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
    await ctx.loader.await()
    disposers.push(async () => { await ctx.fiber.dispose() })

    expect(ctx.get('dvChatReferences')).toBeDefined()
    expect(ctx.get('dvApi')).toBeDefined()
    expect(ctx.get('dvProject')?.listOperations().map(spec => spec.name))
      .toEqual(expect.arrayContaining([
        'plan.create', 'shot.render', 'timeline.create', 'timeline.update', 'image.generate', 'audio.generate',
      ]))
    expect(ctx.get('tools')?.get('dv_shot_render')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_audio_generate')).toBeDefined()
    // The story workflow approves plans: the agent sees its preview and approve tools and no plan tool that approves.
    expect(ctx.get('tools')?.get('dv_story_preview')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_story_approve')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_plan_approve')).toBeUndefined()
    expect(ctx.get('tools')?.get('dv_models_list')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_models_get')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_image_generate')).toBeDefined()
    // The FastVideo row is disabled and keeps one server per task of fasth3 for a deployment that mounts it.
    expect(fastVideoMounted).toBe(false)
    expect(rows.find(row => row.id === 'dv-fastvideo')).toMatchObject({
      disabled: true,
      config: { models: { fasth3: {
        ref2v: { baseUrl: 'http://10.244.19.118:8029' },
        t2v: { baseUrl: 'http://10.244.16.130:8031' },
      } } },
    })
    // The UniServe row names the server of fasth3 for task ref2v.
    expect(uniserveConfig).toEqual({ baseUrl: 'http://10.244.8.35:8000' })
    expect(rows.find(row => row.id === 'dv-sglang-diffusion')?.config).toEqual({
      models: { 'qwen-image-2.1-turbo': { baseUrl: 'http://127.0.0.1:30010' } },
    })
    expect(rows.find(row => row.id === 'dv-sglang-omni')?.config).toEqual({
      models: { 'fish-audio-drama-3': { baseUrl: 'http://127.0.0.1:8000' } },
    })
    expect(ctx.dvModels.list().map(entry => formatModelKey(entry))).toEqual([
      'video/ref2v/uniserve/fasth3', 'image/t2i/sglang-diffusion/qwen-image-2.1-turbo', 'audio/t2a/sglang-omni/fish-audio-drama-3',
    ])

    const signal = new AbortController().signal
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await ctx.tools.execute({ callId: ToolCallId(`${name}-1`), name, arguments: args, signal })
      if (result.isError) throw new Error(result.error.message)
      return result
    }
    const created = await call('dv_proj_create', { title: 'composed' })
    const projectId = (created.value as { project_id: ProjectId }).project_id
    writeFileSync(join(dir, 'ref.png'), 'PNG-FAKE')
    await call('dv_asset_import', { reason: 'reference', path: join(dir, 'ref.png'), mime: 'image/png' })
    const reference = ctx.dvAssetPool.list().map(asset => asset.id)
    await call('dv_character_create', { reason: 'lead', character: 'c1', name: 'Lead', inputs: { reference } })
    const shot = await call('dv_shot_render', {
      modality: 'video', task: 'ref2v', provider: 'uniserve', model: 'fasth3', reason: 'the opening shot', prompt: 'Picture 1 looks up', duration_sec: 1, inputs: { reference: 'c1@1' },
    })
    const shotValue = shot.value as OperationToolValue
    expect(shotValue.status).toBe('done')
    // Model-visible: the rendered text names the record and the asset URLs.
    const text = shot.content.find(block => block.type === 'text')
    expect(text?.type === 'text' ? text.text : '').toContain(`done ${shotValue.record}`)
    expect(text?.type === 'text' ? text.text : '').toContain('/dv/assets/')
    // Durable: the project's history holds the record with its outputs, and the asset pool holds the bytes.
    const record = ctx.dvProject.getRecord(projectId, shotValue.record as RecordId)
    expect(record).toMatchObject({ status: 'done', intent: 'the opening shot', operation: 'shot.render', actor: 'agent' })
    expect(record.outputs).toHaveLength(2)
    const [video] = record.outputs
    expect(video !== undefined && ctx.dvAssetPool.has(video)).toBe(true)
    expect(renderer.requests).toHaveLength(1)
    await call('dv_timeline_create', { reason: 'lay out the shot', assets: [video] })
    const clips = ctx.dvProject.getState(projectId).components.timeline.timelines[0]?.clips
    expect(clips?.map(clip => [clip.id, clip.asset])).toEqual([['cl1', video]])
    expect(Object.keys(ctx.dvProject.getState(projectId).components.proj.created_by)).toHaveLength(3)
    // The bundle's `!!js` configuration put the project records under the state root the test set.
    expect(readFileSync(join(dir, 'projects', projectId, 'records.jsonl'), 'utf8')).toContain('"shot.render"')
  })
})
