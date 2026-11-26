/** Run the host-only Reactor SDK bridge with one private request on stdin. */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Workflow } from './profiles.ts'

/** One asset upload from the host asset pool. */
export interface Upload {
  name: string
  path: string
  mime: string
}

/** Model settings and local assets of one render, for the SDK bridge and the Clip Generation API. */
export interface ClipRequest {
  apiBaseUrl: string
  model: string
  workflow: Workflow
  aspect: string
  resolution: string
  seconds: number
  seed?: number
  prompt: string
  scene?: string
  images: Upload[]
  audio: Upload[]
  videos: Upload[]
  firstFrame?: Upload
  lastFrame?: Upload
}

const BRIDGE = fileURLToPath(new URL('./render.py', import.meta.url))
const CLEANUP_MS = 15_000
const ERROR_PREFIX = 'DV_REACTOR_ERROR '
const TIMINGS_PREFIX = 'DV_REACTOR_TIMINGS '

function readTimings(stdout: string): Record<string, number> {
  const line = stdout.split('\n').find(value => value.startsWith(TIMINGS_PREFIX))
  if (line === undefined) return {}
  try {
    const data: unknown = JSON.parse(line.slice(TIMINGS_PREFIX.length))
    if (typeof data !== 'object' || data === null) return {}
    return Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      /^reactor_[a-z]+_s$/.test(key) && typeof value === 'number' && Number.isFinite(value)))
  } catch (_invalid) {
    return {}
  }
}

/**
 * Capture the playout of a single Reactor session to a file in the caller's scratch directory.
 * @param pythonPath - the host Python interpreter containing reactor-sdk.
 * @param dir - the private scratch directory for the recording.
 * @param apiKey - the key for this render, sent only through stdin.
 * @param timeoutSeconds - the maximum session duration and the deadline for the bridge's render.
 * @param request - the model command settings and local assets to upload.
 * @param signal - requests graceful cancellation before the hard process deadline.
 * @returns the recording path and durations reported by the SDK bridge.
 */
export async function capture(
  pythonPath: string, dir: string, apiKey: string, timeoutSeconds: number, request: ClipRequest, signal: AbortSignal,
): Promise<{ recording: string; timings: Record<string, number> }> {
  signal.throwIfAborted()
  const recording = 'recording.ts'
  try {
    return await new Promise((resolve, reject) => {
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const child = execFile(pythonPath, ['-B', BRIDGE], {
        cwd: dir,
        env: scrubbedParentEnv(),
        timeout: timeoutSeconds * 1000 + CLEANUP_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 65_536,
      }, (error, stdout) => {
        signal.removeEventListener('abort', cancel)
        clearTimeout(killTimer)
        if (error === null) resolve({ recording: join(dir, recording), timings: readTimings(stdout) })
        else {
          const reported = stdout.split('\n').find(line => line.startsWith(ERROR_PREFIX))
          reject(new Error(reported?.slice(ERROR_PREFIX.length)
            ?? 'Could not run the Reactor SDK bridge. Check the configured Python interpreter and Reactor connection.'))
        }
      })
      const cancel = (): void => {
        child.stdin?.end()
        killTimer = setTimeout(() => child.kill('SIGKILL'), CLEANUP_MS)
      }
      // A bridge that fails to start or exits early can close stdin before the write settles.
      child.stdin?.on('error', (_closed: Error) => undefined)
      child.stdin?.write(JSON.stringify({ ...request, apiKey, timeoutSeconds, output: recording }) + '\n')
      signal.addEventListener('abort', cancel, { once: true })
    })
  } finally {
    signal.throwIfAborted()
  }
}
