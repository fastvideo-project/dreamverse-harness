/** Real Loader composition: optional skill-set installation, lazy loading, old records and complete disposal. */
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { randomUUID } from 'node:crypto'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as MiniMax from '../src/index.ts'
import { MINIMAX_SKILLS } from '../src/catalog.ts'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

async function boot(tools = false, project?: object, routes?: Map<string, ConnectionFetchRoute>) {
  const dir = await mkdtemp(join(tmpdir(), 'minimax-plugin-'))
  const key = randomUUID()
  const globals = globalThis as typeof globalThis & { __miniMaxPlugins?: Record<string, Record<string, object>> }
  globals.__miniMaxPlugins ??= {}
  const plugins: Record<string, object> = { skills: SkillRegistry, 'minimax-skills': MiniMax,
    ...(tools ? { systemPrompt: SystemPrompt, tools: ToolRuntime, agents: AgentRegistry, toolSkill: ToolSkill } : {}) }
  globals.__miniMaxPlugins[key] = plugins
  const ownPatch = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as Array<{ insert: Array<{ id: string; name: string }> }>
  const [ownRow] = ownPatch.flatMap(patch => patch.insert)
  expect(ownRow).toEqual({ id: 'minimax-skills', name: '@dv/minimax-skills' })
  const entries = []
  for (const id of Object.keys(plugins)) {
    const path = join(dir, `${id}.mjs`)
    await writeFile(path, `export default globalThis.__miniMaxPlugins[${JSON.stringify(key)}][${JSON.stringify(id)}]\n`)
    entries.push({ id, name: pathToFileURL(path).href })
  }
  const config = join(dir, 'cordis.yml')
  await writeFile(config, JSON.stringify(entries))
  const ctx = new Context()
  if (project !== undefined) ctx.provide('dvProject', project as never)
  if (routes !== undefined) ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } } as never)
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    delete globals.__miniMaxPlugins?.[key]
    await rm(dir, { recursive: true, force: true })
  })
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  return { ctx, dir }
}

function agentFor(ctx: Context, cwd: string): Agent {
  const id = SessionId('minimax-standalone')
  return { ctx, id, options: {},
    session: Session.create(id, [], { id, version: SESSION_FORMAT_VERSION, createdAt: 0, cwd, isSeeded: false }),
    inbox: unsupportedInbox(), status: 'idle', send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
}

describe('standalone MiniMax skills', () => {
  it('registers all nine with only the central skill registry; lists metadata and loads just the requested body', async () => {
    const { ctx } = await boot()
    const reads = vi.mocked(readFile)
    reads.mockClear()
    const catalog = await ctx.skills.list()
    expect(catalog.map(skill => skill.name).sort()).toEqual([...MINIMAX_SKILLS].sort())
    expect(reads.mock.calls.filter(call => typeof call[0] === 'string' && call[0].endsWith('SKILL.md'))).toHaveLength(0)
    expect(ctx.get('dvProject')).toBeUndefined()
    expect(ctx.get('tools')).toBeUndefined()
    const loaded = await ctx.skills.get('h3-prompt-writing')
    expect(loaded?.content).toContain('DreamVerse Compatibility')
    expect(reads.mock.calls.filter(call => typeof call[0] === 'string' && call[0].endsWith('SKILL.md')).map(call => call[0]))
      .toEqual([expect.stringContaining('/h3-prompt-writing/SKILL.md')])
    await expect(catalog.map(skill => `${skill.name}: ${skill.description}`).join('\n') + '\n')
      .toMatchFileSnapshot('./expected/catalog.txt')
  })

  it('uses the standard slash loader and owns the bounded reference reader', async () => {
    const { ctx, dir } = await boot(true)
    const agent = agentFor(ctx, dir)
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '/h3-prompt-writing Write a product prompt' }] })],
      turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('Unexpected rejected step')
    const instructions = decision.messages.filter(message => message.source.kind === 'skill-invocation')
    expect(instructions).toHaveLength(1)
    const text = instructions.flatMap(message => message.content).flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(text).toContain('DreamVerse Compatibility')
    const directory = fileURLToPath(new URL('../assets/skills/h3-prompt-writing', import.meta.url))
    await expect(text.replaceAll(directory, '$SKILL_DIR') + '\n').toMatchFileSnapshot('./expected/h3-invocation.txt')
    const read = (skill: string, path: string) => ctx.tools.execute({
      name: 'dv_minimax_read_reference', callId: ToolCallId('reference'), arguments: { skill, path }, agent, signal: new AbortController().signal,
    })
    const reference = await read('h3-prompt-writing', 'references/ref-en.txt')
    expect(reference.isError).toBe(false)
    expect(reference.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')).toContain('subject_definitions')
    expect((await read('h3-prompt-writing', '../3d-animation-short-generator/SKILL.md')).isError).toBe(true)
    expect((await read('h3-prompt-writing', '/etc/passwd')).isError).toBe(true)
    expect((await read('unknown-skill', 'references/ref-en.txt')).isError).toBe(true)
    const entry = [...ctx.loader.entries()].find(item => item.options.id === 'minimax-skills')
    await entry?.fiber?.dispose()
    expect(await ctx.skills.list()).toEqual([])
    expect(ctx.tools.get('dv_minimax_read_reference', agent)).toBeUndefined()
  })

  it('reads old project choices using generic records and never rewrites the project', async () => {
    const records = Object.freeze([{ operation: 'proj.create', params: { minimax_skill: 'h3-prompt-writing' } }])
    const projects = { listProjects: () => [{ id: 'old-project', path: '/existing-project' }], listRecords: vi.fn(() => records) }
    const { ctx } = await boot(true, projects)
    const agent = agentFor(ctx, '/existing-project')
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Write a prompt for this product' }] })],
      turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('Unexpected rejected step')
    expect(decision.messages.filter(message => message.source.kind === 'dv-minimax-skill')).toHaveLength(1)
    expect(projects.listRecords).toHaveBeenCalledWith('old-project')
    expect(records).toEqual([{ operation: 'proj.create', params: { minimax_skill: 'h3-prompt-writing' } }])
  })
  it('serves only packaged previews through optional Connection routes and removes them on disposal', async () => {
    const routes = new Map<string, ConnectionFetchRoute>()
    const { ctx } = await boot(false, undefined, routes)
    expect(routes.size).toBe(9)
    const [route] = routes.values()
    if (route === undefined) throw new Error('Missing preview route')
    const response = await route.fetch(new Request(`http://localhost${route.path}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/gif')
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 3))).toBe('GIF')
    expect(routes.has('/api/minimax/previews/../../etc/passwd')).toBe(false)
    await [...ctx.loader.entries()].find(item => item.options.id === 'minimax-skills')?.fiber?.dispose()
    expect(routes.size).toBe(0)
  })

})
