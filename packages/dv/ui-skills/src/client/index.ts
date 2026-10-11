/**
 * Browser half of the Skills page: the 技能 / Skills entry in the left navigator (a DSH `sidebar.panellist` entry that
 * `@dv/ui-shell` lists below 首页) and the page it opens in the main column. The page reads the skills a creator can
 * start with `/name` through DSH's `skills` Remote, and 使用 / Use closes the page and puts `/name` into the chat
 * composer through the `dv:compose` event.
 *
 * @module @dv/ui-skills/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { dispatchCompose } from '@dv/ui-kit/compose.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import { SkillsPage, SkillsPanelIcon, type SkillsInjected } from './SkillsPage.tsx'

export { SkillsPage, type SkillsInjected } from './SkillsPage.tsx'

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
 * Client plugin body: register the page and its navigator entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const injected: SkillsInjected = {
    list: async () => {
      const sessionId = catalogSession(ctx)
      if (sessionId === undefined) return []
      const result = await ctx.remote.skills.list({ sessionId })
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value.skills
    },
    use: (name) => {
      // Close the page first: the composer that takes `dv:compose` is the one the center or the right panel shows.
      ctx.get('layout')?.selectPanel(null)
      dispatchCompose({ text: `/${name}`, refs: [] })
    },
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: SKILLS_PANEL_ID, inject: () => injected }, SkillsPage,
  )), 'ui-skills: page')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: SKILLS_PANEL_ID, order: 2, label: () => pickText('技能', 'Skills') }, SkillsPanelIcon,
  )), 'ui-skills: navigator entry')
}
