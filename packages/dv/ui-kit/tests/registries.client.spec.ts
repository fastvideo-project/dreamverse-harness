/** The descriptor registry that plugin UI halves register into: one owner per key, a stable snapshot, and disposal. */
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/client/registries.ts'

interface Row { match: string; owner: string }

/** @returns an empty registry of rows keyed by `match`, each owned by its `owner`. */
function rowRegistry() {
  return createRegistry<Row>(row => [row.match], row => row.owner)
}

describe('createRegistry', () => {
  it('lists descriptors in registration order and keeps the same snapshot until a change', () => {
    const rows = rowRegistry()
    const empty = rows.getSnapshot()
    expect(rows.getSnapshot()).toBe(empty)
    rows.register({ match: 'story.approve', owner: '@dv/ui-workflow-story' })
    rows.register({ match: 'timeline.', owner: '@dv/ui-timeline' })
    expect(rows.getSnapshot()).not.toBe(empty)
    expect(rows.getSnapshot().map(row => row.match)).toEqual(['story.approve', 'timeline.'])
    expect(rows.getSnapshot()).toBe(rows.getSnapshot())
  })

  it('refuses a key that another descriptor holds, naming the owner of that descriptor', () => {
    const rows = rowRegistry()
    rows.register({ match: 'story.approve', owner: '@dv/ui-workflow-story' })
    expect(() => rows.register({ match: 'story.approve', owner: '@dv/ui-other' }))
      .toThrow('registry key "story.approve" is already registered by @dv/ui-workflow-story')
    expect(rows.getSnapshot().map(row => row.owner)).toEqual(['@dv/ui-workflow-story'])
  })

  it('removes a descriptor on disposal, once, and frees its key', () => {
    const rows = rowRegistry()
    const listener = vi.fn()
    const unsubscribe = rows.subscribe(listener)
    const dispose = rows.register({ match: 'story.approve', owner: '@dv/ui-workflow-story' })
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    dispose()
    expect(rows.getSnapshot()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    rows.register({ match: 'story.approve', owner: '@dv/ui-other' })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(rows.getSnapshot()).toHaveLength(1)
  })
})
