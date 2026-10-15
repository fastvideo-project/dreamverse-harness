// @vitest-environment jsdom
/** The Web Audio context that the timeline player routes the sound of both video elements through. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useTimelinePlayer } from '../src/client/player.ts'
import type { TimelinePlayer } from '../src/client/player.ts'
import type { TrackClip } from '../src/client/timelines.ts'

const CLIPS: TrackClip[] = [
  { position: 1, clip: 'a', assetId: 'a.mp4', status: 'ready', rawIn: null, rawOut: null, inSec: 0, outSec: 2, assetSeconds: 2, seconds: 2, startSec: 0, thumbnail: null, stale: false },
  { position: 2, clip: 'b', assetId: 'b.mp4', status: 'ready', rawIn: null, rawOut: null, inSec: 0, outSec: 2, assetSeconds: 2, seconds: 2, startSec: 2, thumbnail: null, stale: false },
]

/** What a test reads back from the Web Audio contexts the player created. */
interface AudioRecord {
  sources: HTMLMediaElement[]
  connected: unknown[]
  resumes: number
  closed: boolean
}

let player: TimelinePlayer
let contexts: AudioRecord[] = []
let resume: () => Promise<void> = () => Promise.resolve()

/** Stands in for `AudioContext`, which jsdom lacks, and records how the player uses it. */
class FakeAudioContext {
  readonly destination = { node: 'destination' }
  private readonly record: AudioRecord = { sources: [], connected: [], resumes: 0, closed: false }

  constructor() { contexts.push(this.record) }

  createMediaElementSource(element: HTMLMediaElement): { connect: (node: unknown) => void } {
    this.record.sources.push(element)
    return { connect: (node) => { this.record.connected.push(node) } }
  }

  resume(): Promise<void> {
    this.record.resumes += 1
    return resume()
  }

  close(): Promise<void> {
    this.record.closed = true
    return Promise.resolve()
  }
}

/** Two stacked video elements under the player of {@link CLIPS}. */
function Viewer(): ReactNode {
  player = useTimelinePlayer('t1', CLIPS, 4)
  return <>{player.elements.map((ref, which) => <video key={which} ref={ref} />)}</>
}

beforeEach(() => {
  contexts = []
  resume = () => Promise.resolve()
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined)
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('plays the sound of both elements through one Web Audio context that the first play creates and unmounting closes', () => {
  const view = render(<Viewer />)
  const videos = [...view.container.querySelectorAll('video')]
  expect(contexts).toEqual([])
  act(() => { player.play() })
  expect(contexts).toHaveLength(1)
  expect(contexts[0]?.sources).toEqual(videos)
  expect(contexts[0]?.connected).toEqual([{ node: 'destination' }, { node: 'destination' }])
  expect(contexts[0]?.resumes).toBe(1)
  act(() => { player.pause() })
  act(() => { player.play() })
  expect(contexts).toHaveLength(1)
  expect(contexts[0]?.resumes).toBe(2)
  expect(contexts[0]?.closed).toBe(false)
  view.unmount()
  expect(contexts[0]?.closed).toBe(true)
})

it('plays without sound when the browser refuses to resume the Web Audio context', async () => {
  resume = () => Promise.reject(new Error('NotAllowedError'))
  render(<Viewer />)
  act(() => { player.play() })
  await act(async () => { await Promise.resolve() })
  expect(player.playing).toBe(true)
})
