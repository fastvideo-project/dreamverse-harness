/**
 * A Cordis plugin that only `bootHarness({ stepGate })` mounts, through a row of the isolated profile's patch: it lets a
 * story change the project after a step has claimed its messages and before the `agent/pre-step` listeners read the
 * project. A step whose claimed user messages contain `holdText` waits for `GET <url>/hold` to answer before it
 * delegates to the later listeners. Each wake that an agent claims (message source kind `dv-project-wake`) is reported
 * with `POST <url>/wake`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'

/** The plugin name. */
export const name = 'dv-e2e-step-gate'

/** The test server of the story, and the user text whose step waits for it. */
export interface Config {
  url: string
  holdText: string
}

/**
 * Register the hold and the wake report under `ctx`.
 * @param ctx - the plugin context; disposal removes both listeners.
 * @param config - the story's test server and hold text.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('agent/pre-step', async ({ messages }, next): Promise<PreStepDecision> => {
    const held = messages.some(message => message.source.kind === 'user'
      && message.content.some(block => block.type === 'text' && block.text.includes(config.holdText)))
    if (held) await fetch(`${config.url}/hold`)
    return await next()
  })
  ctx.on('agent/inbox/claimed', ({ message }) => {
    if (message.source.kind === 'dv-project-wake') void fetch(`${config.url}/wake`, { method: 'POST' })
  })
}
