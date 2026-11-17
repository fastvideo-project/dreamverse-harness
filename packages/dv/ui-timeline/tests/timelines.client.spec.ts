/**
 * The assets that the editor's ＋ pickers and add-sound dialog offer, the placement of a timeline's sounds and of the
 * clips of its video tracks, the clip the preview shows, and the order of the track rows.
 */
import { describe, expect, it } from 'vitest'
import type { AssetId } from '@dv/project/types'
import type { RecordId } from '@dv/project/types'
import type { Clip, ClipId, SoundId, Timeline, TimelineId } from '@dv/timeline/types'
import { FALLBACK_CLIP_SECONDS } from '@dv/ui-kit/timeline.ts'
import { asset, fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { audioAssets, coveredAbove, placeClips, placeSounds, topClipAt, trackRows, videoAssets } from '../src/client/timelines.ts'

describe('videoAssets', () => {
  it('lists the video assets of a state, newest first', () => {
    expect(videoAssets(fixtureState()).map(video => video.id)).toEqual(['shot1.mp4', 'shot2.mp4', 'export.mp4'])
  })
})

describe('audioAssets', () => {
  it('lists the audio assets of a state, newest first', () => {
    const state = fixtureState()
    state.assets.push(asset('a.mp3', 'audio/mpeg', null, 2), asset('long.wav', 'audio/wav', null))
    expect(audioAssets(state).map(audio => audio.id)).toEqual(['long.wav', 'a.mp3'])
    expect(audioAssets(fixtureState())).toEqual([])
  })
})

describe('placeSounds', () => {
  it('plays each sound from its in point to its out point, else its asset\'s length, its measured length or the fallback, and ends with the last sound', () => {
    const state = fixtureState()
    state.assets.push(asset('a.mp3', 'audio/mpeg', null, 2), asset('b.mp3', 'audio/mpeg', null), asset('c.mp3', 'audio/mpeg', null))
    const sound = (id: string, file: string, start: number, track: number, range: [number | null, number | null] = [null, null]): Timeline['sounds'][number] =>
      ({ id: id as SoundId, asset: file as AssetId, in_sec: range[0], out_sec: range[1], start_sec: start, track })
    const timeline: Timeline = {
      id: 't1' as TimelineId, name: '', clips: [], sound_track_names: [], muted_sound_tracks: [], muted_video_tracks: [], track_order: ['video', 'sound'],
      sounds: [
        sound('sd1', 'a.mp3', 1, 0), sound('sd2', 'b.mp3', 0, 1), sound('sd3', 'c.mp3', 4, 0), sound('sd4', 'lost.mp3', 0, 2),
        // The two parts of a split sound: the first ends at its out point, the second plays from its in point to the asset's end.
        sound('sd5', 'a.mp3', 6, 1, [null, 0.5]), sound('sd6', 'a.mp3', 6.5, 1, [0.5, null]),
        // An in point past the asset's 2 s end still leaves a sliver to grab.
        sound('sd7', 'a.mp3', 8, 1, [3, null]),
      ],
    }
    const { sounds, end } = placeSounds(state, timeline, new Map([['b.mp3', 3.5]]))
    expect(sounds).toEqual([
      { sound: 'sd1', assetId: 'a.mp3', name: 'a.mp3', startSec: 1, rawIn: null, rawOut: null, inSec: 0, seconds: 2, assetSeconds: 2, track: 0 },
      { sound: 'sd2', assetId: 'b.mp3', name: 'b.mp3', startSec: 0, rawIn: null, rawOut: null, inSec: 0, seconds: 3.5, assetSeconds: 3.5, track: 1 },
      { sound: 'sd3', assetId: 'c.mp3', name: 'c.mp3', startSec: 4, rawIn: null, rawOut: null, inSec: 0, seconds: FALLBACK_CLIP_SECONDS, assetSeconds: FALLBACK_CLIP_SECONDS, track: 0 },
      { sound: 'sd4', assetId: 'lost.mp3', name: 'lost.mp3', startSec: 0, rawIn: null, rawOut: null, inSec: 0, seconds: FALLBACK_CLIP_SECONDS, assetSeconds: FALLBACK_CLIP_SECONDS, track: 2 },
      { sound: 'sd5', assetId: 'a.mp3', name: 'a.mp3', startSec: 6, rawIn: null, rawOut: 0.5, inSec: 0, seconds: 0.5, assetSeconds: 2, track: 1 },
      { sound: 'sd6', assetId: 'a.mp3', name: 'a.mp3', startSec: 6.5, rawIn: 0.5, rawOut: null, inSec: 0.5, seconds: 1.5, assetSeconds: 2, track: 1 },
      { sound: 'sd7', assetId: 'a.mp3', name: 'a.mp3', startSec: 8, rawIn: 3, rawOut: null, inSec: 3, seconds: 0.1, assetSeconds: 2, track: 1 },
    ])
    expect(end).toBe(Math.max(8, 4 + FALLBACK_CLIP_SECONDS))
  })

  it('places no sounds without a timeline, ending at 0', () => {
    expect(placeSounds(fixtureState(), null, new Map())).toEqual({ sounds: [], end: 0 })
  })
})

describe('placeClips', () => {
  it('places each clip at its start for its in and out points, with the thumbnail and stale mark of its producer', () => {
    const state = fixtureState()
    const [t1] = state.components.timeline.timelines
    if (t1 === undefined) throw new Error('no t1')
    t1.clips = [
      { id: 'cl5' as ClipId, asset: 'shot2.mp4' as AssetId, source: null, in_sec: 1, out_sec: null, start_sec: 2, track: 1 },
      { id: 'cl6' as ClipId, asset: 'lost.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
      { id: 'cl7' as ClipId, asset: 'ref.png' as AssetId, source: null, in_sec: null, out_sec: 0.05, start_sec: 9, track: 0 },
    ]
    t1.muted_video_tracks = [3]
    const { clips, tracks, end } = placeClips(state, t1)
    const facts = clips.map(clip => [
      clip.clip, clip.track, clip.startSec, clip.inSec, clip.outSec, clip.seconds, clip.thumbnail, clip.stale,
    ])
    expect(facts).toEqual([
      // shot2.mp4 (6 s) comes from g2, which left a still and is stale.
      ['cl5', 1, 2, 1, 6, 5, 'shot2-last.png', true],
      ['cl6', 0, 0, 0, FALLBACK_CLIP_SECONDS, FALLBACK_CLIP_SECONDS, null, false],
      // A clip plays at least a tenth of a second; the image of its producing import is its thumbnail.
      ['cl7', 0, 9, 0, 0.05, 0.1, 'ref.png', false],
    ])
    expect([tracks, end]).toEqual([4, 9.1])
    expect(placeClips(state, null)).toEqual({ clips: [], tracks: 0, end: 0 })
  })

  it('places each clip at its start time, or where the clip before it on its track ends when that is later', () => {
    const state = fixtureState()
    const [t1] = state.components.timeline.timelines
    if (t1 === undefined) throw new Error('no t1')
    // shot1.mp4 plays 4 s and cl2 plays 3 s of shot2.mp4; cl3 asks for 1 s, before cl1 ends, and cl4 on track 1 for 1 s too.
    t1.clips = [
      { ...t1.clips[0] as Clip, start_sec: 0 }, { ...t1.clips[1] as Clip, start_sec: 6 },
      { id: 'cl3' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 1, track: 0 },
      { id: 'cl4' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 1, track: 1 },
    ]
    const { clips, end } = placeClips(state, t1)
    expect([clips.map(clip => clip.startSec), end]).toEqual([[0, 8, 4, 1], 11])
  })
})

describe('topClipAt', () => {
  it('picks the clip of the track with the lowest number that plays at a time, a placeholder too, none in a gap, and the clip that ends last at the end', () => {
    const state = fixtureState()
    const [t1] = state.components.timeline.timelines
    if (t1 === undefined) throw new Error('no t1')
    t1.clips = [
      { id: 'low' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 0, track: 2 },
      { id: 'high' as ClipId, asset: 'export.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 1, track: 0 },
      { id: 'middle' as ClipId, asset: 'export.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 3.5, track: 1 },
      { id: 'wait' as ClipId, asset: null, source: { record: 'g1' as RecordId, output: 0 }, in_sec: null, out_sec: 1, start_sec: 7, track: 0 },
    ]
    const { clips } = placeClips(state, t1)
    expect([0.5, 1, 3.9, 4, 6, 6.8, 7.5, 8].map(at => topClipAt(clips, at)?.clip ?? null))
      .toEqual(['low', 'high', 'high', 'middle', 'middle', null, 'wait', 'wait'])
    expect(topClipAt([], 0)).toBeUndefined()
  })

  it('tells whether the clips of the tracks with lower numbers cover a clip\'s whole span', () => {
    const state = fixtureState()
    const [t1] = state.components.timeline.timelines
    if (t1 === undefined) throw new Error('no t1')
    const clip = (id: string, start: number, out: number, track: number): Clip =>
      ({ id: id as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: out, start_sec: start, track })
    // Track 0 plays 0 s to 2 s and 2 s to 4 s; track 1 plays 4 s to 5 s.
    t1.clips = [clip('a', 0, 2, 0), clip('b', 2, 2, 0), clip('c', 4, 1, 1), clip('under', 1, 3, 2), clip('past', 4, 1, 2), clip('gap', 5.5, 1, 2)]
    const { clips } = placeClips(state, t1)
    const covered = (id: string): boolean => coveredAbove(clips, clips.find(each => each.clip === id) as (typeof clips)[number])
    expect(['under', 'past', 'gap', 'c'].map(covered)).toEqual([true, true, false, false])
  })
})

describe('trackRows', () => {
  it('lists the stored tracks in the order they were added, then the tracks the order does not list yet', () => {
    expect(trackRows(['sound', 'video', 'sound', 'video'], 2, 2)).toEqual([
      { kind: 'sound', track: 0 }, { kind: 'video', track: 0 }, { kind: 'sound', track: 1 }, { kind: 'video', track: 1 },
    ])
    // A counted video track or sound track that the order does not list goes at the bottom.
    expect(trackRows(['sound', 'video'], 2, 1)).toEqual([{ kind: 'sound', track: 0 }, { kind: 'video', track: 0 }, { kind: 'video', track: 1 }])
    expect(trackRows(['sound'], 0, 2)).toEqual([{ kind: 'sound', track: 0 }, { kind: 'sound', track: 1 }])
  })
})
