// @vitest-environment jsdom
/** The elapsed-time text and the hook that counts seconds while a render runs. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { formatElapsed, useElapsedSeconds } from '../src/client/elapsed.ts'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-09T10:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('formatElapsed', () => {
  it('reads m:ss under an hour and h:mm:ss from an hour', () => {
    expect([0, 7, 125, 3599, 3600, 3725].map(formatElapsed)).toEqual(['0:00', '0:07', '2:05', '59:59', '1:00:00', '1:02:05'])
  })

  it('reads negative and non-finite input as 0:00', () => {
    expect([-5, Number.NaN, Number.POSITIVE_INFINITY].map(formatElapsed)).toEqual(['0:00', '0:00', '0:00'])
  })
})

describe('useElapsedSeconds', () => {
  it('counts whole seconds since the start while active and ticks once a second', () => {
    const { result } = renderHook(() => useElapsedSeconds('2026-11-09T09:59:50Z', true))
    expect(result.current).toBe(10)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current).toBe(13)
  })

  it('is null without a start time or while inactive, and stops ticking when it turns inactive', () => {
    const none = renderHook(() => useElapsedSeconds(undefined, true))
    expect(none.result.current).toBeNull()
    const props = { active: true }
    const { result, rerender } = renderHook(({ active }) => useElapsedSeconds('2026-11-09T10:00:00Z', active), { initialProps: props })
    expect(result.current).toBe(0)
    rerender({ active: false })
    expect(result.current).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its interval on unmount', () => {
    const { unmount } = renderHook(() => useElapsedSeconds('2026-11-09T10:00:00Z', true))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
