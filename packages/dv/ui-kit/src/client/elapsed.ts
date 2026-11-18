/**
 * Elapsed-time text for renders in progress and finished: a `m:ss` formatter and a hook that ticks once a second while
 * a render runs.
 *
 * @module @dv/ui-kit/elapsed
 */
import { useEffect, useState } from 'react'

/**
 * Format a duration as `m:ss`, or `h:mm:ss` from one hour.
 * @param seconds - the duration in seconds; a negative or non-finite value reads as zero.
 * @returns the formatted duration, such as `0:07`, `2:05` or `1:00:00`.
 */
export function formatElapsed(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes)}:${rest}`
}

/** @returns the whole seconds from the ISO time `since` to now; negative when the clock is behind `since`. */
function secondsSince(since: string): number {
  return Math.floor((Date.now() - new Date(since).getTime()) / 1000)
}

/**
 * Count the seconds since a time, re-rendering once a second while active.
 * @param since - the ISO time the count starts from, or undefined when it is not known.
 * @param active - whether the count runs; the interval is cleared when this turns false and on unmount.
 * @returns the whole seconds since `since`, or null when `since` is undefined or `active` is false.
 */
export function useElapsedSeconds(since: string | undefined, active: boolean): number | null {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active || since === undefined) return undefined
    const timer = setInterval(() => { setTick(tick => tick + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [since, active])
  return since === undefined || !active ? null : secondsSince(since)
}
