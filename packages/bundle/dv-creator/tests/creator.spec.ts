import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { interpolate, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import * as yaml from 'js-yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repo = new URL('../../../../', import.meta.url)
const repoPath = (path: string): string => fileURLToPath(new URL(path, repo))
const load = (path: string): PatchOptions[] => yaml.load(readFileSync(repoPath(path), 'utf8'), { schema: entryListSchema }) as PatchOptions[]

/** The patch files of one bundle package, in the order its `dsh.bundle.patch` lists them. */
function bundleLayer(dir: string): PatchOptions[] {
  const { patch } = (JSON.parse(readFileSync(repoPath(`${dir}/package.json`), 'utf8')) as { dsh: { bundle: { patch: string | string[] } } }).dsh.bundle
  return (Array.isArray(patch) ? patch : [patch]).flatMap(file => load(`${dir}/${file}`))
}

const warnings: string[] = []
const rows = applyEntryPatches([], ['packages/bundle/base', 'packages/bundle/web-app', 'packages/bundle/dv', 'packages/bundle/dv-creator']
  .flatMap(bundleLayer), (message: string) => { warnings.push(message) })
const row = (id: string): EntryOptions => {
  const found = rows.find(entry => entry.id === id)
  if (found === undefined) throw new Error(`the composed profile has no row ${id}`)
  return found
}

let home = ''
let baseUrl = ''
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'dv-creator-profile-'))
  execFileSync(repoPath('scripts/video-harness/setup-profile.sh'), { env: { ...process.env, DSH_HOME: home } })
  baseUrl = pathToFileURL(`${join(home, 'profiles', 'video-harness-creator')}/`).href
})
afterAll(() => { rmSync(home, { recursive: true, force: true }) })
const bundlesOf = (name: string): string[] =>
  (JSON.parse(readFileSync(join(home, 'profiles', name, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }).dsh.profile.bundles

describe('DreamVerse Creator profile', () => {
  it('offers DreamVerse and DreamVerse Creator, with DreamVerse as the default and the chooser on', () => {
    expect(warnings).toEqual([])
    const presets = rows.filter(entry => entry.name === '@deepseek-ai/dsh-agent-preset' && entry.disabled !== true)
    expect(presets.map(entry => (entry.config as { id: string }).id)).toEqual(['dreamverse', 'dreamverse-creator'])
    expect(row('agent-preset-registry').config).toEqual({ default: 'dreamverse', modeSelectionEnabled: true })
  })

  it('is a separate profile, so the video-harness profile keeps its bundles', () => {
    expect(bundlesOf('video-harness')).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dv/bundle'])
    expect(bundlesOf('video-harness-creator')).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dv/bundle', '@dv/bundle-creator'])
  })

  it('polls the checkout packages/dv every 500 ms for host HMR and skips the browser bundles', () => {
    expect(interpolate({ baseUrl }, row('hmr').config)).toEqual({
      base: realpathSync(repoPath('packages/dv')),
      root: ['.'],
      ignored: ['**/node_modules', '**/.*', '**/lib'],
      usePolling: true,
      interval: 500,
    })
  })

  it('tells the DreamVerse Creator agent which sources reload live and mounts both skill directories', () => {
    const plugins = (row('preset-dreamverse-creator').config as { plugins: EntryOptions[] }).plugins
    const child = (id: string): Record<string, unknown> =>
      interpolate({ baseUrl }, plugins.find(entry => entry.id === id)?.config) as Record<string, unknown>
    expect(child('persona').suffix).toBe(`Your working directory is {{cwd}}. Saved edits to loaded TypeScript modules under ${realpathSync(repoPath('packages/dv'))} reload in this running app without a restart; edits to a cordis.patch.yml, SKILL.md, or package.json file need a plugin reload or a restart.`)
    const dirs = child('skill-filesystem').customSkillDirs as string[]
    expect(dirs.map(dir => realpathSync(dir)))
      .toEqual(['packages/bundle/dv/skills', 'packages/preset/agent-preset/skills'].map(dir => realpathSync(repoPath(dir))))
  })
})
