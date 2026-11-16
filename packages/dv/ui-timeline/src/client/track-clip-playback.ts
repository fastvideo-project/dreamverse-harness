/**
 * Preview playback of the video tracks under the 视频 track: keeps the `<video>` element of each track clip in step with
 * the timeline player, and lets only the clip the user sees be heard.
 */
import { useEffect, type RefObject } from 'react'
import type { PlacedTrackClip } from './timelines.ts'

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
 * Bring one track clip's element in step. Before the clip, it waits paused at its in point; after it, it stays paused.
 * Inside the clip, while another track covers it, it stays paused where it is, so a hidden clip neither plays nor seeks
 * on every frame; once it shows, it shows the playhead's frame: paused while the player is paused, else playing at the
 * playback speed, except that a file that ended up to `DRIFT_SECONDS` ahead of the playhead stays paused at its end.
 * @param element - the clip's `<video>` element.
 * @param clip - the placed track clip.
 * @param position - the playhead's timeline time.
 * @param playing - whether the player plays.
 * @param rate - the playback rate.
 * @param shown - whether the clip is the one the user sees at the playhead.
 */
export function syncTrackClip(
  element: HTMLMediaElement, clip: PlacedTrackClip, position: number, playing: boolean, rate: number, shown: boolean,
): void {
  const local = position - clip.startSec
  if (local < 0 || local >= clip.seconds) {
    if (!element.paused) element.pause()
    if (local < 0 && Math.abs(element.currentTime - clip.inSec) > FRAME_SECONDS) seekTo(element, clip.inSec)
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
  if (element.paused || Math.abs(element.currentTime - target) > DRIFT_SECONDS) seekTo(element, target)
  if (element.paused) {
    element.play().catch((error: unknown) => {
      // The browser refused to start the clip (no user activation yet); the next playback starts it again.
      void error
    })
  }
}

/**
 * Keep the track clip elements under `box` (`video[data-track-clip]`) in step with the player on every playhead change.
 * @param box - the element that holds the track clip elements.
 * @param clips - the placed track clips.
 * @param position - the playhead's timeline time.
 * @param playing - whether the player plays.
 * @param rate - the playback rate.
 * @param shown - the clip ID of the clip the user sees at the playhead, or null while none shows.
 */
export function useTrackClipPlayback(
  box: RefObject<HTMLElement>, clips: readonly PlacedTrackClip[], position: number, playing: boolean, rate: number, shown: string | null,
): void {
  useEffect(() => {
    for (const clip of clips) {
      const element = box.current?.querySelector<HTMLVideoElement>(`video[data-track-clip="${clip.clip}"]`)
      if (element !== null && element !== undefined) syncTrackClip(element, clip, position, playing, rate, clip.clip === shown)
    }
  }, [box, clips, position, playing, rate, shown])
}

/** Seconds ahead of the playhead in which a track clip that can show loads its whole file before it is needed. */
const PRELOAD_AHEAD_SEC = 5

/**
 * How much of a track clip's file its element loads: all of it for a clip that can show, one that ends after the 视频
 * track and plays now or within `PRELOAD_AHEAD_SEC`, else only its metadata.
 * @param clip - the placed track clip.
 * @param position - the playhead's timeline time.
 * @param mainEnd - where the 视频 track ends, which covers every track clip up to there.
 * @returns the element's `preload` value.
 */
export function trackClipPreload(clip: PlacedTrackClip, position: number, mainEnd: number): 'auto' | 'metadata' {
  const end = clip.startSec + clip.seconds
  return end > mainEnd && end > position && clip.startSec < position + PRELOAD_AHEAD_SEC ? 'auto' : 'metadata'
}
