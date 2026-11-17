/**
 * The playhead of one timeline's preview. While it plays, it follows the clock at the playback speed from 0 to the end of
 * the timeline's last clip; the `<video>` element of each clip follows the playhead (`track-clip-playback.ts`), so gaps,
 * placeholder clips and every video track play the same way. While the clip the user sees is still loading, the clock
 * waits for it, so the playhead does not run ahead of the picture.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { skipTarget } from './timelines.ts'

/** What the viewer and the toolbar read and call. */
export interface TimelinePlayer {
  position: number
  playing: boolean
  play: () => void
  pause: () => void
  /** Show the frame at a timeline time; pauses playback. */
  seek: (position: number) => void
  /** Move the playhead by a number of seconds, clamped to the timeline; playback continues from there while it plays. */
  skip: (seconds: number) => void
}

/**
 * Keep a playhead for a timeline. Switching to another timeline stops playback and moves the playhead to 0; a shorter
 * timeline after an edit pulls the playhead back to its end.
 * @param timelineId - the ID of the shown timeline, or null when the project has none.
 * @param span - the timeline's length in seconds, where its last clip ends.
 * @param rate - the playback speed, where 1 is normal speed.
 * @param stalled - whether the clip the user sees is loading and cannot play yet; while it is, playback holds the playhead.
 * @returns the player.
 */
export function useTimelinePlayer(timelineId: string | null, span: number, rate = 1, stalled: () => boolean = () => false): TimelinePlayer {
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  // The timeline the position belongs to: right after a switch, before the reset effect runs, the playhead reads 0
  // instead of the previous timeline's time.
  const timelineRef = useRef(timelineId)
  timelineRef.current = timelineId
  const [positionOf, setPositionOf] = useState(timelineId)
  // While playing: the timeline time and the clock time the playhead started from.
  const clock = useRef<{ from: number; at: number } | null>(null)
  const stalledRef = useRef(stalled)
  stalledRef.current = stalled
  const now = (): number => {
    const running = clock.current
    return running === null ? position : running.from + (performance.now() - running.at) / 1000 * rate
  }

  const run = useCallback((from: number) => {
    clock.current = { from, at: performance.now() }
    setPosition(from)
    setPositionOf(timelineRef.current)
    setPlaying(true)
  }, [])

  const seek = useCallback((next: number) => {
    clock.current = null
    setPlaying(false)
    setPosition(Math.max(0, Math.min(next, span)))
    setPositionOf(timelineRef.current)
  }, [span])

  const pause = useCallback(() => {
    const at = now()
    clock.current = null
    setPlaying(false)
    setPosition(Math.min(at, span))
  }, [position, rate, span])

  const play = useCallback(() => {
    if (span <= 0) return
    run(position >= span - 0.05 ? 0 : position)
  }, [position, span, run])

  const skip = useCallback((seconds: number) => {
    const target = skipTarget(now(), seconds, span)
    if (playing && target < span - 0.05) run(target)
    else seek(target)
  }, [position, playing, rate, span, run, seek])

  // While playing, move the playhead every frame, and stop at the timeline's end.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      const running = clock.current
      /* v8 ignore next -- a frame that fires after a pause or a seek cleared the clock, before this effect's cleanup runs. */
      if (running === null) return
      const time = performance.now()
      // A clip that is still loading holds the playhead where it is; each frame restarts the clock from the time it shows,
      // so playback goes on from there once the clip can play.
      const at = stalledRef.current() ? running.from : running.from + (time - running.at) / 1000 * rate
      if (at >= span) {
        clock.current = null
        setPosition(span)
        setPlaying(false)
        return
      }
      clock.current = { from: at, at: time }
      setPosition(at)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      // The clock restarts from where the playhead is, so a new playback speed applies only from now on.
      const running = clock.current
      const at = performance.now()
      if (running !== null) clock.current = { from: running.from + (at - running.at) / 1000 * rate, at }
    }
  }, [playing, span, rate])

  // Another timeline starts paused at 0; a timeline that an edit made shorter keeps the playhead inside it.
  const shownTimeline = useRef(timelineId)
  useEffect(() => {
    const switched = shownTimeline.current !== timelineId
    shownTimeline.current = timelineId
    if (switched) seek(0)
    else if (position > span) seek(span)
  }, [timelineId, span])

  return { position: positionOf === timelineId ? position : 0, playing, play, pause, seek, skip }
}
