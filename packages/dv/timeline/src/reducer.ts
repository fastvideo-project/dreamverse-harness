/**
 * The Timeline reducer and the clip and sound checks it shares with the operations: how each finished `timeline.*`
 * record changes the timelines of a project, and why a record cannot apply to a given slice.
 *
 * A clip is named by its ID (`cl1`, `cl2`, …). The operations that add clips (`timeline.create`, `timeline.update`,
 * `timeline.clip_insert`, `timeline.clip_split`) store the IDs they assigned in the record's `report.clips`, and the
 * reducer reads them only from there. A sound is named by its ID (`sd1`, `sd2`, …), which `timeline.sound_add` and
 * `timeline.sound_split` store in `report.sounds` the same way. `timeline.sound_split` splits a sound in two at a time
 * inside its asset: the first part keeps the ID and ends there, and the second part starts there, at the timeline time
 * where it played before. `timeline.sound_move` sets a sound's start and sound track, and `timeline.sound_trim` its in and
 * out points; a trim of its in point moves its start by the same amount, so the rest of the sound stays where it played.
 * The operations check a call against the state before they record anything.
 *
 * A `clip` input of `timeline.create` or `timeline.update` that names a render output (`{record, output}`) becomes a
 * clip with that `source`; while the render is not done, its `resolved_asset` is null and the clip is a placeholder that
 * keeps its ID. Trim and split refuse a placeholder; move, remove and replace work on it.
 *
 * The clips of the video tracks under the 视频 track (`track_clips`) come from `timeline.track_clip_add` and move with
 * `timeline.track_clip_move`; remove, split, trim and replace name them by clip ID like the clips of the 视频 track. A
 * trim of a track clip's in point moves its start by the same amount, so the rest of the clip stays where it played.
 * `timeline.clip_move` of a track clip puts it into the 视频 track at a position, and `timeline.track_clip_move` of a ready
 * 视频 track clip with a `track` puts it on that video track at a start time; the clip keeps its ID and in and out points.
 *
 * `timeline.video_track_move` moves a video track under the 视频 track to another number, which sets which track covers
 * which: the tracks between the two numbers move one number toward the track's old one, and each track keeps its clips
 * and its mute. `track_order` stays as it was, so the track's clips show in the row of its new number.
 *
 * `timeline.main_track_remove` deletes the 视频 track's clips, and video track 0 takes its place: its clips become the
 * 视频 track's clips in the order of their start times, without the gaps between them, and keep their IDs and in and out
 * points; its mute becomes the mute of the 视频 track's own audio, and every other video track moves up one number. A
 * timeline without video tracks keeps an empty 视频 track.
 *
 * `timeline.main_track_swap` swaps the 视频 track with video track 0: the 视频 track's clips go onto video track 0 at the
 * times they played, which the call stores in `report.starts` because they depend on the asset lengths, and video track
 * 0's clips become the 视频 track's clips as `timeline.main_track_remove` makes them; the two mutes swap too.
 *
 * `track_order` follows the stored tracks after every call: `timeline.track_add` and a call that names the track after
 * the last add a track at the bottom, and a track removal drops its entry. A track stays stored while `track_order` lists
 * it, empty or not, so the empty sound track 0 of a new timeline, a track added empty, and a track whose last clip or
 * sound went stay until a removal deletes them.
 *
 * @module @dv/timeline/reducer
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ProjectRecord, Reducer } from '@dv/project'
import type { Clip, ClipId, ClipStatus, Sound, SoundId, Timeline, TimelineId, TimelineState, TrackClip, TrackKind } from './types.ts'

/** The twenty-five Timeline edit operations by verb. */
export const OPERATIONS = {
  create: 'timeline.create',
  update: 'timeline.update',
  rename: 'timeline.rename',
  delete: 'timeline.delete',
  insert: 'timeline.clip_insert',
  move: 'timeline.clip_move',
  remove: 'timeline.clip_remove',
  split: 'timeline.clip_split',
  trim: 'timeline.clip_trim',
  replace: 'timeline.clip_replace',
  soundAdd: 'timeline.sound_add',
  soundRemove: 'timeline.sound_remove',
  soundSplit: 'timeline.sound_split',
  soundMove: 'timeline.sound_move',
  soundTrim: 'timeline.sound_trim',
  soundTrackRemove: 'timeline.sound_track_remove',
  soundTrackRename: 'timeline.sound_track_rename',
  mute: 'timeline.mute',
  trackClipAdd: 'timeline.track_clip_add',
  trackClipMove: 'timeline.track_clip_move',
  videoTrackRemove: 'timeline.video_track_remove',
  trackAdd: 'timeline.track_add',
  videoTrackMove: 'timeline.video_track_move',
  mainTrackRemove: 'timeline.main_track_remove',
  mainTrackSwap: 'timeline.main_track_swap',
} as const

/** The ID a `timeline.create` without a `timeline` param creates, and the timeline an insert into an empty project adds. */
export const FIRST_TIMELINE_ID = brandString<TimelineId>('t1')

type Slice = TimelineState

/** The part of a record the reducer and the checks read; `report` is absent until the record finishes. */
type TimelineCall = Pick<ProjectRecord, 'operation' | 'params' | 'inputs'> & Partial<Pick<ProjectRecord, 'report'>>

/** A params field as text, or null when it is absent, empty, or not a string. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * A new timeline's fields besides its ID, name and clips: no track clips, no sounds, no track names, nothing muted, and
 * an empty sound track 0 as its only track under the 视频 track.
 * @returns new arrays on every call, so no two timelines share one.
 */
function noSounds(): Omit<Timeline, 'id' | 'name' | 'clips'> {
  return {
    track_clips: [], muted_video_tracks: [], track_order: ['sound'], sounds: [], sound_track_names: [], video_muted: false,
    muted_sound_tracks: [],
  }
}

/** A params field as a finite number, or null. */
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The timeline a call names in its `timeline` param, or null when the param is absent. */
export function namedTimeline(params: Record<string, unknown>): TimelineId | null {
  const id = text(params['timeline'])
  return id === null ? null : brandString<TimelineId>(id)
}

/** The ID of the timeline a call edits: its `timeline` param, else the first timeline, else null. */
function targetOf(slice: Slice, params: Record<string, unknown>): TimelineId | null {
  return namedTimeline(params) ?? slice.timelines[0]?.id ?? null
}

/** The ID of the timeline a `timeline.create` call creates: its `timeline` param, else `t1`. */
function createdTimeline(params: Record<string, unknown>): TimelineId {
  return namedTimeline(params) ?? FIRST_TIMELINE_ID
}

