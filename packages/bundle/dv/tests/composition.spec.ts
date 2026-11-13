/**
 * The REAL composition of the bundle: the component rows, the model catalog and video provider rows, the
 * `dv-chat-references` row and the `dv-api` row of `cordis.patch.yml`, with their `!!js` configuration and `disabled`
 * flags, boot through the Loader beside the DSH system prompt and tool registry, with the video provider rows replaced
 * by fakes, and a model-visible tool call becomes a durable record.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Config as FastVideoConfig } from '@dv/fastvideo'
import { deriveModelFacts } from '@dv/fastvideo-generation-client'
import type { AssetId, OperationToolValue, ProjectId, RecordId } from '@dv/project'
import { formatModelKey } from '@dv/models'
import { afterEach, describe, expect, it } from 'vitest'
import { bootBundle, bundleRows, fasth3, fastVideo, insertRows, renderer, uniserve } from './bundle.ts'

const disposers: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  renderer.requests.splice(0)
})

describe('DreamVerse bundle composition', () => {
  it('carries an explicit worker through tool admission and execution and refuses unsupported placement', async () => {
    const { ctx, services, dispose } = await bootBundle()
    disposers.push(dispose)
    const targets: unknown[] = []
    ctx.dvModels.register(Object.create(fasth3, {
      model: { value: 'targeted' }, workerRouting: { value: true },
      facts: { value: (target: unknown) => { targets.push(target); return fasth3.facts() } },
      validateGenerationRequest: { value: async (_request: unknown, target: unknown) => { targets.push(target); return [] } },
      render: { value: (request: Parameters<typeof fasth3.render>[0], signal: AbortSignal, target: unknown) => {
        targets.push(target)
        return fasth3.render(request, signal)
      } },
    }) as typeof fasth3)
    services.chats.open('anonymous', await ctx.dvProject.newProjectFolder('worker-target'))
    const call = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(name), name, arguments: args, signal: AbortSignal.timeout(10000),
    })
    await call('dv_proj_create', { title: 'worker-target' })
    const params = { modality: 'video', task: 'ref2v', provider: 'uniserve', model: 'targeted', worker: 'gpu-2',
      prompt: 'A lake', duration_sec: 1, reason: 'Render on the selected worker' }
    const result = await call('dv_shot_render', params)
    expect(result.isError).toBeFalsy()
    expect((result.value as OperationToolValue).params).toMatchObject({ worker: 'gpu-2' })
    expect(targets.length).toBeGreaterThanOrEqual(3)
    expect(targets.every(target => JSON.stringify(target) === JSON.stringify({ worker: 'gpu-2' }))).toBe(true)
    const unsupported = await call('dv_shot_render', { ...params, model: 'fasth3' })
    expect(unsupported.isError && unsupported.error.message).toContain('does not support explicit worker placement')
  })

  it('allows parallel tool batches only for a provider that reserves independent workers', async () => {
    const { ctx, dispose } = await bootBundle()
    disposers.push(dispose)
    ctx.dvModels.register(Object.create(fasth3, { model: { value: 'parallel' }, concurrentRenders: { value: true } }) as typeof fasth3)
    const tool = ctx.tools.get('dv_shot_render')!
    const args = { modality: 'video', task: 'ref2v', provider: 'uniserve', model: 'parallel',
      prompt: 'A lake', duration_sec: 1, reason: 'Render an independent shot' }
    expect(tool.isConcurrencySafe?.(args)).toBe(true)
    expect(tool.isConcurrencySafe?.({ ...args, model: 'fasth3' })).toBe(false)
    expect(ctx.tools.get('dv_models_unload')?.isConcurrencySafe?.(args) ?? false).toBe(false)
  })

  it('persists a conversation choice per modality, exposes lifecycle tools, and prevents a different agent generation', async () => {
    const { ctx, services, dispose } = await bootBundle()
    disposers.push(dispose)
    let loaded = false
    const lifecycleTargets: unknown[] = []
    const runtime = { status: async (_signal?: AbortSignal, target?: { worker: string }) => {
      lifecycleTargets.push(target)
      return { installed: true, loaded, loading: false, busy: false }
    },
    load: async () => { loaded = true }, unload: async () => { loaded = false } }
    ctx.dvModels.register(Object.create(fasth3, { model: { value: 'pika' }, provider: { value: 'fastvideo' }, runtime: { value: runtime }, workerRouting: { value: true } }) as typeof fasth3)
    const image = (model: string) => ({ modality: 'image', task: 't2i', provider: 'openrouter', model, description: model,
      facts: async () => ({ modelId: model }), schema: async () => ({}), validateGenerationRequest: async () => [],
      render: async () => { throw new Error('not rendered in this test') } }) as Parameters<typeof ctx.dvModels.register>[0]
    ctx.dvModels.register(image('flux'))
    ctx.dvModels.register(image('seedream'))
    services.chats.open('anonymous', await ctx.dvProject.newProjectFolder('model-controls'))
    const call = async (name: string, args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(name), name, arguments: args, signal: new AbortController().signal,
    })
    const created = await call('dv_proj_create', { title: 'model-controls' })
    if (created.isError) throw new Error(created.error.message)
    const project = (created.value as { project_id: ProjectId }).project_id
    const select = await call('dv_models_select', { modality: 'video', provider: 'fastvideo', model: 'pika', reason: 'Use Pika in this chat' })
    expect(select.isError).toBeFalsy()
    expect(ctx.dvProject.getState(project).components.models).toEqual({ conversations: { anonymous: { video: { provider: 'fastvideo', model: 'pika' } } } })
    expect((await call('dv_models_select', { modality: 'image', provider: 'openrouter', model: 'flux', reason: 'Use FLUX' })).isError).toBeFalsy()
    expect(ctx.dvProject.getState(project).components.models).toEqual({ conversations: { anonymous: {
      video: { provider: 'fastvideo', model: 'pika' }, image: { provider: 'openrouter', model: 'flux' } } } })
    const wrongImage = await call('dv_image_generate', { modality: 'image', task: 't2i', provider: 'openrouter', model: 'seedream',
      prompt: 'A lake', reason: 'Image' })
    expect(wrongImage.isError && wrongImage.error.message).toContain("This conversation's image model is openrouter/flux")
    const missing = await call('dv_models_select', { modality: 'image', provider: 'openrouter', model: 'pika', reason: 'Wrong modality' })
    expect(missing.isError && missing.error.message).toContain('image model openrouter/pika is not configured.')
    const wrong = await call('dv_shot_render', { modality: 'video', task: 'ref2v', provider: 'uniserve', model: 'fasth3',
      prompt: 'A lake', duration_sec: 1, reason: 'Render' })
    expect(wrong.isError && wrong.error.message).toContain("This conversation's video model is fastvideo/pika")
    const key = { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'pika', reason: 'Preload for next shot' }
    expect((await call('dv_models_load', { ...key, worker: 'gpu-2' })).isError).toBeFalsy()
    expect(lifecycleTargets.at(-1)).toEqual({ worker: 'gpu-2' })
    expect(loaded).toBe(true)
    expect((await call('dv_models_unload', key)).isError).toBeFalsy()
    expect(loaded).toBe(false)
    expect((await call('dv_models_select', { modality: 'video', provider: '', model: '', reason: 'Let the operator choose' })).isError).toBeFalsy()
    expect(ctx.dvProject.getState(project).components.models).toEqual({ conversations: { anonymous: { image: { provider: 'openrouter', model: 'flux' } } } })
    const definitions = ctx.tools.schemas().filter(tool => ['dv_models_select', 'dv_models_load', 'dv_models_unload', 'dv_models_status'].includes(tool.name))
    await expect(`${JSON.stringify(definitions, null, 2)}\n`).toMatchFileSnapshot('./expected/tools/model-controls.json')
  })
  it('mounts the reference nouns in the order character, location, style, on the host and in the browser', () => {
    const ids = insertRows().map(row => row.id)
    const nouns = ids.filter(id => /^dv-(ui-)?(character|location|style)$/.test(id))
    expect(nouns).toEqual(['dv-character', 'dv-location', 'dv-style', 'dv-ui-character', 'dv-ui-location', 'dv-ui-style'])
  })

  it('pins the definitions of the text node tools that the agent sees', async () => {
    const { ctx, dispose } = await bootBundle()
    disposers.push(dispose)
    const tools = ctx.tools.schemas().filter(tool => tool.name.startsWith('dv_textnode_'))
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot('./expected/tools/text-node.json')
  })

  it('boots the bundle rows through the Loader and turns a model tool call into a durable record', async () => {
    const rows = bundleRows()
    expect(rows.map(row => row.id)).toEqual(expect.arrayContaining([
      'dv-openrouter', 'dv-models', 'dv-fastvideo', 'dv-uniserve', 'dv-project', 'dv-text-node', 'dv-shot-render', 'dv-timeline', 'dv-workflow-story', 'dv-chat-references', 'dv-api',
      'dv-sglang-diffusion', 'dv-image-generate', 'dv-sglang-omni', 'dv-audio-generate',
    ]))
    const { ctx, dir, services, dispose } = await bootBundle()
    disposers.push(dispose)

    expect(ctx.get('dvChatReferences')).toBeDefined()
    expect(ctx.get('dvApi')).toBeDefined()
    expect(ctx.get('dvProject')?.listOperations().map(spec => spec.name))
      .toEqual(expect.arrayContaining([
        'shot.render', 'timeline.create', 'timeline.update', 'image.generate', 'audio.generate',
      ]))
    expect(ctx.get('tools')?.get('dv_shot_render')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_audio_generate')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_models_list')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_models_get')).toBeDefined()
    expect(ctx.get('tools')?.get('dv_image_generate')).toBeDefined()
    // The FastVideo row is disabled and keeps one server per task of fasth3, with valid model facts, for a deployment
    // that mounts it.
    expect(fastVideo.mounted).toBe(false)
    const fastVideoRow = rows.find(row => row.id === 'dv-fastvideo')
    expect(fastVideoRow).toMatchObject({
      disabled: true,
      config: { models: { fasth3: {
        ref2v: { baseUrl: 'http://127.0.0.1:8029', modelFacts: { modelId: 'fasth3', maxReferences: 12 } },
        t2v: { baseUrl: 'http://127.0.0.1:8031', modelFacts: { modelId: 'fasth3', maxReferences: 0 } },
      } } },
    })
    const fastVideoTasks = Object.values(FastVideoConfig(fastVideoRow?.config as Parameters<typeof FastVideoConfig>[0]).models['fasth3'] ?? {})
    expect(fastVideoTasks.map(task => deriveModelFacts(task.modelFacts))).toMatchObject([
      { aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['768p'], minDurationSec: 5, maxDurationSec: 15 },
      { aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['768p'], minDurationSec: 5, maxDurationSec: 15 },
    ])
    // The UniServe row names the server of fasth3 for task ref2v.
    expect(uniserve.config).toEqual({ baseUrl: 'http://10.244.8.35:8000' })
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
    // A tool call without an agent runs as chat `anonymous`, which makes its folder the project.
    services.chats.open('anonymous', await ctx.dvProject.newProjectFolder('composed'))
    const created = await call('dv_proj_create', { title: 'composed' })
    const projectId = (created.value as { project_id: ProjectId }).project_id
    writeFileSync(join(dir, 'ref.png'), 'PNG-FAKE')
    const imported = await call('dv_asset_import', { reason: 'reference', path: join(dir, 'ref.png'), mime: 'image/png' })
    const reference = (imported.value as OperationToolValue).outputs.map(output => output.asset_id)
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
    // The bundle's `!!js` configuration put the project folder in the DreamVerse folder the test set.
    expect(readFileSync(join(dir, 'projects', 'composed', '.dreamverse', 'records.jsonl'), 'utf8')).toContain('"shot.render"')
    expect(ctx.dvAssetPool.path(video as AssetId)).toBe(join(realpathSync(dir), 'projects', 'composed', '.dreamverse', 'assets', 'objects', video as string))
  })
})
