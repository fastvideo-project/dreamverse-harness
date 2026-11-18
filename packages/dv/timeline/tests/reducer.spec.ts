/** The pure `timeline` reducer: every operation's effect on the slice, and the clip and clip ID checks. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ComponentStates, ProjectRecord, ProjectState, RecordId } from '@dv/project'
import { describe, expect, it } from 'vitest'
import {
  afterCall, clipLength, clipProblem, FIRST_TIMELINE_ID, laidOutStarts, NEW_CLIP, overlapProblem, placeClips, soundLengthProblem,
  timelineReducer, videoTrackCount,
} from '../src/reducer.ts'
import type { Clip, ClipId, Timeline } from '../src/types.ts'

let counter = 0

/** A finished record of one operation with the given params. */
function edit(operation: string, params: Record<string, unknown>, fields: Partial<ProjectRecord> = {}): ProjectRecord {
  counter += 1
  return {
    id: brandString<RecordId>(`record-${counter}`), parents: [], kind: 'operation', component: 'timeline', operation,
    operation_version: '1', actor: 'user', surface: 'timeline', turn: null, session: null, tool_call: null, intent: 'edit', params,
    inputs: [], outputs: [], based_on: null, supersedes: [], deterministic: false, status: 'done', created_at: new Date().toISOString(),
    ...fields,
  }
}

/**
 * A finished record of an operation that adds clips, with the clip IDs it stored in `report.clips`; a create or an update
 * also stores a start time 5 s after the one before for each clip, unless `fields.report` gives its own.
 */
function adding(operation: string, params: Record<string, unknown>, clips: string[], fields: Partial<ProjectRecord> = {}): ProjectRecord {
  const laysOut = operation === 'timeline.create' || operation === 'timeline.update'
  const starts = laysOut ? { starts: clips.map((_, index) => index * 5) } : {}
  return edit(operation, params, { ...fields, report: { clips, ...starts, ...fields.report } })
}

/** A finished `timeline.sound_add` record with the sound IDs it stored in `report.sounds`. */
function soundAdd(params: Record<string, unknown>, sounds: unknown[]): ProjectRecord {
  return edit('timeline.sound_add', params, { report: { sounds } })
}

/** Reduce records in order from the initial slice. */
function reduceAll(records: ProjectRecord[], slice: ComponentStates['timeline'] = timelineReducer.initial()): ComponentStates['timeline'] {
  return records.reduce((current, record) => timelineReducer.reduce(current, record), slice)
}

/** The clips of one timeline as `id asset track@start in-out` text, for compact expectations. */
function clipsOf(slice: ComponentStates['timeline'], id = 't1'): string[] {
  const timeline = slice.timelines.find(candidate => candidate.id === id)
  return timeline?.clips.map(clip => `${clip.id} ${String(clip.asset)} ${String(clip.track)}@${String(clip.start_sec)} ${String(clip.in_sec)}-${String(clip.out_sec)}`) ?? []
}

const problem = (slice: ComponentStates['timeline'], record: ProjectRecord): string | null => clipProblem(slice, record)

/** The sounds of one timeline as `id asset start track` text, for compact expectations. */
function soundsOf(slice: ComponentStates['timeline'], id = 't1'): string[] {
  const timeline = slice.timelines.find(candidate => candidate.id === id)
  return timeline?.sounds.map(sound => `${sound.id} ${sound.asset} ${String(sound.start_sec)} ${String(sound.track)}`) ?? []
}

/** A slice with timeline t1 holding clips cl1, cl2 and cl3 of assets a, b and c on 视频 1 at 0 s, 5 s and 10 s. */
const base = (): ComponentStates['timeline'] => reduceAll([adding('timeline.create', { assets: ['a', 'b', 'c'] }, ['cl1', 'cl2', 'cl3'])])

/** The base with clip cl4 of asset v on video track 1 at 2 s and cl5 of asset w on video track 2 at 0 s. */
const layered = (): ComponentStates['timeline'] => reduceAll([
  adding('timeline.clip_add', { timeline: 't1', asset: 'v', track: 1, start_sec: 2 }, ['cl4']),
  adding('timeline.clip_add', { timeline: 't1', asset: 'w', track: 2, start_sec: 0 }, ['cl5']),
], base())

/** A timeline's fields besides its ID, name and clips, as a new timeline has them. */
const EMPTY_TRACKS = { muted_video_tracks: [], track_order: ['video', 'sound'], sounds: [], sound_track_names: [], muted_sound_tracks: [] }

