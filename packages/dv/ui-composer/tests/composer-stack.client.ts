/**
 * The plugins that a `dv.prompt` occurrence renders on, as the bundle loads them: DSH's trigger plugin, the
 * `conversation.prompt` Factory of `ui-conversation`, and the composer's prompt registrations. A test runtime mounts
 * `composerStack` after it provides `locale`, which the trigger menu needs.
 */
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { apply as triggerApply, inject as triggerInject } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { registerPromptFactory } from '@deepseek-ai/dsh-client-ui-conversation/src/client/prompt.ts'
import { applyPrompt } from '../src/client/prompt.ts'

/** The composer stack as one plugin. */
export const composerStack = {
  inject: [...triggerInject, 'slots'],
  apply: (ctx: Context): void => {
    ctx.plugin({ inject: [...triggerInject], apply: triggerApply })
    ctx.effect(() => registerPromptFactory(ctx), 'test: conversation.prompt')
    applyPrompt(ctx)
  },
} satisfies Plugin
