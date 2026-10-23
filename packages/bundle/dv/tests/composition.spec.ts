/**
 * The REAL composition of the bundle: the component rows, the model catalog and video provider rows, the
 * `dv-chat-references` row and the `dv-api` row of `cordis.patch.yml`, with their `!!js` configuration and `disabled`
 * flags, boot through the Loader beside the DSH system prompt and tool registry, with the video provider rows replaced
 * by fakes, and a model-visible tool call becomes a durable record.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { OperationToolValue, ProjectId, RecordId } from '@dv/project'
import { formatModelKey } from '@dv/models'
import { afterEach, describe, expect, it } from 'vitest'
import { bootBundle, bundleRows, fastVideo, insertRows, renderer, uniserve } from './bundle.ts'

const disposers: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

describe('DreamVerse bundle composition', () => {
  it('mounts the reference nouns in the order character, location, style, on the host and in the browser', () => {
    const ids = insertRows().map(row => row.id)
    const nouns = ids.filter(id => /^dv-(ui-)?(character|location|style)$/.test(id))
    expect(nouns).toEqual(['dv-character', 'dv-location', 'dv-style', 'dv-ui-character', 'dv-ui-location', 'dv-ui-style'])
    expect(ids.indexOf('dv-ui-style')).toBe(ids.indexOf('dv-ui-shot-plan') - 1)
  })

  it('boots the bundle rows through the Loader and turns a model tool call into a durable record', async () => {
    const rows = bundleRows()
    expect(rows.map(row => row.id)).toEqual(expect.arrayContaining([
      'dv-models', 'dv-fastvideo', 'dv-uniserve', 'dv-project', 'dv-shot-plan', 'dv-shot-render', 'dv-timeline', 'dv-workflow-story', 'dv-chat-references', 'dv-api',
      'dv-sglang-diffusion', 'dv-image-generate', 'dv-sglang-omni', 'dv-audio-generate',
    ]))
    const { ctx, dir, dispose } = await bootBundle()
    disposers.push(dispose)

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
    expect(fastVideo.mounted).toBe(false)
    expect(rows.find(row => row.id === 'dv-fastvideo')).toMatchObject({
      disabled: true,
      config: { models: { fasth3: {
        ref2v: { baseUrl: 'http://10.244.19.118:8029' },
        t2v: { baseUrl: 'http://10.244.16.130:8031' },
      } } },
    })
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
