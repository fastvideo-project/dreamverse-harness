/** Worker leases span tasks/models, and cancellation cannot release somebody else's worker. */
import { describe, expect, it, vi } from 'vitest'
import { WorkerPool, type WorkerClient } from '../src/worker-pool.ts'

function worker(id: string, loaded = true): WorkerClient {
  return { id, label: id, client: {
    modelStatus: vi.fn(async () => ({ installed: true, loaded, loading: false, busy: false, managed: true })),
    unloadModel: vi.fn(async () => {}), loadModel: vi.fn(async () => {}),
    model: vi.fn(async () => { throw new Error('Not used by reservation tests') }),
    generateSegment: vi.fn(async () => ({ video: Buffer.from('video'), mime: 'video/mp4', timings: {} })) } }
}

describe('native FastVideo worker pool', () => {
  it('keeps a caller queued behind a leased model switch without probing the loading worker', async () => {
    const pool = new WorkerPool()
    const device = worker('spark1')
    const active = await pool.acquire([device])
    vi.mocked(device.client.modelStatus).mockRejectedValue(new Error('model switch blocks status'))
    const controller = new AbortController()
    const queued = pool.acquire([device], controller.signal)
    const outcome = expect(queued).rejects.toThrow('cancel waiting')
    expect(device.client.modelStatus).toHaveBeenCalledOnce()
    controller.abort(new Error('cancel waiting'))
    await outcome
    active.release()
  })

  it('does not fail a late status probe after a peer call acquires the same worker', async () => {
    const pool = new WorkerPool()
    const device = worker('spark1')
    let rejectProbe!: (error: Error) => void
    vi.mocked(device.client.modelStatus).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectProbe = reject }))
    const controller = new AbortController()
    const queued = pool.acquire([device], controller.signal)
    const outcome = expect(queued).rejects.toThrow('cancel waiting')
    const active = await pool.acquire([device])
    rejectProbe(new Error('status timed out while the winner loads'))
    // Flush the rejected status probe before cancellation: a false installation failure would win this race.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    controller.abort(new Error('cancel waiting'))
    await outcome
    active.release()
  })

  it('prefers an idle resident model, then reserves another device for an overlapping render', async () => {
    const pool = new WorkerPool()
    const workers = [worker('spark1', false), worker('spark2')]
    const [first, second] = await Promise.all([pool.acquire(workers), pool.acquire(workers)])
    expect(first.worker.id).toBe('spark2')
    expect(second.worker.id).toBe('spark1')
    expect((await pool.states(workers)).map(state => state.busy)).toEqual([true, true])
    first.release(); second.release()
  })

  it('shares leases across different models using the same worker IDs', async () => {
    const pool = new WorkerPool()
    const first = await pool.acquire([worker('spark1'), worker('spark2')])
    const second = await pool.acquire([worker('spark1'), worker('spark2')])
    expect(first.worker.id).not.toBe(second.worker.id)
    first.release(); second.release()
  })

  it('wakes a queued render on release and makes release idempotent', async () => {
    const pool = new WorkerPool()
    const workers = [worker('spark1')]
    const first = await pool.acquire(workers)
    const waiting = pool.acquire(workers)
    // A states call is the barrier after the second acquire has observed the held worker.
    await pool.states(workers)
    first.release()
    const second = await waiting
    first.release()
    expect((await pool.states(workers))[0]?.busy).toBe(true)
    second.release()
  })

  it('cancels only a waiting caller and never unloads an active worker', async () => {
    const pool = new WorkerPool()
    const workers = [worker('spark1')]
    const active = await pool.acquire(workers)
    const controller = new AbortController()
    const waiting = pool.acquire(workers, controller.signal)
    const outcome = expect(waiting).rejects.toThrow('cancel waiting')
    controller.abort(new Error('cancel waiting'))
    await outcome
    await expect(pool.unload(workers)).rejects.toThrow('in use')
    expect(workers[0]?.client.unloadModel).not.toHaveBeenCalled()
    active.release()
    await pool.unload(workers)
    expect(workers[0]?.client.unloadModel).toHaveBeenCalledOnce()
  })

  it('uses a reachable worker when its peer is unavailable, and refuses when none has weights', async () => {
    const pool = new WorkerPool()
    const down = worker('spark1')
    vi.mocked(down.client.modelStatus).mockRejectedValue(new Error('offline'))
    const lease = await pool.acquire([down, worker('spark2')])
    expect(lease.worker.id).toBe('spark2')
    lease.release()
    await expect(pool.acquire([down])).rejects.toThrow('No reachable worker')
  })
})
