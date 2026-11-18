/** Existing RunPod discovery. Account credentials are sent only to the RunPod control API. */
import type { RunPodView } from './types.ts'

/** Whitelist connection metadata; Pod environments and credentials never enter a browser response. */
export function runPodViews(value: unknown): RunPodView[] {
  if (!Array.isArray(value)) throw new Error('RunPod returned an invalid Pod list.')
  return value.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string'
      || !/^[a-z0-9]{1,64}$/i.test(row.id)) return []
    const id = row.id
    const ports = 'ports' in row && Array.isArray(row.ports) ? row.ports : []
    const endpoints = ports.flatMap((port: unknown) => {
      if (typeof port !== 'string' || !/^\d{1,5}\/http$/.test(port)) return []
      const number = Number(port.split('/')[0])
      if (number < 1 || number > 65535) return []
      return [{ port: number, baseUrl: `https://${id}-${number}.proxy.runpod.net` }]
    })
    return [{ id, name: 'name' in row && typeof row.name === 'string' ? row.name.slice(0, 191) : id,
      status: 'desiredStatus' in row && typeof row.desiredStatus === 'string' ? row.desiredStatus.slice(0, 40) : 'UNKNOWN',
      endpoints }]
  })
}

/** List existing GPU Pods without creating, starting, or changing paid resources. */
export async function listRunPodPods(key: string, signal: AbortSignal,
  fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<RunPodView[]> {
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('The RunPod API key is invalid.')
  const response = await fetcher('https://rest.runpod.io/v1/pods?computeType=GPU&desiredStatus=RUNNING', {
    headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`RunPod could not list Pods (HTTP ${response.status}). Check the saved account key.`)
  }
  return runPodViews(await response.json())
}
