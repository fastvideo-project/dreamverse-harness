/** The pure `timeline` reducer: every operation's effect on the slice, and the clip and clip ID checks. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ComponentStates, ProjectRecord, ProjectState, RecordId } from '@dv/project'
import { describe, expect, it } from 'vitest'
import {
  afterCall, clipProblem, FIRST_TIMELINE_ID, mainClipStarts, NEW_CLIP, soundLengthProblem, timelineReducer, trackClipProblem,
  videoTrackCount,
} from '../src/reducer.ts'
import type { ClipId, Timeline } from '../src/types.ts'

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

/** A finished record of an operation that adds clips, with the clip IDs it stored in `report.clips`. */
function adding(operation: string, params: Record<string, unknown>, clips: string[], fields: Partial<ProjectRecord> = {}): ProjectRecord {
  return edit(operation, params, { report: { clips }, ...fields })
}

/** A finished `timeline.sound_add` record with the sound IDs it stored in `report.sounds`. */
function soundAdd(params: Record<string, unknown>, sounds: unknown[]): ProjectRecord {
  return edit('timeline.sound_add', params, { report: { sounds } })
}

/** Reduce records in order from the initial slice. */
function reduceAll(records: ProjectRecord[], slice: ComponentStates['timeline'] = timelineReducer.initial()): ComponentStates['timeline'] {
  return records.reduce((current, record) => timelineReducer.reduce(current, record), slice)
}

/** The clips of one timeline as `id asset in-out` text, for compact expectations. */
function clipsOf(slice: ComponentStates['timeline'], id = 't1'): string[] {
  const timeline = slice.timelines.find(candidate => candidate.id === id)
  return timeline?.clips.map(clip => `${clip.id} ${clip.asset} ${String(clip.in_sec)}-${String(clip.out_sec)}`) ?? []
}

const problem = (slice: ComponentStates['timeline'], record: ProjectRecord): string | null => clipProblem(slice, record)

/** The sounds of one timeline as `id asset start track` text, for compact expectations. */
function soundsOf(slice: ComponentStates['timeline'], id = 't1'): string[] {
  const timeline = slice.timelines.find(candidate => candidate.id === id)
  return timeline?.sounds.map(sound => `${sound.id} ${sound.asset} ${String(sound.start_sec)} ${String(sound.track)}`) ?? []
}

/** A slice with timeline t1 holding clips cl1, cl2 and cl3 of assets a, b and c. */
const base = (): ComponentStates['timeline'] => reduceAll([adding('timeline.create', { assets: ['a', 'b', 'c'] }, ['cl1', 'cl2', 'cl3'])])

