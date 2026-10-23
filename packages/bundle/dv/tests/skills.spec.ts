/**
 * What the DreamVerse agent sees of each workflow skill file `packages/dv/workflow-story/skills/<name>/SKILL.md`. The
 * bundle's host rows boot as in `bundle.ts`, with the DSH skill registry, the agent registry and `tool-skill`. For
 * each file, the catalog that `tool-skill` adds to an agent's step holds its line, the `skill` tool returns its body,
 * and the bundle registers every `dv_*` tool that the file names. `expected/skills/<name>.txt` pins the catalog line
 * and the body, with the skill's base directory as `$SKILL_DIR`.
 */
import { globSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootBundle, type Bundle } from './bundle.ts'

const SKILLS = fileURLToPath(new URL('../../../dv/workflow-story/skills', import.meta.url))
/** The workflow skills, each named by the folder of its `SKILL.md`. */
const NAMES = globSync('*/SKILL.md', { cwd: SKILLS }).map(file => dirname(file)).sort()
const TOOL = /(?<!\w)dv_[a-z]+_\w+/gu
/** `@dv/inspector` registers `dv_inspect_image` only while `llm`, `agentDefaultModel` and `attachments` exist. */
const MODEL_SERVICES = {
  name: 'stand-in-model-services',
  apply(ctx: Context): void {
    ctx.provide('llm', {})
    ctx.provide('agentDefaultModel', {})
    ctx.provide('attachments', {})
  },
}

/** The number of Unicode code points of a text, the unit of the catalog and body limits. */
const codePoints = (text: string): number => Array.from(text).length

/**
 * An idle agent whose Session starts empty in `cwd`; the catalog and the `skill` tool read only its Session.
 * @param cwd - the working directory of the Session.
 * @returns the agent.
 */
function sessionAgent(cwd: string): Agent {
  const id = SessionId('dv-workflow-skills')
  return {
    ctx: new Context(),
    id,
    options: {},
    session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false }),
    inbox: unsupportedInbox(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('the skill catalog does not inject') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/**
 * The lines of the skill catalog message that `tool-skill` adds to the agent's first step.
 * @param ctx - the booted composition.
 * @param agent - the agent whose step starts.
 * @returns the text lines of the catalog message.
 */
async function catalogLines(ctx: Context, agent: Agent): Promise<string[]> {
  const step = { messages: [], turn: 1, step: 1, signal: new AbortController().signal }
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', step, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  if (decision.kind !== 'enter') throw new Error('the first step was rejected')
  return decision.messages.filter(message => message.source.kind === 'skill-catalog')
    .flatMap(message => message.content).flatMap(block => block.type === 'text' ? block.text.split('\n') : [])
}

describe('workflow skill files in the DreamVerse bundle', () => {
  let bundle: Bundle
  let agent: Agent
  let catalog: string[]

  beforeAll(async () => {
    bundle = await bootBundle({ skills: SkillRegistry, agents: AgentRegistry, 'tool-skill': ToolSkill, 'model-services': MODEL_SERVICES })
    agent = sessionAgent(bundle.dir)
    catalog = await catalogLines(bundle.ctx, agent)
  })

  afterAll(async () => {
    await bundle.dispose()
  })

  it.each(NAMES)('%s: the catalog line, the loaded body and every named tool reach the agent', async (name) => {
    const line = catalog.find(text => text.startsWith(`- \`${name}\`: `))
    expect(line, 'catalog entry').toBeDefined()
    expect(codePoints(line ?? '')).toBeLessThanOrEqual(400)
    const loaded = await bundle.ctx.tools.execute({
      callId: ToolCallId(`skill-${name}`), name: 'skill', arguments: { name }, agent, signal: new AbortController().signal,
    })
    if (loaded.isError) throw new Error(loaded.error.message)
    const body = loaded.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(codePoints(body)).toBeLessThan(8192)
    const named = [...new Set(readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8').match(TOOL))]
    expect(named.filter(tool => bundle.ctx.tools.get(tool, agent) === undefined)).toEqual([])
    await expect(`${line ?? ''}\n\n${body.replaceAll(join(SKILLS, name), '$SKILL_DIR')}\n`).toMatchFileSnapshot(`./expected/skills/${name}.txt`)
  })
})
