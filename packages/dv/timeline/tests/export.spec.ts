/**
 * The `timeline.export` operation in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, the asset
 * pool, `dvProject`, `dvFfmpeg` and `dvTimeline` through the Loader. Real ffmpeg trims and joins the clips of a
 * timeline; the agent's `dv_timeline_export` call and a direct `dvProject.run` call both write a `timeline.export`
 * record whose output is the joined video.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import DvFfmpeg, { FfmpegError } from '@dv/ffmpeg'
import DvProject, { type AssetId, type OperationToolValue, type ProjectId, type RecordId, type RunResult } from '@dv/project'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import DvTimeline, { type Timeline } from '../src/index.ts'

const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvAssetPool, DvProject, DvFfmpeg, DvTimeline }

interface Fixture {
  ctx: Context
  dir: string
  project: ProjectId
  /** Write a solid-color test video with ffmpeg and import it into the asset pool with its duration. */
  clip(color: string, size: string, seconds: number): Promise<AssetId>
  /** Run one operation as the user on the timeline surface. */
  run(operation: string, params: Record<string, unknown>): Promise<RunResult>
  /** Run one tool as the agent of chat session `s1`, which runs in the folder of `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-timeline-export-'))
  const globals = globalThis as typeof globalThis & { __dvTimelineExportComposition?: typeof PLUGINS }
  globals.__dvTimelineExportComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvTimelineExportComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, `ffprobePath: ${FFPROBE}`])
  row('dv-asset-pool', 'DvAssetPool', [])
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
  const origin = { actor: 'user' as const, surface: 'timeline' as const, session: null, turn: null, tool_call: null }
  const project = await chatProject(ctx.dvProject, services, 'export', { ...origin, intent: 'create' })
  let calls = 0
  let clips = 0
  return {
    ctx, dir, project,
    async clip(color, size, seconds) {
      clips += 1
      const name = `clip-${clips}.mp4`
      await ctx.dvFfmpeg.run({
        argv: ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=${seconds}:r=10`, '-pix_fmt', 'yuv420p', `{{out:${name}}}`],
        inputs: [], outputs: [name], dir,
      })
      return ctx.dvAssetPool.importAsset(project, { path: join(dir, name) }, { mime: 'video/mp4', name, durationSec: seconds }, null)
    },
    run: (operation, params) => ctx.dvProject.run({ project, operation, params, inputs: [], ...origin, intent: operation }),
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
  }
}

/** The value of a successful operation tool call. */
function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

