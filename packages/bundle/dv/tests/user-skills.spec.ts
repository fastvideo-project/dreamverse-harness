/** The real bundle API saves uploads into the directory scanned by the shipped DreamVerse preset. */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dump, load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as Filesystem from '@deepseek-ai/dsh-skill-filesystem'
import { expect, it, onTestFinished, vi } from 'vitest'
import { bootBundle, type Row } from './bundle.ts'

it('loads a user upload through the preset filesystem row after API installation and a registry restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dv-user-library-'))
  vi.stubEnv('DSH_HOME', home)
  let bundle = await bootBundle({ skills: SkillRegistry })
  onTestFinished(async () => { await bundle.dispose(); rmSync(home, { recursive: true, force: true }) })
  const patch = load(readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8'), { schema: entryListSchema }) as Array<{ insert?: Array<Row & { config?: { plugins?: Row[] } }> }>
  const preset = patch.flatMap(row => row.insert ?? []).find(row => row.id === 'preset-dreamverse')
  const filesystem = preset?.config?.plugins?.find(row => row.id === 'skill-filesystem')
  if (filesystem === undefined) throw new Error('Missing DreamVerse filesystem row')
  const globals = globalThis as typeof globalThis & { __dvComposition?: Record<string, object> }
  globals.__dvComposition!['user-filesystem'] = Filesystem
  const file = join(bundle.dir, 'user-filesystem.mjs')
  writeFileSync(file, 'export default globalThis.__dvComposition["user-filesystem"]\n')
  const config = filesystem.config as { includeDefaultRoots: boolean; customSkillDirs: unknown[] }
  const entry = { ...filesystem, id: 'user-filesystem', name: pathToFileURL(file).href,
    config: { ...config, customSkillDirs: config.customSkillDirs.slice(0, 1) } }
  const configFile = join(bundle.dir, 'user-skills.yml')
  writeFileSync(configFile, dump([entry], { schema: entryListSchema }))
  const include = { name: 'cordis:include', config: { path: pathToFileURL(configFile).href } }
  await bundle.ctx.loader.create(include)
  await bundle.ctx.loader.await()
  const route = bundle.ctx.dvApi.fetchRoutes().find(route => route.path === '/api/dv/skills/upload')!
  const source = '---\nname: my-video-style\ndescription: My preferred video style\n---\nUse warm light and three short shots.\n'
  expect(await bundle.ctx.skills.get('my-video-style')).toBeUndefined()
  const collision = await route.fetch(new Request('http://localhost/api/dv/skills/upload?filename=SKILL.md', {
    method: 'POST', body: source.replace('name: my-video-style', 'name: character'),
  }))
  expect(collision.status).toBe(409)
  const response = await route.fetch(new Request('http://localhost/api/dv/skills/upload?filename=SKILL.md', { method: 'POST', body: source }))
  expect(response.status).toBe(200)
  await vi.waitFor(async () => { expect((await bundle.ctx.skills.get('my-video-style'))?.name).toBe('my-video-style') })
  const first = await bundle.ctx.skills.get('my-video-style')
  expect(first?.content).toBe('Use warm light and three short shots.')
  await expect(`${first?.name}\n${first?.description}\n${first?.content}\n`).toMatchFileSnapshot('./expected/user-skill.txt')
  const earlier = { dir: bundle.dir, services: bundle.services }
  await bundle.stop()
  vi.stubEnv('DSH_HOME', home)
  bundle = await bootBundle({ skills: SkillRegistry }, earlier)
  globals.__dvComposition!['user-filesystem'] = Filesystem
  writeFileSync(configFile, dump([entry], { schema: entryListSchema }))
  await bundle.ctx.loader.create(include)
  await bundle.ctx.loader.await()
  expect((await bundle.ctx.skills.get('my-video-style'))?.content).toBe(first?.content)
})