/**
 * The clips a `timeline.create` or `timeline.update` lays out, without their IDs: its `assets` param, else its `clip`
 * inputs in order. An input that names a render output keeps it as `source`, and its asset is null until the render is
 * done (the call is recorded while the render runs, and a failed render leaves it null).
 * @param call - the create or update call.
 * @returns the assets and sources in playback order.
 */
function laidOutClips(call: TimelineCall): Array<Pick<Clip, 'asset' | 'source'>> {
  if (Array.isArray(call.params['assets'])) {
    return call.params['assets'].filter((asset): asset is string => typeof asset === 'string')
      .map(asset => ({ asset: brandString<AssetId>(asset), source: null }))
  }
  return call.inputs.filter(input => input.role === 'clip').map(input => ({
    asset: input.resolved_asset,
    source: 'record' in input.ref ? { record: input.ref.record, output: input.ref.output } : null,
  }))
}

/**
 * How many clips a call adds, each of which needs a new clip ID: one per laid-out asset for `timeline.create` and
 * `timeline.update`, one for `timeline.clip_insert` and for `timeline.clip_split` (the second part), none otherwise.
 * @param call - a Timeline call.
 * @returns the number of clip IDs the call assigns.
 */
export function addedClipCount(call: TimelineCall): number {
  if (call.operation === OPERATIONS.create || call.operation === OPERATIONS.update) return laidOutClips(call).length
  return [OPERATIONS.insert, OPERATIONS.split, OPERATIONS.trackClipAdd].includes(call.operation as never) ? 1 : 0
}

/** The clip IDs a finished record assigned (its `report.clips`), or an empty list when it stored none. */
export function reportedClips(record: Pick<ProjectRecord, 'report'>): ClipId[] {
  const clips = record.report?.['clips']
  return Array.isArray(clips) ? clips.filter((id): id is string => typeof id === 'string').map(id => brandString<ClipId>(id)) : []
}

/**
 * The start times a `timeline.main_track_swap` stored in `report.starts`, one per 视频 track clip in play order.
 * @param record - a finished or running Timeline record.
 * @returns the numbers among them.
 */
export function reportedStarts(record: Pick<ProjectRecord, 'report'>): number[] {
  const starts = record.report?.['starts']
  return Array.isArray(starts) ? starts.filter((start): start is number => typeof start === 'number') : []
}

/**
 * The timeline times at which the 视频 track's clips play, for `timeline.main_track_swap` to place them on video track 0:
 * each clip starts where the one before it ends.
 * @param timeline - the timeline.
 * @param durationOf - the duration of an asset in seconds, or null when it is unknown.
 * @returns the start times in play order, or the reason when a clip's length is not known.
 */
export function mainClipStarts(timeline: Timeline, durationOf: (asset: AssetId) => number | null): number[] | string {
  const starts: number[] = []
  let cursor = 0
  for (const clip of timeline.clips) {
    // `clipProblem` refuses a swap while a clip is a placeholder, so each clip has its asset.
    const out = clip.out_sec ?? durationOf(clip.asset as AssetId)
    if (out === null) return `The length of asset ${String(clip.asset)} is not known yet, so clip ${clip.id} cannot go on a video track.`
    starts.push(Math.round(cursor * 1000) / 1000)
    cursor += out - (clip.in_sec ?? 0)
  }
  return starts
}

/** The sound IDs a finished record assigned (its `report.sounds`), or an empty list when it stored none. */
export function reportedSounds(record: Pick<ProjectRecord, 'report'>): SoundId[] {
  const sounds = record.report?.['sounds']
  return Array.isArray(sounds) ? sounds.filter((id): id is string => typeof id === 'string').map(id => brandString<SoundId>(id)) : []
}

/** A clip that plays the whole asset; a null asset makes a placeholder that waits for `source`. */
function wholeClip(id: ClipId, asset: AssetId | null, source: Clip['source'] = null): Clip {
  return { id, asset, source, in_sec: null, out_sec: null }
}

/**
 * The status of a clip: `ready` with an asset, `rendering` while its source record is pending or running, else `failed`
 * (the source record ended without the output, or the state does not hold it).
 * @param clip - a clip.
 * @param records - the records of the state, in their current form.
 * @returns the status.
 */
function clipStatusOf(clip: Clip, records: ProjectRecord[]): ClipStatus {
  if (clip.asset !== null) return 'ready'
  const status = records.find(record => record.id === clip.source?.record)?.status
  return status === 'pending' || status === 'running' ? 'rendering' : 'failed'
}

/**
 * The timeline that holds a clip, the clip, and its index in the clips of the 视频 track (`onTrack` false) or in the
 * track clips (`onTrack` true); null when no timeline holds it.
 */
function findClip(
  slice: Slice, id: string | null,
): { timeline: Timeline; index: number; clip: Clip | TrackClip; onTrack: boolean } | null {
  for (const timeline of slice.timelines) {
    const index = timeline.clips.findIndex(clip => clip.id === id)
    if (index !== -1) return { timeline, index, clip: timeline.clips[index] as Clip, onTrack: false }
    const tracked = timeline.track_clips.findIndex(clip => clip.id === id)
    if (tracked !== -1) return { timeline, index: tracked, clip: timeline.track_clips[tracked] as TrackClip, onTrack: true }
  }
  return null
}

/**
 * Why a clip position is not on a timeline.
 * @param timeline - the timeline.
 * @param position - a 1-based position from the call's params.
 * @param last - the highest valid position.
 * @returns the reason, or null for a valid position.
 */
function positionProblem(timeline: Timeline, position: number | null, last: number): string | null {
  if (position !== null && Number.isInteger(position) && position >= 1 && position <= last) return null
  const count = timeline.clips.length
  return `Timeline ${timeline.id} has ${String(count)} clip${count === 1 ? '' : 's'}; position ${String(position)} is not between 1 and ${String(last)}.`
}

/**
 * The number of sound tracks a timeline stores: one past the highest track that holds a sound, a name, or a mute, and at
 * least the number of `sound` entries of `track_order`, which keep empty tracks.
 * @param timeline - the timeline to count.
 * @returns the track count, 0 once every sound track was removed.
 */
function soundTrackCount(timeline: Timeline): number {
  const tracks = [...timeline.sounds.map(sound => sound.track), ...timeline.muted_sound_tracks]
  return Math.max(
    timeline.sound_track_names.length, ...tracks.map(track => track + 1), timeline.track_order.filter(kind => kind === 'sound').length,
  )
}

/**
 * The number of video tracks under the 视频 track that a timeline stores: one past the highest track that holds a clip
 * or a mute, and at least the number of `video` entries of `track_order`, which keep empty tracks.
 * @param timeline - the timeline to count.
 * @returns the track count, 0 for a timeline without video tracks under the 视频 track.
 */
