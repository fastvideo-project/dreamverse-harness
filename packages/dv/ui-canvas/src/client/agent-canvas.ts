/**
 * The agent's view of the mounted canvases of a page: the cards of a drawn graph, and the registry of mounted canvases
 * by project and chat session. For each project and session that a mounted canvas draws, the registry holds one canvas
 * stream of the host half open (`/api/dv/canvas/agent`), answers its reads, and draws its stored moves.
 *
 * @module @dv/ui-canvas/agent-canvas
 */
import type { NodePosition } from '../canvas-layout.ts'
import { CANVAS_AGENT_ROUTE, CANVAS_ANSWER_ROUTE, parseMoved, parseQuery } from '../canvas.ts'
import type { CanvasCard, CanvasDrawn, CanvasQuery } from '../types.ts'
import { NODE_WIDTH } from './graph.ts'
import type { CanvasNode } from './graph.ts'

/** One mounted canvas as the registry sees it, registered while its layout and graph are loaded. */
export interface MountedCanvas {
  readonly projectId: string
  /** The chat session the canvas sits beside; only a canvas beside the calling agent's session answers its reads. */
  readonly session: string | null
  /** The cards as drawn now. */
  cards(): CanvasCard[]
  /** Draw stored positions at once, as a drop does; a position without a width keeps the node's stored width. */
  place(positions: Readonly<Record<string, NodePosition>>): void
}

/**
 * The cards of the drawn graph, in graph order.
 * @param nodes - the graph's nodes.
 * @param positionOf - the drawn position of a node, with its stored width when the user resized it.
 * @param heightOf - the card height of a node at a frame width.
 * @returns the cards, each as wide as its stored width, else the 208-unit default.
 */
export function cardsOf(
  nodes: readonly CanvasNode[], positionOf: (node: CanvasNode) => NodePosition, heightOf: (node: CanvasNode, width: number) => number,
): CanvasCard[] {
  return nodes.map((node) => {
    const { x, y, width = NODE_WIDTH } = positionOf(node)
    return {
      id: node.id, type: node.type, title: node.title, record: node.record?.id ?? null,
      x, y, width, height: heightOf(node, width), rendering: node.flags.rendering,
    }
  })
}

/** What a canvas stream delivers: a read, and the data of a `moved` frame. */
export interface StreamListener {
  read(query: CanvasQuery): void
  moved(data: unknown): void
}

/** The page's link to the host half: open a canvas stream, and send an answer. */
export interface CanvasLink {
  /** @returns the close of the stream. */
  open(project: string, session: string | null, listener: StreamListener): () => void
  answer(drawn: CanvasDrawn): void
}

/** The canvas stream over `EventSource` and the answer over `fetch`, both same-origin with the session cookie. */
export const httpLink: CanvasLink = {
  open: (project, session, listener) => {
    const query = new URLSearchParams({ project, ...session === null ? {} : { session } })
    const source = new EventSource(`${CANVAS_AGENT_ROUTE}?${query.toString()}`)
    const data = (event: Event): unknown => JSON.parse((event as MessageEvent<string>).data)
    source.addEventListener('read', (event) => {
      const read = parseQuery(data(event))
      if (read !== null) listener.read(read)
    })
    source.addEventListener('moved', (event) => { listener.moved(data(event)) })
    return () => { source.close() }
  },
  answer: (drawn) => {
    // A failed answer leaves the tool to fail at its timeout.
    void fetch(CANVAS_ANSWER_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(drawn) }).catch(() => null)
  },
}

/** The canvases of one project beside one chat session, in mount order, and the close of their stream. */
interface CanvasGroup {
  canvases: MountedCanvas[]
  close: () => void
}

/** The mounted canvases of a page by project and chat session, each group with one canvas stream. */
export class CanvasViews {
  private readonly groups = new Map<string, CanvasGroup>()

  /** @param link - the stream and the answer route; {@link httpLink} in the page. */
  constructor(private readonly link: CanvasLink = httpLink) {}

  /**
   * Add a mounted canvas, opening the stream of its project and session for the first one.
   * @param canvas - the canvas.
   * @returns the removal, which closes the stream after the last canvas of the group.
   */
  mount(canvas: MountedCanvas): () => void {
    const { projectId, session } = canvas
    const key = JSON.stringify([projectId, session])
    let group = this.groups.get(key)
    if (group === undefined) {
      const opened: CanvasGroup = { canvases: [], close: () => {} }
      opened.close = this.link.open(projectId, session, {
        // Answering draws and stores nothing.
        read: (query) => {
          const [first] = opened.canvases
          if (first !== undefined) this.link.answer({ ...query, project: projectId, cards: first.cards() })
        },
        moved: (data) => {
          const move = parseMoved(data)
          if (move?.project !== projectId) return
          for (const each of opened.canvases) each.place(move.positions)
        },
      })
      group = opened
      this.groups.set(key, group)
    }
    const joined = group
    joined.canvases = [...joined.canvases, canvas]
    return () => {
      if (!joined.canvases.includes(canvas)) return
      joined.canvases = joined.canvases.filter(entry => entry !== canvas)
      if (joined.canvases.length > 0) return
      joined.close()
      this.groups.delete(key)
    }
  }
}
