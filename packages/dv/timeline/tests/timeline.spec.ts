/**
 * The Timeline component in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, `dvProject`,
 * `dvFfmpeg`, the asset pool and `dvTimeline` through the Loader. The agent edits timelines with the `dv_timeline_*`
 * tools at the end of the project's history, the human edits them with `dvProject.run`, and each call becomes one record that
 * the `timeline` slice folds. Clips are named by the clip IDs that the records store in `report.clips`.
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
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvCanvasNodes from '@dv/canvas'
import DvFfmpeg from '@dv/ffmpeg'
import DvProject, {
  type OperationSpec, type OperationToolValue, type ProjectId, type ProjectRecord, type RecordId, type RunRequest, type RunResult,
} from '@dv/project'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import DvTimeline from '../src/index.ts'

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvCanvasNodes, DvTimeline }

/** The twenty-six operations in registration order: the twenty-five edits, then the export. */
const OPERATIONS = [
  'timeline.create', 'timeline.update', 'timeline.rename', 'timeline.delete', 'timeline.clip_insert', 'timeline.clip_move', 'timeline.clip_remove',
  'timeline.clip_split', 'timeline.clip_trim', 'timeline.clip_replace', 'timeline.sound_add', 'timeline.sound_remove', 'timeline.sound_split', 'timeline.sound_move', 'timeline.sound_trim',
  'timeline.sound_track_remove', 'timeline.sound_track_rename', 'timeline.mute', 'timeline.track_clip_add', 'timeline.track_clip_move',
  'timeline.video_track_remove', 'timeline.video_track_move', 'timeline.main_track_remove', 'timeline.main_track_swap', 'timeline.track_add', 'timeline.export',
]

