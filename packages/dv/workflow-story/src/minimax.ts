/** Optional MiniMax routing, using the existing filesystem skill provider and Agent context hook. */
import { readFile, realpath } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@dv/project'
import { continuesMiniMaxTask, isMiniMaxSkill, selectMiniMaxSkill, type MiniMaxSkill } from './minimax-routing.ts'
import { miniMaxPreflight, MINIMAX_STEPS } from './minimax-compatibility.ts'

const ROOT = fileURLToPath(new URL('../minimax/skills/', import.meta.url))
const PROVIDER = 'minimax-h3'
const SOURCE = 'dv-minimax-skill'

function lastSelection(agent: Agent): { skill: MiniMaxSkill | null } | undefined {
  const message = agent.session.deriveMessages().findLast(item => item.role === 'user' && item.source.kind === SOURCE)
  if (message?.role !== 'user' || message.source.kind !== SOURCE) return undefined
  const skill = message.source.skill
  return skill === null || (typeof skill === 'string' && isMiniMaxSkill(skill)) ? { skill } : undefined
}

function textOf(message: UserMessage): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/**
 * Route saved project choices and startup defaults; disposal removes every scoped contribution.
 * @param ctx - plugin context with skills, tools, agents, systemPrompt and dvProject injected.
 * @param selection - off, auto or the validated manual default skill name.
 */