describe('timeline reducer', () => {
  it('creates, updates, renames and deletes whole timelines', () => {
    const first = adding('timeline.create', { assets: ['a', 'b'] }, ['cl1', 'cl2'])
    const second = adding('timeline.create', { timeline: 't2', name: 'B side', assets: ['c'] }, ['cl3'])
    const slice = reduceAll([first, second])
    expect(slice.timelines.map(timeline => [timeline.id, timeline.name])).toEqual([[FIRST_TIMELINE_ID, ''], ['t2', 'B side']])
    expect(clipsOf(slice)).toEqual(['cl1 a null-null', 'cl2 b null-null'])
    const [one, two] = slice.timelines
    const shared = [one?.sounds === two?.sounds, one?.sound_track_names === two?.sound_track_names]
    expect([...shared, one?.muted_sound_tracks === two?.muted_sound_tracks]).toEqual([false, false, false])
    // create only creates: a create of an existing ID changes nothing; update replaces the clips and keeps the name.
    expect(reduceAll([adding('timeline.create', { assets: ['d'] }, ['cl4'])], slice)).toBe(slice)
    expect(clipsOf(reduceAll([adding('timeline.update', { timeline: 't1', assets: ['d'] }, ['cl4'])], slice))).toEqual(['cl4 d null-null'])
    expect(reduceAll([adding('timeline.update', { timeline: 't2', assets: [] }, [])], slice).timelines[1]).toEqual({
      id: 't2', name: 'B side', clips: [], track_clips: [], muted_video_tracks: [], track_order: ['sound'], sounds: [], sound_track_names: [], video_muted: false,
      muted_sound_tracks: [],
    })
    const renamed = reduceAll([edit('timeline.rename', { timeline: 't2', name: '片尾' })], slice)
    expect(renamed.timelines.map(timeline => timeline.name)).toEqual(['', '片尾'])
    expect(reduceAll([edit('timeline.delete', { timeline: 't1' })], slice).timelines.map(timeline => timeline.id)).toEqual(['t2'])
    expect(reduceAll([adding('timeline.create', { timeline: 't3' }, [])], slice).timelines[2]).toEqual({
      id: 't3', name: '', clips: [], track_clips: [], muted_video_tracks: [], track_order: ['sound'], sounds: [], sound_track_names: [], video_muted: false,
      muted_sound_tracks: [],
    })
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
    expect(clipsOf(created)).toEqual(['cl1 v null-null', 'cl2 null null-null'])
    expect(created.timelines[0]?.clips.map(clip => clip.source)).toEqual([{ record: producer, output: 0 }, { record: producer, output: 1 }])
    const updated = reduceAll([adding('timeline.update', { timeline: 't1' }, ['cl3', 'cl4'], { inputs })], created)
    expect(clipsOf(updated)).toEqual(['cl3 v null-null', 'cl4 null null-null'])
    // A clip of an asset param has no source.
    expect(base().timelines[0]?.clips[0]?.source).toBeNull()
  })

  it('refuses to trim or split a placeholder clip, and moves, removes and replaces it', () => {
    const inputs = [{ role: 'clip', ref: { record: brandString<RecordId>('shot'), output: 0 }, resolved_asset: null }]
    const slice = reduceAll([adding('timeline.create', { assets: ['a'] }, ['cl1']), adding('timeline.update', { timeline: 't1' }, ['cl2'], { inputs })])
    const placeholder = reduceAll([adding('timeline.clip_insert', { at: 1, asset: 'a' }, ['cl3'])], slice)
    expect(problem(placeholder, edit('timeline.clip_trim', { clip: 'cl2', in_sec: 1 }))).toBe('Clip cl2 is still rendering.')
    expect(problem(placeholder, adding('timeline.clip_split', { clip: 'cl2', at_sec: 1 }, ['cl4']))).toBe('Clip cl2 is still rendering.')
    expect(clipsOf(reduceAll([edit('timeline.clip_move', { clip: 'cl2', to: 1 })], placeholder))).toEqual(['cl2 null null-null', 'cl3 a null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_remove', { clip: 'cl2' })], placeholder))).toEqual(['cl3 a null-null'])
    const replaced = reduceAll([edit('timeline.clip_replace', { clip: 'cl2', asset: 'z' })], placeholder)
    expect(replaced.timelines[0]?.clips[1]).toEqual({ id: 'cl2', asset: 'z', source: null, in_sec: null, out_sec: null })
  })

  it('inserts, moves, removes, splits, trims and replaces clips by clip ID', () => {
    const slice = base()
    expect(clipsOf(reduceAll([adding('timeline.clip_insert', { at: 4, asset: 'd' }, ['cl4'])], slice)))
      .toEqual(['cl1 a null-null', 'cl2 b null-null', 'cl3 c null-null', 'cl4 d null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_move', { clip: 'cl3', to: 1 })], slice))).toEqual(['cl3 c null-null', 'cl1 a null-null', 'cl2 b null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_remove', { clip: 'cl2' })], slice))).toEqual(['cl1 a null-null', 'cl3 c null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_replace', { clip: 'cl1', asset: 'z' })], slice))).toEqual(['cl1 z null-null', 'cl2 b null-null', 'cl3 c null-null'])
    const trimmed = reduceAll([edit('timeline.clip_trim', { clip: 'cl2', in_sec: 0.5, out_sec: 3 })], slice)
    expect(clipsOf(trimmed)).toEqual(['cl1 a null-null', 'cl2 b 0.5-3', 'cl3 c null-null'])
    // `at_sec` is a time inside the asset: both parts play the same asset; the second part gets the assigned ID.
    expect(clipsOf(reduceAll([adding('timeline.clip_split', { clip: 'cl2', at_sec: 1 }, ['cl4'])], trimmed)))
      .toEqual(['cl1 a null-null', 'cl2 b 0.5-1', 'cl4 b 1-3', 'cl3 c null-null'])
    // A trim without points plays the whole asset again; a replace keeps the ID and resets the points.
    expect(clipsOf(reduceAll([edit('timeline.clip_trim', { clip: 'cl2' })], trimmed))).toEqual(['cl1 a null-null', 'cl2 b null-null', 'cl3 c null-null'])
    expect(clipsOf(reduceAll([edit('timeline.clip_replace', { clip: 'cl2', asset: 'y' })], trimmed))).toEqual(['cl1 a null-null', 'cl2 y null-null', 'cl3 c null-null'])
  })

  it('edits the timeline that holds the clip, and creates the timeline an insert names when it does not exist', () => {
    const slice = reduceAll([adding('timeline.create', { assets: ['a'] }, ['cl1']), adding('timeline.create', { timeline: 't2', assets: ['b'] }, ['cl2'])])
    const removed = reduceAll([edit('timeline.clip_remove', { clip: 'cl2' })], slice)
    expect([clipsOf(removed), clipsOf(removed, 't2')]).toEqual([['cl1 a null-null'], []])
    expect(reduceAll([adding('timeline.clip_insert', { at: 1, asset: 'a' }, ['cl1'])]).timelines).toEqual([
      {
        id: FIRST_TIMELINE_ID, name: '', clips: [{ id: 'cl1', asset: 'a', source: null, in_sec: null, out_sec: null }],
        track_clips: [], muted_video_tracks: [], track_order: ['sound'], sounds: [], sound_track_names: [], video_muted: false, muted_sound_tracks: [],
      },
    ])
    expect(clipsOf(reduceAll([adding('timeline.clip_insert', { timeline: 't9', at: 1, asset: 'c' }, ['cl3'])], slice), 't9')).toEqual(['cl3 c null-null'])
  })

  it('ignores unfinished records, records of other components, calls that do not apply, and records without their clip IDs', () => {
    const slice = base()
    const ignored = [
      edit('timeline.clip_remove', { clip: 'cl1' }, { status: 'pending' }),
      edit('character.create', { name: 'x' }),
      edit('timeline.clip_remove', { clip: 'cl5' }),
      adding('timeline.clip_split', { clip: 'cl1', at_sec: 0 }, ['cl4']),
      edit('timeline.rename', { timeline: 't7', name: 'x' }),
      // A record written before clips had IDs, a record with too many IDs, and one that reuses an ID.
      edit('timeline.clip_insert', { at: 1, asset: 'd' }),
      adding('timeline.clip_insert', { at: 1, asset: 'd' }, ['cl4', 'cl5']),
      adding('timeline.clip_insert', { at: 1, asset: 'd' }, ['cl2']),
      adding('timeline.update', { timeline: 't1', assets: ['d', 'e'] }, ['cl4', 'cl4']),
    ]
    expect(reduceAll(ignored, slice)).toBe(slice)
    expect(timelineReducer.reduce(slice, { ...edit('timeline.create', {}), operation: null })).toBe(slice)
  })

  it('reports why a call cannot apply to a slice', () => {
    const main = reduceAll([adding('timeline.create', { assets: ['a', 'b'] }, ['cl1', 'cl2'])])
    const ranged = reduceAll([edit('timeline.clip_trim', { clip: 'cl1', in_sec: 1, out_sec: 2 })], main)
    expect(problem(main, edit('timeline.clip_remove', { clip: 'cl2' }))).toBeNull()
    expect(problem(main, edit('timeline.clip_remove', { clip: 'cl3' }))).toBe('Clip cl3 does not exist.')
    expect(problem(main, edit('timeline.clip_move', { clip: 'cl1', to: 3 }))).toBe('Timeline t1 has 2 clips; position 3 is not between 1 and 2.')
    expect(problem(main, adding('timeline.clip_insert', { at: 3, asset: 'c' }, ['cl3']))).toBeNull()
    expect(problem(main, adding('timeline.clip_insert', { at: 4, asset: 'c' }, ['cl3']))).toContain('not between 1 and 3')
    // A record whose clip IDs are taken or missing leaves the slice unchanged.
    expect(reduceAll([adding('timeline.clip_insert', { at: 1, asset: 'c' }, ['cl2'])], main)).toBe(main)
    expect(reduceAll([edit('timeline.clip_insert', { at: 1, asset: 'c' })], main)).toBe(main)
    expect(problem(main, adding('timeline.clip_insert', { timeline: 't2', at: 2, asset: 'c' }, ['cl3'])))
      .toBe('Timeline t2 has 0 clips; position 2 is not between 1 and 1.')
    expect(problem(main, adding('timeline.create', { assets: [] }, []))).toBe('Timeline t1 exists; call dv_timeline_update to replace its clips.')
    expect(problem(main, adding('timeline.update', { timeline: 't2', assets: [] }, []))).toBe('Timeline t2 does not exist.')
    expect(problem(main, edit('timeline.rename', { timeline: 't2', name: 'x' }))).toBe('Timeline t2 does not exist.')
    expect(problem(timelineReducer.initial(), edit('timeline.rename', { name: 'x' }))).toBe('The project has no timeline.')
    expect(problem(timelineReducer.initial(), adding('timeline.create', {}, []))).toBeNull()
    expect(problem(main, edit('character.create', {}))).toBeNull()
    expect(problem(ranged, adding('timeline.clip_split', { clip: 'cl1', at_sec: 1.5 }, ['cl3']))).toBeNull()
    expect(problem(ranged, adding('timeline.clip_split', { clip: 'cl1', at_sec: 2 }, ['cl3']))).toContain('does not play 2s of its asset')
    expect(problem(main, adding('timeline.clip_split', { clip: 'cl1', at_sec: 'x' }, ['cl3']))).toContain('does not play null')
    expect(problem(main, edit('timeline.clip_trim', { clip: 'cl1', in_sec: -1 }))).toBe('The in point -1s is before the asset\'s start.')
    expect(problem(main, edit('timeline.clip_trim', { clip: 'cl1', in_sec: 2, out_sec: 2 }))).toBe('The out point 2s is not after the in point 2s.')
    expect(problem(main, edit('timeline.clip_trim', { clip: 'cl1', out_sec: 0 }))).toBe('The out point 0s is not after the in point 0s.')
    expect(problem(main, edit('timeline.clip_trim', { clip: 'cl1', out_sec: 2 }))).toBeNull()
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
    expect(clipsOf(slice)).toEqual(['cl1 a null-null'])
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
    expect([soundsOf(moved), moved.timelines[0]?.track_order, moved.timelines[1]]).toEqual([['sd1 m 2 1', 'sd3 o 0 0'], ['sound', 'sound'], slice.timelines[1]])
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
    // Once it is removed, the timeline has no sound track, and takes an add on track 0 or, as earlier builds recorded, 1.
    const none = reduceAll([edit('timeline.sound_track_remove', { track: 0 })], empty)
    expect(none.timelines[0]?.track_order).toEqual([])
    expect(problem(none, edit('timeline.sound_track_remove', { track: 0 }))).toBe('Timeline t1 has no sound track 0; it has 0.')
    expect(problem(none, soundAdd({ asset: 'm', start_sec: 0, track: 0 }, []))).toBeNull()
    expect(problem(none, soundAdd({ asset: 'm', start_sec: 0, track: 1 }, []))).toBeNull()
    expect(problem(none, soundAdd({ asset: 'm', start_sec: 0, track: 2 }, []))).toBe('Timeline t1 has no sound track 2; it has 0.')
    expect(reduceAll([soundAdd({ asset: 'm', start_sec: 0, track: 1 }, ['sd1'])], none).timelines[0]?.track_order).toEqual(['sound', 'sound'])
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

  it('mutes and unmutes the clips\' own audio and sound tracks, and moves the mutes up with their tracks on a track removal', () => {
    const slice = base()
    const mute = (params: Record<string, unknown>): ProjectRecord => edit('timeline.mute', { timeline: 't1', ...params })
    const muted = reduceAll([
      adding('timeline.create', { timeline: 't2' }, []), mute({ target: 'video', muted: true }), mute({ target: 'sound', track: 1, muted: true }),
      mute({ target: 'sound', track: 0, muted: true }), mute({ target: 'sound', track: 2, muted: true }),
      // Muting a muted track again keeps one entry.
      mute({ target: 'sound', track: 1, muted: true }),
    ], slice)
    const fields = (current: ComponentStates['timeline'], id = 't1'): unknown => {
      const timeline = current.timelines.find(candidate => candidate.id === id)
      return [timeline?.video_muted, timeline?.muted_sound_tracks]
    }
    expect([fields(muted), fields(muted, 't2')]).toEqual([[true, [0, 1, 2]], [false, []]])
    const removed = reduceAll([edit('timeline.sound_track_remove', { timeline: 't1', track: 1 })], muted)
    expect(fields(removed)).toEqual([true, [0, 1]])
    const unmuted = reduceAll([mute({ target: 'video', muted: false }), mute({ target: 'sound', track: 0, muted: false })], removed)
    expect(fields(unmuted)).toEqual([false, [1]])
    // A mute of the clips' own audio names no track; a bad target, muted value or track is refused.
    expect(problem(muted, mute({ target: 'video', muted: false, track: 9 }))).toBeNull()
    expect(problem(muted, mute({ target: 'audio', muted: true }))).toBe('target audio is not video, video_track or sound.')
    expect(problem(muted, mute({ target: 'sound', track: 0, muted: 'yes' }))).toBe('muted must be true or false.')
    expect(problem(muted, mute({ target: 'sound', track: 4, muted: true }))).toBe('Timeline t1 has no sound track 4; it has 3.')
  })

  it('lists every timeline with its clips by clip ID, their URLs, the status of placeholder clips, and its sounds in the agent summary', () => {
    const running = edit('shot.render', {}, { status: 'running' })
    const failed = edit('shot.render', {}, { status: 'failed' })
    const inputs = [running, failed].map(producer => ({ role: 'clip', ref: { record: producer.id, output: 0 }, resolved_asset: null }))
    const slice = reduceAll([
      adding('timeline.create', { assets: ['a', 'b'] }, ['cl1', 'cl2']), edit('timeline.clip_trim', { clip: 'cl2', in_sec: 1, out_sec: 2 }),
      adding('timeline.create', { timeline: 't2' }, ['cl3', 'cl4'], { inputs }),
      soundAdd({ timeline: 't2', asset: 'm', start_sec: 2, track: 1 }, ['sd1']),
      edit('timeline.sound_track_rename', { timeline: 't2', track: 0, name: 'Music' }),
      edit('timeline.mute', { timeline: 't2', target: 'video', muted: true }), edit('timeline.mute', { timeline: 't2', target: 'sound', track: 1, muted: true }),
      adding('timeline.create', { timeline: 't3' }, []), edit('timeline.sound_track_rename', { timeline: 't3', track: 0, name: 'Voice' }),
      adding('timeline.create', { timeline: 't4' }, []), edit('timeline.sound_track_remove', { timeline: 't4', track: 0 }),
    ])
    // The summary reads only the records of the state, for the status of each placeholder's render.
    const state = { components: { proj: { records: [running, failed] } } } as unknown as ProjectState
    const summary = timelineReducer.agentSummary?.(slice, { url: asset => `/dv/assets/${asset}` }, state, 's1' as never)
    expect(summary).toEqual({
      timelines: [{
        // A new timeline lists its empty sound track 0, and no sounds.
        id: FIRST_TIMELINE_ID, name: '', clips: [
          { clip: 'cl1', asset: 'a', url: '/dv/assets/a', in_sec: null, out_sec: null },
          { clip: 'cl2', asset: 'b', url: '/dv/assets/b', in_sec: 1, out_sec: 2 },
        ],
        sound_tracks: [{ track: 0, name: '' }],
      }, {
        // A mute shows only while it is on.
        id: 't2', name: '', video_muted: true, clips: [
          { clip: 'cl3', asset: null, status: 'rendering', record: running.id, in_sec: null, out_sec: null },
          { clip: 'cl4', asset: null, status: 'failed', record: failed.id, in_sec: null, out_sec: null },
        ],
        // Every track up to the last one that holds a sound or a name, with '' for an unnamed track.
        sound_tracks: [{ track: 0, name: 'Music' }, { track: 1, name: '', muted: true }],
        sounds: [{ sound: 'sd1', asset: 'm', url: '/dv/assets/m', start_sec: 2, in_sec: null, out_sec: null, track: 1 }],
      }, {
        // A named track without sounds is listed; the timeline lists no sounds.
        id: 't3', name: '', clips: [], sound_tracks: [{ track: 0, name: 'Voice' }],
      }, {
        // A timeline whose sound tracks were all removed lists none.
        id: 't4', name: '', clips: [],
      }],
    })
    // The track list comes before the sounds that name its tracks.
    expect(JSON.stringify(summary)).toMatch(/"clips":\[[^\]]*\],"sound_tracks":\[[^\]]*\],"sounds":/)
  })
})

