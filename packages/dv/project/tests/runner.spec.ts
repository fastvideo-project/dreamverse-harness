/**
 * Tests of the operation runner: recorded runs, refusals before any write, failures, deterministic reuse, read-only
 * operations, the lock scope during execution, and the recovery of records an earlier process left unfinished.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectModules } from './support.ts'
import { agentOrigin, createTestProject, readLines, startModules, userOrigin } from './support.ts'
import type { OperationSpec } from '../src/operation-types.ts'
import { RecordStore } from '../src/record-store.ts'
import { projReducer, ReducerRegistry } from '../src/reducers.ts'
import { Runner } from '../src/runner.ts'
import { Scheduler } from '../src/scheduler.ts'
import type {
  AssetId, ProjectId, ProjectRecord, RecordId, RecordOrigin, RunRequest,
} from '../src/types.ts'

/**
 * An operation spec with test defaults: one optional `prompt` and `seed` parameter, the `reference` input role, not
 * deterministic, unlimited resource, and an execute function that creates nothing.
 * @param overrides - the fields to set; `name` and `component` are required.
 * @returns the spec.
 */
function operation(overrides: Partial<OperationSpec> & Pick<OperationSpec, 'name' | 'component'>): OperationSpec {
  return {
    version: '1', params: { prompt: { type: 'string' }, seed: { type: 'integer' } },
    inputs: { reference: { type: 'image', description: 'A reference.', many: true } }, outputs: [], description: 'A test operation.',
    summarize: () => 'ran', deterministic: false, resource: 'none', execute: () => Promise.resolve({ outputs: [] }), ...overrides,
  }
}

/**
 * A run request with test defaults.
 * @param project - the project.
 * @param name - the operation name.
 * @param origin - who runs it.
 * @param extra - other request fields.
 * @returns the request.
 */
function request(project: ProjectId, name: string, origin: RecordOrigin = userOrigin(), extra: Partial<RunRequest> = {}): RunRequest {
  return { project, operation: name, params: { prompt: 'a red kite' }, inputs: [], ...origin, ...extra }
}

/** @returns a promise with its resolve function, for holding an execute or an approval until the test releases it. */
function gate<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/**
 * @param m - the modules.
 * @param project - the project.
 * @returns the text of the project's `records.jsonl`.
 */
function files(m: ProjectModules, project: ProjectId): string {
  return readFileSync(join(m.root, project, '.dreamverse', 'records.jsonl'), 'utf8')
}

/**
 * @param m - the modules.
 * @param project - the project.
 * @param name - an operation name.
 * @returns the project's records of that operation, in write order.
 */
function recordsOf(m: ProjectModules, project: ProjectId, name: string): ProjectRecord[] {
  return m.store.listRecords(project).filter(record => record.operation === name)
}

