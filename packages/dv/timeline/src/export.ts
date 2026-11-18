/**
 * The `timeline.export` operation of the Timeline component: it reads the timeline's clips from the `timeline` slice of
 * the project state, trims each clip that has an in or out point with `dvFfmpeg`, lays every video track out in time,
 * the track with the lowest number on top, and imports the result into the asset pool as the record's output. When 视频 1
 * (track 0) plays from 0 s without a gap, its clips are joined in playback order (without their audio while track 0 is
 * muted) and the other tracks show after its end; any other timeline is drawn on black, which shows where no clip plays.
 * The sounds of the sound tracks are then mixed over the clips' audio, up to the end of the last clip.
 * An export of a timeline with a placeholder clip (a clip whose render is not done, so it has no asset) is refused
 * before its record.
 * The `timeline` reducer ignores export records: an export changes no project state besides the asset it creates.
 *
 * @module @dv/timeline/export
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dv/asset-pool'
import { FfmpegError } from '@dv/ffmpeg'
import type { AssetId, OperationResult, OperationSpec, ProjectState } from '@dv/project'
import { clipLength, placeClips } from './reducer.ts'
import type { PlacedClip } from './reducer.ts'
import type { Clip, Sound, Timeline } from './types.ts'

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
 * Why a timeline cannot be exported yet: the IDs of its placeholder clips, such as "Clips cl3, cl5 of timeline t1 are not
 * ready yet.".
 * @param timeline - the timeline.
 * @returns the reason, or null when every clip has an asset.
 */
function notReady(timeline: Timeline): string | null {
  const waiting = timeline.clips.flatMap(clip => (clip.asset === null ? [clip.id] : []))
  if (waiting.length === 0) return null
  return waiting.length === 1
    ? `Clip ${waiting[0] as string} of timeline ${timeline.id} is not ready yet.`
    : `Clips ${waiting.join(', ')} of timeline ${timeline.id} are not ready yet.`
}

/**
 * Export a timeline to one MP4 file: trim each clip with an in or out point to that range, lay the clips out at their
 * times, and mix the sounds of the sound tracks in. The picture and the clip audio at each time come from the clip of
 * the track with the lowest number there, else black and silence; muted audio is silent, and every other track plays
 * at its volume. Each sound of a sound track that is not muted plays over that audio and the other sounds, up to the end
 * of the last clip, as the preview plays it. A timeline with no audio that is heard gives a file without audio.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline with at least one clip, each of which has an asset.
 * @param dir - an existing directory for the trimmed clips and the joined file, usually the operation's `scratchDir`.
 * @returns the path of the exported file inside `dir`.
 * @throws Error for a timeline without clips or with a placeholder clip, for a sound of a sound track that is not muted
 *   whose file has no audio that ffprobe can read, and for sounds to mix into a video whose length ffprobe cannot tell;
 *   FfmpegError when ffmpeg cannot trim, join, draw or mix.
 */
export async function exportTimeline(ctx: Context, timeline: Timeline, dir: string): Promise<string> {
  if (timeline.clips.length === 0) throw new Error(`Timeline ${timeline.id} has no clips to export.`)
  const reason = notReady(timeline)
  if (reason !== null) throw new Error(reason)
  const sounds = await audibleSounds(ctx, timeline)
  return await mixSounds(ctx, timeline, sounds, await layClips(ctx, timeline, dir), dir)
}

/**
 * The file of a timeline's clips, and the volume in dB that its own audio still has to be played at: the volume of 视频 1
 * when the file is 视频 1's clips joined as they are, else 0, because drawing the tracks sets each track's volume.
 */
interface LaidClips {
  path: string
  volumeDb: number
}

/**
 * The sounds of a timeline that its export can play: those of the sound tracks that are not muted. Each one's file is
 * read before any clip is trimmed or joined, so a sound that cannot play fails the export at once.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline.
 * @returns the sounds, in the order the timeline stores them.
 * @throws Error naming the sound whose asset the pool does not hold, whose file ffprobe cannot read, or whose file has
 *   no audio.
 */
