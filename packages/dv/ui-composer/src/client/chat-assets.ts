/**
 * The assets of the open DreamVerse project, the record that created each one, and the operation declarations, followed
 * outside React and read by the chat Markdown cards through a selector hook. The snapshot holds the project's current
 * state, and it is fetched again after the project's change events.
 *
 * @module @dv/ui-composer/chat-assets
 */
import type { DvClient } from '@dv/ui-kit/api.ts'
import { DV_CURRENT_PROJECT_EVENT, getCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { ProjectAsset, ProjectRecord, WireOperation } from '@dv/ui-kit/types.ts'

/** What the chat cards read from the open project. JSON data. */
export interface ChatAssets {
  /** The project whose assets these are, or null while no project is open. */
  readonly project: string | null
  /** Every asset of the state, by ID. */
  readonly assets: Readonly<Record<string, ProjectAsset>>
  /** The current-state record that created each output asset, by asset ID. */
  readonly producers: Readonly<Record<string, ProjectRecord>>
  /** Every record of the current state, by ID, which History's record label reads for the chain of a retake. */
  readonly records: Readonly<Record<string, ProjectRecord>>
  /** The declarations of `/api/dv/operations`, which History's record label reads. */
  readonly operations: readonly WireOperation[]
}

/** The snapshot while no project is open or before the first fetch settles. */
export const NO_CHAT_ASSETS: ChatAssets = { project: null, assets: {}, producers: {}, records: {}, operations: [] }

/** The pause after a project event before the fetch, so a burst of events causes one fetch. */
const REFETCH_DELAY_MS = 150

/**
 * Fetch the project's current state and the operation declarations.
 * @param client - the API client.
 * @param project - the project.
 * @param signal - cancels the requests.
 * @returns the snapshot.
 */
async function fetchChatAssets(client: DvClient, project: string, signal: AbortSignal): Promise<ChatAssets> {
  const [state, operations] = await Promise.all([client.getState(project, signal), client.listOperations(signal)])
  const records = new Map(state.components.proj.records.map(record => [record.id, record]))
  const producers: Record<string, ProjectRecord> = {}
  for (const [asset, id] of Object.entries(state.components.proj.created_by)) {
    const producer = records.get(id)
    if (producer !== undefined) producers[asset] = producer
  }
  const assets = Object.fromEntries(state.assets.map(asset => [asset.id, asset]))
  return { project, assets, producers, records: Object.fromEntries(records), operations }
}

/**
 * Follow the assets of the project that the DreamVerse shell has open.
 * @param client - the API client.
 * @param onChange - receives each snapshot that differs from the last one; a project change first resets it to
 *   {@link NO_CHAT_ASSETS}, and a failed fetch keeps the last snapshot until the next project event.
 * @returns a function that stops following.
 */
export function followChatAssets(client: DvClient, onChange: (assets: ChatAssets) => void): () => void {
  let project: string | null = null
  let shown = JSON.stringify(NO_CHAT_ASSETS)
  let request: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopEvents = (): void => {}

  const publish = (next: ChatAssets): void => {
    const text = JSON.stringify(next)
    if (text === shown) return
    shown = text
    onChange(next)
  }
  const cancel = (): void => {
    request?.abort()
    request = null
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const load = (open: string): void => {
    cancel()
    const current = new AbortController()
    request = current
    fetchChatAssets(client, open, current.signal).then((next) => {
      if (!current.signal.aborted) publish(next)
    }, (_error: unknown) => {
      // A failed or cancelled fetch keeps the last snapshot; the next project event fetches again.
    })
  }
  const follow = (): void => {
    const next = getCurrentProject()
    if (next === project) return
    project = next
    stopEvents()
    cancel()
    publish(NO_CHAT_ASSETS)
    if (next === null) {
      stopEvents = () => {}
      return
    }
    stopEvents = client.subscribe(next, () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => { load(next) }, REFETCH_DELAY_MS)
    })
    load(next)
  }

  window.addEventListener(DV_CURRENT_PROJECT_EVENT, follow)
  follow()
  return () => {
    window.removeEventListener(DV_CURRENT_PROJECT_EVENT, follow)
    stopEvents()
    cancel()
  }
}