describe('timeline.export', () => {
  it('registers timeline.export with its dv_timeline_export tool and removes both on disposal', async () => {
    const fixture = await start()
    const specs = fixture.ctx.dvProject.listOperations().filter(spec => spec.name === 'timeline.export')
    expect(specs.map(spec => [spec.component, spec.deterministic, spec.resource])).toEqual([['timeline', false, 'cpu']])
    expect(fixture.ctx.tools.schemas().find(tool => tool.name === 'dv_timeline_export')?.description).toBe(
      'Export a timeline to one video: each clip with an in or out point is trimmed to that range, the clips of the main video track '
      + 'are joined in timeline order, and the clips of the video tracks under it play after its end, a track with a lower number '
      + 'covering those with higher numbers, picture and audio. Muted audio (dv_timeline_mute) is left out. The sound tracks are not included yet. Runs on the CPU.',
    )
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-timeline.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.dvProject.listOperations().filter(spec => spec.name === 'timeline.export')).toEqual([])
    expect(fixture.ctx.tools.get('dv_timeline_export')).toBeUndefined()
  })

  it('fails the record for an unknown timeline, a project without timelines and an empty timeline, and refuses invalid params', async () => {
    const fixture = await start()
    const none = await fixture.run('timeline.export', {})
    expect(none.record).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message: 'The project has no timeline to export.' } })
    await fixture.run('timeline.create', { timeline: 't1', assets: [] })
    const unknown = await fixture.run('timeline.export', { timeline: 't9' })
    expect(unknown.record).toMatchObject({ status: 'failed', error: { message: 'Unknown timeline "t9".' } })
    const empty = await fixture.run('timeline.export', { timeline: 't1' })
    expect(empty.record).toMatchObject({ status: 'failed', error: { message: 'Timeline t1 has no clips to export.' } })
    const records = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.run('timeline.export', { timeline: 5 })).rejects.toMatchObject({ code: 'invalid_params' })
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(records)
  })

  it('refuses to export a timeline while a clip waits for its render, naming the clip positions', async () => {
    const fixture = await start()
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    fixture.ctx.dvProject.registerComponent('shot')
    fixture.ctx.dvProject.registerOperation({
      name: 'shot.render', component: 'shot', version: '1', description: 'stand-in', params: {}, inputs: {},
      outputs: [{ role: 'video', type: 'video' }], deterministic: false, resource: 'none', summarize: () => 'stand-in',
      execute: async (context) => {
        await held
        return { outputs: [context.importAsset(Buffer.from('take'), { mime: 'video/mp4', name: 'take.mp4' })] }
      },
    })
    const origin = { actor: 'user' as const, surface: 'timeline' as const, session: null, turn: null, tool_call: null, intent: 'test' }
    const renders = [fixture.ctx.dvProject.run({ ...origin, project: fixture.project, operation: 'shot.render', params: {}, inputs: [] })]
    renders.push(fixture.ctx.dvProject.run({ ...origin, project: fixture.project, operation: 'shot.render', params: {}, inputs: [] }))
    const pending = await vi.waitFor(() => {
      const found = fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'shot.render' }).map(entry => entry.record.id)
      expect(found).toHaveLength(2)
      return found
    })
    const ready = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('ready'), { mime: 'video/mp4', name: 'ready.mp4' }, null)
    await fixture.ctx.dvProject.run({
      ...origin, project: fixture.project, operation: 'timeline.create', params: { timeline: 't1' },
      inputs: [{ role: 'clip', ref: { asset: ready } }, ...pending.reverse().map(record => ({ role: 'clip', ref: { record, output: 0 } }))],
    })
    const records = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.run('timeline.export', { timeline: 't1' })).rejects.toThrow('Clips 2, 3 of timeline t1 are not ready yet.')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(records)
    const [timeline] = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    if (timeline === undefined) throw new Error('timeline t1 is missing')
    await expect(fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).rejects.toThrow('Clips 2, 3 of timeline t1')
    release()
    await Promise.all(renders)
  })

  it('trims and joins the clips without their audio while the timeline\'s video audio is muted, and with it otherwise', async () => {
    const fixture = await start()
    const clip = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('clip'), { mime: 'video/mp4', name: 'clip.mp4' }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [clip] })
    await fixture.run('timeline.clip_trim', { clip: 'cl1', in_sec: 0.5, out_sec: 1 })
    const argvs: Array<readonly string[]> = []
    vi.spyOn(fixture.ctx.dvFfmpeg, 'run').mockImplementation((request) => {
      argvs.push(request.argv)
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    const timeline = (): Timeline => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    await fixture.ctx.dvTimeline.exportTimeline(timeline(), fixture.dir)
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video', muted: true })
    await fixture.ctx.dvTimeline.exportTimeline(timeline(), fixture.dir)
    // Each export trims the clip and then joins it: whether each command leaves the audio out and whether it encodes AAC.
    expect(argvs.map(argv => [argv.includes('-an'), argv.includes('aac')])).toEqual([[false, true], [false, false], [true, false], [true, false]])
  })

  it.skipIf(!existsSync(FFMPEG))('exports a file with the clips\' audio, and a file without audio while the video audio is muted', async () => {
    const fixture = await start()
    const name = 'tone.mp4'
    await fixture.ctx.dvFfmpeg.run({
      argv: [
        'ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=2:r=10', '-f', 'lavfi', '-i', 'sine=d=2',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', `{{out:${name}}}`,
      ],
      inputs: [], outputs: [name], dir: fixture.dir,
    })
    const tone = fixture.ctx.dvAssetPool.importAsset(fixture.project, { path: join(fixture.dir, name) }, { mime: 'video/mp4', name }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [tone, tone] })
    await fixture.run('timeline.clip_trim', { clip: 'cl2', in_sec: 0.5, out_sec: 1.5 })
    const hasAudio = async (): Promise<boolean> => {
      const exported = await fixture.run('timeline.export', { timeline: 't1' })
      return (await fixture.ctx.dvFfmpeg.probe(fixture.ctx.dvAssetPool.path(exported.outputs[0] as AssetId))).hasAudio
    }
    expect(await hasAudio()).toBe(true)
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video', muted: true })
    expect(await hasAudio()).toBe(false)
  })

  it.skipIf(!existsSync(FFMPEG))('exports a timeline for the agent, trimming a clip with an in and out point to its range', async () => {
    const fixture = await start()
    const red = await fixture.clip('red', '160x90', 1)
    const blue = await fixture.clip('blue', '160x90', 2)
    await fixture.run('timeline.create', { timeline: 't1', name: 'Pilot', assets: [red, blue] })
    await fixture.run('timeline.clip_trim', { clip: 'cl2', in_sec: 0.5, out_sec: 1.5 })
    const exported = value(await fixture.call('dv_timeline_export', { reason: 'export the pilot', timeline: 't1' }))
    expect(exported).toMatchObject({ status: 'done', summary: 'exported timeline t1', outputs: [{ role: 'video', mime: 'video/mp4' }] })
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(exported.record))
    expect(record).toMatchObject({
      actor: 'agent', component: 'timeline', operation: 'timeline.export', params: { timeline: 't1' }, inputs: [], status: 'done',
    })
    const video = record.outputs[0] as AssetId
    expect(fixture.ctx.dvAssetPool.get(video)).toMatchObject({ mime: 'video/mp4', name: 'Pilot.mp4' })
    const probe = await fixture.ctx.dvFfmpeg.probe(fixture.ctx.dvAssetPool.path(video))
    expect(probe).toMatchObject({ width: 160, height: 90 })
    expect(probe.durationSec ?? 0).toBeCloseTo(2, 0)
  })

  it.skipIf(!existsSync(FFMPEG))('re-encodes at the first clip\'s frame size when stream copy fails, and exports the first timeline by default', async () => {
    const fixture = await start()
    const large = await fixture.clip('red', '160x90', 1)
    const small = await fixture.clip('green', '80x60', 1)
    await fixture.run('timeline.create', { timeline: 't1', assets: [large, small] })
    // ffmpeg's stream copy accepts these two files, so the test makes it fail as it does for clips of different codecs.
    const run = fixture.ctx.dvFfmpeg.run.bind(fixture.ctx.dvFfmpeg)
    const copy = vi.spyOn(fixture.ctx.dvFfmpeg, 'run').mockImplementation(request => (request.argv.includes('list.txt')
      ? Promise.reject(new FfmpegError('copy failed', 'mismatch'))
      : run(request)))
    const exported = await fixture.run('timeline.export', {})
    expect(exported.record).toMatchObject({ actor: 'user', surface: 'timeline', status: 'done', params: {} })
    const spec = fixture.ctx.dvProject.listOperations().find(entry => entry.name === 'timeline.export')
    expect(exported.record === null ? '' : spec?.summarize(exported.record)).toBe('exported the first timeline')
    expect(copy.mock.calls.some(([request]) => request.argv.includes('-filter_complex'))).toBe(true)
    copy.mockRestore()
    const probe = await fixture.ctx.dvFfmpeg.probe(fixture.ctx.dvAssetPool.path(exported.outputs[0] as AssetId))
    expect(probe).toMatchObject({ width: 160, height: 90 })
    expect(probe.durationSec ?? 0).toBeCloseTo(2, 0)
  })

  it.skipIf(!existsSync(FFMPEG))('keeps the main track on top, shows the video track with the lowest number after its end, and extends the video for a later clip', async () => {
    const fixture = await start()
    const tone = async (name: string, color: string): Promise<AssetId> => {
      await fixture.ctx.dvFfmpeg.run({
        argv: [
          'ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:d=2:r=10`, '-f', 'lavfi', '-i', 'sine=d=2',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', `{{out:${name}}}`,
        ],
        inputs: [], outputs: [name], dir: fixture.dir,
      })
      return fixture.ctx.dvAssetPool.importAsset(fixture.project, { path: join(fixture.dir, name) }, { mime: 'video/mp4', name, durationSec: 2 }, null)
    }
    const red = await tone('red.mp4', 'red')
    const green = await tone('green.mp4', 'lime')
    const blue = await fixture.clip('blue', '80x60', 1)
    const yellow = await fixture.clip('yellow', '160x90', 3)
    await fixture.run('timeline.create', { timeline: 't1', assets: [red] })
    // The main track plays red to 2 s. Track 0 holds blue from 1.5 s to 2.5 s; track 1 holds yellow from 0 s to 3 s and
    // green, which the trim of its in point moves to 3.5 s to 4.5 s.
    for (const params of [
      { asset: blue, track: 0, start_sec: 1.5 }, { asset: yellow, track: 1, start_sec: 0 }, { asset: green, track: 1, start_sec: 3 },
    ]) {
      expect((await fixture.run('timeline.track_clip_add', { timeline: 't1', ...params })).record?.status).toBe('done')
    }
    await fixture.run('timeline.clip_trim', { clip: 'cl4', in_sec: 0.5, out_sec: 1.5 })
    const colorAt = async (path: string, seconds: number): Promise<number[]> => {
      const name = `pixel-${String(seconds)}.rgb`
      await fixture.ctx.dvFfmpeg.run({
        argv: [
          'ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-ss', String(seconds), '-frames:v', '1', '-vf', 'crop=2:2:79:44',
          '-f', 'rawvideo', '-pix_fmt', 'rgb24', `{{out:${name}}}`,
        ],
        inputs: [path], outputs: [name], dir: fixture.dir,
      })
      return [...readFileSync(join(fixture.dir, name)).subarray(0, 3)].map(channel => Math.round(channel / 255))
    }
    const exported = await fixture.run('timeline.export', { timeline: 't1' })
    expect(exported.record).toMatchObject({ status: 'done' })
    const path = fixture.ctx.dvAssetPool.path(exported.outputs[0] as AssetId)
    const probe = await fixture.ctx.dvFfmpeg.probe(path)
    expect(probe).toMatchObject({ width: 160, height: 90, hasAudio: true })
    expect(probe.durationSec ?? 0).toBeCloseTo(4.5, 0)
    // Red covers both tracks to 2 s; then blue on track 0 covers yellow on track 1; after yellow ends, no track plays
    // until green does.
    expect(await colorAt(path, 0.2)).toEqual([1, 0, 0])
    expect(await colorAt(path, 1.7)).toEqual([1, 0, 0])
    expect(await colorAt(path, 2.2)).toEqual([0, 0, 1])
    expect(await colorAt(path, 2.7)).toEqual([1, 1, 0])
    expect(await colorAt(path, 3.2)).toEqual([0, 0, 0])
    expect(await colorAt(path, 4)).toEqual([0, 1, 0])
    // With every audio muted, the export has no audio.
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video', muted: true })
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video_track', track: 1, muted: true })
    const silent = await fixture.run('timeline.export', { timeline: 't1' })
    expect((await fixture.ctx.dvFfmpeg.probe(fixture.ctx.dvAssetPool.path(silent.outputs[0] as AssetId))).hasAudio).toBe(false)
  })

  it('draws only the track clips that end after the main track, from its end, and silences the audio the picture hides', async () => {
    const fixture = await start()
    const pool = fixture.ctx.dvAssetPool
    const main = pool.importAsset(fixture.project, Buffer.from('main'), { mime: 'video/mp4', name: 'main.mp4', durationSec: 2 }, null)
    const top = pool.importAsset(fixture.project, Buffer.from('top'), { mime: 'video/mp4', name: 'top.mp4', durationSec: 2 }, null)
    const low = pool.importAsset(fixture.project, Buffer.from('low'), { mime: 'video/mp4', name: 'low.mp4', durationSec: 3 }, null)
    const hidden = pool.importAsset(fixture.project, Buffer.from('hidden'), { mime: 'video/mp4', name: 'hidden.mp4', durationSec: 1 }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [main] })
    await fixture.run('timeline.track_clip_add', { timeline: 't1', asset: top, track: 0, start_sec: 1.5 })
    await fixture.run('timeline.track_clip_add', { timeline: 't1', asset: low, track: 1, start_sec: 1 })
    await fixture.run('timeline.track_clip_add', { timeline: 't1', asset: hidden, track: 2, start_sec: 0 })
    const filters: string[] = []
    const run = vi.spyOn(fixture.ctx.dvFfmpeg, 'run').mockImplementation((request) => {
      const at = request.argv.indexOf('-filter_complex')
      if (at !== -1) filters.push(String(request.argv[at + 1]))
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    const seconds: Record<string, number> = { [pool.path(top)]: 2, [pool.path(low)]: 3, [pool.path(hidden)]: 1 }
    const probe = vi.spyOn(fixture.ctx.dvFfmpeg, 'probe').mockImplementation(file => Promise.resolve({
      durationSec: seconds[file] ?? 2, videoDurationSec: null, width: 160, height: 90, hasAudio: true, codec: 'h264',
    }))
    const timeline = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    expect(await fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).toBe(join(fixture.dir, 'tracks.mp4'))
    // The hidden clip ends at 1 s, under the main track, so it is neither probed nor drawn.
    expect(probe.mock.calls.map(([file]) => file)).not.toContain(pool.path(hidden))
    expect(filters).toEqual([[
      '[0:v:0]setsar=1,tpad=stop_mode=add:stop_duration=2:color=black[b0]',
      '[1:v:0]scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+1/TB[c0]',
      "[b0][c0]overlay=enable='between(t,2,4)':eof_action=pass[b1]",
      '[2:v:0]scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+1.5/TB[c1]',
      "[b1][c1]overlay=enable='between(t,2,3.5)':eof_action=pass[b2]",
      '[0:a:0]asetpts=PTS-STARTPTS[a0]',
      "[1:a:0]asetpts=PTS-STARTPTS,adelay=delays=1000:all=1,volume=0:enable='between(t,0,2)+between(t,1.5,3.5)'[a1]",
      "[2:a:0]asetpts=PTS-STARTPTS,adelay=delays=1500:all=1,volume=0:enable='between(t,0,2)'[a2]",
      '[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0[a]',
    ].join(';')])
    // A main track that lasts past every track clip covers them all, so the joined video is the export, and no track
    // clip's file is read.
    seconds[join(fixture.dir, 'timeline.mp4')] = 9
    probe.mockClear()
    expect(await fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).toBe(join(fixture.dir, 'timeline.mp4'))
    expect(probe.mock.calls.map(([file]) => file)).toEqual([join(fixture.dir, 'timeline.mp4')])
    // Files without a known length show for no time, and a joined video without a frame size cannot take the tracks.
    const argv: Array<readonly string[]> = []
    run.mockImplementation((request) => {
      argv.push(request.argv)
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    probe.mockResolvedValue({ durationSec: null, videoDurationSec: null, width: 160, height: 90, hasAudio: false, codec: 'h264' })
    await fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)
    expect(argv.at(-1)?.slice(argv.at(-1)?.indexOf('-t') ?? 0, (argv.at(-1)?.indexOf('-t') ?? 0) + 2)).toEqual(['-t', '1.5'])
    expect(argv.at(-1)).toContain('-an')
    probe.mockResolvedValue({ durationSec: 4, videoDurationSec: 4, width: null, height: null, hasAudio: false, codec: null })
    await expect(fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).rejects.toThrow('The joined clips have no video frame size to draw the video tracks at.')
  })
})
