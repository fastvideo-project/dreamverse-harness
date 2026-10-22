/**
 * The assets of the open DreamVerse project and the shot number of each take output, followed outside React and read
 * by the chat Markdown cards through a selector hook. The snapshot holds the project's current state, and it is fetched
 * again after the project's change events.
 *
 * @module @dv/ui-composer/chat-assets
 */
import type { DvClient } from '@dv/ui-kit/api.ts'
import { chainOf } from '@dv/ui-kit/chain.ts'
import { DV_CURRENT_PROJECT_EVENT, getCurrentProject } from '@dv/ui-kit/current-project.ts'
import { isGenerationRecord } from '@dv/ui-kit/state.ts'
import type { ProjectAsset } from '@dv/ui-kit/types.ts'

/** What the chat cards read from the open project. JSON data. */
export interface ChatAssets {
  /** The project whose assets these are, or null while no project is open. */
  readonly project: string | null
  /** Every asset of the state, by ID. */
  readonly assets: Readonly<Record<string, ProjectAsset>>
  /**
   * The chain slot of the generation record whose outputs include each asset, by asset ID: the number that the canvas
   * titles the take 镜头 N / Shot N by; an asset of no take with a slot has none.
   */
  readonly shots: Readonly<Record<string, number>>
}

/** The snapshot while no project is open or before the first fetch settles. */
export const NO_CHAT_ASSETS: ChatAssets = { project: null, assets: {}, shots: {} }

/** The pause after a project event before the fetch, so a burst of events causes one fetch. */
const REFETCH_DELAY_MS = 150

/**
 * Fetch the assets and records of the project's current state.
 * @param client - the API client.
 * @param project - the project.
 * @param signal - cancels the request.
 * @returns the snapshot.
 */
async function fetchChatAssets(client: DvClient, project: string, signal: AbortSignal): Promise<ChatAssets> {
  const state = await client.getState(project, signal)
  const records = new Map(state.components.proj.records.map(record => [record.id, record]))
  const shots: Record<string, number> = {}
  for (const record of state.components.proj.records) {
    const shot = chainOf(record, records)?.slot ?? null
    if (shot === null || !isGenerationRecord(record, undefined, id => state.assets.find(item => item.id === id)?.mime)) continue
    for (const output of record.outputs) shots[output] = shot
  }
  return { project, assets: Object.fromEntries(state.assets.map(asset => [asset.id, asset])), shots }
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
