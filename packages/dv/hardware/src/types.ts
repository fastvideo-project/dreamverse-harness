/** Generation-worker connections, independent of GPU vendor and model provider. */

/** A saved API connection. SSH uses the host's existing OpenSSH configuration. */
export interface WorkerConfig {
  label: string
  provider: string
  enabled: boolean
  transport: 'api' | 'ssh'
  baseUrl: string
  credentialRef: string
  sshHost: string
  remoteHost: string
  remotePort: number
}

/** Backend-reported state; an API connection need not describe physical GPUs. */
export interface WorkerInspection {
  reachable: boolean
  busy: boolean
  loadedModel: string | null
  loadingModel: string | null
}

/** Public hardware inventory. Credentials stay in the credential service. */
export interface WorkerView extends WorkerInspection {
  id: string
  label: string
  provider: string
  transport: WorkerConfig['transport']
  enabled: boolean
  status: 'disabled' | 'unchecked' | 'ready' | 'busy' | 'loading' | 'unreachable'
}

/** One connection snapshot, retained by an admitted operation across configuration edits. */
export interface WorkerConnection {
  id: string
  label: string
  provider: string
  baseUrl: string
  fetch: typeof globalThis.fetch
}

/** Safe metadata for connecting an existing RunPod Pod over its exposed HTTP proxy. */
export interface RunPodView {
  id: string
  name: string
  status: string
  endpoints: Array<{ port: number; baseUrl: string }>
}
