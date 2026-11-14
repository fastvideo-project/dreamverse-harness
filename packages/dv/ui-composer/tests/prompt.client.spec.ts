// @vitest-environment jsdom
/**
 * The apply world of the composer beside the components: the live state of each project, fetched once per burst of
 * project events, and the registry of parameter bars, which names the holder of a refused operation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ProjectEvent, WireState } from '@dv/ui-kit/types.ts'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { shotRenderBar } from '../../ui-shot-render/src/client/param-bar.ts'
import { applyPrompt, catalogSource, projectStates } from '../src/client/prompt.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A client whose state reads and event subscriptions the test drives. */
function client(read: () => Promise<WireState> = () => Promise.resolve(fixtureState())) {
  const listeners: Array<(event: ProjectEvent | null) => void> = []
  const stopped: string[] = []
  return {
    getState: vi.fn((_project: string) => read()),
    subscribe: vi.fn((project: string, onChange: (event: ProjectEvent | null) => void) => {
      listeners.push(onChange)
      return () => { stopped.push(project) }
    }),
    emit: () => { for (const listener of listeners) listener(null) },
    stopped,
  }
}

describe('the live state of a project', () => {
  it('fetches on the first subscriber, once more after a burst of events, and stops with the last subscriber', async () => {
    vi.useFakeTimers()
    const fake = client()
    const states = projectStates(fake)
    const p1 = states('p1')
    expect(states('p1')).toBe(p1)
    const offA = p1.subscribe(() => {})
    const offB = p1.subscribe(() => {})
    await vi.runAllTimersAsync()
    expect([fake.getState.mock.calls.length, p1.getSnapshot()?.project.id]).toEqual([1, 'p1'])
    fake.emit()
    await vi.advanceTimersByTimeAsync(100)
    fake.emit()
    await vi.advanceTimersByTimeAsync(149)
    expect(fake.getState).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.getState).toHaveBeenCalledTimes(2)
    offA()
    expect(fake.stopped).toEqual([])
    offB()
    expect(fake.stopped).toEqual(['p1'])
  })

  it('keeps the answer of the newest fetch when the answer of an older fetch arrives after it', async () => {
    vi.useFakeTimers()
    const answers: Array<(state: WireState) => void> = []
    const fake = client(() => new Promise((resolve) => { answers.push(resolve) }))
    const p1 = projectStates(fake)('p1')
    p1.subscribe(() => {})
    fake.emit()
    await vi.advanceTimersByTimeAsync(150)
    answers[1]?.({ ...fixtureState(), head: 'newer' })
    await vi.advanceTimersByTimeAsync(0)
    answers[0]?.({ ...fixtureState(), head: 'older' })
    await vi.advanceTimersByTimeAsync(0)
    expect(p1.getSnapshot()?.head).toBe('newer')
  })

  it('fetches nothing more when the last subscriber leaves during the wait after an event', async () => {
    vi.useFakeTimers()
    const fake = client()
    const off = projectStates(fake)('p1').subscribe(() => {})
    await vi.runAllTimersAsync()
    fake.emit()
    off()
    await vi.advanceTimersByTimeAsync(150)
    expect(fake.getState).toHaveBeenCalledTimes(1)
  })

  it('drops the state of a project with its last subscriber, and fetches it again for the next one', async () => {
    const fake = client()
    const states = projectStates(fake)
    const first = states('p1')
    const off = first.subscribe(() => {})
    await vi.waitFor(() => { expect(first.getSnapshot()).not.toBeNull() })
    off()
    const next = states('p1')
    expect(next.getSnapshot()).toBeNull()
    next.subscribe(() => {})
    await vi.waitFor(() => { expect(next.getSnapshot()?.project.id).toBe('p1') })
    expect(fake.getState).toHaveBeenCalledTimes(2)
  })

  it('takes back a source that a consumer read before the last consumer left, while the project has no other source', () => {
    const fake = client()
    const states = projectStates(fake)
    const read = states('p1')
    read.subscribe(() => {})()
    read.subscribe(() => {})
    expect(states('p1')).toBe(read)
  })

  it('fetches nothing for the empty project of a chat chip while no project is open', () => {
    const fake = client()
    projectStates(fake)('').subscribe(() => {})
    expect([fake.getState.mock.calls, fake.subscribe.mock.calls]).toEqual([[], []])
  })

  it('logs a failed fetch and keeps no state', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = projectStates(client(() => Promise.reject(new Error('offline'))))('p1')
    source.subscribe(() => {})
    await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('[dv-composer] state failed:', new Error('offline')) })
    expect(source.getSnapshot()).toBeNull()
  })
})

