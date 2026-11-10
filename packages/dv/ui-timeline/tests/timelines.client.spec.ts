/** The assets that the editor's insert picker and add-sound dialog offer, and the placement of a timeline's sounds. */
import { describe, expect, it } from 'vitest'
import type { AssetId } from '@dv/project/types'
import type { SoundId, Timeline, TimelineId } from '@dv/timeline/types'
import { FALLBACK_CLIP_SECONDS } from '@dv/ui-kit/timeline.ts'
import { asset, fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { audioAssets, placeSounds, videoAssets } from '../src/client/timelines.ts'

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
  it('plays each sound for its asset\'s length, else its measured length, else the fallback, and ends with the last sound', () => {
    const state = fixtureState()
    state.assets.push(asset('a.mp3', 'audio/mpeg', null, 2), asset('b.mp3', 'audio/mpeg', null), asset('c.mp3', 'audio/mpeg', null))
    const sound = (id: string, file: string, start: number, track: number): Timeline['sounds'][number] =>
      ({ id: id as SoundId, asset: file as AssetId, start_sec: start, track })
    const timeline: Timeline = {
      id: 't1' as TimelineId, name: '', clips: [], sound_track_names: [],
      sounds: [sound('sd1', 'a.mp3', 1, 0), sound('sd2', 'b.mp3', 0, 1), sound('sd3', 'c.mp3', 4, 0), sound('sd4', 'lost.mp3', 0, 2)],
    }
    const { sounds, end } = placeSounds(state, timeline, new Map([['b.mp3', 3.5]]))
    expect(sounds).toEqual([
      { sound: 'sd1', assetId: 'a.mp3', name: 'a.mp3', startSec: 1, seconds: 2, track: 0 },
      { sound: 'sd2', assetId: 'b.mp3', name: 'b.mp3', startSec: 0, seconds: 3.5, track: 1 },
      { sound: 'sd3', assetId: 'c.mp3', name: 'c.mp3', startSec: 4, seconds: FALLBACK_CLIP_SECONDS, track: 0 },
      { sound: 'sd4', assetId: 'lost.mp3', name: 'lost.mp3', startSec: 0, seconds: FALLBACK_CLIP_SECONDS, track: 2 },
    ])
    expect(end).toBe(4 + FALLBACK_CLIP_SECONDS)
  })

  it('places no sounds without a timeline, ending at 0', () => {
    expect(placeSounds(fixtureState(), null, new Map())).toEqual({ sounds: [], end: 0 })
  })
})
