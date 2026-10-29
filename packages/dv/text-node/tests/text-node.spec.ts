/**
 * The Text node component in a REAL composition: a test-only `cordis.yml` boots the DSH skill registry, the DSH tool
 * registry, `dvProject`, `dvFfmpeg`, the asset pool and `dvTextNode` through the Loader, and the agent calls the
 * `dv_textnode_*` tools as chat session `s1`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvProject, { type OperationToolValue, type ProjectId, type ProjectRecord, type RecordId, type SessionId } from '@dv/project'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DvTextNode, { type TextPath } from '../src/index.ts'

const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SkillRegistry, SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvTextNode }

const BEATS = '# Beats\n\n## Act 1\nMia finds the map.\nShe runs.\n\n## Act 2\nThe storm.\nShe runs.\n'

interface Fixture {
  ctx: Context
  project: ProjectId
  /** Run one tool as the agent of chat session `s1` and return its value; a tool error throws its message. */
  call(name: string, args: Record<string, unknown>): Promise<OperationToolValue>
  /** Every record of the project's `main`. */
  records(): ProjectRecord[]
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @returns the fixture, with a project bound to chat session `s1`.
 */
async function start(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-text-node-'))
  const globals = globalThis as typeof globalThis & { __dvTextNodeComposition?: typeof PLUGINS }
  globals.__dvTextNodeComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvTextNodeComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('skills', 'SkillRegistry', [])
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`root: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`, `projectsFolder: ${join(dir, 'DreamVerse')}`])
  row('dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, `ffprobePath: ${FFPROBE}`])
  row('dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`])
  row('dv-text-node', 'DvTextNode', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const user = { actor: 'user' as const, surface: 'canvas' as const, session: null, turn: null, tool_call: null, intent: 'create' }
  const project = (await ctx.dvProject.createProject('texts', user)).id
  ctx.dvProject.bindSession(brandString<SessionId>('s1'), project)
  let calls = 0
  return {
    ctx, project,
    async call(name, args) {
      calls += 1
      const result = await ctx.tools.execute({
        callId: ToolCallId(`call-${String(calls)}`), name, arguments: { reason: name, ...args }, signal: new AbortController().signal,
        agent: { id: 's1' } as never,
      })
      if (result.isError) throw new Error(result.error.message)
      return result.value as OperationToolValue
    },
    records: () => ctx.dvProject.getState(project).components.proj.records,
  }
}

/** The versions of one text node in the fixture's current state. */
function versionsOf(fixture: Fixture, path: string) {
  return fixture.ctx.dvProject.getState(fixture.project).components.textnode.texts[brandString<TextPath>(path)] ?? []
}

describe('dvTextNode', () => {
  it('registers the three dv_textnode_* tools and the text-node skill, and removes them on disposal', async () => {
    const fixture = await start()
    for (const name of ['dv_textnode_write', 'dv_textnode_edit', 'dv_textnode_read']) expect(fixture.ctx.tools.get(name), name).toBeDefined()
    const skill = await fixture.ctx.skills.get('text-node')
    expect(skill?.content.startsWith('# Text nodes\n')).toBe(true)
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-text-node.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.tools.get('dv_textnode_write')).toBeUndefined()
    expect(await fixture.ctx.skills.get('text-node')).toBeUndefined()
  })

  it('writes version 1 and then version 2, each as a text/markdown asset that supersedes the previous record', async () => {
    const fixture = await start()
    const first = await fixture.call('dv_textnode_write', { path: 'beats.md', body: BEATS, base_version: 0 })
    const second = await fixture.call('dv_textnode_write', { path: 'beats.md', body: '# Beats\n\nOne act.\n', base_version: 1 })
    expect(first.report).toMatchObject({ path: 'beats.md', version: 1, title: 'Beats' })
    expect(second.report).toMatchObject({ path: 'beats.md', version: 2, title: 'Beats' })
    const versions = versionsOf(fixture, 'beats.md')
    expect(versions.map(version => [version.version, version.body, version.created_by])).toEqual([
      [1, BEATS, first.record], [2, '# Beats\n\nOne act.\n', second.record],
    ])
    const asset = versions[1]?.asset
    expect(asset === undefined ? null : [fixture.ctx.dvAssetPool.get(asset).mime, fixture.ctx.dvAssetPool.read(asset).toString()])
      .toEqual(['text/markdown', '# Beats\n\nOne act.\n'])
    expect(fixture.ctx.dvProject.getRecord(fixture.project, second.record as RecordId).supersedes).toEqual([first.record])
  })

  it('lists each text node in the project summary with its metadata and without its body', async () => {
    const fixture = await start()
    await fixture.call('dv_textnode_write', { path: 'episodes/ep001/script.md', base_version: 0, body: '# Episode one\n\nShe runs.\n', title: 'EP001 script' })
    const state = await fixture.ctx.tools.execute({
      callId: ToolCallId('state'), name: 'dv_proj_state', arguments: {}, signal: new AbortController().signal, agent: { id: 's1' } as never,
    })
    const summary = state.isError ? null : state.value as { texts: unknown[] }
    const [latest] = versionsOf(fixture, 'episodes/ep001/script.md')
    expect(summary?.texts).toEqual([{ path: 'episodes/ep001/script.md', title: 'EP001 script', version: 1, chars: 25, asset: latest?.asset }])
    expect(JSON.stringify(summary)).not.toContain('She runs')
  })

  it('edits a unique old_text into the next version and keeps the title', async () => {
    const fixture = await start()
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    const edited = await fixture.call('dv_textnode_edit', {
      path: 'beats.md', base_version: 1, edits: [{ old_text: 'Mia finds the map.', new_text: 'Mia steals the map.' }],
    })
    expect(edited.report).toMatchObject({ version: 2, title: 'Beats' })
    expect(versionsOf(fixture, 'beats.md')[1]?.body).toBe(BEATS.replace('finds', 'steals'))
  })

  it.each([
    ['occurs zero times', 'Mia flies.'],
    ['occurs twice', 'She runs.'],
  ])('refuses an edit whose old_text %s and writes no record', async (_case, oldText) => {
    const fixture = await start()
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    const before = fixture.records().length
    await expect(fixture.call('dv_textnode_edit', {
      path: 'beats.md', base_version: 1, edits: [{ old_text: 'The storm.', new_text: 'The calm.' }, { old_text: oldText, new_text: 'x' }],
    })).rejects.toThrow(/Edit 2: old_text occurs [02] times/u)
    expect(fixture.records()).toHaveLength(before)
    expect(versionsOf(fixture, 'beats.md')).toHaveLength(1)
  })

  it('refuses an edit with no edits and writes no record', async () => {
    const fixture = await start()
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    const before = fixture.records().length
    await expect(fixture.call('dv_textnode_edit', { path: 'beats.md', base_version: 1, edits: [] })).rejects.toThrow(/edits is empty/u)
    expect(fixture.records()).toHaveLength(before)
  })

  it('refuses a missing or stale base_version with a hint to read again, for a write and an edit', async () => {
    const fixture = await start()
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 1, body: `${BEATS}More.\n` })
    const before = fixture.records().length
    await expect(fixture.call('dv_textnode_write', { path: 'beats.md', body: 'mine', base_version: 1 })).rejects.toThrow(/dv_textnode_read/u)
    await expect(fixture.call('dv_textnode_edit', {
      path: 'beats.md', base_version: 1, edits: [{ old_text: 'More.', new_text: 'Less.' }],
    })).rejects.toThrow(/at version 2, not base_version 1/u)
    await expect(fixture.call('dv_textnode_write', { path: 'new.md', body: 'x', base_version: 1 })).rejects.toThrow(/at version 0/u)
    await expect(fixture.call('dv_textnode_write', { path: 'beats.md', body: 'mine' })).rejects.toThrow(/base_version/u)
    expect(fixture.records()).toHaveLength(before)
  })

  it('refuses a second concurrent write on the same base while the first one has not finished', async () => {
    const fixture = await start()
    await fixture.call('dv_textnode_write', { path: 'beats.md', body: BEATS, base_version: 0 })
    const results = await Promise.allSettled([
      fixture.call('dv_textnode_write', { path: 'beats.md', body: 'mine', base_version: 1 }),
      fixture.call('dv_textnode_edit', { path: 'beats.md', base_version: 1, edits: [{ old_text: 'The storm.', new_text: 'The calm.' }] }),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1]?.status === 'rejected' ? String(results[1].reason) : '').toMatch(/has a write that has not finished/u)
    const versions = versionsOf(fixture, 'beats.md')
    expect(versions.map(version => version.version)).toEqual([1, 2])
    const asset = versions[1]?.asset
    expect(asset === undefined ? null : fixture.ctx.dvAssetPool.read(asset).toString()).toBe('mine')
  })

  it('reads one section with its line numbers, or an older version, and writes no record', async () => {
    const fixture = await start()
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 1, body: '# Beats\n' })
    const before = fixture.records().length
    const section = await fixture.call('dv_textnode_read', { path: 'beats.md', version: 1, section: 'Act 1' })
    expect(section).toMatchObject({ record: '', report: { version: 1, section: 'Act 1', text: '3\t## Act 1\n4\tMia finds the map.\n5\tShe runs.\n6\t' } })
    const whole = await fixture.call('dv_textnode_read', { path: 'beats.md' })
    expect(whole.report).toMatchObject({ version: 2, text: '1\t# Beats\n2\t' })
    await expect(fixture.call('dv_textnode_read', { path: 'beats.md', section: 'Act 9' })).rejects.toThrow(/the headings are: Beats/u)
    expect(fixture.records()).toHaveLength(before)
  })

  it('marks a record that took version 1\'s asset stale once version 2 is written', async () => {
    const fixture = await start()
    // A consumer of another component: it takes a text asset as its input.
    fixture.ctx.dvProject.registerComponent('probe')
    fixture.ctx.dvProject.registerOperation({
      name: 'probe.use', component: 'probe', version: '1', description: 'Use a text.', params: {},
      inputs: { text: { type: 'text', description: 'A text.', required: true } }, outputs: [], deterministic: false,
      resource: 'none', summarize: () => 'used', execute: () => Promise.resolve({ outputs: [] }),
    })
    await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    const asset = versionsOf(fixture, 'beats.md')[0]?.asset
    const probe = await fixture.call('dv_probe_use', { inputs: { text: asset } })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.proj.stale[probe.record as RecordId]).toBeUndefined()
    const second = await fixture.call('dv_textnode_edit', { path: 'beats.md', base_version: 1, edits: [{ old_text: 'The storm.', new_text: 'The calm.' }] })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.proj.stale[probe.record as RecordId]).toBe(second.record)
  })

  it.each(['/beats.md', 'beats@2.md', 'beats.md#act-1', '../beats.md', 'acts/../beats.md', ' ', '', 'my beats.md', ' beats.md', 'acts//beats.md', 'acts/', './beats.md', 'acts/./beats.md'])(
    'refuses the path %j for every operation and writes no record',
    async (path) => {
      const fixture = await start()
      const before = fixture.records().length
      await expect(fixture.call('dv_textnode_write', { path, base_version: 0, body: 'x' })).rejects.toThrow(/Text node path/u)
      await expect(fixture.call('dv_textnode_edit', { path, base_version: 1, edits: [{ old_text: 'x', new_text: 'y' }] })).rejects.toThrow(/Text node path/u)
      await expect(fixture.call('dv_textnode_read', { path })).rejects.toThrow(/Text node path/u)
      expect(fixture.records()).toHaveLength(before)
    },
  )

  it('links a write to the current records of its from paths, and a later source version marks it stale', async () => {
    const fixture = await start()
    const beats = await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    const script = await fixture.call('dv_textnode_write', { path: 'script.md', base_version: 0, body: '# Script\n', from: ['beats.md'] })
    const record = (id: string) => fixture.ctx.dvProject.getRecord(fixture.project, id as RecordId)
    expect(record(script.record).inputs.map(input => [input.role, input.ref, input.resolved_asset])).toEqual([
      ['source', { record: beats.record, output: 0 }, versionsOf(fixture, 'beats.md')[0]?.asset],
    ])
    const stale = () => fixture.ctx.dvProject.getState(fixture.project).components.proj.stale
    expect(stale()[script.record as RecordId]).toBeUndefined()
    const next = await fixture.call('dv_textnode_edit', { path: 'beats.md', base_version: 1, edits: [{ old_text: 'The storm.', new_text: 'The calm.' }] })
    expect(stale()[script.record as RecordId]).toBe(next.record)
    expect(record(next.record).based_on).toBe(beats.record)
  })

  it('keeps the sources of the previous version when a write or an edit names no from, and drops them for from: []', async () => {
    const fixture = await start()
    const beats = await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    await fixture.call('dv_textnode_write', { path: 'script.md', base_version: 0, body: '# Script\nA.\n', from: ['beats.md'] })
    const edited = await fixture.call('dv_textnode_edit', { path: 'script.md', base_version: 1, edits: [{ old_text: 'A.', new_text: 'B.' }] })
    const refs = (id: string) => fixture.ctx.dvProject.getRecord(fixture.project, id as RecordId).inputs.map(input => input.ref)
    expect(refs(edited.record)).toEqual([{ record: beats.record, output: 0 }])
    const cleared = await fixture.call('dv_textnode_write', { path: 'script.md', base_version: 2, body: '# Script\n', from: [] })
    expect(refs(cleared.record)).toEqual([])
    await expect(fixture.call('dv_textnode_write', { path: 'x.md', base_version: 0, body: 'x', from: ['missing.md'] })).rejects.toThrow(/No text node missing.md/u)
  })

  it('links each from path once, and refuses inputs beside from and a source whose first write has not finished', async () => {
    const fixture = await start()
    const beats = await fixture.call('dv_textnode_write', { path: 'beats.md', base_version: 0, body: BEATS })
    const script = await fixture.call('dv_textnode_write', { path: 'script.md', base_version: 0, body: '# Script\n', from: ['beats.md', 'beats.md'] })
    expect(fixture.ctx.dvProject.getRecord(fixture.project, script.record as RecordId).inputs.map(input => input.ref))
      .toEqual([{ record: beats.record, output: 0 }])
    await expect(fixture.call('dv_textnode_write', {
      path: 'notes.md', base_version: 0, body: 'x', from: ['beats.md'], inputs: { source: [`${beats.record}#0`] },
    })).rejects.toThrow(/pass no inputs beside from/u)
    // A write whose input comes from a running record waits as a pending record until that record finishes.
    let release = (): void => {}
    fixture.ctx.dvProject.registerComponent('probe')
    fixture.ctx.dvProject.registerOperation({
      name: 'probe.slow', component: 'probe', version: '1', description: 'Write a text later.', params: {},
      inputs: {}, outputs: [{ role: 'text', type: 'text' }], deterministic: false, resource: 'none', summarize: () => 'slow',
      execute: context => new Promise((resolve) => {
        release = () => { resolve({ outputs: [context.importAsset(Buffer.from('later'), { mime: 'text/markdown', name: 'later.md' })] }) }
      }),
    })
    const slow = fixture.call('dv_probe_slow', {})
    const running = await vi.waitFor(() => {
      const found = fixture.records().find(each => each.operation === 'probe.slow' && each.status === 'running')
      if (found === undefined) throw new Error('probe.slow is not running')
      return found
    })
    const ads = await fixture.call('dv_textnode_write', { path: 'ads.md', base_version: 0, body: '# Ads\n', inputs: { source: [`${running.id}#0`] } })
    expect(ads.status).toBe('pending')
    await expect(fixture.call('dv_textnode_write', { path: 'spec.md', base_version: 0, body: 'x', from: ['ads.md'] }))
      .rejects.toThrow(/ads.md has no finished version yet/u)
    release()
    await slow
  })
})