/** The track clips of one timeline as `id asset track start in-out` text, for compact expectations. */
function trackClipsOf(slice: ComponentStates['timeline'], id = 't1'): string[] {
  const timeline = slice.timelines.find(candidate => candidate.id === id)
  return timeline?.track_clips.map(clip => `${clip.id} ${clip.asset} ${String(clip.track)} ${String(clip.start_sec)} ${String(clip.in_sec)}-${String(clip.out_sec)}`) ?? []
}

/** Base timeline t1 with clip cl4 of asset v on video track 0 at 2 s and cl5 of asset w on video track 1 at 0 s. */
const layered = (): ComponentStates['timeline'] => reduceAll([
  adding('timeline.track_clip_add', { timeline: 't1', asset: 'v', track: 0, start_sec: 2 }, ['cl4']),
  adding('timeline.track_clip_add', { timeline: 't1', asset: 'w', track: 1, start_sec: 0 }, ['cl5']),
], base())

describe('video tracks under the main video track', () => {
  it('keeps the video tracks and sound tracks in the order they were added, each new one at the bottom', () => {
    const order = (slice: ComponentStates['timeline']): unknown => slice.timelines[0]?.track_order
    // A new timeline shows sound track 0; the two video tracks of the base go under it.
    expect(order(layered())).toEqual(['sound', 'video', 'video'])
    const sounded = reduceAll([
      soundAdd({ timeline: 't1', asset: 'm', start_sec: 0, track: 1 }, ['sd1']),
      adding('timeline.track_clip_add', { timeline: 't1', asset: 'z', track: 2, start_sec: 0 }, ['cl6']),
    ], layered())
    expect(order(sounded)).toEqual(['sound', 'video', 'video', 'sound', 'video'])
    // A removed track takes its entry along; a track whose last clip goes stays, empty.
    const removed = reduceAll([edit('timeline.video_track_remove', { timeline: 't1', track: 0 })], sounded)
    expect(order(removed)).toEqual(['sound', 'video', 'sound', 'video'])
    expect(order(reduceAll([edit('timeline.clip_remove', { clip: 'cl6' })], removed))).toEqual(['sound', 'video', 'sound', 'video'])
    // Removing sound track 0 leaves the other sound track, now track 0, in its place; removing the last one leaves no
    // sound track.
    const first = reduceAll([edit('timeline.sound_track_remove', { timeline: 't1', track: 0 })], sounded)
    expect(order(first)).toEqual(['video', 'video', 'sound', 'video'])
    expect(order(reduceAll([edit('timeline.sound_track_remove', { timeline: 't1', track: 0 })], first))).toEqual(['video', 'video', 'video'])
    // A sound track whose last sound goes stays, empty, until a removal deletes it.
    expect(order(reduceAll([edit('timeline.sound_remove', { sound: 'sd1' })], sounded))).toEqual(['sound', 'video', 'video', 'sound', 'video'])
  })

  it('adds an empty video track or sound track at the bottom with timeline.track_add, which the calls of its kind then name', () => {
    const add = (kind: unknown): ProjectRecord => edit('timeline.track_add', { timeline: 't1', kind })
    const added = reduceAll([adding('timeline.create', { timeline: 't2' }, []), add('video'), add('sound')], layered())
    // Only the named timeline gains the tracks.
    expect(added.timelines[1]?.track_order).toEqual(['sound'])
    const timeline = added.timelines[0]
    expect(timeline?.track_order).toEqual(['sound', 'video', 'video', 'video', 'sound'])
    expect(videoTrackCount(timeline as never)).toBe(3)
    // The empty tracks take clips and sounds, and calls may name the track after them.
    expect(problem(added, adding('timeline.track_clip_add', { timeline: 't1', asset: 'z', track: 3, start_sec: 0 }, []))).toBeNull()
    expect(problem(added, soundAdd({ timeline: 't1', asset: 'm', start_sec: 0, track: 2 }, []))).toBeNull()
    expect(problem(added, edit('timeline.video_track_remove', { timeline: 't1', track: 2 }))).toBeNull()
    expect(problem(added, add('subtitle'))).toBe('kind subtitle is not video or sound.')
    expect(problem(added, edit('timeline.track_add', { timeline: 't9', kind: 'video' }))).toBe('Timeline t9 does not exist.')
  })

  it('moves a video track to another number with timeline.video_track_move, its clips and mute along, the tracks between moving one step', () => {
    const slice = reduceAll([
      adding('timeline.create', { timeline: 't2' }, []),
      adding('timeline.track_clip_add', { timeline: 't1', asset: 'z', track: 2, start_sec: 0 }, ['cl6']),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 1, muted: true }),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 2, muted: true }),
    ], layered())
    const order = slice.timelines[0]?.track_order
    const move = (track: unknown, to: unknown): ProjectRecord => edit('timeline.video_track_move', { timeline: 't1', track, to })
    const up = reduceAll([move(2, 0)], slice)
    expect(trackClipsOf(up)).toEqual(['cl4 v 1 2 null-null', 'cl5 w 2 0 null-null', 'cl6 z 0 0 null-null'])
    expect(up.timelines[0]?.muted_video_tracks).toEqual([0, 2])
    expect(up.timelines[0]?.track_order).toEqual(order)
    expect(up.timelines[1]).toBe(slice.timelines[1])
    const down = reduceAll([move(0, 2)], up)
    expect(trackClipsOf(down)).toEqual(trackClipsOf(slice))
    expect(down.timelines[0]?.muted_video_tracks).toEqual([1, 2])
    expect(trackClipsOf(reduceAll([move(1, 1)], slice))).toEqual(trackClipsOf(slice))
    expect(problem(slice, move(3, 0))).toBe('Timeline t1 has no video track 3; it has 3 under the main video track.')
    expect(problem(slice, move(0, 3))).toBe('Timeline t1 has no video track 3; it has 3 under the main video track.')
    expect(problem(slice, move(0, -1))).toBe('to -1 is not a track number of 0 or more.')
    expect(problem(slice, move('a', 1))).toBe('track a is not a track number of 0 or more.')
    expect(problem(slice, edit('timeline.video_track_move', { timeline: 't9', track: 0, to: 1 }))).toBe('Timeline t9 does not exist.')
  })

  it('swaps the main video track with video track 0 with timeline.main_track_swap, at the start times the record stored', () => {
    const slice = reduceAll([
      adding('timeline.create', { timeline: 't2' }, []),
      edit('timeline.mute', { timeline: 't1', target: 'video', muted: true }),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 1, muted: true }),
    ], layered())
    const swap = (starts: unknown[], timeline = 't1'): ProjectRecord => edit('timeline.main_track_swap', { timeline }, { report: { starts } })
    const swapped = reduceAll([swap([0, 3, 7])], slice)
    expect(clipsOf(swapped)).toEqual(['cl4 v null-null'])
    expect(trackClipsOf(swapped)).toEqual(['cl5 w 1 0 null-null', 'cl1 a 0 0 null-null', 'cl2 b 0 3 null-null', 'cl3 c 0 7 null-null'])
    const fields = (sliced: ComponentStates['timeline']): unknown[] =>
      [sliced.timelines[0]?.video_muted, sliced.timelines[0]?.muted_video_tracks, sliced.timelines[0]?.track_order]
    expect(fields(swapped)).toEqual([false, [0, 1], ['sound', 'video', 'video']])
    expect(swapped.timelines[1]).toBe(slice.timelines[1])
    // Swapping back puts cl4 on video track 0 at the time it played.
    const back = reduceAll([swap([0])], swapped)
    expect([clipsOf(back), trackClipsOf(back), fields(back)]).toEqual([
      ['cl1 a null-null', 'cl2 b null-null', 'cl3 c null-null'], ['cl5 w 1 0 null-null', 'cl4 v 0 0 null-null'], [true, [1], ['sound', 'video', 'video']],
    ])
    // A record without one start time per clip of the main video track applies nothing.
    expect(reduceAll([swap([0, 3]), swap([0, 3, 'x'])], slice)).toBe(slice)
    // A report without a `starts` list stores no start times.
    expect(reduceAll([edit('timeline.main_track_swap', { timeline: 't1' }, { report: {} })], slice)).toBe(slice)
    expect(problem(slice, swap([]))).toBeNull()
    const removeTrack = (track: number): ProjectRecord => edit('timeline.video_track_remove', { timeline: 't1', track })
    const single = reduceAll([removeTrack(1), removeTrack(0)], slice)
    expect(problem(single, swap([]))).toBe('Timeline t1 has no video track under the main video track to swap with.')
    const [t1] = slice.timelines
    const unrendered = t1?.clips.map((clip, index) => index === 1 ? { ...clip, asset: null } : clip)
    expect(problem({ timelines: [{ ...t1, clips: unrendered } as Timeline] }, swap([])))
      .toBe('Clip cl2 is still rendering; it cannot leave the main video track yet.')
    expect(problem(slice, swap([], 't9'))).toBe('Timeline t9 does not exist.')
  })

  it('places the clips of the main video track one after another for timeline.main_track_swap, while each length is known', () => {
    const trimmed = reduceAll([edit('timeline.clip_trim', { clip: 'cl1', in_sec: 0.5 }), edit('timeline.clip_trim', { clip: 'cl2', out_sec: 1 })], base())
    const durations: Record<string, number> = { a: 2, b: 4, c: 3 }
    const timeline = trimmed.timelines[0] as Timeline
    expect(mainClipStarts(timeline, asset => durations[asset] ?? null)).toEqual([0, 1.5, 2.5])
    expect(mainClipStarts(timeline, asset => asset === 'c' ? null : durations[asset] ?? null))
      .toBe('The length of asset c is not known yet, so clip cl3 cannot go on a video track.')
  })

  it('deletes the main video track with timeline.main_track_remove, and video track 0 takes its place with its clips in time order and its mute', () => {
    const slice = reduceAll([
      adding('timeline.create', { timeline: 't2' }, []),
      adding('timeline.track_clip_add', { timeline: 't1', asset: 'x', track: 0, start_sec: 0 }, ['cl6']),
      edit('timeline.clip_trim', { clip: 'cl4', out_sec: 1 }),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 0, muted: true }),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 1, muted: true }),
    ], layered())
    const remove = (timeline = 't1'): ProjectRecord => edit('timeline.main_track_remove', { timeline })
    const once = reduceAll([remove()], slice)
    // The clips of video track 0 play one after another from their start times' order, without the gap before cl4.
    expect(clipsOf(once)).toEqual(['cl6 x null-null', 'cl4 v null-1'])
    expect(once.timelines[0]?.clips.every(clip => clip.source === null)).toBe(true)
    expect(trackClipsOf(once)).toEqual(['cl5 w 0 0 null-null'])
    expect([once.timelines[0]?.video_muted, once.timelines[0]?.muted_video_tracks, once.timelines[0]?.track_order])
      .toEqual([true, [0], ['sound', 'video']])
    expect(once.timelines[1]).toBe(slice.timelines[1])
    const twice = reduceAll([remove()], once)
    expect([clipsOf(twice), trackClipsOf(twice), twice.timelines[0]?.video_muted, twice.timelines[0]?.track_order])
      .toEqual([['cl5 w null-null'], [], true, ['sound']])
    // Without a video track under it, the main video track stays, empty and with its own audio unmuted.
    const emptied = reduceAll([remove()], twice)
    expect([clipsOf(emptied), emptied.timelines[0]?.video_muted, emptied.timelines[0]?.track_order]).toEqual([[], false, ['sound']])
    expect(problem(emptied, remove())).toBe('Timeline t1 has no clip on the main video track and no video track under it.')
    expect(problem(slice, remove('t9'))).toBe('Timeline t9 does not exist.')
  })

  it('adds clips to the tracks, moves them in time and between tracks, and deletes a track with its clips', () => {
    const slice = layered()
    expect(trackClipsOf(slice)).toEqual(['cl4 v 0 2 null-null', 'cl5 w 1 0 null-null'])
    expect(clipsOf(slice)).toEqual(['cl1 a null-null', 'cl2 b null-null', 'cl3 c null-null'])
    expect(videoTrackCount(slice.timelines[0] as never)).toBe(2)
    const moved = reduceAll([
      edit('timeline.track_clip_move', { clip: 'cl4', start_sec: 5 }),
      edit('timeline.track_clip_move', { clip: 'cl5', start_sec: 1, track: 2 }),
    ], slice)
    expect(trackClipsOf(moved)).toEqual(['cl4 v 0 5 null-null', 'cl5 w 2 1 null-null'])
    // A deleted track takes its clips and its mute along, and every lower track moves up one with its mute.
    const muted = reduceAll([
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 0, muted: true }),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 2, muted: true }),
    ], moved)
    expect(muted.timelines[0]?.muted_video_tracks).toEqual([0, 2])
    const removed = reduceAll([edit('timeline.video_track_remove', { timeline: 't1', track: 0 })], muted)
    expect(trackClipsOf(removed)).toEqual(['cl5 w 1 1 null-null'])
    expect(removed.timelines[0]?.muted_video_tracks).toEqual([1])
    expect(reduceAll([edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 1, muted: false })], removed).timelines[0]?.muted_video_tracks)
      .toEqual([])
    // A removal of a middle track keeps the higher tracks and their mutes, and leaves another timeline alone.
    const two = reduceAll([
      adding('timeline.create', { timeline: 't2', assets: [] }, []),
      adding('timeline.track_clip_add', { timeline: 't2', asset: 'z', track: 0, start_sec: 0 }, ['cl9']),
      edit('timeline.video_track_remove', { timeline: 't1', track: 2 }),
    ], muted)
    expect(trackClipsOf(two)).toEqual(['cl4 v 0 5 null-null'])
    expect(two.timelines[0]?.muted_video_tracks).toEqual([0])
    expect(trackClipsOf(two, 't2')).toEqual(['cl9 z 0 0 null-null'])
  })

  it('removes, splits, trims and replaces a track clip by clip ID, a trim of the in point moving its start along', () => {
    const slice = layered()
    expect(trackClipsOf(reduceAll([edit('timeline.clip_remove', { clip: 'cl4' })], slice))).toEqual(['cl5 w 1 0 null-null'])
    const split = reduceAll([adding('timeline.clip_split', { clip: 'cl4', at_sec: 1.5 }, ['cl6'])], slice)
    expect(trackClipsOf(split)).toEqual(['cl4 v 0 2 null-1.5', 'cl6 v 0 3.5 1.5-null', 'cl5 w 1 0 null-null'])
    const trimmed = reduceAll([edit('timeline.clip_trim', { clip: 'cl6', in_sec: 2, out_sec: 4 })], split)
    expect(trackClipsOf(trimmed)[1]).toBe('cl6 v 0 4 2-4')
    expect(trackClipsOf(reduceAll([edit('timeline.clip_trim', { clip: 'cl6' })], trimmed))[1]).toBe('cl6 v 0 2 null-null')
    expect(trackClipsOf(reduceAll([edit('timeline.clip_replace', { clip: 'cl6', asset: 'x' })], trimmed))[1]).toBe('cl6 x 0 4 null-null')
    // A clip ID of a track clip is taken: no record may assign it again.
    expect(reduceAll([adding('timeline.clip_insert', { at: 1, asset: 'd' }, ['cl4'])], slice)).toBe(slice)
  })

  it('reports why a video track call cannot apply', () => {
    const slice = layered()
    const add = (params: Record<string, unknown>): string | null => problem(slice, edit('timeline.track_clip_add', { timeline: 't1', asset: 'v', ...params }))
    expect(add({ track: 2, start_sec: 0 })).toBeNull()
    expect(add({ track: 3, start_sec: 0 })).toBe('Timeline t1 has no video track 3; it has 2 under the main video track.')
    expect(add({ track: -1, start_sec: 0 })).toBe('track -1 is not a track number of 0 or more.')
    expect(add({ track: 0, start_sec: -1 })).toBe('start_sec -1 is not a time of 0 seconds or more.')
    expect(add({ track: 0, start_sec: 0, timeline: 't9' })).toBe('Timeline t9 does not exist.')
    expect(problem(slice, edit('timeline.video_track_remove', { timeline: 't1', track: 2 }))).toBe('Timeline t1 has no video track 2; it has 2 under the main video track.')
    expect(problem(slice, edit('timeline.video_track_remove', { timeline: 't1', track: 1 }))).toBeNull()
    expect(problem(slice, edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 5, muted: true })))
      .toBe('Timeline t1 has no video track 5; it has 2 under the main video track.')
    expect(problem(slice, edit('timeline.mute', { timeline: 't1', target: 'image', muted: true }))).toBe('target image is not video, video_track or sound.')
    const move = (params: Record<string, unknown>): string | null => problem(slice, edit('timeline.track_clip_move', params))
    expect(move({ clip: 'cl4', start_sec: 0, track: 2 })).toBeNull()
    expect(move({ clip: 'cl4', start_sec: -2 })).toBe('start_sec -2 is not a time of 0 seconds or more.')
    expect(move({ clip: 'cl4', start_sec: 0, track: 4 })).toBe('Timeline t1 has no video track 4; it has 2 under the main video track.')
    // A clip of the main video track moves to a video track only with `track`, and only once it is rendered.
    expect(move({ clip: 'cl1', start_sec: 0 })).toBe('Clip cl1 is on the main video track; give track to move it to a video track.')
    expect(move({ clip: 'cl1', start_sec: 0, track: 2 })).toBeNull()
    const [t1] = slice.timelines
    const unrendered = t1?.clips.map((clip, index) => index === 0 ? { ...clip, asset: null } : clip)
    const pending = { timelines: [{ ...t1, clips: unrendered } as Timeline] }
    expect(problem(pending, edit('timeline.track_clip_move', { clip: 'cl1', start_sec: 0, track: 0 }))).toBe('Clip cl1 is still rendering.')
    // A track clip moves into the main video track at any of its positions, the one after the last included.
    expect(problem(slice, edit('timeline.clip_move', { clip: 'cl4', to: 4 }))).toBeNull()
    expect(problem(slice, edit('timeline.clip_move', { clip: 'cl4', to: 5 }))).toContain('5')
    // A track clip always has its asset, so trim and split check only their times.
    expect(problem(slice, edit('timeline.clip_split', { clip: 'cl4', at_sec: 0 }))).toContain('does not play 0s of its asset')
  })

  it('moves a clip between the main video track and the video tracks, keeping its ID and its in and out points', () => {
    const slice = reduceAll([
      edit('timeline.clip_trim', { clip: 'cl2', in_sec: 1, out_sec: 3 }),
      adding('timeline.create', { timeline: 't2' }, []),
    ], layered())
    const down = reduceAll([edit('timeline.track_clip_move', { clip: 'cl2', start_sec: 6, track: 2 })], slice)
    expect(clipsOf(down)).toEqual(['cl1 a null-null', 'cl3 c null-null'])
    expect(trackClipsOf(down)).toEqual(['cl4 v 0 2 null-null', 'cl5 w 1 0 null-null', 'cl2 b 2 6 1-3'])
    // The track after the last joins the track order at the bottom.
    expect(down.timelines[0]?.track_order.filter(kind => kind === 'video')).toHaveLength(3)
    const up = reduceAll([edit('timeline.clip_move', { clip: 'cl2', to: 1 })], down)
    expect(clipsOf(up)).toEqual(['cl2 b 1-3', 'cl1 a null-null', 'cl3 c null-null'])
    expect(up.timelines[0]?.clips[0]?.source).toBeNull()
    expect(trackClipsOf(up)).toEqual(['cl4 v 0 2 null-null', 'cl5 w 1 0 null-null'])
    expect([down.timelines[1], up.timelines[1]]).toEqual([slice.timelines[1], slice.timelines[1]])
  })

  it('finds overlaps, early starts and unknown lengths of the track clips after a call', () => {
    const durations: Record<string, number> = { v: 4, w: 2 }
    const durationOf = (asset: string): number | null => durations[asset] ?? null
    const timelineAfter = (record: ProjectRecord): Parameters<typeof trackClipProblem>[0] =>
      afterCall(layered(), record).timelines[0] as never
    const added = NEW_CLIP
    const at = (start: number, track = 0): ProjectRecord => adding('timeline.track_clip_add', { timeline: 't1', asset: 'w', track, start_sec: start }, ['new'])
    // cl4 plays 2 s to 6 s on track 0: a 2 s clip from 0 s or from 6 s only touches it.
    expect(trackClipProblem(timelineAfter(at(6)), durationOf, added)).toBeNull()
    expect(trackClipProblem(timelineAfter(at(0)), durationOf, added)).toBeNull()
    expect(trackClipProblem(timelineAfter(at(4)), durationOf, added))
      .toBe('The new clip would overlap clip cl4 on video track 0 (2s to 6s); pick another start_sec or track.')
    expect(trackClipProblem(timelineAfter(at(1)), durationOf, added))
      .toBe('The new clip would overlap clip cl4 on video track 0 (2s to 6s); pick another start_sec or track.')
    expect(trackClipProblem(timelineAfter(edit('timeline.track_clip_move', { clip: 'cl5', start_sec: 3, track: 0 })), durationOf, brandString<ClipId>('cl5')))
      .toBe('Clip cl5 would overlap clip cl4 on video track 0 (2s to 6s); pick another start_sec or track.')
    expect(trackClipProblem(timelineAfter(edit('timeline.clip_trim', { clip: 'cl4', in_sec: 3 })), durationOf)).toBeNull()
    expect(trackClipProblem(timelineAfter(edit('timeline.clip_trim', { clip: 'cl5', in_sec: -1 })), durationOf))
      .toBe('Clip cl5 would start 1s before the timeline\'s start.')
    expect(trackClipProblem(timelineAfter(at(9)), () => null, added))
      .toBe('The length of asset v is not known yet, so clip cl4 cannot go on a video track.')
    expect(trackClipProblem({ ...timelineAfter(at(9)), track_clips: [{ id: added, asset: brandString<AssetId>('z'), in_sec: null, out_sec: null, start_sec: 0, track: 0 }] }, durationOf, added))
      .toBe('The length of asset z is not known yet, so the new clip cannot go on a video track.')
    expect(trackClipProblem({ ...timelineAfter(at(9)), track_clips: [{ id: added, asset: brandString<AssetId>('z'), in_sec: null, out_sec: null, start_sec: -0.5, track: 0 }] }, () => 2, added))
      .toBe('The new clip would start 0.5s before the timeline\'s start.')
  })

  it('lists the video tracks with their clips by start time, and their mutes, in the agent summary', () => {
    const slice = reduceAll([
      adding('timeline.track_clip_add', { timeline: 't1', asset: 'x', track: 1, start_sec: 0.5 }, ['cl6']),
      edit('timeline.mute', { timeline: 't1', target: 'video_track', track: 1, muted: true }),
    ], layered())
    // The summary reads only the records of the state, for the status of placeholder clips.
    const state: ProjectState = { components: { proj: { records: [] } } } as never
    const summarize = (from: ComponentStates['timeline']): Array<Record<string, unknown>> => {
      const summary = timelineReducer.agentSummary?.(from, { url: asset => `/assets/${asset}` }, state, 's1' as never) as { timelines: Array<Record<string, unknown>> }
      return summary.timelines
    }
    expect(summarize(slice)[0]?.['video_tracks']).toEqual([
      { track: 0, clips: [{ clip: 'cl4', asset: 'v', url: '/assets/v', start_sec: 2, in_sec: null, out_sec: null }] },
      {
        track: 1, muted: true, clips: [
          { clip: 'cl5', asset: 'w', url: '/assets/w', start_sec: 0, in_sec: null, out_sec: null },
          { clip: 'cl6', asset: 'x', url: '/assets/x', start_sec: 0.5, in_sec: null, out_sec: null },
        ],
      },
    ])
    expect(summarize(base())[0]).not.toHaveProperty('video_tracks')
  })
})
