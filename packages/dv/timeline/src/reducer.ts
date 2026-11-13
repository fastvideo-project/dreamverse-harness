/**
 * The Timeline reducer and the clip and sound checks it shares with the operations: how each finished `timeline.*`
 * record changes the timelines of a project, and why a record cannot apply to a given slice.
 *
 * A clip is named by its ID (`cl1`, `cl2`, …). The operations that add clips (`timeline.create`, `timeline.update`,
 * `timeline.clip_insert`, `timeline.clip_split`) store the IDs they assigned in the record's `report.clips`, and the
 * reducer reads them only from there. A sound is named by its ID (`sd1`, `sd2`, …), which `timeline.sound_add` stores
 * in `report.sounds` the same way. The operations check a call against the state before they record anything.
 *
 * A `clip` input of `timeline.create` or `timeline.update` that names a render output (`{record, output}`) becomes a
 * clip with that `source`; while the render is not done, its `resolved_asset` is null and the clip is a placeholder that
 * keeps its ID. Trim and split refuse a placeholder; move, remove and replace work on it.
 *
 * @module @dv/timeline/reducer
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ProjectRecord, Reducer } from '@dv/project'
import type { Clip, ClipId, ClipStatus, SoundId, Timeline, TimelineId, TimelineState } from './types.ts'

/** The fifteen Timeline edit operations by verb. */
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
  soundTrackRemove: 'timeline.sound_track_remove',
  soundTrackRename: 'timeline.sound_track_rename',
  mute: 'timeline.mute',
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

/** A new timeline's fields besides its ID, name and clips: no sounds, no track names, and nothing muted. */
const NO_SOUNDS = { sounds: [], sound_track_names: [], video_muted: false, muted_sound_tracks: [] } as const satisfies Partial<Timeline>

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
  return call.operation === OPERATIONS.insert || call.operation === OPERATIONS.split ? 1 : 0
}