export function installMiniMax(ctx: Context, selection: string): void {
  if (selection !== 'off' && selection !== 'auto' && !isMiniMaxSkill(selection)) throw new Error(`Unknown DV_MINIMAX_SKILL: ${selection}`)
  const fallback = selection
  const selectionFor = (agent: Agent): MiniMaxSkill | 'auto' | 'off' => {
    const project = ctx.dvProject.listProjects().find(item => item.path === agent.session.header.cwd)
    const chosen = project === undefined ? undefined : ctx.dvProject.miniMaxSkill(project.id)
    return chosen === undefined ? fallback : chosen ?? 'off'
  }
  const modeFor = (agent: Agent | undefined): string => {
    const configured = agent === undefined ? selection : selectionFor(agent)
    return configured === 'off' || configured === 'auto' ? configured : 'manual'
  }
  const source: unknown = JSON.parse(readFileSync(new URL('../minimax/SOURCE.json', import.meta.url), 'utf8'))
  if (typeof source !== 'object' || source === null || !('revision' in source) || typeof source.revision !== 'string') {
    throw new Error('MiniMax SOURCE.json must contain the pinned source revision.')
  }
  const revision = source.revision
  const mounts = new WeakMap<Agent, { skill: MiniMaxSkill; dispose: () => Promise<void> }>()
  ctx.on('tools/result', (exec, result) => {
    const skill = exec.agent === undefined ? undefined : mounts.get(exec.agent)?.skill
    if (skill === undefined) return
    const stage = MINIMAX_STEPS[exec.name]
    if (stage === undefined && !result.isError) return
    const log = `MiniMax operation: skill=${skill}; mode=${modeFor(exec.agent)}; session=${exec.agent?.id}; call=${exec.callId}; tool=${exec.name}; stage=${stage ?? 'other'}; result=${result.isError ? 'error' : 'ok'}`
    if (result.isError) ctx.logger.warn(`${log}; code=${result.error.info?.code ?? 'TOOL_ERROR'}; see session tool/result for details`)
    else ctx.logger.info(log)
  })
  // Tool schemas are assembled before pre-step routing, so the reader must already be registered.
  const readReference = defineTool({
    name: 'dv_minimax_read_reference',
    description: 'Read a local reference document belonging to the currently selected MiniMax skill. Use only when MiniMax skill instructions list a required reference.',
    parameters: { path: { type: 'string', required: true, description: 'Relative resource path, for example references/ref-en.txt.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const skill = exec.agent === undefined ? undefined : mounts.get(exec.agent)?.skill
      if (skill === undefined) throw new Error('No MiniMax skill is selected for this Agent.')
      const base = await realpath(join(ROOT, skill))
      const path = await realpath(join(base, args.path))
      const local = relative(base, path)
      if (isAbsolute(args.path) || local.startsWith(`..${sep}`) || local === '..' || isAbsolute(local)
        || !/^(references|agents)[/\\].*\.(md|txt|ya?ml)$/u.test(local)) {
        throw new Error('Only reference documents of the selected MiniMax skill can be read.')
      }
      const text = await readFile(path, { encoding: 'utf8', signal: exec.signal })
      ctx.logger.info(`MiniMax reference: skill=${skill}; mode=${modeFor(exec.agent)}; revision=${revision}; session=${exec.agent?.id}; path=${local}`)
      return { path: args.path, text }
    },
  })
  const readers = new WeakSet<Agent>()
  const ensureReader = (agent: Agent): void => {
    if (readers.has(agent)) return
    const tools = agent.ctx.get('tools')
    if (tools === undefined) throw new Error('MiniMax requires the Agent tool registry.')
    ctx.effect(function* () { yield tools.register(readReference) }, 'MiniMax scoped reference reader')
    readers.add(agent)
  }
  ctx.on('agent/created', ({ agent }) => {
    if (selectionFor(agent) !== 'off') ensureReader(agent)
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    const agent = context.agent
    // The Home session may predate project creation. Rebuild once after installing its scoped reader.
    if (agent !== undefined && !readers.has(agent) && selectionFor(agent) !== 'off') {
      ensureReader(agent)
      return ctx.systemPrompt.assemble(context)
    }
    return result
  })
  // Only committed context supplies the continuation state; cancelled pre-steps cannot change it.
  const committed = new WeakMap<Agent['session'], MiniMaxSkill | null>()
  ctx.on('session/event', (session, event) => {
    if (event.type === 'user/message' && event.data.source.kind === SOURCE) committed.set(session, event.data.source.skill)
  })
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const configured = selectionFor(agent)
    if (configured === 'off') return next()
    ensureReader(agent)
    const mode = configured === 'auto' ? 'auto' : 'manual'
    const prior = lastSelection(agent)
    const previous = prior?.skill ?? (prior === undefined ? committed.get(agent.session) ?? null : null)
    const user = messages.findLast(message => message.source.kind === 'user')
    const text = user === undefined ? '' : textOf(user)
    const chosen = configured !== 'auto' ? configured : user === undefined ? previous
      : selectMiniMaxSkill(text) ?? (continuesMiniMaxTask(text) || user.content.some(block => block.type === 'image') ? previous : null)
    const current = mounts.get(agent)
    if (current?.skill !== chosen) {
      await current?.dispose()
      mounts.delete(agent)
      if (chosen !== null) {
        const skill = chosen
        const skills = agent.ctx.get('skills')
        if (skills === undefined) throw new Error('MiniMax routing requires the Agent skill registry.')
        const dispose = ctx.effect(function* () {
          yield skills.registerProvider((control) => {
            const provider = new FileSystemSkillProvider(agent.ctx, control, {
              providerName: PROVIDER, includeDefaultRoots: false, bundledSkillDir: ROOT, watch: false,
            })
            return {
              name: PROVIDER,
              async list(options) {
                const result = await provider.list(options)
                return Array.isArray(result) ? result.filter(item => item.name === skill)
                  : { ...result, candidates: result.candidates.filter(item => item.name === skill) }
              },
              get: (candidate, options) => provider.get(candidate, options),
            }
          })
        }, 'optional MiniMax skill')
        mounts.set(agent, { skill, dispose })
      }
    }
    const decision = await next()
    if (decision.kind !== 'enter' || signal.aborted || (user === undefined && chosen === null)) return decision
    if (chosen === previous && prior !== undefined) return decision
    if (chosen === null && previous === null) return decision
    let body = 'No MiniMax skill is selected for this request. Previous MiniMax workflow instructions do not apply; follow the normal DreamVerse workflow.'
    if (chosen !== null) {
      const loaded = await ctx.skills.get(chosen, { scope: agent, cwd: agent.session.header.cwd, signal })
      if (loaded === undefined || loaded.provider !== PROVIDER) throw new Error(`Cannot load official MiniMax skill ${chosen}`)
      const resources = readdirSync(join(ROOT, chosen), { recursive: true, encoding: 'utf8' }).filter(path => /^(references|agents)[/\\]/u.test(path))
      body = [
        `Selected MiniMax skill: ${chosen} (${configured === 'auto' ? 'automatic routing' : 'explicit manual selection'}).`,
        `Selection mode: ${mode}. Official source revision: ${revision}.`,
        'Use this workflow for the current task. Keep its required stages and confirmation gates. Do not replace it with a different directing workflow.',
        renderSkillContent(loaded),
        readFileSync(new URL('../minimax/compatibility.md', import.meta.url), 'utf8'),
        miniMaxPreflight(ctx, agent, chosen),
        `Reference documents (read when the skill requires them with dv_minimax_read_reference): ${resources.join(', ') || 'none'}.`,
      ].join('\n\n')
    }
    ctx.logger.info(`MiniMax skill: ${chosen ?? 'none'}; mode=${mode}; revision=${revision}; session=${agent.id}`)
    return { ...decision, messages: [...decision.messages, createUserMessage({
      source: { kind: SOURCE, form: 'instructions', skill: chosen, selection: mode }, content: [{ type: 'text', text: body }],
    })] }
  })
}
