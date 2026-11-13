/** Saved generation connections over existing settings, credentials, and authenticated browser routes. */
import { Service, type Context, type Fiber, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SshTunnel } from './ssh-tunnel.ts'
import { listRunPodPods } from './runpod.ts'
import type { WorkerConfig, WorkerConnection, WorkerInspection, WorkerView } from './types.ts'
export type * from './types.ts'

/** Live worker inventory; existing requests retain their admitted connection. */
export interface Config {
  /** Saved workers keyed by stable worker ID; settings refuse a saved or reloaded inventory that fails `validateWorkers`. */
  workers: Volatile<Record<string, WorkerConfig>>
  /** Deadline in milliseconds for each worker inspection, model-catalog read, and SSH forward start. */
  connectionTimeoutMs: number
  /** Order of the `dv:hardware` system prompt section. */
  promptSectionOrder: number
}

/** Validate connection coordinates before they reach OpenSSH or HTTP. */
export function validateWorkers(workers: Record<string, WorkerConfig>): boolean {
  const addresses = new Set<string>()
  for (const [id, worker] of Object.entries(workers)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || worker.label.trim() === '' || worker.provider.trim() === '') return false
    if (worker.credentialRef !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(worker.credentialRef)) return false
    let address: string
    if (worker.transport === 'ssh') {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/.test(worker.sshHost)
        || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(worker.remoteHost)) return false
      address = `ssh:${worker.sshHost}:${worker.remoteHost}:${worker.remotePort}`
    } else {
      let url: URL
      try { url = new URL(worker.baseUrl) } catch (_invalidUrl) { return false }
      if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false
      address = url.href.replace(/\/$/, '')
    }
    if (addresses.has(address)) return false
    addresses.add(address)
  }
  return true
}

const invalidInventory = 'Worker configuration contains invalid or duplicate endpoints. Edit Hardware settings before generating.'

/** Loader schema; only worker coordinates are live-editable. */
export const Config = z.object({
  workers: z.dict(z.object({
    label: z.string().required(), provider: z.string().default('fastvideo'), enabled: z.boolean().default(true),
    transport: z.union([z.const('api'), z.const('ssh')]).default('api'), baseUrl: z.string().default('http://127.0.0.1:18000'),
    credentialRef: z.string().default(''), sshHost: z.string().default(''), remoteHost: z.string().default('127.0.0.1'),
    remotePort: z.natural().min(1).max(65535).default(18000),
  })).default({}).volatile(),
  promptSectionOrder: z.number().default(4870),
  connectionTimeoutMs: z.natural().min(1000).max(120000).default(10000),
})

declare module '@deepseek-ai/cordis' {
  interface Context { /** Generation worker inventory and connection ownership. */ dvHardware: DvHardware }
}

/** Provider-specific inspection, with credentials and transport supplied by the hardware owner. */
export type WorkerInspector = (connection: WorkerConnection, signal: AbortSignal) => Promise<WorkerInspection>

