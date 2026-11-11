/**
 * Cancelled requests at the add-on in a real Blender ({@link BLENDER}), linked to a {@link BlenderLink} on a
 * test-owned port; the suite skips when no Blender runs.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { BlenderLink } from '../src/link.ts'
import { BLENDER, fixtureArgs, HAS_BLENDER } from './real-blender.ts'
const WAIT = { timeoutMs: 30_000, signal: new AbortController().signal }

describe.skipIf(!HAS_BLENDER)('requests in a real Blender (skipped: no Blender binary runs)', () => {
  it('skips a stopped request that waits behind a running one', async () => {
    const link = new BlenderLink({ maxFileBytes: 1 << 20, pingMs: 60_000 }, () => {})
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/dv/blender/ws' })
    server.on('connection', (socket) => { link.attach(socket) })
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo
    const blender = spawn(BLENDER, ['-b', ...fixtureArgs('drive-link.py', [`http://127.0.0.1:${String(port)}#token`])], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    blender.stdout.on('data', (data: Buffer) => { output += data.toString() })
    blender.stderr.on('data', (data: Buffer) => { output += data.toString() })
    const exited = once(blender, 'exit')
    try {
      for (let tries = 0; !link.linked; tries += 1) {
        if (tries === 300 || blender.exitCode !== null) throw new Error(`Blender did not link:\n${output}`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      const busy = link.request('run', { code: 'import time\ntime.sleep(2)' }, WAIT)
      const stop = new AbortController()
      const queued = link.request('run', { code: 'bpy.data.objects.new("queued", None)' }, { timeoutMs: 30_000, signal: stop.signal })
      const stopped = queued.then(() => 'answered', (error: unknown) => String(error))
      await new Promise(resolve => setTimeout(resolve, 300))
      stop.abort()
      await busy
      const names = await link.request('run', { code: 'result = [o.name for o in bpy.data.objects]' }, WAIT)
      expect(await stopped).toContain('The call was stopped')
      expect(names.result['result']).not.toContain('queued')
    } finally {
      link.close(1000, 'The test ended.')
      const timer = setTimeout(() => { blender.kill('SIGKILL') }, 10_000)
      await exited
      clearTimeout(timer)
      server.close()
    }
  }, 60_000)
})
