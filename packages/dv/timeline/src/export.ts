/**
 * The `timeline.export` operation of the Timeline component: it reads the timeline's clips from the `timeline` slice of
 * the project state, trims each clip that has an in or out point with `dvFfmpeg`, joins the clips of the 视频 track in
 * playback order (without their audio while the timeline's `video_muted` is on), adds after its end the clips of the
 * video tracks under it, and imports the result into the asset pool as the record's output. An export of a
 * timeline with a placeholder clip
 * (a clip whose render is not done, so it has no asset) is refused before its record. The `timeline` reducer ignores
 * export records: an export changes no project state besides the asset it creates.
 *
 * @module @dv/timeline/export
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dv/asset-pool'
import { FfmpegError } from '@dv/ffmpeg'
import type { AssetId, OperationResult, OperationSpec, ProjectState } from '@dv/project'
import type { Clip, Timeline, TrackClip } from './types.ts'

/** The name of the export operation, whose agent tool is `dv_timeline_export`. */
export const EXPORT_OPERATION = 'timeline.export'

/** The ffmpeg video encoder arguments of every re-encoded file: H.264 in yuv420p. */
const ENCODE_ARGS = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'] as const

/**
 * The timeline an export call names: its `timeline` param, else the first timeline.
 * @param state - the project state.
 * @param id - the call's `timeline` param.
 * @returns the timeline, or undefined when the state has none by that ID.
 */
function exportedTimeline(state: ProjectState, id: unknown): Timeline | undefined {
  const timelines = state.components.timeline.timelines
  return typeof id === 'string' ? timelines.find(candidate => candidate.id === id) : timelines[0]
}

/**
 * Why a timeline cannot be exported yet: the 1-based positions of its placeholder clips, such as "Clips 3, 5 of
 * timeline t1 are not ready yet.".
 * @param timeline - the timeline.
 * @returns the reason, or null when every clip has an asset.
 */
function notReady(timeline: Timeline): string | null {
  const positions = timeline.clips.flatMap((clip, index) => (clip.asset === null ? [index + 1] : []))
  if (positions.length === 0) return null
  return positions.length === 1
    ? `Clip ${String(positions[0])} of timeline ${timeline.id} is not ready yet.`
    : `Clips ${positions.join(', ')} of timeline ${timeline.id} are not ready yet.`
}

/**
 * Export a timeline to one MP4 file: trim each clip with an in or out point to that range, join the clips of the 视频
 * track in playback order, and add the clips of the video tracks under it after the joined video's end. The picture and
 * the audio at each time come from the 视频 track while it has a clip, else from the clip of the track with the lowest
 * number there; muted audio is silent. A timeline whose clips have no audio, or whose clips' audio is all muted, gives
 * a file without audio.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline with at least one clip on its 视频 track, each of which has an asset.
 * @param dir - an existing directory for the trimmed clips and the joined file, usually the operation's `scratchDir`.
 * @returns the path of the exported file inside `dir`.
 * @throws Error for a timeline without clips on its 视频 track or with a placeholder clip; FfmpegError when ffmpeg
 *   cannot trim, join or draw the clips.
 */
export async function exportTimeline(ctx: Context, timeline: Timeline, dir: string): Promise<string> {
  if (timeline.clips.length === 0) throw new Error(`Timeline ${timeline.id} has no clips to export.`)
  const reason = notReady(timeline)
  if (reason !== null) throw new Error(reason)
  const paths: string[] = []
  for (const [index, { asset, ...clip }] of timeline.clips.entries()) {
    if (asset !== null) paths.push(await clipFile(ctx, { ...clip, asset }, `clip-${index + 1}.mp4`, dir, timeline.video_muted))
  }
  const joined = await joinClips(ctx, paths, dir, timeline.video_muted)
  return timeline.track_clips.length === 0 ? joined : await drawTracks(ctx, timeline, joined, dir)
}

/** One track clip ready to draw: its file, its timeline span, and whether its audio is heard. */
interface DrawnClip {
  clip: TrackClip
  path: string
  start: number
  end: number
  audio: boolean
}

/**
 * The ffmpeg `enable` expression that is true during any of the spans.
 * @param spans - timeline spans in seconds.
 * @returns the expression, such as `between(t,1,3)+between(t,5,6)`; empty for no span.
 */
function during(spans: ReadonlyArray<{ start: number; end: number }>): string {
  return spans.map(span => `between(t,${String(span.start)},${String(span.end)})`).join('+')
}

/**
 * The length of a probed video: its video stream's duration, else the file's, else 0.
 * @param probe - what ffprobe reported.
 * @returns the length in seconds.
 */
function videoSeconds(probe: { videoDurationSec: number | null; durationSec: number | null }): number {
  return probe.videoDurationSec ?? probe.durationSec ?? 0
}

/**
 * Draw the track clips that end after the joined 视频 track, which covers them up to its end. The joined video is
 * extended with black frames to the last clip's end, and each clip is scaled to fit its frame, with black bars, and
 * shows during its span after the joined video's end; the track with the highest number is drawn first, so a track with
 * a lower number covers it. A clip's audio is silenced up to the joined video's end and where a clip of a track with a
 * lower number plays; the remaining audio is mixed.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline with at least one track clip.
 * @param joined - the joined 视频 track.
 * @param dir - the directory for the trimmed clips and the result.
 * @returns the path of the result.
 */
