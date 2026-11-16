// @vitest-environment jsdom
/**
 * The pictures of the clip blocks: a clip whose video strip is complete shows one tile per frame, each the frame at the
 * tile's time; until then it repeats its still image, else its video's first frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { AssetId } from '@dv/project/types'
import type { ClipId } from '@dv/timeline/types'
import { DvClient } from '@dv/ui-kit/api.ts'
import { fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { Filmstrip } from '../src/client/filmstrip.ts'
import { bootTimeline, centerView } from './center.client.tsx'
import type { BootedTimeline } from './center.client.tsx'

/** The strips the stand-in reader gives, by video URL: shot1.mp4 and export.mp4 complete, shot2.mp4 at its first frame. */
const STRIPS = new Map<string, Filmstrip>([
  ['/dv/assets/shot1.mp4', { step: 1, frames: ['f0', 'f1', 'f2', 'f3'], complete: true, aspect: 1 }],
  ['/dv/assets/shot2.mp4', { step: 1, frames: ['s0'], complete: false, aspect: 1 }],
  ['/dv/assets/export.mp4', { step: 0.5, frames: ['e0', 'e1', 'e2', 'e3', 'e4', 'e5'], complete: true, aspect: 1 }],
])

vi.mock('../src/client/filmstrip.ts', () => ({
  useFilmstrips: (urls: readonly string[]) => new Map(urls.flatMap(url => STRIPS.has(url) ? [[url, STRIPS.get(url)]] : [])),
}))

let booted: BootedTimeline

beforeEach(async () => {
  document.documentElement.lang = 'zh-CN'
  booted = await bootTimeline()
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await booted.fiber.dispose() })

describe('clip pictures', () => {
  it('draws a clip with a complete strip as tiles of the frames at their times, and repeats a still or first frame until then', async () => {
    const state = (): ReturnType<typeof fixtureState> => {
      const fixture = fixtureState()
      const [t1] = fixture.components.timeline.timelines
      // export.mp4 plays from 0.5 s to 2.5 s of its asset on video track 0; its strip has a frame every half second.
      if (t1 !== undefined) {
        t1.track_clips = [{ id: 'cl5' as ClipId, asset: 'export.mp4' as AssetId, in_sec: 0.5, out_sec: 2.5, start_sec: 8, track: 0 }]
        t1.track_order = ['sound', 'video']
      }
      return fixture
    }
    const { fetch } = scriptedFetch({ state })
    const view = render(centerView(booted, { client: new DvClient(fetch) }))
    const block = (selector: string): HTMLElement => view.container.querySelector(selector) as HTMLElement
    await waitFor(() => { expect(view.container.querySelector('[data-track-clip-block="cl5"]')).not.toBeNull() })
    const tiles = (element: HTMLElement): string[] =>
      [...element.querySelectorAll('[data-filmstrip-frame]')].map(tile => `${String(tile.getAttribute('data-filmstrip-frame'))} ${(tile as HTMLElement).style.left}`)
    // cl1 plays shot1.mp4's 4 s over 160 px at 40 px a second; 54 px square tiles show the frames at 0.675 s, 2.025 s and 3.375 s.
    expect(tiles(block('[data-clip="cl1"]'))).toEqual(['1 0px', '2 54px', '3 108px'])
    expect(block('[data-clip="cl1"]').querySelector('video')).toBeNull()
    // cl2's strip is not complete, so it repeats the still image its render left.
    expect(tiles(block('[data-clip="cl2"]'))).toEqual([])
    expect(block('[data-clip="cl2"]').style.background).toContain('shot2-last.png')
    // cl5 starts 0.5 s into its asset: its two tiles show the frames at 1.175 s and 2.5 s, its out point.
    expect(tiles(block('[data-track-clip-block="cl5"]'))).toEqual(['2 0px', '5 54px'])
  })

  it('repeats the first frame of a clip whose strip is not complete and that has no still image', async () => {
    const state = (): ReturnType<typeof fixtureState> => {
      const fixture = fixtureState()
      const [t1] = fixture.components.timeline.timelines
      if (t1 !== undefined) {
        t1.track_clips = [{ id: 'cl5' as ClipId, asset: 'shot2.mp4' as AssetId, in_sec: null, out_sec: null, start_sec: 8, track: 0 }]
        t1.track_order = ['sound', 'video']
      }
      // shot2.mp4 keeps its producer but loses the still beside it.
      fixture.assets = fixture.assets.filter(asset => asset.id !== 'shot2-last.png')
      return fixture
    }
    const { fetch } = scriptedFetch({ state })
    const view = render(centerView(booted, { client: new DvClient(fetch) }))
    await waitFor(() => { expect(view.container.querySelector('[data-track-clip-block="cl5"]')).not.toBeNull() })
    const background = (view.container.querySelector('[data-track-clip-block="cl5"]') as HTMLElement).style.background
    expect(background).toContain('url("s0")')
  })
})