/** Own connection snapshots and one-generation reservations across providers. */
export default class DvHardware extends Service {
  static Config = Config
  static inject = ['credentials']
  private readonly inspectors = new Map<string, WorkerInspector>()
  private readonly connections = new Map<string, WorkerConnection>()
  private readonly tunnels = new Map<string, SshTunnel>()
  private readonly held = new Set<string>()
  private readonly checks = new Map<string, { fingerprint: string; value: WorkerInspection }>()
  private disposed = false

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dvHardware')
    // Refuse a saved or reloaded inventory before it replaces this live one; a stored invalid inventory still boots.
    ctx.on('internal/config', function (this: Fiber, _raw, next) {
      const raw: unknown = next()
      const current: unknown = this.config
      if (typeof current !== 'object' || current === null || Reflect.get(current, 'workers') !== config.workers) return raw
      if (!validateWorkers(Config(raw as Parameters<typeof Config>[0]).workers.get())) throw new Error(invalidInventory)
      return raw
    })
    ctx.inject(['systemPrompt'], scope => scope.effect(() => scope.systemPrompt.section({
      name: 'dv:hardware', order: config.promptSectionOrder, interpolate: false,
      text: () => [
        'Generation hardware:',
        'When the user asks whether a device is connected, available, busy, or loaded, call dv_hardware_list immediately and report its result. Do not ask permission for this read-only inspection or claim no visibility before checking.',
        'The configured worker IDs below are routing targets, not evidence of current connectivity. Read dv_hardware_list for live state.',
        validateWorkers(this.config.workers.get()) ? JSON.stringify(this.list().map(worker => ({
          id: worker.id, label: worker.label, provider: worker.provider, enabled: worker.enabled,
        }))) : invalidInventory,
        'For explicit placement, pass worker to dv_shot_render, dv_models_status, dv_models_load, or dv_models_unload. Use the exact enabled worker ID. A pinned operation never falls back to another device. Omit worker to let the provider place independent jobs automatically.',
        'Check model status per worker before switching models. Loading retains compatible common components when supported. Never unload or replace a busy worker. Submit independent clips together; wait only for clips whose inputs depend on an earlier output.',
        'Only configured workers may be used. Do not infer distributed single-video support from multiple available workers, start Ray, change device connections, or access credentials from generation tools.',
      ].join('\n'),
    }), 'hardware operator instructions'))
    ctx.effect(() => async () => { this.disposed = true; await Promise.all([...this.tunnels.values()].map(tunnel => tunnel.dispose())) })
    ctx.inject(['connection'], (scope) => {
      scope.effect(() => scope.connection.fetch.register({
        path: '/api/dv/hardware/runpod/pods', methods: ['POST'], requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body: unknown = await request.json()
            if (typeof body !== 'object' || body === null || !('credentialRef' in body)
              || typeof body.credentialRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(body.credentialRef)) {
              return Response.json({ error: 'Choose a saved RunPod account credential.' }, { status: 400 })
            }
            const credential = await this.ctx.credentials.resolve(credentialRef(body.credentialRef))
            if (credential === undefined) return Response.json({ error: 'Save a RunPod account API key first.' }, { status: 400 })
            const signal = AbortSignal.any([request.signal, AbortSignal.timeout(this.config.connectionTimeoutMs)])
            return Response.json({ data: await listRunPodPods(credential.value, signal) })
          } catch {
            return Response.json({ error: 'Could not list RunPod Pods. Check the saved account key and connection.' }, { status: 502 })
          }
        },
      }), 'existing RunPod discovery')
      for (const action of ['status', 'check'] as const) scope.effect(() => scope.connection.fetch.register({
        path: `/api/dv/hardware/${action}`, methods: [action === 'status' ? 'GET' : 'POST'], requestBody: 'buffered',
        fetch: async () => Response.json(action === 'check' ? await this.check() : this.list()),
      }), `hardware ${action}`)
      scope.effect(() => scope.connection.fetch.register({
        path: '/api/dv/hardware/models', methods: ['GET', 'POST'], requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const id = new URL(request.url).searchParams.get('worker') ?? ''
            const saved = this.savedWorkers()[id]
            if (saved === undefined || saved.provider !== 'fastvideo') return Response.json({ error: 'Select a FastVideo worker.' }, { status: 400 })
            const connection = this.connection(id, saved)
            const signal = AbortSignal.timeout(this.config.connectionTimeoutMs)
            if (request.method === 'GET') {
              const response = await connection.fetch(new URL('/v1/models', connection.baseUrl), { signal })
              if (!response.ok) return Response.json({ error: 'Could not read the worker model catalog.' }, { status: 502 })
              const catalog: unknown = await response.json()
              if (typeof catalog !== 'object' || catalog === null || !('data' in catalog) || !Array.isArray(catalog.data)) {
                return Response.json({ error: 'The worker returned an invalid model catalog.' }, { status: 502 })
              }
              const data = catalog.data.map((row: unknown) => {
                if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string') throw new Error('Invalid model row')
                return { id: row.id, tasks: 'tasks' in row && Array.isArray(row.tasks) ? row.tasks.filter((task: unknown) => typeof task === 'string') : [],
                  installed: 'installed' in row && row.installed === true, loaded: 'loaded' in row && row.loaded === true }
              })
              return Response.json({ data })
            }
            const body: unknown = await request.json()
            if (typeof body !== 'object' || body === null || !('action' in body)
              || !['load', 'unload'].includes(String(body.action)) || !('model' in body) || typeof body.model !== 'string'
              || !('task' in body) || typeof body.task !== 'string') {
              return Response.json({ error: 'Choose a model and a supported model action.' }, { status: 400 })
            }
            const release = this.reserve(id)
            if (release === null) return Response.json({ error: 'This worker is disabled or in use.' }, { status: 409 })
            try {
              const response = await connection.fetch(new URL(`/v1/models/${String(body.action)}`, connection.baseUrl), {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: body.model, task: body.task }), signal: request.signal,
              })
              await response.body?.cancel()
              return response.ok ? Response.json({ done: true })
                : Response.json({ error: 'The worker refused the model action. Check whether a generation is running.' }, { status: response.status })
            } finally { release() }
          } catch (_workerFailure) {
            // Worker, transport, and credential errors stay on the Host; the browser receives one fixed message.
            return Response.json({ error: 'The worker could not be reached. Check its connection before retrying.' }, { status: 502 })
          }
        },
      }), 'hardware model controls')
    })
    ctx.inject(['tools'], scope => scope.effect(() => scope.tools.register(defineTool({
      name: 'dv_hardware_list', description: 'Inspect enabled generation workers, connectivity, busy state, and resident models. '
        + 'Call this immediately when asked about connected devices or worker status; no confirmation is needed. Returned IDs can target render, model status, load, and unload calls. This does not configure hardware or start Ray.',
      parameters: {}, isConcurrencySafe: () => true,
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async () => (await this.check()).map(worker => ({ ...worker })),
    })), 'hardware inspection tool'))
  }

  private savedWorkers(): Readonly<Record<string, WorkerConfig>> {
    const workers = this.config.workers.get()
    if (!validateWorkers(workers)) throw new Error(invalidInventory)
    return workers
  }

  /** Register an inspector while its model provider is active. */
  registerInspector(provider: string, inspect: WorkerInspector): () => void {
    if (this.inspectors.has(provider)) throw new Error(`Hardware inspector already registered: ${provider}`)
    this.inspectors.set(provider, inspect)
    return () => { this.inspectors.delete(provider) }
  }

  /** Current saved inventory without a network request. */
  list(): WorkerView[] {
    return Object.entries(this.savedWorkers()).map(([id, config]) => {
      const checked = this.checks.get(id)
      const state = checked?.fingerprint === JSON.stringify(config) ? checked.value : null
      const busy = this.held.has(id) || state?.busy === true
      return { id, label: config.label, provider: config.provider, enabled: config.enabled, transport: config.transport,
        reachable: state?.reachable ?? false, busy, loadedModel: state?.loadedModel ?? null, loadingModel: state?.loadingModel ?? null,
        status: !config.enabled ? 'disabled' : busy ? 'busy' : state === null ? 'unchecked' : !state.reachable ? 'unreachable'
          : state.loadingModel !== null ? 'loading' : 'ready' }
    })
  }

  /** Check each enabled worker once, with a bounded deadline and no automatic retry. */
  async check(): Promise<WorkerView[]> {
    await Promise.all(Object.entries(this.savedWorkers()).filter(([, config]) => config.enabled).map(async ([id, config]) => {
      const fingerprint = JSON.stringify(config)
      const inspector = this.inspectors.get(config.provider)
      let value: WorkerInspection
      try {
        // An explicit user check may reopen a failed idle forward; an active job never reconnects itself.
        if (!this.held.has(id) && this.checks.get(id)?.value.reachable === false) {
          const key = JSON.stringify([id, config])
          await this.tunnels.get(key)?.dispose()
          this.tunnels.delete(key)
          this.connections.delete(key)
        }
        const connection = this.connection(id, config)
        if (inspector === undefined) {
          const response = await connection.fetch(new URL('/health', connection.baseUrl), { signal: AbortSignal.timeout(this.config.connectionTimeoutMs) })
          await response.body?.cancel()
          value = { reachable: response.ok, busy: false, loadedModel: null, loadingModel: null }
        } else value = await inspector(connection, AbortSignal.timeout(this.config.connectionTimeoutMs))
      } catch (_inspectionFailure) {
        // Any transport, credential, or inspector failure reports the worker unreachable.
        value = { reachable: false, busy: false, loadedModel: null, loadingModel: null }
      }
      this.checks.set(id, { fingerprint, value })
    }))
    return this.list()
  }

  /** Enabled connections for a provider. Call at admission, not once at plugin startup. */
  workers(provider: string): WorkerConnection[] {
    return Object.entries(this.savedWorkers()).filter(([, config]) => config.enabled && config.provider === provider)
      .map(([id, config]) => this.connection(id, config))
  }

  /** Whether a connection still names the enabled saved worker it was created for. */
  eligible(connection: WorkerConnection): boolean {
    const saved = this.savedWorkers()[connection.id]
    return saved?.enabled === true && this.connection(connection.id, saved) === connection
  }

  /** Whether a local generation or lifecycle operation holds this worker. */
  isReserved(id: string): boolean { return this.held.has(id) }

  /** Atomically reserve one saved worker; configuration edits cannot release an active reservation. */
  reserve(id: string): (() => void) | null {
    if (this.disposed || this.held.has(id) || this.savedWorkers()[id]?.enabled !== true) return null
    this.held.add(id)
    let released = false
    return () => { if (!released) { released = true; this.held.delete(id) } }
  }

  /** Return this saved config's snapshot; a new one's fetch pins the endpoint, adds the credential, and uses the forward. */
  private connection(id: string, config: WorkerConfig): WorkerConnection {
    const fingerprint = JSON.stringify([id, config])
    const known = this.connections.get(fingerprint)
    if (known !== undefined) return known
    const baseUrl = config.transport === 'ssh' ? 'http://worker.invalid' : config.baseUrl
    let tunnel: SshTunnel | undefined
    if (config.transport === 'ssh') { tunnel = new SshTunnel(config, this.config.connectionTimeoutMs); this.tunnels.set(fingerprint, tunnel) }
    const fetch: typeof globalThis.fetch = async (input, init = {}) => {
      if (this.disposed) throw new Error('Hardware connections have shut down.')
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== new URL(baseUrl).origin) throw new Error('Worker request cannot change its endpoint.')
      const headers = new Headers(init.headers)
      if (config.credentialRef !== '') {
        const credential = await this.ctx.credentials.resolve(credentialRef(config.credentialRef))
        if (credential === undefined) throw new Error('The worker API credential is not configured.')
        if (!/^[\x21-\x7e]+$/.test(credential.value)) throw new Error('The worker API credential contains invalid characters.')
        headers.set('authorization', `Bearer ${credential.value}`)
      }
      const options = { ...init, headers, redirect: 'error' as const }
      if (tunnel !== undefined) return await tunnel.fetch(url, options)
      const target = new URL(url)
      const prefix = new URL(baseUrl).pathname.replace(/\/$/, '')
      target.pathname = prefix + target.pathname
      return await globalThis.fetch(target, options)
    }
    const connection = { id, label: config.label, provider: config.provider, baseUrl, fetch }
    this.connections.set(fingerprint, connection)
    return connection
  }
}
