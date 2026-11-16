// @vitest-environment jsdom
/** Preview playback of the video tracks under the 视频 track: each track clip's element follows the player. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { syncTrackClip, trackClipPreload, useTrackClipPlayback } from '../src/client/track-clip-playback.ts'
import type { PlacedTrackClip } from '../src/client/timelines.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** A clip that plays 1 s to 4 s of its asset from timeline time 2 s to 5 s. */
const CLIP: PlacedTrackClip = {
  clip: 'cl5', assetId: 'v.mp4', track: 0, rawIn: 1, rawOut: 4, inSec: 1, outSec: 4, assetSeconds: 6, seconds: 3, startSec: 2,
  thumbnail: null, stale: false,
}

/**
 * A `<video>` element whose playing state and time the test sets, with recorded `play` and `pause` calls.
 * @param options - whether it plays, its time, what `play` answers, and whether a seek throws.
 * @returns the element, its recorded calls, and the times it was seeked to.
 */
function clipElement(options: { paused: boolean; currentTime?: number; play?: () => Promise<void>; refuseSeek?: boolean }) {
  const element = document.createElement('video')
  element.setAttribute('data-track-clip', 'cl5')
  let time = options.currentTime ?? 0
  const seeks: number[] = []
  Object.defineProperty(element, 'paused', { configurable: true, get: () => options.paused })
  Object.defineProperty(element, 'currentTime', {
    configurable: true, get: () => time,
    set: (value: number) => {
      if (options.refuseSeek === true) throw new Error('not loaded')
      seeks.push(value)
      time = value
    },
  })
  const play = vi.spyOn(element, 'play').mockImplementation(options.play ?? (() => Promise.resolve()))
  const pause = vi.spyOn(element, 'pause').mockImplementation(() => undefined)
  return { element, play, pause, seeks }
}

