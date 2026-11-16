// @vitest-environment jsdom
/**
 * The timeline player past the 视频 track's end: up to the end of the longest video track, the playhead follows the clock
 * at the playback speed, and skips and plays move between the clock and the video elements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useTimelinePlayer } from '../src/client/player.ts'
import type { TimelinePlayer } from '../src/client/player.ts'
import type { TrackClip } from '../src/client/timelines.ts'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

/** One ready clip of the 视频 track that plays 0 s to 2 s of its asset from timeline time 0 s. */
const READY: TrackClip = {
  position: 1, clip: 'cl1', assetId: 'a.mp4', status: 'ready', rawIn: null, rawOut: null, inSec: 0, outSec: 2, assetSeconds: 2,
  seconds: 2, startSec: 0, thumbnail: null, stale: false,
}

/**
 * Render the player with its two video elements, whose times the test sets.
 * @param clips - the clips of the 视频 track.
 * @param total - the 视频 track's length.
 * @param span - the timeline's length.
 * @returns the latest player and a setter of the front element's time.
 */
function mountPlayer(clips: TrackClip[], total: number, span: number) {
  const latest: { player?: TimelinePlayer } = {}
  const times: [number, number] = [0, 0]
  const speed = { rate: 2 }
  function Harness(): ReactNode {
    const player = useTimelinePlayer('t1', clips, total, speed.rate, span)
    latest.player = player
    return (
      <>
        {[0, 1].map(which => <video key={which} ref={player.elements[which as 0 | 1]} />)}
      </>
    )
  }
  const view = render(<Harness />)
  const setRate = (rate: number): void => { speed.rate = rate; view.rerender(<Harness />) }
  const player = (): TimelinePlayer => {
    if (latest.player === undefined) throw new Error('the player did not render')
    return latest.player
  }
  for (const which of [0, 1] as const) {
    const element = player().elements[which].current as HTMLVideoElement
    Object.defineProperty(element, 'currentTime', { configurable: true, get: () => times[which], set: (value: number) => { times[which] = value } })
  }
  const frames = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }
  return { player, frames, setRate, setFrontTime: (seconds: number): void => { times[player().front] = seconds } }
}

describe('useTimelinePlayer past the 视频 track', () => {
  it('follows the clock from the 视频 track\'s end to the timeline\'s end at the playback speed, then stops there', () => {
    const { player, frames, setFrontTime } = mountPlayer([READY], 2, 5)
    act(() => { player().play() })
    expect(player().playing).toBe(true)
    setFrontTime(2)
    frames(20)
    expect(player().position).toBe(2)
    // At twice the speed, half a second of clock moves the playhead one second.
    frames(500)
    expect(player().position).toBeCloseTo(3, 1)
    frames(2000)
    expect([player().position, player().playing]).toEqual([5, false])
    // At the end, play starts over from the 视频 track's start.
    act(() => { player().play() })
    expect([player().position, player().playing]).toEqual([0, true])
  })

  it('applies a new playback speed from where the clock moved the playhead, without a jump', () => {
    const { player, frames, setRate } = mountPlayer([READY], 2, 20)
    act(() => { player().seek(3) })
    act(() => { player().play() })
    frames(1000)
    expect(player().position).toBeCloseTo(5, 1)
    act(() => { setRate(1) })
    frames(1000)
    expect(player().position).toBeCloseTo(6, 1)
  })

  it('plays from a time past the 视频 track by the clock, and a pause or seek stops the clock', () => {
    const { player, frames } = mountPlayer([READY], 2, 5)
    act(() => { player().seek(3) })
    act(() => { player().play() })
    frames(250)
    expect(player().position).toBeCloseTo(3.5, 1)
    act(() => { player().pause() })
    frames(500)
    expect([player().playing, player().position]).toEqual([false, player().position])
    expect(player().position).toBeCloseTo(3.5, 1)
  })

  it('skips into the clock past the 视频 track, and back onto a ready clip of it', () => {
    const { player, frames } = mountPlayer([READY], 2, 9)
    act(() => { player().play() })
    act(() => { player().skip(5) })
    expect([player().position, player().playing]).toEqual([5, true])
    frames(250)
    expect(player().position).toBeCloseTo(5.5, 1)
    act(() => { player().skip(-5) })
    expect(player().playing).toBe(true)
    expect(player().position).toBeCloseTo(0.5, 1)
  })

  it('plays a timeline whose 视频 track has no ready clip by the clock only while a track clip follows', () => {
    const waiting: TrackClip = { ...READY, assetId: null, status: 'rendering' }
    const { player, frames } = mountPlayer([waiting], 2, 4)
    act(() => { player().play() })
    frames(500)
    expect(player().position).toBeCloseTo(1, 1)
    cleanup()
    const idle = mountPlayer([waiting], 2, 2)
    act(() => { idle.player().play() })
    expect(idle.player().playing).toBe(false)
  })
})