describe('timeline reducer', () => {
  it('creates, updates, renames and deletes whole timelines, laying the clips out on 视频 1 at the stored start times', () => {
    const first = adding('timeline.create', { assets: ['a', 'b'] }, ['cl1', 'cl2'], { report: { starts: [0, 2.5] } })
    const second = adding('timeline.create', { timeline: 't2', name: 'B side', assets: ['c'] }, ['cl3'])
    const slice = reduceAll([first, second])
    expect(slice.timelines.map(timeline => [timeline.id, timeline.name])).toEqual([[FIRST_TIMELINE_ID, ''], ['t2', 'B side']])
    expect(clipsOf(slice)).toEqual(['cl1 a 0@0 null-null', 'cl2 b 0@2.5 null-null'])
    const [one, two] = slice.timelines
    const shared = [one?.sounds === two?.sounds, one?.sound_track_names === two?.sound_track_names, one?.track_order === two?.track_order]
    expect([...shared, one?.muted_sound_tracks === two?.muted_sound_tracks, one?.muted_video_tracks === two?.muted_video_tracks])
      .toEqual([false, false, false, false, false])
    // create only creates: a create of an existing ID changes nothing; update replaces the clips and keeps the name.
    expect(reduceAll([adding('timeline.create', { assets: ['d'] }, ['cl4'])], slice)).toBe(slice)
    expect(clipsOf(reduceAll([adding('timeline.update', { timeline: 't1', assets: ['d'] }, ['cl4'])], slice))).toEqual(['cl4 d 0@0 null-null'])
    expect(reduceAll([adding('timeline.update', { timeline: 't2', assets: [] }, [])], slice).timelines[1])
      .toEqual({ id: 't2', name: 'B side', clips: [], ...EMPTY_TRACKS })
    const renamed = reduceAll([edit('timeline.rename', { timeline: 't2', name: '片尾' })], slice)
    expect(renamed.timelines.map(timeline => timeline.name)).toEqual(['', '片尾'])
    expect(reduceAll([edit('timeline.delete', { timeline: 't1' })], slice).timelines.map(timeline => timeline.id)).toEqual(['t2'])
    expect(reduceAll([adding('timeline.create', { timeline: 't3' }, [])], slice).timelines[2]).toEqual({ id: 't3', name: '', clips: [], ...EMPTY_TRACKS })
  })

  it('replaces only the clips of 视频 1 on an update, and keeps the other video tracks', () => {
    const updated = reduceAll([adding('timeline.update', { timeline: 't1', assets: ['d', 'e'] }, ['cl6', 'cl7'])], layered())
    expect(clipsOf(updated)).toEqual(['cl6 d 0@0 null-null', 'cl7 e 0@5 null-null', 'cl4 v 1@2 null-null', 'cl5 w 2@0 null-null'])
  })

  it('keeps a clip input whose render is not done as a placeholder clip with its clip ID', () => {
    const producer = brandString<RecordId>('shot')
    const asset = brandString<AssetId>('v')
    const inputs = [
      { role: 'clip', ref: { record: producer, output: 0 }, resolved_asset: asset },
      { role: 'clip', ref: { record: producer, output: 1 }, resolved_asset: null },
      { role: 'other', ref: { asset }, resolved_asset: asset },
    ]
    const created = reduceAll([adding('timeline.create', {}, ['cl1', 'cl2'], { inputs })])
    expect(clipsOf(created)).toEqual(['cl1 v 0@0 null-null', 'cl2 null 0@5 null-null'])
    expect(created.timelines[0]?.clips.map(clip => clip.source)).toEqual([{ record: producer, output: 0 }, { record: producer, output: 1 }])
    const updated = reduceAll([adding('timeline.update', { timeline: 't1' }, ['cl3', 'cl4'], { inputs })], created)
    expect(clipsOf(updated)).toEqual(['cl3 v 0@0 null-null', 'cl4 null 0@5 null-null'])
    // A clip of an asset param has no source.
    expect(base().timelines[0]?.clips[0]?.source).toBeNull()
  })

  it('refuses to trim or split a placeholder clip, and moves, removes and replaces it', () => {
    const inputs = [{ role: 'clip', ref: { record: brandString<RecordId>('shot'), output: 0 }, resolved_asset: null }]
    const slice = reduceAll([adding('timeline.create', {}, ['cl1'], { inputs })])
    expect(problem(slice, edit('timeline.clip_trim', { clip: 'cl1', in_sec: 1 }))).toBe('Clip cl1 is still rendering.')
    expect(problem(slice, adding('timeline.clip_split', { clip: 'cl1', at_sec: 1 }, ['cl2']))).toBe('Clip cl1 is still rendering.')
    expect(clipsOf(reduceAll([edit('timeline.clip_move', { clip: 'cl1', start_sec: 3, track: 1 })], slice))).toEqual(['cl1 null 1@3 null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_remove', { clip: 'cl1' })], slice))).toEqual([])
    const replaced = reduceAll([edit('timeline.clip_replace', { clip: 'cl1', asset: 'z' })], slice)
    expect(replaced.timelines[0]?.clips[0]).toEqual({ id: 'cl1', asset: 'z', source: null, in_sec: null, out_sec: null, start_sec: 0, track: 0 })
  })

  it('adds, moves, removes, splits, trims and replaces clips by clip ID, leaving the other clips where they play', () => {
    const slice = base()
    expect(clipsOf(reduceAll([adding('timeline.clip_add', { asset: 'd', track: 0, start_sec: 20 }, ['cl4'])], slice)))
      .toEqual(['cl1 a 0@0 null-null', 'cl2 b 0@5 null-null', 'cl3 c 0@10 null-null', 'cl4 d 0@20 null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_move', { clip: 'cl3', start_sec: 30 })], slice)))
      .toEqual(['cl1 a 0@0 null-null', 'cl2 b 0@5 null-null', 'cl3 c 0@30 null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_move', { clip: 'cl1', start_sec: 1, track: 1 })], slice))[0]).toBe('cl1 a 1@1 null-null')
    // A removal leaves a gap: the clips after it keep their times.
    expect(clipsOf(reduceAll([edit('timeline.clip_remove', { clip: 'cl2' })], slice))).toEqual(['cl1 a 0@0 null-null', 'cl3 c 0@10 null-null'])
    // A trim of the in point moves the start by as much, so the rest of the clip plays where it did.
    const trimmed = reduceAll([edit('timeline.clip_trim', { clip: 'cl2', in_sec: 0.5, out_sec: 3 })], slice)
    expect(clipsOf(trimmed)).toEqual(['cl1 a 0@0 null-null', 'cl2 b 0@5.5 0.5-3', 'cl3 c 0@10 null-null'])
    // `at_sec` is a time inside the asset: both parts play the same asset, the second from where it played before.
    expect(clipsOf(reduceAll([adding('timeline.clip_split', { clip: 'cl2', at_sec: 1 }, ['cl4'])], trimmed)))
      .toEqual(['cl1 a 0@0 null-null', 'cl2 b 0@5.5 0.5-1', 'cl4 b 0@6 1-3', 'cl3 c 0@10 null-null'])
    // A trim without points plays the whole asset again; a replace keeps the ID, the start and the track, and resets the points.
    expect(clipsOf(reduceAll([edit('timeline.clip_trim', { clip: 'cl2' })], trimmed))[1]).toBe('cl2 b 0@5 null-null')
    expect(clipsOf(reduceAll([edit('timeline.clip_replace', { clip: 'cl2', asset: 'y' })], trimmed))[1]).toBe('cl2 y 0@5.5 null-null')
  })

  it('edits the timeline that holds the clip, and adds a clip only to a timeline that exists', () => {
    const slice = reduceAll([adding('timeline.create', { assets: ['a'] }, ['cl1']), adding('timeline.create', { timeline: 't2', assets: ['b'] }, ['cl2'])])
    const removed = reduceAll([edit('timeline.clip_remove', { clip: 'cl2' })], slice)
    expect([clipsOf(removed), clipsOf(removed, 't2')]).toEqual([['cl1 a 0@0 null-null'], []])
    expect(clipsOf(reduceAll([adding('timeline.clip_add', { timeline: 't2', asset: 'c', track: 0, start_sec: 4 }, ['cl3'])], slice), 't2'))
      .toEqual(['cl2 b 0@0 null-null', 'cl3 c 0@4 null-null'])
    expect(problem(slice, adding('timeline.clip_add', { timeline: 't9', asset: 'c', track: 0, start_sec: 0 }, ['cl3']))).toBe('Timeline t9 does not exist.')
    expect(problem(timelineReducer.initial(), adding('timeline.clip_add', { asset: 'c', track: 0, start_sec: 0 }, ['cl3']))).toBe('The project has no timeline.')
  })

  it('ignores unfinished records, records of other components, calls that do not apply, and records without their clip IDs or start times', () => {
    const slice = base()
    const add = { asset: 'd', track: 0, start_sec: 20 }
    const ignored = [
      edit('timeline.clip_remove', { clip: 'cl1' }, { status: 'pending' }),
      edit('character.create', { name: 'x' }),
      edit('timeline.clip_remove', { clip: 'cl5' }),
      adding('timeline.clip_split', { clip: 'cl1', at_sec: 0 }, ['cl4']),
      edit('timeline.rename', { timeline: 't7', name: 'x' }),
      // A record without its clip ID, a record with too many IDs, and one that reuses an ID.
      edit('timeline.clip_add', add),
      adding('timeline.clip_add', add, ['cl4', 'cl5']),
      adding('timeline.clip_add', add, ['cl2']),
      adding('timeline.update', { timeline: 't1', assets: ['d', 'e'] }, ['cl4', 'cl4']),
      // A create or an update without one start time per clip.
      edit('timeline.create', { timeline: 't5', assets: ['d'] }, { report: { clips: ['cl9'] } }),
      adding('timeline.update', { timeline: 't1', assets: ['d', 'e'] }, ['cl4', 'cl5'], { report: { starts: [0, 'x'] } }),
    ]
    expect(reduceAll(ignored, slice)).toBe(slice)
    expect(timelineReducer.reduce(slice, { ...edit('timeline.create', {}), operation: null })).toBe(slice)
  })

  it('reports why a clip call cannot apply to a slice', () => {
    const slice = layered()
    const ranged = reduceAll([edit('timeline.clip_trim', { clip: 'cl1', in_sec: 1, out_sec: 2 })], slice)
    const add = (params: Record<string, unknown>): string | null => problem(slice, edit('timeline.clip_add', { timeline: 't1', asset: 'v', ...params }))
    const move = (params: Record<string, unknown>): string | null => problem(slice, edit('timeline.clip_move', { clip: 'cl4', ...params }))
    expect(problem(slice, edit('timeline.clip_remove', { clip: 'cl2' }))).toBeNull()
    expect(problem(slice, edit('timeline.clip_remove', { clip: 'cl9' }))).toBe('Clip cl9 does not exist.')
    // A call may name the track after the last one, which adds it.
    expect(add({ track: 3, start_sec: 0 })).toBeNull()
    expect(add({ track: 4, start_sec: 0 })).toBe('Timeline t1 has no video track 4; it has 3.')
    expect(add({ track: -1, start_sec: 0 })).toBe('track -1 is not a track number of 0 or more.')
    expect(add({ start_sec: 0 })).toBe('track undefined is not a track number of 0 or more.')
    expect(add({ track: 0, start_sec: -1 })).toBe('start_sec -1 is not a time of 0 seconds or more.')
    expect(add({ track: 0 })).toBe('start_sec undefined is not a time of 0 seconds or more.')
    expect(move({ start_sec: 0, track: 3 })).toBeNull()
    expect(move({ start_sec: 0 })).toBeNull()
    expect(move({ start_sec: 'x' })).toBe('start_sec x is not a time of 0 seconds or more.')
    expect(move({ start_sec: 0, track: 4 })).toBe('Timeline t1 has no video track 4; it has 3.')
    expect(problem(slice, adding('timeline.create', { assets: [] }, []))).toBe('Timeline t1 exists; call dv_timeline_update to replace its clips.')
    expect(problem(slice, adding('timeline.update', { timeline: 't2', assets: [] }, []))).toBe('Timeline t2 does not exist.')
    expect(problem(slice, edit('timeline.rename', { timeline: 't2', name: 'x' }))).toBe('Timeline t2 does not exist.')
    expect(problem(timelineReducer.initial(), edit('timeline.rename', { name: 'x' }))).toBe('The project has no timeline.')
    expect(problem(timelineReducer.initial(), adding('timeline.create', {}, []))).toBeNull()
    expect(problem(slice, edit('character.create', {}))).toBeNull()
    expect(problem(ranged, adding('timeline.clip_split', { clip: 'cl1', at_sec: 1.5 }, ['cl6']))).toBeNull()
    expect(problem(ranged, adding('timeline.clip_split', { clip: 'cl1', at_sec: 2 }, ['cl6']))).toContain('does not play 2s of its asset')
    expect(problem(slice, adding('timeline.clip_split', { clip: 'cl1', at_sec: 'x' }, ['cl6']))).toContain('does not play x')
    expect(problem(slice, edit('timeline.clip_trim', { clip: 'cl1', in_sec: -1 }))).toBe('The in point -1s is before the asset\'s start.')
    expect(problem(slice, edit('timeline.clip_trim', { clip: 'cl1', in_sec: 2, out_sec: 2 }))).toBe('The out point 2s is not after the in point 2s.')
    expect(problem(slice, edit('timeline.clip_trim', { clip: 'cl1', out_sec: 0 }))).toBe('The out point 0s is not after the in point 0s.')
    expect(problem(slice, edit('timeline.clip_trim', { clip: 'cl1', out_sec: 2 }))).toBeNull()
    // A trim of the in point moves the start along: a later in point always fits, an earlier one only while the start stays
    // at 0 s or later.
    expect(problem(slice, edit('timeline.clip_trim', { clip: 'cl5', in_sec: 1 }))).toBeNull()
    const early = reduceAll([edit('timeline.clip_trim', { clip: 'cl4', in_sec: 1 }), edit('timeline.clip_move', { clip: 'cl4', start_sec: 0 })], slice)
    expect(problem(early, edit('timeline.clip_trim', { clip: 'cl4', in_sec: 0.5 }))).toBe('The in point 0.5s would start clip cl4 before the timeline\'s start.')
    expect(problem(slice, edit('timeline.clip_trim', { clip: 'cl4', in_sec: 2 }))).toBeNull()
  })

  it('adds sounds to the timeline a call names, on track 0 unless the call names a track, and removes them by sound ID', () => {
    const slice = reduceAll([
      adding('timeline.create', { assets: ['a'] }, ['cl1']), adding('timeline.create', { timeline: 't2', assets: [] }, []),
      soundAdd({ asset: 'm', start_sec: 1.5 }, ['sd1']), soundAdd({ timeline: 't2', asset: 'n', start_sec: 0, track: 1 }, ['sd2']),
      soundAdd({ timeline: 't1', asset: 'o', start_sec: 0.5, track: 1 }, ['sd3']),
    ])
    expect(soundsOf(slice)).toEqual(['sd1 m 1.5 0', 'sd3 o 0.5 1'])
    expect(soundsOf(slice, 't2')).toEqual(['sd2 n 0 1'])
    // The clips stay; removing a sound finds it on whichever timeline holds it.
    expect(clipsOf(slice)).toEqual(['cl1 a 0@0 null-null'])
    const removed = reduceAll([edit('timeline.sound_remove', { sound: 'sd2' })], slice)
    expect([soundsOf(removed), soundsOf(removed, 't2')]).toEqual([['sd1 m 1.5 0', 'sd3 o 0.5 1'], []])
  })

  it('splits a sound in two at a time inside its asset with timeline.sound_split, the second part playing on where it played', () => {
    const slice = reduceAll([
      adding('timeline.create', { assets: [] }, []), adding('timeline.create', { timeline: 't2', assets: [] }, []),
      soundAdd({ asset: 'm', start_sec: 1.5, track: 1 }, ['sd1']), soundAdd({ asset: 'n', start_sec: 0 }, ['sd2']),
    ])
    const split = (sound: string, at: unknown, ids: unknown[] = []): ProjectRecord =>
      edit('timeline.sound_split', { sound, at_sec: at }, { report: { sounds: ids } })
    const parts = (sliced: ComponentStates['timeline']): string[] => (sliced.timelines[0]?.sounds ?? [])
      .map(sound => `${sound.id} ${sound.asset} ${String(sound.start_sec)} ${String(sound.track)} ${String(sound.in_sec)}-${String(sound.out_sec)}`)
    const once = reduceAll([split('sd1', 2, ['sd3'])], slice)
    expect(parts(once)).toEqual(['sd1 m 1.5 1 null-2', 'sd3 m 3.5 1 2-null', 'sd2 n 0 0 null-null'])
    expect(once.timelines[1]).toBe(slice.timelines[1])
    const twice = reduceAll([split('sd3', 3.25, ['sd4'])], once)
    expect(parts(twice)).toEqual(['sd1 m 1.5 1 null-2', 'sd3 m 3.5 1 2-3.25', 'sd4 m 4.75 1 3.25-null', 'sd2 n 0 0 null-null'])
    const outside = (sound: string, at: string): string => `Sound ${sound} does not play ${at}s of its asset; split inside its in and out points.`
    expect(problem(twice, split('sd3', 2))).toBe(outside('sd3', '2'))
    expect(problem(twice, split('sd3', 3.25))).toBe(outside('sd3', '3.25'))
    expect(problem(twice, split('sd1', 'x'))).toBe(outside('sd1', 'x'))
    expect(problem(twice, split('sd9', 1))).toBe('Sound sd9 does not exist.')
    expect(problem(twice, split('sd4', 10))).toBeNull()
    // A split that stored no new sound ID, or the ID of a sound that exists, applies nothing.
    expect(reduceAll([split('sd2', 1), split('sd2', 1, ['sd1'])], twice)).toBe(twice)
  })

  it('refuses a sound split or trim past the end of the sound\'s asset once its length is known', () => {
    const slice = reduceAll([adding('timeline.create', { assets: [] }, []), soundAdd({ asset: 'm', start_sec: 0 }, ['sd1'])])
    const fits = (operation: string, params: Record<string, unknown>, length: number | null = 5): string | null =>
      soundLengthProblem(slice, { operation, params: { sound: 'sd1', ...params }, inputs: [] }, () => length)
    expect(fits('timeline.sound_split', { at_sec: 4 })).toBeNull()
    expect(fits('timeline.sound_split', { at_sec: 5 })).toBe('Sound sd1 does not play 5s of its asset; split inside its in and out points.')
    expect(fits('timeline.sound_split', { at_sec: 40 }, null)).toBeNull()
    expect(fits('timeline.sound_trim', { in_sec: 1, out_sec: 5 })).toBeNull()
    expect(fits('timeline.sound_trim', {})).toBeNull()
    expect(fits('timeline.sound_trim', { in_sec: 5 })).toBe('The in point 5s is not before the end of asset m (5s).')
    expect(fits('timeline.sound_trim', { out_sec: 6 })).toBe('The out point 6s is past the end of asset m (5s).')
  })

  it('moves a sound in time and to another sound track with timeline.sound_move, and trims it with timeline.sound_trim', () => {
    const slice = reduceAll([
      adding('timeline.create', { assets: [] }, []), adding('timeline.create', { timeline: 't2', assets: [] }, []),
      soundAdd({ asset: 'm', start_sec: 1.5 }, ['sd1']), soundAdd({ timeline: 't2', asset: 'n', start_sec: 0 }, ['sd2']),
      soundAdd({ asset: 'o', start_sec: 0 }, ['sd3']),
    ])
    const move = (params: Record<string, unknown>): ProjectRecord => edit('timeline.sound_move', { sound: 'sd1', ...params })
    const trim = (params: Record<string, unknown>): ProjectRecord => edit('timeline.sound_trim', { sound: 'sd1', ...params })
    const moved = reduceAll([move({ start_sec: 4 }), move({ start_sec: 2, track: 1 })], slice)
    expect([soundsOf(moved), moved.timelines[0]?.track_order, moved.timelines[1]]).toEqual([['sd1 m 2 1', 'sd3 o 0 0'], ['video', 'sound', 'sound'], slice.timelines[1]])
    // A trim of the in point moves the start by the same amount; a missing point is the asset's own end.
    const trimmed = reduceAll([trim({ in_sec: 0.5, out_sec: 3 })], moved)
    expect([soundsOf(trimmed), trimmed.timelines[0]?.sounds[0]?.in_sec, trimmed.timelines[0]?.sounds[0]?.out_sec]).toEqual([['sd1 m 2.5 1', 'sd3 o 0 0'], 0.5, 3])
    const untrimmed = reduceAll([trim({})], trimmed)
    expect([soundsOf(untrimmed), untrimmed.timelines[0]?.sounds[0]?.in_sec, untrimmed.timelines[0]?.sounds[0]?.out_sec]).toEqual([['sd1 m 2 1', 'sd3 o 0 0'], null, null])
    expect(problem(moved, move({ start_sec: -1 }))).toBe('start_sec -1 is not a time of 0 seconds or more.')
    expect(problem(moved, move({ start_sec: 0, track: 3 }))).toBe('Timeline t1 has no sound track 3; it has 2.')
    expect(problem(moved, move({ start_sec: 0, track: 2 }))).toBeNull()
    expect(problem(moved, trim({ in_sec: -1 }))).toBe('The in point -1s is before the asset\'s start.')
    expect(problem(moved, trim({ in_sec: 2, out_sec: 1 }))).toBe('The out point 1s is not after the in point 2s.')
    expect(problem(moved, trim({ out_sec: 0 }))).toBe('The out point 0s is not after the in point 0s.')
    expect(problem(trimmed, trim({ in_sec: 4 }))).toBeNull()
    // sd1 starts at 0 s with its in point at 1 s, so an in point of 0.5 s would start it half a second too early.
    const early = reduceAll([trim({ in_sec: 1 }), move({ start_sec: 0 })], moved)
    expect(problem(early, trim({ in_sec: 0.5 }))).toBe('The in point 0.5s would start sound sd1 before the timeline\'s start.')
    expect(problem(moved, edit('timeline.sound_move', { sound: 'sd9', start_sec: 0 }))).toBe('Sound sd9 does not exist.')
  })

  it('deletes a sound track with its sounds and moves every later track up one', () => {
    const slice = reduceAll([
      adding('timeline.create', { assets: [] }, []), adding('timeline.create', { timeline: 't2', assets: [] }, []),
      soundAdd({ asset: 'a', start_sec: 0, track: 0 }, ['sd1']), soundAdd({ asset: 'b', start_sec: 1, track: 1 }, ['sd2']),
      soundAdd({ asset: 'c', start_sec: 2, track: 2 }, ['sd3']), soundAdd({ timeline: 't2', asset: 'd', start_sec: 0, track: 1 }, ['sd4']),
      edit('timeline.sound_track_rename', { track: 0, name: 'Music' }), edit('timeline.sound_track_rename', { track: 1, name: 'Voice' }),
      edit('timeline.sound_track_rename', { track: 2, name: 'Effects' }),
    ])
    const removed = reduceAll([edit('timeline.sound_track_remove', { timeline: 't1', track: 1 })], slice)
    expect(soundsOf(removed)).toEqual(['sd1 a 0 0', 'sd3 c 2 1'])
    expect(removed.timelines[0]?.sound_track_names).toEqual(['Music', 'Effects'])
    // Another timeline's tracks keep their numbers.
    expect(soundsOf(removed, 't2')).toEqual(['sd4 d 0 1'])
    // A track past the named ones loses its sounds and leaves the names as they are.
    const past = reduceAll([edit('timeline.sound_track_remove', { timeline: 't2', track: 1 })], removed)
    expect([soundsOf(past, 't2'), past.timelines[1]?.sound_track_names]).toEqual([[], []])
    // A track the timeline does not have is refused, and the slice stays as it is.
    expect(reduceAll([edit('timeline.sound_track_remove', { track: 2 })], removed)).toBe(removed)
  })

  it('names a sound track trimmed, padding the tracks before it with empty names, on the timeline the call names', () => {
    const slice = reduceAll([adding('timeline.create', { assets: [] }, []), adding('timeline.create', { timeline: 't2', assets: [] }, [])])
    const named = reduceAll([edit('timeline.sound_track_rename', { timeline: 't1', track: 1, name: '  Narration ' })], slice)
    expect(named.timelines.map(timeline => timeline.sound_track_names)).toEqual([['', 'Narration'], []])
    const renamed = reduceAll([edit('timeline.sound_track_rename', { track: 0, name: 'Music' })], named)
    expect(renamed.timelines[0]?.sound_track_names).toEqual(['Music', 'Narration'])
    // The track after the last stored one may be named too.
    expect(reduceAll([edit('timeline.sound_track_rename', { track: 2, name: 'Effects' })], renamed).timelines[0]?.sound_track_names)
      .toEqual(['Music', 'Narration', 'Effects'])
    // An empty name clears the name, so the track shows its numbered default name.
    expect(reduceAll([edit('timeline.sound_track_rename', { track: 1, name: ' ' })], renamed).timelines[0]?.sound_track_names)
      .toEqual(['Music', ''])
  })

  it('reports why a sound call cannot apply, and ignores sound records without exactly one new sound ID', () => {
    const slice = reduceAll([adding('timeline.create', { assets: ['a'] }, ['cl1']), soundAdd({ asset: 'm', start_sec: 0 }, ['sd1'])])
    expect(problem(slice, soundAdd({ asset: 'm', start_sec: 0 }, []))).toBeNull()
    expect(problem(slice, soundAdd({ asset: 'm', start_sec: -1 }, []))).toBe('start_sec -1 is not a time of 0 seconds or more.')
    expect(problem(slice, soundAdd({ asset: 'm', start_sec: 'x' }, []))).toBe('start_sec x is not a time of 0 seconds or more.')
    expect(problem(slice, soundAdd({ asset: 'm', start_sec: 0, track: 1.5 }, []))).toBe('track 1.5 is not a track number of 0 or more.')
    expect(problem(slice, soundAdd({ asset: 'm', start_sec: 0, track: -1 }, []))).toBe('track -1 is not a track number of 0 or more.')
    expect(problem(slice, soundAdd({ timeline: 't2', asset: 'm', start_sec: 0 }, []))).toBe('Timeline t2 does not exist.')
    expect(problem(timelineReducer.initial(), soundAdd({ asset: 'm', start_sec: 0 }, []))).toBe('The project has no timeline.')
    expect(problem(slice, edit('timeline.sound_remove', { sound: 'sd1' }))).toBeNull()
    expect(problem(slice, edit('timeline.sound_remove', { sound: 'sd9' }))).toBe('Sound sd9 does not exist.')
    expect(problem(slice, edit('timeline.sound_remove', {}))).toBe('Sound null does not exist.')
    expect(problem(slice, edit('timeline.sound_track_remove', { track: 0 }))).toBeNull()
    // Only sound_add defaults the track.
    expect(problem(slice, edit('timeline.sound_track_remove', {}))).toBe('track undefined is not a track number of 0 or more.')
    expect(problem(slice, edit('timeline.sound_track_rename', { track: 0, name: 'x' }))).toBeNull()
    expect(problem(slice, edit('timeline.sound_track_rename', { track: 0, name: 3 }))).toBe('name must be a string.')
    expect(problem(slice, edit('timeline.sound_track_rename', { track: 'x', name: 'x' }))).toBe('track x is not a track number of 0 or more.')
    const ignored = [
      soundAdd({ asset: 'm', start_sec: 0 }, []),
      soundAdd({ asset: 'm', start_sec: 0 }, ['sd2', 'sd3']),
      // A sound ID the slice already holds, and an ID that is not text.
      soundAdd({ asset: 'm', start_sec: 0 }, ['sd1']),
      soundAdd({ asset: 'm', start_sec: 0 }, [2]),
      edit('timeline.sound_add', { asset: 'm', start_sec: 0 }),
      edit('timeline.sound_remove', { sound: 'sd9' }),
      // Only sound_add stores a sound ID.
      edit('timeline.sound_track_rename', { track: 0, name: 'x' }, { report: { sounds: ['sd2'] } }),
    ]
    expect(reduceAll(ignored, slice)).toBe(slice)
  })

  it('refuses a sound track the timeline does not have: removal past its last track, and an add or rename past the one after it', () => {
    const empty = reduceAll([adding('timeline.create', { assets: [] }, [])])
    // A new timeline has an empty sound track 0 to remove, and takes an add or a rename on tracks 0 and 1.
    expect(problem(empty, edit('timeline.sound_track_remove', { track: 0 }))).toBeNull()
    expect(problem(empty, edit('timeline.sound_track_remove', { track: 1 }))).toBe('Timeline t1 has no sound track 1; it has 1.')
    expect(problem(empty, soundAdd({ asset: 'm', start_sec: 0, track: 1 }, []))).toBeNull()
    expect(problem(empty, soundAdd({ asset: 'm', start_sec: 0, track: 2 }, []))).toBe('Timeline t1 has no sound track 2; it has 1.')
    expect(problem(empty, edit('timeline.sound_track_rename', { track: 1, name: 'x' }))).toBeNull()
    expect(problem(empty, edit('timeline.sound_track_rename', { track: 2, name: 'x' }))).toBe('Timeline t1 has no sound track 2; it has 1.')
    // Once it is removed, the timeline has no sound track, and takes an add on track 0.
    const none = reduceAll([edit('timeline.sound_track_remove', { track: 0 })], empty)
    expect(none.timelines[0]?.track_order).toEqual(['video'])
    expect(problem(none, edit('timeline.sound_track_remove', { track: 0 }))).toBe('Timeline t1 has no sound track 0; it has 0.')
    expect(problem(none, soundAdd({ asset: 'm', start_sec: 0, track: 0 }, []))).toBeNull()
    expect(problem(none, soundAdd({ asset: 'm', start_sec: 0, track: 1 }, []))).toBe('Timeline t1 has no sound track 1; it has 0.')
    expect(reduceAll([soundAdd({ asset: 'm', start_sec: 0, track: 0 }, ['sd1'])], none).timelines[0]?.track_order).toEqual(['video', 'sound'])
    // A sound on track 2 counts three tracks though no track has a name.
    const sounded = reduceAll([
      soundAdd({ asset: 'm', start_sec: 0, track: 1 }, ['sd1']), soundAdd({ asset: 'm', start_sec: 0, track: 2 }, ['sd2']),
    ], empty)
    expect(problem(sounded, edit('timeline.sound_track_remove', { track: 2 }))).toBeNull()
    expect(problem(sounded, edit('timeline.sound_track_remove', { track: 3 }))).toBe('Timeline t1 has no sound track 3; it has 3.')
    expect(problem(sounded, soundAdd({ asset: 'm', start_sec: 0, track: 3 }, []))).toBeNull()
    expect(problem(sounded, soundAdd({ asset: 'm', start_sec: 0, track: 4 }, []))).toBe('Timeline t1 has no sound track 4; it has 3.')
    // A named track counts though it holds no sound.
    const named = reduceAll([edit('timeline.sound_track_rename', { track: 1, name: 'Voice' })], empty)
    expect(problem(named, edit('timeline.sound_track_remove', { track: 1 }))).toBeNull()
    expect(problem(named, edit('timeline.sound_track_rename', { track: 2, name: 'x' }))).toBeNull()
    expect(problem(named, edit('timeline.sound_track_rename', { track: 3, name: 'x' }))).toBe('Timeline t1 has no sound track 3; it has 2.')
    // A refused record leaves the slice unchanged.
    expect(reduceAll([soundAdd({ asset: 'm', start_sec: 0, track: 2 }, ['sd1'])], empty)).toBe(empty)
  })

  it('mutes and unmutes video tracks and sound tracks, and moves the mutes up with their tracks on a track removal', () => {
    const slice = base()
    const mute = (params: Record<string, unknown>): ProjectRecord => edit('timeline.mute', { timeline: 't1', ...params })
    const muted = reduceAll([
      adding('timeline.create', { timeline: 't2' }, []), mute({ target: 'video_track', track: 0, muted: true }),
      mute({ target: 'sound', track: 1, muted: true }), mute({ target: 'sound', track: 0, muted: true }), mute({ target: 'sound', track: 2, muted: true }),
      // Muting a muted track again keeps one entry.
      mute({ target: 'sound', track: 1, muted: true }),
    ], slice)
    const fields = (current: ComponentStates['timeline'], id = 't1'): unknown => {
      const timeline = current.timelines.find(candidate => candidate.id === id)
      return [timeline?.muted_video_tracks, timeline?.muted_sound_tracks]
    }
    expect([fields(muted), fields(muted, 't2')]).toEqual([[[0], [0, 1, 2]], [[], []]])
    const removed = reduceAll([edit('timeline.sound_track_remove', { timeline: 't1', track: 1 })], muted)
    expect(fields(removed)).toEqual([[0], [0, 1]])
    const unmuted = reduceAll([mute({ target: 'video_track', track: 0, muted: false }), mute({ target: 'sound', track: 0, muted: false })], removed)
    expect(fields(unmuted)).toEqual([[], [1]])
    expect(problem(muted, mute({ target: 'video', muted: true }))).toBe('target video is not video_track or sound.')
    expect(problem(muted, mute({ target: 'sound', track: 0, muted: 'yes' }))).toBe('muted must be true or false.')
    expect(problem(muted, mute({ target: 'sound', track: 4, muted: true }))).toBe('Timeline t1 has no sound track 4; it has 3.')
    expect(problem(muted, mute({ target: 'video_track', track: 2, muted: true }))).toBe('Timeline t1 has no video track 2; it has 1.')
    expect(problem(muted, mute({ target: 'video_track', muted: true }))).toBe('track undefined is not a track number of 0 or more.')
  })

  it('lists every timeline with its video tracks, their clips by start time with URLs or the status of placeholders, and its sounds in the agent summary', () => {
    const running = edit('shot.render', {}, { status: 'running' })
    const failed = edit('shot.render', {}, { status: 'failed' })
    const inputs = [running, failed].map(producer => ({ role: 'clip', ref: { record: producer.id, output: 0 }, resolved_asset: null }))
    const slice = reduceAll([
      adding('timeline.create', { assets: ['a', 'b'] }, ['cl1', 'cl2']),
      edit('timeline.clip_trim', { clip: 'cl2', in_sec: 1, out_sec: 2 }),
      adding('timeline.create', { timeline: 't2' }, ['cl3', 'cl4'], { inputs }),
      adding('timeline.clip_add', { timeline: 't1', asset: 'c', track: 1, start_sec: 3 }, ['cl5']),
      adding('timeline.clip_add', { timeline: 't1', asset: 'd', track: 1, start_sec: 0.5 }, ['cl6']),
      soundAdd({ timeline: 't2', asset: 'm', start_sec: 2, track: 1 }, ['sd1']),
      edit('timeline.sound_track_rename', { timeline: 't2', track: 0, name: 'Music' }),
      edit('timeline.mute', { timeline: 't2', target: 'video_track', track: 0, muted: true }),
      edit('timeline.mute', { timeline: 't2', target: 'sound', track: 1, muted: true }),
      adding('timeline.create', { timeline: 't3' }, []), edit('timeline.sound_track_rename', { timeline: 't3', track: 0, name: 'Voice' }),
      adding('timeline.create', { timeline: 't4' }, []), edit('timeline.sound_track_remove', { timeline: 't4', track: 0 }),
    ])
    // The summary reads only the records of the state, for the status of each placeholder's render.
    const state = { components: { proj: { records: [running, failed] } } } as unknown as ProjectState
    const summary = timelineReducer.agentSummary?.(slice, { url: asset => `/dv/assets/${asset}` }, state, 's1' as never)
    const ready = (clip: string, asset: string, start: number, inSec: number | null = null, outSec: number | null = null): unknown =>
      ({ clip, asset, url: `/dv/assets/${asset}`, start_sec: start, in_sec: inSec, out_sec: outSec })
    expect(summary).toEqual({
      timelines: [{
        // A new timeline lists its empty sound track 0, and no sounds.
        id: FIRST_TIMELINE_ID, name: '', video_tracks: [
          { track: 0, clips: [ready('cl1', 'a', 0), ready('cl2', 'b', 6, 1, 2)] },
          { track: 1, clips: [ready('cl6', 'd', 0.5), ready('cl5', 'c', 3)] },
        ],
        sound_tracks: [{ track: 0, name: '' }],
      }, {
        // A mute shows only while it is on.
        id: 't2', name: '', video_tracks: [{
          track: 0, muted: true, clips: [
            { clip: 'cl3', asset: null, status: 'rendering', record: running.id, start_sec: 0, in_sec: null, out_sec: null },
            { clip: 'cl4', asset: null, status: 'failed', record: failed.id, start_sec: 5, in_sec: null, out_sec: null },
          ],
        }],
        // Every track up to the last one that holds a sound or a name, with '' for an unnamed track.
        sound_tracks: [{ track: 0, name: 'Music' }, { track: 1, name: '', muted: true }],
        sounds: [{ sound: 'sd1', asset: 'm', url: '/dv/assets/m', start_sec: 2, in_sec: null, out_sec: null, track: 1 }],
      }, {
        // A named track without sounds is listed; the timeline lists no sounds.
        id: 't3', name: '', video_tracks: [{ track: 0, clips: [] }], sound_tracks: [{ track: 0, name: 'Voice' }],
      }, {
        // A timeline whose sound tracks were all removed lists none.
        id: 't4', name: '', video_tracks: [{ track: 0, clips: [] }],
      }],
    })
    // The track list comes before the sounds that name its tracks.
    expect(JSON.stringify(summary)).toMatch(/"video_tracks":.*"sound_tracks":\[[^\]]*\],"sounds":/)
  })
})

