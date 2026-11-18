/**
 * The Timeline reducer and the clip and sound checks it shares with the operations: how each finished `timeline.*`
 * record changes the timelines of a project, and why a record cannot apply to a given slice.
 *
 * Every video track works the same way. A clip sits on a video track (`track`, 0 for 视频 1) from its `start_sec`; where
 * it plays, it covers every track with a higher number. A clip is named by its ID (`cl1`, `cl2`, …). The operations that
 * add clips (`timeline.create`, `timeline.update`, `timeline.clip_add`, `timeline.clip_split`) store the IDs they
 * assigned in the record's `report.clips`, and the reducer reads them only from there. `timeline.create` and
 * `timeline.update` lay their clips out one after another on 视频 1 from 0 s; the start times depend on the asset
 * lengths, which only the service knows, so the call stores them in `report.starts`. A trim of a clip's in point moves
 * its start by the same amount, so the rest of the clip stays where it played; the second part of a split starts where
 * the first part ends. Nothing else moves another clip, so a removal or a shorter clip leaves a gap.
 *
 * A sound is named by its ID (`sd1`, `sd2`, …), which `timeline.sound_add` and `timeline.sound_split` store in
 * `report.sounds` the same way. `timeline.sound_split` splits a sound in two at a time inside its asset: the first part
 * keeps the ID and ends there, and the second part starts there, at the timeline time where it played before.
 * `timeline.sound_move` sets a sound's start and sound track, and `timeline.sound_trim` its in and out points; a trim of
 * its in point moves its start by the same amount. The operations check a call against the state before they record it.
 *
 * A `clip` input of `timeline.create` or `timeline.update` that names a render output (`{record, output}`) becomes a
 * clip with that `source`; while the render is not done, its `resolved_asset` is null and the clip is a placeholder that
 * keeps its ID. Trim and split refuse a placeholder; move, remove and replace work on it.
 *
 * `timeline.video_track_move` moves a video track to another number, which sets which track covers which: the tracks
 * between the two numbers move one number toward the track's old one, and each track keeps its clips and its mute.
 * `track_order` stays as it was, so the track's clips show in the row of its new number. `track_order` follows the stored
 * tracks after every call: `timeline.track_add` and a call that names the track after the last add a track at the bottom,
 * and a track removal drops its entry. A track stays stored while `track_order` lists it, empty or not.
 *
 * @module @dv/timeline/reducer
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ProjectRecord, Reducer } from '@dv/project'
import type { Clip, ClipId, ClipStatus, Sound, SoundId, Timeline, TimelineId, TimelineState, TrackKind } from './types.ts'

/** The twenty-one Timeline edit operations by verb. */
export const OPERATIONS = {
  create: 'timeline.create',
  update: 'timeline.update',
  rename: 'timeline.rename',
  delete: 'timeline.delete',
  add: 'timeline.clip_add',
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
  trackAdd: 'timeline.track_add',
  videoTrackRemove: 'timeline.video_track_remove',
  videoTrackMove: 'timeline.video_track_move',
} as const

/** The ID a `timeline.create` without a `timeline` param creates. */
export const FIRST_TIMELINE_ID = brandString<TimelineId>('t1')

/** The stand-in ID of the clip a `timeline.clip_add` adds, before the call applies and the clip gets its ID. */
export const NEW_CLIP = brandString<ClipId>('new')

/** Seconds a clip plays whose length nothing tells, as the editor draws it (`FALLBACK_CLIP_SECONDS` of `@dv/ui-kit`). */
const FALLBACK_CLIP_SEC = 5

type Slice = TimelineState

/** The part of a record the reducer and the checks read; `report` is absent until the record finishes. */
type TimelineCall = Pick<ProjectRecord, 'operation' | 'params' | 'inputs'> & Partial<Pick<ProjectRecord, 'report'>>

/** A params field as text, or null when it is absent, empty, or not a string. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** A params field as a finite number, or null. */
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A time in seconds rounded to hundredths, for reasons and for the start a trim or a split computes. */
function round(seconds: number): number {
  return Math.round(seconds * 100) / 100
}