describe('Runner', () => {
  it('runs an operation and records its outputs', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    m.runner.registerOperation(operation({
      name: 'shot.render', component: 'shot', resource: 'gpu',
      execute: async (context) => {
        await new Promise(resolve => setTimeout(resolve, 20))
        const take = context.importAsset(Buffer.from('take of a red kite'), { mime: 'video/mp4', name: 'take.mp4', durationSec: 2 })
        return { outputs: [take], report: { seed: 7 } }
      },
    }))

    const result = await m.runner.run(request(project, 'shot.render'))

    const record = result.record
    expect(record?.status).toBe('done')
    expect(record?.outputs).toHaveLength(1)
    expect(result.outputs).toEqual(record?.outputs)
    expect(result.report).toEqual({ seed: 7 })
    expect(record?.report).toEqual({ seed: 7 })
    expect(record?.cost?.reused).toBe(false)
    expect(record?.cost?.wall_seconds).toBeGreaterThan(0)
    expect(m.assets.created.get(record?.outputs[0] as AssetId)).toBe(record?.id)
    const lines = readLines(m.root, project).filter(line => line['id'] === record?.id || line['update'] === record?.id)
    expect(lines.map(line => line['status'])).toEqual(['pending', 'running', 'done'])
  })

  it('adds the records an operation replaces to the record\'s supersedes', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    m.runner.registerOperation(operation({ name: 'timeline.clip_insert', component: 'timeline' }))
    const first = (await m.runner.run(request(project, 'timeline.clip_insert'))).record!
    const second = (await m.runner.run(request(project, 'timeline.clip_insert'))).record!
    const seen: string[] = []
    // The spec replaces the head of the state it is given, which is the project's state before the call.
    m.runner.registerOperation(operation({
      name: 'bible.character_update', component: 'bible',
      supersedes: (params, state) => {
        seen.push(String(params.prompt))
        return [state.head]
      },
    }))
    const update = await m.runner.run(request(project, 'bible.character_update', userOrigin(), { supersedes: [first.id, second.id] }))
    expect(seen).toEqual(['a red kite'])
    expect(update.record?.supersedes).toEqual([first.id, second.id])
    const next = await m.runner.run(request(project, 'bible.character_update'))
    expect(next.record?.supersedes).toEqual([update.record?.id])
  })

  it('copies started_by from the request onto the record of a run or a scheduled run', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    m.runner.registerOperation(operation({ name: 'timeline.clip_insert', component: 'timeline' }))
    const starter = (await m.runner.run(request(project, 'timeline.clip_insert'))).record!
    const startedBy = { record: starter.id, slot: 1, lane: 'wide' }

    const now = await m.runner.run(request(project, 'timeline.clip_insert', userOrigin(), { started_by: startedBy }))
    const scheduled = { started_by: { record: starter.id, slot: null }, after: [] }
    const later = await m.runner.run(request(project, 'timeline.clip_insert', userOrigin(), scheduled))

    expect(starter).not.toHaveProperty('started_by')
    expect(now.record?.started_by).toEqual(startedBy)
    expect(later.record?.started_by).toEqual({ record: starter.id, slot: null })
    expect(readLines(m.root, project).find(line => line['id'] === now.record?.id)?.['started_by']).toEqual(startedBy)
    await vi.waitFor(() => { expect(m.store.getRecord(project, later.record!.id).status).toBe('done') })
  })

  it('refuses invalid params, unknown inputs and unfinished inputs before writing', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    const held = gate()
    m.runner.registerOperation(operation({
      name: 'shot.render', component: 'shot',
      execute: async (context) => {
        await held.promise
        return { outputs: [context.importAsset(Buffer.from('take'), { mime: 'video/mp4', name: 'take.mp4' })] }
      },
    }))
    const running = m.runner.run(request(project, 'shot.render'))
    await vi.waitFor(() => { expect(recordsOf(m, project, 'shot.render')[0]?.status).toBe('running') })
    const producer = recordsOf(m, project, 'shot.render')[0] as ProjectRecord
    const before = files(m, project)
    const eventCount = m.events.length

    // Agent calls are refused the same way.
    const agent = agentOrigin()
    const refusals: Array<[Partial<RunRequest>, string]> = [
      [{ params: { prompt: 5 } }, 'invalid_params'],
      [{ inputs: [{ role: 'mask', ref: { asset: m.assets.add('mask') } }] }, 'invalid_inputs'],
      [{ inputs: [{ role: 'reference', ref: { asset: brandString<AssetId>('no-such-asset') } }] }, 'unknown_asset'],
      [{ inputs: [{ role: 'reference', ref: { record: producer.id, output: 0 } }] }, 'input_not_ready'],
    ]
    for (const [extra, code] of refusals) {
      await expect(m.runner.run(request(project, 'shot.render', agent, extra))).rejects.toMatchObject({ code })
    }
    await expect(m.runner.run(request(project, 'unregistered', agent))).rejects.toMatchObject({ code: 'unknown_operation' })

    expect(files(m, project)).toBe(before)
    expect(m.events).toHaveLength(eventCount)
    held.resolve()
    expect((await running).record?.status).toBe('done')
  })

  it('refuses a call that the operation\'s precondition refuses, before writing', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    const seen: string[] = []
    const precondition = (call: RunRequest, state: { head: string }): Promise<void> => {
      seen.push(state.head)
      return call.params['prompt'] === 'refuse' ? Promise.reject(new Error('This shot has no reference image.')) : Promise.resolve()
    }
    m.runner.registerOperation(operation({ name: 'shot.render', component: 'shot', precondition }))
    m.runner.registerOperation(operation({ name: 'inspect.image', component: 'inspect', readOnly: true, precondition }))
    const before = files(m, project)
    const head = m.store.line(project)?.at
    const eventCount = m.events.length

    // An agent call that is refused writes nothing; a read-only call is refused the same way.
    for (const name of ['shot.render', 'inspect.image']) {
      await expect(m.runner.run(request(project, name, agentOrigin(), { params: { prompt: 'refuse' } })))
        .rejects.toThrow('This shot has no reference image.')
    }
    expect(files(m, project)).toBe(before)
    expect(m.events).toHaveLength(eventCount)
    expect(seen).toEqual([head, head])
    expect((await m.runner.run(request(project, 'shot.render'))).record?.status).toBe('done')
  })

  it('checks a call with the sentence that run refuses it with, writing nothing', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    m.runner.registerOperation(operation({
      name: 'shot.render', component: 'shot',
      precondition: call => call.params['prompt'] === 'refuse' ? Promise.reject(new Error('This shot has no reference image.')) : Promise.resolve(),
    }))
    const before = files(m, project)
    const calls: Array<Partial<RunRequest>> = [
      { params: { prompt: 5 } },
      { inputs: [{ role: 'mask', ref: { asset: m.assets.add('mask') } }] },
      { inputs: [{ role: 'reference', ref: { asset: brandString<AssetId>('no-such-asset') } }] },
      { params: { prompt: 'refuse' } },
    ]
    for (const extra of calls) {
      const refusal = await m.runner.run(request(project, 'shot.render', userOrigin(), extra)).then(() => '', (error: unknown) => (error as Error).message)
      expect(refusal).not.toBe('')
      expect(await m.runner.check(request(project, 'shot.render', userOrigin(), extra))).toEqual({ problems: [refusal] })
    }
    expect(await m.runner.check(request(project, 'unregistered'))).toEqual({ problems: ['Operation unregistered is not registered.'] })
    expect(await m.runner.check(request(project, 'shot.render', userOrigin(), { params: { prompt: 'a kite', seed: 2 } })))
      .toEqual({ problems: [] })
    expect(files(m, project)).toBe(before)
  })

  it('refuses a read whose input names a record that has not finished, even with after, and runs nothing', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    const held = gate()
    m.runner.registerOperation(operation({
      name: 'shot.render', component: 'shot',
      execute: async (context) => {
        await held.promise
        return { outputs: [context.importAsset(Buffer.from('take'), { mime: 'video/mp4', name: 'take.mp4' })] }
      },
    }))
    const read = vi.fn(() => Promise.resolve({ outputs: [] }))
    m.runner.registerOperation(operation({ name: 'inspect.image', component: 'inspect', readOnly: true, execute: read }))
    const running = m.runner.run(request(project, 'shot.render'))
    await vi.waitFor(() => { expect(recordsOf(m, project, 'shot.render')[0]?.status).toBe('running') })
    const producer = recordsOf(m, project, 'shot.render')[0] as ProjectRecord
    const call = request(project, 'inspect.image', userOrigin(), { inputs: [{ role: 'reference', ref: { record: producer.id, output: 0 } }], after: [] })
    await expect(m.runner.run(call)).rejects.toMatchObject({ code: 'input_not_ready' })
    expect([read.mock.calls.length, (await m.runner.check(call)).problems]).toEqual([0, [expect.stringContaining(producer.id)]])
    held.resolve()
    await running
  })

  it('fails the record when execute throws', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    m.runner.registerOperation(operation({
      name: 'shot.render', component: 'shot', execute: () => Promise.reject(new Error('The renderer ran out of memory.')),
    }))

    const result = await m.runner.run(request(project, 'shot.render'))

    expect(result.record).toMatchObject({
      status: 'failed', error: { code: 'operation_failed', message: 'The renderer ran out of memory.' },
    })
    expect(result.outputs).toEqual([])
    expect(m.store.getRecord(project, result.record?.id as ProjectRecord['id']).finished_at).toBeDefined()
  })

  it('reuses outputs of an identical deterministic call', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    let calls = 0
    m.runner.registerOperation(operation({
      name: 'asset.grab_still', component: 'asset', deterministic: true,
      execute: (context) => {
        calls += 1
        const still = context.importAsset(Buffer.from(`still ${String(calls)}`), { mime: 'image/png', name: 'still.png' })
        return Promise.resolve({ outputs: [still] })
      },
    }))
    const video = m.assets.add('a video')
    const inputs: RunRequest['inputs'] = [{ role: 'reference', ref: { asset: video } }]

    const first = await m.runner.run(request(project, 'asset.grab_still', userOrigin(), { params: { prompt: 'frame', seed: 1 }, inputs }))
    const second = await m.runner.run(request(project, 'asset.grab_still', userOrigin(), { params: { seed: 1, prompt: 'frame' }, inputs }))

    expect(calls).toBe(1)
    expect(second.record).toMatchObject({ status: 'done', cost: { wall_seconds: 0, reused: true } })
    expect(second.outputs).toEqual(first.outputs)
    expect(second.record?.started_at).toBeUndefined()
  })

  it('writes no record for a read-only operation', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    const seen: Array<ProjectRecord | null> = []
    m.runner.registerOperation(operation({
      name: 'inspect.image', component: 'inspect', readOnly: true,
      execute: (context) => {
        seen.push(context.record)
        return Promise.resolve({ outputs: [], report: { caption: 'a red kite over a beach' } })
      },
    }))
    const before = files(m, project)

    const result = await m.runner.run(request(project, 'inspect.image', agentOrigin(), {
      inputs: [{ role: 'reference', ref: { asset: m.assets.add('an image') } }],
    }))

    expect(result).toEqual({ record: null, outputs: [], report: { caption: 'a red kite over a beach' } })
    expect(seen).toEqual([null])
    expect(files(m, project)).toBe(before)
  })

  it('registers an operation only after a plugin registers its component', () => {
    const m = startModules()
    expect(() => m.runner.registerOperation(operation({ name: 'image.generate', component: 'image' })))
      .toThrow(expect.objectContaining({ code: 'invalid_params' }))
    const disposeComponent = m.runner.registerComponent('image')
    expect(() => m.runner.registerComponent('image')).toThrow(expect.objectContaining({ code: 'component_exists' }))
    m.runner.registerOperation(operation({ name: 'image.generate', component: 'image' }))
    expect(m.runner.listOperations().map(spec => spec.name)).toEqual(['image.generate'])
    disposeComponent()
    m.runner.registerComponent('image')
  })

  it('refuses a second operation with a registered name until the first one is removed', () => {
    const m = startModules()
    const dispose = m.runner.registerOperation(operation({ name: 'shot.render', component: 'shot' }))
    expect(() => m.runner.registerOperation(operation({ name: 'shot.render', component: 'shot' })))
      .toThrow(expect.objectContaining({ code: 'operation_exists' }))
    dispose()
    m.runner.registerOperation(operation({ name: 'shot.render', component: 'shot' }))
    expect(m.runner.listOperations().map(spec => spec.name)).toEqual(['shot.render'])
  })

  it('refuses an operation whose name does not start with its component key', () => {
    const m = startModules()
    expect(() => m.runner.registerOperation(operation({ name: 'timeline.create', component: 'inspect' })))
      .toThrow(expect.objectContaining({ code: 'invalid_params' }))
    expect(() => m.runner.registerOperation(operation({ name: 'shot', component: 'shot' })))
      .toThrow(expect.objectContaining({ code: 'invalid_params' }))
    expect(m.runner.listOperations()).toEqual([])
  })

  it('lets other edits run while a render executes', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    const held = gate()
    m.runner.registerOperation(operation({
      name: 'shot.render', component: 'shot', resource: 'gpu',
      execute: async () => {
        await held.promise
        return { outputs: [] }
      },
    }))
    m.runner.registerOperation(operation({ name: 'timeline.clip_insert', component: 'timeline' }))

    const render = m.runner.run(request(project, 'shot.render'))
    await vi.waitFor(() => { expect(recordsOf(m, project, 'shot.render')[0]?.status).toBe('running') })
    const edit = await m.runner.run(request(project, 'timeline.clip_insert'))

    expect(edit.record?.status).toBe('done')
    expect(recordsOf(m, project, 'shot.render')[0]?.status).toBe('running')
    held.resolve()
    expect((await render).record?.status).toBe('done')
  })

  it('loads a stored log whose operations and reference kind have no owner, and refuses a new call with that version', async () => {
    const m = startModules()
    // The stored shapes of real logs: an old render name that no operation has, a `deliver.timeline_export` record whose
    // component no plugin registers, and an input `{character, version}` of a reference kind that no plugin registers.
    const project = brandString<ProjectId>('stored-project')
    const face = m.assets.add('face')
    const take = m.assets.add('take')
    const origin = { ...userOrigin(), operation_version: '1', based_on: null, supersedes: [], deterministic: false, status: 'done' }
    const lines = [
      { ...origin, id: 'r1', parents: [], kind: 'operation', component: 'proj', operation: 'proj.create', params: { title: 'Old' },
        inputs: [], outputs: [], created_at: '2026-10-07T23:40:00.000Z' },
      { ...origin, id: 'r2', parents: ['r1'], kind: 'operation', component: 'shot', operation: 'shot.render_ref2va',
        params: { prompt: 'dance' }, outputs: [take], created_at: '2026-10-07T23:41:00.000Z',
        inputs: [{ role: 'reference', ref: { character: 'c1', version: 1 }, resolved_asset: face }] },
      { ...origin, id: 'r3', parents: ['r2'], kind: 'operation', component: 'deliver', operation: 'deliver.timeline_export',
        params: { timeline: 't1' }, inputs: [], outputs: [], created_at: '2026-10-07T23:42:00.000Z' },
    ]
    mkdirSync(join(m.root, project, '.dreamverse'), { recursive: true })
    writeFileSync(join(m.root, project, '.dreamverse', 'records.jsonl'), lines.map(line => `${JSON.stringify(line)}\n`).join(''))
    m.folders.add(project, 'Old')

    // Replay passes every record through the registered reducers only; the unowned version is no producer.
    const proj = m.reducers.getState(project).components.proj
    expect(proj.records.map(record => record.operation)).toEqual(['proj.create', 'shot.render_ref2va', 'deliver.timeline_export'])
    expect(proj.stale).toEqual({})
    m.runner.registerOperation(operation({ name: 'shot.render', component: 'shot' }))
    // The new call reads the stored `{character, version}` reference of the old render.
    const reads = { inputs: [{ role: 'reference', ref: proj.records[1]!.inputs[0]!.ref }] }
    await expect(m.runner.run(request(project, 'shot.render', userOrigin(), reads))).rejects.toMatchObject({ code: 'invalid_inputs' })
    expect(recordsOf(m, project, 'shot.render')).toEqual([])
  })

  it('ends unfinished records at start', async () => {
    const m = startModules()
    const project = await createTestProject(m)
    // An earlier process wrote one pending and one running record, then stopped.
    const unfinished = await m.store.lock(project, () => ['pending', 'running'].map((status) => {
      const head = m.store.line(project)!.at
      const record = m.store.append(project, {
        parents: [head], kind: 'operation', component: 'shot', operation: 'shot.render', operation_version: '1',
        ...userOrigin(), params: {}, inputs: [], outputs: [], based_on: null, supersedes: [], deterministic: false, status: 'pending',
      })
      return status === 'running' ? m.store.update(project, { update: record.id, status: 'running' }) : record
    }))

    // A new process loads the same root and recovers.
    const store = new RecordStore(m.folders, () => undefined)
    const reducers = new ReducerRegistry(store)
    const holder: { runner: Runner | null } = { runner: null }
    const scheduler = new Scheduler(store, (id, record) => (holder.runner as Runner).execute(id, record), { cpu: 1, gpu: 1 })
    holder.runner = new Runner({ store, reducers, scheduler, assets: m.assets })
    reducers.register('proj', projReducer)
    await holder.runner.recover()
    scheduler.dispose()

    for (const record of unfinished) {
      expect(store.getRecord(project, record.id)).toMatchObject({
        status: 'cancelled', error: { code: 'stopped', message: 'The server stopped before the call finished.' },
      })
    }
    expect(readLines(m.root, project).filter(line => line['status'] === 'cancelled')).toHaveLength(2)
  })

  describe('cancel', () => {
    /** A render that ends only when its signal aborts; `started` lists the prompts that began executing. */
    function slowRender(started: string[]): OperationSpec {
      return operation({
        name: 'shot.render', component: 'shot', resource: 'gpu',
        execute: async (context) => {
          started.push(String(context.params['prompt']))
          await new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
          })
          return { outputs: [] }
        },
      })
    }

    it('aborts a running record and resolves with it cancelled', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const started: string[] = []
      m.runner.registerOperation(slowRender(started))
      const running = m.runner.run(request(project, 'shot.render'))
      await expect.poll(() => started).toEqual(['a red kite'])
      const id = recordsOf(m, project, 'shot.render')[0]!.id

      const cancelled = await m.runner.cancel(project, id)

      expect(cancelled).toMatchObject({ id, status: 'cancelled', error: { code: 'cancelled', message: 'Cancelled before it finished.' } })
      expect((await running).record).toMatchObject({ id, status: 'cancelled', error: { code: 'cancelled' } })
    })

    it('takes a queued record out of the queue so that it never executes', async () => {
      const m = startModules({ cpu: 4, gpu: 1 })
      const project = await createTestProject(m)
      const started: string[] = []
      m.runner.registerOperation(slowRender(started))
      const first = (await m.runner.run(request(project, 'shot.render', userOrigin(), { after: [], params: { prompt: 'first' } }))).record!
      const second = (await m.runner.run(request(project, 'shot.render', userOrigin(), { after: [], params: { prompt: 'second' } }))).record!
      await expect.poll(() => started).toEqual(['first'])
      expect(m.store.getRecord(project, second.id).status).toBe('pending')

      const cancelled = await m.runner.cancel(project, second.id)
      expect(cancelled).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } })

      await m.runner.cancel(project, first.id)
      await m.scheduler.wait(project)
      expect(started).toEqual(['first'])
      expect(m.store.getRecord(project, first.id)).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } })
    })

    it('ends a pending record that has not started executing as soon as it starts', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const started: string[] = []
      m.runner.registerOperation(slowRender(started))
      const pending = await m.store.lock(project, () => m.store.append(project, {
        parents: [m.store.line(project)!.at], kind: 'operation', component: 'shot', operation: 'shot.render', operation_version: '1',
        ...userOrigin(), params: { prompt: 'late' }, inputs: [], outputs: [], based_on: null, supersedes: [], deterministic: false,
        status: 'pending',
      }))

      const waiting = m.runner.cancel(project, pending.id)
      // Let the cancel take the project lock and remember the record before the record starts.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
      const ended = await m.runner.execute(project, pending.id)
      await waiting

      expect(ended).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } })
      expect(started).toEqual([])
    })

    it('fails a record that waits on the cancelled record through an input with input_failed', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const started: string[] = []
      m.runner.registerOperation(slowRender(started))
      const a = (await m.runner.run(request(project, 'shot.render', userOrigin(), { after: [], params: { prompt: 'A' } }))).record!
      await expect.poll(() => started).toEqual(['A'])
      const dependent = await m.runner.run(request(project, 'shot.render', userOrigin(), {
        after: [], params: { prompt: 'B' }, inputs: [{ role: 'reference', ref: { record: a.id, output: 0 } }],
      }))

      await m.runner.cancel(project, a.id)
      await m.scheduler.wait(project)

      expect(m.store.getRecord(project, dependent.record!.id)).toMatchObject({ status: 'failed', error: { code: 'input_failed' } })
      expect(started).toEqual(['A'])
    })

    it('refuses a record that already ended, and an unknown record', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      m.runner.registerOperation(operation({ name: 'shot.render', component: 'shot' }))
      const done = (await m.runner.run(request(project, 'shot.render'))).record!
      expect(done.status).toBe('done')

      await expect(m.runner.cancel(project, done.id)).rejects.toMatchObject({
        code: 'not_running', message: `Record ${done.id} already ended done.`,
      })
      await expect(m.runner.cancel(project, brandString<RecordId>('missing'))).rejects.toMatchObject({ code: 'unknown_record' })
      expect(m.store.getRecord(project, done.id).status).toBe('done')
    })
  })

  describe('retry', () => {
    /** A render that imports one take, and throws for each prompt in `broken`; `ran` lists the prompts that executed. */
    function setup(m: ProjectModules, broken: Set<string>, ran: string[]): void {
      m.runner.registerOperation(operation({
        name: 'shot.render', component: 'shot',
        execute: (context) => {
          const prompt = String(context.params['prompt'])
          ran.push(prompt)
          if (broken.has(prompt)) return Promise.reject(new Error(`${prompt} ran out of memory.`))
          return Promise.resolve({ outputs: [context.importAsset(Buffer.from(prompt), { mime: 'video/mp4', name: 'take.mp4' })] })
        },
      }))
    }

    /** Schedule a render named `prompt`, reading output 0 of each record in `reads`. */
    async function render(m: ProjectModules, project: ProjectId, prompt: string, reads: ProjectRecord[] = []): Promise<ProjectRecord> {
      const result = await m.runner.run(request(project, 'shot.render', userOrigin(), {
        params: { prompt }, after: [], inputs: reads.map(read => ({ role: 'reference', ref: { record: read.id, output: 0 } })),
      }))
      return result.record!
    }

    const RETRYER = userOrigin({ intent: 'retry from History' })

    it('re-runs a failed record and the records that failed only because of it, each reading the new producer', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const broken = new Set(['A'])
      const ran: string[] = []
      setup(m, broken, ran)
      const a = await render(m, project, 'A')
      const b = await render(m, project, 'B', [a])
      const c = await render(m, project, 'C', [b])
      await m.scheduler.wait(project)
      expect(m.store.getRecord(project, a.id)).toMatchObject({ status: 'failed', error: { code: 'operation_failed' } })
      for (const dependent of [b, c]) expect(m.store.getRecord(project, dependent.id)).toMatchObject({ status: 'failed', error: { code: 'input_failed' } })
      expect(ran).toEqual(['A'])

      broken.clear()
      const created = await m.runner.retry(project, a.id, RETRYER)
      expect(created.map(record => [record.params['prompt'], record.based_on, record.status, record.intent])).toEqual([
        ['A', a.id, 'pending', 'retry from History'], ['B', b.id, 'pending', 'retry from History'], ['C', c.id, 'pending', 'retry from History'],
      ])
      const [a2, b2, c2] = created as [ProjectRecord, ProjectRecord, ProjectRecord]
      expect(b2.inputs.map(input => input.ref)).toEqual([{ record: a2.id, output: 0 }])
      expect(c2.inputs.map(input => input.ref)).toEqual([{ record: b2.id, output: 0 }])

      await m.scheduler.wait(project)
      for (const record of created) expect(m.store.getRecord(project, record.id).status).toBe('done')
      expect(m.store.getRecord(project, b2.id).inputs[0]?.resolved_asset).toBe(m.store.getRecord(project, a2.id).outputs[0])
      expect(ran).toEqual(['A', 'A', 'B', 'C'])
      // The failed originals stay as they were.
      expect(m.store.getRecord(project, b.id)).toMatchObject({ status: 'failed', error: { code: 'input_failed' } })
    })

    it('re-runs a failed record that has no dependents as one record, and leaves an unrelated failure alone', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const broken = new Set(['X', 'Y'])
      setup(m, broken, [])
      const x = await render(m, project, 'X')
      const y = await render(m, project, 'Y')
      await m.scheduler.wait(project)

      broken.delete('X')
      const created = await m.runner.retry(project, x.id, RETRYER)
      await m.scheduler.wait(project)

      expect(created).toHaveLength(1)
      expect(m.store.getRecord(project, created[0]!.id)).toMatchObject({ status: 'done', based_on: x.id, params: { prompt: 'X' } })
      expect(recordsOf(m, project, 'shot.render').filter(record => record.params['prompt'] === 'Y').map(record => record.id)).toEqual([y.id])
    })

    it('does not re-run a dependent that failed for its own reason, or anything downstream of it', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const broken = new Set(['A'])
      setup(m, broken, [])
      const a = await render(m, project, 'A')
      const b = await render(m, project, 'B', [a])
      await m.scheduler.wait(project)
      // `own` read A and then failed in its execute; `downstream` read `own` and failed with input_failed.
      const own = await m.store.lock(project, () => {
        const record = m.store.append(project, {
          parents: [m.store.line(project)!.at], kind: 'operation', component: 'shot', operation: 'shot.render', operation_version: '1',
          ...userOrigin(), params: { prompt: 'own' }, inputs: [{ role: 'reference', ref: { record: a.id, output: 0 }, resolved_asset: null }],
          outputs: [], based_on: null, supersedes: [], deterministic: false, status: 'pending',
        })
        return m.store.update(project, { update: record.id, status: 'failed', finished_at: new Date().toISOString(), error: { code: 'operation_failed', message: 'own failure' } })
      })
      const downstream = await m.store.lock(project, () => {
        const record = m.store.append(project, {
          parents: [m.store.line(project)!.at], kind: 'operation', component: 'shot', operation: 'shot.render', operation_version: '1',
          ...userOrigin(), params: { prompt: 'downstream' }, inputs: [{ role: 'reference', ref: { record: own.id, output: 0 }, resolved_asset: null }],
          outputs: [], based_on: null, supersedes: [], deterministic: false, status: 'pending',
        })
        return m.store.update(project, { update: record.id, status: 'failed', finished_at: new Date().toISOString(), error: { code: 'input_failed', message: 'upstream' } })
      })

      broken.clear()
      const created = await m.runner.retry(project, a.id, RETRYER)
      await m.scheduler.wait(project)

      expect(created.map(record => record.params['prompt'])).toEqual(['A', 'B'])
      expect(created.map(record => record.based_on)).toEqual([a.id, b.id])
      const prompts = recordsOf(m, project, 'shot.render').map(record => record.params['prompt'])
      expect(prompts.filter(prompt => prompt === 'own' || prompt === 'downstream')).toEqual(['own', 'downstream'])
      expect(m.store.getRecord(project, own.id).status).toBe('failed')
      expect(m.store.getRecord(project, downstream.id).status).toBe('failed')
    })

    it('does not re-run a dependent that a later step discarded', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const broken = new Set(['A'])
      setup(m, broken, [])
      const a = await render(m, project, 'A')
      const b = await render(m, project, 'B', [a])
      await m.scheduler.wait(project)
      // Moving back to A and writing a new step takes B out of the history list.
      await m.store.lock(project, () => m.history.moveTo(project, a.id))
      await m.runner.run(request(project, 'shot.render', userOrigin(), { params: { prompt: 'fresh' } }))
      expect(m.history.list({ project }).map(entry => entry.record.id)).not.toContain(b.id)

      broken.clear()
      const created = await m.runner.retry(project, a.id, RETRYER)

      expect(created.map(record => record.params['prompt'])).toEqual(['A'])
    })

    it('skips an in-history record that has no operation or no error, and one that reads nothing of the chain', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const broken = new Set(['A'])
      setup(m, broken, [])
      const a = await render(m, project, 'A')
      await m.scheduler.wait(project)
      const written = await m.store.lock(project, () => ['none', 'noerror', 'assetonly'].map((kind) => {
        const record = m.store.append(project, {
          parents: [m.store.line(project)!.at], kind: 'operation', component: 'shot', operation: kind === 'none' ? null : 'shot.render',
          operation_version: '1', ...userOrigin(), params: { prompt: kind },
          inputs: [{ role: 'reference', ref: kind === 'assetonly' ? { asset: m.assets.importAsset(project, Buffer.from('x'), { mime: 'image/png', name: 'x.png' }, null) } : { record: a.id, output: 0 }, resolved_asset: null }],
          outputs: [], based_on: null, supersedes: [], deterministic: false, status: 'pending',
        })
        return m.store.update(project, {
          update: record.id, status: 'failed', finished_at: new Date().toISOString(),
          ...kind === 'noerror' ? {} : { error: { code: 'input_failed', message: 'upstream' } },
        })
      }))
      expect(written).toHaveLength(3)

      broken.clear()
      const created = await m.runner.retry(project, a.id, RETRYER)

      expect(created.map(record => record.params['prompt'])).toEqual(['A'])
    })

    it('refuses to retry an input_failed dependent alone while its producer is still failed, and creates no record', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      setup(m, new Set(['A']), [])
      const a = await render(m, project, 'A')
      const b = await render(m, project, 'B', [a])
      await m.scheduler.wait(project)
      expect(m.store.getRecord(project, b.id)).toMatchObject({ status: 'failed', error: { code: 'input_failed' } })
      const before = m.store.listRecords(project).length

      await expect(m.runner.retry(project, b.id, RETRYER)).rejects.toMatchObject({ code: 'invalid_inputs' })

      expect(m.store.listRecords(project)).toHaveLength(before)
    })

    it('refuses a failed record that has no operation', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const stored = await m.store.lock(project, () => {
        const record = m.store.append(project, {
          parents: [m.store.line(project)!.at], kind: 'operation', component: 'shot', operation: null, operation_version: null,
          ...userOrigin(), params: {}, inputs: [], outputs: [], based_on: null, supersedes: [], deterministic: false, status: 'pending',
        })
        return m.store.update(project, { update: record.id, status: 'failed', finished_at: new Date().toISOString() })
      })
      await expect(m.runner.retry(project, stored.id, RETRYER)).rejects.toMatchObject({ code: 'not_failed' })
    })

    it('refuses a record that did not fail and an unknown record', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      setup(m, new Set(), [])
      const done = (await m.runner.run(request(project, 'shot.render'))).record!
      expect(done.status).toBe('done')

      await expect(m.runner.retry(project, done.id, RETRYER)).rejects.toMatchObject({ code: 'not_failed' })
      await expect(m.runner.retry(project, brandString<RecordId>('missing'), RETRYER)).rejects.toMatchObject({ code: 'unknown_record' })
      expect(recordsOf(m, project, 'shot.render')).toHaveLength(1)
    })

    it('retries a cancelled record together with the record that waited on it', async () => {
      const m = startModules({ cpu: 4, gpu: 1 })
      const project = await createTestProject(m)
      const started: string[] = []
      let hold = true
      m.runner.registerOperation(operation({
        name: 'shot.render', component: 'shot', resource: 'gpu',
        execute: async (context) => {
          const prompt = String(context.params['prompt'])
          started.push(prompt)
          if (hold) {
            await new Promise((_resolve, reject) => { context.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true }) })
          }
          return { outputs: [context.importAsset(Buffer.from(prompt), { mime: 'video/mp4', name: 'take.mp4' })] }
        },
      }))
      const a = await render(m, project, 'A')
      await expect.poll(() => started).toEqual(['A'])
      const b = await render(m, project, 'B', [a])
      await m.runner.cancel(project, a.id)
      await m.scheduler.wait(project)
      expect(m.store.getRecord(project, b.id)).toMatchObject({ status: 'failed', error: { code: 'input_failed' } })

      hold = false
      const created = await m.runner.retry(project, a.id, RETRYER)
      await m.scheduler.wait(project)

      expect(created.map(record => [record.params['prompt'], m.store.getRecord(project, record.id).status])).toEqual([['A', 'done'], ['B', 'done']])
      expect(created[1]!.inputs[0]?.ref).toEqual({ record: created[0]!.id, output: 0 })
    })

    it('names how many records were queued when a later re-run is refused, and keeps them', async () => {
      const m = startModules()
      const project = await createTestProject(m)
      const broken = new Set(['A'])
      setup(m, broken, [])
      const a = await render(m, project, 'A')
      await render(m, project, 'B', [a])
      await m.scheduler.wait(project)
      broken.clear()
      // Unregistering is not possible for a test spec, so make the dependent's params invalid by editing the stored copy.
      const stored = m.store.listRecords(project).find(record => record.params['prompt'] === 'B')!
      stored.params['prompt'] = 7
      const spy = vi.spyOn(m.store, 'listRecords').mockReturnValueOnce(m.store.listRecords(project).map(record => record.id === stored.id ? stored : record))

      await expect(m.runner.retry(project, a.id, RETRYER)).rejects.toMatchObject({
        code: 'invalid_params', message: expect.stringContaining('Only 1 of 2 records were queued') as string,
      })
      spy.mockRestore()
      expect(recordsOf(m, project, 'shot.render').filter(record => record.based_on === a.id)).toHaveLength(1)
    })
  })
})