describe('video tracks', () => {
  it('keeps the video tracks and sound tracks in the order they were added, each new one at the bottom', () => {
    const order = (slice: ComponentStates['timeline']): unknown => slice.timelines[0]?.track_order
    // A new timeline shows 视频 1 over sound track 0; the two video tracks the clips add go under them.
    expect(order(layered())).toEqual(['video', 'sound', 'video', 'video'])
    const sounded = reduceAll([
      soundAdd({ timeline: 't1', asset: 'm', start_sec: 0, track: 1 }, ['sd1']),
      adding('timeline.clip_add', { timeline: 't1', asset: 'z', track: 3, start_sec: 0 }, ['cl6']),
    ], layered())
    expect(order(sounded)).toEqual(['video', 'sound', 'video', 'video', 'sound', 'video'])
    // A removed track takes its entry along; a track whose last clip goes stays, empty.
    const removed = reduceAll([edit('timeline.video_track_remove', { timeline: 't1', track: 1 })], sounded)
    expect(order(removed)).toEqual(['video', 'sound', 'video', 'sound', 'video'])
    expect(order(reduceAll([edit('timeline.clip_remove', { clip: 'cl6' })], removed))).toEqual(['video', 'sound', 'video', 'sound', 'video'])
    // Removing sound track 0 leaves the other sound track, now track 0, in its place.
    const first = reduceAll([edit('timeline.sound_track_remove', { timeline: 't1', track: 0 })], sounded)
    expect(order(first)).toEqual(['video', 'video', 'video', 'sound', 'video'])
    // A sound track whose last sound goes stays, empty, until a removal deletes it.
    expect(order(reduceAll([edit('timeline.sound_remove', { sound: 'sd1' })], sounded))).toEqual(['video', 'sound', 'video', 'video', 'sound', 'video'])
  })

  it('adds an empty video track or sound track at the bottom with timeline.track_add, which the calls of its kind then name', () => {
    const add = (kind: unknown): ProjectRecord => edit('timeline.track_add', { timeline: 't1', kind })
    const added = reduceAll([adding('timeline.create', { timeline: 't2' }, []), add('video'), add('sound')], layered())
    // Only the named timeline gains the tracks.
    expect(added.timelines[1]?.track_order).toEqual(['video', 'sound'])
    const timeline = added.timelines[0] as Timeline
    expect(timeline.track_order).toEqual(['video', 'sound', 'video', 'video', 'video', 'sound'])
    expect(videoTrackCount(timeline)).toBe(4)
    // The empty tracks take clips and sounds, and calls may name the track after them.
    expect(problem(added, adding('timeline.clip_add', { timeline: 't1', asset: 'z', track: 4, start_sec: 0 }, []))).toBeNull()
    expect(problem(added, soundAdd({ timeline: 't1', asset: 'm', start_sec: 0, track: 2 }, []))).toBeNull()
    expect(problem(added, edit('timeline.video_track_remove', { timeline: 't1', track: 3 }))).toBeNull()
    expect(problem(added, add('subtitle'))).toBe('kind subtitle is not video or sound.')
    expect(problem(added, edit('timeline.track_add', { timeline: 't9', kind: 'video' }))).toBe('Timeline t9 does not exist.')
  })

  it('moves a video track to another number with timeline.video_track_move, 视频 1 too, its clips and mute along', () => {
    const slice = reduceAll([
      adding('timeline.create', { timeline: 't2' }, []),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 0, muted: true }),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 2, muted: true }),
    ], layered())
    const order = slice.timelines[0]?.track_order
    const move = (track: unknown, to: unknown): ProjectRecord => edit('timeline.video_track_move', { timeline: 't1', track, to })
    // Track 2 goes on top; the tracks between move one number down.
    const up = reduceAll([move(2, 0)], slice)
    expect(clipsOf(up)).toEqual(['cl1 a 1@0 null-null', 'cl2 b 1@5 null-null', 'cl3 c 1@10 null-null', 'cl4 v 2@2 null-null', 'cl5 w 0@0 null-null'])
    expect(up.timelines[0]?.muted_video_tracks).toEqual([0, 1])
    expect(up.timelines[0]?.track_order).toEqual(order)
    expect(up.timelines[1]).toBe(slice.timelines[1])
    const down = reduceAll([move(0, 2)], up)
    expect([clipsOf(down), down.timelines[0]?.muted_video_tracks]).toEqual([clipsOf(slice), [0, 2]])
    expect(clipsOf(reduceAll([move(1, 1)], slice))).toEqual(clipsOf(slice))
    expect(problem(slice, move(3, 0))).toBe('Timeline t1 has no video track 3; it has 3.')
    expect(problem(slice, move(0, 3))).toBe('Timeline t1 has no video track 3; it has 3.')
    expect(problem(slice, move(0, -1))).toBe('to -1 is not a track number of 0 or more.')
    expect(problem(slice, move('a', 1))).toBe('track a is not a track number of 0 or more.')
    expect(problem(slice, edit('timeline.video_track_move', { timeline: 't9', track: 0, to: 1 }))).toBe('Timeline t9 does not exist.')
  })

  it('deletes a video track, 视频 1 too, with its clips and mute, and every later track moves up one', () => {
    const slice = reduceAll([
      adding('timeline.create', { timeline: 't2', assets: ['z'] }, ['cl9']),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 0, muted: true }),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 2, muted: true }),
    ], layered())
    const remove = (track: number): ProjectRecord => edit('timeline.video_track_remove', { timeline: 't1', track })
    const once = reduceAll([remove(0)], slice)
    expect([clipsOf(once), once.timelines[0]?.muted_video_tracks]).toEqual([['cl4 v 0@2 null-null', 'cl5 w 1@0 null-null'], [1]])
    expect(once.timelines[0]?.track_order).toEqual(['sound', 'video', 'video'])
    expect(clipsOf(once, 't2')).toEqual(['cl9 z 0@0 null-null'])
    // A middle track goes with its clips and keeps the higher tracks and their mutes.
    expect(clipsOf(reduceAll([remove(1)], slice))).toEqual(['cl1 a 0@0 null-null', 'cl2 b 0@5 null-null', 'cl3 c 0@10 null-null', 'cl5 w 1@0 null-null'])
    // Without video tracks, a clip may go on track 0, which adds it at the bottom.
    const none = reduceAll([remove(0), remove(0)], once)
    expect([clipsOf(none), none.timelines[0]?.track_order]).toEqual([[], ['sound']])
    expect(problem(none, remove(0))).toBe('Timeline t1 has no video track 0; it has 0.')
    const added = reduceAll([adding('timeline.clip_add', { timeline: 't1', asset: 'x', track: 0, start_sec: 1 }, ['cl8'])], none)
    expect([clipsOf(added), added.timelines[0]?.track_order]).toEqual([['cl8 x 0@1 null-null'], ['sound', 'video']])
  })

  it('takes a clip ID that a clip of any track has as taken', () => {
    const slice = layered()
    expect(reduceAll([adding('timeline.clip_add', { asset: 'd', track: 0, start_sec: 30 }, ['cl5'])], slice)).toBe(slice)
    expect(reduceAll([adding('timeline.clip_split', { clip: 'cl1', at_sec: 1 }, ['cl4'])], slice)).toBe(slice)
  })
})