export function videoTrackCount(timeline: Pick<Timeline, 'track_clips' | 'muted_video_tracks' | 'track_order'>): number {
  return Math.max(
    timeline.track_order.filter(kind => kind === 'video').length,
    ...timeline.track_clips.map(clip => clip.track + 1), ...timeline.muted_video_tracks.map(track => track + 1),
  )
}

/** The `kind` values of `timeline.track_add`. */
const TRACK_KINDS: readonly TrackKind[] = ['video', 'sound']

/**
 * @param value - a param that names a track.
 * @returns the whole number of 0 or more it names, or null.
 */
function trackNumber(value: unknown): number | null {
  const track = number(value)
  return track !== null && Number.isInteger(track) && track >= 0 ? track : null
}

/**
 * Why a video track number is not a track that a call may name: not a whole number of 0 or more, or past the track after
 * the last stored track (`remove` names only a stored track).
 * @param timeline - the timeline.
 * @param value - the call's `track` param, or another param that names a video track.
 * @param remove - whether the call needs a stored track, as a removal or a move does.
 * @param param - the param's name in the reason.
 * @returns the reason, or null.
 */
function videoTrackProblem(timeline: Timeline, value: unknown, remove: boolean, param = 'track'): string | null {
  const track = trackNumber(value)
  if (track === null) return `${param} ${String(value)} is not a track number of 0 or more.`
  const count = videoTrackCount(timeline)
  return (remove ? track >= count : track > count)
    ? `Timeline ${timeline.id} has no video track ${String(track)}; it has ${String(count)} under the main video track.`
    : null
}

/** The `target` values of `timeline.mute`. */
const MUTE_TARGETS = ['video', 'video_track', 'sound']

/**
 * Why a `timeline.mute` call cannot apply besides its track: a `target` other than `video`, `video_track` or `sound`, or
 * a `muted` that is not a boolean.
 * @param params - the call's params.
 * @returns the reason, or null.
 */
function muteProblem(params: Record<string, unknown>): string | null {
  if (!MUTE_TARGETS.includes(params['target'] as never)) return `target ${String(params['target'])} is not video, video_track or sound.`
  return typeof params['muted'] === 'boolean' ? null : 'muted must be true or false.'
}

/**
 * Why a call that names a whole timeline cannot apply: `timeline.create` of an ID that exists, another call of a
 * timeline that does not exist, a `start_sec` of `timeline.sound_add` below 0, a sound track that is not a whole number
 * of 0 or more or that the timeline does not have, a track name that is not a string, a bad `target` or `muted` of
 * `timeline.mute`, a video track that the timeline does not store in `track` or `to` of `timeline.video_track_move`,
 * a `timeline.main_track_remove` of a timeline with neither a 视频 track clip nor a video track, or a
 * `timeline.main_track_swap` of a timeline without a video track or with a 视频 track clip still rendering.
 * An insert into a timeline that does not exist creates it, so the only valid position is 1.
 * @param slice - the slice the call applies to.
 * @param call - a whole-timeline call, an insert, or a sound call that names a timeline.
 * @returns the reason, or null when the call applies.
 */
function timelineProblem(slice: Slice, call: TimelineCall): string | null {
  const params = call.params
  if (call.operation === OPERATIONS.create) {
    const id = createdTimeline(params)
    return slice.timelines.some(timeline => timeline.id === id)
      ? `Timeline ${id} exists; call dv_timeline_update to replace its clips.`
      : null
  }
  const id = targetOf(slice, params)
  const timeline = slice.timelines.find(candidate => candidate.id === id)
  if (call.operation === OPERATIONS.insert) {
    const into = timeline ?? { id: id ?? FIRST_TIMELINE_ID, name: '', clips: [], ...noSounds() }
    return positionProblem(into, number(params['at']), into.clips.length + 1)
  }
  if (timeline === undefined) return id === null ? 'The project has no timeline.' : `Timeline ${id} does not exist.`
  if (call.operation === OPERATIONS.soundAdd) {
    const start = number(params['start_sec'])
    if (start === null || start < 0) return `start_sec ${String(params['start_sec'])} is not a time of 0 seconds or more.`
  }
  if (call.operation === OPERATIONS.soundTrackRename && typeof params['name'] !== 'string') return 'name must be a string.'
  if (call.operation === OPERATIONS.trackAdd && !TRACK_KINDS.includes(params['kind'] as never)) {
    return `kind ${String(params['kind'])} is not video or sound.`
  }
  if (call.operation === OPERATIONS.trackClipAdd) {
    const start = number(params['start_sec'])
    if (start === null || start < 0) return `start_sec ${String(params['start_sec'])} is not a time of 0 seconds or more.`
  }
  if (call.operation === OPERATIONS.trackClipAdd || call.operation === OPERATIONS.videoTrackRemove) {
    return videoTrackProblem(timeline, params['track'], call.operation === OPERATIONS.videoTrackRemove)
  }
  if (call.operation === OPERATIONS.videoTrackMove) {
    return videoTrackProblem(timeline, params['track'], true) ?? videoTrackProblem(timeline, params['to'], true, 'to')
  }
  if (call.operation === OPERATIONS.mainTrackRemove && timeline.clips.length === 0 && videoTrackCount(timeline) === 0) {
    return `Timeline ${timeline.id} has no clip on the main video track and no video track under it.`
  }
  if (call.operation === OPERATIONS.mainTrackSwap) {
    if (videoTrackCount(timeline) === 0) return `Timeline ${timeline.id} has no video track under the main video track to swap with.`
    const pending = timeline.clips.find(clip => clip.asset === null)
    if (pending !== undefined) return `Clip ${pending.id} is still rendering; it cannot leave the main video track yet.`
  }
  if (call.operation === OPERATIONS.mute) {
    const problem = muteProblem(params)
    // Muting the 视频 track's own audio names no track.
    if (problem !== null || params['target'] === 'video') return problem
    if (params['target'] === 'video_track') return videoTrackProblem(timeline, params['track'], false)
  }
  if ([OPERATIONS.soundAdd, OPERATIONS.soundTrackRemove, OPERATIONS.soundTrackRename, OPERATIONS.mute].includes(call.operation as never)) {
    const track = params['track'] === undefined && call.operation === OPERATIONS.soundAdd ? 0 : params['track']
    return soundTrackProblem(timeline, track, call.operation === OPERATIONS.soundTrackRemove)
  }
  return null
}

/**
 * Why a sound track number is not a track that a call may name: not a whole number of 0 or more, or past the track after
 * the last stored track (`remove` names only a stored track); an add, a rename, a mute or a sound move may also name the
 * track after the last, and track 1 on a timeline without sound tracks, which earlier builds recorded.
 * @param timeline - the timeline.
 * @param value - the call's `track` param.
 * @param remove - whether the call needs a stored track.
 * @returns the reason, or null.
 */
