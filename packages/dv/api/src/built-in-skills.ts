/**
 * Built-in skills as the Skills page reads them: one user-invocable skill of a chat's skill catalog, with its body. The
 * catalog view is the one the DSH `skills/list` Remote answers for the same chat: the chat's project folder, and the skill
 * registry of its live Agent's preset, or of its recorded preset through a short scope lease, else the host registry.
 * The view must follow that Remote's, so the page shows the skill the agent would load.
 *
 * @module @dv/api/built-in-skills
 */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-skill'
import { answer, ApiRequestError } from './api.ts'
import type { SavedSkillText } from './user-skills.ts'

/** @throws ApiRequestError `404 skill_not_found`. */
function notFound(): never {
  throw new ApiRequestError(404, 'No built-in skill uses this name', 'skill_not_found')
}

/** @throws ApiRequestError `404 skills_unavailable` with the given reason: the host cannot read skills at all. */
function unavailable(reason: string): never {
  throw new ApiRequestError(404, reason, 'skills_unavailable')
}

/**
 * Read one user-invocable skill of a chat's catalog with its instructions.
 * @param ctx - the host context with the session query, Agent, preset and skill services.
 * @param session - the chat whose catalog view to read.
 * @param name - the skill's `/name`.
 * @returns its name, description, instructions, and SKILL.md path ('' for a skill no file defines).
 * @throws ApiRequestError `404 skill_not_found` for an unknown chat or skill, or a skill only the agent may load;
 * `404 skills_unavailable` when the host has no session query or skill registry.
 */
export async function readBuiltInSkill(ctx: Context, session: string, name: string): Promise<SavedSkillText> {
  const query = ctx.get('sessionQuery')
  if (session === '' || name === '') return notFound()
  const sessionId = brandString<SessionId>(session)
  if (query === undefined) return unavailable('The harness cannot read chat sessions')
  let cwd: string | undefined
  let preset: string | undefined
  try {
    using observation = await query.observeSession(sessionId)
    cwd = observation.header.cwd
    preset = observation.projections?.values.agentPreset ?? undefined
  } catch (error) {
    if ((error as { code?: unknown }).code === 'SESSION_QUERY_SESSION_NOT_FOUND') return notFound()
    throw error
  }
  const live = ctx.get('agents')?.get(sessionId)
  const presets = ctx.get('agentPresets')
  const registry = (live === undefined ? undefined : presets?.serviceFor(live, 'skills')) ?? ctx.get('skills')
  if (registry === undefined) return unavailable('The harness has no skill registry')
  // An unknown or unusable recorded preset reads the host registry, as the skills/list Remote does.
  await using lease = live === undefined && presets !== undefined ? await presets.acquireScope(preset).catch(() => undefined) : undefined
  const skill = await registry.get(name, { ...cwd === undefined ? {} : { cwd }, scope: live ?? lease?.key })
  if (skill === undefined || !skill.invocation.userInvocable) return notFound()
  return { name: skill.name, description: skill.description, instructions: skill.content, path: skill.path ?? '' }
}

/**
 * @param ctx - the host context the route reads skills through.
 * @returns `GET /api/dv/skills/built-in?session=...&name=...`.
 */
export function builtInSkillRoutes(ctx: Context): ConnectionFetchRoute[] {
  return [{
    path: '/api/dv/skills/built-in', methods: ['GET'], requestBody: 'buffered',
    fetch: (request) => {
      const params = new URL(request.url).searchParams
      return answer(() => readBuiltInSkill(ctx, params.get('session') ?? '', params.get('name') ?? ''))
    },
  }]
}
