/**
 * The model catalog in a REAL composition: a test-only `cordis.yml` boots the DSH system prompt, the DSH tool registry,
 * `dvModels`, and a test company plugin through the Loader. The company plugin's models are the only fakes.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import DvModels, { MODES, type ModeId, type ModelEntry, type RenderModelFacts } from '../src/index.ts'

/** The facts every fake model reports; mode `reference` takes two reference images. */
function facts(mode: ModeId): RenderModelFacts {
  return {
    modelId: `backend-${mode}`, aspectRatios: ['16:9'], resolutions: ['720p'], frameSizes: { '16:9': { '720p': [1280, 720] } },
    minDurationSec: 4, maxDurationSec: 8, numFramesByDurationSec: { 4: 97 }, maxReferenceImages: mode === 'reference' ? 2 : 0,
    imageLabels: [], gpuSecondsPerVideoSecond: 2,
  }
}

/** A fake model in the given modes; mode `reference` takes the extra parameter `cfg`. */
function model(id: string, modes: ModeId[]): ModelEntry {
  return {
    id, company: 'Test Co', summary: `${id} test model`,
    modes: Object.fromEntries(modes.map(mode => [mode, mode === 'reference'
      ? { inputs: { reference: { min: 1 }, first_frame: { min: 0 } }, extra: { cfg: { type: 'number', description: 'Guidance scale.' } } }
      : { inputs: {}, extra: {} }])),
    facts: mode => Promise.resolve(facts(mode)),
    render: () => { throw new Error('not rendered in this test') },
  }
}

/** The test company plugin: registers `alpha` in both modes and `beta` in mode text. */
const Company = {
  name: 'test-company',
  inject: ['dvModels'],
  apply(ctx: Context): void {
    ctx.effect(() => ctx.dvModels.register(model('alpha', ['reference', 'text'])))
    ctx.effect(() => ctx.dvModels.register(model('beta', ['text'])))
  },
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvModels, Company }

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Boot the system prompt, the tool registry, the catalog and the test company plugin from a test-only `cordis.yml`.
 * @returns the root context.
 */
