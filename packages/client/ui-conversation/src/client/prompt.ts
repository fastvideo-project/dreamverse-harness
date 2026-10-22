/**
 * Registration of the `conversation.prompt` Factory: the draft editor that any parent renders, Session or not. Each
 * occurrence opens its own trigger controller, which hands its picks to that occurrence alone.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PromptInjected } from './contract/prompt.ts'
import { PromptOccurrence, type PromptTriggerFace } from './input/prompt-occurrence.ts'
import { PromptEditor } from './skeleton/PromptEditor.tsx'

/**
 * Register the Factory with its chip-face and menu children.
 * @param ctx - client root context holding `slots`; `inputTriggers` is read when an occurrence opens.
 * @returns the registration disposer.
 */
export function registerPromptFactory(ctx: Context): () => void {
  return ctx.slots.registerFactory({
    name: 'conversation.prompt',
    scope: 'session-maybe',
    children: {
      'conversation.prompt.reference': { kind: 'keyed', scope: 'session-maybe' },
      'conversation.prompt.menu': { kind: 'single', scope: 'session-maybe' },
    },
    inject: (): PromptInjected => ({
      open: model => new PromptOccurrence(model, ctx.get('inputTriggers') as PromptTriggerFace | undefined),
    }),
  }, PromptEditor)
}
