/**
 * Host half of the canvas plugin: the viewport store, its authenticated Fetch route while a Connection service is
 * mounted, and the agent's `dv_canvas_read` tool. A call reads the cards that an open canvas of the calling agent's
 * project, beside the agent's chat session, draws, through the canvas stream of `CanvasChannel`, because only the
 * browser knows each node type's default size. The node list and its positions belong to `@dv/canvas`, whose
 * `dv_canvas_node_position` moves and resizes a node. The browser half in `src/client/` registers the tab and the center
 * view.
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
import { CANVAS_READ, parseDrawn } from './canvas.ts'
import { CanvasLayoutStore, layoutRoutes } from './layout.ts'
import type { CanvasCard } from './types.ts'

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

const NO_PROJECT = 'This conversation has no project yet: call dv_proj_create first.'
const DELEGATED = 'dv_canvas_read serves only the agent of the user\'s conversation, and another agent started this one. '
  + 'dv_proj_state lists the canvas nodes with their positions.'
const UNREADABLE = 'The open canvas sent an answer that dv_canvas_read cannot read.'
const CANCELLED = 'The call was cancelled before the open canvas answered.'
const noCanvas = (project: string): string => `No open canvas shows project ${project}. Ask the user to open the canvas `
  + 'of this project, then call dv_canvas_read again; dv_proj_state lists the canvas nodes with their positions.'

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

/**
 * Loader entry: build the viewport store, register its route while the Connection is mounted, and register the tool
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

  /** One `dv_canvas_read` call. */
  const read = async (exec: ToolRunContext): Promise<JsonValue> => {
    const agent = exec.agent
    if (agent === undefined) throw new Error(NO_PROJECT)
    const agents = ctx.get('agents')
    if (agents !== undefined && !agents.roots().includes(agent)) throw new Error(DELEGATED)
    const project = await chatProject(agent)
    if (project === null) throw new Error(NO_PROJECT)
    return { project, cards: await readCards(project, agent, exec.signal) }
  }
  ctx.inject(['tools'], (tooled) => {
    tooled.effect(() => tooled.tools.register(defineTool({
      name: CANVAS_READ,
      description: 'Read the canvas of this project that the user has open: every node with its id, type, title (its name '
        + 'when it has one), versions (how many versions it holds) and shown (the record of the version it shows), its box '
        + '(x and y of the top-left corner of the node; width and height of its frame, which sits below a 20-unit caption, '
        + 'so the node spans y to y + 20 + height; canvas units, y grows downward), and rendering: true while the shown '
        + 'version is still being generated. To redo or change a node\'s content, pass based_on with the shown id. To move '
        + 'or resize a node, call dv_canvas_node_position; to rename it, call dv_canvas_node_rename. Fails when no canvas of '
        + 'this project is open.',
      parameters: {},
      output: JSON_OUTPUT,
      execute: (_args, exec) => read(exec),
    })), 'ui-canvas: dv_canvas_read')
  })
}
