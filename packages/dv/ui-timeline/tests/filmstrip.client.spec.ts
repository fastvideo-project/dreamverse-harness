// @vitest-environment jsdom
/** The frames of a video at steady times: the first one as soon as it is drawn, then the whole strip. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFilmstrips } from '../src/client/filmstrip.ts'

afterEach(() => { vi.restoreAllMocks() })

/** A document whose `createElement` the spies on `document` do not replace, to make the elements they hand out. */
const maker = document.implementation.createHTMLDocument('')

/**
 * Hand out videos that report the given lengths by file name and a 160 × 90 picture, and canvases whose frames name the
 * video and the time they were drawn from; while `noContext` is on, a new canvas gives no context.
 * @param lengths - each video's length in seconds by file name; NaN for a length the browser does not report.
 * @param noPicture - the file names whose videos report no picture height.
 * @returns the videos by file name, once the hook set their source, and the switch for canvases without a context.
 */
function fakeMedia(
  lengths: Record<string, number>, noPicture: string[] = [],
): { videos: Map<string, HTMLVideoElement>; noContext: { on: boolean } } {
  const videos = new Map<string, HTMLVideoElement>()
  const noContext = { on: false }
  const nameOf = (video: HTMLVideoElement): string => video.src.split('/').pop() ?? ''
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = maker.createElement(tag)
    if (element instanceof HTMLVideoElement) {
      let time = 0
      // jsdom loads no media; each test video reports its size, its length and its time, and the test fires its events.
      Object.defineProperty(element, 'currentTime', { get: () => time, set: (value: number) => { time = value } })
      queueMicrotask(() => {
        const name = nameOf(element)
        Object.defineProperties(element, {
          duration: { value: lengths[name] }, videoWidth: { value: 160 }, videoHeight: { value: noPicture.includes(name) ? 0 : 90 },
        })
        videos.set(name, element)
      })
    }
    if (element instanceof HTMLCanvasElement) {
      let drawn = ''
      const context = { drawImage: (video: HTMLVideoElement) => { drawn = `${nameOf(video)}@${String(video.currentTime)}` } }
      vi.spyOn(element, 'getContext').mockReturnValue(noContext.on ? null : context as never)
      vi.spyOn(element, 'toDataURL').mockImplementation(() => `data:${drawn}`)
    }
    return element
  })
  return { videos, noContext }
}

describe('useFilmstrips', () => {
  it('gives the first frame at once and the whole strip after the last seek, one frame per second', async () => {
    const { videos } = fakeMedia({ 'a.mp4': 2.5 })
    const { result } = renderHook(() => useFilmstrips(['/a.mp4']))
    await act(async () => { await Promise.resolve() })
    const video = videos.get('a.mp4') as HTMLVideoElement
    await act(async () => { video.dispatchEvent(new Event('loadeddata')) })
    expect(result.current.get('/a.mp4')).toEqual({ step: 1, frames: ['data:a.mp4@0'], complete: false, aspect: 160 / 90 })
    expect(video.currentTime).toBe(1)
    await act(async () => { video.dispatchEvent(new Event('seeked')) })
    expect([result.current.get('/a.mp4')?.complete, video.currentTime]).toEqual([false, 2])
    await act(async () => { video.dispatchEvent(new Event('seeked')) })
    expect(result.current.get('/a.mp4')).toMatchObject({ frames: ['data:a.mp4@0', 'data:a.mp4@1', 'data:a.mp4@2'], complete: true })
    expect(video.hasAttribute('src')).toBe(false)
    // Another editor that asks for the same video gets the strip without reading it again.
    const again = renderHook(() => useFilmstrips(['/a.mp4']))
    expect(again.result.current.get('/a.mp4')?.complete).toBe(true)
  })

  it('reads at most forty frames of a long video, and only the first frame of a video whose length is not reported', async () => {
    const { videos } = fakeMedia({ 'long.mp4': 100, 'stream.mp4': Number.NaN })
    const { result } = renderHook(() => useFilmstrips(['/long.mp4', '/stream.mp4']))
    await act(async () => { await Promise.resolve() })
    const long = videos.get('long.mp4') as HTMLVideoElement
    await act(async () => {
      long.dispatchEvent(new Event('loadeddata'))
      for (let seek = 1; seek < 40; seek += 1) long.dispatchEvent(new Event('seeked'))
    })
    expect(result.current.get('/long.mp4')).toMatchObject({ step: 2.5, complete: true })
    expect(result.current.get('/long.mp4')?.frames).toHaveLength(40)
    expect(result.current.get('/long.mp4')?.frames.at(-1)).toBe('data:long.mp4@97.5')
    await act(async () => { videos.get('stream.mp4')?.dispatchEvent(new Event('loadeddata')) })
    expect(result.current.get('/stream.mp4')).toEqual({ step: 1, frames: ['data:stream.mp4@0'], complete: true, aspect: 160 / 90 })
  })

  it('gives nothing for a video that does not decode or whose canvas gives no context, and stops listening once unmounted', async () => {
    const { videos, noContext } = fakeMedia({ 'b.mp4': 3, 'c.mp4': 3, 'd.mp4': 3, 'e.mp4': 3 }, ['e.mp4'])
    const { result, unmount } = renderHook(() => useFilmstrips(['/b.mp4', '/c.mp4', '/d.mp4', '/e.mp4']))
    await act(async () => { await Promise.resolve() })
    await act(async () => { videos.get('b.mp4')?.dispatchEvent(new Event('error')) })
    noContext.on = true
    await act(async () => { videos.get('c.mp4')?.dispatchEvent(new Event('loadeddata')) })
    noContext.on = false
    await act(async () => { videos.get('e.mp4')?.dispatchEvent(new Event('loadeddata')) })
    expect(result.current.size).toBe(0)
    expect(renderHook(() => useFilmstrips([])).result.current.size).toBe(0)
    expect(videos.get('b.mp4')?.hasAttribute('src')).toBe(false)
    unmount()
    await act(async () => { videos.get('d.mp4')?.dispatchEvent(new Event('loadeddata')) })
    expect(result.current.size).toBe(0)
  })
})
