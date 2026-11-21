/** The readiness holder starts unknown and tells its subscribers about each published set. */
import { expect, it, vi } from 'vitest'
import { createLlmReadiness } from '../src/client/llm-readiness.ts'

it('starts at null, notifies subscribers of a published set, and stops after unsubscribe', () => {
  const readiness = createLlmReadiness()
  const listener = vi.fn()
  const stop = readiness.subscribe(listener)
  expect(readiness.getSnapshot()).toBeNull()
  readiness.set(new Set(['deepseek']))
  expect(listener).toHaveBeenCalledTimes(1)
  expect([...readiness.getSnapshot() ?? []]).toEqual(['deepseek'])
  stop()
  readiness.set(new Set())
  expect(listener).toHaveBeenCalledTimes(1)
})
