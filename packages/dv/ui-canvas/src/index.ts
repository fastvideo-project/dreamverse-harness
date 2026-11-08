/**
 * Host half of the canvas plugin: the canvas layout store, its authenticated Fetch route while a Connection service is
 * mounted, and the agent's `dv_canvas_read` and `dv_canvas_move` tools. Each tool call reads the cards that an open
 * canvas of the calling agent's project, beside the agent's chat session, draws, through the canvas stream of
 * `CanvasChannel`, so the host keeps no copy of the canvas. A move is planned here and written to the layout store
 * here, once; then a `moved` frame tells every open canvas of the project to draw it. A move writes no record, and
 * `dv_proj_undo` does not revert it. The browser half in `src/client/` registers the tab and the center view.
 *
 * @module @dv/ui-canvas
 */
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { PROJECT_DIR, workspaceOfSession } from '@dv/project/folder'
import { CanvasChannel } from './agent-channel.ts'
import { CANVAS_MOVE, CANVAS_READ, cardsAfter, parseDrawn, planMove, refusalSentence } from './canvas.ts'
import { CanvasLayoutStore, layoutRoutes } from './layout.ts'
import type { CanvasCard, NodeMove } from './types.ts'

export type * from './types.ts'

/** Required host services: the Workspace registry, which holds each project's folder. */
export const inject = ['workspaceRegistry']

/** Host half configuration. */
export interface Config {
  /** How long a canvas tool waits for an open canvas of the project to answer the read, in ms. The write is not timed. */
  answerTimeoutMs: number
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  answerTimeoutMs: z.natural().min(1).default(10_000),
})

const NO_PROJECT = 'This conversation has no project yet: call dv_proj_create first. Nothing was moved.'
const DELEGATED = 'The canvas tools serve only the agent of the user\'s conversation, and another agent started this one. '
  + 'Put the canvas change you want in your final result, so that the agent that started you can make it. Nothing was moved.'
const UNREADABLE = 'The open canvas sent an answer that the canvas tools cannot read. Nothing was moved.'
const CANCELLED = 'The call was cancelled before the move was stored. Nothing was moved.'
const noCanvas = (project: string): string => `No open canvas shows project ${project}, so no node is known. Ask the user `
  + 'to open the canvas of this project, then call dv_canvas_read again. Nothing was moved.'

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

