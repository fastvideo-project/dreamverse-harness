/** Generation-worker connections, independent of GPU vendor and model provider. */

/** A saved API connection. SSH uses the host's existing OpenSSH configuration. */
export interface WorkerConfig {
  /** Display name in Hardware settings and the operator prompt. */
  label: string
  /** Model provider whose inspector and generation adapter use this connection, such as `fastvideo`. */
  provider: string
  /** Whether checks and new admissions use this worker; an admitted operation keeps its reservation. */
  enabled: boolean
  /** `api` sends requests to `baseUrl`; `ssh` forwards them to `remoteHost:remotePort` through `sshHost`. */
  transport: 'api' | 'ssh'
  /** API origin and optional reverse-proxy path prefix for the `api` transport. */
  baseUrl: string
  /** Credential-service reference sent as a Bearer token on each request; empty sends no authorization. */
  credentialRef: string
  /** Existing OpenSSH host alias on the Harness host for the `ssh` transport. */
  sshHost: string
  /** Worker API host as reached from the SSH server. */
  remoteHost: string
  /** Worker API port as reached from the SSH server. */
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
