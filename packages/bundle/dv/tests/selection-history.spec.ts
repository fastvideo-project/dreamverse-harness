/**
 * The video-model choice and the model load state through the REAL bundle composition: `models.select`,
 * `models.load` and `models.unload` stay out of the undo history. They keep the redo steps and the renders of those
 * steps, undo and redo never change the choice, and the choice survives a server restart.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { OperationToolValue, ProjectId } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { bootBundle, fasth3, type Bundle } from './bundle.ts'

const disposers: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

/**
 * Register the fake FastVideo models `pika` and `wan` with GPU lifecycle controls, and a tool-call helper of chat
 * `anonymous`.
 * @param bundle - a booted composition.
 * @returns the helpers.
 */
function controls(bundle: Bundle) {
  const { ctx } = bundle
  const runtime = {
    status: async () => ({ installed: true, loaded: false, loading: false, busy: false }), load: async () => {}, unload: async () => {},
  }
  for (const model of ['pika', 'wan']) {
    ctx.dvModels.register(Object.create(fasth3, { model: { value: model }, provider: { value: 'fastvideo' }, runtime: { value: runtime } }) as typeof fasth3)
  }
  let calls = 0
  // One model-visible tool call of chat `anonymous`.
  const call = async (name: string, args: Record<string, unknown>) => {
    calls += 1
    const result = await ctx.tools.execute({ callId: ToolCallId(`${name}-${String(calls)}`), name, arguments: args, signal: new AbortController().signal })
    if (result.isError) throw new Error(result.error.message)
    return { value: result.value, text: result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n') }
  }
  // The composer's video-model picker call (`packages/dv/ui-composer/src/client/prompt.ts`).
  const pick = (project: ProjectId, provider: string, model: string) => ctx.dvApi.api.runOperation({
    project, session: 'anonymous', surface: 'chat', operation: 'models.select', params: { provider, model },
  })
  const operations = (project: ProjectId) => ctx.dvProject.listHistory({ project }).map(({ record }) => record.operation)
  return { call, pick, operations }
}

/**
 * Boot the bundle with a chat-bound project.
 * @returns the composition, the project and the helpers.
 */
async function setup() {
  const bundle = await bootBundle()
  disposers.push(bundle.dispose)
  const helpers = controls(bundle)
  bundle.services.chats.open('anonymous', await bundle.ctx.dvProject.newProjectFolder('models'))
  const created = await helpers.call('dv_proj_create', { title: 'models' })
  return { ...bundle, ...helpers, project: (created.value as { project_id: ProjectId }).project_id }
}

describe('model controls outside the undo history', () => {
  it('keeps the redo step and its running render when the user picks a video model after an undo', async () => {
    const { ctx, dir, project, call, pick, operations } = await setup()
    // A render that runs until its signal aborts, so it still runs when a write could discard its step.
    ctx.dvModels.register(Object.create(fasth3, {
      model: { value: 'slow' }, provider: { value: 'fastvideo' },
      render: { value: (_request: unknown, signal?: AbortSignal) => (async function* () {
        await new Promise((_resolve, reject) => { signal?.addEventListener('abort', () => { reject(new Error(String(signal.reason))) }, { once: true }) })
      })() },
    }) as typeof fasth3)
    writeFileSync(join(dir, 'ref.png'), 'PNG-FAKE')
    const imported = await call('dv_asset_import', { reason: 'reference', path: join(dir, 'ref.png'), mime: 'image/png' })
    const reference = (imported.value as OperationToolValue).outputs.map(output => output.asset_id)
    await call('dv_textnode_write', { path: 'beats.md', body: '# Beats', base_version: 0, reason: 'content step' })
    const stop = new AbortController()
    const rendering = ctx.tools.execute({ callId: ToolCallId('render'), name: 'dv_shot_render', signal: stop.signal, arguments: {
      modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'slow', prompt: 'A lake', duration_sec: 1, reason: 'slow render', inputs: { reference },
    } })
    await expect.poll(() => ctx.dvProject.listRecords(project).find(record => record.operation === 'shot.render')?.status).toBe('running')
    await ctx.dvProject.undo(project)
    const before = ctx.dvProject.line(project)

    await pick(project, 'fastvideo', 'pika')
    expect(ctx.dvProject.line(project)).toEqual(before)
    expect(ctx.dvProject.listRecords(project).find(record => record.operation === 'shot.render')?.status).toBe('running')
    expect(operations(project)).not.toContain('models.select')
    await ctx.dvProject.redo(project)
    expect(ctx.dvProject.getState(project).components.models).toEqual({ conversations: { anonymous: { provider: 'fastvideo', model: 'pika' } } })
    stop.abort()
    await rendering
  })

  it('keeps the video model choice across undo and redo', async () => {
    const { ctx, project, call } = await setup()
    await call('dv_models_select', { provider: 'fastvideo', model: 'pika', reason: 'A' })
    await call('dv_textnode_write', { path: 'beats.md', body: '# Beats', base_version: 0, reason: 'content step' })
    await call('dv_models_select', { provider: 'fastvideo', model: 'wan', reason: 'B' })

    const undone = await call('dv_proj_undo', {})
    expect(JSON.parse(undone.text)).toMatchObject({ video_model: { provider: 'fastvideo', model: 'wan' } })
    // The undo took back the text write, the newest content step.
    expect(ctx.dvProject.listHistory({ project }).map(({ record, place }) => `${place} ${String(record.operation)}`))
      .toEqual(['after textnode.write', 'current proj.create'])
    const redone = await call('dv_proj_redo', {})
    expect(JSON.parse(redone.text)).toMatchObject({ video_model: { provider: 'fastvideo', model: 'wan' } })
    expect(ctx.dvProject.getState(project).components.models).toEqual({ conversations: { anonymous: { provider: 'fastvideo', model: 'wan' } } })
  })

  it('keeps the redo step when the agent loads or unloads a model after an undo', async () => {
    const { ctx, project, call, operations } = await setup()
    await call('dv_textnode_write', { path: 'beats.md', body: '# Beats', base_version: 0, reason: 'content step' })
    await ctx.dvProject.undo(project)
    const key = { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'pika' }
    await call('dv_models_load', { ...key, reason: 'preload' })
    await call('dv_models_unload', { ...key, reason: 'release' })

    expect(operations(project)).toEqual(['textnode.write', 'proj.create'])
    await ctx.dvProject.redo(project)
    expect(ctx.dvProject.line(project).at).toBe(ctx.dvProject.listHistory({ project })[0]?.record.id)
  })

  it('keeps the video model choice across a server restart', async () => {
    const first = await setup()
    await first.pick(first.project, 'fastvideo', 'wan')
    await first.stop()
    // The second composition's teardown removes the shared directory.
    disposers.splice(disposers.indexOf(first.dispose), 1)

    const second = await bootBundle({}, first)
    disposers.push(second.dispose)
    const { call } = controls(second)
    expect(second.ctx.dvProject.getState(first.project).components.models).toEqual({ conversations: { anonymous: { provider: 'fastvideo', model: 'wan' } } })
    expect(JSON.parse((await call('dv_proj_state', {})).text)).toMatchObject({ video_model: { provider: 'fastvideo', model: 'wan' } })
  })
})
