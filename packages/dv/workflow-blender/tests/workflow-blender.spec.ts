/**
 * The Blender workflow skill in a REAL composition: a test-only `cordis.yml` boots the DSH skill registry and the plugin
 * through the Loader, with a user skill folder that the provider must not read.
 */
import { globSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as WorkflowBlender from '../src/index.ts'

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SkillRegistry, WorkflowBlender }

/**
 * Boot the skill registry and the plugin from a test-only `cordis.yml`.
 * @returns the root context.
 */
async function start(): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-workflow-blender-'))
  const globals = globalThis as typeof globalThis & { __dvWorkflowBlender?: typeof PLUGINS }
  globals.__dvWorkflowBlender = PLUGINS
  const rows: string[] = []
  for (const [id, key] of [['skills', 'SkillRegistry'], ['dv-workflow-blender', 'WorkflowBlender']] as const) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvWorkflowBlender.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`)
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return ctx
}

describe('dv-workflow-blender', () => {
  it('serves exactly the SKILL.md files of its skills folder while it is mounted, and removes them on disposal', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dv-workflow-blender-home-'))
    onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
    mkdirSync(join(home, 'skills', 'user-flow'), { recursive: true })
    writeFileSync(join(home, 'skills', 'user-flow', 'SKILL.md'), '---\nname: user-flow\ndescription: "A user skill."\n---\n\nBody.\n')
    vi.stubEnv('DSH_AGENTS_HOME', home)
    onTestFinished(() => { vi.unstubAllEnvs() })
    const ctx = await start()
    const folder = fileURLToPath(new URL('../skills', import.meta.url))
    const files = globSync('*/SKILL.md', { cwd: folder }).map(file => `custom ${realpathSync(join(folder, file))}`).sort()
    const served = async (): Promise<string[]> => (await ctx.skills.list())
      .filter(skill => skill.provider === 'workflow-blender').map(skill => `${skill.source} ${skill.path ?? ''}`).sort()
    expect(files).not.toEqual([])
    expect(await served()).toEqual(files)
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-workflow-blender.mjs'))
    await entry?.fiber?.dispose()
    expect(await served()).toEqual([])
  })
})