async function audibleSounds(ctx: Context, timeline: Timeline): Promise<Sound[]> {
  const audible = timeline.sounds.filter(sound => !timeline.muted_sound_tracks.includes(sound.track))
  const read = new Map<AssetId, boolean>()
  for (const sound of audible) {
    if (!read.has(sound.asset)) {
      read.set(sound.asset, false)
      try {
        read.set(sound.asset, (await ctx.dvFfmpeg.probe(ctx.dvAssetPool.path(sound.asset))).hasAudio)
      } catch (error: unknown) {
        // The pool does not hold the asset or ffprobe cannot read its file; the sound cannot play either way.
        void error
      }
    }
    if (read.get(sound.asset) !== true) {
      throw new Error(`Sound ${sound.id} of timeline ${timeline.id} cannot be exported: asset ${sound.asset} has no audio that ffmpeg `
        + 'can read. Remove the sound or mute its sound track.')
    }
  }
  return audible
}

/**
 * Lay the clips of a timeline's video tracks out into one file, with the clips' own audio.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline with at least one clip, each of which has an asset.
 * @param dir - the directory for the trimmed clips and the result.
 * @returns the result.
 */
async function layClips(ctx: Context, timeline: Timeline, dir: string): Promise<LaidClips> {
  const pool = ctx.dvAssetPool
  // Every clip has an asset of the pool here: the caller refuses a timeline with a clip without one.
  const durationOf = (asset: AssetId): number | null => pool.get(asset).duration_sec
  const placed = placeClips(timeline.clips, clip => clipLength(clip, durationOf, []))
  // 视频 1 playing from 0 s without a gap joins into one file; any other timeline is drawn on black.
  const top = placed.filter(each => each.clip.track === 0).toSorted((a, b) => a.start - b.start)
  const gapless = top.length > 0 && top.every((each, index) => Math.abs(each.start - (top[index - 1]?.end ?? 0)) < 0.01)
  if (!gapless) return { path: await drawOnBlack(ctx, timeline, placed, dir), volumeDb: 0 }
  const muted = timeline.muted_video_tracks.includes(0)
  const paths: string[] = []
  for (const [index, { clip: { asset, ...clip } }] of top.entries()) {
    paths.push(await clipFile(ctx, { ...clip, asset: asset as AssetId }, `clip-${index + 1}.mp4`, dir, muted))
  }
  const joined = await joinClips(ctx, paths, dir, muted)
  const others = placed.filter(each => each.clip.track !== 0)
  const drawn = others.length === 0 ? null : await drawTracks(ctx, timeline, others, joined, dir)
  return drawn ?? { path: joined, volumeDb: trackVolume(timeline.video_track_volumes, 0) }
}

/**
 * The audio format of every chain that goes into a mix. Without it the mix takes the sample rate and the channel layout
 * of its first input, so a mono or low-rate first input would lower every other one.
 */
const MIX_FORMAT = 'aformat=sample_rates=48000:channel_layouts=stereo'

/**
 * The filter chain of the audio of a file that covers the timeline from 0 s, such as the joined clips: the audio stays at
 * its own times, so audio that starts later than the picture still plays where it did.
 * @param input - the ffmpeg input number.
 * @returns the chain, without its output label.
 */
function coveringAudio(input: number): string {
  return `[${String(input)}:a:0]aresample=async=1:first_pts=0,${MIX_FORMAT}`
}

/**
 * The filter chain of the audio of a file that plays from a timeline time: the audio moves to 0 s and then waits until
 * that time.
 * @param input - the ffmpeg input number.
 * @param startSec - the timeline time at which the file starts.
 * @param filters - filters that silence parts of it or set its volume, with their leading comma, or empty.
 * @returns the chain, without its output label.
 */
function delayedAudio(input: number, startSec: number, filters = ''): string {
  return `[${String(input)}:a:0]asetpts=PTS-STARTPTS,adelay=delays=${String(Math.round(startSec * 1000))}:all=1${filters},${MIX_FORMAT}`
}

/**
 * @param volumes - track volumes in dB by track number.
 * @param track - a track number.
 * @returns the track's volume in dB; a track without an entry is at 0 dB.
 */
function trackVolume(volumes: readonly number[], track: number): number {
  return volumes[track] ?? 0
}

/**
 * @param volumeDb - a track volume in dB.
 * @returns the `volume` filter that plays a chain at it, with its leading comma, or empty at 0 dB.
 */
function gain(volumeDb: number): string {
  return volumeDb === 0 ? '' : `,volume=${String(volumeDb)}dB`
}

/**
 * The filter that mixes labelled chains into `[a]` at their full volume, as long as the longest of them.
 * @param labels - the output labels of the chains, such as `[a0]`.
 * @returns the filter.
 */
