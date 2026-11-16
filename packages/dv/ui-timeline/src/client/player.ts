/**
 * Continuous playback of one timeline's clips through two stacked `<video>` elements. The front element plays the
 * current clip of the 视频 track from its in point; the back element holds the next clip, already seeked to its in point,
 * so the switch at the out point does not wait for a load. Placeholder clips, whose render is not done, have no video:
 * playback jumps over them to the next ready clip, and a seek onto one blanks the viewer. Past the 视频 track's last clip,
 * up to the end of the timeline's longest track, the playhead follows the clock instead of an element.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { clipIndexAt, readyIndexFrom, skipTarget } from './timelines.ts'
import type { TrackClip } from './timelines.ts'

/** What the viewer and the toolbar read and call. */
export interface TimelinePlayer {
  /** The two video elements; `front` says which one is visible. */
  elements: [RefObject<HTMLVideoElement>, RefObject<HTMLVideoElement>]
  front: 0 | 1
  position: number
  playing: boolean
  play: () => void
  pause: () => void
  /** Show the frame at a timeline time; pauses playback. */
  seek: (position: number) => void
  /**
   * Move the playhead by a number of seconds, clamped to the timeline; playback continues when it lands on a ready clip or
   * past the 视频 track's end.
   */
  skip: (seconds: number) => void
}

/**
 * Point an element at a ready clip and seek it.
 * @param element - the video element.
 * @param assetId - the clip's asset.
 * @param assetTime - time inside the clip's asset.
 */
function cue(element: HTMLVideoElement, assetId: string, assetTime: number): void {
  const src = assetUrl(assetId)
  if (element.getAttribute('src') !== src) element.setAttribute('src', src)
  try {
    element.currentTime = assetTime
  } catch (error: unknown) {
    // Some engines refuse a seek before metadata loads; the element then starts at 0, which only shifts one preview.
    void error
  }
}

/**
 * Start an element, ignoring the rejection a browser raises when playback is interrupted or not allowed.
 * @param element - the video element.
 */
function start(element: HTMLVideoElement): void {
  try {
    void Promise.resolve(element.play()).catch((error: unknown) => { void error })
  } catch (error: unknown) {
    // Environments without media playback (tests) throw synchronously; the playhead still moves on seek.
    void error
  }
}

/**
 * Stop an element and detach its source so it shows no frame.
 * @param element - the video element.
 */
function blank(element: HTMLVideoElement): void {
  element.pause()
  if (!element.hasAttribute('src')) return
  element.removeAttribute('src')
  element.load()
}

/**
 * Keep two video elements in step with a timeline position, and advance across clips while playing. Switching to
 * another timeline stops playback, blanks both elements, and moves the playhead to 0; a timeline without clips leaves both
 * elements blank. The playhead runs from 0 to `span`; past `total`, and from the start when the 视频 track has no ready
 * clip, playback moves it by the clock at the playback speed.
 * @param timelineId - the ID of the shown timeline, or null when the project has none.
 * @param clips - the placed clips of the 视频 track of the shown timeline.
 * @param total - the length of the 视频 track in seconds.
 * @param rate - the playback speed both elements play at, where 1 is normal speed.
 * @param span - the timeline's length in seconds, where its longest video track ends; at least `total`.
 * @returns the player.
 */