describe('where clips play', () => {
  const lengths: Record<string, number> = { a: 2, b: 3, c: 4 }
  const durationOf = (asset: AssetId): number | null => lengths[asset] ?? null
  const clip = (id: string, start: number, track = 0, asset = 'a'): Clip => ({
    id: brandString<ClipId>(id), asset: brandString<AssetId>(asset), source: null, in_sec: null, out_sec: null, start_sec: start, track,
  })

  it('plays a clip from its in point to its out point, else to the end of its asset, its render\'s planned length, or 5 s', () => {
    const render = edit('shot.render', { duration_sec: 3 })
    const waiting: Clip = { ...clip('w', 0), asset: null, source: { record: render.id, output: 0 } }
    expect([clipLength(clip('x', 0), durationOf, []), clipLength(waiting, durationOf, [render]), clipLength(waiting, durationOf, [])]).toEqual([2, 3, 5])
    expect(clipLength(clip('x', 0, 0, 'z'), durationOf, [])).toBe(5)
    expect(clipLength({ ...clip('x', 0, 0, 'c'), in_sec: 1 }, durationOf, [])).toBe(3)
    expect(clipLength({ ...clip('x', 0), in_sec: 1, out_sec: 1.5 }, durationOf, [])).toBe(0.5)
    expect(clipLength({ ...clip('x', 0), in_sec: 1, out_sec: 1 }, durationOf, [])).toBe(0.1)
  })

  it('places each clip at its start time, or where the clip before it on its track ends when that is later', () => {
    const clips = [clip('c1', 0), clip('c2', 1, 0, 'b'), clip('c3', 10), clip('c4', 1, 1)]
    const spans = placeClips(clips, each => clipLength(each, durationOf, [])).map(placed => [placed.clip.id, placed.start, placed.end])
    // c2 waits for c1 to end; c4 on track 1 starts at its own time.
    expect(spans).toEqual([['c1', 0, 2], ['c2', 2, 5], ['c3', 10, 12], ['c4', 1, 3]])
  })

  it('lays the clips of a create or an update out one after another from 0 s', () => {
    const render = edit('shot.render', { duration_sec: 3 })
    const inputs = [
      { role: 'clip', ref: { asset: brandString<AssetId>('a') }, resolved_asset: brandString<AssetId>('a') },
      { role: 'clip', ref: { record: render.id, output: 0 }, resolved_asset: null },
      { role: 'clip', ref: { asset: brandString<AssetId>('z') }, resolved_asset: brandString<AssetId>('z') },
    ]
    expect(laidOutStarts({ operation: 'timeline.create', params: { assets: ['a', 'c', 'b'] }, inputs: [] }, durationOf, [])).toEqual([0, 2, 6])
    expect(laidOutStarts({ operation: 'timeline.update', params: {}, inputs }, durationOf, [render])).toEqual([0, 2, 5])
  })

  it('refuses a clip that a call adds or changes where it would overlap another clip of its track', () => {
    const lengthOf = (each: Clip): number => clipLength(each, durationOf, [])
    const check = (record: ProjectRecord, changed: string, from = layered()): string | null => overlapProblem(
      from.timelines[0] as Timeline, afterCall(from, record).timelines[0] as Timeline, lengthOf, brandString<ClipId>(changed),
    )
    const add = (start: number, track = 0): ProjectRecord => adding('timeline.clip_add', { timeline: 't1', asset: 'a', track, start_sec: start }, [NEW_CLIP])
    // cl1 plays 0 s to 2 s and cl2 5 s to 8 s: a 2 s clip from 2 s or from 3 s only touches them.
    expect(check(add(2), NEW_CLIP)).toBeNull()
    expect(check(add(3), NEW_CLIP)).toBeNull()
    expect(check(add(4), NEW_CLIP)).toBe('The new clip would overlap clip cl2 on video track 0 (5s to 8s); pick another start_sec or track.')
    expect(check(add(1), NEW_CLIP)).toBe('The new clip would overlap clip cl1 on video track 0 (0s to 2s); pick another start_sec or track.')
    expect(check(add(1, 1), NEW_CLIP)).toBe('The new clip would overlap clip cl4 on video track 1 (2s to 7s); pick another start_sec or track.')
    expect(check(add(0, 3), NEW_CLIP)).toBeNull()
    expect(check(edit('timeline.clip_move', { clip: 'cl1', start_sec: 4 }), 'cl1'))
      .toBe('Clip cl1 would overlap clip cl2 on video track 0 (5s to 8s); pick another start_sec or track.')
    expect(check(edit('timeline.clip_move', { clip: 'cl3', start_sec: 7 }), 'cl3'))
      .toBe('Clip cl3 would overlap clip cl2 on video track 0 (5s to 8s); pick another start_sec or track.')
    expect(check(edit('timeline.clip_move', { clip: 'cl1', start_sec: 20 }), 'cl1')).toBeNull()
    expect(check(edit('timeline.clip_move', { clip: 'cl4', start_sec: 0, track: 2 }), 'cl4'))
      .toBe('Clip cl4 would overlap clip cl5 on video track 2 (0s to 5s); pick another start_sec or track.')
    // A later out point that would run into the next clip is refused; a replacement that ends where the next clip starts only touches it.
    expect(check(edit('timeline.clip_replace', { clip: 'cl1', asset: 'c' }), 'cl1')).toBeNull()
    expect(check(edit('timeline.clip_replace', { clip: 'cl2', asset: 'z' }), 'cl2')).toBeNull()
    expect(check(edit('timeline.clip_trim', { clip: 'cl1', out_sec: 6 }), 'cl1'))
      .toBe('Clip cl1 would overlap clip cl2 on video track 0 (5s to 8s); pick another start_sec or track.')
    expect(check(edit('timeline.clip_trim', { clip: 'cl1', in_sec: 0.5, out_sec: 1 }), 'cl1')).toBeNull()
    // cl2 starts at 5 s right after a gap; an in point of 0 s after one of 1 s would start it at 4 s, still clear of cl1.
    const trimmed = reduceAll([edit('timeline.clip_trim', { clip: 'cl2', in_sec: 1 })], layered())
    expect(check(edit('timeline.clip_trim', { clip: 'cl2', in_sec: 0 }), 'cl2', trimmed)).toBeNull()
  })

  it('lets a clip that a longer render pushed stay pushed, and keeps it where it plays for the other calls', () => {
    // cl1 plays 0 s to 12 s, so cl2 plays from 12 s, 7 s after its start time, and cl3 from 15 s.
    const lengthOf = (each: Clip): number => each.id === 'cl1' ? 12 : clipLength(each, durationOf, [])
    const slice = base()
    const check = (record: ProjectRecord, changed: string): string | null => overlapProblem(
      slice.timelines[0] as Timeline, afterCall(slice, record).timelines[0] as Timeline, lengthOf, brandString<ClipId>(changed),
    )
    expect(check(edit('timeline.clip_trim', { clip: 'cl2', out_sec: 2 }), 'cl2')).toBeNull()
    expect(check(edit('timeline.clip_trim', { clip: 'cl3', out_sec: 1 }), 'cl3')).toBeNull()
    // A replacement keeps the start and clears the in point, so a pushed clip with an in point stays pushed too.
    const trimmed = afterCall(slice, edit('timeline.clip_trim', { clip: 'cl2', in_sec: 1 }))
    expect(overlapProblem(
      trimmed.timelines[0] as Timeline, afterCall(trimmed, edit('timeline.clip_replace', { clip: 'cl2', asset: 'a' })).timelines[0] as Timeline,
      lengthOf, brandString<ClipId>('cl2'),
    )).toBeNull()
    expect(check(adding('timeline.clip_add', { asset: 'a', track: 0, start_sec: 20 }, [NEW_CLIP]), NEW_CLIP)).toBeNull()
    // A clip placed into the pushed clips is refused by where they play.
    expect(check(adding('timeline.clip_add', { asset: 'a', track: 0, start_sec: 16 }, [NEW_CLIP]), NEW_CLIP))
      .toBe('The new clip would overlap clip cl3 on video track 0 (15s to 19s); pick another start_sec or track.')
    // A pushed clip that a call moves must play where it goes.
    expect(check(edit('timeline.clip_move', { clip: 'cl2', start_sec: 6 }), 'cl2'))
      .toBe('Clip cl2 would overlap clip cl1 on video track 0 (0s to 12s); pick another start_sec or track.')
  })
})