/**
 * Loader entry: build the layout store, register its route while the Connection is mounted, and register the two tools
 * while the DSH tool registry is mounted.
 * @param ctx - host plugin context.
 * @param config - the answer timeout.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new CanvasLayoutStore(ctx.workspaceRegistry)
  const channel = new CanvasChannel()
  ctx.effect(() => () => { channel.dispose() }, 'ui-canvas: canvas streams')
  ctx.inject(['connection'], (connected) => {
    for (const route of [...layoutRoutes(store), ...channel.routes()]) {
      connected.effect(() => {
        const dispose = connected.connection.fetch.register(route)
        return () => { void dispose() }
      }, `ui-canvas ${route.path}`)
    }
  })

  /** The project of the agent's conversation: the Workspace of its working directory, when that folder is a project. */
  const chatProject = async (agent: Agent): Promise<WorkspaceId | null> => {
    const cwd = agent.session.header.cwd
    const folder = cwd === undefined ? undefined : await realpath(cwd).catch(() => undefined)
    const workspace = workspaceOfSession(ctx.workspaceRegistry.list(), folder)
    return workspace !== undefined && existsSync(join(workspace.path, PROJECT_DIR)) ? workspace.id : null
  }

  /**
   * The cards that an open canvas of `project` beside the agent's chat session draws. Only this read is timed. It fails
   * at once when no such canvas is open, with `noCanvas` at the timeout, and with CANCELLED when the call is cancelled
   * first.
   */
  const readCards = async (project: string, agent: Agent, cancel: AbortSignal): Promise<CanvasCard[]> => {
    if (cancel.aborted) throw new Error(CANCELLED)
    const signal = AbortSignal.any([cancel, AbortSignal.timeout(config.answerTimeoutMs)])
    const asked = channel.ask(project, agent.session.id, signal)
    if (asked === null) throw new Error(noCanvas(project))
    const answer = await asked.catch(() => { throw new Error(cancel.aborted ? CANCELLED : noCanvas(project)) })
    const cards = parseDrawn(answer, project)
    if (cards === null) throw new Error(UNREADABLE)
    return cards
  }

  /**
   * One canvas tool call; `moves` is null for a read. The stored positions win over a canvas that has not drawn another
   * tab's drag. A cancel before the write leaves everything as it was. The write is synchronous, so once it starts it
   * finishes, and every open canvas of the project draws it.
   */
  const run = async (moves: readonly NodeMove[] | null, exec: ToolRunContext): Promise<JsonValue> => {
    const agent = exec.agent
    if (agent === undefined) throw new Error(NO_PROJECT)
    const agents = ctx.get('agents')
    if (agents !== undefined && !agents.roots().includes(agent)) throw new Error(DELEGATED)
    const project = await chatProject(agent)
    if (project === null) throw new Error(NO_PROJECT)
    const cards = cardsAfter(await readCards(project, agent, exec.signal), store.read(project).positions)
    if (moves === null) return { project, cards }
    const plan = planMove(cards, moves)
    if (plan.kind !== 'move') throw new Error(refusalSentence(plan))
    if (exec.signal.aborted) throw new Error(CANCELLED)
    try {
      store.write(project, { positions: plan.positions })
    } catch (error) {
      throw new Error(`The layout store refused the move: ${error instanceof Error ? error.message : String(error)} Nothing was moved.`, { cause: error })
    }
    channel.moved({ project, positions: plan.positions })
    return { project, moved: moves.length, cards: cardsAfter(cards, plan.positions) }
  }
  ctx.inject(['tools'], (tooled) => {
    tooled.effect(() => tooled.tools.register(defineTool({
      name: CANVAS_READ,
      description: 'Read the canvas of this project that the user has open: every node with its id, type, title and record, its box (x and y of the top-left corner of the node; width and height of its frame, which sits below a 20-unit caption, so the node spans y to y + 20 + height; canvas units, y grows downward), and rendering: true while the node\'s record is still being generated. A rendering node can change size and position when it finishes. Fails when no canvas of this project is open.',
      parameters: {},
      output: JSON_OUTPUT,
      execute: (_args, exec) => run(null, exec),
    })), 'ui-canvas: dv_canvas_read')
    tooled.effect(() => tooled.tools.register(defineTool({
      name: CANVAS_MOVE,
      description: 'Move canvas nodes in one call: list each node you place with the new x and y of the top-left corner of its card, planned from the boxes that dv_canvas_read returned. Keep at least 24 units between a moved card and every other card. Nodes you do not list stay where they are, and every node keeps its width and height. The call moves nothing when a node is unknown or listed twice, or when a moved card would come closer than 24 units to another card. The user sees the move at once. A move is not a step of the project history: dv_proj_undo does not revert it; to restore, move the nodes back. Returns the canvas after the move.',
      parameters: {
        moves: {
          type: 'array', required: true, description: 'The nodes to move, each with the new top-left corner of its card.',
          items: {
            type: 'object', additionalProperties: false, properties: {
              node: { type: 'string', required: true, description: 'The node id, as dv_canvas_read lists it.' },
              x: { type: 'number', required: true, description: 'The new left edge of the card.' },
              y: { type: 'number', required: true, description: 'The new top edge of the card.' },
            },
          },
        },
      },
      output: JSON_OUTPUT,
      execute: (args, exec) => run(args.moves, exec),
    })), 'ui-canvas: dv_canvas_move')
  })
}
