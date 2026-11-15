/** The pure `timeline` reducer: every operation's effect on the slice, and the clip and clip ID checks. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ComponentStates, ProjectRecord, ProjectState, RecordId } from '@dv/project'
import { describe, expect, it } from 'vitest'
import { clipProblem, FIRST_TIMELINE_ID, timelineReducer } from '../src/reducer.ts'
import type {} from '../src/types.ts'

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
    // create only creates: a create of an existing ID changes nothing; update replaces the clips and keeps the name.
    expect(reduceAll([adding('timeline.create', { assets: ['d'] }, ['cl4'])], slice)).toBe(slice)
    expect(clipsOf(reduceAll([adding('timeline.update', { timeline: 't1', assets: ['d'] }, ['cl4'])], slice))).toEqual(['cl4 d null-null'])
    expect(reduceAll([adding('timeline.update', { timeline: 't2', assets: [] }, [])], slice).timelines[1]).toEqual({
      id: 't2', name: 'B side', clips: [], sounds: [], sound_track_names: [],
    })
    const renamed = reduceAll([edit('timeline.rename', { timeline: 't2', name: '片尾' })], slice)
    expect(renamed.timelines.map(timeline => timeline.name)).toEqual(['', '片尾'])
    expect(reduceAll([edit('timeline.delete', { timeline: 't1' })], slice).timelines.map(timeline => timeline.id)).toEqual(['t2'])
    expect(reduceAll([adding('timeline.create', { timeline: 't3' }, [])], slice).timelines[2]).toEqual({
      id: 't3', name: '', clips: [], sounds: [], sound_track_names: [],
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
        sounds: [], sound_track_names: [],
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
    // A timeline without sounds or names has no track to remove, and takes an add or a rename on tracks 0 and 1.
    expect(problem(empty, edit('timeline.sound_track_remove', { track: 0 }))).toBe('Timeline t1 has no sound track 0; it has 0.')
    expect(problem(empty, soundAdd({ asset: 'm', start_sec: 0, track: 1 }, []))).toBeNull()
    expect(problem(empty, soundAdd({ asset: 'm', start_sec: 0, track: 2 }, []))).toBe('Timeline t1 has no sound track 2; it has 0.')
    expect(problem(empty, edit('timeline.sound_track_rename', { track: 1, name: 'x' }))).toBeNull()
    expect(problem(empty, edit('timeline.sound_track_rename', { track: 2, name: 'x' }))).toBe('Timeline t1 has no sound track 2; it has 0.')
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

  it('lists every timeline with its clips by clip ID, their URLs, the status of placeholder clips, and its sounds in the agent summary', () => {
    const running = edit('shot.render', {}, { status: 'running' })
    const failed = edit('shot.render', {}, { status: 'failed' })
    const inputs = [running, failed].map(producer => ({ role: 'clip', ref: { record: producer.id, output: 0 }, resolved_asset: null }))
    const slice = reduceAll([
      adding('timeline.create', { assets: ['a', 'b'] }, ['cl1', 'cl2']), edit('timeline.clip_trim', { clip: 'cl2', in_sec: 1, out_sec: 2 }),
      adding('timeline.create', { timeline: 't2' }, ['cl3', 'cl4'], { inputs }),
      soundAdd({ timeline: 't2', asset: 'm', start_sec: 2, track: 1 }, ['sd1']),
      edit('timeline.sound_track_rename', { timeline: 't2', track: 0, name: 'Music' }),
      adding('timeline.create', { timeline: 't3' }, []), edit('timeline.sound_track_rename', { timeline: 't3', track: 0, name: 'Voice' }),
    ])
    // The summary reads only the records of the state, for the status of each placeholder's render.
    const state = { components: { proj: { records: [running, failed] } } } as unknown as ProjectState
    const summary = timelineReducer.agentSummary?.(slice, { url: asset => `/dv/assets/${asset}` }, state, 's1' as never)
    expect(summary).toEqual({
      timelines: [{
        // A timeline without sounds or track names lists neither.
        id: FIRST_TIMELINE_ID, name: '', clips: [
          { clip: 'cl1', asset: 'a', url: '/dv/assets/a', in_sec: null, out_sec: null },
          { clip: 'cl2', asset: 'b', url: '/dv/assets/b', in_sec: 1, out_sec: 2 },
        ],
      }, {
        id: 't2', name: '', clips: [
          { clip: 'cl3', asset: null, status: 'rendering', record: running.id, in_sec: null, out_sec: null },
          { clip: 'cl4', asset: null, status: 'failed', record: failed.id, in_sec: null, out_sec: null },
        ],
        // Every track up to the last one that holds a sound or a name, with '' for an unnamed track.
        sound_tracks: [{ track: 0, name: 'Music' }, { track: 1, name: '' }],
        sounds: [{ sound: 'sd1', asset: 'm', url: '/dv/assets/m', start_sec: 2, track: 1 }],
      }, {
        // A named track without sounds is listed; the timeline lists no sounds.
        id: 't3', name: '', clips: [], sound_tracks: [{ track: 0, name: 'Voice' }],
      }],
    })
    // The track list comes before the sounds that name its tracks.
    expect(JSON.stringify(summary)).toMatch(/"clips":\[[^\]]*\],"sound_tracks":\[[^\]]*\],"sounds":/)
  })
})