async function start(): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-models-'))
  const globals = globalThis as typeof globalThis & { __dvModels?: typeof PLUGINS }
  globals.__dvModels = PLUGINS
  const rows: string[] = []
  for (const [id, key] of [['system-prompt', 'SystemPrompt'], ['tools', 'ToolRuntime'], ['dv-models', 'DvModels'], ['test-company', 'Company']] as const) {
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

/** The text of the `dv:models` prompt section; empty when the section is empty or not registered. */
async function modelList(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({ agent: { id: 's1' } as never })
  return assembly.sections.find(section => section.name === 'dv:models')?.text ?? ''
}

describe('dvModels', () => {
  it('lists every registered model with its modes, and follows registrations and removals', async () => {
    const ctx = await start()
    expect(ctx.dvModels.list().map(entry => entry.id)).toEqual(['alpha', 'beta'])
    expect(Object.keys(ctx.dvModels.get('alpha')?.modes ?? {})).toEqual(['reference', 'text'])
    expect(ctx.dvModels.get('gamma')).toBeUndefined()
    const changes: string[][] = []
    const unlisten = ctx.dvModels.onChanged(() => { changes.push(ctx.dvModels.list().map(entry => entry.id)) })
    const remove = ctx.dvModels.register(model('gamma', ['text']))
    remove()
    remove()
    unlisten()
    ctx.dvModels.register(model('delta', ['text']))()
    expect(changes).toEqual([['alpha', 'beta', 'gamma'], ['alpha', 'beta']])
  })

  it('refuses a duplicate name, an unknown mode, an input the mode does not allow, and an entry without modes', async () => {
    const ctx = await start()
    expect(() => ctx.dvModels.register(model('alpha', ['text']))).toThrow('dvModels: model "alpha" is already registered.')
    expect(() => ctx.dvModels.register(model('none', []))).toThrow('dvModels: model "none" declares no mode.')
    expect(() => ctx.dvModels.register({ ...model('odd', ['text']), modes: { fly: { inputs: {}, extra: {} } } as never }))
      .toThrow('dvModels: model "odd" declares unknown mode "fly"; modes: reference, text.')
    expect(() => ctx.dvModels.register({ ...model('odd', ['text']), modes: { text: { inputs: { reference: { min: 1 } }, extra: {} } } }))
      .toThrow('dvModels: mode "text" of model "odd" accepts input "reference", which the mode does not allow.')
    expect(ctx.dvModels.list().map(entry => entry.id)).toEqual(['alpha', 'beta'])
  })

  it('gives the agent the model list as the dv:models prompt section, and drops it while no model is registered', async () => {
    const ctx = await start()
    const text = await modelList(ctx)
    expect(text).toContain('Every dv_shot_render call names a `model` and a `mode` from this list; a call without them is refused.')
    for (const [mode, definition] of Object.entries(MODES)) expect(text).toContain(`- ${mode}: ${definition.description}`)
    expect(text).toContain('| alpha | Test Co | reference, text | cfg (reference) | alpha test model |')
    expect(text).toContain('| beta | Test Co | text | — | beta test model |')
    const company = [...ctx.loader.entries()].find(entry => entry.options.name.endsWith('/test-company.mjs'))
    await company?.fiber?.dispose()
    expect(ctx.dvModels.list()).toEqual([])
    expect(await modelList(ctx)).toBe('')
  })

  it('answers dv_models_get with a model\'s limits in each of its modes', async () => {
    const ctx = await start()
    const call = (args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId('call-1'), name: 'dv_models_get', arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never,
    })
    const result = await call({ model: 'alpha' })
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toEqual({
      model: 'alpha', company: 'Test Co', about: 'alpha test model',
      modes: {
        reference: {
          inputs: { reference: { min: 1, max: 2 }, first_frame: { min: 0, max: 1 } }, duration_sec: { min: 4, max: 8 },
          aspect_ratios: ['16:9'], resolutions: ['720p'], extra: { cfg: { type: 'number', description: 'Guidance scale.' } },
        },
        text: { inputs: {}, duration_sec: { min: 4, max: 8 }, aspect_ratios: ['16:9'], resolutions: ['720p'], extra: {} },
      },
    })
    const unknown = await call({ model: 'gamma' })
    expect(unknown.isError && unknown.error.message).toContain('Unknown model "gamma"; models: alpha, beta.')
  })

  it('checks extra parameters against the model\'s parameters in the mode', async () => {
    const ctx = await start()
    const alpha = ctx.dvModels.get('alpha')
    if (alpha === undefined) throw new Error('alpha is not registered')
    expect(ctx.dvModels.checkExtra(alpha, 'reference', { cfg: 7 })).toEqual([])
    expect(ctx.dvModels.checkExtra(alpha, 'reference', { steps: 4 }))
      .toEqual(['alpha has no extra parameter `steps` in mode reference; its extra parameters: cfg.'])
    expect(ctx.dvModels.checkExtra(alpha, 'text', { cfg: 7 })).toEqual(['alpha has no extra parameter `cfg` in mode text; its extra parameters: none.'])
    expect(ctx.dvModels.checkExtra(alpha, 'reference', { cfg: 'high' })).toEqual([expect.stringContaining('cfg')])
  })

  it('removes its prompt section and tool when the catalog unloads', async () => {
    const ctx = await start()
    expect(ctx.tools.get('dv_models_get')).toBeDefined()
    const catalog = [...ctx.loader.entries()].find(entry => entry.options.name.endsWith('/dv-models.mjs'))
    await catalog?.fiber?.dispose()
    expect(ctx.tools.get('dv_models_get')).toBeUndefined()
    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 's1' } as never })
    expect(assembly.sections.map(section => section.name)).not.toContain('dv:models')
  })
})
