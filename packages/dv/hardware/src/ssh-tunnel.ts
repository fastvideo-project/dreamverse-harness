/** A key-only OpenSSH local stream forward owned by one connection snapshot. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import type { WorkerConfig } from './types.ts'

/** Forward HTTP over an exclusively allocated Unix socket, without a TCP port-allocation race. */
export class SshTunnel {
  private child: ChildProcess | undefined
  private directory: string | undefined
  private closed: Promise<void> | undefined
  private opening: Promise<string> | undefined
  private stopped = false

  constructor(private readonly config: WorkerConfig, private readonly timeoutMs: number) {}

  private async open(): Promise<string> {
    if (process.platform === 'win32') throw new Error('SSH worker forwarding currently requires a macOS or Linux harness host.')
    if (this.stopped) throw new Error('The SSH worker connection is closed. Reconnect it from Hardware settings.')
    this.directory = await mkdtemp(join(tmpdir(), 'dv-worker-'))
    const socket = join(this.directory, 'api.sock')
    this.child = spawn('ssh', ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', `ConnectTimeout=${Math.ceil(this.timeoutMs / 1000)}`, '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
      '-L', `${socket}:${this.config.remoteHost}:${this.config.remotePort}`, this.config.sshHost], { stdio: 'ignore' })
    let failed = false
    const child = this.child
    child.once('error', () => { failed = true })
    this.closed = new Promise((resolve) => { child.once('close', () => { failed = true; resolve() }) })
    const deadline = Date.now() + this.timeoutMs
    while (!failed && !this.stopped && Date.now() < deadline) {
      if (await stat(socket).then(value => value.isSocket(), () => false)) return socket
      await delay(25)
    }
    await this.dispose()
    throw new Error('SSH connection failed. Check the host alias, authorized key, known host, and worker port on the harness host.')
  }

  /** Send one request through the saved tunnel; a lost connection never silently reconnects an active job. */
  async fetch(url: URL, init: RequestInit): Promise<Response> {
    init.signal?.throwIfAborted()
    this.opening ??= this.open()
    let cancel: (() => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancel = () => { reject(init.signal?.reason) }
      init.signal?.addEventListener('abort', cancel, { once: true })
    })
    let socketPath: string
    try { socketPath = await Promise.race([this.opening, interrupted]) }
    finally { if (cancel !== undefined) init.signal?.removeEventListener('abort', cancel) }
    init.signal?.throwIfAborted()
    if (this.stopped || this.child?.exitCode !== null) throw new Error('SSH worker disconnected. Check its status before retrying the job.')
    if (init.body != null && typeof init.body !== 'string') throw new Error('SSH worker requests require a JSON body.')
    return await new Promise<Response>((resolve, reject) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries())
      const outgoing = request({ socketPath, path: url.pathname + url.search, method: init.method ?? 'GET', headers,
        ...(init.signal == null ? {} : { signal: init.signal }) }, (incoming) => {
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
        }
        resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
          { status: incoming.statusCode ?? 502, headers: responseHeaders }))
      })
      outgoing.once('error', () => { reject(new Error('SSH worker request failed. Check the connection before retrying.')) })
      outgoing.end(init.body ?? undefined)
    })
  }

  /** Stop the owned forward and await its exit before removing its private socket directory. */
  async dispose(): Promise<void> {
    this.stopped = true
    this.child?.kill('SIGTERM')
    await this.closed
    if (this.directory !== undefined) await rm(this.directory, { recursive: true, force: true })
  }
}
