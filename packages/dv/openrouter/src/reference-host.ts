/**
 * Public HTTPS links for the reference media that OpenRouter's video API accepts only by URL. One host serves the files
 * of one render from a loopback HTTP server under a random path and publishes that server through a Cloudflare quick
 * tunnel; the render closes it when the job ends.
 */
import { randomBytes } from 'node:crypto'
import { Resolver, resolve4, resolveNs } from 'node:dns/promises'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

/** A running `cloudflared tunnel --url <target>` process. */
export interface TunnelProcess {
  /** The process's stderr, where cloudflared prints the address of the tunnel. */
  readonly stderr: Readable
  /** Settles when the process exits; rejects when it cannot start. */
  readonly done: Promise<unknown>
  /** Stop the process; idempotent. */
  terminate(): void
}

/** One file a host serves: its path on disk, media type and file name. */
export interface HostedFile { path: string; mime: string; name: string }

/** An open host: one public URL per file, in the order given. */
export interface ReferenceHost {
  readonly urls: string[]
  /** Stop the tunnel and the server; the URLs stop working. */
  close(): Promise<void>
}

/** What opening a host needs. */
export interface ReferenceHostOptions {
  /** Start cloudflared with a quick tunnel to `target`. */
  spawn: (target: string) => TunnelProcess
  /** How long the tunnel may take to print its address and serve the first file. */
  startTimeoutMs: number
  /**
   * Whether the tunnel's host name is published yet, asked without a caching resolver (see `publishedByAuthority`);
   * the host checks the tunnel through `fetcher` only after this answers true.
   */
  published: (hostname: string) => Promise<boolean>
  /** Fetches through the public tunnel address to check it serves the first file. */
  fetcher: typeof globalThis.fetch
  /** Aborts opening. */
  signal?: AbortSignal | undefined
}

/** The address a quick tunnel prints once Cloudflare assigned one; cloudflared also names its API host in errors. */
const TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/

/** The zone of quick tunnel host names. */
const TUNNEL_ZONE = 'trycloudflare.com'

/** How long one question to an authoritative name server may take. */
const AUTHORITY_TIMEOUT_MS = 2_000

/**
 * Whether the authoritative name servers of `trycloudflare.com` publish an IPv4 address for `hostname`. A new quick
 * tunnel's name is published some seconds after cloudflared prints it, and the zone lets resolvers cache a missing name
 * for its SOA minimum (60 seconds); asking the authoritative servers directly keeps a resolver on the way, such as a
 * cluster DNS cache, from holding that early miss.
 * @param hostname - the tunnel's host name.
 * @returns true once the name is published; false while it is not, or when the name servers cannot be asked.
 */
export async function publishedByAuthority(hostname: string): Promise<boolean> {
  const servers = await resolveNs(TUNNEL_ZONE)
    .then(async names => (await Promise.all(names.map(async name => await resolve4(name).catch(() => [])))).flat(), () => [])
  if (servers.length === 0) return false
  const resolver = new Resolver({ timeout: AUTHORITY_TIMEOUT_MS, tries: 1 })
  resolver.setServers(servers)
  return await resolver.resolve4(hostname).then(addresses => addresses.length > 0, () => false)
}

/** Characters of cloudflared's stderr an error quotes. */
const STDERR_TAIL = 300

/** Wait between checks that a new tunnel address resolves and serves. */
const PROBE_INTERVAL_MS = 1_000

/**
 * Serve `files` at public HTTPS URLs until `close()`.
 * @param files - the files, each served under the random path with its index and file extension.
 * @param options - the cloudflared launcher, start timeout, publication check, fetcher and abort signal.
 * @returns the open host.
 * @throws Error when cloudflared cannot start, exits, or prints no working address within the start timeout; the
 *   signal's reason on abort.
 */
export async function openReferenceHost(files: readonly HostedFile[], options: ReferenceHostOptions): Promise<ReferenceHost> {
  const token = randomBytes(24).toString('base64url')
  const paths = files.map((file, index) => {
    const extension = extname(file.name).toLowerCase()
    return `/${token}/${index}${/^\.[a-z0-9]{1,5}$/.test(extension) ? extension : ''}`
  })
  const server = createServer((request, response) => {
    const index = paths.indexOf(request.url ?? '')
    const file = files[index]
    if (file === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.statusCode = 404; response.end(); return
    }
    void stat(file.path).then((info) => {
      response.writeHead(200, { 'content-type': file.mime, 'content-length': info.size })
      if (request.method === 'HEAD') { response.end(); return }
      createReadStream(file.path).on('error', () => { response.destroy() }).pipe(response)
    }, () => { response.statusCode = 404; response.end() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const tunnel = options.spawn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  const close = async (): Promise<void> => {
    tunnel.terminate()
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    // The exit or start failure of cloudflared after it was told to stop changes nothing for the caller.
    await tunnel.done.catch(() => undefined)
  }
  const deadline = AbortSignal.timeout(options.startTimeoutMs)
  const bounded = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
  let stderr = ''
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const fail = (reason: string): void => {
        const tail = stderr.trim().slice(-STDERR_TAIL)
        reject(new Error(`cloudflared ${reason}${tail === '' ? '' : `: ${tail}`}`))
      }
      tunnel.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4 * STDERR_TAIL)
        const found = TUNNEL_URL.exec(stderr)
        if (found !== null) resolve(found[0])
      })
      tunnel.done.then(() => { fail('exited before it opened a tunnel') }, (error: unknown) => {
        fail(`could not start (${error instanceof Error ? error.message : String(error)})`)
      })
      bounded.addEventListener('abort', () => {
        // The catch below rethrows the signal's own reason.
        if (options.signal?.aborted === true) reject(new Error('Opening the reference host was aborted.'))
        else fail(`printed no tunnel address within ${options.startTimeoutMs} ms`)
      }, { once: true })
    })
    const urls = paths.map(path => base + path)
    while (!await options.published(new URL(base).hostname)) await delay(PROBE_INTERVAL_MS, undefined, { signal: bounded })
    for (;;) {
      bounded.throwIfAborted()
      const response = await options.fetcher(urls[0] ?? base, { method: 'HEAD', signal: bounded })
        .catch((error: unknown) => { if (bounded.aborted) throw error; return null })
      if (response?.ok === true) break
      await delay(PROBE_INTERVAL_MS, undefined, { signal: bounded })
    }
    return { urls, close }
  } catch (error) {
    await close()
    if (options.signal?.aborted === true) throw options.signal.reason
    if (deadline.aborted && !(error instanceof Error && error.message.startsWith('cloudflared'))) {
      throw new Error(`cloudflared opened a tunnel that served nothing within ${options.startTimeoutMs} ms.`)
    }
    throw error
  }
}
