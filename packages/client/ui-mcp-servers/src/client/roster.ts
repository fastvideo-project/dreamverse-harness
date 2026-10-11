/** One reconnecting mirror of the Host MCP server roster, shared by every dashboard occurrence. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { McpServersSnapshot } from '@deepseek-ai/dsh-mcp-servers/types'
import type {} from '@deepseek-ai/dsh-mcp-servers/remote'

/** Latest Host roster, with a separate transport failure that never rewrites the roster. */
export interface McpRosterState {
  readonly roster: McpServersSnapshot | null
  readonly connected: boolean
  readonly error: string | null
}

/**
 * Subscribe once per Client plugin, independent of rendered pages.
 * @param ctx - mounted `mcpServers` Remote owner.
 * @returns shared roster snapshot and joined observation cleanup.
 */
export function observeRoster(ctx: Context): { state: SnapshotStore<McpRosterState>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<McpRosterState>({ roster: null, connected: false, error: null })
  let disposed = false
  const isDisposed = (): boolean => disposed
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  const stream = ctx.remote.$stream<McpServersSnapshot>({
    name: 'MCP server roster', open: signal => ctx.remote.mcpServers.follow(signal),
    ended: () => new Error('MCP server roster stream ended'), carrierFailed: fail,
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        state.set({ roster: item.value, connected: true, error: null })
        item.accept()
      }
    } catch (error) { if (!isDisposed()) fail(error) }
  })()
  return { state, dispose: async () => { disposed = true; await stream.dispose(); await observing } }
}
