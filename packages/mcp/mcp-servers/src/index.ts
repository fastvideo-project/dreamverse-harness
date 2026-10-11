/**
 * User-managed MCP server roster: keeps the servers a person added in this plugin's profile entry, mounts one
 * `@deepseek-ai/dsh-mcp-client` instance per server, and serves the roster with live connection state to the browser
 * through the `mcpServers` Remote.
 *
 * @module @deepseek-ai/dsh-mcp-servers
 */
import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { ServerSpec } from './schema.ts'
// Type-only: `ctx.tools`, the `settings` service that persists the roster into this plugin's profile entry, and the
// Loader's `loader/volatile-update` event.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { McpServerPhase, McpServerPreset, McpServerSpec, McpServersSnapshot, McpServerView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-managed MCP server roster. */
    mcpServers: McpServers
  }
}

/** Server names become the `<server>` segment of `mcp__<server>__<tool>`; the MCP client enforces the same pattern. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Plugin config: the roster is live, so saving it reconnects servers without reloading this plugin. */
export interface Config {
  /** Configured servers by name. */
  servers: Volatile<Record<string, McpServerSpec>>
  /** Timeout per MCP tool call in milliseconds, passed to every server's client. */
  toolCallTimeoutMs: number
}

/**
 * Copy a spec into fresh arrays and records with only the fields of its transport.
 * @param spec - saved or submitted server settings.
 * @returns a mutable copy accepted by the profile and the MCP client config.
 */
function copySpec(spec: McpServerSpec): { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'streamable-http'; url: string; headers: Record<string, string> } {
  return spec.transport === 'stdio'
    ? { transport: 'stdio', command: spec.command, args: [...spec.args], env: { ...spec.env } }
    : { transport: 'streamable-http', url: spec.url, headers: { ...spec.headers } }
}

/** One mounted MCP client and what its startup reported. */
interface Mount {
  /** Serialized spec, compared to detect edits. */
  readonly key: string
  readonly spec: McpServerSpec
  readonly fiber: Fiber
  phase: McpServerPhase
  error?: string
}

/** Roster owner and `mcpServers` Remote. */
export default class McpServers extends TypertRemoteService {
  static inject = ['tools']
  static Config = z.object({
    servers: z.dict(ServerSpec).default({}).volatile(),
    toolCallTimeoutMs: z.natural().min(1).default(60_000),
  })