function soundTrackProblem(timeline: Timeline, value: unknown, remove: boolean): string | null {
  const track = trackNumber(value)
  if (track === null) return `track ${String(value)} is not a track number of 0 or more.`
  const count = soundTrackCount(timeline)
  return (remove ? track >= count : track > Math.max(1, count))
    ? `Timeline ${timeline.id} has no sound track ${String(track)}; it has ${String(count)}.`
    : null
}

/**
 * Why a call that names a sound cannot apply to it: a split time outside the sound, a move to a start before 0 or to a
 * sound track the timeline cannot take, or a trim with an in point before the asset's start, an out point not after the
 * in point, or an in point that would start the sound before the timeline's start.
 * @param timeline - the timeline that holds the sound.
 * @param sound - the named sound.
 * @param call - a `timeline.sound_*` call that names a sound.
 * @returns the reason, or null when the call applies.
 */
function soundProblem(timeline: Timeline, sound: Sound, call: TimelineCall): string | null {
  const params = call.params
  if (call.operation === OPERATIONS.soundSplit) {
    const at = number(params['at_sec'])
    const inside = at !== null && at > (sound.in_sec ?? 0) && (sound.out_sec === null || at < sound.out_sec)
    return inside ? null : `Sound ${sound.id} does not play ${String(params['at_sec'])}s of its asset; split inside its in and out points.`
  }
  if (call.operation === OPERATIONS.soundMove) {
    const start = number(params['start_sec'])
    if (start === null || start < 0) return `start_sec ${String(params['start_sec'])} is not a time of 0 seconds or more.`
    return params['track'] === undefined ? null : soundTrackProblem(timeline, params['track'], false)
  }
  if (call.operation === OPERATIONS.soundTrim) {
    const inSec = number(params['in_sec'])
    const outSec = number(params['out_sec'])
    if ((inSec ?? 0) < 0) return `The in point ${String(inSec)}s is before the asset's start.`
    if (outSec !== null && outSec <= (inSec ?? 0)) return `The out point ${String(outSec)}s is not after the in point ${String(inSec ?? 0)}s.`
    const start = sound.start_sec + (inSec ?? 0) - (sound.in_sec ?? 0)
    if (start < 0) return `The in point ${String(inSec)}s would start sound ${sound.id} before the timeline's start.`
  }
  return null
}

/**
 * Why a `timeline.*` call cannot apply to a slice: a timeline that a create finds or another call misses, an insert
 * position outside the timeline, a clip ID that no timeline holds, a move position outside the clip's timeline, a split
 * time outside the clip, an empty trim range, a sound ID that no timeline holds, a sound split, move or trim that does
 * not fit the sound (`soundProblem`), a bad sound start, sound track, or
 * track name, or a `timeline.track_clip_move` of a 视频 track clip that is still rendering or names no `track`. The
 * operations throw it before they record.
 * @param slice - the slice the call applies to.
 * @param call - the call's operation and params.
 * @returns the reason a creator can read, or null when the call applies.
 */
export function clipProblem(slice: Slice, call: TimelineCall): string | null {
  const operation = call.operation
  if (!isTimelineCall(call)) return null
  const whole = [
    OPERATIONS.create, OPERATIONS.update, OPERATIONS.rename, OPERATIONS.delete, OPERATIONS.insert, OPERATIONS.soundAdd,
    OPERATIONS.soundTrackRemove, OPERATIONS.soundTrackRename, OPERATIONS.mute, OPERATIONS.trackClipAdd, OPERATIONS.videoTrackRemove,
    OPERATIONS.trackAdd, OPERATIONS.videoTrackMove, OPERATIONS.mainTrackRemove, OPERATIONS.mainTrackSwap,
  ]
  if (whole.includes(operation as never)) {
    return timelineProblem(slice, call)
  }
  const params = call.params
  if ([OPERATIONS.soundRemove, OPERATIONS.soundSplit, OPERATIONS.soundMove, OPERATIONS.soundTrim].includes(operation as never)) {
    const id = text(params['sound'])
    const holder = slice.timelines.find(timeline => timeline.sounds.some(entry => entry.id === id))
    const sound = holder?.sounds.find(entry => entry.id === id)
    return holder === undefined || sound === undefined ? `Sound ${String(id)} does not exist.` : soundProblem(holder, sound, call)
  }
  const id = text(params['clip'])
  const found = findClip(slice, id)
  if (found === null) return `Clip ${String(id)} does not exist.`
  const { timeline, clip, onTrack } = found
  if (operation === OPERATIONS.move) {
    // A track clip moves into the 视频 track, which then has one more position.
    return positionProblem(timeline, number(params['to']), timeline.clips.length + (onTrack ? 1 : 0))
  }
  if (operation === OPERATIONS.trackClipMove) {
    if (!onTrack && clip.asset === null) return `Clip ${clip.id} is still rendering.`
    if (!onTrack && params['track'] === undefined) return `Clip ${clip.id} is on the main video track; give track to move it to a video track.`
    const start = number(params['start_sec'])
    if (start === null || start < 0) return `start_sec ${String(params['start_sec'])} is not a time of 0 seconds or more.`
    return params['track'] === undefined ? null : videoTrackProblem(timeline, params['track'], false)
  }
  if ((operation === OPERATIONS.split || operation === OPERATIONS.trim) && clip.asset === null) return `Clip ${clip.id} is still rendering.`
  if (operation === OPERATIONS.split) {
    const at = number(params['at_sec'])
    const inside = at !== null && at > (clip.in_sec ?? 0) && (clip.out_sec === null || at < clip.out_sec)
    return inside ? null : `Clip ${clip.id} of timeline ${timeline.id} does not play ${String(at)}s of its asset; split inside its in and out points.`
  }
  if (operation === OPERATIONS.trim) {
    const inSec = number(params['in_sec'])
    const outSec = number(params['out_sec'])
    if ((inSec ?? 0) < 0) return `The in point ${String(inSec)}s is before the asset's start.`
    if (outSec !== null && outSec <= (inSec ?? 0)) return `The out point ${String(outSec)}s is not after the in point ${String(inSec ?? 0)}s.`
  }
  return null
}

/**
 * Why the clip or sound IDs of a finished record cannot apply: the record stored fewer or more IDs than the clips it
 * adds (a record written before clips had IDs), a sound ID count other than one for `timeline.sound_add` and
 * `timeline.sound_split` and zero for any other operation, a `timeline.main_track_swap` without one start time per
 * 视频 track clip, or an ID that a clip or sound of the slice already has.
 * @param slice - the slice the record applies to.
 * @param record - a finished Timeline record.
 * @returns the reason, or null when the IDs apply.
 */
