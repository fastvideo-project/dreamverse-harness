/**
 * Browser half: register the Feedback row as a `sidebar.footer.action` entry, which the left sidebar draws above
 * Settings.
 *
 * @module @dv/ui-feedback/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { FeedbackAction } from './FeedbackAction.tsx'

/** Required browser services: the DSH UI slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the Feedback row once the sidebar declares `sidebar.footer.action`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'dv-feedback', order: 0 }, FeedbackAction,
  )), 'ui-feedback: sidebar footer action')
}
