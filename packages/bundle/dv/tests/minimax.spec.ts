/** Optional Skill routing through the bundle's actual Loader rows; no media generation or model API calls. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AgentRegistry, { agentEvents, assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { MINIMAX_SKILLS, selectMiniMaxSkill } from '../../../dv/workflow-story/src/minimax-routing.ts'
import { bootBundle, type Bundle } from './bundle.ts'

async function boot(mode: 'off' | 'auto' | 'manual', selection = ''): Promise<Bundle> {
  vi.stubEnv('DV_MINIMAX_SKILLS_MODE', mode)
  vi.stubEnv('DV_MINIMAX_SKILL', selection)
  const bundle = await bootBundle({ skills: SkillRegistry, agents: AgentRegistry, 'tool-skill': ToolSkill })
  onTestFinished(() => bundle.dispose())
  return bundle
}

function agentFor(bundle: Bundle, name: string, session?: Session, cwd = bundle.dir): Agent {
  const id = SessionId(name)
  let scopedContext = bundle.ctx
  const agent: Agent = {
    get ctx() { return scopedContext }, id, options: {},
    session: session ?? Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false }),
    inbox: unsupportedInbox(), status: 'idle', send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
  const scope = createScope(bundle.ctx, agent)
  scopedContext = scope.ctx
  onTestFinished(() => scope.dispose())
  return agent
}

async function step(bundle: Bundle, agent: Agent, text?: string): Promise<UserMessage[]> {
  const messages = text === undefined ? [] : [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })]
  const decision = await agentEvents(bundle.ctx, agent).waterfall('agent/pre-step', {
    messages, turn: 1, step: 1, signal: new AbortController().signal,
  }, () => Promise.resolve({ kind: 'enter' as const, messages }))
  if (decision.kind !== 'enter') throw new Error('Unexpected rejected step')
  for (const message of decision.messages) agent.session.append('user/message', message, { surfaceOp: 'append' })
  return decision.messages
}

async function selected(bundle: Bundle, agent: Agent): Promise<string[]> {
  return (await bundle.ctx.skills.list({ scope: agent })).filter(skill => skill.provider === 'minimax-h3').map(skill => skill.name)
}

function content(messages: UserMessage[]): string {
  return messages.flatMap(message => message.content).flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

describe('MiniMax optional Web workflow support', () => {
  it('uses each project choice, overrides startup mode, and preserves the choice for new agents', async () => {
    const bundle = await boot('off')
    const project = bundle.ctx.dvProject
    const origin = { actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'Choose workflow' } as const
    const on = await project.createProject(await project.newProjectFolder('on'), 'on', origin, '3d-animation-short-generator')
    const off = await project.createProject(await project.newProjectFolder('off'), 'off', origin, null)
    const selectedAgent = agentFor(bundle, 'project-on', undefined, on.path)
    const offAgent = agentFor(bundle, 'project-off', undefined, off.path)
    await agentEvents(bundle.ctx, selectedAgent).serial('agent/created', { source: 'startup' })
    await agentEvents(bundle.ctx, offAgent).serial('agent/created', { source: 'startup' })
    const assembly = await bundle.ctx.systemPrompt.assemble(assembleContextFor(selectedAgent, new AbortController().signal))
    expect(assembly.tools.some(tool => tool.name === 'dv_minimax_read_reference')).toBe(true)
    expect(bundle.ctx.tools.get('dv_minimax_read_reference', offAgent)).toBeUndefined()
    await step(bundle, selectedAgent, 'Make a music video')
    expect(await selected(bundle, selectedAgent)).toEqual(['3d-animation-short-generator'])
    const untouched = await step(bundle, offAgent, '制作一个3D动画短片')
    expect(await selected(bundle, offAgent)).toEqual([])
    expect(untouched.some(message => message.source.kind === 'dv-minimax-skill')).toBe(false)
    const reopened = agentFor(bundle, 'project-reopened', undefined, on.path)
    await step(bundle, reopened, '继续')
    expect(await selected(bundle, reopened)).toEqual(['3d-animation-short-generator'])
  })

  it('an explicitly off project overrides a manual startup default', async () => {
    const bundle = await boot('manual', 'handdrawn-live-video-generator')
    const project = bundle.ctx.dvProject
    const origin = { actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'Off' } as const
    const off = await project.createProject(await project.newProjectFolder('off'), 'off', origin, null)
    const agent = agentFor(bundle, 'explicit-off', undefined, off.path)
    await agentEvents(bundle.ctx, agent).serial('agent/created', { source: 'startup' })
    await step(bundle, agent, '帮我做手绘视频')
    expect(await selected(bundle, agent)).toEqual([])
    expect(bundle.ctx.tools.get('dv_minimax_read_reference', agent)).toBeUndefined()
  })

  it('prepares reference tools on the first request when the Home agent predates its project', async () => {
    const bundle = await boot('off')
    const project = bundle.ctx.dvProject
    const folder = await project.newProjectFolder('home')
    const agent = agentFor(bundle, 'home-first', undefined, folder)
    await agentEvents(bundle.ctx, agent).serial('agent/created', { source: 'startup' })
    expect(bundle.ctx.tools.get('dv_minimax_read_reference', agent)).toBeUndefined()
    await project.createProject(folder, 'home', {
      actor: 'user', surface: 'chat', session: null, turn: null, tool_call: null, intent: 'Choose prompt writing',
    }, 'h3-prompt-writing')
    const assembly = await bundle.ctx.systemPrompt.assemble(assembleContextFor(agent, new AbortController().signal))
    expect(assembly.tools.filter(tool => tool.name === 'dv_minimax_read_reference')).toHaveLength(1)
    await step(bundle, agent, 'Write a prompt')
    const result = await bundle.ctx.tools.execute({ name: 'dv_minimax_read_reference', callId: ToolCallId('first-reference'),
      arguments: { path: 'references/ref-en.txt' }, agent, signal: new AbortController().signal })
    expect(result.isError).toBe(false)
  })
  it('disabled: keeps the original catalog, tool list and instructions', async () => {
    const bundle = await boot('off', 'handdrawn-live-video-generator')
    const agent = agentFor(bundle, 'disabled')
    const messages = await step(bundle, agent, '帮我做手绘发光动画实拍融合视频')
    expect(await selected(bundle, agent)).toEqual([])
    expect(messages.some(message => message.source.kind === 'dv-minimax-skill')).toBe(false)
    expect(bundle.ctx.tools.get('dv_minimax_read_reference', agent)).toBeUndefined()
    expect(await bundle.ctx.skills.get('story-directing', { scope: agent })).toBeDefined()
    expect(await bundle.ctx.skills.get('handdrawn-live-video-generator', { scope: agent })).toBeUndefined()
  })

  it('auto: injects one official skill, keeps confirmation gates and existing media tools, and isolates agents', async () => {
    const bundle = await boot('auto')
    const agent = agentFor(bundle, 'enabled')
    const other = agentFor(bundle, 'other')
    await agentEvents(bundle.ctx, agent).serial('agent/created', { source: 'startup' })
    const assembly = await bundle.ctx.systemPrompt.assemble(assembleContextFor(agent, new AbortController().signal))
    expect(assembly.tools.some(tool => tool.name === 'dv_minimax_read_reference')).toBe(true)
    const messages = await step(bundle, agent, '帮我做手绘发光动画实拍融合视频')
    expect(await selected(bundle, agent)).toEqual(['handdrawn-live-video-generator'])
    expect(await selected(bundle, other)).toEqual([])
    const loaded = await bundle.ctx.skills.get('handdrawn-live-video-generator', { scope: agent })
    expect(content(messages)).toContain(loaded?.content)
    const injected = messages.find(message => message.source.kind === 'dv-minimax-skill')
    expect(injected).toBeDefined()
    const base = loaded?.resourceBase?.kind === 'directory' ? loaded.resourceBase.path : ''
    await expect(content(injected === undefined ? [] : [injected]).replaceAll(base, '$SKILL_DIR') + '\n')
      .toMatchFileSnapshot('./expected/minimax-handdrawn.txt')
    expect(content(messages)).toContain('Do not generate video until the user explicitly confirms H3 generation')
    expect(content(messages)).toContain('ask_user_question')
    for (const name of ['dv_shot_render', 'dv_image_generate', 'dv_audio_generate', 'dv_proj_state', 'dv_textnode_write', 'dv_timeline_create']) {
      expect(bundle.ctx.tools.get(name, agent), name).toBeDefined()
    }
    const unselectedRead = await bundle.ctx.tools.execute({ name: 'dv_minimax_read_reference', callId: ToolCallId('unselected'),
      arguments: { path: 'references/ref-en.txt' }, agent: other, signal: new AbortController().signal })
    expect(unselectedRead.isError).toBe(true)
    const followup = await step(bundle, agent, '确认，继续')
    expect(await selected(bundle, agent)).toEqual(['handdrawn-live-video-generator'])
    expect(followup.filter(message => message.source.kind === 'dv-minimax-skill')).toHaveLength(0)
    await step(bundle, agent, '确认，开始生成 H3 视频')
    expect(await selected(bundle, agent)).toEqual(['handdrawn-live-video-generator'])
    const resumed = agentFor(bundle, 'resumed', agent.session)
    await step(bundle, resumed, '继续')
    expect(await selected(bundle, resumed)).toEqual(['handdrawn-live-video-generator'])
    await step(bundle, agent, '场景是厨房水槽，线条从杯沿开始发光，镜头缓慢跟随')
    expect(await selected(bundle, agent)).toEqual(['handdrawn-live-video-generator'])
    const unrelated = await step(bundle, agent, '帮我剪掉这个视频前两秒')
    expect(await selected(bundle, agent)).toEqual([])
    expect(content(unrelated)).toContain('Previous MiniMax workflow instructions do not apply')
    expect(content(unrelated)).not.toContain('<skill_content name="handdrawn-live-video-generator">')
    await step(bundle, agent, '制作一个3D动画短片')
    expect(await selected(bundle, agent)).toEqual(['3d-animation-short-generator'])
    await step(bundle, agent, '取消这个任务')
    expect(await selected(bundle, agent)).toEqual([])
  })

  it('manual: overrides automatic routing and reads only the selected skill references', async () => {
    const bundle = await boot('manual', 'h3-prompt-writing')
    const logs: string[] = []
    bundle.ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(args.map(String).join(' ')) } })
    const agent = agentFor(bundle, 'explicit')
    await step(bundle, agent, '帮我做极简产品广告')
    expect(await selected(bundle, agent)).toEqual(['h3-prompt-writing'])
    const read = (path: string) => bundle.ctx.tools.execute({
      name: 'dv_minimax_read_reference', callId: ToolCallId(path), arguments: { path }, agent, signal: new AbortController().signal,
    })
    const reference = await read('references/ref-en.txt')
    expect(reference.isError).toBe(false)
    expect(reference.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')).toContain('subject_definitions')
    expect((await read('../3d-animation-short-generator/references/model-selection.md')).isError).toBe(true)
    expect((await read('/etc/passwd')).isError).toBe(true)
    expect(logs.join('\n')).toContain('MiniMax skill: h3-prompt-writing; mode=manual; revision=')
    expect(logs.join('\n')).toContain('path=references/ref-en.txt')
    expect(logs.join('\n')).toContain('stage=reference-read; result=ok')
    expect(logs.join('\n')).toContain('stage=reference-read; result=error')
    const entry = [...bundle.ctx.loader.entries()].find(item => item.options.id === 'dv-workflow-story')
    expect(entry).toBeDefined()
    await entry?.fiber?.dispose()
    expect(await selected(bundle, agent)).toEqual([])
    expect(bundle.ctx.tools.get('dv_minimax_read_reference', agent)).toBeUndefined()
  })

  it('manual 3D: reports unsupported BGM and missing scoped tools before generation', async () => {
    const bundle = await boot('manual', '3d-animation-short-generator')
    const agent = agentFor(bundle, 'manual-3d')
    const videoEntry = [...bundle.ctx.loader.entries()].find(item => item.options.id === 'dv-shot-render')
    expect(videoEntry).toBeDefined()
    await videoEntry?.fiber?.dispose()
    const logs: string[] = []
    bundle.ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(args.map(String).join(' ')) } })
    const messages = await step(bundle, agent, '制作一个3D动画短片')
    expect(await selected(bundle, agent)).toEqual(['3d-animation-short-generator'])
    expect(content(messages)).toContain('six-column standardized shot table')
    expect(content(messages)).toContain('music: unsupported')
    expect(content(messages)).toContain('audioMix: unsupported')
    expect(content(messages)).toContain('video: missing tools: dv_shot_render')
    expect(content(messages)).toContain('Before any paid generation, disclose missing mandatory capabilities')
    expect(logs.join('\n')).toContain('MiniMax capability: skill=3d-animation-short-generator; session=manual-3d; music: unsupported')
  })

  it('auto: unmatched requests load no MiniMax skill instructions', async () => {
    const bundle = await boot('auto')
    const agent = agentFor(bundle, 'unmatched')
    const messages = await step(bundle, agent, '生成一个海边日落的视频')
    expect(await selected(bundle, agent)).toEqual([])
    expect(messages.some(message => message.source.kind === 'dv-minimax-skill')).toBe(false)
    expect(bundle.ctx.tools.get('dv_minimax_read_reference', agent)).toBeDefined()
  })

  it.each(MINIMAX_SKILLS)('manual: loads only %s and resolves its bundled references', async (name) => {
    const bundle = await boot('manual', name)
    const agent = agentFor(bundle, name)
    const messages = await step(bundle, agent, '使用所选流程')
    expect(await selected(bundle, agent)).toEqual([name])
    const loaded = await bundle.ctx.skills.get(name, { scope: agent })
    expect(loaded).toBeDefined()
    expect(content(messages)).toContain(loaded?.content)
    const root = fileURLToPath(new URL('../../../dv/workflow-story/minimax/skills/', import.meta.url))
    const paths = readdirSync(join(root, name), { recursive: true, encoding: 'utf8' })
      .filter(path => /^(references|agents)[/\\].*\.(md|txt|ya?ml)$/u.test(path))
    for (const path of paths) {
      const result = await bundle.ctx.tools.execute({ name: 'dv_minimax_read_reference', callId: ToolCallId(path),
        arguments: { path }, agent, signal: new AbortController().signal })
      expect(result.isError, `${name}/${path}`).toBe(false)
    }
  })

  it.each([
    ['Write an H3 prompt for a bottle', 'h3-prompt-writing'],
    ['Make a hand-drawn live-action video', 'handdrawn-live-video-generator'],
    ['帮我做一个苹果风产品广告', 'minimalist-product-ad-generator'],
    ['帮我做产品广告', 'minimalist-product-ad-generator'],
    ['Create a product advertisement', 'minimalist-product-ad-generator'],
    ['Create a brand promo video', 'brand-promo-video-generator'],
    ['制作一个3D动画短片', '3d-animation-short-generator'],
    ['Make a music video with lyrics subtitles', 'music-video-subtitle-generator'],
    ['帮我做一个MV', 'music-video-subtitle-generator'],
    ['Make a music video', 'music-video-subtitle-generator'],
    ['Write an H3 prompt for a 3D animated short', 'h3-prompt-writing'],
    ['Create a papercraft stop-motion explainer', 'papercraft-stop-motion-explainer'],
    ['Make a paper collage explainer video', 'paper-collage-explainer-generator'],
    ['Create a co-op game intro', 'co-op-game-intro-generator'],
    ['What is 3D animation?', null],
    ['剪掉开头两秒', null],
    ['帮我做KOC口播产品广告', null],
  ])('routes %s to %s', (text, expected) => {
    expect(selectMiniMaxSkill(text)).toBe(expected)
  })

  it.each(MINIMAX_SKILLS)('accepts the exact name %s', (name) => {
    expect(selectMiniMaxSkill(`Use ${name}`)).toBe(name)
  })
})
