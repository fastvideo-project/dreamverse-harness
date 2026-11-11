/**
 * The one Blender the harness talks to: the open link socket, the add-on's last reported state, the requests waiting
 * for an answer, and the viewers of its viewport. A second Blender that links replaces the first. Viewport frames reach
 * the viewers; the add-on streams only while at least one viewer listens, and sends its next frame only after the
 * harness acknowledges the previous one. A request the harness stops or times out is cancelled: the add-on skips it when
 * it has not started it, and a started one runs to its end because Blender's main thread cannot be interrupted.
 *
 * @module @fastvideo/dreamverse-blender-bridge/link
 */
import type WebSocket from 'ws'
import type { RawData } from 'ws'
import { parseBlenderBinary, parseBlenderText, type BlenderOp, type BlenderState, type FrameMime, type FrameTiming, type ViewCommand } from './protocol.ts'

/** What a viewer of the viewport receives. */
export type ViewEvent =
  | { type: 'status'; linked: boolean; state: BlenderState | null }
  | { type: 'frame'; seq: number; width: number; height: number; mime: FrameMime; timing?: FrameTiming; data: Uint8Array }

/** One answered request: the add-on's result fields, and the bytes of the file it sent, when it sent one. */
export interface BlenderReply {
  result: Record<string, unknown>
  file: Uint8Array | null
}

/** A request waiting for its response. */
interface Pending {
  resolve(reply: BlenderReply): void
  reject(error: Error): void
  chunks: Uint8Array[]
  bytes: number
  /** Set when the file outgrew the cap; the request then fails at its response. */
  overflow: boolean
}

/** Limits of the link. */
export interface LinkLimits {
  /** The most bytes one request's file may hold. */
  maxFileBytes: number
  /** Interval of the pings that keep the link and the tunnel open, in ms. */
  pingMs: number
}

/** The sentence every Blender tool fails with while no Blender is linked. */
export const NOT_LINKED = 'No Blender is connected to the harness. Ask the user to open the Blender tab on the right panel '
  + 'and connect Blender with the DreamVerse add-on, then try again.'

function bytesOf(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data
}

/** The link to the user's Blender; see the module comment. */
export class BlenderLink {
  private socket: WebSocket | null = null
  private current: BlenderState | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly viewers = new Set<(event: ViewEvent) => void>()
  private latest: Extract<ViewEvent, { type: 'frame' }> | null = null
  private nextId = 0
  private pings: ReturnType<typeof setInterval> | null = null

  constructor(private readonly limits: LinkLimits, private readonly warn: (message: string) => void) {}

  /** @returns whether a Blender is linked and has introduced itself. */
  get linked(): boolean {
    return this.socket !== null && this.current !== null
  }

  /** @returns the add-on's last reported state, or null while no Blender is linked. */
  get state(): BlenderState | null {
    return this.socket === null ? null : this.current
  }

  /** @returns how many viewers watch the viewport. */
  get viewerCount(): number {
    return this.viewers.size
  }

  /**
   * Take over a freshly opened link socket; an earlier Blender is disconnected with a close reason.
   * @param socket - the accepted WebSocket.
   */
  attach(socket: WebSocket): void {
    this.close(4000, 'Another Blender connected to the harness.')
    this.socket = socket
    socket.on('message', (data, isBinary) => {
      if (this.socket === socket) this.receive(data, isBinary)
    })
    socket.on('close', () => {
      if (this.socket === socket) this.detach('Blender disconnected before it answered.')
    })
    socket.on('error', (error) => { this.warn(`blender link error: ${error.message}`) })
    this.pings = setInterval(() => { socket.ping() }, this.limits.pingMs)
    this.pings.unref()
  }

  /**
   * Close the current link, failing its waiting requests.
   * @param code - the WebSocket close code.
   * @param reason - the close reason Blender shows.
   */
  close(code: number, reason: string): void {
    const socket = this.socket
    if (socket === null) return
    this.detach(reason)
    socket.close(code, reason)
  }