/** The clip IDs a finished record assigned (its `report.clips`), or an empty list when it stored none. */
export function reportedClips(record: Pick<ProjectRecord, 'report'>): ClipId[] {
  const clips = record.report?.['clips']
  return Array.isArray(clips) ? clips.filter((id): id is string => typeof id === 'string').map(id => brandString<ClipId>(id)) : []
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

/** The timeline that holds a clip and the clip's index in it, or null when no timeline holds it. */
function findClip(slice: Slice, id: string | null): { timeline: Timeline; index: number } | null {
  for (const timeline of slice.timelines) {
    const index = timeline.clips.findIndex(clip => clip.id === id)
    if (index !== -1) return { timeline, index }
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
 * The number of sound tracks a timeline stores: one past the highest track that holds a sound, a name, or a mute.
 * @param timeline - the timeline to count.
 * @returns the track count, 0 for a timeline without sounds, track names, or muted tracks.
 */
function soundTrackCount(timeline: Timeline): number {
  const tracks = [...timeline.sounds.map(sound => sound.track), ...timeline.muted_sound_tracks]
  return Math.max(timeline.sound_track_names.length, ...tracks.map(track => track + 1))
}

/**
 * Why a `timeline.mute` call cannot apply besides its track: a `target` other than `video` or `sound`, or a `muted`
 * that is not a boolean.
 * @param params - the call's params.
 * @returns the reason, or null.
 */
function muteProblem(params: Record<string, unknown>): string | null {
  if (params['target'] !== 'video' && params['target'] !== 'sound') return `target ${String(params['target'])} is not video or sound.`
  return typeof params['muted'] === 'boolean' ? null : 'muted must be true or false.'
}

/**
 * Why a call that names a whole timeline cannot apply: `timeline.create` of an ID that exists, another call of a
 * timeline that does not exist, a `start_sec` of `timeline.sound_add` below 0, a sound track that is not a whole number
 * of 0 or more or that the timeline does not have, a track name that is not a string, or a bad `target` or `muted` of
 * `timeline.mute`. An insert into a timeline that
 * does not exist creates it, so the only valid position is 1.
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
    const into = timeline ?? { id: id ?? FIRST_TIMELINE_ID, name: '', clips: [], ...NO_SOUNDS }
    return positionProblem(into, number(params['at']), into.clips.length + 1)
  }
  if (timeline === undefined) return id === null ? 'The project has no timeline.' : `Timeline ${id} does not exist.`
  if (call.operation === OPERATIONS.soundAdd) {
    const start = number(params['start_sec'])
    if (start === null || start < 0) return `start_sec ${String(params['start_sec'])} is not a time of 0 seconds or more.`
  }
  if (call.operation === OPERATIONS.soundTrackRename && typeof params['name'] !== 'string') return 'name must be a string.'
  if (call.operation === OPERATIONS.mute) {
    const problem = muteProblem(params)
    // Muting the clips' own audio names no sound track.
    if (problem !== null || params['target'] === 'video') return problem
  }
  if ([OPERATIONS.soundAdd, OPERATIONS.soundTrackRemove, OPERATIONS.soundTrackRename, OPERATIONS.mute].includes(call.operation as never)) {
    const track = params['track'] === undefined && call.operation === OPERATIONS.soundAdd ? 0 : number(params['track'])
    if (track === null || !Number.isInteger(track) || track < 0) return `track ${String(params['track'])} is not a track number of 0 or more.`
    // Tracks run from 0 to the last track that holds a sound, a name, or a mute; an add, a rename, or a mute may also name
    // the track after it, and track 0 always counts, so a timeline without sounds takes tracks 0 and 1.
    const count = soundTrackCount(timeline)
    if (call.operation === OPERATIONS.soundTrackRemove ? track >= count : track > Math.max(1, count)) {
      return `Timeline ${timeline.id} has no sound track ${String(track)}; it has ${String(count)}.`
    }
  }
  return null
}

/**
 * Why a `timeline.*` call cannot apply to a slice: a timeline that a create finds or another call misses, an insert
 * position outside the timeline, a clip ID that no timeline holds, a move position outside the clip's timeline, a split
 * time outside the clip, an empty trim range, a sound ID that no timeline holds, or a bad sound start, sound track, or
 * track name. The operations throw it before they record.
 * @param slice - the slice the call applies to.
 * @param call - the call's operation and params.
 * @returns the reason a creator can read, or null when the call applies.
 */
export function clipProblem(slice: Slice, call: TimelineCall): string | null {
  const operation = call.operation
  if (!isTimelineCall(call)) return null
  const whole = [
    OPERATIONS.create, OPERATIONS.update, OPERATIONS.rename, OPERATIONS.delete, OPERATIONS.insert, OPERATIONS.soundAdd,
    OPERATIONS.soundTrackRemove, OPERATIONS.soundTrackRename, OPERATIONS.mute,
  ]
  if (whole.includes(operation as never)) {
    return timelineProblem(slice, call)
  }
  const params = call.params
  if (operation === OPERATIONS.soundRemove) {
    const sound = text(params['sound'])
    const held = slice.timelines.some(timeline => timeline.sounds.some(entry => entry.id === sound))
    return held ? null : `Sound ${String(sound)} does not exist.`
  }
  const id = text(params['clip'])
  const found = findClip(slice, id)
  if (found === null) return `Clip ${String(id)} does not exist.`
  const { timeline, index } = found
  if (operation === OPERATIONS.move) return positionProblem(timeline, number(params['to']), timeline.clips.length)
  const clip = timeline.clips[index] as Clip
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
 * adds (a record written before clips had IDs), a sound ID count other than one for `timeline.sound_add` and zero for
 * any other operation, or an ID that a clip or sound of the slice already has.
 * @param slice - the slice the record applies to.
 * @param record - a finished Timeline record.
 * @returns the reason, or null when the IDs apply.
 */
function clipIdProblem(slice: Slice, record: TimelineCall & Pick<ProjectRecord, 'report'>): string | null {
  const ids = reportedClips(record)
  const count = addedClipCount(record)
  if (ids.length !== count) return `The record stored ${String(ids.length)} clip IDs for the ${String(count)} clips it adds.`
  const taken = new Set(slice.timelines.flatMap(timeline => timeline.clips.map(clip => clip.id)))
  for (const id of ids) {
    if (taken.has(id)) return `Clip ${id} already exists.`
    taken.add(id)
  }
  const sounds = reportedSounds(record)
  if (sounds.length !== (record.operation === OPERATIONS.soundAdd ? 1 : 0)) return `The record stored ${String(sounds.length)} sound IDs.`
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
 * Apply one finished `timeline.*` call to the timelines. `timeline.create` adds a timeline, `timeline.update` replaces
 * the clips of the timeline it names, and `timeline.clip_insert` into a timeline that does not exist adds it. Rename,
 * delete, insert and the sound track operations act on the timeline their `timeline` param names, else the first
 * timeline; `timeline.sound_remove` acts on the timeline that holds the sound, and the other clip operations on the
 * timeline that holds the clip. Removing a sound track drops its sounds, its name and its mute, and every later track
 * moves up with its mute.
 * @param slice - the slice before the call.
 * @param call - a valid finished call.
 * @returns the timelines after it.
 */
function applyCall(slice: Slice, call: TimelineCall): Timeline[] {
  const { timelines } = slice
  const params = call.params
  const added = reportedClips(call)
  const layout = laidOutClips(call)
  const laidOut = (): Clip[] => layout.map((clip, index) => wholeClip(added[index] as ClipId, clip.asset, clip.source))
  const id = call.operation === OPERATIONS.create ? createdTimeline(params) : targetOf(slice, params) ?? FIRST_TIMELINE_ID
  switch (call.operation) {
    case OPERATIONS.create:
      return [...timelines, { id, name: text(params['name']) ?? '', clips: laidOut(), ...NO_SOUNDS }]
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
        return [...timelines, { id, name: '', clips: [clip], ...NO_SOUNDS }]
      }
      return timelines.map(timeline => timeline.id === id ? { ...timeline, clips: timeline.clips.toSpliced(at, 0, clip) } : timeline)
    }
    case OPERATIONS.soundAdd: {
      const sound = {
        id: reportedSounds(call)[0] as SoundId, asset: brandString<AssetId>(String(params['asset'])), start_sec: Number(params['start_sec']),
        track: number(params['track']) ?? 0,
      }
      return timelines.map(timeline => timeline.id === id ? { ...timeline, sounds: [...timeline.sounds, sound] } : timeline)
    }
    case OPERATIONS.soundRemove:
      return timelines.map(timeline => ({ ...timeline, sounds: timeline.sounds.filter(sound => sound.id !== params['sound']) }))
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
      return timelines.map(timeline => timeline.id !== id ? timeline : params['target'] === 'video'
        ? { ...timeline, video_muted: muted }
        : { ...timeline, muted_sound_tracks: tracks(timeline.muted_sound_tracks) })
    }
    default: {
      const holder = findClip(slice, text(params['clip']))?.timeline.id
      return timelines.map(timeline => timeline.id === holder ? { ...timeline, clips: editClips(timeline.clips, call, added) } : timeline)
    }
  }
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
    // shows its status and the render record it waits for instead of an asset. A timeline with sound tracks lists each
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
        ...soundTrackCount(entry) === 0 ? {} : {
          sound_tracks: Array.from({ length: soundTrackCount(entry) }, (_, track) => ({
            track, name: entry.sound_track_names[track] ?? '', ...entry.muted_sound_tracks.includes(track) ? { muted: true } : {},
          })),
        },
        ...entry.sounds.length === 0 ? {} : {
          sounds: entry.sounds.map(sound => ({
            sound: sound.id, asset: sound.asset, url: assets.url(sound.asset), start_sec: sound.start_sec, track: sound.track,
          })),
        },
      })),
    }
  },
}
