/** Reserve native FastVideo workers across every task/model of one provider. */
import type { DvFastvideoGeneration } from '@dv/fastvideo-generation-client'
import type { ModelRuntimeState } from '@dv/models'

export interface WorkerClient {
  id: string
  label: string
  client: Pick<DvFastvideoGeneration, 'modelStatus' | 'loadModel' | 'unloadModel' | 'generateSegment' | 'model'>
  reserve?: () => (() => void) | null
  eligible?: () => boolean
  isReserved?: () => boolean
}
export interface WorkerState extends ModelRuntimeState { id: string; label: string; available: boolean }

/** Own worker leases until generation, cancellation, or explicit lifecycle work settles. */
export class WorkerPool {
  private readonly held = new Set<string>()
  private readonly waiters = new Set<() => void>()

  async states(workers: readonly WorkerClient[], signal?: AbortSignal): Promise<WorkerState[]> {
    const deadline = AbortSignal.timeout(5000)
    const bounded = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    const states = await Promise.all(workers.map(async (worker) => {
      try {
        if (worker.eligible?.() === false) throw new Error('Worker configuration changed before admission.')
        const state = await worker.client.modelStatus(bounded)
        return { id: worker.id, label: worker.label, available: true, ...state,
          busy: state.busy || this.held.has(worker.id) || worker.isReserved?.() === true }
      } catch {
        signal?.throwIfAborted()
        return { id: worker.id, label: worker.label, available: false, installed: false, loaded: false,
          loading: false, busy: this.held.has(worker.id) }
      }
    }))
    return states
  }

  async acquire(workers: readonly WorkerClient[], signal?: AbortSignal): Promise<{ worker: WorkerClient; release(): void }> {
    for (;;) {
      signal?.throwIfAborted()
      const reserved = (worker: WorkerClient): boolean => this.held.has(worker.id) || worker.isReserved?.() === true
      // A loading lease already owns this device. Probe it only after release, so queued calls do not turn
      // a temporarily unresponsive model switch into an installation failure.
      const candidates = workers.filter(worker => !reserved(worker))
      if (workers.length > 0 && candidates.length === 0) { await this.wait(signal); continue }
      const states = await this.states(candidates, signal)
      signal?.throwIfAborted()
      const installed = states.filter(state => state.available && state.installed)
      if (installed.length === 0) {
        // Another acquire may have won while these status requests were in flight.
        if (workers.some(reserved)) { await this.wait(signal); continue }
        if (states.some(state => !state.available)) throw new Error('No reachable worker could confirm this model is installed. Check worker connectivity and status before retrying.')
        throw new Error('No enabled worker has this model installed. Install it on the selected worker before generating.')
      }
      const next = installed.filter(state => !state.busy && !state.loading && !this.held.has(state.id))
        .sort((a, b) => Number(b.loaded) - Number(a.loaded))[0]
      if (next !== undefined) {
        const worker = workers.find(candidate => candidate.id === next.id)
        if (worker === undefined) throw new Error('Worker disappeared before reservation.')
        const releaseHardware = worker.reserve?.()
        if (releaseHardware === null) { await this.wait(signal); continue }
        this.held.add(next.id)
        let released = false
        return { worker, release: () => {
          if (released) return
          released = true
          this.held.delete(next.id)
          releaseHardware?.()
          for (const wake of [...this.waiters]) wake()
        } }
      }
      await this.wait(signal)
    }
  }

  /** Release only idle instances of this model; a busy instance makes the whole action refuse. */
  async unload(workers: readonly WorkerClient[], signal?: AbortSignal): Promise<void> {
    const states = await this.states(workers, signal)
    signal?.throwIfAborted()
    if (states.some(state => !state.available)) throw new Error('A worker is unreachable; its model residency cannot be confirmed.')
    const loaded = states.filter(state => state.available && state.loaded)
    if (loaded.some(state => state.busy || state.loading || this.held.has(state.id))) {
      throw new Error('This model is in use on a worker. Unload it after generation finishes.')
    }
    const releases: Array<() => void> = []
    try {
      for (const state of loaded) {
        const worker = workers.find(candidate => candidate.id === state.id)
        if (worker === undefined) throw new Error('Worker disappeared before model unload.')
        const release = worker.reserve?.()
        if (release === null) throw new Error('This model is in use on a worker. Unload it after generation finishes.')
        if (release !== undefined) releases.push(release)
        this.held.add(state.id)
      }
      await Promise.all(loaded.map((state) => {
        const worker = workers.find(candidate => candidate.id === state.id)
        if (worker === undefined) throw new Error('Worker disappeared before model unload.')
        return worker.client.unloadModel(signal)
      }))
    } finally {
      for (const release of releases) release()
      for (const state of loaded) this.held.delete(state.id)
      for (const wake of [...this.waiters]) wake()
    }
  }

  private wait(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => { clearTimeout(timer); this.waiters.delete(wake); signal?.removeEventListener('abort', abort) }
      const wake = (): void => { cleanup(); resolve() }
      const abort = (): void => { cleanup(); reject(signal?.reason instanceof Error ? signal.reason : new Error('Worker reservation cancelled', { cause: signal?.reason })) }
      const timer = setTimeout(wake, 1000)
      this.waiters.add(wake)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted === true) abort()
    })
  }
}
