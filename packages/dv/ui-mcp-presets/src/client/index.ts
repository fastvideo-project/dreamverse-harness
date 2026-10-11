/**
 * Browser half: register the MCP tools as the MCP tab (a `dv.explore` entry) of the entry page's 探索 section, and
 * follow the MCP plugin's switch and roster.
 *
 * @module @dv/ui-mcp-presets/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-shell'
import { McpShelf } from './McpShelf.tsx'
import { followMcpShelf } from './shelf.ts'

/** Required browser services: the DSH UI slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the MCP tools once `@dv/ui-shell` declares `dv.explore`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('dv.explore', () => ctx.slots.register(
    { name: 'dv.explore', id: 'mcp', order: 0, label: 'MCP' }, McpShelf,
  )), 'ui-mcp-presets: explore entry')
  followMcpShelf(ctx)
}
