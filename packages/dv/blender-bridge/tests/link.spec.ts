/**
 * {@link BlenderLink} on a stand-in socket that the test drives message by message, for orderings that a real socket
 * pair cannot produce on demand: a replaced socket that still delivers, `arraybuffer` and `fragments` message data,
 * and a frame before the `hello`.
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlenderLink, encodeBinary } from '../src/index.ts'

const HELLO = { type: 'hello', blender_version: '5.3.0', addon_version: '0.1.0', file: 'shot.blend', allow_code: true }

/** A stand-in link socket: what the link sends, how it closed it, and how often it pinged. */
class StandInSocket extends EventEmitter {
  readonly sent: Array<Record<string, unknown>> = []
  closed: number | null = null
  pings = 0

  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>)
  }

  close(code: number): void {
    this.closed = code
  }

  ping(): void {
    this.pings += 1
  }

  /** Deliver a text message from the add-on. */
  text(message: Record<string, unknown> | string): void {
    this.emit('message', Buffer.from(typeof message === 'string' ? message : JSON.stringify(message)), false)
  }
}

/**
 * A link with a warning list and one attached stand-in socket that has said `hello` unless `hello` is false.
 * @param hello - whether the socket introduces itself.
 * @returns the link, its socket and its warnings.
 */
function linked(hello = true): { link: BlenderLink; socket: StandInSocket; warnings: string[] } {
  const warnings: string[] = []
  const link = new BlenderLink({ maxFileBytes: 4, pingMs: 1000 }, (message) => { warnings.push(message) })
  const socket = new StandInSocket()
  link.attach(socket as never)
  if (hello) socket.text(HELLO)
  return { link, socket, warnings }
}

const WAIT = { timeoutMs: 60_000, signal: new AbortController().signal }

afterEach(() => { vi.useRealTimers() })

describe('BlenderLink', () => {
  it('ignores what a replaced socket still delivers', () => {
    const { link, socket: first } = linked()
    const second = new StandInSocket()
    link.attach(second as never)
    expect(first.closed).toBe(4000)
    first.text({ ...HELLO, file: 'stale.blend' })
    expect(link.linked).toBe(false)
    second.text(HELLO)
    first.emit('close')
    expect(link.state).toEqual({ blender_version: '5.3.0', addon_version: '0.1.0', file: 'shot.blend', allow_code: true })
  })

  it('reads chunks delivered as an ArrayBuffer or as fragments like a Buffer', async () => {
    const { link, socket } = linked()
    const reply = link.request('look', {}, WAIT)
    const id = socket.sent.find(message => message['type'] === 'request')?.['id']
    const chunk = encodeBinary({ kind: 'chunk', id }, new Uint8Array([1, 2]))
    socket.emit('message', chunk.slice().buffer, true)
    socket.emit('message', [Buffer.from(chunk.subarray(0, 3)), Buffer.from(chunk.subarray(3))], true)
    socket.emit('message', [Buffer.from(JSON.stringify({ type: 'response', id, ok: true, result: {} }))], false)
    expect(await reply).toEqual({ result: {}, file: Buffer.from([1, 2, 1, 2]) })
  })

  it('ignores a response and a chunk for a request it does not wait for', async () => {
    const { link, socket } = linked()
    const reply = link.request('scene', {}, WAIT)
    socket.emit('message', Buffer.from(encodeBinary({ kind: 'chunk', id: 'r99' }, new Uint8Array([9]))), true)
    socket.text({ type: 'response', id: 'r99', ok: true, result: { other: true } })
    socket.text({ type: 'response', id: 'r1', ok: true, result: { mine: true } })
    expect(await reply).toEqual({ result: { mine: true }, file: null })
  })

  it('refuses a request whose signal is already stopped, without sending it', async () => {
    const { link, socket } = linked()
    const stop = new AbortController()
    stop.abort()
    await expect(link.request('scene', {}, { timeoutMs: 1000, signal: stop.signal })).rejects.toThrow('The call was stopped before Blender received it.')
    expect(socket.sent.filter(message => message['type'] === 'request')).toEqual([])
  })

  it('does not replay a frame that came before the hello, and stops the stream once per viewer', () => {
    const { link, socket } = linked(false)
    socket.emit('message', Buffer.from(encodeBinary({ kind: 'frame', seq: 1, width: 1, height: 1, mime: 'image/png' }, new Uint8Array([1]))), true)
    const events: unknown[] = []
    const unwatch = link.watch((event) => { events.push(event) })
    expect(events).toEqual([{ type: 'status', linked: false, state: null }])
    socket.text(HELLO)
    unwatch()
    unwatch()
    expect(socket.sent.filter(message => message['type'] === 'stream')).toEqual([{ type: 'stream', on: true }, { type: 'stream', on: false }])
  })

  it('pings the socket at the configured interval until it closes', () => {
    vi.useFakeTimers()
    const { link, socket } = linked()
    vi.advanceTimersByTime(2500)
    expect(socket.pings).toBe(2)
    link.close(1000, 'bye')
    vi.advanceTimersByTime(2000)
    expect(socket.pings).toBe(2)
  })
})
