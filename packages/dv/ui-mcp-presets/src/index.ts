/**
 * Host half of the DreamVerse MCP tools plugin: nothing. The browser half in `src/client/` draws the MCP tools in the
 * entry page's 探索 section; `@dv/mcp-presets` offers the same presets to the MCP plugin on the host.
 *
 * @module @dv/ui-mcp-presets
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