export function useTimelinePlayer(timelineId: string | null, clips: TrackClip[], total: number, rate = 1, span = total): TimelinePlayer {
  const first = useRef<HTMLVideoElement>(null)
  const second = useRef<HTMLVideoElement>(null)
  const frontRef = useRef<0 | 1>(0)
  const current = useRef(-1)
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const [front, setFront] = useState<0 | 1>(0)
  const [position, setPosition] = useState(0)
  // The timeline the position belongs to: right after a switch, before the reset effect runs, the playhead reads 0
  // instead of the previous timeline's time.
  const timelineRef = useRef(timelineId)
  timelineRef.current = timelineId
  const [positionOf, setPositionOf] = useState(timelineId)
  const [playing, setPlaying] = useState(false)
  // While the playhead follows the clock: the timeline time and the clock time it started from.
  const clock = useRef<{ from: number; at: number } | null>(null)
  const element = (which: 0 | 1): HTMLVideoElement | null => (which === 0 ? first : second).current
  const runClock = (from: number): void => {
    clock.current = { from, at: performance.now() }
    setPlaying(true)
  }

  // The back element holds the next ready clip at or after `index`.
  const preload = useCallback((index: number) => {
    const back = element(frontRef.current === 0 ? 1 : 0)
    const clip = clipsRef.current[readyIndexFrom(clipsRef.current, index)]
    if (back !== null && clip !== undefined && clip.assetId !== null) cue(back, clip.assetId, clip.inSec)
  }, [])

  const seek = useCallback((next: number) => {
    const list = clipsRef.current
    const clamped = Math.max(0, Math.min(next, span))
    element(frontRef.current)?.pause()
    clock.current = null
    setPlaying(false)
    setPosition(clamped)
    setPositionOf(timelineRef.current)
    const index = clipIndexAt(list, clamped)
    const clip = list[index]
    const shown = element(frontRef.current)
    if (clip === undefined || shown === null) return
    current.current = index
    if (clip.assetId === null) blank(shown)
    else cue(shown, clip.assetId, clip.inSec + Math.min(clamped - clip.startSec, clip.seconds))
    preload(index + 1)
  }, [span, preload])

  const pause = useCallback(() => {
    element(frontRef.current)?.pause()
    clock.current = null
    setPlaying(false)
  }, [])

  const play = useCallback(() => {
    const list = clipsRef.current
    const ready = readyIndexFrom(list, 0) !== -1
    // A timeline with nothing past its 视频 track and no ready clip on it has nothing to play.
    if (!ready && span <= total + 0.05) return
    const from = position >= span - 0.05 ? 0 : position
    // Past the 视频 track's end, or on a timeline whose 视频 track has no ready clip, only the clock moves the playhead.
    if (from >= total - 0.05 || !ready) {
      seek(from)
      runClock(from)
      return
    }
    if (from !== position || current.current === -1) seek(from)
    // From a placeholder, playback starts at the next ready clip, or at the first one when none follows.
    if (list[current.current]?.status !== 'ready') {
      const later = readyIndexFrom(list, current.current + 1)
      seek(list[later === -1 ? readyIndexFrom(list, 0) : later]?.startSec ?? 0)
    }
    const shown = element(frontRef.current)
    if (shown !== null) start(shown)
    setPlaying(true)
  }, [position, total, span, seek])

  const skip = useCallback((seconds: number) => {
    const target = skipTarget(position, seconds, span)
    const resume = playing && target < span - 0.05
    seek(target)
    if (resume && target >= total - 0.05) {
      runClock(target)
      return
    }
    const shown = element(frontRef.current)
    if (!resume || shown === null || clipsRef.current[current.current]?.status !== 'ready') return
    start(shown)
    setPlaying(true)
  }, [position, playing, total, span, seek])

  // Loading a source resets `playbackRate` to `defaultPlaybackRate`, so both are set and the speed survives clip changes.
  useEffect(() => {
    for (const which of [0, 1] as const) {
      const target = element(which)
      if (target === null) continue
      target.defaultPlaybackRate = rate
      target.playbackRate = rate
    }
  }, [rate])

  // While playing, follow the front element every frame and switch elements at each out point; past the 视频 track's
  // end, follow the clock up to the timeline's end.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      const running = clock.current
      if (running !== null) {
        const at = running.from + (performance.now() - running.at) / 1000 * rate
        if (at >= span) { setPosition(span); clock.current = null; setPlaying(false); return }
        setPosition(at)
        frame = requestAnimationFrame(tick)
        return
      }
      const list = clipsRef.current
      const shown = element(frontRef.current)
      const clip = list[current.current]
      if (shown === null || clip === undefined) { setPlaying(false); return }
      setPosition(clip.startSec + Math.max(0, shown.currentTime - clip.inSec))
      if (shown.currentTime >= clip.outSec - 0.03 || shown.ended) {
        const nextIndex = readyIndexFrom(list, current.current + 1)
        const next = list[nextIndex]
        shown.pause()
        if (next === undefined || next.assetId === null) {
          setPosition(total)
          if (span > total + 0.05) {
            clock.current = { from: total, at: performance.now() }
            frame = requestAnimationFrame(tick)
          } else setPlaying(false)
          return
        }
        const back: 0 | 1 = frontRef.current === 0 ? 1 : 0
        const incoming = element(back)
        if (incoming === null) { setPlaying(false); return }
        if (incoming.getAttribute('src') !== assetUrl(next.assetId)) cue(incoming, next.assetId, next.inSec)
        start(incoming)
        frontRef.current = back
        setFront(back)
        current.current = nextIndex
        preload(current.current + 1)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      // The clock restarts from where the playhead is, so a new playback speed applies only from now on.
      const running = clock.current
      const now = performance.now()
      if (running !== null) clock.current = { from: running.from + (now - running.at) / 1000 * rate, at: now }
    }
  }, [playing, total, span, rate, preload])

  // An edit changes the clips under the playhead; show the frame at the same time again. Another timeline starts at 0.
  const layout = clips.map(clip => `${clip.assetId ?? clip.status}@${String(clip.inSec)}-${String(clip.outSec)}`).join('|')
  const shownTimeline = useRef(timelineId)
  useEffect(() => {
    const switched = shownTimeline.current !== timelineId
    shownTimeline.current = timelineId
    if (switched || clips.length === 0) {
      for (const which of [0, 1] as const) {
        const target = element(which)
        if (target !== null) blank(target)
      }
      frontRef.current = 0
      setFront(0)
      current.current = -1
    }
    seek(switched ? 0 : Math.min(position, span))
  }, [timelineId, layout])

  return { elements: [first, second], front, position: positionOf === timelineId ? position : 0, playing, play, pause, seek, skip }
}