describe('syncTrackClip', () => {
  it('waits at its in point before the clip, and stays paused after it', () => {
    const before = clipElement({ paused: false, currentTime: 3 })
    syncTrackClip(before.element, CLIP, 1, true, 1, true)
    expect([before.pause.mock.calls.length, before.seeks]).toEqual([1, [1]])
    const cued = clipElement({ paused: true, currentTime: 1.02 })
    syncTrackClip(cued.element, CLIP, 0, true, 1, true)
    expect([cued.pause.mock.calls.length, cued.seeks]).toEqual([0, []])
    const after = clipElement({ paused: true, currentTime: 4 })
    syncTrackClip(after.element, CLIP, 6, true, 1, true)
    expect([after.pause.mock.calls.length, after.seeks, after.play.mock.calls.length]).toEqual([0, [], 0])
  })

  it('shows the playhead\'s frame while the player is paused', () => {
    const playing = clipElement({ paused: false, currentTime: 1 })
    syncTrackClip(playing.element, CLIP, 3, false, 1, true)
    expect([playing.pause.mock.calls.length, playing.seeks]).toEqual([1, [2]])
    const there = clipElement({ paused: true, currentTime: 2.01 })
    syncTrackClip(there.element, CLIP, 3, false, 1, true)
    expect(there.seeks).toEqual([])
  })

  it('plays from the playhead at the playback speed, seeking only a paused or drifted element', () => {
    const paused = clipElement({ paused: true, currentTime: 2 })
    syncTrackClip(paused.element, CLIP, 3, true, 1.5, true)
    expect([paused.seeks, paused.play.mock.calls.length, paused.element.playbackRate]).toEqual([[2], 1, 1.5])
    const close = clipElement({ paused: false, currentTime: 2.1 })
    syncTrackClip(close.element, CLIP, 3, true, 1, true)
    expect([close.seeks, close.play.mock.calls.length]).toEqual([[], 0])
    const drifted = clipElement({ paused: false, currentTime: 3 })
    syncTrackClip(drifted.element, CLIP, 3, true, 1, true)
    expect(drifted.seeks).toEqual([2])
  })

  it('leaves a file that ended just ahead of the playhead paused at its end, and replays a file that ended earlier from the playhead', () => {
    const ended = (paused: boolean) => {
      const media = clipElement({ paused, currentTime: 4 })
      Object.defineProperties(media.element, { duration: { configurable: true, value: 4 }, ended: { configurable: true, value: true } })
      return media
    }
    // At 4.9 s the playhead is 3.9 s into the asset, within a quarter second of the 4 s file's end.
    const near = ended(true)
    syncTrackClip(near.element, CLIP, 4.9, true, 1, true)
    expect([near.play.mock.calls.length, near.seeks]).toEqual([0, []])
    const playing = ended(false)
    syncTrackClip(playing.element, CLIP, 4.9, true, 1, true)
    expect(playing.pause).toHaveBeenCalledTimes(1)
    // At 3 s the playhead is 2 s into the asset, well before the end the file reached, so the clip plays from there.
    const earlier = ended(true)
    syncTrackClip(earlier.element, CLIP, 3, true, 1, true)
    expect([earlier.seeks, earlier.play.mock.calls.length]).toEqual([[2], 1])
    // A 6 s file that has not ended plays on up to its end.
    const running = clipElement({ paused: true })
    Object.defineProperty(running.element, 'duration', { configurable: true, value: 6 })
    syncTrackClip(running.element, CLIP, 4.5, true, 1, true)
    expect([running.seeks, running.play.mock.calls.length]).toEqual([[3.5], 1])
  })

  it('keeps a clip that another track covers paused where it is, neither playing nor seeking it', () => {
    const covered = clipElement({ paused: false, currentTime: 1.5 })
    syncTrackClip(covered.element, CLIP, 3, true, 1, false)
    expect([covered.pause.mock.calls.length, covered.play.mock.calls.length, covered.seeks]).toEqual([1, 0, []])
    const still = clipElement({ paused: true, currentTime: 1.5 })
    syncTrackClip(still.element, CLIP, 3.5, true, 1, false)
    expect([still.pause.mock.calls.length, still.seeks]).toEqual([0, []])
  })

  it('loads the whole file only of a clip that can show and plays now or within five seconds', () => {
    // CLIP plays from 2 s to 5 s.
    expect(trackClipPreload(CLIP, 0, 1)).toBe('auto')
    expect(trackClipPreload(CLIP, 4, 1)).toBe('auto')
    expect(trackClipPreload(CLIP, 5, 1)).toBe('metadata')
    expect(trackClipPreload({ ...CLIP, startSec: 6 }, 0, 1)).toBe('metadata')
    // A clip that ends before the 视频 track's end never shows.
    expect(trackClipPreload(CLIP, 0, 6)).toBe('metadata')
  })

  it('survives a refused start and a refused seek', async () => {
    const refused = clipElement({ paused: true, play: () => Promise.reject(new Error('NotAllowedError')), refuseSeek: true })
    syncTrackClip(refused.element, CLIP, 3, true, 1, true)
    expect(refused.play).toHaveBeenCalledTimes(1)
    await Promise.resolve()
  })
})

describe('useTrackClipPlayback', () => {
  it('syncs each clip element under the box on every playhead change, and skips a clip without an element', () => {
    const { element, play } = clipElement({ paused: true })
    const box = document.createElement('div')
    box.append(element)
    const other: PlacedTrackClip = { ...CLIP, clip: 'cl9' }
    const { rerender } = renderHook(({ position }: { position: number }) => {
      useTrackClipPlayback({ current: box }, [CLIP, other], position, true, 1, 'cl5')
    }, { initialProps: { position: 0 } })
    expect(play).not.toHaveBeenCalled()
    rerender({ position: 3 })
    expect(play).toHaveBeenCalledTimes(1)
    renderHook(() => { useTrackClipPlayback({ current: null }, [CLIP], 3, true, 1, null) })
  })
})
