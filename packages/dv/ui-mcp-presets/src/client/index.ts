/**
 * Browser half: register the servers DreamVerse suggests as a section of the MCP page (an `mcp.page.section` entry),
 * and follow the MCP roster.
 *
 * @module @dv/ui-mcp-presets/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-mcp-servers/client'
import { McpShelf } from './McpShelf.tsx'
import { followMcpShelf } from './shelf.ts'

/** Required browser services: the DSH UI slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the section once the MCP page declares `mcp.page.section`, which it does while the MCP
 * plugin is on.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('mcp.page.section', () => ctx.slots.register(
    { name: 'mcp.page.section', id: 'dv-mcp-presets' }, McpShelf,
  )), 'ui-mcp-presets: MCP page section')
  followMcpShelf(ctx)
}
