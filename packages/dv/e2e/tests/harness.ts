/**
 * Boot the shipped `video-harness` profile for a browser test: a fake FastVideo video job backend and a scripted model server
 * started in this process, an isolated harness home with the profile manifest, and `dsh web` on a free port. The
 * returned handle carries the token URL, a cookie-aware JSON client for `/api/dv/*`, and the teardown.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { encodeClip } from '../../api/tests/support.ts'

/** The repository root, four levels above this file. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** The ffmpeg binary the fake backend encodes videos with. */
export const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'

/** Playwright, a dev dependency of this package; the stories launch Chromium through it. */
export * as playwright from 'playwright'

/** A running fake backend. */
export interface FakeBackend {
  url: string
  requests: Record<string, unknown>[]
  /** Hold jobs: each one stays in progress until {@link FakeBackend.release} lets it through. */
  hold(): void
  /** Let the oldest held job finish; with none waiting, the next job to arrive passes. */
  release(): void
  /** Stop holding and let every waiting job finish. */
  releaseAll(): void
  close(): Promise<void>
}

/**
 * Encode one solid-color VP9-in-MP4 video that the open-source Chromium build can decode (it has no H.264 decoder), in
 * its own directory so parallel requests do not overwrite each other. The color follows the prompt, so videos of
 * different prompts are different assets.
 * @param dir - the backend scratch directory.
 * @param width - frame width.
 * @param height - frame height.
 * @param numFrames - frames at 24 fps.
 * @param prompt - the job prompt.
 * @returns the video bytes.
 */
async function encodePlayableVideo(
  dir: string,
  width: number,
  height: number,
  numFrames: number,
  prompt: string,
): Promise<Buffer> {
  const work = mkdtempSync(join(dir, 'clip-'))
  const color = createHash('sha1').update(prompt).digest('hex').slice(0, 6)
  const video = join(work, 'clip.mp4')
  await new Promise<void>((resolve, reject) => {
    const args = ['-f', 'lavfi', '-i', `color=c=0x${color}:s=${String(width)}x${String(height)}:d=${(numFrames / 24).toFixed(3)}:r=24`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video]
    const child = spawn(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => { if (code === 0) resolve(); else reject(new Error(`ffmpeg exited with ${String(code)}`)) })
  })
  const bytes = readFileSync(video)
  rmSync(work, { recursive: true, force: true })
  return bytes
}

/**
 * Start a fake FastVideo video job backend: every job encodes one solid-color video of the job's `size` and
 * `num_frames` with ffmpeg, and its status reads `completed` once the video is encoded.
 * @param dir - a scratch directory for the rendered files.
 * @returns the backend handle.
 */
export async function startFakeBackend(
  dir: string,
  options: { playable?: boolean } = {},
): Promise<FakeBackend> {
  // ffmpeg writes the encoded video into `dir` and does not create it.
  mkdirSync(dir, { recursive: true })
  const requests: Record<string, unknown>[] = []
  // While `held`, a job waits in `waiting` unless a `release` left a pass in `passes`.
  let held = false
  let passes = 0
  const waiting: Array<() => void> = []
  const gate = (): Promise<void> | undefined => {
    if (!held) return undefined
    if (passes > 0) { passes -= 1; return undefined }
    return new Promise<void>((resolve) => { waiting.push(resolve) })
  }
  const releaseAll = (): void => {
    held = false
    for (const resolve of waiting.splice(0)) resolve()
  }
  // The encoded video of each finished job by job ID; a job without an entry is in progress.
  const videos = new Map<string, Buffer>()
  const sendJson = (response: ServerResponse, body: object): void => {
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
    response.end(JSON.stringify(body))
  }
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const id = (request.url ?? '').split('/')[3] ?? ''
    if (request.method !== 'POST') {
      const video = videos.get(id)
      if (!(request.url ?? '').endsWith('/content')) sendJson(response, { id, status: video === undefined ? 'in_progress' : 'completed' })
      else {
        response.writeHead(200, { 'content-type': 'video/mp4', connection: 'close' })
        response.end(video)
      }
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>
      const job = `job-${String(requests.push(body))}`
      sendJson(response, { id: job, status: 'queued' })
      void (async () => {
        await gate()
        const [width, height] = String(body['size']).split('x').map(Number) as [number, number]
        const video = options.playable === true
          ? await encodePlayableVideo(dir, width, height, Number(body['num_frames']), String(body['prompt'] ?? ''))
          : (await encodeClip(dir, width, height, Number(body['num_frames']))).video
        videos.set(job, video)
      })()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    hold: () => { held = true },
    release: () => {
      const resolve = waiting.shift()
      if (resolve === undefined) passes += 1
      else resolve()
    },
    releaseAll,
    close: async () => {
      releaseAll()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    },
  }
}

/** A cookie-aware JSON client bound to the booted harness. */
export interface HarnessApi {
  /** `GET` a JSON route, failing on any non-2xx status. */
  get(path: string): Promise<unknown>
  /** `POST` a JSON body, failing on any non-2xx status. */
  post(path: string, body: unknown): Promise<unknown>
}

/** The booted profile. */
export interface BootedHarness {
  /** `http://127.0.0.1:<port>/?token=…`, the URL that establishes the browser session. */
  tokenUrl: string
  /** The origin without the token. */
  origin: string
  /** The profile's `DV_STATE_ROOT` directory (projects, canvas layouts, session bindings). */
  stateRoot: string
  backend: FakeBackend
  model: MockLlmServer
  api: HarnessApi
  /** Everything the process printed, for failure reports. */
  output: string[]
  close(): Promise<void>
}