describe('the model catalog', () => {
  it('is null until it loads, and loads again when a consumer subscribes after the last one left', async () => {
    const answers = [[{ modality: 'video' }], [{ modality: 'audio' }]]
    const load = vi.fn(() => Promise.resolve(answers.shift() as never))
    const catalog = catalogSource(load)
    expect(catalog.getSnapshot()).toBeNull()
    const offA = catalog.subscribe(() => {})
    const offB = catalog.subscribe(() => {})
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'video' }]) })
    offA()
    expect(load).toHaveBeenCalledTimes(1)
    offB()
    catalog.subscribe(() => {})
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'audio' }]) })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded catalog when a later load fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockResolvedValueOnce([{ modality: 'video' }]).mockRejectedValueOnce(new Error('offline'))
    const catalog = catalogSource(load)
    catalog.subscribe(() => {})()
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'video' }]) })
    catalog.subscribe(() => {})
    await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('[dv-composer] models failed:', new Error('offline')) })
    expect(catalog.getSnapshot()).toEqual([{ modality: 'video' }])
  })

  it('loads again once after a burst of catalog changes while it has a consumer, and stops following after the last leaves', async () => {
    const answers = [[{ modality: 'video' }], [{ modality: 'audio' }]]
    const load = vi.fn(() => Promise.resolve(answers.shift() as never))
    let changed: (() => void) | null = null
    const stop = vi.fn()
    const catalog = catalogSource(load, (onChange) => { changed = onChange; return stop })
    const off = catalog.subscribe(() => {})
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'video' }]) })
    changed!(); changed!(); changed!()
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'audio' }]) })
    expect(load).toHaveBeenCalledTimes(2)
    off()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('loads once more after a load during which the catalog changed, and drops a pending change when the last consumer leaves', async () => {
    vi.useFakeTimers()
    try {
      let answer: ((catalog: never) => void) | null = null
      const load = vi.fn(() => new Promise<never>((resolve) => { answer = resolve }))
      let changed: (() => void) | null = null
      const catalog = catalogSource(load, (onChange) => { changed = onChange; return () => {} })
      const off = catalog.subscribe(() => {})
      changed!()
      await vi.advanceTimersByTimeAsync(150)
      expect(load).toHaveBeenCalledTimes(1)
      answer!([{ modality: 'video' }] as never)
      await vi.advanceTimersByTimeAsync(0)
      expect(load).toHaveBeenCalledTimes(2)
      answer!([{ modality: 'audio' }] as never)
      await vi.advanceTimersByTimeAsync(0)
      expect(catalog.getSnapshot()).toEqual([{ modality: 'audio' }])
      changed!()
      off()
      await vi.advanceTimersByTimeAsync(150)
      expect(load).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
})

describe('the model catalog failure', () => {
  it('records the message of a failed load, clears it when a reload succeeds, and records none for a load that succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ modality: 'video' }])
    const catalog = catalogSource(load)
    expect(catalog.failure.getSnapshot()).toBeNull()
    const seen = vi.fn()
    catalog.failure.subscribe(seen)
    catalog.subscribe(() => {})
    await vi.waitFor(() => { expect(catalog.failure.getSnapshot()).toBe('offline') })
    expect(catalog.getSnapshot()).toBeNull()
    catalog.reload()
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'video' }]) })
    expect(catalog.failure.getSnapshot()).toBeNull()
    expect(seen).toHaveBeenCalled()
  })

  it('starts no second load while a load is in flight, so no older answer can replace a newer one', async () => {
    let answer: (catalog: unknown[]) => void = () => {}
    const load = vi.fn().mockReturnValueOnce(new Promise((resolve) => { answer = resolve })).mockResolvedValueOnce([{ modality: 'video' }])
    const catalog = catalogSource(load)
    catalog.subscribe(() => {})
    catalog.reload()
    expect(load).toHaveBeenCalledTimes(1)
    answer([{ modality: 'audio' }])
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'audio' }]) })
    catalog.reload()
    await vi.waitFor(() => { expect(catalog.getSnapshot()).toEqual([{ modality: 'video' }]) })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clears the message while a reload runs, and records the message of a reload that fails again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline'))
    const catalog = catalogSource(load)
    catalog.subscribe(() => {})
    await vi.waitFor(() => { expect(catalog.failure.getSnapshot()).toBe('offline') })
    catalog.reload()
    expect(catalog.failure.getSnapshot()).toBeNull()
    await vi.waitFor(() => { expect(catalog.failure.getSnapshot()).toBe('still offline') })
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the parameter bars', () => {
  it('refuse a second bar of an operation, naming the package that holds it', async () => {
    const ctx = new Context()
    ctx.provide('slots', { inject: () => () => undefined, register: () => () => undefined, registerFactory: () => () => undefined } as never)
    await ctx.plugin({ inject: ['slots'], apply: applyPrompt }).await()
    const bar = { ...shotRenderBar, operation: 'shot.render', owner: '@dv/ui-shot-render' }
    ctx.dvComposer.paramBars.register(bar)
    expect(() => ctx.dvComposer.paramBars.register({ ...bar, owner: '@dv/ui-other' }))
      .toThrow('registry key "shot.render" is already registered by @dv/ui-shot-render')
  })
})