function mixOf(labels: readonly string[]): string {
  return `${labels.join('')}amix=inputs=${String(labels.length)}:duration=longest:normalize=0[a]`
}

/**
 * Mix the sounds of a timeline's sound tracks into the video of its clips. Each sound of a track that is not muted plays
 * its range of its asset from its start time at its track's volume, over the video's own audio and the other sounds.
 * The result ends where the video ends, so a sound is cut there and a sound that starts at or after that end is left
 * out. The picture is copied as it is.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline.
 * @param audible - the sounds of its sound tracks that are not muted.
 * @param video - the file of the timeline's clips, and the volume its own audio plays at.
 * @param dir - the directory for the result.
 * @returns the video's file when no sound is heard and its own audio plays at 0 dB, else the path of `mixed.mp4`.
 * @throws Error when sounds are to be mixed and ffprobe cannot tell the video's length.
 */
async function mixSounds(ctx: Context, timeline: Timeline, audible: readonly Sound[], video: LaidClips, dir: string): Promise<string> {
  if (audible.length === 0 && video.volumeDb === 0) return video.path
  const probe = await ctx.dvFfmpeg.probe(video.path)
  const total = videoSeconds(probe)
  if (total <= 0) throw new Error(`The video of timeline ${timeline.id} has no length to mix its sounds over.`)
  const heard = audible.filter(sound => sound.start_sec < total)
  const quieter = probe.hasAudio && video.volumeDb !== 0
  if (heard.length === 0 && !quieter) return video.path
  const own = probe.hasAudio ? [`${coveringAudio(0)}${gain(video.volumeDb)}[own]`] : []
  // Each sound's range is cut where its file is read: ffmpeg loses the audio of a range that the `atrim` filter cuts
  // before `adelay` and `amix`.
  const files = heard.flatMap((sound, index) => [
    ...sound.in_sec === null ? [] : ['-ss', String(sound.in_sec)], ...sound.out_sec === null ? [] : ['-to', String(sound.out_sec)],
    '-i', `{{in:${String(index + 1)}}}`,
  ])
  const sounds = heard.map((sound, index) =>
    `${delayedAudio(index + 1, sound.start_sec, gain(trackVolume(timeline.sound_track_volumes, sound.track)))}[s${String(index)}]`)
  const labels = [...own.map(() => '[own]'), ...heard.map((_sound, index) => `[s${String(index)}]`)]
  const filter = [...own, ...sounds, mixOf(labels)].join(';')
  await ctx.dvFfmpeg.run({
    argv: [
      'ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', ...files,
      '-filter_complex', filter, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-t', String(total),
      '-movflags', '+faststart', '{{out:mixed.mp4}}',
    ],
    inputs: [video.path, ...heard.map(sound => ctx.dvAssetPool.path(sound.asset))], outputs: ['mixed.mp4'], dir,
  })
  return join(dir, 'mixed.mp4')
}

/**
 * One clip ready to draw: its layer (its video track; a lower layer covers a higher one), its file, its span, whether
 * it is heard, and the volume of its track in dB.
 */
interface DrawnClip {
  layer: number
  path: string
  start: number
  end: number
  audio: boolean
  volumeDb: number
}

/**
 * The picture and audio that the drawn clips go over: a file that covers the timeline from 0 s to `covers` seconds with
 * its own picture and its audio at a volume in dB, or black of the drawing's whole length at a frame rate, which the
 * result takes.
 */
type Base = { path: string; covers: number; audio: boolean; volumeDb: number } | { black: true; rate: string }

/** The frame rate of the black base when ffprobe reports none for the first clip. */
const FALLBACK_FRAME_RATE = '30'

/**
 * The frame rate of a file's first video stream.
 * @param ctx - a context that injects `dvFfmpeg`.
 * @param path - the file.
 * @param dir - the directory the read runs in.
 * @returns the rate as ffprobe prints it, such as `24/1` or `30000/1001`, or null when it reports none.
 */
