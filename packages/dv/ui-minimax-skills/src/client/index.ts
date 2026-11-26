/** Optional browser contribution; importing or removing MiniMax never changes shell/project internals. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@dv/ui-shell/contract'
import { Templates, type TemplatesInjected } from './Templates.tsx'

/** Existing browser services needed to prefill a conversation draft. */
export const inject = ['slots', 'sessions', 'sidebarRight']

/** @param ctx - browser context with the existing conversation input and slot registry. */
export function apply(ctx: Context): void {
  const props: TemplatesInjected = {
    use: (name) => {
      const sessionId = ctx.sidebarRight.mounted.getSnapshot()
      if (sessionId === undefined) return
      const session = ctx.sessions.scope(sessionId)
      const input = session?.get('conversation')?.input.for(session)
      if (input === undefined) return
      input.setDraft(`/${name} `)
      input.focus()
    },
  }
  ctx.effect(() => ctx.slots.inject('dv.templates', () => ctx.slots.register({
    name: 'dv.templates', id: 'minimax-templates', inject: () => props,
  }, Templates)), 'MiniMax Home templates')
}
