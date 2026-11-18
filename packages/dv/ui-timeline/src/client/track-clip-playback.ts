/**
 * Preview playback of the video tracks: keeps the `<video>` element of each clip in step with the timeline player, and
 * lets only the clip the user sees be heard.
 */
import { useEffect, type RefObject } from 'react'
import type { PlacedClip } from './timelines.ts'

/** Seconds a playing clip may drift from the playhead before it is seeked back into step. */
const DRIFT_SECONDS = 0.25
/** Seconds a paused clip may sit away from the playhead's frame before it is seeked to it. */
const FRAME_SECONDS = 0.04

/**
 * Seek an element, ignoring the refusal some engines raise before metadata loads.
 * @param element - the clip's `<video>` element.
 * @param seconds - the asset time.
 */
function seekTo(element: HTMLMediaElement, seconds: number): void {
  try {
    element.currentTime = seconds
  } catch (error: unknown) {
    // The element then starts at 0, which shifts only this preview.
    void error
  }
}

/**
 * Bring one clip's element in step. Before the clip, it waits paused at its in point; after it, it stays paused, and the
 * clip the user still sees then, the last clip at the timeline's end, shows its last frame.
 * Inside the clip, while another track covers it, it stays paused where it is, so a hidden clip neither plays nor seeks
 * on every frame; once it shows, it shows the playhead's frame: paused while the player is paused, else playing at the
 * playback speed, seeked back into step when it drifts more than `DRIFT_SECONDS` and is not already seeking, except that
 * a file that ended up to `DRIFT_SECONDS` ahead of the playhead stays paused at its end.
 * @param element - the clip's `<video>` element.
 * @param clip - the placed clip.
 * @param position - the playhead's timeline time.
 * @param playing - whether the player plays.
 * @param rate - the playback rate.
 * @param shown - whether the clip is the one the user sees at the playhead.
 */
export function syncTrackClip(
  element: HTMLMediaElement, clip: PlacedClip, position: number, playing: boolean, rate: number, shown: boolean,
): void {
  const local = position - clip.startSec
  if (local < 0) {
    if (!element.paused) element.pause()
    if (Math.abs(element.currentTime - clip.inSec) > FRAME_SECONDS) seekTo(element, clip.inSec)
    return
  }
  if (local >= clip.seconds) {
    if (!element.paused) element.pause()
    // An element that played to the end is within a frame of it already; one that the playhead jumped past is not.
    const last = clip.inSec + clip.seconds - FRAME_SECONDS
    if (shown && Math.abs(element.currentTime - last) > 2 * FRAME_SECONDS) seekTo(element, last)
    return
  }
  if (!shown) {
    if (!element.paused) element.pause()
    return
  }
  const target = clip.inSec + local
  if (!playing) {
    if (!element.paused) element.pause()
    if (Math.abs(element.currentTime - target) > FRAME_SECONDS) seekTo(element, target)
    return
  }
  // A file shorter than the placed length, or one that ran ahead of the playhead and ended, stays at its end instead of
  // being seeked back and replayed on every frame.
  const fileEnd = Number.isFinite(element.duration) ? element.duration - (element.ended ? DRIFT_SECONDS : 0) : Infinity
  if (target >= fileEnd) {
    if (!element.paused) element.pause()
    return
  }
  element.playbackRate = rate
  // An element that is already seeking is left to finish, so a slow load is not restarted on every frame.
  if (element.paused || (!element.seeking && Math.abs(element.currentTime - target) > DRIFT_SECONDS)) seekTo(element, target)
  if (element.paused) {
    element.play().catch((error: unknown) => {
      // The browser refused to start the clip (no user activation yet); the next playback starts it again.
      void error
    })
  }
}

/**
 * Keep the clip elements under `box` (`video[data-track-clip]`) in step with the player after every render, each at its
 * video track's volume, so elements that mount later, such as those of a card's preview, show the playhead's frame at
 * once.
 * @param box - the element that holds the clip elements.
 * @param clips - the placed clips.
 * @param position - the playhead's timeline time.
 * @param playing - whether the player plays.
 * @param rate - the playback rate.
 * @param shown - the clip ID of the clip the user sees at the playhead, or null while none shows.
 * @param volumeOf - the volume, as `HTMLMediaElement.volume` takes it, of a video track's own audio by its number.
 */
export function useTrackClipPlayback(
  box: RefObject<HTMLElement>, clips: readonly PlacedClip[], position: number, playing: boolean, rate: number, shown: string | null,
  volumeOf: (track: number) => number,
): void {
  useEffect(() => {
    for (const clip of clips) {
      const element = box.current?.querySelector<HTMLVideoElement>(`video[data-track-clip="${clip.clip}"]`)
      if (element !== null && element !== undefined) {
        element.volume = volumeOf(clip.track)
        syncTrackClip(element, clip, position, playing, rate, clip.clip === shown)
      }
    }
  })
}

/** Seconds ahead of the playhead in which a clip that can show loads its whole file before it is needed. */
const PRELOAD_AHEAD_SEC = 5

/**
 * Whether a clip's element is loading and cannot play on yet, as the player asks before it moves the playhead: the
 * browser is fetching the file and has no data past the current frame. An element without a source or with a failed one
 * does not count, so a broken file does not hold the playhead.
 * @param element - the element of the clip the user sees; null or undefined when no clip shows or it has no element.
 * @returns true while playback should wait for it.
 */
export function clipStalled(element: HTMLMediaElement | null | undefined): boolean {
  return element?.networkState === HTMLMediaElement.NETWORK_LOADING && element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
}

/**
 * How much of a clip's file its element loads: all of it for a clip that can show, one that the clips of the tracks with
 * lower numbers do not cover all of, and that plays now or within `PRELOAD_AHEAD_SEC`; else only its metadata.
 * @param clip - the placed clip.
 * @param position - the playhead's timeline time.
 * @param covered - the clips that never show (`coveredClips`).
 * @returns the element's `preload` value.
 */
export function trackClipPreload(clip: PlacedClip, position: number, covered: ReadonlySet<string>): 'auto' | 'metadata' {
  const end = clip.startSec + clip.seconds
  return !covered.has(clip.clip) && end > position && clip.startSec < position + PRELOAD_AHEAD_SEC ? 'auto' : 'metadata'
}
