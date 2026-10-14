// @vitest-environment jsdom
/** The muted warm-up of the back video element before a clip switch, driven frame by frame. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useTimelinePlayer } from '../src/client/player.ts'
import type { TimelinePlayer } from '../src/client/player.ts'
import type { TrackClip } from '../src/client/timelines.ts'

/** Clip `a` plays asset seconds 0–2 and clip `b` plays asset seconds 1–3, so the switch is at timeline second 2. */
const CLIPS: TrackClip[] = [
  { position: 1, clip: 'a', assetId: 'a.mp4', status: 'ready', rawIn: null, rawOut: null, inSec: 0, outSec: 2, assetSeconds: 2, seconds: 2, startSec: 0, thumbnail: null, stale: false },
  { position: 2, clip: 'b', assetId: 'b.mp4', status: 'ready', rawIn: 1, rawOut: 3, inSec: 1, outSec: 3, assetSeconds: 3, seconds: 2, startSec: 2, thumbnail: null, stale: false },
]

let frames: FrameRequestCallback[] = []
let player: TimelinePlayer
// The elements that `play()` and `pause()` were called on, in call order.
let played: HTMLMediaElement[] = []
let paused: HTMLMediaElement[] = []

/** Two stacked video elements under the player of {@link CLIPS}. */
function Viewer(): ReactNode {
  player = useTimelinePlayer('t1', CLIPS, 4)
  return <>{player.elements.map((ref, which) => <video key={which} ref={ref} />)}</>
}

/**
 * Render the viewer and give each video element a writable `currentTime`, which jsdom does not keep.
 * @returns the front and the back video element.
 */
function mount(): [HTMLVideoElement, HTMLVideoElement] {
  const { container } = render(<Viewer />)
  const videos = [...container.querySelectorAll('video')]
  for (const video of videos) Object.defineProperty(video, 'currentTime', { value: 0, writable: true })
  act(() => { player.seek(0) })
  const [front, back] = videos
  if (front === undefined || back === undefined) throw new Error('two video elements')
  return [front, back]
}

/**
 * Run the next animation frame of the playing player after the front element reached an asset time.
 * @param front - the shown video element.
 * @param at - the front element's asset time.
 */
function tick(front: HTMLVideoElement, at: number): void {
  front.currentTime = at
  const frame = frames.shift()
  if (frame === undefined) throw new Error('no animation frame requested')
  act(() => { frame(0) })
}

/**
 * Report a time update of an element.
 * @param video - the video element.
 * @param at - its asset time.
 */
function timeUpdate(video: HTMLVideoElement, at: number): void {
  video.currentTime = at
  video.dispatchEvent(new Event('timeupdate'))
}

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  played = []
  paused = []
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { played.push(this); return Promise.resolve() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { paused.push(this) })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('warms the next clip muted 0.5 s before the out point and switches to it at once, with sound', () => {
  const [front, back] = mount()
  expect(back.getAttribute('src')).toBe('/dv/assets/b.mp4')
  act(() => { player.play() })
  tick(front, 1.4)
  expect(played).toEqual([front])
  tick(front, 1.6)
  expect(played).toEqual([front, back])
  expect(back.muted).toBe(true)
  // The warm-up ends when the back element's time passes its in point, and leaves it paused at the in point.
  timeUpdate(back, 1)
  expect(back.muted).toBe(true)
  timeUpdate(back, 1.2)
  expect(paused.at(-1)).toBe(back)
  expect([back.muted, back.currentTime]).toEqual([false, 1])
  tick(front, 1.8)
  expect(played).toHaveLength(2)
  tick(front, 1.98)
  expect(played.at(-1)).toBe(back)
  expect([player.front, back.muted]).toEqual([1, false])
  // The last clip has no next clip to warm, and playback stops at its out point.
  tick(back, 2.6)
  expect(front.muted).toBe(false)
  tick(back, 2.98)
  expect([player.playing, player.position]).toEqual([false, 4])
  expect(played).toHaveLength(3)
})

it('stops a running warm-up on a seek, and a warm-up still running at the out point keeps playing as the shown clip', () => {
  const [front, back] = mount()
  act(() => { player.play() })
  tick(front, 1.6)
  expect(back.muted).toBe(true)
  act(() => { player.seek(0.5) })
  expect(paused.at(-1)).toBe(back)
  expect([back.muted, back.currentTime]).toEqual([false, 1])
  timeUpdate(back, 1.3)
  expect(back.currentTime).toBe(1.3)

  act(() => { player.play() })
  tick(front, 1.7)
  expect(back.muted).toBe(true)
  tick(front, 1.99)
  expect([player.front, back.muted]).toEqual([1, false])
  const pauses = paused.length
  timeUpdate(back, 1.1)
  expect(paused).toHaveLength(pauses)
})
