// @vitest-environment jsdom
/**
 * The timeline player: the playhead follows the clock at the playback speed up to the end of the timeline's last clip,
 * plays, pauses, seeks and skips start, stop and move it, and a clip that is still loading holds it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useTimelinePlayer } from '../src/client/player.ts'
import type { TimelinePlayer } from '../src/client/player.ts'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

/**
 * Render the player of one timeline.
 * @param span - the timeline's length.
 * @returns the latest player, a frame runner, and setters of the playback speed, the timeline and its length.
 */
function mountPlayer(span: number) {
  const latest: { player?: TimelinePlayer } = {}
  // Without `stalled`, the player gets no check of a loading clip, as a caller that has none passes none.
  const props: { rate: number; timeline: string | null; span: number; stalled?: boolean } = { rate: 2, timeline: 't1', span }
  function Harness(): ReactNode {
    const { stalled } = props
    latest.player = useTimelinePlayer(props.timeline, props.span, props.rate, stalled === undefined ? undefined : () => stalled)
    return null
  }
  const view = render(<Harness />)
  const update = (change: Partial<typeof props>): void => {
    Object.assign(props, change)
    view.rerender(<Harness />)
  }
  const player = (): TimelinePlayer => {
    if (latest.player === undefined) throw new Error('the player did not render')
    return latest.player
  }
  const frames = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }
  return { player, frames, update }
}

describe('useTimelinePlayer', () => {
  it('follows the clock from the playhead to the timeline\'s end at the playback speed, then stops there', () => {
    const { player, frames } = mountPlayer(6)
    act(() => { player().play() })
    expect(player().playing).toBe(true)
    // At twice the normal speed, one second of clock time moves the playhead two seconds.
    frames(1000)
    expect(player().position).toBeCloseTo(2, 1)
    frames(3000)
    expect([player().position, player().playing]).toEqual([6, false])
    // A play at the end starts again from 0.
    act(() => { player().play() })
    frames(500)
    expect(player().position).toBeCloseTo(1, 1)
  })

  it('applies a new playback speed from where the clock moved the playhead, without a jump', () => {
    const { player, frames, update } = mountPlayer(20)
    act(() => { player().play() })
    frames(1000)
    update({ rate: 1 })
    frames(1000)
    expect(player().position).toBeCloseTo(3, 1)
  })

  it('stops the clock on a pause or a seek, and keeps the playhead where it stopped', () => {
    const { player, frames } = mountPlayer(10)
    act(() => { player().seek(3) })
    act(() => { player().play() })
    frames(500)
    act(() => { player().pause() })
    const paused = player().position
    expect(paused).toBeCloseTo(4, 1)
    frames(1000)
    expect([player().position, player().playing]).toEqual([paused, false])
    act(() => { player().play() })
    frames(500)
    act(() => { player().seek(12) })
    expect([player().position, player().playing]).toEqual([10, false])
    act(() => { player().seek(-1) })
    expect(player().position).toBe(0)
  })

  it('skips while playing and keeps playing, skips while paused and stays paused, and stops a skip at the end', () => {
    const { player, frames } = mountPlayer(10)
    act(() => { player().skip(5) })
    expect([player().position, player().playing]).toEqual([5, false])
    act(() => { player().play() })
    frames(500)
    act(() => { player().skip(-5) })
    expect(player().playing).toBe(true)
    expect(player().position).toBeCloseTo(1, 1)
    act(() => { player().skip(20) })
    expect([player().position, player().playing]).toEqual([10, false])
  })

  it('holds the playhead while the clip the user sees is loading, and plays on from there once it can play', () => {
    const { player, frames, update } = mountPlayer(10)
    act(() => { player().play() })
    frames(500)
    const before = player().position
    expect(before).toBeCloseTo(1, 1)
    update({ stalled: true })
    frames(2000)
    expect([player().position, player().playing]).toEqual([before, true])
    update({ stalled: false })
    frames(500)
    expect(player().position).toBeCloseTo(before + 1, 1)
  })

  it('plays nothing on an empty timeline, moves to 0 on another timeline, and keeps the playhead inside a shorter one', () => {
    const { player, frames, update } = mountPlayer(0)
    act(() => { player().play() })
    expect(player().playing).toBe(false)
    update({ span: 8 })
    act(() => { player().seek(6) })
    update({ span: 4 })
    expect(player().position).toBe(4)
    act(() => { player().play() })
    frames(250)
    // Another timeline reads 0 at once and stops.
    update({ timeline: 't2' })
    expect([player().position, player().playing]).toEqual([0, false])
  })
})
