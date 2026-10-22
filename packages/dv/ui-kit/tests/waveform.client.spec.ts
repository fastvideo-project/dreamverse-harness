// @vitest-environment jsdom
/**
 * The waveform's peak computation and envelope cache. The cache tests stub `fetch` and `OfflineAudioContext` and run on
 * fake timers, so each retry delay passes on demand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { clipPeaks, peakEnvelope, useAudioEnvelope } from '../src/client/waveform.ts'

describe('peakEnvelope', () => {
  it('keeps the largest absolute sample of each window across all channels', () => {
    // 8 samples per second, 2 windows per second: windows of 4 samples.
    const left = Float32Array.from([0.1, -0.5, 0.2, 0, 0, 0, 0.3, 0])
    const right = Float32Array.from([0, 0.2, 0, 0, -0.9, 0, 0, 0])
    const envelope = peakEnvelope([left, right], 8, 2)
    expect(Array.from(envelope.peaks)).toEqual([0.5, 0.9].map(Math.fround))
    expect(envelope.rate).toBe(2)
    expect(envelope.max).toBeCloseTo(0.9)
  })

  it('reads a channel shorter than the first as silence past its end, and reads the samples in place', () => {
    const subarray = vi.spyOn(Float32Array.prototype, 'subarray')
    const envelope = peakEnvelope([Float32Array.from([0, 0, 0, 0.4]), Float32Array.from([0.2])], 2, 1)
    expect([Array.from(envelope.peaks), subarray.mock.calls.length]).toEqual([[0.2, 0.4].map(Math.fround), 0])
    subarray.mockRestore()
  })

  it('gives a partial last window its own peak and an empty buffer no windows', () => {
    expect(Array.from(peakEnvelope([Float32Array.from([0.25, 0, 0, 0, -0.5])], 4, 1).peaks)).toEqual([0.25, 0.5])
    expect(peakEnvelope([], 8, 2)).toEqual({ peaks: new Float32Array(0), rate: 2, max: 0 })
  })
})

describe('clipPeaks', () => {
  // Ten windows per second over two seconds: 0.0, 0.1, … 1.0 at window 10, then 0.5 to the end.
  const peaks = Float32Array.from({ length: 20 }, (_, at) => at <= 10 ? at / 10 : 0.5)
  const envelope = { peaks, rate: 10, max: 1 }

  it('splits the played range into bars, each the largest peak inside it relative to the asset peak', () => {
    expect(clipPeaks(envelope, 0, 2, 4).map(peak => Math.round(peak * 100) / 100)).toEqual([0.4, 0.9, 1, 0.5])
    expect(clipPeaks({ ...envelope, max: 2 }, 0, 2, 2).map(peak => Math.round(peak * 100) / 100)).toEqual([0.45, 0.5])
  })

  it('reads only the trimmed range between the in and out points', () => {
    expect(clipPeaks(envelope, 0.2, 0.4, 2).map(peak => Math.round(peak * 100) / 100)).toEqual([0.2, 0.3])
  })

  it('repeats a window for bars narrower than it, and reads silence past the decoded audio', () => {
    expect(clipPeaks(envelope, 0.5, 0.6, 4).map(peak => Math.round(peak * 100) / 100)).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(clipPeaks(envelope, 2, 3, 2)).toEqual([0, 0])
  })

  it('returns no bars for an empty range and zeros for silent audio', () => {
    expect(clipPeaks(envelope, 1, 1, 4)).toEqual([])
    expect(clipPeaks(envelope, 0, 1, 0)).toEqual([])
    expect(clipPeaks({ peaks: new Float32Array(10), rate: 10, max: 0 }, 0, 1, 2)).toEqual([0, 0])
  })
})

describe('useAudioEnvelope', () => {
  /** A media file body that the stub decoder rejects, as `decodeAudioData` rejects a file without an audio track. */
  const NO_AUDIO = 'no audio'
  /** A media file body that the stub decoder decodes into a buffer without samples. */
  const EMPTY_AUDIO = 'empty audio'
  /** One answer of the stub `fetch`: a network failure, or a status with a body. */
  type Answer = 'network' | { status: number; body?: string }
  let answers: Answer[] = []
  const fetchStub = vi.fn((url: string) => {
    void url
    const answer = answers.length > 1 ? answers.shift() : answers[0]
    if (answer === undefined || answer === 'network') return Promise.reject(new TypeError('Failed to fetch'))
    const bytes = new TextEncoder().encode(answer.body ?? 'audio').buffer
    return Promise.resolve({ ok: answer.status < 300, status: answer.status, arrayBuffer: () => Promise.resolve(bytes) })
  })
  /**
   * A stand-in decoder: one second of samples at 0.5, a rejection for the {@link NO_AUDIO} body, and no samples for the
   * {@link EMPTY_AUDIO} body.
   */
  class StubAudioContext {
    decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
      const body = new TextDecoder().decode(bytes)
      if (body === NO_AUDIO) return Promise.reject(new DOMException('no audio track', 'EncodingError'))
      if (body === EMPTY_AUDIO) {
        return Promise.resolve({ numberOfChannels: 1, length: 0, sampleRate: 100, getChannelData: () => new Float32Array(0) })
      }
      const samples = new Float32Array(100).fill(0.5)
      return Promise.resolve({ numberOfChannels: 1, length: 100, sampleRate: 100, getChannelData: () => samples })
    }
  }
  /**
   * Let fake time pass, then 1 ms more: a retry waits for idle time on a zero-delay timer, which the fake clock sets
   * 1 ms ahead when a timer callback schedules it.
   */
  const advance = async (ms: number): Promise<void> => {
    await act(() => vi.advanceTimersByTimeAsync(ms))
    await act(() => vi.advanceTimersByTimeAsync(1))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchStub)
    vi.stubGlobal('OfflineAudioContext', StubAudioContext)
    fetchStub.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('asks again after a network failure and after a 5xx answer while the clip stays mounted', async () => {
    answers = ['network', { status: 503 }, { status: 200 }]
    const { result } = renderHook(() => useAudioEnvelope('flaky.mp4'))
    await advance(0)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(result.current).toBeNull()
    await advance(2000)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(result.current).toBeNull()
    await advance(8000)
    expect(fetchStub).toHaveBeenCalledTimes(3)
    expect(result.current?.max).toBe(0.5)
  })

  it('stops asking after the last retry delay, and a later mount fetches the file again', async () => {
    answers = ['network']
    const first = renderHook(() => useAudioEnvelope('offline.mp4'))
    await advance(0)
    await advance(2000)
    await advance(8000)
    await advance(30000)
    expect(fetchStub).toHaveBeenCalledTimes(4)
    await advance(60000)
    expect(fetchStub).toHaveBeenCalledTimes(4)
    expect(first.result.current).toBeNull()
    first.unmount()
    answers = [{ status: 200 }]
    const second = renderHook(() => useAudioEnvelope('offline.mp4'))
    await advance(0)
    expect(fetchStub).toHaveBeenCalledTimes(5)
    expect(second.result.current?.max).toBe(0.5)
  })

  it('keeps a file without an audio track and a missing file settled, so neither is fetched again', async () => {
    answers = [{ status: 200, body: NO_AUDIO }]
    const silent = renderHook(() => useAudioEnvelope('silent.mp4'))
    await advance(0)
    answers = [{ status: 404 }]
    const missing = renderHook(() => useAudioEnvelope('missing.mp4'))
    await advance(60000)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(silent.result.current).toBeNull()
    expect(missing.result.current).toBeNull()
    silent.unmount()
    missing.unmount()
    renderHook(() => useAudioEnvelope('silent.mp4'))
    renderHook(() => useAudioEnvelope('missing.mp4'))
    await advance(60000)
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('settles a file whose audio decodes to no samples as having no waveform', async () => {
    answers = [{ status: 200, body: EMPTY_AUDIO }]
    const empty = renderHook(() => useAudioEnvelope('empty.mp4'))
    await advance(60000)
    expect(empty.result.current).toBeNull()
    renderHook(() => useAudioEnvelope('empty.mp4'))
    await advance(60000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('decodes an asset once for every clip that shows it, including a clip unmounted before the decode settles', async () => {
    answers = [{ status: 200 }]
    const first = renderHook(() => useAudioEnvelope('shared.mp4'))
    const second = renderHook(() => useAudioEnvelope('shared.mp4'))
    const gone = renderHook(() => useAudioEnvelope('shared.mp4'))
    gone.unmount()
    await advance(0)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(first.result.current?.max).toBe(0.5)
    expect(second.result.current?.max).toBe(0.5)
    expect(renderHook(() => useAudioEnvelope('shared.mp4')).result.current?.max).toBe(0.5)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('has no envelope for a placeholder clip without an asset', async () => {
    const { result } = renderHook(() => useAudioEnvelope(null))
    await advance(60000)
    expect(result.current).toBeNull()
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('starts a decode only when the browser reports idle time', async () => {
    const idleCallbacks: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idleCallbacks.push(callback); return idleCallbacks.length })
    answers = [{ status: 200 }]
    const { result } = renderHook(() => useAudioEnvelope('idle.mp4'))
    await advance(60000)
    expect(fetchStub).not.toHaveBeenCalled()
    expect(idleCallbacks).toHaveLength(1)
    await act(async () => { idleCallbacks[0]?.() })
    await advance(0)
    expect(fetchStub).toHaveBeenCalledOnce()
    expect(result.current?.max).toBe(0.5)
  })
})