interface Fixture {
  ctx: Context
  project: ProjectId
  /** Run one tool as the agent of chat session `s1`, which runs in the folder of `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Run one operation as the human on the timeline panel, at the end of the project's history. */
  run(operation: string, params: Record<string, unknown>, inputs?: RunRequest['inputs']): Promise<ProjectRecord>
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @param options - `canvas: true` mounts `@dv/canvas` before the timeline.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(options: { canvas?: boolean } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-timeline-'))
  const globals = globalThis as typeof globalThis & { __dvTimelineComposition?: typeof PLUGINS }
  globals.__dvTimelineComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvTimelineComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  // The agent tools describe outputs through the asset pool, so the pool and its ffmpeg runner are mounted too.
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [])
  if (options.canvas === true) row('dv-canvas', 'DvCanvasNodes', [])
  row('dv-timeline', 'DvTimeline', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const services = provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const origin = { actor: 'user' as const, surface: 'timeline' as const, session: null, turn: null, tool_call: null, intent: 'edit' }
  const project = await chatProject(ctx.dvProject, services, 'timeline', origin)
  let calls = 0
  return {
    ctx, project,
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    async run(operation, params, inputs = []) {
      const result = await ctx.dvProject.run({ ...origin, project, operation, params, inputs })
      if (result.record === null) throw new Error(`${operation} wrote no record`)
      return result.record
    },
  }
}

/** A promise with its resolver, to hold a stand-in render until the test releases it. */
function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

/** The value of a successful operation tool call. */
function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

/** The error message of a failed tool call. */
function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

describe('dvTimeline', () => {
  it('registers the twenty-six operations with their dv_timeline_* tools and removes them on disposal', async () => {
    const fixture = await start()
    const specs = fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'timeline')
    expect(specs.map(spec => spec.name)).toEqual(OPERATIONS)
    const edits = specs.filter(spec => spec.name !== 'timeline.export')
    expect(edits.every(spec => spec.outputs.length === 0 && spec.resource === 'none')).toBe(true)
    for (const name of OPERATIONS) expect(fixture.ctx.tools.get(`dv_${name.replace('.', '_')}`)).toBeDefined()
    expect(fixture.ctx.dvProject.getState(fixture.project).components.timeline).toEqual({ timelines: [] })
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-timeline.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'timeline')).toEqual([])
    expect(fixture.ctx.tools.get('dv_timeline_clip_move')).toBeUndefined()
    expect(fixture.ctx.dvProject.getState(fixture.project).components).not.toHaveProperty('timeline')
  })

  it('records the agent\'s timeline edits at the end of the project\'s history and folds them into the timeline slice', async () => {
    const fixture = await start()
    const created = value(await fixture.call('dv_timeline_create', { reason: 'lay out', name: '开场', assets: ['a1', 'a2', 'a3'] }))
    expect(created).toMatchObject({ status: 'done', summary: 'timeline of 3 clips', outputs: [], scheduled: [] })
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(created.record))
    expect(record).toMatchObject({
      actor: 'agent', component: 'timeline', operation: 'timeline.create', operation_version: '2', session: 's1',
      params: { name: '开场', assets: ['a1', 'a2', 'a3'] }, inputs: [], outputs: [], status: 'done', report: { clips: ['cl1', 'cl2', 'cl3'] },
    })
    const moved = value(await fixture.call('dv_timeline_clip_move', { reason: 'open on the kite', clip: 'cl3', to: 1 }))
    expect(moved.summary).toBe('clip cl3 moved to 1')
    expect(value(await fixture.call('dv_timeline_clip_trim', { reason: 'tighten', clip: 'cl3', in_sec: 0.5, out_sec: 2 })).summary)
      .toBe('clip cl3 trimmed')
    const split = value(await fixture.call('dv_timeline_clip_split', { reason: 'cut', clip: 'cl1', at_sec: 1 }))
    expect([split.summary, split.report]).toEqual(['clip cl1 split at 1s', { clips: ['cl4'] }])
    expect(value(await fixture.call('dv_timeline_clip_remove', { reason: 'drop', clip: 'cl2' })).summary).toBe('clip cl2 removed')
    expect(value(await fixture.call('dv_timeline_clip_replace', { reason: 'swap', clip: 'cl1', asset: 'b1' })).summary).toBe('clip cl1 replaced')
    expect(value(await fixture.call('dv_timeline_clip_insert', { reason: 'add', at: 4, asset: 'b2' })).summary).toBe('clip cl5 inserted at 4')
    expect(value(await fixture.call('dv_timeline_create', { reason: 'second', timeline: 't2', assets: [] })).summary).toBe('t2 timeline of 0 clips')
    expect(value(await fixture.call('dv_timeline_rename', { reason: 'name it', timeline: 't2', name: '片尾' })).summary).toBe('t2 renamed to 片尾')
    const timelines = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    expect(timelines.map(timeline => [timeline.id, timeline.name])).toEqual([['t1', '开场'], ['t2', '片尾']])
    expect(timelines[0]?.clips).toEqual([
      { id: 'cl3', asset: 'a3', source: null, in_sec: 0.5, out_sec: 2 }, { id: 'cl1', asset: 'b1', source: null, in_sec: null, out_sec: null },
      { id: 'cl4', asset: 'a1', source: null, in_sec: 1, out_sec: null }, { id: 'cl5', asset: 'b2', source: null, in_sec: null, out_sec: null },
    ])
    expect(value(await fixture.call('dv_timeline_delete', { reason: 'not needed', timeline: 't2' })).summary).toBe('t2 deleted')
    expect(fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines.map(timeline => timeline.id)).toEqual(['t1'])
  })

  it('records the human\'s edits, replaces clips with timeline.update, and assembles a create from clip inputs', async () => {
    const fixture = await start()
    const create = await fixture.run('timeline.create', { assets: ['a1'] })
    expect(create).toMatchObject({ actor: 'user', surface: 'timeline', operation: 'timeline.create', status: 'done' })
    await fixture.run('timeline.clip_insert', { at: 1, asset: 'a0' })
    const clips = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.clips
      .map(clip => [clip.id, clip.asset])
    expect(clips()).toEqual([['cl2', 'a0'], ['cl1', 'a1']])
    // create only creates; update replaces every clip of an existing timeline with clips that get new IDs.
    expect(await fixture.run('timeline.create', { assets: ['b1'] })).toMatchObject({
      status: 'failed', error: { message: 'Timeline t1 exists; call dv_timeline_update to replace its clips.' },
    })
    const update = await fixture.run('timeline.update', { timeline: 't1', assets: ['b1', 'b2'] })
    expect(update).toMatchObject({ status: 'done', report: { clips: ['cl3', 'cl4'] } })
    expect(clips()).toEqual([['cl3', 'b1'], ['cl4', 'b2']])
    expect(fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.name).toBe('')
    expect(await fixture.run('timeline.update', { timeline: 't2', assets: [] })).toMatchObject({
      status: 'failed', error: { message: 'Timeline t2 does not exist.' },
    })
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.update')
    expect(spec?.summarize({ ...update, params: { timeline: 't1' }, inputs: [{ role: 'clip', ref: { record: create.id, output: 0 }, resolved_asset: null }] }))
      .toBe('t1 timeline updated (1 clips)')
  })

  it('fails a call whose timeline or clip does not exist, and refuses invalid params before any record', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1', 'a2'] })
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['timeline.rename', { timeline: 't9', name: 'x' }, 'Timeline t9 does not exist.'],
      ['timeline.delete', { timeline: 't9' }, 'Timeline t9 does not exist.'],
      ['timeline.clip_insert', { at: 4, asset: 'a3' }, 'Timeline t1 has 2 clips; position 4 is not between 1 and 3.'],
      ['timeline.clip_move', { clip: 'cl1', to: 3 }, 'Timeline t1 has 2 clips; position 3 is not between 1 and 2.'],
      ['timeline.clip_remove', { clip: 'cl9' }, 'Clip cl9 does not exist.'],
      ['timeline.clip_split', { clip: 'cl1', at_sec: 0 }, 'Clip cl1 of timeline t1 does not play 0s of its asset; split inside its in and out points.'],
      ['timeline.clip_trim', { clip: 'cl2', in_sec: 3, out_sec: 1 }, 'The out point 1s is not after the in point 3s.'],
      ['timeline.clip_replace', { clip: 'cl3', asset: 'a3' }, 'Clip cl3 does not exist.'],
    ]
    for (const [operation, params, message] of cases) {
      expect(await fixture.run(operation, params)).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message } })
    }
    // A failed call changes nothing; repeating it fails again because the check runs on every call.
    expect(fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.clips).toHaveLength(2)
    expect(await fixture.run('timeline.clip_remove', { clip: 'cl9' })).toMatchObject({ status: 'failed' })
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before + cases.length + 1)
    await expect(fixture.run('timeline.clip_move', { clip: 'cl1' })).rejects.toMatchObject({ code: 'invalid_params' })
    await expect(fixture.run('timeline.clip_split', { clip: 1, at_sec: 1 })).rejects.toMatchObject({ code: 'invalid_params' })
    await expect(fixture.run('timeline.update', { assets: [] })).rejects.toMatchObject({ code: 'invalid_params' })
    expect(failure(await fixture.call('dv_timeline_rename', { reason: 'no name', timeline: 't1' }))).toContain('name')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before + cases.length + 1)
  })

  it('adds, removes and renames sounds and sound tracks from the agent\'s and the human\'s calls', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const song = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('song'), { mime: 'audio/mpeg', name: 'song.mp3' }, null)
    const voice = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('voice'), { mime: 'audio/wav', name: 'voice.wav' }, null)
    const added = value(await fixture.call('dv_timeline_sound_add', { reason: 'score', timeline: 't1', asset: song, start_sec: 1.5 }))
    expect([added.summary, added.report]).toEqual(['t1 sound sd1 added at 1.5s', { sounds: ['sd1'] }])
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(added.record))
    expect(record).toMatchObject({ actor: 'agent', operation: 'timeline.sound_add', operation_version: '1', status: 'done' })
    expect(await fixture.run('timeline.sound_add', { timeline: 't1', asset: voice, start_sec: 0, track: 1 }))
      .toMatchObject({ status: 'done', report: { sounds: ['sd2'] } })
    const timeline = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]
    expect(timeline()).toMatchObject({
      sounds: [{ id: 'sd1', asset: song, start_sec: 1.5, track: 0 }, { id: 'sd2', asset: voice, start_sec: 0, track: 1 }],
      sound_track_names: [], video_muted: false, muted_sound_tracks: [], track_clips: [], muted_video_tracks: [], track_order: ['sound', 'sound'],
    })
    expect(value(await fixture.call('dv_timeline_sound_track_rename', { reason: 'label', timeline: 't1', track: 1, name: 'Voice' })).summary)
      .toBe('t1 sound track 1 renamed to Voice')
    expect(value(await fixture.call('dv_timeline_sound_remove', { reason: 'too loud', sound: 'sd1' })).summary).toBe('sound sd1 removed')
    expect(value(await fixture.call('dv_timeline_sound_track_remove', { reason: 'empty', timeline: 't1', track: 0 })).summary).toBe('t1 sound track 0 deleted')
    expect(timeline()).toMatchObject({ sounds: [{ id: 'sd2', track: 0 }], sound_track_names: ['Voice'] })
    // A summary of a record that has not stored its sound ID yet names no sound.
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.sound_add')
    expect(spec?.summarize({ ...record, params: { timeline: 't1', start_sec: 2 }, report: {} })).toBe('t1 sound  added at 2s')
  })

  it('splits a sound from the agent\'s call into two sounds of the same asset, the second with a new sound ID', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const song = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('song'), { mime: 'audio/mpeg', name: 'song.mp3' }, null)
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 1 })
    const split = value(await fixture.call('dv_timeline_sound_split', { reason: 'cut the intro', sound: 'sd1', at_sec: 2 }))
    expect([split.summary, split.report]).toEqual(['sound sd1 split at 2s', { sounds: ['sd2'] }])
    expect(fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.sounds).toEqual([
      { id: 'sd1', asset: song, in_sec: null, out_sec: 2, start_sec: 1, track: 0 },
      { id: 'sd2', asset: song, in_sec: 2, out_sec: null, start_sec: 3, track: 0 },
    ])
    expect(failure(await fixture.call('dv_timeline_sound_split', { reason: 'again', sound: 'sd2', at_sec: 1 })))
      .toContain('Sound sd2 does not play 1s of its asset; split inside its in and out points.')
    // An asset whose length is known refuses a split or a trim past its end.
    const short = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('short'), { mime: 'audio/mpeg', name: 'short.mp3', durationSec: 5 }, null)
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: short, start_sec: 0 })
    expect(failure(await fixture.call('dv_timeline_sound_split', { reason: 'cut', sound: 'sd3', at_sec: 40 })))
      .toContain('Sound sd3 does not play 40s of its asset; split inside its in and out points.')
    expect(failure(await fixture.call('dv_timeline_sound_trim', { reason: 'cut', sound: 'sd3', in_sec: 8 })))
      .toContain(`The in point 8s is not before the end of asset ${short} (5s).`)
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.sound_split')
    expect([spec?.label, spec?.description]).toEqual([
      { zh: '拆分声音', en: 'Split sound' },
      'Split one sound in two at a time inside its audio asset (seconds from the asset\'s start, not from the timeline\'s start). '
      + 'Both parts play the same asset where the sound played: the first keeps the sound ID and ends at at_sec, the second gets '
      + 'a new sound ID and starts there. No file is created.',
    ])
  })

  it('moves a sound to another time and sound track and trims it from the agent\'s calls', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const song = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('song'), { mime: 'audio/mpeg', name: 'song.mp3' }, null)
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 1 })
    const call = async (tool: string, args: Record<string, unknown>): Promise<string> => value(await fixture.call(tool, { reason: 'fit', ...args })).summary
    expect(await call('dv_timeline_sound_move', { sound: 'sd1', start_sec: 2.5, track: 1 })).toBe('sound sd1 moved to 2.5s on sound track 1')
    expect(await call('dv_timeline_sound_move', { sound: 'sd1', start_sec: 3 })).toBe('sound sd1 moved to 3s')
    expect(await call('dv_timeline_sound_trim', { sound: 'sd1', in_sec: 0.5, out_sec: 2 })).toBe('sound sd1 trimmed')
    const [timeline] = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    expect([timeline?.sounds, timeline?.track_order]).toEqual([
      [{ id: 'sd1', asset: song, in_sec: 0.5, out_sec: 2, start_sec: 3.5, track: 1 }], ['sound', 'sound'],
    ])
    expect(failure(await fixture.call('dv_timeline_sound_move', { reason: 'fit', sound: 'sd1', start_sec: 0, track: 3 })))
      .toContain('Timeline t1 has no sound track 3; it has 2.')
    const specs = fixture.ctx.dvProject.listOperations().filter(entry => ['timeline.sound_move', 'timeline.sound_trim'].includes(entry.name))
    expect(specs.map(spec => [spec.label, spec.description])).toEqual([
      [{ zh: '移动声音', en: 'Move sound' }, 'Move one sound to another start time, and with track to another sound track: an existing track or '
        + 'the one after the last. Sounds may overlap.'],
      [{ zh: '裁剪声音', en: 'Trim sound' }, 'Set the in and out points of a sound (seconds inside its audio asset); no file is created. A '
        + 'missing point means the asset\'s start or end. Moving the in point moves the sound\'s start by the same amount, so the rest '
        + 'plays where it did.'],
    ])
  })

  it('mutes and unmutes the clips\' own audio and a sound track from the agent\'s calls, and refuses a mute that does not apply', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const mute = async (args: Record<string, unknown>): Promise<string> =>
      value(await fixture.call('dv_timeline_mute', { reason: 'replace the music', timeline: 't1', ...args })).summary
    expect(await mute({ target: 'video', muted: true })).toBe('t1 video audio muted')
    expect(await mute({ target: 'sound', track: 1, muted: true })).toBe('t1 sound track 1 muted')
    const timeline = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]
    expect(timeline()).toMatchObject({ video_muted: true, muted_sound_tracks: [1] })
    expect(await mute({ target: 'sound', track: 1, muted: false })).toBe('t1 sound track 1 unmuted')
    expect(await mute({ target: 'video', muted: false })).toBe('t1 video audio unmuted')
    // Sound track 1 stays after the unmute, empty, until a removal deletes it.
    expect(timeline()).toMatchObject({ video_muted: false, muted_sound_tracks: [], track_clips: [], muted_video_tracks: [], track_order: ['sound', 'sound'] })
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ timeline: 't1', target: 'sound', track: 3, muted: true }, 'Timeline t1 has no sound track 3; it has 2.'],
      [{ timeline: 't1', target: 'sound', muted: true }, 'track undefined is not a track number of 0 or more.'],
      [{ timeline: 't9', target: 'video', muted: true }, 'Timeline t9 does not exist.'],
    ]
    for (const [params, message] of cases) {
      expect(await fixture.run('timeline.mute', params)).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message } })
    }
    await expect(fixture.run('timeline.mute', { timeline: 't1', target: 'audio', muted: true })).rejects.toMatchObject({ code: 'invalid_params' })
    await expect(fixture.run('timeline.mute', { timeline: 't1', target: 'video' })).rejects.toMatchObject({ code: 'invalid_params' })
  })

  it('puts a timeline on the canvas once with dv_timeline_place while the canvas is loaded, and an undo takes the node off', async () => {
    expect((await start()).ctx.tools.get('dv_timeline_place')).toBeUndefined()
    const fixture = await start({ canvas: true })
    await fixture.run('timeline.create', { assets: ['a1'] })
    await fixture.run('timeline.create', { timeline: 't2', assets: [] })
    const placed = value(await fixture.call('dv_timeline_place', { reason: 'show the cut', timeline: 't1' }))
    expect(placed.summary).toBe('t1 placed on the canvas')
    const canvas = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.canvas
    expect(canvas()).toMatchObject({
      order: [placed.record], nodes: { [placed.record]: { kind: 'timeline', versions: [placed.record], position: { x: 720, y: 0 } } },
    })
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ timeline: 't1' }, `Timeline t1 is already on the canvas as node ${placed.record}.`],
      [{ timeline: 't9' }, 'Timeline t9 does not exist.'],
    ]
    for (const [params, message] of cases) {
      await expect(fixture.run('timeline.place', params)).rejects.toMatchObject({ code: 'invalid_params', message })
    }
    const second = await fixture.run('timeline.place', { timeline: 't2' })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.canvas.order).toEqual([placed.record, second.id])
    await fixture.ctx.dvProject.undo(fixture.project)
    expect(fixture.ctx.dvProject.getState(fixture.project).components.canvas.order).toEqual([placed.record])
    // A timeline whose node was removed goes on the canvas again as a new node.
    await fixture.run('canvas.node_remove', { nodes: [placed.record] })
    const again = await fixture.run('timeline.place', { timeline: 't1' })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.canvas.order).toEqual([again.id])
  })

  it('describes timeline.place to the agent', async () => {
    const fixture = await start({ canvas: true })
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.place')
    expect(spec?.label).toEqual({ zh: '把时间线放到画布上', en: 'Place timeline on canvas' })
    expect(spec?.description).toBe('Put a timeline on the canvas as one node. The node shows the timeline\'s picture and tracks in '
      + 'small, with a line from each node whose output the timeline plays; selecting the node outlines those nodes. A timeline goes '
      + 'on the canvas once, and its node stays until dv_canvas_node_remove takes it off. Works whether or not the user has a canvas '
      + 'open. The change is a step of the project history, so dv_proj_undo reverts it.')
    expect(spec?.params['timeline']?.description).toBe('The timeline, such as t1 (see `timelines` in dv_proj_state).')
  })

  it('describes the sound operations to the agent: the tracks a sound may go on and where the sound IDs are listed', async () => {
    const fixture = await start()
    const spec = (name: string): OperationSpec | undefined => fixture.ctx.dvProject.listOperations().find(entry => entry.name === name)
    expect(spec('timeline.sound_add')?.params['track']?.description)
      .toBe('The sound track, 0 (default) for the first; an existing track or the one after the last (see `sound_tracks` in dv_proj_state).')
    expect(spec('timeline.sound_remove')?.description).toBe('Remove a sound from its timeline. The audio asset stays in the project.')
    expect(spec('timeline.sound_remove')?.params['sound']?.description)
      .toBe('The sound ID, such as sd2 (see `sounds` of `timelines` in dv_proj_state).')
    expect(spec('timeline.sound_track_rename')?.description)
      .toBe('Name one sound track of a timeline: an existing track or the one after the last. An empty name clears the name.')
    expect(spec('timeline.mute')?.description).toBe(
      'Mute or unmute audio of a timeline. Target `video` is the own audio of the main video track\'s clips, and target `video_track` '
      + 'that of one video track under it: while it is muted, the user hears those clips silent when playing the timeline, and the '
      + 'exported video leaves their audio out. Target `sound` is one sound track: while it is muted, the user does not hear its '
      + 'sounds when playing the timeline (the exported video does not include sounds yet).',
    )
    expect(spec('timeline.mute')?.label).toEqual({ zh: '静音或取消静音', en: 'Mute or unmute' })
  })

  it('adds an empty video track and sound track from the agent\'s calls, at the bottom of the timeline\'s tracks', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const add = async (kind: string): Promise<string> =>
      value(await fixture.call('dv_timeline_track_add', { reason: 'the user asked for a track', timeline: 't1', kind })).summary
    expect([await add('video'), await add('sound')]).toEqual(['t1 video track added', 't1 sound track added'])
    expect(fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.track_order).toEqual(['sound', 'video', 'sound'])
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.track_add')
    expect([spec?.label, spec?.description]).toEqual([
      { zh: '添加轨道', en: 'Add track' },
      'Add an empty video track or sound track to a timeline, under all its tracks. Adding a clip or a sound to the track after the '
      + 'last also adds a track, so call this only for an empty track.',
    ])
  })

  it('moves a video track from the agent\'s call, so it covers the tracks after its new number', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    await fixture.call('dv_timeline_track_add', { reason: 'layers', timeline: 't1', kind: 'video' })
    const clip = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('clip'), { mime: 'video/mp4', name: 'clip.mp4', durationSec: 2 }, null)
    value(await fixture.call('dv_timeline_track_clip_add', { reason: 'layers', timeline: 't1', asset: clip, track: 1, start_sec: 0 }))
    const moved = value(await fixture.call('dv_timeline_video_track_move', { reason: 'put it on top', timeline: 't1', track: 1, to: 0 }))
    expect(moved.summary).toBe('t1 video track 1 moved to 0')
    const [timeline] = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    expect(timeline?.track_clips.map(clip => clip.track)).toEqual([0])
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.video_track_move')
    expect([spec?.label, spec?.description]).toEqual([
      { zh: '移动视频轨', en: 'Move video track' },
      'Move one video track under the main video track to another number, with its clips and its mute. A track with a lower number '
      + 'covers the tracks with higher numbers after the main track ends; the tracks between the two numbers move one number toward '
      + 'the old one. The main video track covers them all; dv_timeline_main_track_swap swaps it with track 0.',
    ])
  })

  it('swaps the main video track with video track 0 from the agent\'s call, placing its clips at the times they played', async () => {
    const fixture = await start()
    const clip = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('clip'), { mime: 'video/mp4', name: 'clip.mp4', durationSec: 2 }, null)
    const other = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('other'), { mime: 'video/mp4', name: 'other.mp4' }, null)
    await fixture.run('timeline.create', { assets: [clip, clip] })
    value(await fixture.call('dv_timeline_track_clip_add', { reason: 'layers', timeline: 't1', asset: clip, track: 0, start_sec: 5 }))
    const swapped = value(await fixture.call('dv_timeline_main_track_swap', { reason: 'put it on top', timeline: 't1' }))
    expect([swapped.summary, swapped.report]).toEqual(['t1 main video track swapped with video track 0', { starts: [0, 2] }])
    const [timeline] = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    expect([timeline?.clips.map(each => each.id), timeline?.track_clips.map(each => `${each.id} ${String(each.start_sec)}`)]).toEqual([['cl3'], ['cl1 0', 'cl2 2']])
    // A clip whose asset length is not known has no time on a video track.
    await fixture.run('timeline.clip_insert', { timeline: 't1', at: 1, asset: other })
    expect(failure(await fixture.call('dv_timeline_main_track_swap', { reason: 'again', timeline: 't1' })))
      .toContain(`The length of asset ${other} is not known yet, so clip cl4 cannot go on a video track.`)
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.main_track_swap')
    expect([spec?.label, spec?.description]).toEqual([
      { zh: '对调主视频轨', en: 'Swap main video track' },
      'Swap the main video track with video track 0 under it, so the other one covers. The main track\'s clips go onto video track '
      + '0 at the times they play now; the clips of video track 0 become the main track\'s clips, one after another in the order of '
      + 'their start times, without the gaps between them. Both keep their clip IDs, and the two mutes swap. Refused while a clip of '
      + 'the main track is still rendering.',
    ])
  })

  it('deletes the main video track from the agent\'s call, so the first video track under it takes its place', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const clip = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('clip'), { mime: 'video/mp4', name: 'clip.mp4', durationSec: 2 }, null)
    value(await fixture.call('dv_timeline_track_clip_add', { reason: 'layers', timeline: 't1', asset: clip, track: 0, start_sec: 3 }))
    const removed = value(await fixture.call('dv_timeline_main_track_remove', { reason: 'drop the original', timeline: 't1' }))
    expect(removed.summary).toBe('t1 main video track deleted')
    const [timeline] = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    expect([timeline?.clips.map(each => each.asset), timeline?.track_clips]).toEqual([[clip], []])
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.main_track_remove')
    expect([spec?.label, spec?.description]).toEqual([
      { zh: '删除主视频轨', en: 'Delete main video track' },
      'Delete all clips of the main video track; video track 0 under it then becomes the main video track. Its clips play one '
      + 'after another in the order of their start times, without the gaps between them, and keep their clip IDs; its mute '
      + 'becomes the mute of the main track\'s own audio, and every other video track moves up one number. Without video tracks, '
      + 'the main video track stays empty. The assets stay.',
    ])
  })

  it('refuses a sound of an asset that is not audio, and a sound call that does not apply, before it changes the timeline', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const still = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('still'), { mime: 'image/png', name: 'still.png' }, null)
    const song = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('song'), { mime: 'audio/mpeg', name: 'song.mp3' }, null)
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['timeline.sound_add', { timeline: 't1', asset: still, start_sec: 0 }, `Asset ${still} is not an audio file.`],
      ['timeline.sound_add', { timeline: 't1', asset: song, start_sec: -2 }, 'start_sec -2 is not a time of 0 seconds or more.'],
      ['timeline.sound_add', { timeline: 't1', asset: song, start_sec: 0, track: -1 }, 'track -1 is not a track number of 0 or more.'],
      ['timeline.sound_add', { timeline: 't9', asset: song, start_sec: 0 }, 'Timeline t9 does not exist.'],
      ['timeline.sound_remove', { sound: 'sd9' }, 'Sound sd9 does not exist.'],
      ['timeline.sound_track_remove', { timeline: 't9', track: 0 }, 'Timeline t9 does not exist.'],
      ['timeline.sound_track_rename', { timeline: 't1', track: -1, name: 'x' }, 'track -1 is not a track number of 0 or more.'],
      // A new timeline has one empty sound track, and takes a new sound or a name on tracks 0 and 1.
      ['timeline.sound_add', { timeline: 't1', asset: song, start_sec: 0, track: 2 }, 'Timeline t1 has no sound track 2; it has 1.'],
      ['timeline.sound_track_remove', { timeline: 't1', track: 1 }, 'Timeline t1 has no sound track 1; it has 1.'],
      ['timeline.sound_track_rename', { timeline: 't1', track: 2, name: 'x' }, 'Timeline t1 has no sound track 2; it has 1.'],
    ]
    for (const [operation, params, message] of cases) {
      expect(await fixture.run(operation, params)).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message } })
    }
    expect(fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0])
      .toMatchObject({ sounds: [], sound_track_names: [] })
    await expect(fixture.run('timeline.sound_add', { timeline: 't1', asset: song })).rejects.toMatchObject({ code: 'invalid_params' })
    await expect(fixture.run('timeline.sound_track_rename', { timeline: 't1', track: 0 })).rejects.toMatchObject({ code: 'invalid_params' })
    // A refused sound_add assigns no sound ID.
    expect(await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 0 })).toMatchObject({ report: { sounds: ['sd1'] } })
  })

  it('puts videos on the video tracks under the main one, and refuses a non-video added or swapped in, an unknown length and an overlap', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const pool = fixture.ctx.dvAssetPool
    const video = (name: string, durationSec?: number): string => pool.importAsset(
      fixture.project, Buffer.from(name), { mime: 'video/mp4', name, ...durationSec === undefined ? {} : { durationSec } }, null,
    )
    const four = video('four.mp4', 4)
    const two = video('two.mp4', 2)
    const unknown = video('unknown.mp4')
    const still = pool.importAsset(fixture.project, Buffer.from('still'), { mime: 'image/png', name: 'still.png' }, null)
    const added = value(await fixture.call('dv_timeline_track_clip_add', { reason: 'cut in', timeline: 't1', asset: four, track: 0, start_sec: 1 }))
    expect(added.summary).toBe('t1 clip cl2 added to video track 0 at 1s')
    expect((await fixture.run('timeline.track_clip_add', { timeline: 't1', asset: two, track: 0, start_sec: 5 })).status).toBe('done')
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['timeline.track_clip_add', { timeline: 't1', asset: still, track: 0, start_sec: 9 }, `Asset ${still} is not a video.`],
      ['timeline.track_clip_add', { timeline: 't1', asset: unknown, track: 1, start_sec: 0 },
        `The length of asset ${unknown} is not known yet, so the new clip cannot go on a video track.`],
      ['timeline.track_clip_add', { timeline: 't1', asset: two, track: 0, start_sec: 4 },
        'The new clip would overlap clip cl2 on video track 0 (1s to 5s); pick another start_sec or track.'],
      ['timeline.track_clip_move', { clip: 'cl3', start_sec: 2 }, 'Clip cl3 would overlap clip cl2 on video track 0 (1s to 5s); pick another start_sec or track.'],
      ['timeline.clip_trim', { clip: 'cl2', in_sec: 0, out_sec: 4.5 }, 'Clip cl2 would overlap clip cl3 on video track 0 (5s to 7s); pick another start_sec or track.'],
      ['timeline.clip_replace', { clip: 'cl2', asset: unknown }, `The length of asset ${unknown} is not known yet, so clip cl2 cannot go on a video track.`],
      ['timeline.clip_replace', { clip: 'cl2', asset: still }, `Asset ${still} is not a video.`],
      ['timeline.track_clip_add', { timeline: 't1', asset: two, track: 2, start_sec: 0 }, 'Timeline t1 has no video track 2; it has 1 under the main video track.'],
    ]
    for (const [operation, params, message] of cases) {
      expect(await fixture.run(operation, params)).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message } })
    }
    // A move to another track and a trim that keeps clear of the next clip apply.
    expect(value(await fixture.call('dv_timeline_track_clip_move', { reason: 'later', clip: 'cl3', start_sec: 6 })).summary).toBe('clip cl3 moved to 6s')
    expect(value(await fixture.call('dv_timeline_track_clip_move', { reason: 'lower', clip: 'cl3', start_sec: 2, track: 1 })).summary)
      .toBe('clip cl3 moved to 2s on video track 1')
    expect((await fixture.run('timeline.clip_trim', { clip: 'cl2', in_sec: 1, out_sec: 3 })).status).toBe('done')
    expect(value(await fixture.call('dv_timeline_mute', { reason: 'quiet', timeline: 't1', target: 'video_track', track: 1, muted: true })).summary)
      .toBe('t1 video track 1 muted')
    const timeline = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]
    expect(timeline()).toMatchObject({
      track_clips: [
        { id: 'cl2', asset: four, track: 0, start_sec: 2, in_sec: 1, out_sec: 3 },
        { id: 'cl3', asset: two, track: 1, start_sec: 2, in_sec: null, out_sec: null },
      ],
      muted_video_tracks: [1],
    })
    expect(value(await fixture.call('dv_timeline_video_track_remove', { reason: 'drop', timeline: 't1', track: 0 })).summary).toBe('t1 video track 0 deleted')
    expect(timeline()).toMatchObject({ track_clips: [{ id: 'cl3', track: 0 }], muted_video_tracks: [0] })
  })

  it('keeps sound IDs unique across an undo and across calls that run at the same time', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1'] })
    const song = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('song'), { mime: 'audio/mpeg', name: 'song.mp3' }, null)
    expect(await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 0 })).toMatchObject({ report: { sounds: ['sd1'] } })
    await fixture.ctx.dvProject.undo(fixture.project)
    // The undone record stays in the history, so its sound ID is never assigned again.
    expect(await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 1 })).toMatchObject({ report: { sounds: ['sd2'] } })
    const both = await Promise.all([1, 2].map(start_sec => fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec })))
    expect(both.map(entry => entry.report?.['sounds']).flat().sort()).toEqual(['sd3', 'sd4'])
    const sounds = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.sounds.map(sound => sound.id)
    expect(sounds?.sort()).toEqual(['sd2', 'sd3', 'sd4'])
    // A stored ID that is not sd<n> or cl<n> does not change the numbering.
    fixture.ctx.dvProject.registerOperation({
      name: 'timeline.stand_in', component: 'timeline', version: '1', description: 'stand-in', params: {}, inputs: {}, outputs: [],
      deterministic: false, resource: 'none', summarize: () => 'stand-in',
      execute: () => Promise.resolve({ outputs: [], report: { clips: ['clip-9'], sounds: ['sound-9'] } }),
    })
    expect(await fixture.run('timeline.stand_in', {})).toMatchObject({ status: 'done', report: { sounds: ['sound-9'] } })
    expect(await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 0 })).toMatchObject({ report: { sounds: ['sd5'] } })
    expect(await fixture.run('timeline.clip_insert', { at: 1, asset: 'a2' })).toMatchObject({ report: { clips: ['cl2'] } })
  })

  it('keeps clip IDs unique across an undo, and a discarded insert does not come back', async () => {
    const fixture = await start()
    await fixture.run('timeline.create', { assets: ['a1', 'a2'] })
    // The agent adds a clip, the human undoes it and adds another; the project-wide numbering gives them different IDs.
    const added = value(await fixture.call('dv_timeline_clip_insert', { reason: 'add', at: 3, asset: 'd1' }))
    expect(added.report).toEqual({ clips: ['cl3'] })
    await fixture.ctx.dvProject.undo(fixture.project)
    expect(await fixture.run('timeline.clip_insert', { at: 3, asset: 'm1' })).toMatchObject({ report: { clips: ['cl4'] } })
    const clips = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.clips
      .map(clip => [clip.id, clip.asset])
    expect(clips()).toEqual([['cl1', 'a1'], ['cl2', 'a2'], ['cl4', 'm1']])
    // The human's insert discarded the agent's insert, so the project cannot go back to it.
    await expect(fixture.ctx.dvProject.moveTo(fixture.project, brandString<RecordId>(added.record))).rejects.toMatchObject({ code: 'invalid_params' })
  })

  it('lays out a render that is not done as a placeholder clip that becomes ready when the render is done', async () => {
    const fixture = await start()
    const renders = [gate(), gate()]
    const render = (index: number): Promise<RunResult> => fixture.ctx.dvProject.run({
      actor: 'user', surface: 'timeline', session: null, turn: null, tool_call: null, intent: 'render', project: fixture.project,
      operation: 'shot.render', params: { shot: index }, inputs: [],
    })
    fixture.ctx.dvProject.registerComponent('shot')
    fixture.ctx.dvProject.registerOperation({
      name: 'shot.render', component: 'shot', version: '1', description: 'stand-in', params: {}, inputs: {},
      outputs: [{ role: 'video', type: 'video' }], deterministic: false, resource: 'none', summarize: () => 'stand-in',
      execute: async (context) => {
        const index = Number(context.params['shot'])
        await renders[index]?.promise
        if (index === 1) throw new Error('The renderer ran out of memory.')
        return { outputs: [context.importAsset(Buffer.from('take'), { mime: 'video/mp4', name: 'take.mp4' })] }
      },
    })
    const running = [render(0), render(1)]
    // The history lists the newest record first.
    const [first, second] = await vi.waitFor(() => {
      const found = fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'shot.render' }).map(entry => entry.record.id)
      expect(found).toHaveLength(2)
      return found.reverse()
    })
    if (first === undefined || second === undefined) throw new Error('the renders wrote no records')

    // The create is done at once with one placeholder clip per render; trim and split refuse a placeholder.
    const inputs = [first, second].map(record => ({ role: 'clip', ref: { record, output: 0 } }))
    expect(await fixture.run('timeline.create', {}, inputs)).toMatchObject({ status: 'done', report: { clips: ['cl1', 'cl2'] } })
    const clips = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0]?.clips
      .map(clip => [clip.id, clip.asset === null ? null : 'ready', clip.source?.record])
    expect(clips()).toEqual([['cl1', null, first], ['cl2', null, second]])
    expect(await fixture.run('timeline.clip_trim', { clip: 'cl1', in_sec: 1 })).toMatchObject({
      status: 'failed', error: { message: 'Clip cl1 is still rendering.' },
    })
    expect(await fixture.run('timeline.clip_split', { clip: 'cl2', at_sec: 1 })).toMatchObject({
      status: 'failed', error: { message: 'Clip cl2 is still rendering.' },
    })

    // A done render fills its clip; a failed render leaves its clip a placeholder and the timeline in place.
    for (const held of renders) held.resolve()
    await Promise.all(running)
    expect(clips()).toEqual([['cl1', 'ready', first], ['cl2', null, second]])
    expect(fixture.ctx.dvProject.getRecord(fixture.project, second).status).toBe('failed')
  })

  it('keeps a placeholder clip laid out while the render runs and fills it when the render is done, after an undo too', async () => {
    const fixture = await start()
    const held = gate()
    fixture.ctx.dvProject.registerComponent('shot')
    fixture.ctx.dvProject.registerOperation({
      name: 'shot.render', component: 'shot', version: '1', description: 'stand-in', params: {}, inputs: {},
      outputs: [{ role: 'video', type: 'video' }], deterministic: false, resource: 'none', summarize: () => 'stand-in',
      execute: async (context) => {
        await held.promise
        return { outputs: [context.importAsset(Buffer.from('take'), { mime: 'video/mp4', name: 'take.mp4' })] }
      },
    })
    const running = fixture.ctx.dvProject.run({
      actor: 'user', surface: 'timeline', session: null, turn: null, tool_call: null, intent: 'render', project: fixture.project,
      operation: 'shot.render', params: {}, inputs: [],
    })
    const render = await vi.waitFor(() => {
      const [found] = fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'shot.render' })
      if (found === undefined) throw new Error('the render wrote no record')
      return found.record.id
    })
    // The agent lays the render out while it runs; the human undoes that, then redoes it.
    const laidOut = value(await fixture.call('dv_timeline_create', { reason: 'lay out', inputs: { clip: [`${render}#0`] } }))
    expect(laidOut).toMatchObject({ status: 'done', scheduled: [], report: { clips: ['cl1'] } })
    const timelines = (): Array<{ id: string; clips: unknown[] }> =>
      fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    const t1 = (): unknown => timelines().find(entry => entry.id === 't1')?.clips
    expect(t1()).toEqual([{ id: 'cl1', asset: null, source: { record: render, output: 0 }, in_sec: null, out_sec: null }])
    await fixture.ctx.dvProject.undo(fixture.project)
    expect(timelines()).toEqual([])
    await fixture.ctx.dvProject.redo(fixture.project)
    expect(fixture.ctx.dvProject.getState(fixture.project).head).toBe(laidOut.record)
    held.resolve()
    await running
    const [take] = fixture.ctx.dvProject.getRecord(fixture.project, render).outputs
    expect(t1()).toEqual([{ id: 'cl1', asset: take, source: { record: render, output: 0 }, in_sec: null, out_sec: null }])
    expect(timelines().map(entry => entry.id)).toEqual(['t1'])
  })
})
