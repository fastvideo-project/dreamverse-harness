/**
 * The add-on's viewport stream and view changes in a real Blender with two windows (`DV_BLENDER`, else `blender` on
 * `PATH`, under `xvfb-run`); the suite skips when `xvfb-run` or Blender does not run.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BLENDER = process.env['DV_BLENDER'] ?? 'blender'
const HAS_BLENDER = spawnSync(BLENDER, ['--version'], { stdio: 'ignore' }).status === 0
const HAS_XVFB = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).status === 0
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = fileURLToPath(new URL('fixtures/multi-window-stream.py', import.meta.url))

describe.skipIf(!HAS_BLENDER || !HAS_XVFB)('the main 3D view in a real Blender with two windows (skipped: xvfb-run or a Blender binary does not run)', () => {
  it('streams every frame from one 3D view and moves that same view', () => {
    const run = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', BLENDER, '--factory-startup', '--python-exit-code', '1', '--python', FIXTURE, '--', PACKAGE], { encoding: 'utf8', timeout: 90_000 })
    const line = run.stdout.split('\n').find(text => text.startsWith('RESULT ') || text.startsWith('ERROR '))
    expect(line, run.stdout + run.stderr).toMatch(/^RESULT /)
    const result = JSON.parse(line?.slice('RESULT '.length) ?? 'null') as { windows: number; frames: number; frame_areas: number[]; moved_areas: number[] }
    expect(result.windows).toBe(2)
    expect(result.frames).toBeGreaterThan(0)
    expect(result.frame_areas).toHaveLength(1)
    expect(result.moved_areas).toEqual(result.frame_areas)
  }, 120_000)
})