function clipIdProblem(slice: Slice, record: TimelineCall & Pick<ProjectRecord, 'report'>): string | null {
  const ids = reportedClips(record)
  const count = addedClipCount(record)
  if (ids.length !== count) return `The record stored ${String(ids.length)} clip IDs for the ${String(count)} clips it adds.`
  const taken = new Set(slice.timelines.flatMap(timeline => [...timeline.clips, ...timeline.track_clips].map(clip => clip.id)))
  for (const id of ids) {
    if (taken.has(id)) return `Clip ${id} already exists.`
    taken.add(id)
  }
  const sounds = reportedSounds(record)
  if (record.operation === OPERATIONS.mainTrackSwap) {
    const clips = slice.timelines.find(timeline => timeline.id === targetOf(slice, record.params))?.clips.length
    const starts = reportedStarts(record)
    if (starts.length !== clips) return `The record stored ${String(starts.length)} start times for ${String(clips)} clips.`
  }
  const addsSound = record.operation === OPERATIONS.soundAdd || record.operation === OPERATIONS.soundSplit
  if (sounds.length !== (addsSound ? 1 : 0)) return `The record stored ${String(sounds.length)} sound IDs.`
  const soundTaken = slice.timelines.some(timeline => timeline.sounds.some(sound => sound.id === sounds[0]))
  return soundTaken ? `Sound ${String(sounds[0])} already exists.` : null
}

/**
 * Apply one clip edit to the clips of the timeline that holds the clip. The call has passed `clipProblem`.
 * @param clips - the clips before the call.
 * @param call - a move, remove, split, trim or replace call.
 * @param added - the IDs the call assigned (the second part of a split).
 * @returns the clips after it.
 */
function editClips(clips: Clip[], call: TimelineCall, added: ClipId[]): Clip[] {
  const params = call.params
  const index = clips.findIndex(clip => clip.id === params['clip'])
  const clip = clips[index] as Clip
  const edited = [...clips]
  switch (call.operation) {
    case OPERATIONS.move:
      edited.splice(index, 1)
      edited.splice(Number(params['to']) - 1, 0, clip)
      return edited
    case OPERATIONS.remove:
      edited.splice(index, 1)
      return edited
    case OPERATIONS.split: {
      // `at_sec` is a time inside the clip's asset, so both parts play the same asset: the first keeps the clip's ID
      // and ends there, the second gets the assigned ID and starts there.
      const at = Number(params['at_sec'])
      edited.splice(index, 1, { ...clip, out_sec: at }, { ...clip, id: added[0] as ClipId, in_sec: at })
      return edited
    }
    case OPERATIONS.trim:
      edited[index] = { ...clip, in_sec: number(params['in_sec']), out_sec: number(params['out_sec']) }
      return edited
    case OPERATIONS.replace:
      edited[index] = wholeClip(clip.id, brandString<AssetId>(String(params['asset'])))
      return edited
    /* v8 ignore next 2 -- `applyCall` passes only the five clip operations that name a clip. */
    default:
      return clips
  }
}

/**
 * Apply one clip edit to the track clips of the timeline that holds the clip. The call has passed `clipProblem`. A trim
 * moves the clip's start by the change of its in point; the second part of a split starts where the first part ends.
 * @param clips - the track clips before the call.
 * @param call - a track clip move, or a remove, split, trim or replace call.
 * @param added - the IDs the call assigned (the second part of a split).
 * @returns the track clips after it.
 */
function editTrackClips(clips: TrackClip[], call: TimelineCall, added: ClipId[]): TrackClip[] {
  const params = call.params
  const index = clips.findIndex(clip => clip.id === params['clip'])
  const clip = clips[index] as TrackClip
  switch (call.operation) {
    case OPERATIONS.trackClipMove:
      return clips.with(index, { ...clip, start_sec: Number(params['start_sec']), track: number(params['track']) ?? clip.track })
    case OPERATIONS.remove:
      return clips.toSpliced(index, 1)
    case OPERATIONS.split: {
      const at = Number(params['at_sec'])
      const second = { ...clip, id: added[0] as ClipId, in_sec: at, start_sec: clip.start_sec + at - (clip.in_sec ?? 0) }
      return clips.toSpliced(index, 1, { ...clip, out_sec: at }, second)
    }
    case OPERATIONS.trim: {
      const inSec = number(params['in_sec'])
      const start = clip.start_sec + (inSec ?? 0) - (clip.in_sec ?? 0)
      return clips.with(index, { ...clip, in_sec: inSec, out_sec: number(params['out_sec']), start_sec: start })
    }
    case OPERATIONS.replace:
      return clips.with(index, { ...clip, asset: brandString<AssetId>(String(params['asset'])), in_sec: null, out_sec: null })
    /* v8 ignore next 2 -- `applyCall` passes only the clip operations that name a track clip. */
    default:
      return clips
  }
}

/**
 * Apply one finished `timeline.*` call to the timelines. `timeline.create` adds a timeline, `timeline.update` replaces
 * the clips of the timeline it names, and `timeline.clip_insert` into a timeline that does not exist adds it. Rename,
 * delete, insert and the sound track operations act on the timeline their `timeline` param names, else the first
 * timeline; `timeline.sound_remove` acts on the timeline that holds the sound, and the other clip operations on the
 * timeline that holds the clip. Removing a sound track drops its sounds, its name and its mute, and every later track
 * moves up with its mute; removing a video track does the same with its clips and its mute.
 * @param slice - the slice before the call.
 * @param call - a valid finished call.
 * @returns the timelines after it.
 */
function applyCall(slice: Slice, call: TimelineCall): Timeline[] {
  return editTimelines(slice, call).map(timeline => slice.timelines.includes(timeline) ? timeline : orderTracks(timeline, call))
}

/**
 * A changed timeline with its `track_order` brought in line with its stored tracks: a removed track's entry goes, as
 * does the entry of the video track that `timeline.main_track_remove` makes the 视频 track, and tracks that a call stored
 * by naming the track after the last go at the bottom.
 * @param timeline - the timeline after the call, with the order from before it.
 * @param call - the call that changed it.
 * @returns the timeline with its new order.
 */
function orderTracks(timeline: Timeline, call: TimelineCall): Timeline {
  const removed: TrackKind | null = [OPERATIONS.videoTrackRemove, OPERATIONS.mainTrackRemove].includes(call.operation as never) ? 'video'
    : call.operation === OPERATIONS.soundTrackRemove ? 'sound' : null
  const track = call.operation === OPERATIONS.mainTrackRemove ? 0 : Number(call.params['track'])
  let order = removed === null ? timeline.track_order : withoutEntry(timeline.track_order, removed, track)
  order = withCount(order, 'video', videoTrackCount({ ...timeline, track_order: order }))
  order = withCount(order, 'sound', soundTrackCount({ ...timeline, track_order: order }))
  return { ...timeline, track_order: order }
}

