/**
 * The model catalog in a REAL composition: a test-only `cordis.yml` boots the DSH system prompt, the DSH tool registry,
 * the DSH skill registry, `dvModels`, and a test provider plugin through the Loader. The provider plugin's entries are
 * the only fakes.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import DvModels, { formatModelKey, modelKey, servesTask, type ModelEntry, type RenderModelFacts, type TaskId } from '../src/index.ts'

/** The facts every fake entry reports. */
const FACTS: RenderModelFacts = {
  modelId: 'backend-model', aspectRatios: ['16:9'], resolutions: ['720p'], frameSizes: { '16:9': { '720p': [1280, 720] } },
  minDurationSec: 4, maxDurationSec: 8, numFramesByDurationSec: { 4: 97 },
}

/** A fake entry of one model of one provider serving one video task; its schema names the task. */
function entry(task: TaskId, provider: string, model: string): ModelEntry {
  return {
    modality: 'video', task, provider, model, description: `${model} for ${task}`, gpuSecondsPerVideoSecond: 2,
    facts: () => Promise.resolve(FACTS),
    schema: () => Promise.resolve({ inputs: task === 'ref2v' ? { reference: { media_types: ['image'] } } : {}, extra: {} }),
    validateGenerationRequest: () => Promise.resolve([]),
    render: () => { throw new Error('not rendered in this test') },
  }
}

/** The prompt skill of the fake model `gamma` for task t2v. */
const GAMMA_SKILL = { name: 'gamma-prompting', description: 'Prompt rules for model gamma for task t2v.', content: '# Gamma' }

/** The test provider plugin: registers `alpha` of provider `test` for t2v and ref2v, and `beta` of provider `other` for t2v. */
const Provider = {
  name: 'test-provider',
  inject: ['dvModels'],
  apply(ctx: Context): void {
    ctx.effect(() => ctx.dvModels.register(entry('t2v', 'test', 'alpha')))
    ctx.effect(() => ctx.dvModels.register(entry('ref2v', 'test', 'alpha')))
    ctx.effect(() => ctx.dvModels.register(entry('t2v', 'other', 'beta')))
  },
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, SkillRegistry, DvModels, Provider }

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Boot the system prompt, the tool registry, the skill registry, the catalog and the test provider plugin from a
 * test-only `cordis.yml`.
 * @returns the root context.
 */