  private readonly mounts = new Map<string, Mount>()
  private readonly listeners = new Set<() => void>()
  /** Presets offered by mounted `mcp-presets` rows, by server name. */
  private readonly presets = new Map<string, McpServerPreset>()
  private readonly lifetime = new AbortController()
  /** Profile-local entry id used by Settings; absent when the plugin was mounted without Loader. */
  private readonly entryId: string | undefined
  /** Serializes roster reconciliation so a removed server's name is released before it is reused. */
  private reconciling: Promise<void> = Promise.resolve()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'mcpServers')
    this.entryId = ctx.fiber.entry?.options.id
    ctx.on('loader/volatile-update', () => { this.reconcile() })
    ctx.on('tools/change', () => { this.changed() })
    ctx.effect(() => () => {
      this.lifetime.abort(new Error('MCP server roster disposed'))
      this.listeners.clear()
    }, 'mcpServers.lifetime')
    this.reconcile()
  }

  /**
   * Read the roster with connection state and registered tools.
   * @returns every configured server, sorted by name.
   */
  @Remote
  snapshot(): McpServersSnapshot {
    const schemas = this.ctx.tools.schemas()
    const servers = [...this.mounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, mount]): McpServerView => {
      const prefix = `mcp__${name}__`
      const tools = schemas.filter(schema => schema.name.startsWith(prefix))
        .map(schema => ({ name: schema.name, description: schema.description }))
        .sort((a, b) => a.name.localeCompare(b.name))
      return { name, spec: mount.spec, phase: mount.phase, ...mount.error === undefined ? {} : { error: mount.error }, tools }
    })
    const configured = this.config.servers.get()
    const presets = [...this.presets.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, preset]) => ({ name, title: preset.title, description: preset.description, added: Object.hasOwn(configured, name) }))
    return { servers, presets }
  }

  /**
   * Follow the roster; a slow reader receives only the latest snapshot.
   * @param signal - observer lifetime.
   * @returns an initial snapshot followed by one after each roster, connection, or tool change.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<McpServersSnapshot> {
    const observed = AbortSignal.any([signal, this.lifetime.signal])
    observed.throwIfAborted()
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const aborted = (): boolean => observed.aborted
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.listeners.add(notify)
    observed.addEventListener('abort', notify, { once: true })
    try {
      while (!aborted()) {
        if (!changed) await wake.promise
        if (aborted()) break
        wake = Promise.withResolvers<undefined>(); changed = false
        yield this.snapshot()
      }
    } finally {
      this.listeners.delete(notify)
      observed.removeEventListener('abort', notify)
    }
  }

  /**
   * Save a server into the profile; the saved roster connects it.
   * @param name - new server name, `[A-Za-z0-9_-]{1,32}`.
   * @param spec - launch or endpoint settings.
   * @returns after the profile write.
   */
  @Remote
  async addServer(name: string, spec: McpServerSpec): Promise<void> {
    if (!SERVER_NAME_PATTERN.test(name)) throw new Error(`MCP server name must match ${SERVER_NAME_PATTERN.source}: ${name}`)
    const servers = this.config.servers.get()
    if (Object.hasOwn(servers, name)) throw new Error(`MCP server already exists: ${name}`)
    await this.save({ ...servers, [name]: copySpec(spec) })
  }

  /**
   * Save an offered preset into the profile under its own name; the saved roster connects it.
   * @param name - preset name from the snapshot's `presets`.
   * @returns after the profile write.
   */
  @Remote
  async addPreset(name: string): Promise<void> {
    const preset = this.presets.get(name)
    if (preset === undefined) throw new Error(`MCP preset does not exist: ${name}`)
    await this.addServer(name, preset.spec)
  }

  /**
   * Delete a server from the profile; the saved roster disconnects it and withdraws its tools.
   * @param name - configured server name.
   * @returns after the profile write.
   */
  @Remote
  async removeServer(name: string): Promise<void> {
    const { [name]: removed, ...rest } = this.config.servers.get()
    if (removed === undefined) throw new Error(`MCP server does not exist: ${name}`)
    await this.save(rest)
  }

  /**
   * Reconnect one configured server, for example after starting the program it talks to.
   * @param name - configured server name.
   * @returns after the reconnect attempt settles.
   */
  @Remote
  async reconnectServer(name: string): Promise<void> {
    const mount = this.mounts.get(name)
    if (mount === undefined) throw new Error(`MCP server does not exist: ${name}`)
    await this.enqueue(async () => {
      if (this.mounts.get(name) !== mount) return
      await this.unmount(name)
      this.mount(name, mount.spec)
    })
  }

  /**
   * Offer presets for one-step adding; a name another row already offers fails without offering any.
   * @param presets - presets by the server name each adds.
   * @returns disposer withdrawing these presets.
   */
  offerPresets(presets: Readonly<Record<string, McpServerPreset>>): () => void {
    const names = Object.keys(presets)
    const taken = names.filter(name => this.presets.has(name))
    if (taken.length > 0) throw new Error(`MCP presets are already offered: ${taken.join(', ')}`)
    for (const name of names) this.presets.set(name, presets[name] as McpServerPreset)
    this.changed()
    return () => {
      for (const name of names) this.presets.delete(name)
      this.changed()
    }
  }

  private async save(servers: Record<string, McpServerSpec>): Promise<void> {
    const settings = this.ctx.get('settings')
    if (settings === undefined || this.entryId === undefined) throw new Error('Saving MCP servers requires the settings service and a profile entry')
    await settings.replace(this.entryId, { servers })
  }

  /** Bring the mounted clients in line with the saved roster: drop removed or edited servers, then mount new ones. */
  private reconcile(): void {
    void this.enqueue(async () => {
      if (this.lifetime.signal.aborted) return
      const desired = this.config.servers.get()
      for (const [name, mount] of [...this.mounts]) {
        const spec = desired[name]
        if (spec === undefined || JSON.stringify(spec) !== mount.key) await this.unmount(name)
      }
      for (const [name, spec] of Object.entries(desired)) {
        if (!this.mounts.has(name)) this.mount(name, spec)
      }
      this.changed()
    })
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.reconciling.then(task)
    this.reconciling = next.catch((error: unknown) => { this.ctx.logger.error(error) })
    return next
  }

  private mount(name: string, spec: McpServerSpec): void {
    const fiber = this.ctx.plugin(mcpClient, {
      ...copySpec(spec), serverName: name, failOnStartupError: true, toolCallTimeoutMs: this.config.toolCallTimeoutMs,
    })
    const mount: Mount = { key: JSON.stringify(spec), spec, fiber, phase: 'connecting' }
    this.mounts.set(name, mount)
    const settle = (phase: McpServerPhase, error?: string): void => {
      if (this.mounts.get(name) !== mount) return
      mount.phase = phase
      if (error !== undefined) mount.error = error
      this.changed()
    }
    fiber.await().then(
      () => { settle('connected') },
      (error: unknown) => { settle('failed', error instanceof Error ? error.message : String(error)) },
    )
  }

  private async unmount(name: string): Promise<void> {
    const mount = this.mounts.get(name)
    if (mount === undefined) return
    this.mounts.delete(name)
    this.changed()
    await mount.fiber.dispose()
  }

  private changed(): void { for (const listener of this.listeners) listener() }
}
