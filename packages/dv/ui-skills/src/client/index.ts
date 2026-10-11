/**
 * Browser half of the Skills page: the 技能 / Skills entry in the left navigator (a DSH `sidebar.panellist` entry that
 * `@dv/ui-shell` lists below 首页), the page it opens in the main column, and the 技能 / Skills tab of the entry page's
 * 探索 / Explore section (a `dv.explore` entry). The page and the tab read the skills a creator can start with `/name`
 * through DSH's `skills` Remote. 使用 / Use on the page closes the page and puts `/name` into the chat composer through
 * the `dv:compose` event; 使用 in the tab writes `/name` into the draft of the session that the entry page shows.
 *
 * @module @dv/ui-skills/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { dispatchCompose } from '@dv/ui-kit/compose.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import type {} from '@dv/ui-shell'
import { SkillsPage, SkillsPanelIcon, SkillsShelf, type SkillsInjected } from './SkillsPage.tsx'

export { SkillsPage, SkillsShelf, type SkillsInjected } from './SkillsPage.tsx'

/** The id shared by the sidebar entry and the main panel it opens; Plugins (order 0) stays above it. */
export const SKILLS_PANEL_ID = 'skills' as MainPanelId

/** Required browser services: the slot registry, the Remotes, the session list, and the right panel's session seat. */
export const inject = ['slots', 'remote', 'remote.skills', 'sessions', 'sidebarRight']

/**
 * The session whose agent preset selects the skill list: the session the chat shows, else the newest listed session.
 * Every DreamVerse chat uses the one DreamVerse preset, so any of its sessions lists the same skills.
 * @param ctx - client root context.
 * @returns the session ID, or undefined before any session exists.
 */
function catalogSession(ctx: ClientContext): SessionId | undefined {
  const mounted = ctx.sidebarRight.mounted.getSnapshot()
  if (mounted !== undefined) return mounted
  const sessions = Object.values(ctx.sessions.list.getSnapshot().byId)
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id
}

/**
 * Client plugin body: register the page, its navigator entry, and the 探索 / Explore tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const list: SkillsInjected['list'] = async () => {
    const sessionId = catalogSession(ctx)
    if (sessionId === undefined) return []
    const result = await ctx.remote.skills.list({ sessionId })
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value.skills
  }
  const injected: SkillsInjected = {
    list,
    use: (name) => {
      // Close the page first: the composer that takes `dv:compose` is the one the center or the right panel shows.
      ctx.get('layout')?.selectPanel(null)
      dispatchCompose({ text: `/${name}`, refs: [] })
    },
  }
  // The 探索 tab shows only on the entry page, whose center composer edits the draft of the session in the right
  // panel's seat. `dv:compose` there would open the right panel's 对话 tab, so the tab writes the draft directly.
  const shelfInjected: SkillsInjected = {
    list,
    use: (name) => {
      const sessionId = ctx.sidebarRight.mounted.getSnapshot()
      if (sessionId === undefined) return
      const scope = ctx.sessions.scope(sessionId)
      const input = scope?.get('conversation')?.input.for(scope)
      if (input === undefined) return
      input.setDraft(`/${name} `)
      input.focus()
    },
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: SKILLS_PANEL_ID, inject: () => injected }, SkillsPage,
  )), 'ui-skills: page')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: SKILLS_PANEL_ID, order: 2, label: () => pickText('技能', 'Skills') }, SkillsPanelIcon,
  )), 'ui-skills: navigator entry')
  // The 探索 tab waits for `@dv/ui-shell` to declare `dv.explore`; MCP (order 0) stays before it.
  ctx.effect(() => ctx.slots.inject('dv.explore', () => ctx.slots.register(
    { name: 'dv.explore', id: 'skills', order: 1, label: () => pickText('技能', 'Skills'), inject: () => shelfInjected }, SkillsShelf,
  )), 'ui-skills: explore tab')
}