async function start(): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-models-'))
  const globals = globalThis as typeof globalThis & { __dvModels?: typeof PLUGINS }
  globals.__dvModels = PLUGINS
  const rows: string[] = []
  const plugins = [
    ['system-prompt', 'SystemPrompt'], ['tools', 'ToolRuntime'], ['skills', 'SkillRegistry'], ['dv-models', 'DvModels'],
    ['test-provider', 'Provider'],
  ] as const
  for (const [id, key] of plugins) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvModels.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`)
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return ctx
}

/** Dispose the fiber of one fixture row, such as `test-provider`. */
async function unload(ctx: Context, id: string): Promise<void> {
  const row = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith(`/${id}.mjs`))
  await row?.fiber?.dispose()
}

/** Call one tool through the tool registry. */
function call(ctx: Context, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    callId: ToolCallId('call-1'), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never,
  })
}

describe('dvModels', () => {
  it('keys entries by modality, task, provider and model, and lists the entries that match a filter', async () => {
    const ctx = await start()
    expect(ctx.dvModels.list().map(formatModelKey)).toEqual(['video/t2v/test/alpha', 'video/ref2v/test/alpha', 'video/t2v/other/beta'])
    expect(ctx.dvModels.list({ task: 't2v' }).map(formatModelKey)).toEqual(['video/t2v/test/alpha', 'video/t2v/other/beta'])
    expect(ctx.dvModels.list({ task: 't2v', provider: 'other' }).map(formatModelKey)).toEqual(['video/t2v/other/beta'])
    expect(ctx.dvModels.list({ modality: 'video', provider: 'none' })).toEqual([])
    expect(ctx.dvModels.get({ modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha' })?.description).toBe('alpha for ref2v')
    expect(ctx.dvModels.get({ modality: 'video', task: 'ref2v', provider: 'other', model: 'beta' })).toBeUndefined()
  })

  it('refuses a duplicate key, and notifies listeners of each registration and removal', async () => {
    const ctx = await start()
    expect(() => ctx.dvModels.register(entry('t2v', 'test', 'alpha'))).toThrow('dvModels: model "video/t2v/test/alpha" is already registered.')
    const changes: string[][] = []
    const unlisten = ctx.dvModels.onChanged(() => { changes.push(ctx.dvModels.list({ provider: 'extra' }).map(formatModelKey)) })
    const remove = ctx.dvModels.register(entry('ref2v', 'extra', 'gamma'))
    remove()
    remove()
    unlisten()
    ctx.dvModels.register(entry('t2v', 'extra', 'delta'))()
    expect(changes).toEqual([['video/ref2v/extra/gamma'], []])
  })

  it('removes a provider\'s entries when the provider plugin unloads', async () => {
    const ctx = await start()
    await unload(ctx, 'test-provider')
    expect(ctx.dvModels.list()).toEqual([])
  })

  it('answers dv_models_list with the key and description of each matching entry', async () => {
    const ctx = await start()
    const all = await call(ctx, 'dv_models_list', {})
    if (all.isError) throw new Error(all.error.message)
    expect(all.value).toEqual([
      { modality: 'video', task: 't2v', provider: 'test', model: 'alpha', description: 'alpha for t2v' },
      { modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha', description: 'alpha for ref2v' },
      { modality: 'video', task: 't2v', provider: 'other', model: 'beta', description: 'beta for t2v' },
    ])
    const refs = await call(ctx, 'dv_models_list', { task: 'ref2v' })
    if (refs.isError) throw new Error(refs.error.message)
    expect(refs.value).toEqual([{ modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha', description: 'alpha for ref2v' }])
  })

  it('answers dv_models_get with one entry\'s key, description and schema, and names an unknown key', async () => {
    const ctx = await start()
    const result = await call(ctx, 'dv_models_get', { modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha' })
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toEqual({
      modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha', description: 'alpha for ref2v',
      schema: { inputs: { reference: { media_types: ['image'] } }, extra: {} },
    })
    const unknown = await call(ctx, 'dv_models_get', { modality: 'video', task: 'ref2v', provider: 'other', model: 'beta' })
    expect(unknown.isError && unknown.error.message)
      .toContain('No model has the key video/ref2v/other/beta; call dv_models_list for the models you can use.')
  })

  it('describes its tools without naming a media type, so a new primitive needs no catalog text', async () => {
    const ctx = await start()
    for (const name of ['dv_models_list', 'dv_models_get']) {
      const tool = ctx.tools.get(name)
      expect(tool).toBeDefined()
      expect(JSON.stringify({ description: tool?.description, parameters: tool?.parameters })).not.toMatch(/video|image|audio/i)
    }
  })

  it('reads the key of a call from its params, and resolves the entry among the given tasks or names the unknown key', async () => {
    const ctx = await start()
    expect(modelKey({ modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha', prompt: 'a cat' }))
      .toEqual({ modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha' })
    expect(formatModelKey(modelKey({ modality: 'video', task: 7 }))).toBe('video///')
    // A consumer tests any value that carries a task, such as a catalog item, against the tasks of its operation.
    expect(servesTask({ task: 'ref2v' }, ['t2v', 'ref2v'])).toBe(true)
    expect(servesTask({ task: 'ref2v' }, ['t2v'])).toBe(false)
    const alpha = { modality: 'video', task: 'ref2v', provider: 'test', model: 'alpha' }
    expect(ctx.dvModels.resolve(['t2v', 'ref2v'], alpha).description).toBe('alpha for ref2v')
    expect(() => ctx.dvModels.resolve(['t2v'], alpha)).toThrow('Unknown model "video/ref2v/test/alpha"; call dv_models_list for the models.')
    expect(() => ctx.dvModels.resolve(['t2v', 'ref2v'], { ...alpha, provider: 'other' }))
      .toThrow('Unknown model "video/ref2v/other/alpha"; call dv_models_list for the models.')
  })

  it('keeps a registration while the catalog holds an entry of one of the tasks, and disposes it with the last one', async () => {
    const ctx = await start()
    const events: string[] = []
    const stop = ctx.dvModels.whileServing(['ref2v'], () => {
      events.push('start')
      return () => { events.push('stop') }
    })
    const none = ctx.dvModels.whileServing([], () => { throw new Error('no entry serves an empty task list') })
    expect(events).toEqual(['start'])
    ctx.dvModels.register(entry('t2v', 'extra', 'gamma'))()
    ctx.dvModels.register(entry('ref2v', 'extra', 'gamma'))()
    expect(events).toEqual(['start'])
    await unload(ctx, 'test-provider')
    expect(events).toEqual(['start', 'stop'])
    ctx.dvModels.register(entry('t2v', 'extra', 'delta'))
    expect(events).toEqual(['start', 'stop'])
    const remove = ctx.dvModels.register(entry('ref2v', 'extra', 'delta'))
    expect(events).toEqual(['start', 'stop', 'start'])
    stop()
    none()
    remove()
    expect(events).toEqual(['start', 'stop', 'start', 'stop'])
  })

  it('keeps the labels of tasks until their disposer runs, and refuses a second label of one task', async () => {
    const ctx = await start()
    expect(ctx.dvModels.taskLabels()).toEqual({})
    const t2v = { zh: '文字生成', en: 'From text' }
    const ref2v = { zh: '参考图生成', en: 'From references' }
    const remove = ctx.dvModels.labelTasks({ t2v, ref2v })
    expect(ctx.dvModels.taskLabels()).toEqual({ t2v, ref2v })
    expect(() => ctx.dvModels.labelTasks({ t2i: { zh: '图片', en: 'Image' }, ref2v: { zh: '另一个', en: 'Another' } }))
      .toThrow('dvModels: task "ref2v" already has a label.')
    expect(ctx.dvModels.taskLabels()).toEqual({ t2v, ref2v })
    remove()
    expect(ctx.dvModels.taskLabels()).toEqual({})
    const again = ctx.dvModels.labelTasks({ ref2v })
    remove()
    expect(ctx.dvModels.taskLabels()).toEqual({ ref2v })
    again()
    expect(ctx.dvModels.taskLabels()).toEqual({})
  })

  it('registers the video-model-selection skill for the agent only', async () => {
    const ctx = await start()
    const skill = await ctx.skills.get('video-model-selection')
    expect(skill?.invocation).toEqual({ modelInvocable: true, userInvocable: false })
    expect(skill?.content).toContain('Call `dv_models_list` with the task of the shot.')
  })

  it('registers the prompt skill of an entry for the agent while the entry lives, and names it in dv_models_list', async () => {
    const ctx = await start()
    const remove = ctx.dvModels.register({ ...entry('t2v', 'extra', 'gamma'), promptSkill: GAMMA_SKILL })
    const skill = await ctx.skills.get('gamma-prompting')
    expect(skill?.invocation).toEqual({ modelInvocable: true, userInvocable: false })
    expect(skill?.description).toBe('Prompt rules for model gamma for task t2v.')
    expect(skill?.content).toBe('# Gamma')
    const listed = await call(ctx, 'dv_models_list', { provider: 'extra' })
    if (listed.isError) throw new Error(listed.error.message)
    expect(listed.value).toEqual([
      { modality: 'video', task: 't2v', provider: 'extra', model: 'gamma', description: 'gamma for t2v', prompt_skill: 'gamma-prompting' },
    ])
    remove()
    expect(await ctx.skills.get('gamma-prompting')).toBeUndefined()
  })

  it('registers the prompt skills of the entries when the skill registry mounts after them', async () => {
    const ctx = await start()
    await unload(ctx, 'skills')
    ctx.dvModels.register({ ...entry('t2v', 'extra', 'gamma'), promptSkill: GAMMA_SKILL })
    await ctx.plugin(SkillRegistry)
    expect((await ctx.skills.get('gamma-prompting'))?.content).toBe('# Gamma')
  })

  it('adds nothing to the system prompt', async () => {
    const ctx = await start()
    const loaded = await ctx.systemPrompt.assemble({ agent: { id: 's1' } as never })
    await unload(ctx, 'dv-models')
    const unloaded = await ctx.systemPrompt.assemble({ agent: { id: 's1' } as never })
    expect(loaded.sections).toEqual(unloaded.sections)
    expect(loaded.contexts).toEqual(unloaded.contexts)
  })

  it('removes its tools and skills when the catalog unloads', async () => {
    const ctx = await start()
    ctx.dvModels.register({ ...entry('t2v', 'extra', 'gamma'), promptSkill: GAMMA_SKILL })
    expect(ctx.tools.get('dv_models_list')).toBeDefined()
    expect(ctx.tools.get('dv_models_get')).toBeDefined()
    expect(await ctx.skills.get('gamma-prompting')).toBeDefined()
    await unload(ctx, 'dv-models')
    expect(ctx.tools.get('dv_models_list')).toBeUndefined()
    expect(ctx.tools.get('dv_models_get')).toBeUndefined()
    expect(await ctx.skills.get('video-model-selection')).toBeUndefined()
    expect(await ctx.skills.get('gamma-prompting')).toBeUndefined()
  })
})
