/**
 * The host half's `dv_canvas_read` under the DSH tool registry, over project folders in a temporary directory that a fake
 * Workspace registry lists, and open canvases that hold the canvas stream route open and answer through the answer route.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it } from 'vitest'
import { CANVAS_AGENT_ROUTE, CANVAS_ANSWER_ROUTE, parseQuery } from '../src/canvas.ts'
import * as canvasPlugin from '../src/index.ts'
import type { CanvasCard, CanvasQuery } from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** How the test world is set up. */
interface StartOptions {
  /** The calling agent's working directory, by name of a folder in the root; `p1` by default. */
  cwd?: string | null
  /** Runs at each Workspace registry `list()`. */
  onList?: () => void
  answerTimeoutMs?: number
  roots?: () => unknown[]
}

/**
 * Boot the system prompt, the tool registry and the host half over Workspaces `p0` and `p1` (project folders) and
 * `plain` (a folder without `.dreamverse/`), and optionally an agent registry.
 * @returns the context, the calling agent, and the routes.
 */
async function start(options: StartOptions = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dv-canvas-tools-')))
  roots.push(root)
  const workspaces = ['p0', 'p1', 'plain'].map(id => ({ id, path: join(root, id) }) as Workspace)
  for (const { id, path } of workspaces) mkdirSync(id === 'plain' ? path : join(path, '.dreamverse'), { recursive: true })
  const ctx = new Context()
  contexts.push(ctx)
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('connection', {
    fetch: {
      register: (entry: ConnectionFetchRoute) => {
        routes.set(entry.path, entry)
        return () => { routes.delete(entry.path); return Promise.resolve() }
      },
    },
  } as never)
  ctx.provide('workspaceRegistry', {
    list: () => {
      options.onList?.()
      return workspaces
    },
    get: (id: string) => workspaces.find(workspace => workspace.id === id),
  } as never)
  if (options.roots !== undefined) ctx.provide('agents', { roots: options.roots } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(canvasPlugin, { answerTimeoutMs: options.answerTimeoutMs ?? 10_000 })
  const cwd = options.cwd === undefined ? 'p1' : options.cwd
  const agent = { id: 's1', session: { id: 's1', header: cwd === null ? {} : { cwd: join(root, cwd) } } }
  const route = (path: string): ConnectionFetchRoute => {
    const found = routes.get(path)
    if (found === undefined) throw new Error(`no route ${path}`)
    return found
  }
  return { ctx, root, agent, routes, route }
}

type World = Awaited<ReturnType<typeof start>>

/** An open canvas as its browser half acts on its stream: it answers a read with `cards`. */
interface Tab {
  /** Every frame the tab has read, as `event data`. */
  frames: string[]
  /** Disconnect the stream. */
  close(): void
  /** Settles when the host ends the stream. */
  ended: Promise<void>
}

/**
 * Open the canvas stream of `project` beside `session` through the registered route, and act on it as `CanvasViews`
 * does; `answer` replaces the answer to a read.
 */
async function tab(
  world: World, project: string, session: string | null, cards: CanvasCard[], answer?: (read: CanvasQuery) => unknown,
): Promise<Tab> {
  const disconnect = new AbortController()
  const query = new URLSearchParams({ project, ...session === null ? {} : { session } })
  const response = await world.route(CANVAS_AGENT_ROUTE).fetch(new Request(`http://dsh.test${CANVAS_AGENT_ROUTE}?${query.toString()}`, { signal: disconnect.signal }))
  const frames: string[] = []
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  const ready = Promise.withResolvers<undefined>()
  const ended = (async () => {
    let buffered = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffered += chunk.value
      const parts = buffered.split('\n\n')
      buffered = parts.pop() ?? ''
      for (const part of parts) {
        const event = /^event: (\w+)$/mu.exec(part)?.[1]
        const data = /^data: (.*)$/mu.exec(part)?.[1]
        if (event === undefined || data === undefined) continue
        frames.push(`${event} ${data}`)
        if (event === 'ready') ready.resolve(undefined)
        const read = event === 'read' ? parseQuery(JSON.parse(data)) : null
        if (read !== null) {
          const body = answer === undefined ? { ...read, project, cards } : answer(read)
          if (body !== undefined) void post(world, body)
        }
      }
    }
  })()
  await ready.promise
  return { frames, close: () => { disconnect.abort() }, ended }
}

/** Send an answer to the answer route; returns its status. */
async function post(world: World, body: unknown): Promise<number> {
  const request = new Request(`http://dsh.test${CANVAS_ANSWER_ROUTE}`, { method: 'POST', body: JSON.stringify(body) })
  return (await world.route(CANVAS_ANSWER_ROUTE).fetch(request)).status
}