/**
 * @param order - a track order.
 * @param kind - the kind of the removed track.
 * @param track - the removed track's number.
 * @returns the order without the entry of that track.
 */
function withoutEntry(order: readonly TrackKind[], kind: TrackKind, track: number): TrackKind[] {
  let seen = -1
  return order.filter(each => each !== kind || ++seen !== track)
}

/**
 * @param order - a track order.
 * @param kind - a track kind.
 * @param count - how many tracks of that kind the timeline stores, at least the entries of that kind in `order`.
 * @returns the order with the missing entries of that kind added at the bottom.
 */
function withCount(order: readonly TrackKind[], kind: TrackKind, count: number): TrackKind[] {
  const have = order.filter(each => each === kind).length
  return [...order, ...Array.from({ length: count - have }, (): TrackKind => kind)]
}

/**
 * The timelines after one call, before `orderTracks` brings their track orders in line.
 * @param slice - the slice before the call.
 * @param call - a valid finished call.
 * @returns the timelines after it.
 */
function editTimelines(slice: Slice, call: TimelineCall): Timeline[] {
  const { timelines } = slice
  const params = call.params
  const added = reportedClips(call)
  const layout = laidOutClips(call)
  const laidOut = (): Clip[] => layout.map((clip, index) => wholeClip(added[index] as ClipId, clip.asset, clip.source))
  const id = call.operation === OPERATIONS.create ? createdTimeline(params) : targetOf(slice, params) ?? FIRST_TIMELINE_ID
  switch (call.operation) {
    case OPERATIONS.create:
      return [...timelines, { id, name: text(params['name']) ?? '', clips: laidOut(), ...noSounds() }]
    case OPERATIONS.update:
      return timelines.map(timeline => timeline.id === id ? { ...timeline, clips: laidOut() } : timeline)
    case OPERATIONS.rename:
      return timelines.map(timeline => timeline.id === id ? { ...timeline, name: String(params['name']) } : timeline)
    case OPERATIONS.delete:
      return timelines.filter(timeline => timeline.id !== id)
    case OPERATIONS.insert: {
      const clip = wholeClip(added[0] as ClipId, brandString<AssetId>(String(params['asset'])))
      const at = Number(params['at']) - 1
      if (!timelines.some(timeline => timeline.id === id)) {
        return [...timelines, { id, name: '', clips: [clip], ...noSounds() }]
      }
      return timelines.map(timeline => timeline.id === id ? { ...timeline, clips: timeline.clips.toSpliced(at, 0, clip) } : timeline)
    }
    case OPERATIONS.soundAdd: {
      const sound: Sound = {
        id: reportedSounds(call)[0] as SoundId, asset: brandString<AssetId>(String(params['asset'])), in_sec: null, out_sec: null,
        start_sec: Number(params['start_sec']), track: number(params['track']) ?? 0,
      }
      return timelines.map(timeline => timeline.id === id ? { ...timeline, sounds: [...timeline.sounds, sound] } : timeline)
    }
    case OPERATIONS.soundRemove:
      return timelines.map(timeline => ({ ...timeline, sounds: timeline.sounds.filter(sound => sound.id !== params['sound']) }))
    case OPERATIONS.soundMove:
    case OPERATIONS.soundTrim: {
      const edited = (sound: Sound): Sound => {
        if (call.operation === OPERATIONS.soundMove) {
          return { ...sound, start_sec: Number(params['start_sec']), track: number(params['track']) ?? sound.track }
        }
        const inSec = number(params['in_sec'])
        const start = round(sound.start_sec + (inSec ?? 0) - (sound.in_sec ?? 0))
        return { ...sound, in_sec: inSec, out_sec: number(params['out_sec']), start_sec: start }
      }
      return timelines.map(timeline => timeline.sounds.some(sound => sound.id === params['sound'])
        ? { ...timeline, sounds: timeline.sounds.map(sound => sound.id === params['sound'] ? edited(sound) : sound) }
        : timeline)
    }
    case OPERATIONS.soundSplit: {
      // The second part goes right after the first and starts where its in point played before.
      const at = Number(params['at_sec'])
      const split = (sound: Sound): Sound[] => sound.id !== params['sound'] ? [sound] : [
        { ...sound, out_sec: at },
        { ...sound, id: reportedSounds(call)[0] as SoundId, in_sec: at, start_sec: round(sound.start_sec + at - (sound.in_sec ?? 0)) },
      ]
      return timelines.map(timeline => timeline.sounds.some(sound => sound.id === params['sound'])
        ? { ...timeline, sounds: timeline.sounds.flatMap(split) }
        : timeline)
    }
    case OPERATIONS.soundTrackRemove: {
      const track = Number(params['track'])
      const shifted = (sounds: Timeline['sounds']): Timeline['sounds'] => sounds
        .filter(sound => sound.track !== track).map(sound => sound.track > track ? { ...sound, track: sound.track - 1 } : sound)
      const mutes = (muted: number[]): number[] => muted.filter(each => each !== track).map(each => each > track ? each - 1 : each)
      return timelines.map(timeline => timeline.id === id
        ? {
          ...timeline, sounds: shifted(timeline.sounds), sound_track_names: timeline.sound_track_names.toSpliced(track, 1),
          muted_sound_tracks: mutes(timeline.muted_sound_tracks),
        }
        : timeline)
    }
    case OPERATIONS.soundTrackRename: {
      const track = Number(params['track'])
      const named = (names: string[]): string[] => Array.from(
        { length: Math.max(names.length, track + 1) }, (_, index) => index === track ? String(params['name']).trim() : names[index] ?? '',
      )
      return timelines.map(timeline => timeline.id === id
        ? { ...timeline, sound_track_names: named(timeline.sound_track_names) }
        : timeline)
    }
    case OPERATIONS.mute: {
      const muted = params['muted'] === true
      const track = Number(params['track'])
      const tracks = (current: number[]): number[] => [...current.filter(each => each !== track), ...muted ? [track] : []]
        .sort((a, b) => a - b)
      const target = params['target']
      return timelines.map(timeline => timeline.id !== id ? timeline : target === 'video'
        ? { ...timeline, video_muted: muted }
        : target === 'video_track'
          ? { ...timeline, muted_video_tracks: tracks(timeline.muted_video_tracks) }
          : { ...timeline, muted_sound_tracks: tracks(timeline.muted_sound_tracks) })
    }
    case OPERATIONS.trackClipAdd: {
      const clip: TrackClip = {
        id: added[0] as ClipId, asset: brandString<AssetId>(String(params['asset'])), in_sec: null, out_sec: null,
        start_sec: Number(params['start_sec']), track: Number(params['track']),
      }
      return timelines.map(timeline => timeline.id === id ? { ...timeline, track_clips: [...timeline.track_clips, clip] } : timeline)
    }
    case OPERATIONS.trackAdd:
      return timelines.map(timeline => timeline.id === id
        ? { ...timeline, track_order: [...timeline.track_order, params['kind'] as TrackKind] }
        : timeline)
    case OPERATIONS.videoTrackRemove: {
      // The track's clips go, and every track with a higher number moves up one.
      const track = Number(params['track'])
      const mutes = (muted: number[]): number[] => muted.filter(each => each !== track).map(each => each > track ? each - 1 : each)
      return timelines.map(timeline => timeline.id === id
        ? {
          ...timeline,
          track_clips: timeline.track_clips.filter(clip => clip.track !== track)
            .map(clip => clip.track > track ? { ...clip, track: clip.track - 1 } : clip),
          muted_video_tracks: mutes(timeline.muted_video_tracks),
        }
        : timeline)
    }
    case OPERATIONS.videoTrackMove: {
      const moved = movedTrack(Number(params['track']), Number(params['to']))
      return timelines.map(timeline => timeline.id === id
        ? {
          ...timeline,
          track_clips: timeline.track_clips.map(clip => ({ ...clip, track: moved(clip.track) })),
          muted_video_tracks: timeline.muted_video_tracks.map(moved).sort((a, b) => a - b),
        }
        : timeline)
    }
    case OPERATIONS.mainTrackRemove:
      return timelines.map(timeline => timeline.id === id ? withoutMainTrack(timeline) : timeline)
    case OPERATIONS.mainTrackSwap: {
      // The 视频 track's clips go onto video track 0 at the stored times; `clipProblem` refuses a placeholder among them.
      const starts = reportedStarts(call)
      return timelines.map((timeline) => {
        if (timeline.id !== id) return timeline
        const lowered = timeline.clips.map(({ id: clip, asset, in_sec, out_sec }, index): TrackClip => ({
          id: clip, asset: asset as AssetId, in_sec, out_sec, start_sec: starts[index] as number, track: 0,
        }))
        const raised = withoutMainTrack(timeline)
        return {
          ...raised,
          track_clips: [...timeline.track_clips.filter(clip => clip.track !== 0), ...lowered],
          muted_video_tracks: [...timeline.video_muted ? [0] : [], ...timeline.muted_video_tracks.filter(track => track !== 0)],
        }
      })
    }
    default: {
      const found = findClip(slice, text(params['clip']))
      const crosses = found !== null && (found.onTrack ? call.operation === OPERATIONS.move : call.operation === OPERATIONS.trackClipMove)
      if (crosses) {
        return timelines.map(timeline => timeline.id === found.timeline.id ? betweenTracks(timeline, found.clip, params) : timeline)
      }
      return timelines.map(timeline => timeline.id !== found?.timeline.id ? timeline : found.onTrack
        ? { ...timeline, track_clips: editTrackClips(timeline.track_clips, call, added) }
        : { ...timeline, clips: editClips(timeline.clips, call, added) })
    }
  }
}

