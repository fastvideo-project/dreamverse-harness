// @vitest-environment jsdom
/** Preview playback of the sound tracks: each sound's `<audio>` element follows the player's playhead, state, and rate. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { syncSound, useSoundPlayback } from '../src/client/sound-playback.ts'
import type { TrackSound } from '../src/client/timelines.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const SOUND: TrackSound = { sound: 'sd1', assetId: 'theme.mp3', name: 'theme.mp3', startSec: 2, rawIn: null, rawOut: null, inSec: 0, seconds: 3, assetSeconds: 3, track: 0 }

/**
 * An `<audio>` element whose playing state and time the test sets, with recorded `play` and `pause` calls.
 * @param options - whether it plays, its time, the file's length and whether it ended, and what `play` answers.
 * @returns the element and its recorded calls.
 */
function soundElement(options: { paused: boolean; currentTime?: number; duration?: number; ended?: boolean; play?: () => Promise<void> }) {
  const element = document.createElement('audio')
  element.setAttribute('data-sound', 'sd1')
  let time = options.currentTime ?? 0
  Object.defineProperty(element, 'paused', { configurable: true, get: () => options.paused })
  if (options.duration !== undefined) Object.defineProperty(element, 'duration', { configurable: true, value: options.duration })
  Object.defineProperty(element, 'ended', { configurable: true, value: options.ended ?? false })
  Object.defineProperty(element, 'currentTime', { configurable: true, get: () => time, set: (value: number) => { time = value } })
  const play = vi.spyOn(element, 'play').mockImplementation(options.play ?? (() => Promise.resolve()))
  const pause = vi.spyOn(element, 'pause').mockImplementation(() => undefined)
  return { element, play, pause }
}

describe('syncSound', () => {
  it('pauses a playing sound while the player is paused or the playhead is before or past the sound, and leaves a paused one alone', () => {
    for (const [position, playing] of [[3, false], [1.9, true], [5, true]] as const) {
      const sound = soundElement({ paused: false })
      syncSound(sound.element, SOUND, position, playing, 1)
      expect(sound.pause).toHaveBeenCalledTimes(1)
      expect(sound.play).not.toHaveBeenCalled()
    }
    const paused = soundElement({ paused: true })
    syncSound(paused.element, SOUND, 3, false, 1)
    expect(paused.pause).not.toHaveBeenCalled()
  })

  it('starts a paused sound at the playhead\'s time inside it, at the playback rate', () => {
    const sound = soundElement({ paused: true, currentTime: 0.2 })
    syncSound(sound.element, SOUND, 2.5, true, 1.5)
    expect(sound.element.currentTime).toBe(0.5)
    expect(sound.element.playbackRate).toBe(1.5)
    expect(sound.play).toHaveBeenCalledTimes(1)
  })

  it('plays the second part of a split sound from its in point, and pauses it at its out point', () => {
    const second = { ...SOUND, inSec: 1.5, seconds: 1 }
    const sound = soundElement({ paused: true })
    syncSound(sound.element, second, 2.5, true, 1)
    expect([sound.element.currentTime, sound.play.mock.calls.length]).toEqual([2, 1])
    const ended = soundElement({ paused: false, currentTime: 2.5 })
    syncSound(ended.element, second, 3, true, 1)
    expect(ended.pause).toHaveBeenCalledTimes(1)
  })

  it('seeks a playing sound only when it drifts more than 0.25 s from the playhead, and does not restart it', () => {
    const close = soundElement({ paused: false, currentTime: 1.2 })
    syncSound(close.element, SOUND, 3, true, 1)
    expect(close.element.currentTime).toBe(1.2)
    const far = soundElement({ paused: false, currentTime: 1.3 })
    syncSound(far.element, SOUND, 3, true, 1)
    expect(far.element.currentTime).toBe(1)
    expect([close.play, far.play, close.pause, far.pause].map(spy => spy.mock.calls.length)).toEqual([0, 0, 0, 0])
  })

  it('keeps a file shorter than its placed length paused at its end instead of seeking it back and replaying it', () => {
    // The file lasts 2 s of the sound's placed 3 s; the playhead at 4.5 s is 2.5 s into the sound.
    const playing = soundElement({ paused: false, currentTime: 2, duration: 2 })
    syncSound(playing.element, SOUND, 4.5, true, 1)
    expect([playing.pause.mock.calls.length, playing.play.mock.calls.length, playing.element.currentTime]).toEqual([1, 0, 2])
    const stopped = soundElement({ paused: true, currentTime: 2, duration: 2 })
    syncSound(stopped.element, SOUND, 4, true, 1)
    expect([stopped.pause.mock.calls.length, stopped.play.mock.calls.length, stopped.element.currentTime]).toEqual([0, 0, 2])
    // Inside the file it plays as usual.
    const inside = soundElement({ paused: true, duration: 2 })
    syncSound(inside.element, SOUND, 3.8, true, 1)
    expect(inside.play).toHaveBeenCalledTimes(1)
    expect(inside.element.currentTime).toBeCloseTo(1.8)
  })

  it('leaves a file that ran ahead of the playhead and ended paused within 0.25 s of its end, and replays it earlier than that', () => {
    const ended = soundElement({ paused: true, currentTime: 2, duration: 2, ended: true })
    syncSound(ended.element, SOUND, 3.8, true, 1)
    expect([ended.play.mock.calls.length, ended.element.currentTime]).toEqual([0, 2])
    const early = soundElement({ paused: true, currentTime: 2, duration: 2, ended: true })
    syncSound(early.element, SOUND, 3.7, true, 1)
    expect(early.play).toHaveBeenCalledTimes(1)
    expect(early.element.currentTime).toBeCloseTo(1.7)
  })

  it('ignores a browser that refuses to start the sound', async () => {
    const sound = soundElement({ paused: true, play: () => Promise.reject(new Error('NotAllowedError')) })
    syncSound(sound.element, SOUND, 2, true, 1)
    await Promise.resolve()
    expect(sound.play).toHaveBeenCalledTimes(1)
  })
})

describe('useSoundPlayback', () => {
  it('brings each sound that has an element under the box in step on every playhead change and volume change at its track\'s volume, and skips the others', () => {
    const box = document.createElement('div')
    const sound = soundElement({ paused: true })
    box.append(sound.element)
    const other: TrackSound = { ...SOUND, sound: 'sd2' }
    const sounds = [SOUND, other]
    const { rerender } = renderHook(({ position, gains }: { position: number; gains: number[] }) => {
      useSoundPlayback({ current: box }, sounds, position, true, 1, gains)
    }, { initialProps: { position: 0, gains: [0.25] } })
    expect([sound.play.mock.calls.length, sound.element.volume]).toEqual([0, 0.25])
    rerender({ position: 3, gains: [0.25] })
    expect(sound.element.currentTime).toBe(1)
    expect(sound.play).toHaveBeenCalledTimes(1)
    // A new volume applies without a playhead change; a track without a gain plays as recorded.
    rerender({ position: 3, gains: [0.5] })
    expect(sound.element.volume).toBe(0.5)
    rerender({ position: 3, gains: [] })
    expect(sound.element.volume).toBe(1)
  })

  it('syncs nothing while the box is not mounted', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    renderHook(() => { useSoundPlayback({ current: null }, [SOUND], 3, true, 1, []) })
    expect(play).not.toHaveBeenCalled()
  })
})
