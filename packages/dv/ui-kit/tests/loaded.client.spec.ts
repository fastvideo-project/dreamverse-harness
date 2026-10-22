/** A source that loads its value on its first subscription, and keeps the empty value until a later load succeeds. */
import { describe, expect, it, vi } from 'vitest'
import { loadedOnce } from '../src/client/loaded.ts'

describe('loadedOnce', () => {
  it('loads on the first subscription only, then notifies the listeners still subscribed with the loaded value', async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>()
    const load = vi.fn(() => promise)
    const labels = loadedOnce<string[]>([], load)
    expect(load).not.toHaveBeenCalled()
    const empty = labels.getSnapshot()
    expect(empty).toEqual([])
    const first = vi.fn()
    const second = vi.fn()
    const gone = vi.fn()
    labels.subscribe(first)
    labels.subscribe(second)
    labels.subscribe(gone)()
    expect(load).toHaveBeenCalledTimes(1)
    expect(labels.getSnapshot()).toBe(empty)
    resolve(['Hero'])
    await vi.waitFor(() => { expect(first).toHaveBeenCalledTimes(1) })
    expect(second).toHaveBeenCalledTimes(1)
    expect(gone).not.toHaveBeenCalled()
    expect(labels.getSnapshot()).toEqual(['Hero'])
    labels.subscribe(vi.fn())
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps the empty value and notifies nobody when the load fails', async () => {
    const { promise, reject } = Promise.withResolvers<string[]>()
    const empty: string[] = []
    const labels = loadedOnce(empty, () => promise)
    const listener = vi.fn()
    labels.subscribe(listener)
    reject(new Error('unreachable route'))
    await promise.catch((error: unknown) => { void error })
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
    expect(labels.getSnapshot()).toBe(empty)
  })
})