async function drawTracks(ctx: Context, timeline: Timeline, joined: string, dir: string): Promise<string> {
  const ffmpeg = ctx.dvFfmpeg
  const base = await ffmpeg.probe(joined)
  if (base.width === null || base.height === null) throw new Error('The joined clips have no video frame size to draw the video tracks at.')
  const { width, height } = base
  const baseSeconds = videoSeconds(base)
  const drawn: DrawnClip[] = []
  // The highest track number first, so each later overlay covers the earlier ones.
  for (const clip of timeline.track_clips.toSorted((a, b) => b.track - a.track || a.start_sec - b.start_sec)) {
    // A clip whose asset's known length ends it clearly before the joined video's end stays covered, so it is neither
    // trimmed nor probed; a clip of unknown length or one that ends near that end is measured from its file.
    const out = clip.out_sec ?? ctx.dvAssetPool.get(clip.asset).duration_sec
    if (out !== null && clip.start_sec + out - (clip.in_sec ?? 0) < baseSeconds - 0.05) continue
    const muted = timeline.muted_video_tracks.includes(clip.track)
    const path = await clipFile(ctx, clip, `track-${clip.id}.mp4`, dir, muted)
    const probe = await ffmpeg.probe(path)
    const end = clip.start_sec + videoSeconds(probe)
    if (end > baseSeconds + 0.01) drawn.push({ clip, path, start: clip.start_sec, end, audio: probe.hasAudio && !muted })
  }
  if (drawn.length === 0) return joined
  const total = Math.max(baseSeconds, ...drawn.map(each => each.end))
  // Every drawn clip ends after the joined video, so the joined video always gets black frames up to the last clip's end.
  const video = [`[0:v:0]setsar=1,tpad=stop_mode=add:stop_duration=${String(total - baseSeconds)}:color=black[b0]`]
  for (const [index, each] of drawn.entries()) {
    const input = index + 1
    video.push(
      `[${String(input)}:v:0]scale=${String(width)}:${String(height)}:force_original_aspect_ratio=decrease,`
      + `pad=${String(width)}:${String(height)}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+${String(each.start)}/TB[c${String(index)}]`,
      `[b${String(index)}][c${String(index)}]overlay=enable='${during([{ start: Math.max(each.start, baseSeconds), end: each.end }])}':eof_action=pass[b${String(input)}]`,
    )
  }
  // The 视频 track is heard to its end; a clip after that, where no clip of a track with a lower number plays.
  const audio: string[] = []
  const silence = (cover: ReadonlyArray<{ start: number; end: number }>): string => `,volume=0:enable='${during(cover)}'`
  if (base.hasAudio && !timeline.video_muted) audio.push('[0:a:0]asetpts=PTS-STARTPTS[a0]')
  for (const [index, each] of drawn.entries()) {
    if (!each.audio) continue
    const cover = [{ start: 0, end: baseSeconds }, ...drawn.filter(other => other.clip.track < each.clip.track)]
    audio.push(`[${String(index + 1)}:a:0]asetpts=PTS-STARTPTS,adelay=delays=${String(Math.round(each.start * 1000))}:all=1${silence(cover)}[a${String(index + 1)}]`)
  }
  const labels = audio.map(chain => chain.slice(chain.lastIndexOf('[')))
  const mix = labels.length === 0 ? [] : [`${labels.join('')}amix=inputs=${String(labels.length)}:duration=longest:normalize=0[a]`]
  const filter = [...video, ...audio, ...mix].join(';')
  const inputs = [joined, ...drawn.map(each => each.path)]
  await ffmpeg.run({
    argv: [
      'ffmpeg', '-y', '-loglevel', 'error', ...inputs.flatMap((_path, index) => ['-i', `{{in:${index}}}`]), '-filter_complex', filter,
      '-map', `[b${String(drawn.length)}]`, ...mix.length === 0 ? ['-an'] : ['-map', '[a]', '-c:a', 'aac'], ...ENCODE_ARGS,
      '-t', String(total), '-movflags', '+faststart', '{{out:tracks.mp4}}',
    ],
    inputs, outputs: ['tracks.mp4'], dir,
  })
  return join(dir, 'tracks.mp4')
}

/**
 * The file of one clip: the asset's own file for a clip that plays the whole asset, else the clip's range trimmed into
 * a new file. Re-encoding makes the trim frame-accurate.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param clip - a clip with an asset.
 * @param name - the name of the trimmed file.
 * @param dir - the directory for the trimmed file.
 * @param muted - whether to leave the clip's audio out of the trimmed file, because the export leaves it out anyway.
 * @returns the file path.
 */
