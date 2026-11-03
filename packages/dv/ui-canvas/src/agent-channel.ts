/**
 * The host end of the canvas tools' channel to the open canvases. A mounted canvas holds the streaming route
 * `GET /api/dv/canvas/agent?project=<id>&session=<id>` open; the host writes a `read` frame `{id, stream}` to ask it for
 * the cards it draws, and a `moved` frame {@link CanvasMoved} after a stored move. The canvas answers a read with
 * `POST /api/dv/canvas/agent/answer` and the body `{id, stream, project, cards}`. An answer settles the read only when
 * it names a stream that the read was written to. Both routes sit on the Connection's `/api` channel, so they admit only
 * the authenticated browser.
 *
 * @module @dv/ui-canvas/agent-channel
 */
import { randomUUID } from 'node:crypto'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { CANVAS_AGENT_ROUTE, CANVAS_ANSWER_ROUTE, parseQuery } from './canvas.ts'
import type { CanvasMoved } from './types.ts'

/** One open canvas stream: the project it draws and the chat session it sits beside. */
interface CanvasStream {
  readonly id: string
  readonly project: string
  readonly session: string | null
  send(event: 'read' | 'moved', data: unknown): void
  /** End the response; the browser's `EventSource` reconnects. */
  end(): void
}

/** Milliseconds between keep-alive comments, as on `/dv/events`. */
const KEEPALIVE_MS = 15_000

/** The open canvas streams and the reads that wait for an answer. */
export class CanvasChannel {
  private readonly streams = new Set<CanvasStream>()
  /** By read id: the ids of the streams that the read was written to, and the settling of the read. */
  private readonly waiting = new Map<string, { streams: ReadonlySet<string>; resolve: (answer: unknown) => void }>()

  /**
   * Ask every open canvas of `project` beside `session` for its cards; the first answer wins.
   * @param project - the project.
   * @param session - the chat session of the calling agent.
   * @param signal - ends the wait.
   * @returns the first answer, or null at once when no such canvas is open. Rejects with the signal's reason.
   */
  ask(project: string, session: string, signal: AbortSignal): Promise<unknown> | null {
    const targets = [...this.streams].filter(stream => stream.project === project && stream.session === session)
    if (targets.length === 0) return null
    const id = randomUUID()
    const answered = Promise.withResolvers<unknown>()
    const stop = (): void => { answered.reject(signal.reason) }
    this.waiting.set(id, { streams: new Set(targets.map(stream => stream.id)), resolve: answered.resolve })
    signal.addEventListener('abort', stop, { once: true })
    for (const stream of targets) stream.send('read', { id, stream: stream.id })
    return answered.promise.finally(() => {
      this.waiting.delete(id)
      signal.removeEventListener('abort', stop)
    })
  }

  /**
   * Tell every open canvas of the project, beside any session, to draw a stored move.
   * @param move - the project and the stored positions.
   */
  moved(move: CanvasMoved): void {
    for (const stream of this.streams) if (stream.project === move.project) stream.send('moved', move)
  }

  /** End every open stream, when the host half unloads. */
  dispose(): void {
    for (const stream of this.streams) stream.end()
  }

  /** @returns the stream route and the answer route. */
  routes(): ConnectionFetchRoute[] {
    return [
      { path: CANVAS_AGENT_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: request => Promise.resolve(this.open(request)) },
      {
        path: CANVAS_ANSWER_ROUTE, methods: ['POST'], requestBody: 'buffered',
        fetch: async (request) => {
          const body: unknown = await request.json().catch(() => null)
          const query = parseQuery(body)
          const read = query === null ? undefined : this.waiting.get(query.id)
          if (query === null || read?.streams.has(query.stream) !== true) return new Response(null, { status: 404 })
          this.waiting.delete(query.id)
          read.resolve(body)
          return new Response(null, { status: 204 })
        },
      },
    ]
  }

  /** Open one canvas stream that lasts until the browser disconnects. */
  private open(request: Request): Response {
    const query = new URL(request.url).searchParams
    const project = query.get('project')
    if (project === null || project === '') return Response.json({ error: 'A canvas stream names its project.', code: 'invalid_params' }, { status: 400 })
    const encoder = new TextEncoder()
    let drop = (): boolean => false
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const write = (text: string): void => { controller.enqueue(encoder.encode(text)) }
        const stream: CanvasStream = {
          id: randomUUID(), project, session: query.get('session'),
          send: (event, data) => { write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) },
          end: () => { if (drop()) controller.close() },
        }
        const keepalive = setInterval(() => { write(': keepalive\n\n') }, KEEPALIVE_MS)
        drop = () => {
          clearInterval(keepalive)
          return this.streams.delete(stream)
        }
        this.streams.add(stream)
        write('event: ready\ndata: {}\n\n')
        // The Connection's HTTP bridge keeps reading the body after a disconnect, so the body must end on the abort.
        request.signal.addEventListener('abort', () => { stream.end() }, { once: true })
      },
      cancel: () => { drop() },
    })
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' },
    })
  }
}
