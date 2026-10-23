// @vitest-environment jsdom
/** The track-area height clamp and the skip target of the timeline editor. */
import { describe, expect, it } from 'vitest'
import { clampTrackHeight } from '../src/client/TimelineEditor.tsx'
import { skipTarget } from '../src/client/timelines.ts'

describe('clampTrackHeight', () => {
  it('keeps at least 160 px for the preview and at least the track rows\' own height', () => {
    expect(clampTrackHeight(300, 800, 220)).toBe(300)
    expect(clampTrackHeight(700, 800, 220)).toBe(640)
    expect(clampTrackHeight(100, 800, 220)).toBe(220)
    expect(clampTrackHeight(300, 300, 220)).toBe(220)
  })
})

describe('skipTarget', () => {
  it('moves the playhead by the skip and clamps it to the timeline', () => {
    expect(skipTarget(3, 5, 30)).toBe(8)
    expect(skipTarget(28, 5, 30)).toBe(30)
    expect(skipTarget(3, -5, 30)).toBe(0)
    expect(skipTarget(0, 5, 0)).toBe(0)
  })
})
