/**
 * Preview playback of the sound tracks: keeps each sound's `<audio>` element in step with the timeline player.
 */
import { useEffect, type RefObject } from 'react'
import type { TrackSound } from './timelines.ts'

/** Seconds a sound may drift from the playhead before it is seeked back into step. */
const DRIFT_SECONDS = 0.25

/**
 * Bring one sound element in step: paused while the player is paused, the playhead is outside the sound, or the
 * file has reached its end; else playing at the playhead's time inside the sound.
 * @param element - the sound's `<audio>` element.
 * @param sound - the placed sound.
 * @param position - the playhead's timeline time.
 * @param playing - whether the player plays.
 * @param rate - the playback rate.
 */
export function syncSound(element: HTMLMediaElement, sound: TrackSound, position: number, playing: boolean, rate: number): void {
  const local = position - sound.startSec
  // A file shorter than the placed length, or one that ran up to DRIFT_SECONDS ahead of the playhead and ended, stays
  // paused at its end instead of being seeked back and replayed.
  const fileEnd = Number.isFinite(element.duration) ? element.duration - (element.ended ? DRIFT_SECONDS : 0) : Infinity
  if (!playing || local < 0 || local >= sound.seconds || local >= fileEnd) {
    if (!element.paused) element.pause()
    return
  }
  element.playbackRate = rate
  if (element.paused || Math.abs(element.currentTime - local) > DRIFT_SECONDS) element.currentTime = local
  if (element.paused) {
    element.play().catch((error: unknown) => {
      // The browser refused to start the sound (no user activation yet); the next playback starts it again.
      void error
    })
  }
}

/**
 * Keep the sound elements under `box` (`audio[data-sound]`) in step with the player on every playhead change.
 * @param box - the element that holds the sound elements.
 * @param sounds - the placed sounds.
 * @param position - the playhead's timeline time.
 * @param playing - whether the player plays.
 * @param rate - the playback rate.
 */
export function useSoundPlayback(
  box: RefObject<HTMLElement>, sounds: TrackSound[], position: number, playing: boolean, rate: number,
): void {
  useEffect(() => {
    for (const sound of sounds) {
      const element = box.current?.querySelector<HTMLAudioElement>(`audio[data-sound="${sound.sound}"]`)
      if (element !== null && element !== undefined) syncSound(element, sound, position, playing, rate)
    }
  }, [box, sounds, position, playing, rate])
}
