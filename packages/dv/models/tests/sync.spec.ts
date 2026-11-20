/** The shared model-sync helpers against a fake plugin context: alias rule, group reconciliation, and both Loader wirings. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  assertModelAlias, createModelEntryRegistry, formatModelKey, syncModelEntries, syncModelEntriesAsync,
  type ModelEntry, type ModelGroup, type ModelSyncOutcome, type ModelSyncResult,
} from '../src/index.ts'

const entry = (model: string, task: 't2v' | 'i2v' = 't2v'): ModelEntry => ({
  modality: 'video', task, provider: 'fake', hosting: 'self-hosted', model, description: model,
  facts: () => Promise.reject(new Error('unused')), schema: () => Promise.resolve({}),
  validateGenerationRequest: () => Promise.resolve([]), render: () => { throw new Error('unused') },
})

/** A catalog fake with the `get` and `register` of `dvModels`, so conflicts and duplicate keys behave as in production. */
function catalog() {
  const entries = new Map<string, ModelEntry>()
  return {
    entries,
    get: (key: Parameters<Context['dvModels']['get']>[0]) => entries.get(formatModelKey(key)),
    register: (item: ModelEntry) => {
      const key = formatModelKey(item)
      if (entries.has(key)) throw new Error(`duplicate ${key}`)
      entries.set(key, item)
      return () => { if (entries.get(key) === item) entries.delete(key) }
    },
  }
}

/** A plugin context that records its effects and its `loader/volatile-update` listeners, and unloads on `dispose`. */
function plugin() {
  const models = catalog()
  const disposers: Array<() => unknown> = []
  const listeners: Array<() => void> = []
  const ctx: Context = {
    dvModels: models,
    effect: (setup: () => () => unknown) => { disposers.push(setup()) },
    on: (_event: string, listener: () => void) => { listeners.push(listener) },
  } as never
  return {
    ctx, models, update: () => { for (const listener of listeners) listener() },
    dispose: async () => { for (const dispose of disposers) await dispose() },
    keys: () => [...models.entries.keys()],
  }
}

const group = (id: string, stamp = '1', ...models: string[]): ModelGroup => ({ id, stamp, entries: () => models.map(model => entry(model)) })

describe('assertModelAlias', () => {
  it('accepts lowercase letters, digits and hyphens up to 120 characters', () => {
    expect(() => { assertModelAlias('a', 'bad') }).not.toThrow()
    expect(() => { assertModelAlias('0-fast-h3', 'bad') }).not.toThrow()
    expect(() => { assertModelAlias('a'.repeat(120), 'bad') }).not.toThrow()
  })

  it.each(['', 'Upper', '-lead', 'a b', 'a/b', 'a'.repeat(121)])('refuses %j with the given message', (alias) => {
    expect(() => { assertModelAlias(alias, 'Use another alias.') }).toThrow('Use another alias.')
  })
})

describe('createModelEntryRegistry', () => {
  it('registers new groups, keeps equal stamps, replaces changed stamps and disposes absent groups', () => {
    const { models, keys } = plugin()
    const registry = createModelEntryRegistry(models, 'conflict')
    registry.replace([group('a', '1', 'one'), group('b', '1', 'two')])
    const first = models.entries.get('video/t2v/fake/one')
    registry.replace([group('a', '1', 'one'), group('b', '2', 'two-b')])
    expect(models.entries.get('video/t2v/fake/one')).toBe(first)
    expect(keys()).toEqual(['video/t2v/fake/one', 'video/t2v/fake/two-b'])
    registry.replace([group('b', '2', 'two-b')])
    expect(keys()).toEqual(['video/t2v/fake/two-b'])
  })

  it('builds entries only for new or changed groups', () => {
    const { models } = plugin()
    const registry = createModelEntryRegistry(models, 'conflict')
    let builds = 0
    const counted: ModelGroup = { id: 'a', stamp: '1', entries: () => { builds++; return [entry('one')] } }
    registry.replace([counted])
    registry.replace([counted])
    expect(builds).toBe(1)
  })

  it('refuses an entry that another plugin owns and changes nothing', () => {
    const { models, keys } = plugin()
    const registry = createModelEntryRegistry(models, 'Another plugin owns it.')
    registry.replace([group('a', '1', 'one')])
    models.register(entry('taken'))
    expect(() => { registry.replace([group('a', '2', 'one-b'), group('c', '1', 'taken')]) }).toThrow('Another plugin owns it.')
    expect(keys()).toEqual(['video/t2v/fake/one', 'video/t2v/fake/taken'])
  })

  it('replaces an entry with the same key in a changed group of its own', () => {
    const { models } = plugin()
    const registry = createModelEntryRegistry(models, 'conflict')
    registry.replace([group('a', '1', 'one')])
    const before = models.entries.get('video/t2v/fake/one')
    registry.replace([group('a', '2', 'one')])
    expect(models.entries.get('video/t2v/fake/one')).not.toBe(before)
  })

  it('clears every entry', () => {
    const { models, keys } = plugin()
    const registry = createModelEntryRegistry(models, 'conflict')
    registry.replace([group('a', '1', 'one'), group('b', '1', 'two')])
    registry.clear()
    expect(keys()).toEqual([])
  })
})