async function clipFile(
  ctx: Context, clip: Pick<Clip, 'in_sec' | 'out_sec'> & { asset: AssetId }, name: string, dir: string, muted: boolean,
): Promise<string> {
  const path = ctx.dvAssetPool.path(clip.asset)
  if (clip.in_sec === null && clip.out_sec === null) return path
  const end = clip.out_sec === null ? [] : ['-to', String(clip.out_sec)]
  // The seek comes after `-i` so the decoder reads the frames before the trim and the trim lands on the exact frame.
  await ctx.dvFfmpeg.run({
    argv: [
      'ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-ss', String(clip.in_sec ?? 0), ...end, ...ENCODE_ARGS, ...muted ? ['-an'] : ['-c:a', 'aac'],
      '-movflags', '+faststart', `{{out:${name}}}`,
    ],
    inputs: [path], outputs: [name], dir,
  })
  return join(dir, name)
}

/**
 * Join clip files in order. Stream copy through the concat demuxer comes first; when the files disagree on codec or
 * geometry it fails, and the concat filter re-encodes the video of every file at the first file's frame size, without
 * audio.
 * @param ctx - a context that injects `dvFfmpeg`.
 * @param paths - the clip files, in playback order.
 * @param dir - the directory for the joined file.
 * @param muted - whether to leave the clips' audio out of the stream copy too.
 * @returns the path of the joined file.
 */
async function joinClips(ctx: Context, paths: readonly string[], dir: string, muted: boolean): Promise<string> {
  const ffmpeg = ctx.dvFfmpeg
  try {
    await ffmpeg.run({
      argv: [
        'ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', ...muted ? ['-an'] : [],
        '-movflags', '+faststart', '{{out:timeline.mp4}}',
      ],
      inputs: paths, outputs: ['timeline.mp4'], dir,
      files: [{ name: 'list.txt', content: paths.map((_path, index) => `file '{{in:${index}}}'`).join('\n') }],
    })
    return join(dir, 'timeline.mp4')
  } catch (error: unknown) {
    if (!(error instanceof FfmpegError)) throw error
  }
  const lead = await ffmpeg.probe(paths[0] ?? '')
  if (lead.width === null || lead.height === null) throw new Error('The first clip has no video frame size to join the clips at.')
  const { width, height } = lead
  // Every clip is scaled and padded to the first clip's frame size, which the concat filter requires.
  const scaled = paths.map((_path, index) =>
    `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`)
  const filter = `${scaled.join(';')};${paths.map((_path, index) => `[v${index}]`).join('')}concat=n=${paths.length}:v=1:a=0[v]`
  await ffmpeg.run({
    argv: [
      'ffmpeg', '-y', '-loglevel', 'error', ...paths.flatMap((_path, index) => ['-i', `{{in:${index}}}`]), '-filter_complex', filter,
      '-map', '[v]', ...ENCODE_ARGS, '-movflags', '+faststart', '{{out:timeline.mp4}}',
    ],
    inputs: paths, outputs: ['timeline.mp4'], dir,
  })
  return join(dir, 'timeline.mp4')
}

/**
 * The `timeline.export` operation spec.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @returns the operation spec, whose `execute` exports the timeline its `timeline` param names.
 */
export function exportOperation(ctx: Context): OperationSpec {
  return {
    name: EXPORT_OPERATION,
    component: 'timeline',
    version: '1',
    label: { zh: '导出时间线', en: 'Export timeline' },
    description: 'Export a timeline to one video: each clip with an in or out point is trimmed to that range, the clips of the main '
      + 'video track are joined in timeline order, and the clips of the video tracks under it play after its end, a track with a '
      + 'lower number covering those with higher numbers, picture and audio. Muted audio (dv_timeline_mute) is left out. The sound tracks are not included yet.',
    inputs: {},
    params: { timeline: { type: 'string', description: 'The ID of the timeline to export, such as `t1`; default: the first timeline.' } },
    outputs: [{ role: 'video', type: 'video' }],
    // The output depends on the timeline's clips in the project state, which the params and inputs do not name.
    deterministic: false,
    resource: 'cpu',
    // A placeholder clip has no file to join yet, so the call is refused before its record.
    precondition: (request, state) => {
      const timeline = exportedTimeline(state, request.params['timeline'])
      const reason = timeline === undefined ? null : notReady(timeline)
      return reason === null ? Promise.resolve() : Promise.reject(new Error(reason))
    },
    summarize: record => (typeof record.params['timeline'] === 'string' ? `exported timeline ${record.params['timeline']}` : 'exported the first timeline'),
    execute: async (context): Promise<OperationResult> => {
      const id = context.params['timeline']
      const timeline = exportedTimeline(context.state, id)
      if (timeline === undefined) throw new Error(typeof id === 'string' ? `Unknown timeline "${id}".` : 'The project has no timeline to export.')
      const path = await exportTimeline(ctx, timeline, context.scratchDir)
      const probe = await ctx.dvFfmpeg.probe(path)
      const video = context.importAsset({ path }, {
        mime: 'video/mp4', name: `${timeline.name === '' ? timeline.id : timeline.name}.mp4`,
        ...probe.durationSec === null ? {} : { durationSec: probe.durationSec },
        ...probe.width === null || probe.height === null ? {} : { width: probe.width, height: probe.height },
      })
      return { outputs: [video] }
    },
  }
}