/**
 * A timeline after a clip moved between the 视频 track and a video track under it: `timeline.clip_move` of a track clip
 * puts it at position `to` of the 视频 track, and `timeline.track_clip_move` of a 视频 track clip puts it on `track` at
 * `start_sec`. The clip keeps its ID, asset, and in and out points; a 视频 track clip leaves its render `source` behind.
 * @param timeline - the timeline that holds the clip.
 * @param clip - the moved clip.
 * @param params - the call's params.
 * @returns the timeline after the move.
 */
function betweenTracks(timeline: Timeline, clip: Clip | TrackClip, params: Record<string, unknown>): Timeline {
  const { id, asset, in_sec, out_sec } = clip
  if ('track' in clip) {
    return {
      ...timeline,
      track_clips: timeline.track_clips.filter(each => each.id !== id),
      clips: timeline.clips.toSpliced(Number(params['to']) - 1, 0, { id, asset, source: null, in_sec, out_sec }),
    }
  }
  // `clipProblem` refuses to move a placeholder, so the clip's asset is set.
  const placed: TrackClip = { id, asset: asset as AssetId, in_sec, out_sec, start_sec: Number(params['start_sec']), track: Number(params['track']) }
  return { ...timeline, clips: timeline.clips.filter(each => each.id !== id), track_clips: [...timeline.track_clips, placed] }
}

/**
 * A timeline after `timeline.main_track_remove`: video track 0's clips, in the order of their start times, replace the
 * 视频 track's clips, its mute replaces the mute of the 视频 track's own audio, and the other video tracks move up one.
 * @param timeline - the timeline before the call.
 * @returns the timeline after it, with the order from before it.
 */
function withoutMainTrack(timeline: Timeline): Timeline {
  const promoted = timeline.track_clips.filter(clip => clip.track === 0).sort((a, b) => a.start_sec - b.start_sec)
  return {
    ...timeline,
    clips: promoted.map(({ id, asset, in_sec, out_sec }): Clip => ({ id, asset, source: null, in_sec, out_sec })),
    track_clips: timeline.track_clips.filter(clip => clip.track !== 0).map(clip => ({ ...clip, track: clip.track - 1 })),
    video_muted: timeline.muted_video_tracks.includes(0),
    muted_video_tracks: timeline.muted_video_tracks.filter(track => track !== 0).map(track => track - 1),
  }
}

/**
 * The number of each video track after `timeline.video_track_move` moves track `from` to number `to`: the tracks between
 * the two move one number toward `from`.
 * @param from - the moved track's number before the call.
 * @param to - its number after the call.
 * @returns the new number of a track by its old number.
 */
function movedTrack(from: number, to: number): (track: number) => number {
  return (track) => {
    if (track === from) return to
    if (from < to && track > from && track <= to) return track - 1
    if (from > to && track >= to && track < from) return track + 1
    return track
  }
}

/**
 * The timelines after a call that passed `clipProblem`, for the checks that need more than the slice, such as the
 * lengths of the assets of the track clips.
 * @param slice - the slice before the call.
 * @param call - the call, with the IDs it will store in `report`.
 * @returns the slice after it.
 */
export function afterCall(slice: Slice, call: TimelineCall): Slice {
  return { timelines: applyCall(slice, call) }
}

