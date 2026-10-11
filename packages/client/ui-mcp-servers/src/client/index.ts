/**
 * Browser entry: mounts the `mcpServers` Remote, adds the sidebar's MCP entry with the MCP page it opens, and puts the
 * same roster dashboard on the MCP plugin page. The entry exists while the MCP bundle is switched on.
 */
import type { Context } from '@deepseek-ai/cordis'
import mcpServersRemote from '@deepseek-ai/dsh-mcp-servers/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { McpServersPage, type McpServersInjected } from './McpServersPage.tsx'
import { McpPanelIcon, McpPanelPage } from './McpPanel.tsx'
import { en, NS, zh } from './locales.ts'
import { observeRoster } from './roster.ts'

/** Bundle whose plugin page shows the dashboard. */
const MCP_BUNDLE = '@deepseek-ai/dsh-mcp-bundle'

/** The id shared by the sidebar entry and the main panel it opens; Plugins (order 0) stays above it. */
const PANEL_ID = 'mcp' as MainPanelId

export const inject = ['remote', 'slots', 'locale']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const roster = observeRoster(ctx)
  ctx.effect(() => roster.dispose)
  const unwrap = async (call: Promise<{ ok: true } | { ok: false; error: unknown }>): Promise<void> => {
    const result = await call
    if (!result.ok) throw result.error
  }
  const actions: McpServersInjected = {
    hooks: { mcpRoster: roster.state },
    add: (name, spec) => unwrap(ctx.remote.mcpServers.addServer(name, spec)),
    remove: name => unwrap(ctx.remote.mcpServers.removeServer(name)),
    retry: name => unwrap(ctx.remote.mcpServers.reconnectServer(name)),
  }
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: MCP_BUNDLE, locale: NS, inject: () => actions,
  }, McpServersPage))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS, inject: () => actions,
  }, McpPanelPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 1, label: () => ctx.locale.bind(NS)('panel'), locale: NS,
  }, McpPanelIcon))
}

/**
 * Mount the Remote, then the dashboard; the disposer withdraws both.
 * @param ctx - Client runtime owning the Remote, dictionaries and slots.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(mcpServersRemote)
  const ui = ctx.inject(['remote.mcpServers', 'slots', 'locale'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
