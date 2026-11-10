/**
 * The community-LoRA registry in a REAL composition: a test-only `cordis.yml` boots the DSH system prompt, the DSH tool
 * registry, the DSH skill registry and `dvLora` through the Loader. The registry config is the only fixture.
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
import DvLora, { type Config, type LoraDefinition } from '../src/index.ts'

/** The registry the deployment serves in these tests. */
const REGISTRY: LoraDefinition[] = [
  {
    id: 'fal/MiniMax-H3-Realism-People-LoRA', displayName: 'Realism People',
    description: 'Photoreal skin, faces and hands for people in the shot.',
    triggerWords: ['photoreal skin', 'natural pores'], defaultStrength: 0.8, minStrength: 0, maxStrength: 1.5,
    targets: [{ model: 'fasth3', tasks: ['t2v', 'ref2v'] }],
    license: 'Apache-2.0', sourceUrl: 'https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA',
  },
  {
    id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA', displayName: '360 Orbit',
    description: 'A camera that circles the subject.',
    triggerWords: [], defaultStrength: 1, minStrength: 0.2, maxStrength: 2,
    targets: [{ model: 'fasth3', tasks: ['t2v'] }],
    license: 'MIT', sourceUrl: 'https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA',
  },
]

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, SkillRegistry, DvLora }

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Boot the system prompt, both registries and `dvLora` from a test-only `cordis.yml`.
 * @param config - the registry config the row passes.
 * @returns the root context.
 */
