/** The temporary public host of reference media, with a fake cloudflared and a fetcher that reaches the tunnel's target. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { openReferenceHost, type TunnelProcess } from '../src/reference-host.ts'

const cleanup: Array<() => void> = []
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose() })

const ADDRESS = 'https://fixture-tunnel.trycloudflare.com'

/** A publication check that finds every name published. */
const published = (): Promise<boolean> => Promise.resolve(true)

function files() {
  const dir = mkdtempSync(join(tmpdir(), 'dv-reference-host-'))
  cleanup.push(() => { rmSync(dir, { recursive: true, force: true }) })
  writeFileSync(join(dir, 'voice'), 'VOICE')
  writeFileSync(join(dir, 'clip'), 'CLIP')
  return [{ path: join(dir, 'voice'), mime: 'audio/wav', name: 'voice.WAV' }, { path: join(dir, 'clip'), mime: 'video/mp4', name: 'clip' }]
}

/** A fake cloudflared that prints `lines` on stderr and runs until stopped or until `exit` is called. */
function tunnel(lines: string[]) {
  let target = ''
  let exit = (): void => {}
  let terminated = 0
  const spawn = (to: string): TunnelProcess => {
    target = to
    const stderr = new PassThrough()
    setTimeout(() => { for (const line of lines) stderr.write(line + '\n') }, 1)
    const done = new Promise<void>((resolve) => { exit = resolve })
    return { stderr, done, terminate: () => { terminated++; exit() } }
  }
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    globalThis.fetch(new Request(input).url.replace(ADDRESS, target), init)
  return { spawn, fetcher, exit: () => { exit() }, terminated: () => terminated, target: () => target }
}

describe('the reference host', () => {
  it('serves each file under a random path through the tunnel address until it closes', async () => {
    const fake = tunnel(['INF Requesting new quick Tunnel', `INF |  ${ADDRESS}  |`])
    const host = await openReferenceHost(files(), { spawn: fake.spawn, startTimeoutMs: 5_000, published, fetcher: fake.fetcher })
    expect(fake.target()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(host.urls).toHaveLength(2)
    expect(host.urls[0]).toMatch(/^https:\/\/fixture-tunnel\.trycloudflare\.com\/[\w-]{32}\/0\.wav$/)
    expect(host.urls[1]).toMatch(/\/1$/)
    const voice = await fake.fetcher(host.urls[0] ?? '')
    expect([voice.status, voice.headers.get('content-type'), await voice.text()]).toEqual([200, 'audio/wav', 'VOICE'])
    expect(await (await fake.fetcher(host.urls[1] ?? '')).text()).toBe('CLIP')
    const token = new URL(host.urls[0] ?? '').pathname.split('/')[1]
    for (const path of ['/', `/${token}/`, `/${token}/2`, '/x/0.wav']) expect((await fake.fetcher(ADDRESS + path)).status).toBe(404)
    expect((await fake.fetcher(host.urls[0] ?? '', { method: 'POST', body: 'x' })).status).toBe(404)
    await host.close()
    expect(fake.terminated()).toBe(1)
    await expect(fake.fetcher(host.urls[0] ?? '')).rejects.toThrow()
  })

  it('fails with the end of cloudflared\'s stderr when it exits before printing an address, and closes the server', async () => {
    const fake = tunnel(['ERR failed to request quick Tunnel: 429 Too Many Requests'])
    const opening = openReferenceHost(files(), { spawn: fake.spawn, startTimeoutMs: 5_000, published, fetcher: fake.fetcher })
    setTimeout(() => { fake.exit() }, 20)
    await expect(opening).rejects.toThrow('cloudflared exited before it opened a tunnel: ERR failed to request quick Tunnel: 429 Too Many Requests')
    await expect(globalThis.fetch(fake.target())).rejects.toThrow()
  })

  it('fails when cloudflared cannot start, and when it prints no address within the start timeout', async () => {
    const missing = (): TunnelProcess => ({ stderr: new PassThrough(), done: Promise.reject(new Error('spawn cloudflared ENOENT')),
      terminate: () => {} })
    await expect(openReferenceHost(files(), { spawn: missing, startTimeoutMs: 5_000, published, fetcher: globalThis.fetch }))
      .rejects.toThrow('cloudflared could not start (spawn cloudflared ENOENT)')
    const silent = tunnel([])
    await expect(openReferenceHost(files(), { spawn: silent.spawn, startTimeoutMs: 50, published, fetcher: silent.fetcher }))
      .rejects.toThrow('cloudflared printed no tunnel address within 50 ms')
    expect(silent.terminated()).toBe(1)
  })

  it('checks the tunnel over HTTP only after the name is published, skipping the API host cloudflared names in errors', async () => {
    const fake = tunnel(['ERR retrying https://api.trycloudflare.com/tunnel', `INF |  ${ADDRESS}  |`])
    const asked: string[] = []
    let answers = [false, false, true]
    const fetched: string[] = []
    const host = await openReferenceHost(files(), { spawn: fake.spawn, startTimeoutMs: 10_000,
      published: (hostname) => { asked.push(hostname); return Promise.resolve(answers.shift() ?? true) },
      fetcher: (input, init) => { fetched.push(`${asked.length}`); return fake.fetcher(input, init) } })
    expect(asked).toEqual(['fixture-tunnel.trycloudflare.com', 'fixture-tunnel.trycloudflare.com', 'fixture-tunnel.trycloudflare.com'])
    expect(fetched).toEqual(['3'])
    answers = []
    await host.close()
  })

  it('fails when the printed address serves nothing within the start timeout', async () => {
    const fake = tunnel([`INF |  ${ADDRESS}  |`])
    const unreachable = (() => Promise.resolve(new Response(null, { status: 530 }))) as typeof globalThis.fetch
    await expect(openReferenceHost(files(), { spawn: fake.spawn, startTimeoutMs: 300, published, fetcher: unreachable }))
      .rejects.toThrow('cloudflared opened a tunnel that served nothing within 300 ms.')
    expect(fake.terminated()).toBe(1)
  })

  it('stops opening with the abort reason', async () => {
    const fake = tunnel([])
    const controller = new AbortController()
    const reason = new Error('Stop')
    const opening = openReferenceHost(files(),
      { spawn: fake.spawn, startTimeoutMs: 5_000, published, fetcher: fake.fetcher, signal: controller.signal })
    setTimeout(() => { controller.abort(reason) }, 10)
    await expect(opening).rejects.toBe(reason)
    expect(fake.terminated()).toBe(1)
  })
})
