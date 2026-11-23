/** The sidebar's MCP entry and the MCP page it opens in the main column. */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { McpServersPage, type McpServersInjected } from './McpServersPage.tsx'
import type { NS } from './locales.ts'
import css from './McpServersPage.module.css'

/**
 * Render the plug glyph at the size the sidebar asks for; the sidebar owns the button, label, and selected state.
 * @param props - the sidebar's icon share: the requested edge.
 * @returns the icon element.
 */
export function McpPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.5 4v4M15.5 4v4M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8ZM12 16.5V20" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The MCP page: a heading, the sections other plugins add in `mcp.page.section`, then the server roster with its add,
 * reconnect, and remove controls.
 * @param props - roster observation, Host actions, the dashboard dictionary, and the section slot.
 * @returns the page element.
 */
export function McpPanelPage(props: InjectFace<McpServersInjected> & PropsLocale<typeof NS> & PropsRenderSlots<'mcp.page.section'>): ReactNode {
  return (
    <section className={css.page} data-mcp-panel>
      <header className={css.pageHead}>
        <h1 className={css.pageTitle}>{props.t('pageTitle')}</h1>
        <p className={css.pageIntro}>{props.t('pageIntro')}</p>
      </header>
      {props.renderSlot('mcp.page.section', {})}
      <McpServersPage {...props} />
    </section>
  )
}
