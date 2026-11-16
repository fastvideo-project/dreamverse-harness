/** Read existing MiniMax creation-record choices through generic project APIs; never rewrite stored records. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@dv/project'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { isMiniMaxSkill } from './catalog.ts'
import type {} from './source.ts'

/** Keep existing project selections usable without a MiniMax-specific project service method.
 * @param ctx - plugin context owning the pre-step listener.
 * @param projects - whether existing project creation records supply defaults.
 * @param fallback - optional validated startup selection.
 */
export function installLegacySelections(ctx: Context, projects: boolean, fallback?: string): void {
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || signal.aborted) return decision
    const user = messages.findLast(message => message.source.kind === 'user')
    const text = user?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    if (/^\s*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\s|$)/u.test(text)) return decision
    let chosen: unknown = fallback
    const project = projects ? ctx.get('dvProject')?.listProjects().find(item => item.path === agent.session.header.cwd) : undefined
    if (project !== undefined) {
      const service = ctx.get('dvProject')
      const creation = service?.listRecords(project.id).find(record => record.operation === 'proj.create')
      if (creation !== undefined && 'minimax_skill' in creation.params) chosen = creation.params['minimax_skill']
    }
    if (typeof chosen !== 'string' || !isMiniMaxSkill(chosen)) return decision
    const previous = agent.session.deriveMessages().findLast(message => message.role === 'user' && message.source.kind === 'dv-minimax-skill')
    if (previous?.role === 'user' && previous.source.kind === 'dv-minimax-skill' && previous.source.skill === chosen) return decision
    const skill = await ctx.skills.get(chosen, { scope: agent, cwd: agent.session.header.cwd, signal })
    if (skill?.provider !== 'minimax-h3') throw new Error(`MiniMax skill ${chosen} is not available`)
    return { ...decision, messages: [...decision.messages, createUserMessage({
      source: { kind: 'dv-minimax-skill', form: 'instructions', skill: chosen, selection: 'manual' },
      content: [{ type: 'text', text: renderSkillContent(skill) }],
    })] }
  })
}
