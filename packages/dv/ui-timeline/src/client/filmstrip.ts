/**
 * Frames of a video at steady times, so a clip block can show what its video shows at each point of its width. Each
 * video is read once per page: the browser loads it, seeks to every `step` seconds from its start, draws each frame on
 * a canvas `FRAME_HEIGHT` pixels high, keeps the JPEG data URLs, and then releases the video. The first frame is handed
 * out as soon as it is drawn, and the whole strip once every frame is.
 *
 * @module @dv/ui-timeline/filmstrip
 */
import { useEffect, useState } from 'react'

/** The height in pixels of a kept frame; the width follows the video's aspect ratio. Track rows are lower than this. */
const FRAME_HEIGHT = 90
/** Seconds between two frames of a strip, unless the video is longer than `MAX_FRAMES` of them. */
const FRAME_STEP_SEC = 1
/** The most frames read from one video; a longer video gets its frames further apart. */
const MAX_FRAMES = 40

/** Frames of one video: frame k shows the video at `k * step` seconds. */
export interface Filmstrip {
  /** Seconds between two frames. */
  step: number
  /** The frames read so far, as JPEG data URLs, from the video's start. */
  frames: readonly string[]
  /** Whether every frame is read; until then the strip holds the first frame only. */
  complete: boolean
  /** The video's width over its height. */
  aspect: number
}

/** A strip read once: the listeners hear the first frame and then the whole strip, or null when the video does not decode. */
interface Reading {
  latest: Filmstrip | null
  listeners: Set<(strip: Filmstrip) => void>
}

/** Video URL → its reading, shared by every editor on the page. */
const readings = new Map<string, Reading>()

/**
 * Start reading the frames of a video, once per page.
 * @param url - the video URL, same origin as the page.
 * @returns the reading, whose listeners hear each new state of the strip.
 */
function readStrip(url: string): Reading {
  const known = readings.get(url)
  if (known !== undefined) return known
  const reading: Reading = { latest: null, listeners: new Set() }
  readings.set(url, reading)
  const publish = (strip: Filmstrip): void => {
    reading.latest = strip
    for (const listener of reading.listeners) listener(strip)
  }
  const video = document.createElement('video')
  const release = (): void => {
    video.removeAttribute('src')
    video.load()
  }
  video.muted = true
  video.preload = 'auto'
  video.addEventListener('loadeddata', () => {
    const canvas = document.createElement('canvas')
    canvas.height = FRAME_HEIGHT
    canvas.width = video.videoHeight === 0 ? 0 : Math.round(video.videoWidth * FRAME_HEIGHT / video.videoHeight)
    const context = canvas.getContext('2d')
    if (context === null || canvas.width === 0) { release(); return }
    const aspect = canvas.width / FRAME_HEIGHT
    // A video whose length the browser does not report keeps its first frame only.
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    const step = Math.max(FRAME_STEP_SEC, duration / MAX_FRAMES)
    const count = Math.max(1, Math.ceil(duration / step))
    const frames: string[] = []
    const grab = (): void => {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push(canvas.toDataURL('image/jpeg', 0.7))
      if (frames.length === 1 || frames.length === count) publish({ step, frames: [...frames], complete: frames.length === count, aspect })
      if (frames.length === count) { release(); return }
      video.currentTime = frames.length * step
    }
    video.addEventListener('seeked', grab)
    grab()
  }, { once: true })
  video.addEventListener('error', release, { once: true })
  video.src = url
  return reading
}

/**
 * The strips of some videos; each one updates as soon as its own video gives its first frame and again once its strip
 * is complete, so a long video does not hold back the others.
 * @param urls - the video URLs.
 * @returns video URL → strip, for the videos that decode.
 */
export function useFilmstrips(urls: readonly string[]): ReadonlyMap<string, Filmstrip> {
  const [read, setRead] = useState<ReadonlyMap<string, Filmstrip>>(new Map())
  const key = urls.join('\n')
  useEffect(() => {
    const list = key === '' ? [] : key.split('\n')
    const unsubscribe = list.map((url) => {
      const reading = readStrip(url)
      const listener = (strip: Filmstrip): void => { setRead(current => new Map(current).set(url, strip)) }
      if (reading.latest !== null) listener(reading.latest)
      reading.listeners.add(listener)
      return () => { reading.listeners.delete(listener) }
    })
    return () => { for (const stop of unsubscribe) stop() }
  }, [key])
  return read
}