/**
 * Why a `timeline.sound_split` or `timeline.sound_trim` does not fit its sound's asset, whose length only the asset pool
 * knows: a split at or past the asset's end, or a trim whose in point is not before that end or whose out point is past it.
 * @param slice - the slice the call applies to, which holds the named sound.
 * @param call - a sound split or trim that passed `clipProblem`.
 * @param durationOf - the duration of an asset in seconds, or null when it is unknown.
 * @returns the reason, or null when the call fits or the asset's length is not known.
 */
export function soundLengthProblem(slice: Slice, call: TimelineCall, durationOf: (asset: AssetId) => number | null): string | null {
  const params = call.params
  const sound = slice.timelines.flatMap(timeline => timeline.sounds).find(entry => entry.id === params['sound']) as Sound
  const length = durationOf(sound.asset)
  if (length === null) return null
  if (call.operation === OPERATIONS.soundSplit) {
    const at = Number(params['at_sec'])
    return at < length ? null : `Sound ${sound.id} does not play ${String(at)}s of its asset; split inside its in and out points.`
  }
  const inSec = number(params['in_sec']) ?? 0
  const outSec = number(params['out_sec'])
  if (inSec >= length) return `The in point ${String(inSec)}s is not before the end of asset ${sound.asset} (${String(length)}s).`
  return outSec !== null && outSec > length ? `The out point ${String(outSec)}s is past the end of asset ${sound.asset} (${String(length)}s).` : null
}

/** The stand-in ID of the clip a `timeline.track_clip_add` adds, before the call applies and the clip gets its ID. */
export const NEW_CLIP = brandString<ClipId>('new')

/**
 * Why the track clips of a timeline cannot play: a clip whose length is unknown (an asset without a known duration and
 * no out point), a clip that starts before the timeline's start, or two clips of one track that overlap. A reason names
 * a clip by its ID, and the clip with ID `NEW_CLIP` as "the new clip".
 * @param timeline - the timeline.
 * @param durationOf - the duration of an asset in seconds, or null when it is unknown.
 * @param changed - the clip the call added or changed, which an overlap reason names first; null when the call names none.
 * @returns the reason, or null.
 */
export function trackClipProblem(
  timeline: Timeline, durationOf: (asset: AssetId) => number | null, changed: ClipId | null = null,
): string | null {
  const named = (clip: TrackClip, capital: boolean): string => clip.id === NEW_CLIP ? `${capital ? 'The' : 'the'} new clip` : `${capital ? 'Clip' : 'clip'} ${clip.id}`
  const spans: Array<{ clip: TrackClip; start: number; end: number }> = []
  for (const clip of timeline.track_clips) {
    const out = clip.out_sec ?? durationOf(clip.asset)
    if (out === null) return `The length of asset ${clip.asset} is not known yet, so ${named(clip, false)} cannot go on a video track.`
    if (clip.start_sec < 0) return `${named(clip, true)} would start ${String(round(-clip.start_sec))}s before the timeline's start.`
    spans.push({ clip, start: clip.start_sec, end: clip.start_sec + out - (clip.in_sec ?? 0) })
  }
  for (const [index, span] of spans.entries()) {
    // Two clips that only touch, one ending where the next starts, do not overlap.
    const other = spans.find((each, at) => at !== index && each.clip.track === span.clip.track
      && each.start < span.end - 0.005 && span.start < each.end - 0.005)
    if (other === undefined) continue
    const [moved, kept] = other.clip.id === changed ? [other, span] : [span, other]
    return `${named(moved.clip, true)} would overlap ${named(kept.clip, false)} on video track ${String(span.clip.track)} `
      + `(${String(round(kept.start))}s to ${String(round(kept.end))}s); pick another start_sec or track.`
  }
  return null
}

/** A time in seconds rounded to hundredths, for reasons. */
function round(seconds: number): number {
  return Math.round(seconds * 100) / 100
}

/** Whether a record is a call of a Timeline operation. */
function isTimelineCall(record: TimelineCall): boolean {
  return Object.values(OPERATIONS).includes(record.operation as never)
}

/**
 * The `timeline` reducer: the timelines with their clips and sounds, from the finished `timeline.*` records. A record
 * that does not apply to the slice it reaches (a record without the clip or sound IDs it needs) leaves the slice
 * unchanged.
 */
export const timelineReducer: Reducer<'timeline'> = {
  initial: () => ({ timelines: [] }),
  reduce(slice, record) {
    if (record.status !== 'done' || !isTimelineCall(record)) return slice
    if (clipProblem(slice, record) !== null || clipIdProblem(slice, record) !== null) return slice
    return { timelines: applyCall(slice, record) }
  },
  agentSummary(slice, assets, state) {
    // Clips are named by their ID, the way the `clip` param of the timeline operations names them; a placeholder clip
    // shows its status and the render record it waits for instead of an asset. The video tracks under the main one list
    // their clips by start time, track 0 first, and show `muted` only while it is on. A timeline with sound tracks lists each
    // track number with its name ('' when unnamed), so a request that names a track maps to its number. A mute shows
    // only while it is on: `video_muted` on the timeline and `muted` on a sound track.
    return {
      timelines: slice.timelines.map(entry => ({
        id: entry.id, name: entry.name, ...entry.video_muted ? { video_muted: true } : {},
        clips: entry.clips.map(clip => clip.asset === null
          ? {
            clip: clip.id, asset: null, status: clipStatusOf(clip, state.components.proj.records), record: clip.source?.record ?? null,
            in_sec: clip.in_sec, out_sec: clip.out_sec,
          }
          : { clip: clip.id, asset: clip.asset, url: assets.url(clip.asset), in_sec: clip.in_sec, out_sec: clip.out_sec }),
        ...videoTrackCount(entry) === 0 ? {} : {
          video_tracks: Array.from({ length: videoTrackCount(entry) }, (_, track) => ({
            track, ...entry.muted_video_tracks.includes(track) ? { muted: true } : {},
            clips: entry.track_clips.filter(clip => clip.track === track).toSorted((a, b) => a.start_sec - b.start_sec).map(clip => ({
              clip: clip.id, asset: clip.asset, url: assets.url(clip.asset), start_sec: clip.start_sec, in_sec: clip.in_sec,
              out_sec: clip.out_sec,
            })),
          })),
        },
        ...soundTrackCount(entry) === 0 ? {} : {
          sound_tracks: Array.from({ length: soundTrackCount(entry) }, (_, track) => ({
            track, name: entry.sound_track_names[track] ?? '', ...entry.muted_sound_tracks.includes(track) ? { muted: true } : {},
          })),
        },
        ...entry.sounds.length === 0 ? {} : {
          sounds: entry.sounds.map(sound => ({
            sound: sound.id, asset: sound.asset, url: assets.url(sound.asset), start_sec: sound.start_sec, in_sec: sound.in_sec,
            out_sec: sound.out_sec, track: sound.track,
          })),
        },
      })),
    }
  },
}