  /**
   * Send one request and wait for its response.
   * @param op - the operation.
   * @param params - its parameters.
   * @param options - the time limit and the caller's stop signal.
   * @returns the result fields and the file the add-on sent.
   * @throws Error with {@link NOT_LINKED} while no Blender is linked, or the add-on's error, a timeout, a stop, a file
   *   over the cap, or the link closing first. A timeout or a stop sends the add-on `cancel` with the request's `id`.
   */
  request(op: BlenderOp, params: Record<string, unknown>, options: { timeoutMs: number; signal: AbortSignal }): Promise<BlenderReply> {
    const socket = this.socket
    if (socket === null || this.current === null) return Promise.reject(new Error(NOT_LINKED))
    if (options.signal.aborted) return Promise.reject(new Error('The call was stopped before Blender received it.'))
    this.nextId += 1
    const id = `r${String(this.nextId)}`
    return new Promise<BlenderReply>((resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timer)
        options.signal.removeEventListener('abort', stop)
        this.pending.delete(id)
      }
      const cancel = (message: string): void => {
        finish()
        socket.send(JSON.stringify({ type: 'cancel', id }))
        reject(new Error(message))
      }
      const stop = (): void => { cancel('The call was stopped; Blender skips it if it has not started it, and otherwise may still finish it.') }
      const timer = setTimeout(() => {
        cancel(`Blender did not answer within ${String(options.timeoutMs / 1000)} s; it skips the request if it has not started it, and otherwise may still finish it.`)
      }, options.timeoutMs)
      options.signal.addEventListener('abort', stop, { once: true })
      this.pending.set(id, {
        resolve: (reply) => { finish(); resolve(reply) },
        reject: (error) => { finish(); reject(error) },
        chunks: [], bytes: 0, overflow: false,
      })
      socket.send(JSON.stringify({ type: 'request', id, op, params }))
    })
  }

  /**
   * Move the view of the main 3D viewport; the add-on applies the command and answers nothing, and the next frame
   * shows the result.
   * @param command - the checked command.
   * @returns whether a Blender was linked to receive it.
   */
  navigate(command: ViewCommand): boolean {
    if (this.socket === null || this.current === null) return false
    this.socket.send(JSON.stringify({ type: 'view', ...command }))
    return true
  }

  /**
   * Watch the viewport: the listener receives the link status at once, the last frame when there is one, and every
   * later status change and frame.
   * @param listener - called per event.
   * @returns a function that stops watching.
   */
  watch(listener: (event: ViewEvent) => void): () => void {
    this.viewers.add(listener)
    listener({ type: 'status', linked: this.linked, state: this.state })
    if (this.latest !== null && this.linked) listener(this.latest)
    if (this.viewers.size === 1) this.sendStream()
    return () => {
      if (!this.viewers.delete(listener)) return
      if (this.viewers.size === 0) this.sendStream()
    }
  }

  private detach(reason: string): void {
    if (this.pings !== null) clearInterval(this.pings)
    this.pings = null
    this.socket = null
    this.current = null
    this.latest = null
    for (const waiting of [...this.pending.values()]) waiting.reject(new Error(reason))
    this.broadcast({ type: 'status', linked: false, state: null })
  }

  private sendStream(): void {
    if (this.socket !== null && this.current !== null) this.socket.send(JSON.stringify({ type: 'stream', on: this.viewers.size > 0 }))
  }

  private broadcast(event: ViewEvent): void {
    for (const viewer of [...this.viewers]) viewer(event)
  }

  /** Handle one message from the add-on: a `hello` or `state` updates the state, and a `response` settles its request. */
  private receive(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.receiveBinary(bytesOf(data))
      return
    }
    const message = parseBlenderText(bytesOf(data).toString())
    if (message === null) {
      this.warn('blender link: an unreadable text message from the add-on was ignored')
      return
    }
    if (message.type !== 'response') {
      const first = this.current === null
      this.current = message.state
      this.broadcast({ type: 'status', linked: true, state: message.state })
      if (first) this.sendStream()
      return
    }
    const waiting = this.pending.get(message.id)
    if (waiting === undefined) return
    if (!message.ok) waiting.reject(new Error(message.error))
    else if (waiting.overflow) waiting.reject(new Error(`Blender sent a file over the ${String(this.limits.maxFileBytes)}-byte limit.`))
    else waiting.resolve({ result: message.result, file: waiting.chunks.length === 0 ? null : Buffer.concat(waiting.chunks) })
  }

  /** Relay and acknowledge a viewport frame, or add a file chunk to its request up to the file cap. */
  private receiveBinary(data: Uint8Array): void {
    const message = parseBlenderBinary(data)
    if (message === null) {
      this.warn('blender link: an unreadable binary message from the add-on was ignored')
      return
    }
    if (message.kind === 'frame') {
      const { seq, width, height, mime, timing, payload } = message
      this.latest = { type: 'frame', seq, width, height, mime, ...timing === undefined ? {} : { timing }, data: payload }
      this.broadcast(this.latest)
      this.socket?.send(JSON.stringify({ type: 'frame_ack', seq: message.seq }))
      return
    }
    const waiting = this.pending.get(message.id)
    if (waiting === undefined || waiting.overflow) return
    waiting.bytes += message.payload.byteLength
    if (waiting.bytes > this.limits.maxFileBytes) {
      waiting.overflow = true
      waiting.chunks = []
      return
    }
    waiting.chunks.push(message.payload)
  }
}