async function start(config: Config = { adapters: REGISTRY }): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-lora-'))
  const globals = globalThis as typeof globalThis & { __dvLora?: typeof PLUGINS }
  globals.__dvLora = PLUGINS
  const adapters = JSON.stringify(config.adapters)
  const plugins = [
    ['system-prompt', 'SystemPrompt'], ['tools', 'ToolRuntime'], ['skills', 'SkillRegistry'], ['dv-lora', 'DvLora'],
  ] as const
  const rows: string[] = []
  for (const [id, key] of plugins) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvLora.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`)
  }
  rows.push('  config:', `    adapters: ${adapters}`)
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

/** Call one tool through the tool registry. */
function call(ctx: Context, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    callId: ToolCallId('call-1'), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never,
  })
}

/** Dispose the fiber of one fixture row, such as `dv-lora`. */
async function unload(ctx: Context, id: string): Promise<void> {
  const row = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith(`/${id}.mjs`))
  await row?.fiber?.dispose()
}

describe('dvLora', () => {
  it('serves each configured adapter by id, and the adapters of one model and task', async () => {
    const ctx = await start()
    expect(ctx.dvLora.list().map(adapter => adapter.id)).toEqual([
      'fal/MiniMax-H3-Realism-People-LoRA', 'pablodawson/MiniMax-H3-360-Orbit-LoRA',
    ])
    expect(ctx.dvLora.get('fal/MiniMax-H3-Realism-People-LoRA')).toMatchObject({ displayName: 'Realism People', defaultStrength: 0.8 })
    expect(ctx.dvLora.get('nobody/none')).toBeUndefined()
    expect(ctx.dvLora.list({ model: 'fasth3', task: 'ref2v' }).map(adapter => adapter.id))
      .toEqual(['fal/MiniMax-H3-Realism-People-LoRA'])
    expect(ctx.dvLora.list({ model: 'fasth3', task: 't2v' })).toHaveLength(2)
    expect(ctx.dvLora.list({ model: 'other' })).toEqual([])
  })

  it('answers dv_lora_list with the fields a creator chooses by, filtered by model and task', async () => {
    const ctx = await start()
    const all = await call(ctx, 'dv_lora_list', {})
    if (all.isError) throw new Error(all.error.message)
    expect(all.value).toEqual([{
      id: 'fal/MiniMax-H3-Realism-People-LoRA', display_name: 'Realism People',
      description: 'Photoreal skin, faces and hands for people in the shot.',
      trigger_words: ['photoreal skin', 'natural pores'], default_strength: 0.8, strength_range: { min: 0, max: 1.5 },
      targets: [{ model: 'fasth3', tasks: ['t2v', 'ref2v'] }],
      license: 'Apache-2.0', source_url: 'https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA',
    }, {
      id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA', display_name: '360 Orbit',
      description: 'A camera that circles the subject.', trigger_words: [], default_strength: 1,
      strength_range: { min: 0.2, max: 2 }, targets: [{ model: 'fasth3', tasks: ['t2v'] }],
      license: 'MIT', source_url: 'https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA',
    }])
    const orbit = await call(ctx, 'dv_lora_list', { model: 'fasth3', task: 't2v' })
    if (orbit.isError) throw new Error(orbit.error.message)
    expect(JSON.stringify(orbit.value)).toContain('"id":"fal/MiniMax-H3-Realism-People-LoRA"')
    expect(JSON.stringify(orbit.value)).toContain('"id":"pablodawson/MiniMax-H3-360-Orbit-LoRA"')
    // The ref2v-only adapter is not listed for t2v.
    expect(JSON.stringify(orbit.value)).toContain('pablodawson/MiniMax-H3-360-Orbit-LoRA')
    expect(JSON.stringify(orbit.value)).not.toContain('ref2v-only')
    const none = await call(ctx, 'dv_lora_list', { model: 'other' })
    expect(!none.isError && none.value).toEqual([])
  })

  it('filters by task alone, listing only the adapters some target serves for that task', async () => {
    const ctx = await start()
    expect(ctx.dvLora.list({ task: 'ref2v' }).map(adapter => adapter.id)).toEqual(['fal/MiniMax-H3-Realism-People-LoRA'])
    const ref2v = await call(ctx, 'dv_lora_list', { task: 'ref2v' })
    if (ref2v.isError) throw new Error(ref2v.error.message)
    expect((ref2v.value as Array<{ id: string }>).map(adapter => adapter.id)).toEqual(['fal/MiniMax-H3-Realism-People-LoRA'])
  })

  it('answers dv_lora_get with one adapter, and names the served ids for an unknown one', async () => {
    const ctx = await start()
    const one = await call(ctx, 'dv_lora_get', { id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA' })
    if (one.isError) throw new Error(one.error.message)
    expect(one.value).toMatchObject({ id: 'pablodawson/MiniMax-H3-360-Orbit-LoRA', trigger_words: [], license: 'MIT' })
    const unknown = await call(ctx, 'dv_lora_get', { id: 'nobody/none' })
    expect(unknown.isError && unknown.error.message)
      .toContain('dv-lora serves no adapter "nobody/none"; it serves: fal/MiniMax-H3-Realism-People-LoRA, pablodawson/MiniMax-H3-360-Orbit-LoRA. Call dv_lora_list.')
    const empty = await start({ adapters: [] })
    const none = await call(empty, 'dv_lora_get', { id: 'nobody/none' })
    expect(none.isError && none.error.message).toContain('dv-lora serves no adapter "nobody/none"; it serves: none. Call dv_lora_list.')
  })

  it('registers the community-lora skill for the agent, and removes it with the plugin', async () => {
    const ctx = await start()
    const listed = await ctx.skills.list()
    expect(listed.map(skill => [skill.name, skill.invocation])).toEqual([
      ['community-lora', { modelInvocable: true, userInvocable: false }],
    ])
    expect((await ctx.skills.get('community-lora'))?.content).toContain('Community adapters are trained on base H3')
    await unload(ctx, 'dv-lora')
    expect(await ctx.skills.list()).toEqual([])
    expect(ctx.tools.get('dv_lora_list')).toBeUndefined()
    expect(ctx.get('dvLora')).toBeUndefined()
  })

  it('refuses a registry that repeats an id, an unknown task, an unordered strength range, or an empty id', () => {
    const refused = (config: Config) => () => new DvLora(new Context(), config)
    expect(refused({ adapters: [REGISTRY[0]!, REGISTRY[0]!] }))
      .toThrow('dv-lora: adapter "fal/MiniMax-H3-Realism-People-LoRA" is configured twice.')
    expect(refused({ adapters: [{ ...REGISTRY[0]!, targets: [{ model: 'fasth3', tasks: ['v2v'] }] }] }))
      .toThrow('dv-lora: adapter "fal/MiniMax-H3-Realism-People-LoRA" names unknown task "v2v".')
    expect(refused({ adapters: [{ ...REGISTRY[0]!, defaultStrength: 2, maxStrength: 1 }] }))
      .toThrow('dv-lora: adapter "fal/MiniMax-H3-Realism-People-LoRA" needs minStrength <= defaultStrength <= maxStrength.')
    expect(refused({ adapters: [{ ...REGISTRY[0]!, id: ' ' }] })).toThrow('dv-lora: an adapter has an empty id.')
  })
})
