/** Built-in skills read through a chat's catalog view: the skill the agent would load, with its body. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { builtInSkillRoutes, readBuiltInSkill } from '../src/built-in-skills.ts'

/** A host context with a session query that knows one chat, and optional Agent, preset and skill services. */
function host(services: { skills?: object; agents?: object; agentPresets?: object; preset?: string }) {
  const ctx = new Context()
  const observeSession = vi.fn((sessionId: string) => {
    if (sessionId !== 'chat-1') return Promise.reject(Object.assign(new Error('not found'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' }))
    return Promise.resolve({
      header: { cwd: '/projects/p1' },
      projections: { values: services.preset === undefined ? {} : { agentPreset: services.preset } },
      [Symbol.dispose]: () => {},
    })
  })
  ctx.provide('sessionQuery', { observeSession } as never)
  for (const name of ['skills', 'agents', 'agentPresets'] as const) {
    if (services[name] !== undefined) ctx.provide(name, services[name] as never)
  }
  return ctx
}

const STORYBOARD = {
  name: 'storyboard', description: 'Write the beats', content: 'Write three beats.', path: '/bundle/skills/storyboard/SKILL.md',
  invocation: { modelInvocable: true, userInvocable: true },
}

describe('built-in skills', () => {
  it('reads a skill of a cold chat from the recorded preset scope, and releases the scope after the read', async () => {
    const release = vi.fn(() => Promise.resolve())
    const acquireScope = vi.fn(() => Promise.resolve({ key: 'scope-1', [Symbol.asyncDispose]: release }))
    const get = vi.fn(() => Promise.resolve(STORYBOARD))
    const ctx = host({ skills: { get }, agents: { get: () => undefined }, agentPresets: { acquireScope }, preset: 'dreamverse' })
    await expect(readBuiltInSkill(ctx, 'chat-1', 'storyboard')).resolves.toEqual({
      name: 'storyboard', description: 'Write the beats', instructions: 'Write three beats.', path: '/bundle/skills/storyboard/SKILL.md',
    })
    expect(acquireScope).toHaveBeenCalledWith('dreamverse')
    expect(get).toHaveBeenCalledWith('storyboard', { cwd: '/projects/p1', scope: 'scope-1' })
    expect(release).toHaveBeenCalledOnce()
  })

  it('reads a running chat from its Agent preset registry, and gives a skill no file defines an empty path', async () => {
    const agent = { id: 'chat-1' }
    const get = vi.fn(() => Promise.resolve({ ...STORYBOARD, path: undefined }))
    const ctx = host({ agents: { get: () => agent }, agentPresets: { serviceFor: () => ({ get }), acquireScope: vi.fn() } })
    await expect(readBuiltInSkill(ctx, 'chat-1', 'storyboard')).resolves.toMatchObject({ path: '' })
    expect(get).toHaveBeenCalledWith('storyboard', { cwd: '/projects/p1', scope: agent })
  })

  it('answers 404 for an unknown chat, an unknown skill, or a skill only the agent may load', async () => {
    const definitions: Record<string, unknown> = {
      'model-only': { ...STORYBOARD, name: 'model-only', invocation: { modelInvocable: true, userInvocable: false } },
    }
    const ctx = host({ skills: { get: (name: string) => Promise.resolve(definitions[name]) } })
    const route = builtInSkillRoutes(ctx)[0]!
    const status = async (query: string) => (await route.fetch(new Request(`http://localhost/api/dv/skills/built-in?${query}`))).status
    expect(await status('session=other&name=storyboard')).toBe(404)
    expect(await status('session=chat-1&name=absent')).toBe(404)
    expect(await status('session=chat-1&name=model-only')).toBe(404)
    expect(await status('name=storyboard')).toBe(404)
  })
})
