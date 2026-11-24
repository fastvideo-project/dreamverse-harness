/**
 * State of the servers DreamVerse suggests on the MCP page: the connection phase of each added server and the add
 * requests in flight, read from the `mcpServers` Remote, which is mounted while the MCP plugin is on (the only time the
 * MCP page exists).
 *
 * @module @dv/ui-mcp-presets/shelf
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { McpServerPhase, McpServersSnapshot } from '@deepseek-ai/dsh-mcp-servers/types'
import type {} from '@deepseek-ai/dsh-mcp-servers/remote'

/** How long an add may wait for the Host before the shelf reports a timeout. */
const HOST_TIMEOUT_MS = 30_000

/** The state of one tool card: `loading` until the first roster arrives, `adding` until the Host saves the server. */
export type McpToolState = 'loading' | 'available' | 'adding' | McpServerPhase

/** What the suggested servers show. */
export interface McpShelf {
  /** Whether the roster of the `mcpServers` Remote has arrived. */
  readonly ready: boolean
  /** The connection phase of each added server, by server name. */
  readonly phases: Readonly<Record<string, McpServerPhase>>
  /** The tools whose add request is in flight. */
  readonly adding: ReadonlySet<string>
  /** The last failed add, with the tool it concerns. */
  readonly error: { readonly tool: string; readonly message: string } | null
}

let snapshot: McpServersSnapshot | null = null
const adding = new Set<string>()
let error: McpShelf['error'] = null
let shelf: McpShelf = { ready: false, phases: {}, adding: new Set(), error: null }
const listeners = new Set<() => void>()
let addPreset: ((name: string) => Promise<void>) | undefined

function publish(): void {
  const phases = Object.fromEntries((snapshot?.servers ?? []).map(server => [server.name, server.phase]))
  shelf = { ready: snapshot !== null, phases, adding: new Set(adding), error }
  for (const listener of listeners) listener()
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/**
 * Settle a Host request, or fail it after {@link HOST_TIMEOUT_MS}.
 * @param work - the request.
 * @returns after the request settles.
 */
async function withTimeout(work: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('timed out')) }, HOST_TIMEOUT_MS)
  })
  try { await Promise.race([work, timeout]) } finally { clearTimeout(timer) }
}

/**
 * Read the shelf.
 * @returns the shelf; the same object until it changes.
 */
export function useMcpShelf(): McpShelf {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => shelf,
  )
}

/**
 * The state of one tool card.
 * @param state - the shelf.
 * @param name - the preset name.
 * @returns the card state.
 */
export function toolState(state: McpShelf, name: string): McpToolState {
  if (!state.ready) return 'loading'
  return state.phases[name] ?? (state.adding.has(name) ? 'adding' : 'available')
}

/**
 * Add one preset to the MCP roster.
 * @param name - preset name.
 */
export function addMcpPreset(name: string): void {
  const add = addPreset
  if (add === undefined || adding.has(name)) return
  adding.add(name)
  error = null
  publish()
  // An add from an earlier mount can settle after that mount's dispose cleared the shelf; it must not change the shelf.
  withTimeout(add(name)).then(() => { if (addPreset !== add) return; adding.delete(name); publish() }, (failure: unknown) => {
    if (addPreset !== add) return
    adding.delete(name)
    error = { tool: name, message: message(failure) }
    publish()
  })
}

/**
 * Follow the MCP roster and offer adding presets while the `mcpServers` Remote is mounted.
 * @param ctx - the plugin's client context.
 */
export function followMcpShelf(ctx: Context): void {
  ctx.inject(['remote', 'remote.mcpServers'], (scope) => {
    addPreset = async (name) => {
      const result = await scope.remote.mcpServers.addPreset(name)
      if (!result.ok) throw result.error
    }
    const stream = scope.remote.$stream<McpServersSnapshot>({
      name: 'DreamVerse MCP tools', open: signal => scope.remote.mcpServers.follow(signal),
      ended: () => new Error('MCP tools stream ended'), carrierFailed: () => {},
    })
    let stopped = false
    const isStopped = (): boolean => stopped
    const observing = (async () => {
      try {
        for await (const item of stream) {
          snapshot = item.value
          item.accept()
          publish()
        }
      } catch (failure) { if (!isStopped()) console.warn('ui-mcp-presets: MCP roster stream failed', failure) }
    })()
    scope.effect(() => async () => {
      stopped = true
      addPreset = undefined
      snapshot = null
      adding.clear()
      error = null
      publish()
      await stream.dispose()
      await observing
    }, 'ui-mcp-presets: MCP roster')
  })
}
