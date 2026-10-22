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
import { applyPrompt, projectStates } from '../src/client/prompt.ts'

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

describe('the parameter bars', () => {
  it('refuse a second bar of an operation, naming the package that holds it', async () => {
    const ctx = new Context()
    ctx.provide('slots', { inject: () => () => undefined, register: () => () => undefined, registerFactory: () => () => undefined } as never)
    await ctx.plugin({ inject: ['slots'], apply: applyPrompt }).await()
    ctx.dvComposer.paramBars.register(shotRenderBar)
    expect(() => ctx.dvComposer.paramBars.register({ ...shotRenderBar, owner: '@dv/ui-other' }))
      .toThrow('registry key "shot.render" is already registered by @dv/ui-shot-render')
  })
})
