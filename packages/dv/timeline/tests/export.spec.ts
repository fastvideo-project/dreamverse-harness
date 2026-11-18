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
      'Export a timeline to one video: each clip with an in or out point is trimmed to that range and plays at its time. Where clips '
      + 'of several video tracks play, the track with the lowest number covers the others, picture and audio; where no clip plays, the '
      + 'video is black and silent. The sounds of the sound tracks play over the clips\' audio, up to the end of the last clip. Muted '
      + 'audio (dv_timeline_mute) is left out, and every track plays at its volume (dv_timeline_volume). Runs on the CPU.',
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

  it('refuses to export a timeline while a clip waits for its render, naming the clips', async () => {
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
    await expect(fixture.run('timeline.export', { timeline: 't1' })).rejects.toThrow('Clips cl2, cl3 of timeline t1 are not ready yet.')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(records)
    const [timeline] = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines
    if (timeline === undefined) throw new Error('timeline t1 is missing')
    await expect(fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).rejects.toThrow('Clips cl2, cl3 of timeline t1')
    release()
    await Promise.all(renders)
  })

  it('trims and joins the clips without their audio while 视频 1 is muted, and with it otherwise', async () => {
    const fixture = await start()
    const clip = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('clip'), { mime: 'video/mp4', name: 'clip.mp4' }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [clip] })
    // A trim of the out point keeps the clip at 0 s, so 视频 1 joins into one file.
    await fixture.run('timeline.clip_trim', { clip: 'cl1', out_sec: 1 })
    const argvs: Array<readonly string[]> = []
    vi.spyOn(fixture.ctx.dvFfmpeg, 'run').mockImplementation((request) => {
      argvs.push(request.argv)
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    const timeline = (): Timeline => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    await fixture.ctx.dvTimeline.exportTimeline(timeline(), fixture.dir)
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video_track', track: 0, muted: true })
    await fixture.ctx.dvTimeline.exportTimeline(timeline(), fixture.dir)
    // Each export trims the clip and then joins it: whether each command leaves the audio out and whether it encodes AAC.
    expect(argvs.map(argv => [argv.includes('-an'), argv.includes('aac')])).toEqual([[false, true], [false, false], [true, false], [true, false]])
  })

  it.skipIf(!existsSync(FFMPEG))('exports a file with the clips\' audio, and a file without audio while 视频 1 is muted', async () => {
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
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video_track', track: 0, muted: true })
    expect(await hasAudio()).toBe(false)
  })

  it.skipIf(!existsSync(FFMPEG))('exports a timeline for the agent, trimming a clip with an in and out point to its range', async () => {
    const fixture = await start()
    const red = await fixture.clip('red', '160x90', 1)
    const blue = await fixture.clip('blue', '160x90', 2)
    await fixture.run('timeline.create', { timeline: 't1', name: 'Pilot', assets: [red, blue] })
    // The trim of cl2's in point moves its start from 1 s to 1.5 s, so the export is black from 1 s to 1.5 s and lasts 2.5 s.
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
    expect(probe.durationSec ?? 0).toBeCloseTo(2.5, 1)
  })

  it.skipIf(!existsSync(FFMPEG))('mixes the sounds of the sound tracks in up to the video\'s end, without a muted sound track or a sound that starts after the end', async () => {
    const fixture = await start()
    const pool = fixture.ctx.dvAssetPool
    const red = await fixture.clip('red', '160x90', 2)
    // A 3-second tone at another sample rate than the encoder's, as an imported audio file.
    await fixture.ctx.dvFfmpeg.run({
      argv: ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=3:r=22050', '{{out:tone.wav}}'],
      inputs: [], outputs: ['tone.wav'], dir: fixture.dir,
    })
    const tone = pool.importAsset(fixture.project, { path: join(fixture.dir, 'tone.wav') }, { mime: 'audio/wav', name: 'tone.wav', durationSec: 3 }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [red] })
    // sd1 plays 0.5 s to 1.3 s of the tone from 1 s to 1.8 s; sd2 plays from 0 s on sound track 1; sd3 starts after the video's end.
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: tone, start_sec: 0.5 })
    await fixture.run('timeline.sound_trim', { sound: 'sd1', in_sec: 0.5, out_sec: 1.3 })
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: tone, start_sec: 0, track: 1 })
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: tone, start_sec: 5 })
    const mute = (track: number, muted: boolean): Promise<RunResult> => fixture.run('timeline.mute', { timeline: 't1', target: 'sound', track, muted })
    expect((await mute(1, true)).record?.status).toBe('done')
    const exported = async (): Promise<string> => pool.path((await fixture.run('timeline.export', { timeline: 't1' })).outputs[0] as AssetId)
    /** How loud 0.2 s of a file's audio from a time is: the root mean square of its samples, where 1 is full scale. */
    const loudAt = async (path: string, seconds: number): Promise<number> => {
      const name = `level-${String(seconds)}.raw`
      await fixture.ctx.dvFfmpeg.run({
        argv: ['ffmpeg', '-y', '-loglevel', 'error', '-ss', String(seconds), '-t', '0.2', '-i', '{{in:0}}', '-vn', '-ac', '1', '-f', 's16le', `{{out:${name}}}`],
        inputs: [path], outputs: [name], dir: fixture.dir,
      })
      const bytes = readFileSync(join(fixture.dir, name))
      const samples = Array.from({ length: Math.floor(bytes.length / 2) }, (_sample, index) => bytes.readInt16LE(index * 2) / 32768)
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length))
    }
    const mixed = await exported()
    const probe = await fixture.ctx.dvFfmpeg.probe(mixed)
    expect(probe).toMatchObject({ width: 160, height: 90, hasAudio: true })
    expect(probe.durationSec ?? 0).toBeCloseTo(2, 1)
    // The mono 22.05 kHz tone is the only input of the mix, and the export is still 48 kHz stereo.
    const format = await fixture.ctx.dvFfmpeg.run({
      argv: ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', '{{in:0}}'],
      inputs: [mixed], outputs: [], dir: fixture.dir,
    })
    expect(format.stdout.trim()).toBe('48000,2')
    // Silent before sd1 while sound track 1 is muted, the tone during sd1, and silent again after its out point.
    expect([await loudAt(mixed, 0.3) < 0.01, await loudAt(mixed, 1.3) > 0.03, await loudAt(mixed, 1.85) < 0.01]).toEqual([true, true, true])
    // At -20 dB, sound track 0 plays its tone at a tenth of its level.
    const loud = await loudAt(mixed, 1.3)
    await fixture.run('timeline.volume', { timeline: 't1', target: 'sound', track: 0, volume_db: -20 })
    expect(await loudAt(await exported(), 1.3) / loud).toBeCloseTo(0.1, 1)
    await fixture.run('timeline.volume', { timeline: 't1', target: 'sound', track: 0, volume_db: 0 })
    // With sound track 1 heard, the tone also plays from 0 s, and both tones play during sd1.
    await mute(1, false)
    const both = await exported()
    expect([await loudAt(both, 0.3) > 0.03, await loudAt(both, 1.85) > 0.03]).toEqual([true, true])
    // No sound is heard with both sound tracks muted, so the silent clip exports without audio.
    await mute(0, true)
    await mute(1, true)
    expect((await fixture.ctx.dvFfmpeg.probe(await exported())).hasAudio).toBe(false)
  })

  it.skipIf(!existsSync(FFMPEG))('keeps the clips\' own audio where it plays when a sound is mixed in, for audio that starts later than the picture', async () => {
    const fixture = await start()
    const pool = fixture.ctx.dvAssetPool
    // A 4-second clip whose 2-second tone starts 1.5 s after its picture, and a short tone to lay over its last half second.
    await fixture.ctx.dvFfmpeg.run({
      argv: [
        'ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=4:r=10', '-itsoffset', '1.5', '-f', 'lavfi', '-i', 'sine=f=440:d=2',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '{{out:late.mp4}}',
      ],
      inputs: [], outputs: ['late.mp4'], dir: fixture.dir,
    })
    await fixture.ctx.dvFfmpeg.run({
      argv: ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=880:d=1', '{{out:blip.wav}}'], inputs: [], outputs: ['blip.wav'], dir: fixture.dir,
    })
    const late = pool.importAsset(fixture.project, { path: join(fixture.dir, 'late.mp4') }, { mime: 'video/mp4', name: 'late.mp4', durationSec: 4 }, null)
    const blip = pool.importAsset(fixture.project, { path: join(fixture.dir, 'blip.wav') }, { mime: 'audio/wav', name: 'blip.wav', durationSec: 1 }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [late] })
    const loudAt = async (path: string, seconds: number): Promise<boolean> => {
      const name = `late-${String(seconds)}.raw`
      await fixture.ctx.dvFfmpeg.run({
        argv: ['ffmpeg', '-y', '-loglevel', 'error', '-ss', String(seconds), '-t', '0.2', '-i', '{{in:0}}', '-vn', '-ac', '1', '-f', 's16le', `{{out:${name}}}`],
        inputs: [path], outputs: [name], dir: fixture.dir,
      })
      const bytes = readFileSync(join(fixture.dir, name))
      const samples = Array.from({ length: Math.floor(bytes.length / 2) }, (_sample, index) => bytes.readInt16LE(index * 2) / 32768)
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length)) > 0.02
    }
    const exported = async (): Promise<string> => pool.path((await fixture.run('timeline.export', { timeline: 't1' })).outputs[0] as AssetId)
    // Without a sound the clip is copied: its tone plays from 1.5 s to 3.5 s.
    const plain = await exported()
    expect([await loudAt(plain, 0.6), await loudAt(plain, 2.4)]).toEqual([false, true])
    // At -40 dB on 视频 1 its tone is too quiet to count, and still starts at 1.5 s when it is back at 0 dB.
    await fixture.run('timeline.volume', { timeline: 't1', target: 'video_track', track: 0, volume_db: -40 })
    expect(await loudAt(await exported(), 2.4)).toBe(false)
    await fixture.run('timeline.volume', { timeline: 't1', target: 'video_track', track: 0, volume_db: 0 })
    // With a sound from 3.5 s the mix runs, and the clip's tone still starts at 1.5 s.
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: blip, start_sec: 3.5 })
    const mixed = await exported()
    expect([await loudAt(mixed, 0.6), await loudAt(mixed, 2.4), await loudAt(mixed, 3.7)]).toEqual([false, true, true])
  })

  it('mixes the sounds over the video\'s own audio in one run that copies the picture, and refuses a video whose length ffprobe cannot tell', async () => {
    const fixture = await start()
    const pool = fixture.ctx.dvAssetPool
    const main = pool.importAsset(fixture.project, Buffer.from('main'), { mime: 'video/mp4', name: 'main.mp4', durationSec: 4 }, null)
    const song = pool.importAsset(fixture.project, Buffer.from('song'), { mime: 'audio/mpeg', name: 'song.mp3', durationSec: 9 }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [main] })
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 1.5 })
    await fixture.run('timeline.sound_add', { timeline: 't1', asset: song, start_sec: 0, track: 1 })
    await fixture.run('timeline.sound_trim', { sound: 'sd2', in_sec: 0, out_sec: 2 })
    // The second part of the split starts at 4 s, the video's end, so it is left out.
    await fixture.run('timeline.sound_split', { sound: 'sd1', at_sec: 2.5 })
    const requests: Array<{ argv: readonly string[]; inputs: readonly string[] }> = []
    vi.spyOn(fixture.ctx.dvFfmpeg, 'run').mockImplementation((request) => {
      requests.push({ argv: request.argv, inputs: request.inputs })
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    // ffprobe reads the song as audio, and the video of the clips as `video` says.
    let video = { durationSec: 4 as number | null, videoDurationSec: 4 as number | null, width: 160, height: 90, hasAudio: true, codec: 'h264' }
    let songReads: () => Promise<{ hasAudio: boolean }> = () => Promise.resolve({ hasAudio: true })
    const probe = vi.spyOn(fixture.ctx.dvFfmpeg, 'probe').mockImplementation(async file => file === pool.path(song)
      ? { durationSec: 9, videoDurationSec: null, width: null, height: null, codec: 'mp3', ...await songReads() }
      : video)
    const timeline = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    expect(timeline.sounds.map(sound => [sound.id, sound.start_sec, sound.in_sec, sound.out_sec]))
      .toEqual([['sd1', 1.5, null, 2.5], ['sd3', 4, 2.5, null], ['sd2', 0, 0, 2]])
    expect(await fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).toBe(join(fixture.dir, 'mixed.mp4'))
    // The song is read once for its three sounds.
    expect(probe.mock.calls.filter(([file]) => file === pool.path(song))).toHaveLength(1)
    const mix = requests.at(-1) as { argv: readonly string[]; inputs: readonly string[] }
    expect(mix.inputs).toEqual([join(fixture.dir, 'timeline.mp4'), pool.path(song), pool.path(song)])
    expect(mix.argv).toEqual([
      'ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-to', '2.5', '-i', '{{in:1}}', '-ss', '0', '-to', '2', '-i', '{{in:2}}', '-filter_complex',
      [
        '[0:a:0]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo[own]',
        '[1:a:0]asetpts=PTS-STARTPTS,adelay=delays=1500:all=1,aformat=sample_rates=48000:channel_layouts=stereo[s0]',
        '[2:a:0]asetpts=PTS-STARTPTS,adelay=delays=0:all=1,aformat=sample_rates=48000:channel_layouts=stereo[s1]',
        '[own][s0][s1]amix=inputs=3:duration=longest:normalize=0[a]',
      ].join(';'),
      '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-t', '4', '-movflags', '+faststart', '{{out:mixed.mp4}}',
    ])
    // Each sound plays at its sound track's volume.
    await fixture.run('timeline.volume', { timeline: 't1', target: 'sound', track: 1, volume_db: -12 })
    const quieter = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    await fixture.ctx.dvTimeline.exportTimeline(quieter, fixture.dir)
    const quieterArgv = (requests.at(-1) as { argv: readonly string[] }).argv
    expect(quieterArgv[quieterArgv.indexOf('-filter_complex') + 1]?.split(';')[2])
      .toBe('[2:a:0]asetpts=PTS-STARTPTS,adelay=delays=0:all=1,volume=-12dB,aformat=sample_rates=48000:channel_layouts=stereo[s1]')
    // A sound without an out point is read to the end of its file, and a video without audio gives only the sounds.
    await fixture.run('timeline.sound_remove', { sound: 'sd1' })
    await fixture.run('timeline.sound_remove', { sound: 'sd2' })
    const later = (): Timeline => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    // With only the sound that starts at the video's end, nothing is mixed and the video of the clips is the export.
    expect(await fixture.ctx.dvTimeline.exportTimeline(later(), fixture.dir)).toBe(join(fixture.dir, 'timeline.mp4'))
    // 视频 1 below 0 dB runs the mix for its own audio alone, at its volume.
    await fixture.run('timeline.volume', { timeline: 't1', target: 'video_track', track: 0, volume_db: -6 })
    expect(await fixture.ctx.dvTimeline.exportTimeline(later(), fixture.dir)).toBe(join(fixture.dir, 'mixed.mp4'))
    const ownArgv = (requests.at(-1) as { argv: readonly string[] }).argv
    expect(ownArgv[ownArgv.indexOf('-filter_complex') + 1]).toBe(
      '[0:a:0]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,volume=-6dB[own];[own]amix=inputs=1:duration=longest:normalize=0[a]',
    )
    await fixture.run('timeline.sound_move', { sound: 'sd3', start_sec: 1 })
    video = { ...video, videoDurationSec: null, hasAudio: false }
    await fixture.ctx.dvTimeline.exportTimeline(later(), fixture.dir)
    const alone = (requests.at(-1) as { argv: readonly string[] }).argv
    expect(alone.slice(4, alone.indexOf('-map'))).toEqual([
      '-i', '{{in:0}}', '-ss', '2.5', '-i', '{{in:1}}', '-filter_complex',
      '[1:a:0]asetpts=PTS-STARTPTS,adelay=delays=1000:all=1,aformat=sample_rates=48000:channel_layouts=stereo[s0];[s0]amix=inputs=1:duration=longest:normalize=0[a]',
    ])
    video = { ...video, durationSec: null }
    await expect(fixture.ctx.dvTimeline.exportTimeline(later(), fixture.dir)).rejects.toThrow('The video of timeline t1 has no length to mix its sounds over.')
    // A sound whose file has no audio, or that ffprobe cannot read, is refused before any clip is trimmed or joined;
    // on a muted sound track it is not read at all.
    const refusal = `Sound sd3 of timeline t1 cannot be exported: asset ${song} has no audio that ffmpeg can read. Remove the sound or mute its sound track.`
    for (const reads of [() => Promise.resolve({ hasAudio: false }), () => Promise.reject(new FfmpegError('ffprobe failed', 'Invalid data'))]) {
      songReads = reads
      requests.length = 0
      await expect(fixture.ctx.dvTimeline.exportTimeline(later(), fixture.dir)).rejects.toThrow(refusal)
      expect(requests).toEqual([])
    }
    await fixture.run('timeline.mute', { timeline: 't1', target: 'sound', track: 0, muted: true })
    video = { ...video, durationSec: 4 }
    expect(await fixture.ctx.dvTimeline.exportTimeline(later(), fixture.dir)).toBe(join(fixture.dir, 'timeline.mp4'))
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

  it.skipIf(!existsSync(FFMPEG))('keeps 视频 1 on top, shows the video track with the lowest number after its end, and extends the video for a later clip', async () => {
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
    // 视频 1 plays red to 2 s. Track 1 holds blue from 1.5 s to 2.5 s; track 2 holds yellow from 0 s to 3 s and green,
    // which the trim of its in point moves to 3.5 s to 4.5 s.
    for (const params of [
      { asset: blue, track: 1, start_sec: 1.5 }, { asset: yellow, track: 2, start_sec: 0 }, { asset: green, track: 2, start_sec: 3 },
    ]) {
      expect((await fixture.run('timeline.clip_add', { timeline: 't1', ...params })).record?.status).toBe('done')
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
    // Red covers both tracks to 2 s; then blue on track 1 covers yellow on track 2; after yellow ends, no track plays
    // until green does.
    expect(await colorAt(path, 0.2)).toEqual([1, 0, 0])
    expect(await colorAt(path, 1.7)).toEqual([1, 0, 0])
    expect(await colorAt(path, 2.2)).toEqual([0, 0, 1])
    expect(await colorAt(path, 2.7)).toEqual([1, 1, 0])
    expect(await colorAt(path, 3.2)).toEqual([0, 0, 0])
    expect(await colorAt(path, 4)).toEqual([0, 1, 0])
    // With every audio muted, the export has no audio.
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video_track', track: 0, muted: true })
    await fixture.run('timeline.mute', { timeline: 't1', target: 'video_track', track: 2, muted: true })
    const silent = await fixture.run('timeline.export', { timeline: 't1' })
    expect((await fixture.ctx.dvFfmpeg.probe(fixture.ctx.dvAssetPool.path(silent.outputs[0] as AssetId))).hasAudio).toBe(false)
  })

  it.skipIf(!existsSync(FFMPEG))('draws a 视频 1 with a gap on black, showing the video track under the gap, and a timeline whose 视频 1 is empty', async () => {
    const fixture = await start()
    const red = await fixture.clip('red', '160x90', 1)
    const blue = await fixture.clip('blue', '160x90', 1)
    const green = await fixture.clip('lime', '80x60', 1.5)
    await fixture.run('timeline.create', { timeline: 't1', assets: [red, blue] })
    // Red plays 0 s to 1 s and blue 3 s to 4 s; green on track 1 plays 0.8 s to 2.3 s, under red and then in the gap.
    expect((await fixture.run('timeline.clip_move', { clip: 'cl2', start_sec: 3 })).record?.status).toBe('done')
    expect((await fixture.run('timeline.clip_add', { timeline: 't1', asset: green, track: 1, start_sec: 0.8 })).record?.status).toBe('done')
    const colorAt = async (path: string, seconds: number): Promise<number[]> => {
      const name = `gap-${String(seconds)}.rgb`
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
    const path = fixture.ctx.dvAssetPool.path(exported.outputs[0] as AssetId)
    const probe = await fixture.ctx.dvFfmpeg.probe(path)
    expect(probe).toMatchObject({ width: 160, height: 90, hasAudio: false })
    expect(probe.durationSec ?? 0).toBeCloseTo(4, 0)
    // The export keeps the 10 frames per second of the first clip of 视频 1.
    const rate = await fixture.ctx.dvFfmpeg.run({
      argv: ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', '{{in:0}}'],
      inputs: [path], outputs: [], dir: fixture.dir,
    })
    expect(rate.stdout.trim()).toBe('10/1')
    expect(await colorAt(path, 0.5)).toEqual([1, 0, 0])
    expect(await colorAt(path, 1.5)).toEqual([0, 1, 0])
    expect(await colorAt(path, 2.6)).toEqual([0, 0, 0])
    expect(await colorAt(path, 3.5)).toEqual([0, 0, 1])
    // A timeline with clips only under an empty 视频 1 is black until its first clip, at that clip's frame size.
    await fixture.run('timeline.create', { timeline: 't2', assets: [] })
    await fixture.run('timeline.clip_add', { timeline: 't2', asset: green, track: 1, start_sec: 1 })
    const only = await fixture.run('timeline.export', { timeline: 't2' })
    const onlyPath = fixture.ctx.dvAssetPool.path(only.outputs[0] as AssetId)
    expect(await fixture.ctx.dvFfmpeg.probe(onlyPath)).toMatchObject({ width: 80, height: 60 })
    expect(await colorAt(onlyPath, 0.5)).toEqual([0, 0, 0])
  })

  it('draws on black with 视频 1 over the other video tracks and its audio silencing theirs, and refuses a first clip without a frame size', async () => {
    const fixture = await start()
    const pool = fixture.ctx.dvAssetPool
    const main = pool.importAsset(fixture.project, Buffer.from('main'), { mime: 'video/mp4', name: 'main.mp4', durationSec: 2 }, null)
    const under = pool.importAsset(fixture.project, Buffer.from('under'), { mime: 'video/mp4', name: 'under.mp4', durationSec: 3 }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [main] })
    await fixture.run('timeline.clip_move', { clip: 'cl1', start_sec: 1 })
    await fixture.run('timeline.clip_add', { timeline: 't1', asset: under, track: 1, start_sec: 0 })
    const argvs: Array<readonly string[]> = []
    vi.spyOn(fixture.ctx.dvFfmpeg, 'run').mockImplementation((request) => {
      argvs.push(request.argv)
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    const seconds: Record<string, number> = { [pool.path(main)]: 2, [pool.path(under)]: 3 }
    const probe = vi.spyOn(fixture.ctx.dvFfmpeg, 'probe').mockImplementation(file => Promise.resolve({
      durationSec: seconds[file] ?? 2, videoDurationSec: null, width: 160, height: 90, hasAudio: true, codec: 'h264',
    }))
    const timeline = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    expect(await fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).toBe(join(fixture.dir, 'tracks.mp4'))
    const argv = argvs.at(-1) as readonly string[]
    expect(argv.slice(4, 8)).toEqual(['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=3'])
    expect(argv[argv.indexOf('-filter_complex') + 1]).toBe([
      '[0:v:0]setsar=1[b0]',
      '[1:v:0]scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+0/TB[c0]',
      "[b0][c0]overlay=enable='between(t,0,3)':eof_action=pass[b1]",
      '[2:v:0]scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+1/TB[c1]',
      "[b1][c1]overlay=enable='between(t,1,3)':eof_action=pass[b2]",
      "[1:a:0]asetpts=PTS-STARTPTS,adelay=delays=0:all=1,volume=0:enable='between(t,1,3)',aformat=sample_rates=48000:channel_layouts=stereo[a1]",
      '[2:a:0]asetpts=PTS-STARTPTS,adelay=delays=1000:all=1,aformat=sample_rates=48000:channel_layouts=stereo[a2]',
      '[a1][a2]amix=inputs=2:duration=longest:normalize=0[a]',
    ].join(';'))
    // Each clip's audio plays at its video track's volume, after the silencing of what the picture hides.
    await fixture.run('timeline.volume', { timeline: 't1', target: 'video_track', track: 1, volume_db: -10 })
    await fixture.run('timeline.volume', { timeline: 't1', target: 'video_track', track: 0, volume_db: -3 })
    const quieter = fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    await fixture.ctx.dvTimeline.exportTimeline(quieter, fixture.dir)
    const quieterArgv = argvs.at(-1) as readonly string[]
    expect(quieterArgv[quieterArgv.indexOf('-filter_complex') + 1]?.split(';').slice(5, 7)).toEqual([
      "[1:a:0]asetpts=PTS-STARTPTS,adelay=delays=0:all=1,volume=0:enable='between(t,1,3)',volume=-10dB,aformat=sample_rates=48000:channel_layouts=stereo[a1]",
      '[2:a:0]asetpts=PTS-STARTPTS,adelay=delays=1000:all=1,volume=-3dB,aformat=sample_rates=48000:channel_layouts=stereo[a2]',
    ])
    probe.mockResolvedValue({ durationSec: 2, videoDurationSec: 2, width: null, height: null, hasAudio: false, codec: null })
    await expect(fixture.ctx.dvTimeline.exportTimeline(timeline, fixture.dir)).rejects.toThrow('The first clip has no video frame size to draw the timeline at.')
  })

  it('names one waiting clip, passes on a join failure that is not ffmpeg\'s, and imports an export whose length and size ffprobe cannot tell', async () => {
    const fixture = await start()
    const one = fixture.ctx.dvAssetPool.importAsset(fixture.project, Buffer.from('one'), { mime: 'video/mp4', name: 'one.mp4', durationSec: 2 }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [one, one] })
    const timeline = (): Timeline => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    const waiting = { ...timeline(), clips: timeline().clips.map((clip, index) => index === 1 ? { ...clip, asset: null } : clip) }
    await expect(fixture.ctx.dvTimeline.exportTimeline(waiting, fixture.dir)).rejects.toThrow('Clip cl2 of timeline t1 is not ready yet.')
    const argvs: Array<readonly string[]> = []
    const run = vi.spyOn(fixture.ctx.dvFfmpeg, 'run').mockImplementation((request) => {
      argvs.push(request.argv)
      if (request.argv.includes('list.txt')) return Promise.reject(new Error('The disk is full.'))
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    const probe = vi.spyOn(fixture.ctx.dvFfmpeg, 'probe')
      .mockResolvedValue({ durationSec: null, videoDurationSec: null, width: null, height: null, hasAudio: false, codec: null })
    await expect(fixture.ctx.dvTimeline.exportTimeline(timeline(), fixture.dir)).rejects.toThrow('The disk is full.')
    run.mockImplementation(request => request.argv.includes('list.txt')
      ? Promise.reject(new FfmpegError('copy failed', 'mismatch'))
      : Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 }))
    await expect(fixture.ctx.dvTimeline.exportTimeline(timeline(), fixture.dir)).rejects.toThrow('The first clip has no video frame size to join the clips at.')
    // A trim of the in point alone plays the clip to the asset's end; the gap it leaves draws the timeline on black.
    await fixture.run('timeline.clip_trim', { clip: 'cl2', in_sec: 0.5 })
    run.mockImplementation((request) => {
      argvs.push(request.argv)
      for (const name of request.outputs) writeFileSync(join(request.dir, name), name)
      return Promise.resolve({ outputs: [], stdout: '', stderr: '', exitCode: 0 })
    })
    probe.mockImplementation(file => Promise.resolve(file.endsWith('tracks.mp4')
      ? { durationSec: null, videoDurationSec: null, width: null, height: null, hasAudio: false, codec: null }
      : { durationSec: 2, videoDurationSec: 2, width: 160, height: 90, hasAudio: false, codec: 'h264' }))
    argvs.length = 0
    const exported = await fixture.run('timeline.export', { timeline: 't1' })
    const trim = argvs.find(argv => argv.includes('-ss')) as readonly string[]
    expect([trim[trim.indexOf('-ss') + 1], trim.includes('-to')]).toEqual(['0.5', false])
    expect(fixture.ctx.dvAssetPool.get(exported.outputs[0] as AssetId)).toMatchObject({ duration_sec: null, width: null, height: null })
  })

  it('draws only the clips of the other tracks that end after 视频 1, from its end, and silences the audio the picture hides', async () => {
    const fixture = await start()
    const pool = fixture.ctx.dvAssetPool
    const main = pool.importAsset(fixture.project, Buffer.from('main'), { mime: 'video/mp4', name: 'main.mp4', durationSec: 2 }, null)
    const top = pool.importAsset(fixture.project, Buffer.from('top'), { mime: 'video/mp4', name: 'top.mp4', durationSec: 2 }, null)
    const low = pool.importAsset(fixture.project, Buffer.from('low'), { mime: 'video/mp4', name: 'low.mp4', durationSec: 3 }, null)
    const hidden = pool.importAsset(fixture.project, Buffer.from('hidden'), { mime: 'video/mp4', name: 'hidden.mp4', durationSec: 1 }, null)
    await fixture.run('timeline.create', { timeline: 't1', assets: [main] })
    await fixture.run('timeline.clip_add', { timeline: 't1', asset: top, track: 1, start_sec: 1.5 })
    await fixture.run('timeline.clip_add', { timeline: 't1', asset: low, track: 2, start_sec: 1 })
    await fixture.run('timeline.clip_add', { timeline: 't1', asset: hidden, track: 3, start_sec: 0 })
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
    // The hidden clip ends at 1 s, under 视频 1, so it is neither probed nor drawn.
    expect(probe.mock.calls.map(([file]) => file)).not.toContain(pool.path(hidden))
    expect(filters).toEqual([[
      '[0:v:0]setsar=1,tpad=stop_mode=add:stop_duration=2:color=black[b0]',
      '[1:v:0]scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+1/TB[c0]',
      "[b0][c0]overlay=enable='between(t,2,4)':eof_action=pass[b1]",
      '[2:v:0]scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+1.5/TB[c1]',
      "[b1][c1]overlay=enable='between(t,2,3.5)':eof_action=pass[b2]",
      '[0:a:0]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo[a0]',
      "[1:a:0]asetpts=PTS-STARTPTS,adelay=delays=1000:all=1,volume=0:enable='between(t,0,2)+between(t,1.5,3.5)',aformat=sample_rates=48000:channel_layouts=stereo[a1]",
      "[2:a:0]asetpts=PTS-STARTPTS,adelay=delays=1500:all=1,volume=0:enable='between(t,0,2)',aformat=sample_rates=48000:channel_layouts=stereo[a2]",
      '[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0[a]',
    ].join(';')])
    // The joined 视频 1 plays its audio at its track's volume under the drawn clips.
    await fixture.run('timeline.volume', { timeline: 't1', target: 'video_track', track: 0, volume_db: -6 })
    const state = (): Timeline => fixture.ctx.dvProject.getState(fixture.project).components.timeline.timelines[0] as Timeline
    await fixture.ctx.dvTimeline.exportTimeline(state(), fixture.dir)
    expect(filters.at(-1)?.split(';')[5]).toBe('[0:a:0]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,volume=-6dB[a0]')
    await fixture.run('timeline.volume', { timeline: 't1', target: 'video_track', track: 0, volume_db: 0 })
    // A 视频 1 that lasts past every clip of the other tracks covers them all, so the joined video is the export, and no
    // file of theirs is read.
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