/**
 * Wait until the child prints its `dsh web:` line or exits.
 * @param child - the spawned `dsh`.
 * @param output - the sink every line goes to.
 * @returns the printed token URL.
 */
function awaitTokenUrl(child: ChildProcess, output: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`dsh web did not print its URL within 120 s:\n${output.join('')}`)) }, 120_000)
    const scan = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      output.push(text)
      const match = /dsh web: (http:\/\/\S+)/.exec(text)
      if (match !== null) { clearTimeout(timer); resolve(match[1] ?? '') }
    }
    child.stdout?.on('data', scan)
    child.stderr?.on('data', scan)
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`dsh web exited with ${String(code)} before printing its URL:\n${output.join('')}`)) })
  })
}

/**
 * Exchange the token URL for the session cookie the `/api` routes require.
 * @param tokenUrl - the printed token URL.
 * @returns the `cookie` header value.
 */
async function sessionCookie(tokenUrl: string): Promise<string> {
  const response = await fetch(tokenUrl, { redirect: 'manual' })
  const cookies = response.headers.getSetCookie().map(line => line.split(';')[0] ?? '')
  if (cookies.length === 0) throw new Error(`token URL set no cookie (status ${String(response.status)})`)
  return cookies.join('; ')
}

/**
 * Boot the profile with fake services.
 * @param options - `modelBaseUrl` points the agent's OpenAI-compatible route (with `/v1`) at a test model, such as
 *   `startScriptedModel` from `scripted-model.ts`; by default the route points at the Messages mock.
 *   `playableVideos` makes the fake backend encode VP9 videos with a per-prompt color, which Chromium can play.
 * @returns the booted harness; call `close` in teardown even on failure.
 */
export async function bootHarness(
  options: { modelBaseUrl?: string; playableVideos?: boolean } = {},
): Promise<BootedHarness> {
  const scratch = mkdtempSync(join(tmpdir(), 'dv-e2e-'))
  const backend = await startFakeBackend(join(scratch, 'backend'), { playable: options.playableVideos === true })
  const model = await startMockLlmServer({
    port: 0,
    sequence: ['tool_call_success'], // the DSH mock LLM server's reply-order option. names:allow
    repeatLast: true, toolName: 'dv_proj_state', toolArguments: '{}',
  })
  // The isolated harness home mirrors scripts/video-harness/setup-profile.sh: a manifest naming the three bundles,
  // a profile patch, and a link to this checkout's bundle package. The profile patch replaces the config of the
  // bundle's `dv-fastvideo` row, so fasth3 renders only for task ref2v, on the fake backend.
  const home = join(scratch, 'dsh-home')
  const profileDir = join(home, 'profiles', 'video-harness')
  mkdirSync(join(profileDir, 'node_modules', '@dv'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-video-harness', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dv/bundle'] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- id: dv-fastvideo', '  config:', '    models:', '      fasth3:', '        ref2v:',
    `          baseUrl: ${backend.url}`, '          gpuSecondsPerVideoSecond: 4', '',
  ].join('\n'))
  symlinkSync(join(REPO_ROOT, 'packages/bundle/dv'), join(profileDir, 'node_modules', '@dv', 'bundle'))
  const port = await freePort()
  const stateRoot = join(scratch, 'state')
  const output: string[] = []
  const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'video-harness', '--port', String(port), '--no-open'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env['PATH'] ?? ''}`,
      DSH_HOME: home,
      DV_STATE_ROOT: stateRoot,
      DV_FFMPEG: FFMPEG,
      DV_PUBLIC_URL: '',
      DV_DEEPSEEK_BASE_URL: options.modelBaseUrl ?? `${model.baseURL}/v1`,
      DV_DEEPSEEK_API_KEY: 'none',
      GROQ_API_KEY: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let tokenUrl: string
  try {
    tokenUrl = await awaitTokenUrl(child, output)
  } catch (error) {
    child.kill('SIGKILL')
    await backend.close()
    await model.close()
    rmSync(scratch, { recursive: true, force: true })
    throw error
  }
  const origin = new URL(tokenUrl).origin
  const cookie = await sessionCookie(tokenUrl)
  const call = async (path: string, init: RequestInit): Promise<unknown> => {
    const response = await fetch(`${origin}${path}`, { ...init, headers: { ...init.headers, cookie, 'content-type': 'application/json' } })
    const text = await response.text()
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${String(response.status)}: ${text}`)
    return text.length === 0 ? null : JSON.parse(text)
  }
  return {
    tokenUrl,
    origin,
    stateRoot,
    backend,
    model,
    output,
    api: {
      get: path => call(path, { method: 'GET' }),
      post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }),
    },
    close: async () => {
      child.kill('SIGTERM')
      const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
      const forced = new Promise<void>((resolve) => { setTimeout(() => { child.kill('SIGKILL'); resolve() }, 10_000) })
      await Promise.race([exited, forced])
      await backend.close()
      await model.close()
      rmSync(scratch, { recursive: true, force: true })
    },
  }
}

/**
 * An OS-assigned free port, released before use: `dsh web` needs a concrete `--port`.
 * @returns the port number.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') { probe.close(() => { reject(new Error('port probe returned no address')) }); return }
      probe.close(() => { resolve(address.port) })
    })
  })
}

/**
 * Poll a predicate until it holds.
 * @param check - the probe; a truthy result ends the wait.
 * @param label - names the condition in the timeout error.
 * @param timeoutMs - the budget.
 * @returns the first truthy result.
 */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

/**
 * Escape a literal string for use inside a regular expression, so a title such as `a+b (1)` matches only itself.
 * @param text - the literal text.
 * @returns the text with every regular-expression metacharacter escaped.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