describe('syncModelEntries', () => {
  it('registers during the call, follows volatile updates, keeps entries on a refusal and disposes on unload', async () => {
    const harness = plugin()
    let desired: ModelGroup[] = [group('a', '1', 'one')]
    let refuse = false
    const sync = syncModelEntries(harness.ctx, { label: 'fake', conflict: 'conflict', groups: () => {
      if (refuse) throw new Error('bad configuration')
      return desired
    } })
    expect(harness.keys()).toEqual(['video/t2v/fake/one'])
    desired = [group('a', '1', 'one'), group('b', '1', 'two')]
    harness.update()
    expect(harness.keys()).toEqual(['video/t2v/fake/one', 'video/t2v/fake/two'])
    refuse = true
    expect(() => { sync() }).toThrow('bad configuration')
    expect(harness.keys()).toHaveLength(2)
    await harness.dispose()
    expect(harness.keys()).toEqual([])
  })

  it('fails the first call when the configuration is refused', () => {
    expect(() => syncModelEntries(plugin().ctx, { label: 'fake', conflict: 'c', groups: () => { throw new Error('refused') } })).toThrow('refused')
  })
})

describe('syncModelEntriesAsync', () => {
  /** A resolver whose result the test releases, so syncs can overlap. */
  function gate() {
    const waiting: Array<(result: ModelSyncResult) => void> = []
    const aborts: AbortSignal[] = []
    return {
      aborts, release: (result: ModelSyncResult) => { waiting.shift()?.(result) }, pending: () => waiting.length,
      resolve: (signal: AbortSignal) => { aborts.push(signal); return new Promise<ModelSyncResult>((done) => { waiting.push(done) }) },
    }
  }
  const complete = (...groups: ModelGroup[]): ModelSyncResult => ({ groups, unavailable: [] })

  it('skips a sync whose stamp equals the last complete one and records the outcome', async () => {
    const harness = plugin()
    const outcomes: ModelSyncOutcome[] = []
    let resolves = 0
    const { sync } = syncModelEntriesAsync(harness.ctx, { label: 'fake', conflict: 'c', stamp: () => 'same',
      resolve: () => { resolves++; return Promise.resolve(complete(group('a', '1', 'one'))) }, settled: (outcome) => { outcomes.push(outcome) } })
    await sync()
    await sync()
    expect(resolves).toBe(1)
    expect(outcomes).toEqual([{ ok: true, unavailable: [] }])
    expect(harness.keys()).toEqual(['video/t2v/fake/one'])
  })

  it('registers what is available, reports the rest, and retries on the next sync', async () => {
    const harness = plugin()
    const outcomes: ModelSyncOutcome[] = []
    let missing = true
    const { sync } = syncModelEntriesAsync(harness.ctx, { label: 'fake', conflict: 'c', stamp: () => 'same',
      resolve: () => Promise.resolve(missing ? { groups: [group('a', '1', 'one')], unavailable: ['two is gone.'] }
        : complete(group('a', '1', 'one'), group('b', '1', 'two'))),
      settled: (outcome) => { outcomes.push(outcome) } })
    await sync()
    expect(outcomes.at(-1)).toEqual({ ok: true, unavailable: ['two is gone.'] })
    missing = false
    await sync()
    expect(harness.keys()).toEqual(['video/t2v/fake/one', 'video/t2v/fake/two'])
    expect(outcomes.at(-1)).toEqual({ ok: true, unavailable: [] })
  })

  it('disposes every entry when a sync fails, rethrows to a direct caller and swallows it on a volatile update', async () => {
    const harness = plugin()
    const outcomes: ModelSyncOutcome[] = []
    let failure: Error | null = null
    let stamp = '1'
    const { sync } = syncModelEntriesAsync(harness.ctx, { label: 'fake', conflict: 'c', stamp: () => stamp,
      resolve: () => failure === null ? Promise.resolve(complete(group('a', '1', 'one'))) : Promise.reject(failure),
      settled: (outcome) => { outcomes.push(outcome) } })
    await sync()
    failure = new Error('offline')
    stamp = '2'
    harness.update()
    await new Promise<void>((done) => { setTimeout(done, 0) })
    expect(harness.keys()).toEqual([])
    expect(outcomes.at(-1)).toMatchObject({ ok: false })
    stamp = '3'
    await expect(sync()).rejects.toThrow('offline')
  })

  it('reports a conflict with another plugin as a failure', async () => {
    const harness = plugin()
    harness.models.register(entry('one'))
    const { sync } = syncModelEntriesAsync(harness.ctx, { label: 'fake', conflict: 'Another plugin owns it.', stamp: () => '1',
      resolve: () => Promise.resolve(complete(group('a', '1', 'one'))) })
    await expect(sync()).rejects.toThrow('Another plugin owns it.')
    expect(harness.models.entries.get('video/t2v/fake/one')?.description).toBe('one')
    expect(harness.keys()).toHaveLength(1)
  })

  it('drops the result of a sync that a newer sync superseded', async () => {
    const harness = plugin()
    const resolver = gate()
    const outcomes: ModelSyncOutcome[] = []
    let stamp = '1'
    const { sync } = syncModelEntriesAsync(harness.ctx, { label: 'fake', conflict: 'c', stamp: () => stamp, resolve: resolver.resolve,
      settled: (outcome) => { outcomes.push(outcome) } })
    const older = sync()
    stamp = '2'
    const newer = sync()
    resolver.release(complete(group('a', '1', 'stale')))
    resolver.release(complete(group('a', '1', 'fresh')))
    await Promise.all([older, newer])
    expect(harness.keys()).toEqual(['video/t2v/fake/fresh'])
    expect(outcomes).toHaveLength(1)
  })

  it('drops a failure that a newer sync superseded', async () => {
    const harness = plugin()
    const outcomes: ModelSyncOutcome[] = []
    let stamp = '1'
    let calls = 0
    const { sync } = syncModelEntriesAsync(harness.ctx, { label: 'fake', conflict: 'c', stamp: () => stamp,
      resolve: async () => {
        if (calls++ === 0) { await Promise.resolve(); throw new Error('stale failure') }
        return complete(group('a', '1', 'one'))
      }, settled: (outcome) => { outcomes.push(outcome) } })
    const older = sync()
    stamp = '2'
    const newer = sync()
    await expect(older).rejects.toThrow('stale failure')
    await newer
    expect(harness.keys()).toEqual(['video/t2v/fake/one'])
    expect(outcomes).toEqual([{ ok: true, unavailable: [] }])
  })

  it('aborts the signal, waits for running syncs and disposes every entry on unload', async () => {
    const harness = plugin()
    const resolver = gate()
    const { sync } = syncModelEntriesAsync(harness.ctx, { label: 'fake', conflict: 'c', stamp: () => '1', resolve: resolver.resolve })
    const running = sync()
    const unloading = harness.dispose()
    expect(resolver.aborts[0]?.aborted).toBe(true)
    resolver.release(complete(group('a', '1', 'late')))
    await Promise.all([running, unloading])
    expect(harness.keys()).toEqual([])
  })
})
