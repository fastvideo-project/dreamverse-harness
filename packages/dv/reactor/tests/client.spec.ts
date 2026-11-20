/** Check the SDK bridge process handling of `capture` with stand-in interpreters instead of the Reactor SDK. */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { capture } from '../src/client.ts'

const cleanup: string[] = []
const request: Parameters<typeof capture>[4] = { apiBaseUrl: 'https://api.reactor.inc', model: 'reactor/fast-h3', workflow: { kind: 'take' }, aspect: '16:9', resolution: '768p', seconds: 8,
  prompt: 'A lake', images: [], audio: [], videos: [] }

afterEach(() => {
  vi.useRealTimers()
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Write an executable shell script that stands in for the Python interpreter. */
function interpreter(body: string): { python: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dv-reactor-client-'))
  cleanup.push(dir)
  const python = join(dir, 'python')
  writeFileSync(python, `#!/bin/sh\n${body}\n`)
  chmodSync(python, 0o755)
  return { python, dir }
}

it('returns the recording path and the finite numeric timings that the bridge reports', async () => {
  const { python, dir } = interpreter('read line\necho \'DV_REACTOR_TIMINGS {"reactor_setup_s": 1.5, "reactor_bad_s": "x", "other": 2}\'')
  const result = await capture(python, dir, 'rk_secret', 30, request, new AbortController().signal)
  expect(result).toEqual({ recording: join(dir, 'recording.ts'), timings: { reactor_setup_s: 1.5 } })
})

it.each([
  ['no timings line', 'echo done'],
  ['a timings line that is not JSON', 'echo "DV_REACTOR_TIMINGS {oops"'],
  ['a timings line that is not an object', 'echo "DV_REACTOR_TIMINGS null"'],
])('reports empty timings for %s', async (_label, script) => {
  const { python, dir } = interpreter(`read line\n${script}`)
  expect((await capture(python, dir, 'rk_secret', 30, request, new AbortController().signal)).timings).toEqual({})
})

it('sends the key and the request on stdin only', async () => {
  const { python, dir } = interpreter('read line\necho "DV_REACTOR_ERROR $line"\nexit 1')
  const failure = await capture(python, dir, 'rk_secret', 30, request, new AbortController().signal).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  expect(JSON.parse((failure as Error).message)).toMatchObject({ apiBaseUrl: 'https://api.reactor.inc', apiKey: 'rk_secret', timeoutSeconds: 30, output: 'recording.ts', prompt: 'A lake' })
})

it('reports the bridge error line, or a generic message when the bridge fails without one', async () => {
  const reported = interpreter('read line\necho "DV_REACTOR_ERROR Reactor could not finish."\nexit 1')
  await expect(capture(reported.python, reported.dir, 'rk', 30, request, new AbortController().signal))
    .rejects.toThrow('Reactor could not finish.')
  const silent = interpreter('read line\nexit 2')
  await expect(capture(silent.python, silent.dir, 'rk', 30, request, new AbortController().signal))
    .rejects.toThrow('Could not run the Reactor SDK bridge.')
})

it('tolerates a bridge that exits before it reads a large request', async () => {
  const { python, dir } = interpreter('exit 3')
  await expect(capture(python, dir, 'rk', 30, { ...request, prompt: 'x'.repeat(4_000_000) }, new AbortController().signal))
    .rejects.toThrow('Could not run the Reactor SDK bridge.')
})

it('refuses to start when the caller already aborted', async () => {
  const { python, dir } = interpreter('exit 0')
  const reason = new Error('Cancelled before start')
  await expect(capture(python, dir, 'rk', 30, request, AbortSignal.abort(reason))).rejects.toBe(reason)
})

it('closes stdin on cancellation and rejects with the abort reason', async () => {
  const { python, dir } = interpreter('cat >/dev/null')
  const controller = new AbortController()
  const reason = new Error('Cancelled by operator')
  const result = capture(python, dir, 'rk', 30, request, controller.signal)
  controller.abort(reason)
  await expect(result).rejects.toBe(reason)
})

it('kills a bridge that ignores cancellation after the cleanup period', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const { python, dir } = interpreter('trap "" TERM\nwhile true; do sleep 1; done')
  const controller = new AbortController()
  const reason = new Error('Cancelled by operator')
  const result = capture(python, dir, 'rk', 30, request, controller.signal)
  const settled = result.catch((error: unknown) => error)
  controller.abort(reason)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(await settled).toBe(reason)
})
