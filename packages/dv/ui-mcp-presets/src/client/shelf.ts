/**
 * State of the MCP tools in the entry page's 探索 section: whether the MCP plugin is on, the connection phase of each
 * added server, and the switch and add requests in flight. The `mcpServers` Remote is mounted only while the MCP plugin
 * is on; the `pluginManager` Remote switches the plugin's bundle on.
 *
 * @module @dv/ui-mcp-presets/shelf
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { McpServerPhase, McpServersSnapshot } from '@deepseek-ai/dsh-mcp-servers/types'
import type {} from '@deepseek-ai/dsh-mcp-servers/remote'

/** The bundle that carries the MCP plugin. */
export const MCP_BUNDLE = '@deepseek-ai/dsh-mcp-bundle'

/** How long a switch or an add may wait for the Host before the shelf reports a timeout. */
const HOST_TIMEOUT_MS = 30_000

/** The state of one tool card: `locked` while the MCP plugin is off, `adding` until the Host saves the server. */
export type McpToolState = 'locked' | 'available' | 'adding' | McpServerPhase

/** What the MCP tools show. */
export interface McpShelf {
  /** Whether the MCP plugin is on (its Remote is mounted). */
  readonly on: boolean
  /** Whether the shelf asked the Host to switch the MCP plugin on and waits for it. */
  readonly enabling: boolean
  /** The connection phase of each added server, by server name. */
  readonly phases: Readonly<Record<string, McpServerPhase>>
  /** The tools whose add request is in flight. */
  readonly adding: ReadonlySet<string>
  /** The last failure, with the tool it concerns (null for the switch). */
  readonly error: { readonly tool: string | null; readonly message: string } | null
}

/** The shelf's actions, bound to the plugin's context while it is mounted. */
interface ShelfActions {
  switchOn(): Promise<void>
  addPreset(name: string): Promise<void>
}

let snapshot: McpServersSnapshot | null = null
let enabling = false
const adding = new Set<string>()
let error: McpShelf['error'] = null
let shelf: McpShelf = { on: false, enabling: false, phases: {}, adding: new Set(), error: null }
const listeners = new Set<() => void>()
const actions: Partial<ShelfActions> = {}
let openPanel: (id: MainPanelId) => void = () => {}

function publish(): void {
  const phases = Object.fromEntries((snapshot?.servers ?? []).map(server => [server.name, server.phase]))
  shelf = { on: snapshot !== null, enabling, phases, adding: new Set(adding), error }
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
  if (!state.on) return 'locked'
  return state.phases[name] ?? (state.adding.has(name) ? 'adding' : 'available')
}

/** Switch the MCP plugin on; the shelf unlocks when the `mcpServers` Remote appears. */
export function switchMcpOn(): void {
  const switchOn = actions.switchOn
  if (switchOn === undefined || enabling) return
  enabling = true
  error = null
  publish()
  withTimeout(switchOn()).catch((failure: unknown) => {
    enabling = false
    error = { tool: null, message: message(failure) }
    publish()
  })
}

/**
 * Add one preset while the MCP plugin is on.
 * @param name - preset name.
 */
export function addMcpPreset(name: string): void {
  const addPreset = actions.addPreset
  if (addPreset === undefined || adding.has(name)) return
  adding.add(name)
  error = null
  publish()
  withTimeout(addPreset(name)).then(() => { adding.delete(name); publish() }, (failure: unknown) => {
    adding.delete(name)
    error = { tool: name, message: message(failure) }
    publish()
  })
}

/**
 * Open a DSH sidebar page, such as `plugins` or `mcp`.
 * @param id - the main panel id.
 */
export function openMcpPage(id: 'plugins' | 'mcp'): void {
  openPanel(id as MainPanelId)
}

/**
 * Wire the plugin switch and the page links, and follow the MCP roster while the `mcpServers` Remote is mounted.
 * @param ctx - the plugin's client context.
 */
export function followMcpShelf(ctx: Context): void {
  ctx.inject(['layout'], (scope) => {
    openPanel = (id) => { scope.layout.selectPanel(id) }
    scope.effect(() => () => { openPanel = () => {} }, 'ui-mcp-presets: page links')
  })
  ctx.inject(['remote', 'remote.pluginManager'], (scope) => {
    actions.switchOn = async () => {
      const result = await scope.remote.pluginManager.setBundleEnabled(MCP_BUNDLE, true)
      if (!result.ok) throw result.error
    }
    scope.effect(() => () => { delete actions.switchOn }, 'ui-mcp-presets: MCP switch')
  })
  ctx.inject(['remote', 'remote.mcpServers'], (scope) => {
    actions.addPreset = async (name) => {
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
          enabling = false
          item.accept()
          publish()
        }
      } catch (failure) { if (!isStopped()) console.warn('ui-mcp-presets: MCP roster stream failed', failure) }
    })()
    scope.effect(() => async () => {
      stopped = true
      delete actions.addPreset
      snapshot = null
      adding.clear()
      publish()
      await stream.dispose()
      await observing
    }, 'ui-mcp-presets: MCP roster')
  })
}