/**
 * A new timeline's fields besides its ID, name and clips: an empty 视频 1 and an empty sound track 0, nothing named and
 * nothing muted.
 * @returns new arrays on every call, so no two timelines share one.
 */
function emptyTracks(): Omit<Timeline, 'id' | 'name' | 'clips'> {
  return { muted_video_tracks: [], track_order: ['video', 'sound'], sounds: [], sound_track_names: [], muted_sound_tracks: [] }
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
 * The clips a `timeline.create` or `timeline.update` lays out on 视频 1, without their IDs and times: its `assets` param,
 * else its `clip` inputs in order. An input that names a render output keeps it as `source`, and its asset is null until
 * the render is done (the call is recorded while the render runs, and a failed render leaves it null).
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
 * `timeline.update`, one for `timeline.clip_add` and for `timeline.clip_split` (the second part), none otherwise.
 * @param call - a Timeline call.
 * @returns the number of clip IDs the call assigns.
 */
export function addedClipCount(call: TimelineCall): number {
  if (call.operation === OPERATIONS.create || call.operation === OPERATIONS.update) return laidOutClips(call).length
  return call.operation === OPERATIONS.add || call.operation === OPERATIONS.split ? 1 : 0
}

/** The clip IDs a finished record assigned (its `report.clips`), or an empty list when it stored none. */
export function reportedClips(record: Pick<ProjectRecord, 'report'>): ClipId[] {
  const clips = record.report?.['clips']
  return Array.isArray(clips) ? clips.filter((id): id is string => typeof id === 'string').map(id => brandString<ClipId>(id)) : []
}

/**
 * The start times a `timeline.create` or `timeline.update` stored in `report.starts`, one per clip it lays out.
 * @param record - a finished or running Timeline record.
 * @returns the numbers among them.
 */
export function reportedStarts(record: Pick<ProjectRecord, 'report'>): number[] {
  const starts = record.report?.['starts']
  return Array.isArray(starts) ? starts.filter((start): start is number => typeof start === 'number') : []
}

/** The sound IDs a finished record assigned (its `report.sounds`), or an empty list when it stored none. */
export function reportedSounds(record: Pick<ProjectRecord, 'report'>): SoundId[] {
  const sounds = record.report?.['sounds']
  return Array.isArray(sounds) ? sounds.filter((id): id is string => typeof id === 'string').map(id => brandString<SoundId>(id)) : []
}

/**
 * The seconds a clip plays: from its in point to its out point, else to the end of its asset, of the render it waits for
 * (that render's `duration_sec`), or `FALLBACK_CLIP_SEC`; at least 0.1 s, as the editor draws it.
 * @param clip - the clip, or a clip that a create or an update lays out.
 * @param durationOf - the duration of an asset in seconds, or null when it is unknown.
 * @param records - the project's records, for the planned length of a render.
 * @returns the seconds.
 */
export function clipLength(
  clip: Pick<Clip, 'asset' | 'source'> & Partial<Pick<Clip, 'in_sec' | 'out_sec'>>, durationOf: (asset: AssetId) => number | null,
  records: readonly ProjectRecord[],
): number {
  const planned = clip.source === null ? undefined : records.find(record => record.id === clip.source?.record)?.params['duration_sec']
  const length = clip.asset === null ? typeof planned === 'number' ? planned : null : durationOf(clip.asset)
  return Math.max(0.1, (clip.out_sec ?? length ?? FALLBACK_CLIP_SEC) - (clip.in_sec ?? 0))
}

/** Where one clip plays. */
export interface PlacedClip {
  clip: Clip
  start: number
  end: number
}

/**
 * Where the clips of one timeline play: each from its `start_sec`, or where the clip before it on its track ends when
 * that is later, so the clips of a track never overlap.
 * @param clips - the timeline's clips.
 * @param lengthOf - the seconds a clip plays.
 * @returns each clip's start and end, in the order of `clips`.
 */
export function placeClips(clips: readonly Clip[], lengthOf: (clip: Clip) => number): PlacedClip[] {
  const ends = new Map<number, number>()
  const placed = new Map<Clip, PlacedClip>()
  for (const clip of clips.toSorted((a, b) => a.start_sec - b.start_sec)) {
    const start = Math.max(clip.start_sec, ends.get(clip.track) ?? 0)
    const end = start + lengthOf(clip)
    ends.set(clip.track, end)
    placed.set(clip, { clip, start, end })
  }
  return clips.map(clip => placed.get(clip) as PlacedClip)
}

/**
 * The start times at which a `timeline.create` or `timeline.update` lays its clips out on 视频 1: one after another from
 * 0 s, each as long as `clipLength` makes it.
 * @param call - the create or update call.
 * @param durationOf - the duration of an asset in seconds, or null when it is unknown.
 * @param records - the project's records, for the planned length of a render.
 * @returns the start times in play order.
 */
export function laidOutStarts(
  call: TimelineCall, durationOf: (asset: AssetId) => number | null, records: readonly ProjectRecord[],
): number[] {
  let cursor = 0
  return laidOutClips(call).map((clip) => {
    const start = round(cursor)
    cursor += clipLength(clip, durationOf, records)
    return start
  })
}

/** A clip that plays the whole asset; a null asset makes a placeholder that waits for `source`. */
function wholeClip(id: ClipId, asset: AssetId | null, source: Clip['source'], start: number, track: number): Clip {
  return { id, asset, source, in_sec: null, out_sec: null, start_sec: start, track }
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

/** The timeline that holds a clip and the clip; null when no timeline holds it. */
function findClip(slice: Slice, id: string | null): { timeline: Timeline; clip: Clip } | null {
  for (const timeline of slice.timelines) {
    const clip = timeline.clips.find(entry => entry.id === id)
    if (clip !== undefined) return { timeline, clip }
  }
  return null
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
 * The number of video tracks a timeline stores: one past the highest track that holds a clip or a mute, and at least the
 * number of `video` entries of `track_order`, which keep empty tracks.
 * @param timeline - the timeline to count.
 * @returns the track count, 0 once every video track was removed.
 */
export function videoTrackCount(timeline: Pick<Timeline, 'clips' | 'muted_video_tracks' | 'track_order'>): number {
  return Math.max(
    timeline.track_order.filter(kind => kind === 'video').length,
    ...timeline.clips.map(clip => clip.track + 1), ...timeline.muted_video_tracks.map(track => track + 1),
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
  return (remove ? track >= count : track > count) ? `Timeline ${timeline.id} has no video track ${String(track)}; it has ${String(count)}.` : null
}

/**
 * Why a sound track number is not a track that a call may name: not a whole number of 0 or more, or past the track after
 * the last stored track (`remove` names only a stored track).
 * @param timeline - the timeline.
 * @param value - the call's `track` param.
 * @param remove - whether the call needs a stored track.
 * @returns the reason, or null.
 */
function soundTrackProblem(timeline: Timeline, value: unknown, remove: boolean): string | null {
  const track = trackNumber(value)
  if (track === null) return `track ${String(value)} is not a track number of 0 or more.`
  const count = soundTrackCount(timeline)
  return (remove ? track >= count : track > count) ? `Timeline ${timeline.id} has no sound track ${String(track)}; it has ${String(count)}.` : null
}

/** Why a `start_sec` param is not a time of 0 seconds or more, or null. */
function startProblem(params: Record<string, unknown>): string | null {
  const start = number(params['start_sec'])
  return start === null || start < 0 ? `start_sec ${String(params['start_sec'])} is not a time of 0 seconds or more.` : null
}

/** The `target` values of `timeline.mute`. */
const MUTE_TARGETS = ['video_track', 'sound']

/**
 * Why a call that names a whole timeline cannot apply: `timeline.create` of an ID that exists, another call of a
 * timeline that does not exist, a start time below 0, a track number that is not a whole number of 0 or more or that the
 * timeline does not have, a track name that is not a string, a `kind` other than `video` or `sound`, or a `target` other
 * than `video_track` or `sound` or a `muted` that is not a boolean of `timeline.mute`.
 * @param slice - the slice the call applies to.
 * @param call - a whole-timeline call, an add, or a sound call that names a timeline.
 * @returns the reason, or null when the call applies.
 */
function timelineProblem(slice: Slice, call: TimelineCall): string | null {
  const params = call.params
  if (call.operation === OPERATIONS.create) {
    const id = createdTimeline(params)
    return slice.timelines.some(timeline => timeline.id === id) ? `Timeline ${id} exists; call dv_timeline_update to replace its clips.` : null
  }
  const id = targetOf(slice, params)
  const timeline = slice.timelines.find(candidate => candidate.id === id)
  if (timeline === undefined) return id === null ? 'The project has no timeline.' : `Timeline ${id} does not exist.`
  switch (call.operation) {
    case OPERATIONS.add:
      return startProblem(params) ?? videoTrackProblem(timeline, params['track'], false)
    case OPERATIONS.soundAdd:
      return startProblem(params) ?? soundTrackProblem(timeline, params['track'] ?? 0, false)
    case OPERATIONS.soundTrackRename:
      return typeof params['name'] === 'string' ? soundTrackProblem(timeline, params['track'], false) : 'name must be a string.'
    case OPERATIONS.soundTrackRemove:
      return soundTrackProblem(timeline, params['track'], true)
    case OPERATIONS.trackAdd:
      return TRACK_KINDS.includes(params['kind'] as never) ? null : `kind ${String(params['kind'])} is not video or sound.`
    case OPERATIONS.videoTrackRemove:
      return videoTrackProblem(timeline, params['track'], true)
    case OPERATIONS.videoTrackMove:
      return videoTrackProblem(timeline, params['track'], true) ?? videoTrackProblem(timeline, params['to'], true, 'to')
    case OPERATIONS.mute:
      if (!MUTE_TARGETS.includes(params['target'] as never)) return `target ${String(params['target'])} is not video_track or sound.`
      if (typeof params['muted'] !== 'boolean') return 'muted must be true or false.'
      return params['target'] === 'video_track'
        ? videoTrackProblem(timeline, params['track'], false)
        : soundTrackProblem(timeline, params['track'], false)
    default:
      return null
  }
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
    return startProblem(params) ?? (params['track'] === undefined ? null : soundTrackProblem(timeline, params['track'], false))
  }
  if (call.operation === OPERATIONS.soundTrim) {
    return rangeProblem(params) ?? (sound.start_sec + (number(params['in_sec']) ?? 0) - (sound.in_sec ?? 0) < 0
      ? `The in point ${String(params['in_sec'])}s would start sound ${sound.id} before the timeline's start.`
      : null)
  }
  return null
}

/** Why the `in_sec` and `out_sec` of a trim leave no range: an in point before the asset's start or an out point not after it. */
function rangeProblem(params: Record<string, unknown>): string | null {
  const inSec = number(params['in_sec'])
  const outSec = number(params['out_sec'])
  if ((inSec ?? 0) < 0) return `The in point ${String(inSec)}s is before the asset's start.`
  return outSec !== null && outSec <= (inSec ?? 0) ? `The out point ${String(outSec)}s is not after the in point ${String(inSec ?? 0)}s.` : null
}

/**
 * Why a call that names a clip cannot apply to it: a move to a start before 0 or to a video track the timeline cannot
 * take, a split or a trim of a placeholder, a split time outside the clip, a trim that leaves no range or would start the
 * clip before the timeline's start.
 * @param timeline - the timeline that holds the clip.
 * @param clip - the named clip.
 * @param call - a `timeline.clip_*` call that names a clip.
 * @returns the reason, or null when the call applies.
 */
function clipCallProblem(timeline: Timeline, clip: Clip, call: TimelineCall): string | null {
  const params = call.params
  if (call.operation === OPERATIONS.move) {
    return startProblem(params) ?? (params['track'] === undefined ? null : videoTrackProblem(timeline, params['track'], false))
  }
  if ((call.operation === OPERATIONS.split || call.operation === OPERATIONS.trim) && clip.asset === null) return `Clip ${clip.id} is still rendering.`
  if (call.operation === OPERATIONS.split) {
    const at = number(params['at_sec'])
    const inside = at !== null && at > (clip.in_sec ?? 0) && (clip.out_sec === null || at < clip.out_sec)
    return inside ? null : `Clip ${clip.id} does not play ${String(params['at_sec'])}s of its asset; split inside its in and out points.`
  }
  if (call.operation === OPERATIONS.trim) {
    return rangeProblem(params) ?? (clip.start_sec + (number(params['in_sec']) ?? 0) - (clip.in_sec ?? 0) < 0
      ? `The in point ${String(params['in_sec'])}s would start clip ${clip.id} before the timeline's start.`
      : null)
  }
  return null
}

/** The operations that name a whole timeline rather than a clip or a sound. */
const WHOLE: readonly string[] = [
  OPERATIONS.create, OPERATIONS.update, OPERATIONS.rename, OPERATIONS.delete, OPERATIONS.add, OPERATIONS.soundAdd,
  OPERATIONS.soundTrackRemove, OPERATIONS.soundTrackRename, OPERATIONS.mute, OPERATIONS.trackAdd, OPERATIONS.videoTrackRemove,
  OPERATIONS.videoTrackMove,
]

/** The operations that name a sound. */
const SOUND_CALLS: readonly string[] = [OPERATIONS.soundRemove, OPERATIONS.soundSplit, OPERATIONS.soundMove, OPERATIONS.soundTrim]

/**
 * Why a `timeline.*` call cannot apply to a slice: a timeline that a create finds or another call misses, a clip or a
 * sound that no timeline holds, or what `timelineProblem`, `clipCallProblem` and `soundProblem` find. The operations
 * throw it before they record.
 * @param slice - the slice the call applies to.
 * @param call - the call's operation and params.
 * @returns the reason a creator can read, or null when the call applies.
 */
export function clipProblem(slice: Slice, call: TimelineCall): string | null {
  if (!isTimelineCall(call)) return null
  const params = call.params
  if (WHOLE.includes(call.operation as string)) return timelineProblem(slice, call)
  if (SOUND_CALLS.includes(call.operation as string)) {
    const id = text(params['sound'])
    const holder = slice.timelines.find(timeline => timeline.sounds.some(entry => entry.id === id))
    const sound = holder?.sounds.find(entry => entry.id === id)
    return holder === undefined || sound === undefined ? `Sound ${String(id)} does not exist.` : soundProblem(holder, sound, call)
  }
  const found = findClip(slice, text(params['clip']))
  return found === null ? `Clip ${String(params['clip'])} does not exist.` : clipCallProblem(found.timeline, found.clip, call)
}

/**
 * Why the IDs and times of a finished record cannot apply: the record stored fewer or more clip IDs than the clips it
 * adds, a `timeline.create` or `timeline.update` without one start time per clip it lays out, a sound ID count other than
 * one for `timeline.sound_add` and `timeline.sound_split` and zero for any other operation, or an ID that a clip or sound
 * of the slice already has.
 * @param slice - the slice the record applies to.
 * @param record - a finished Timeline record.
 * @returns the reason, or null when the record applies.
 */
function clipIdProblem(slice: Slice, record: TimelineCall & Pick<ProjectRecord, 'report'>): string | null {
  const ids = reportedClips(record)
  const count = addedClipCount(record)
  if (ids.length !== count) return `The record stored ${String(ids.length)} clip IDs for the ${String(count)} clips it adds.`
  const laysOut = record.operation === OPERATIONS.create || record.operation === OPERATIONS.update
  if (laysOut && reportedStarts(record).length !== count) return `The record stored ${String(reportedStarts(record).length)} start times for ${String(count)} clips.`
  const taken = new Set(slice.timelines.flatMap(timeline => timeline.clips.map(clip => clip.id)))
  for (const id of ids) {
    if (taken.has(id)) return `Clip ${id} already exists.`
    taken.add(id)
  }
  const sounds = reportedSounds(record)
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
  switch (call.operation) {
    case OPERATIONS.move:
      return clips.with(index, { ...clip, start_sec: Number(params['start_sec']), track: number(params['track']) ?? clip.track })
    case OPERATIONS.remove:
      return clips.toSpliced(index, 1)
    case OPERATIONS.split: {
      // `at_sec` is a time inside the clip's asset, so both parts play the same asset: the first keeps the clip's ID and
      // ends there, the second gets the assigned ID and starts there, where it played before.
      const at = Number(params['at_sec'])
      const second = { ...clip, id: added[0] as ClipId, in_sec: at, start_sec: round(clip.start_sec + at - (clip.in_sec ?? 0)) }
      return clips.toSpliced(index, 1, { ...clip, out_sec: at }, second)
    }
    case OPERATIONS.trim: {
      const inSec = number(params['in_sec'])
      const start = round(clip.start_sec + (inSec ?? 0) - (clip.in_sec ?? 0))
      return clips.with(index, { ...clip, in_sec: inSec, out_sec: number(params['out_sec']), start_sec: start })
    }
    case OPERATIONS.replace:
      return clips.with(index, wholeClip(clip.id, brandString<AssetId>(String(params['asset'])), null, clip.start_sec, clip.track))
    /* v8 ignore next 2 -- `editTimelines` passes only the clip operations that name a clip. */
    default:
      return clips
  }
}

/**
 * The timelines after one call, with each changed timeline's `track_order` brought in line with its stored tracks.
 * @param slice - the slice before the call.
 * @param call - a valid finished call.
 * @returns the timelines after it.
 */
function applyCall(slice: Slice, call: TimelineCall): Timeline[] {
  return editTimelines(slice, call).map(timeline => slice.timelines.includes(timeline) ? timeline : orderTracks(timeline, call))
}

/**
 * A changed timeline with its `track_order` brought in line with its stored tracks: a removed track's entry goes, and
 * tracks that a call stored by naming the track after the last go at the bottom.
 * @param timeline - the timeline after the call, with the order from before it.
 * @param call - the call that changed it.
 * @returns the timeline with its new order.
 */
function orderTracks(timeline: Timeline, call: TimelineCall): Timeline {
  const removed: TrackKind | null = call.operation === OPERATIONS.videoTrackRemove ? 'video'
    : call.operation === OPERATIONS.soundTrackRemove ? 'sound' : null
  let order = removed === null ? timeline.track_order : withoutEntry(timeline.track_order, removed, Number(call.params['track']))
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
 * The number of each track after a move of track `from` to number `to`: the tracks between the two move one number
 * toward `from`.
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
 * @param numbers - track numbers.
 * @param track - a removed track.
 * @returns the numbers without the removed track, each later one moved up one.
 */
function withoutTrack(numbers: number[], track: number): number[] {
  return numbers.filter(each => each !== track).map(each => each > track ? each - 1 : each)
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
  const id = call.operation === OPERATIONS.create ? createdTimeline(params) : targetOf(slice, params) as TimelineId
  const change = (edit: (timeline: Timeline) => Timeline): Timeline[] =>
    timelines.map(timeline => timeline.id === id ? edit(timeline) : timeline)
  // A create or an update lays its clips out on 视频 1 at the start times the call stored.
  const starts = reportedStarts(call)
  const laidOut = (): Clip[] => laidOutClips(call).map((clip, index) =>
    wholeClip(added[index] as ClipId, clip.asset, clip.source, starts[index] as number, 0))
  switch (call.operation) {
    case OPERATIONS.create:
      return [...timelines, { id, name: text(params['name']) ?? '', clips: laidOut(), ...emptyTracks() }]
    case OPERATIONS.update:
      return change(timeline => ({ ...timeline, clips: [...laidOut(), ...timeline.clips.filter(clip => clip.track !== 0)] }))
    case OPERATIONS.rename:
      return change(timeline => ({ ...timeline, name: String(params['name']) }))
    case OPERATIONS.delete:
      return timelines.filter(timeline => timeline.id !== id)
    case OPERATIONS.add: {
      const clip = wholeClip(added[0] as ClipId, brandString<AssetId>(String(params['asset'])), null, Number(params['start_sec']), Number(params['track']))
      return change(timeline => ({ ...timeline, clips: [...timeline.clips, clip] }))
    }
    case OPERATIONS.soundAdd: {
      const sound: Sound = {
        id: reportedSounds(call)[0] as SoundId, asset: brandString<AssetId>(String(params['asset'])), in_sec: null, out_sec: null,
        start_sec: Number(params['start_sec']), track: number(params['track']) ?? 0,
      }
      return change(timeline => ({ ...timeline, sounds: [...timeline.sounds, sound] }))
    }
    case OPERATIONS.soundRemove:
      return timelines.map(timeline => timeline.sounds.some(sound => sound.id === params['sound'])
        ? { ...timeline, sounds: timeline.sounds.filter(sound => sound.id !== params['sound']) }
        : timeline)
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
      return change(timeline => ({
        ...timeline,
        sounds: timeline.sounds.filter(sound => sound.track !== track)
          .map(sound => sound.track > track ? { ...sound, track: sound.track - 1 } : sound),
        sound_track_names: timeline.sound_track_names.toSpliced(track, 1),
        muted_sound_tracks: withoutTrack(timeline.muted_sound_tracks, track),
      }))
    }
    case OPERATIONS.soundTrackRename: {
      const track = Number(params['track'])
      const named = (names: string[]): string[] => Array.from(
        { length: Math.max(names.length, track + 1) }, (_, index) => index === track ? String(params['name']).trim() : names[index] ?? '',
      )
      return change(timeline => ({ ...timeline, sound_track_names: named(timeline.sound_track_names) }))
    }
    case OPERATIONS.mute: {
      const muted = params['muted'] === true
      const track = Number(params['track'])
      const tracks = (current: number[]): number[] =>
        [...current.filter(each => each !== track), ...muted ? [track] : []].sort((a, b) => a - b)
      return change(timeline => params['target'] === 'video_track'
        ? { ...timeline, muted_video_tracks: tracks(timeline.muted_video_tracks) }
        : { ...timeline, muted_sound_tracks: tracks(timeline.muted_sound_tracks) })
    }
    case OPERATIONS.trackAdd:
      return change(timeline => ({ ...timeline, track_order: [...timeline.track_order, params['kind'] as TrackKind] }))
    case OPERATIONS.videoTrackRemove: {
      // The track's clips go, and every track with a higher number moves up one.
      const track = Number(params['track'])
      return change(timeline => ({
        ...timeline,
        clips: timeline.clips.filter(clip => clip.track !== track)
          .map(clip => clip.track > track ? { ...clip, track: clip.track - 1 } : clip),
        muted_video_tracks: withoutTrack(timeline.muted_video_tracks, track),
      }))
    }
    case OPERATIONS.videoTrackMove: {
      const moved = movedTrack(Number(params['track']), Number(params['to']))
      return change(timeline => ({
        ...timeline,
        clips: timeline.clips.map(clip => ({ ...clip, track: moved(clip.track) })),
        muted_video_tracks: timeline.muted_video_tracks.map(moved).sort((a, b) => a - b),
      }))
    }
    default: {
      const holder = (findClip(slice, text(params['clip'])) as { timeline: Timeline }).timeline
      return timelines.map(timeline => timeline === holder ? { ...timeline, clips: editClips(timeline.clips, call, added) } : timeline)
    }
  }
}

/**
 * The timelines after a call that passed `clipProblem`, for the checks that need more than the slice, such as the
 * lengths of the assets.
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

/** How far apart two times may be and still count as the same, so that rounding to hundredths does not count. */
const SAME_TIME = 0.005

/**
 * Whether a call moved a clip in time: its start changed, and by more than its in point did. A trim moves the start
 * only by as much as the in point, and a replacement keeps the start while it clears the in point; neither is a move.
 * @param before - the clip before the call.
 * @param after - the clip after the call.
 * @returns true for a move.
 */
function startMoved(before: Clip, after: Clip): boolean {
  const shift = after.start_sec - before.start_sec
  return Math.abs(shift) > SAME_TIME && Math.abs(shift - (after.in_sec ?? 0) + (before.in_sec ?? 0)) > SAME_TIME
}

/**
 * Why a clip that a call adds or changes cannot play where it is: it would overlap another clip of its track. Clips play
 * where `placeClips` puts them, so an overlap would push a clip later instead; a call may not do that. The call is refused
 * when it would push another clip of the track later than it played before the call, or when the clip would not play
 * from its own start time while it did before the call (a clip that an add or a move places always must). A clip that a
 * longer render already pushed may stay pushed, so an edit of it, such as a trim or a replacement, goes through. A reason
 * names a clip by its ID, and the clip with ID `NEW_CLIP` as "the new clip".
 * @param before - the timeline before the call.
 * @param after - the timeline after the call.
 * @param lengthOf - the seconds a clip plays.
 * @param changed - the clip the call added or changed.
 * @returns the reason, or null.
 */
export function overlapProblem(before: Timeline, after: Timeline, lengthOf: (clip: Clip) => number, changed: ClipId): string | null {
  const placedBefore = new Map(placeClips(before.clips, lengthOf).map(placed => [placed.clip.id, placed]))
  const placedAfter = placeClips(after.clips, lengthOf)
  const self = placedAfter.find(placed => placed.clip.id === changed) as PlacedClip
  const { track } = self.clip
  const name = changed === NEW_CLIP ? 'The new clip' : `Clip ${changed}`
  const reason = (other: PlacedClip): string => `${name} would overlap clip ${other.clip.id} on video track ${String(track)} `
    + `(${String(round(other.start))}s to ${String(round(other.end))}s); pick another start_sec or track.`
  const old = placedBefore.get(changed)
  const moved = old === undefined || old.clip.track !== track || startMoved(old.clip, self.clip)
  const wasPushed = old !== undefined && old.start > old.clip.start_sec + SAME_TIME
  if (self.start > self.clip.start_sec + SAME_TIME && (moved || !wasPushed)) {
    // Two clips that only touch, one ending where the next starts, do not overlap.
    const earlier = placedAfter.find(placed => placed !== self && placed.clip.track === track
      && placed.start <= self.clip.start_sec + SAME_TIME && placed.end > self.clip.start_sec + SAME_TIME) as PlacedClip
    return reason(earlier)
  }
  // Every clip besides the changed one was there before the call.
  const pushed = placedAfter.find(placed => placed !== self && placed.clip.track === track
    && placed.start > (placedBefore.get(placed.clip.id) as PlacedClip).start + SAME_TIME)
  return pushed === undefined ? null : reason(placedBefore.get(pushed.clip.id) as PlacedClip)
}

/** Whether a record is a call of a Timeline operation. */
function isTimelineCall(record: TimelineCall): boolean {
  return Object.values(OPERATIONS).includes(record.operation as never)
}

/**
 * The `timeline` reducer: the timelines with their clips and sounds, from the finished `timeline.*` records. A record
 * that does not apply to the slice it reaches (a record without the clip IDs, start times or sound IDs it needs, or the
 * record of an operation that this build does not have) leaves the slice unchanged.
 */
export const timelineReducer: Reducer<'timeline'> = {
  initial: () => ({ timelines: [] }),
  reduce(slice, record) {
    if (record.status !== 'done' || !isTimelineCall(record)) return slice
    if (clipProblem(slice, record) !== null || clipIdProblem(slice, record) !== null) return slice
    return { timelines: applyCall(slice, record) }
  },
  agentSummary(slice, assets, state) {
    // Clips are named by their ID, the way the `clip` param of the timeline operations names them, and listed by video
    // track, track 0 (视频 1) first, each track's clips by start time; a placeholder clip shows its status and the render
    // record it waits for instead of an asset. A timeline with sound tracks lists each track number with its name (''
    // when unnamed), so a request that names a track maps to its number. A mute shows only while it is on.
    return {
      timelines: slice.timelines.map(entry => ({
        id: entry.id, name: entry.name,
        video_tracks: Array.from({ length: videoTrackCount(entry) }, (_, track) => ({
          track, ...entry.muted_video_tracks.includes(track) ? { muted: true } : {},
          clips: entry.clips.filter(clip => clip.track === track).toSorted((a, b) => a.start_sec - b.start_sec).map(clip => ({
            clip: clip.id,
            ...clip.asset === null
              ? { asset: null, status: clipStatusOf(clip, state.components.proj.records), record: clip.source?.record ?? null }
              : { asset: clip.asset, url: assets.url(clip.asset) },
            start_sec: clip.start_sec, in_sec: clip.in_sec, out_sec: clip.out_sec,
          })),
        })),
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