/** Call one tool as the world's agent. */
function call(world: { ctx: Context; agent: object }, name: string, args: Record<string, unknown>, signal = new AbortController().signal) {
  return world.ctx.tools.execute({ callId: ToolCallId('call-1'), name, arguments: args, signal, agent: world.agent as never })
}

/** The error message of a failed call, or null for a result. */
function messageOf(result: Awaited<ReturnType<typeof call>>): string | null {
  return result.isError ? result.error.message : null
}

/** A drawn card of 208 × 130 at (x, y). */
function card(id: string, x: number, y: number): CanvasCard {
  return { id, type: 'text', title: id, shown: id, versions: 1, x, y, width: 208, height: 130, rendering: false }
}

const CARDS = [card('a', 0, 0), { ...card('b', 240, 0), shown: 'b2', versions: 2 }]
const NO_PROJECT = 'This conversation has no project yet: call dv_proj_create first.'
const NO_CANVAS = 'No open canvas shows project p1. Ask the user to open the canvas of this project, then call '
  + 'dv_canvas_read again; dv_proj_state lists the canvas nodes with their positions.'
const CANCELLED = 'The call was cancelled before the open canvas answered.'

describe('dv_canvas_read', () => {
  it('reads the cards keyed by node id, with their versions and the version on show, from a canvas beside the chat only', async () => {
    const world = await start()
    const other = await tab(world, 'p0', 's1', [card('x', 0, 0)])
    const beside = await tab(world, 'p1', 's1', CARDS)
    const elsewhere = await tab(world, 'p1', 's2', [])
    const alone = await tab(world, 'p1', null, [])
    expect(await call(world, 'dv_canvas_read', {})).toMatchObject({ isError: false, value: { project: 'p1', cards: CARDS } })
    const reads = (each: Tab): number => each.frames.filter(frame => frame.startsWith('read ')).length
    expect([other, beside, elsewhere, alone].map(reads)).toEqual([0, 1, 0, 0])
  })

  it('stop asking a canvas whose stream closed, and refuse an answer that no read waits for', async () => {
    const world = await start()
    const beside = await tab(world, 'p1', 's1', CARDS)
    beside.close()
    const started = performance.now()
    expect(messageOf(await call(world, 'dv_canvas_read', {}))).toBe(NO_CANVAS)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(await post(world, { id: 'nobody', project: 'p1', cards: CARDS })).toBe(404)
  })

  it('fails when the call is cancelled before the canvas answers, or no canvas answers in time', async () => {
    const world = await start()
    const asked = Promise.withResolvers<CanvasQuery>()
    await tab(world, 'p1', 's1', CARDS, (read) => { asked.resolve(read); return undefined })
    const stopped = new AbortController()
    const pending = call(world, 'dv_canvas_read', {}, stopped.signal)
    const read = await asked.promise
    stopped.abort(new Error('the user stopped the turn'))
    expect(messageOf(await pending)).toBe(CANCELLED)
    expect(await post(world, { ...read, project: 'p1', cards: CARDS })).toBe(404)
    const looking = new AbortController()
    const lookup = await start({ onList: () => { looking.abort(new Error('the user stopped the turn')) } })
    await tab(lookup, 'p1', 's1', CARDS)
    expect(messageOf(await call(lookup, 'dv_canvas_read', {}, looking.signal))).toBe(CANCELLED)
    const late = await start({ answerTimeoutMs: 20 })
    await tab(late, 'p1', 's1', CARDS, () => undefined)
    expect(messageOf(await call(late, 'dv_canvas_read', {}))).toBe(NO_CANVAS)
  })

  it('settle a read only with an answer that names the read and a stream it was written to, and only once', async () => {
    const world = await start()
    const first = await tab(world, 'p1', 's1', CARDS)
    expect(await call(world, 'dv_canvas_read', {})).toMatchObject({ isError: false })
    const earlier = parseQuery(JSON.parse(first.frames.find(frame => frame.startsWith('read '))!.slice('read '.length)))!
    first.close()
    const asked = Promise.withResolvers<CanvasQuery>()
    await tab(world, 'p1', 's1', CARDS, (read) => { asked.resolve(read); return undefined })
    const pending = call(world, 'dv_canvas_read', {})
    const read = await asked.promise
    const drawn = { project: 'p1', cards: [card('a', 0, 0)] }
    expect(await post(world, { ...read, stream: earlier.stream, ...drawn })).toBe(404)
    expect(await post(world, { id: read.id, ...drawn })).toBe(404)
    expect(await post(world, { id: '1', stream: read.stream, ...drawn })).toBe(404)
    expect(await post(world, { id: earlier.id, stream: read.stream, ...drawn })).toBe(404)
    expect(await post(world, { ...read, ...drawn })).toBe(204)
    expect(await pending).toMatchObject({ isError: false, value: { project: 'p1', cards: drawn.cards } })
    expect(await post(world, { ...read, project: 'p1', cards: CARDS })).toBe(404)
  })

  it('refuse an agent that another agent started, before any canvas is asked', async () => {
    const agents: unknown[] = []
    const world = await start({ roots: () => agents })
    const beside = await tab(world, 'p1', 's1', CARDS)
    expect(messageOf(await call(world, 'dv_canvas_read', {}))).toBe('dv_canvas_read serves only the agent of the user\'s '
      + 'conversation, and another agent started this one. dv_proj_state lists the canvas nodes with their positions.')
    expect(beside.frames).toEqual(['ready {}'])
    agents.push(world.agent)
    expect(await call(world, 'dv_canvas_read', {})).toMatchObject({ isError: false, value: { project: 'p1' } })
    expect(beside.frames).toHaveLength(2)
  })

  it('fails at once when no canvas of the project is open beside the chat, and fails on an unreadable answer', async () => {
    const world = await start()
    await tab(world, 'p0', 's1', [])
    await tab(world, 'p1', 's2', CARDS)
    const started = performance.now()
    expect(messageOf(await call(world, 'dv_canvas_read', {}))).toBe(NO_CANVAS)
    expect(performance.now() - started).toBeLessThan(1000)
    const answers: unknown[] = [{ project: 'p1', cards: [{ id: 'a' }] }, { project: 'p0', cards: CARDS }]
    const unreadable = await tab(world, 'p1', 's1', CARDS, read => ({ ...read, ...answers.shift() as object }))
    for (const _answer of [0, 1]) {
      expect(messageOf(await call(world, 'dv_canvas_read', {}))).toBe('The open canvas sent an answer that dv_canvas_read cannot read.')
    }
    unreadable.close()
  })

  it('fail with the next step when the conversation has no project, without asking a canvas', async () => {
    for (const cwd of [null, 'plain', 'gone', '.']) {
      const world = await start({ cwd })
      const beside = await tab(world, 'p1', 's1', CARDS)
      expect(messageOf(await call(world, 'dv_canvas_read', {}))).toBe(NO_PROJECT)
      expect(beside.frames).toEqual(['ready {}'])
    }
    const { ctx } = await start()
    const withoutAgent = await ctx.tools.execute({
      callId: ToolCallId('call-2'), name: 'dv_canvas_read', arguments: {}, signal: new AbortController().signal,
    })
    expect(messageOf(withoutAgent)).toBe(NO_PROJECT)
  })
  it('describes itself to the model in English', async () => {
    const { ctx } = await start()
    expect(ctx.tools.schemas().find(tool => tool.name === 'dv_canvas_read')?.description).toBe('Read the canvas of this project '
      + 'that the user has open: every node with its id, type, title (its name when it has one), versions (how many versions '
      + 'it holds) and shown (the record of the version it shows), its box (x and y of the top-left corner of the node; '
      + 'width and height of its frame, which sits below a 20-unit caption, so the node spans y to y + 20 + height; canvas '
      + 'units, y grows downward), and rendering: true while the shown version is still being generated. To redo or change '
      + 'a node\'s content, pass based_on with the shown id. To move or resize a node, call dv_canvas_node_position; to '
      + 'rename it, call dv_canvas_node_rename. Fails when no canvas of this project is open.')
  })

  it('leave the tool registry and the Connection when the plugin is disposed', async () => {
    const world = await start()
    const { ctx, routes } = world
    const open = await tab(world, 'p1', 's1', CARDS)
    expect([ctx.tools.get('dv_canvas_read')?.name, ctx.tools.get('dv_canvas_move')]).toEqual(['dv_canvas_read', undefined])
    expect([...routes.keys()].sort()).toEqual([CANVAS_AGENT_ROUTE, CANVAS_ANSWER_ROUTE, '/api/dv/canvas/layout'])
    for (const fiber of ctx.registry.get(canvasPlugin)?.fibers ?? []) await fiber.dispose()
    expect([ctx.tools.get('dv_canvas_read'), routes.size]).toEqual([undefined, 0])
    await open.ended
  })
})
