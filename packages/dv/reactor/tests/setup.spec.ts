/** Check the SDK probe with stand-in interpreters instead of a Python install. */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountNeedsSetupError } from '@dv/models'
import { afterEach, expect, it, vi } from 'vitest'
import { checkSdk, INSTALL_COMMAND } from '../src/setup.ts'

const cleanup: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Write an executable shell script that stands in for the Python interpreter. */
function interpreter(body: string): { python: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dv-reactor-setup-'))
  cleanup.push(dir)
  const python = join(dir, 'python')
  writeFileSync(python, `#!/bin/sh\n${body}\n`)
  chmodSync(python, 0o755)
  return { python, dir }
}

it('passes when the interpreter imports reactor_sdk', async () => {
  const { python } = interpreter('exit 0')
  await expect(checkSdk(python, new AbortController().signal, 5)).resolves.toBeUndefined()
})

it('runs the import with the scrubbed environment and without a key', async () => {
  vi.stubEnv('REACTOR_API_KEY', 'rk_should_not_reach_child')
  const { python, dir } = interpreter('echo "$@" > "$0.argv"\nenv > "$0.env"')
  await checkSdk(python, new AbortController().signal, 5)
  expect(readFileSync(join(dir, 'python.argv'), 'utf8')).toBe('-B -c import reactor_sdk\n')
  expect(readFileSync(join(dir, 'python.env'), 'utf8')).not.toContain('rk_should_not_reach_child')
})

it.each([
  ['an interpreter that fails the import', () => interpreter('exit 1').python],
  ['an interpreter that is missing', () => join(tmpdir(), 'dv-reactor-no-such-python')],
])('asks for setup with %s, naming the interpreter and the install command', async (_label, path) => {
  const python = path()
  const failure = await checkSdk(python, new AbortController().signal, 5).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AccountNeedsSetupError)
  expect((failure as Error).message).toContain(python)
  expect((failure as Error).message).toContain(INSTALL_COMMAND)
  expect(INSTALL_COMMAND).toBe("python3 -m pip install 'reactor-sdk==1.15.0'")
})

it('asks for setup when the probe outlives its deadline', async () => {
  const { python } = interpreter('exec sleep 30')
  await expect(checkSdk(python, new AbortController().signal, 1)).rejects.toBeInstanceOf(AccountNeedsSetupError)
})

it('rejects with the abort reason when the caller aborts before or during the probe', async () => {
  const { python } = interpreter('exec sleep 30')
  const reason = new Error('Cancelled')
  await expect(checkSdk(python, AbortSignal.abort(reason), 5)).rejects.toBe(reason)
  const controller = new AbortController()
  const running = checkSdk(python, controller.signal, 5)
  controller.abort(reason)
  await expect(running).rejects.toBe(reason)
})
