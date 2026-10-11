/**
 * MCP presets of DreamVerse: offers the configured MCP servers to the MCP plugin's roster for one-step adding. The
 * offer exists only while the MCP plugin is on (its `mcpServers` service is mounted) and is withdrawn when it is
 * switched off; the presets are a DreamVerse choice, and the MCP plugin owns adding and connecting them.
 *
 * @module @dv/mcp-presets
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-mcp-servers'
import { ServerSpec } from '@deepseek-ai/dsh-mcp-servers/schema'
import type { McpServerPreset } from '@deepseek-ai/dsh-mcp-servers/types'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dv-mcp-presets'

/** Plugin config: the presets DreamVerse offers. */
export interface Config {
  /** Presets by the server name each adds. */
  presets: Record<string, McpServerPreset>
}

export const Config: z<Config> = z.object({
  presets: z.dict(z.object({
    title: z.string().min(1).required(),
    description: z.string().default(''),
    spec: ServerSpec.required(),
  })).default({}),
}) as never

/**
 * Offer the presets whenever the MCP roster is mounted. The roster is optional: with the MCP plugin off this row stays
 * active and offers nothing.
 * @param ctx - plugin context.
 * @param config - the presets.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['mcpServers'], (scope) => {
    scope.effect(() => scope.mcpServers.offerPresets(config.presets), 'dv-mcp-presets: offer')
  })
}