async function frameRateOf(ctx: Context, path: string, dir: string): Promise<string | null> {
  const read = await ctx.dvFfmpeg.run({
    argv: ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', '{{in:0}}'],
    inputs: [path], outputs: [], dir,
  })
  const rate = read.stdout.trim()
  return /^[1-9]\d*\/[1-9]\d*$/.test(rate) ? rate : null
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
 * Draw the clips of the tracks under 视频 1 that end after the joined 视频 1, which covers them, picture and audio, up to
 * its end. The joined video is extended with black frames to the last clip's end, and the clips are layered over it as
 * `layer` does; a clip that ends before the joined video's end is left out.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline.
 * @param others - where the clips of the tracks under 视频 1 play.
 * @param joined - the joined 视频 1.
 * @param dir - the directory for the trimmed clips and the result.
 * @returns the result, or null when no clip shows after the joined video's end.
 */
async function drawTracks(
  ctx: Context, timeline: Timeline, others: readonly PlacedClip[], joined: string, dir: string,
): Promise<LaidClips | null> {
  const ffmpeg = ctx.dvFfmpeg
  const base = await ffmpeg.probe(joined)
  if (base.width === null || base.height === null) throw new Error('The joined clips have no video frame size to draw the video tracks at.')
  const { width, height } = base
  const baseSeconds = videoSeconds(base)
  const drawn: DrawnClip[] = []
  for (const { clip, start } of others) {
    // A clip whose asset's known length ends it clearly before the joined video's end stays covered, so it is neither
    // trimmed nor probed; a clip of unknown length or one that ends near that end is measured from its file.
    const asset = clip.asset as AssetId
    const out = clip.out_sec ?? ctx.dvAssetPool.get(asset).duration_sec
    if (out !== null && start + out - (clip.in_sec ?? 0) < baseSeconds - 0.05) continue
    const muted = timeline.muted_video_tracks.includes(clip.track)
    const path = await clipFile(ctx, { ...clip, asset }, `track-${clip.id}.mp4`, dir, muted)
    const probe = await ffmpeg.probe(path)
    const end = start + videoSeconds(probe)
    const volumeDb = trackVolume(timeline.video_track_volumes, clip.track)
    if (end > baseSeconds + 0.01) drawn.push({ layer: clip.track, path, start, end, audio: probe.hasAudio && !muted, volumeDb })
  }
  if (drawn.length === 0) return null
  const covered = {
    path: joined, covers: baseSeconds, audio: base.hasAudio && !timeline.muted_video_tracks.includes(0),
    volumeDb: trackVolume(timeline.video_track_volumes, 0),
  }
  return { path: await layer(ctx, covered, drawn, { width, height }, dir), volumeDb: 0 }
}

/**
 * Draw a timeline whose 视频 1 starts later than 0 s, has a gap, or has no clip: every clip at its time on black of the
 * timeline's whole length, the track with the lowest number on top. The result has the frame size and the frame rate of
 * 视频 1's first clip, else of the first clip below it, so clips of that rate keep their frames; `FALLBACK_FRAME_RATE`
 * frames per second when ffprobe reports no rate for it.
 * @param ctx - a context that injects `dvAssetPool` and `dvFfmpeg`.
 * @param timeline - the timeline, whose clips all have an asset.
 * @param placed - where each of its clips plays.
 * @param dir - the directory for the trimmed clips and the result.
 * @returns the path of the result.
 */
async function drawOnBlack(ctx: Context, timeline: Timeline, placed: readonly PlacedClip[], dir: string): Promise<string> {
  const ffmpeg = ctx.dvFfmpeg
  const drawn: DrawnClip[] = []
  const sizes: Array<{ width: number | null; height: number | null }> = []
  // The clips of the top track first, so the frame size is that of 视频 1's first clip, else of the first clip below it.
  for (const { clip, start } of placed.toSorted((a, b) => a.clip.track - b.clip.track || a.start - b.start)) {
    const muted = timeline.muted_video_tracks.includes(clip.track)
    const path = await clipFile(ctx, { ...clip, asset: clip.asset as AssetId }, `clip-${clip.id}.mp4`, dir, muted)
    const probe = await ffmpeg.probe(path)
    const volumeDb = trackVolume(timeline.video_track_volumes, clip.track)
    drawn.push({ layer: clip.track, path, start, end: start + videoSeconds(probe), audio: probe.hasAudio && !muted, volumeDb })
    sizes.push(probe)
  }
  const lead = sizes[0] as { width: number | null; height: number | null }
  if (lead.width === null || lead.height === null) throw new Error('The first clip has no video frame size to draw the timeline at.')
  const rate = await frameRateOf(ctx, (drawn[0] as DrawnClip).path, dir) ?? FALLBACK_FRAME_RATE
  return await layer(ctx, { black: true, rate }, drawn, { width: lead.width, height: lead.height }, dir)
}

/**
 * Draw clips over a base into `tracks.mp4`. Each clip is scaled to fit the frame, with black bars, and shows during its
 * span except where the base covers it; the clip with the highest layer is drawn first, so a lower layer covers it. A
 * clip's audio is silenced where the base covers it and where a clip of a lower layer plays; the base's audio and the
 * remaining audio are mixed. The result lasts to the end of the base or of the last clip, whichever is later.
 * @param ctx - a context that injects `dvFfmpeg`.
 * @param base - what the clips go over.
 * @param clips - the clips to draw.
 * @param frame - the frame size of the result.
 * @param dir - the directory for the result.
 * @returns the path of the result.
 */
async function layer(
  ctx: Context, base: Base, clips: readonly DrawnClip[], frame: { width: number; height: number }, dir: string,
): Promise<string> {
  const { width, height } = frame
  const covers = 'path' in base ? base.covers : 0
  const total = Math.max(covers, ...clips.map(each => each.end))
  const drawn = clips.toSorted((a, b) => b.layer - a.layer || a.start - b.start)
  // A joined file gets black frames up to the last clip's end; a black base is generated at the frame size and rate for the whole length.
  const video = ['path' in base
    ? `[0:v:0]setsar=1,tpad=stop_mode=add:stop_duration=${String(total - covers)}:color=black[b0]`
    : '[0:v:0]setsar=1[b0]']
  for (const [index, each] of drawn.entries()) {
    const input = index + 1
    video.push(
      `[${String(input)}:v:0]scale=${String(width)}:${String(height)}:force_original_aspect_ratio=decrease,`
      + `pad=${String(width)}:${String(height)}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS+${String(each.start)}/TB[c${String(index)}]`,
      `[b${String(index)}][c${String(index)}]overlay=enable='${during([{ start: Math.max(each.start, covers), end: each.end }])}':eof_action=pass[b${String(input)}]`,
    )
  }
  const audio: string[] = []
  const silence = (cover: ReadonlyArray<{ start: number; end: number }>): string => cover.length === 0 ? '' : `,volume=0:enable='${during(cover)}'`
  if ('path' in base && base.audio) audio.push(`${coveringAudio(0)}${gain(base.volumeDb)}[a0]`)
  for (const [index, each] of drawn.entries()) {
    if (!each.audio) continue
    const cover = [...covers > 0 ? [{ start: 0, end: covers }] : [], ...drawn.filter(other => other.layer < each.layer)]
    audio.push(`${delayedAudio(index + 1, each.start, silence(cover) + gain(each.volumeDb))}[a${String(index + 1)}]`)
  }
  const labels = audio.map(chain => chain.slice(chain.lastIndexOf('[')))
  const mix = labels.length === 0 ? [] : [mixOf(labels)]
  const filter = [...video, ...audio, ...mix].join(';')
  const files = drawn.map(each => each.path)
  const baseInput = 'path' in base
    ? ['-i', `{{in:${String(files.length)}}}`]
    : ['-f', 'lavfi', '-i', `color=c=black:s=${String(width)}x${String(height)}:r=${base.rate}:d=${String(total)}`]
  await ctx.dvFfmpeg.run({
    argv: [
      'ffmpeg', '-y', '-loglevel', 'error', ...baseInput, ...files.flatMap((_path, index) => ['-i', `{{in:${String(index)}}}`]),
      '-filter_complex', filter, '-map', `[b${String(drawn.length)}]`, ...mix.length === 0 ? ['-an'] : ['-map', '[a]', '-c:a', 'aac'],
      ...ENCODE_ARGS, '-t', String(total), '-movflags', '+faststart', '{{out:tracks.mp4}}',
    ],
    inputs: 'path' in base ? [...files, base.path] : files, outputs: ['tracks.mp4'], dir,
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
    description: 'Export a timeline to one video: each clip with an in or out point is trimmed to that range and plays at its time. '
      + 'Where clips of several video tracks play, the track with the lowest number covers the others, picture and audio; where '
      + 'no clip plays, the video is black and silent. The sounds of the sound tracks play over the clips\' audio, up to the end '
      + 'of the last clip. Muted audio (dv_timeline_mute) is left out, and every track plays at its volume (dv_timeline_volume).',
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
