/**
 * The add-on's viewport stream, view changes and camera checks in a real Blender with two windows, and with one 3D view in
 * Quad View
 * (`DV_BLENDER`, else `blender` on `PATH`, under `xvfb-run`); the suite skips when `xvfb-run` or Blender does not run.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BLENDER = process.env['DV_BLENDER'] ?? 'blender'
const HAS_BLENDER = spawnSync(BLENDER, ['--version'], { stdio: 'ignore' }).status === 0
const HAS_XVFB = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).status === 0
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = fileURLToPath(new URL('fixtures/multi-window-stream.py', import.meta.url))
const SCENE_FIXTURE = fileURLToPath(new URL('fixtures/main-view-scene.py', import.meta.url))

/** The fixture's `RESULT` JSON: pointers of the 3D view areas and regions that frames came from and that the orbit moved. */
interface Result {
  windows: number
  frames: number
  frame_areas: number[]
  moved_areas: number[]
  frame_regions: number[]
  moved_regions: number[]
}

/** Run `fixture` in a real Blender under `xvfb-run` with the extra fixture arguments `extra` and return its `RESULT` JSON text. */
function runFixture(extra: string[], fixture = FIXTURE): string {
  const run = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', BLENDER, '--factory-startup', '--python-exit-code', '1', '--python', fixture, '--', PACKAGE, ...extra], { encoding: 'utf8', timeout: 90_000 })
  const line = run.stdout.split('\n').find(text => text.startsWith('RESULT ') || text.startsWith('ERROR '))
  expect(line, run.stdout + run.stderr).toMatch(/^RESULT /)
  return line?.slice('RESULT '.length) ?? 'null'
}

describe.skipIf(!HAS_BLENDER || !HAS_XVFB)('the main 3D view in a real Blender (skipped: xvfb-run or a Blender binary does not run)', () => {
  it('streams every frame from one 3D view and moves that same view', () => {
    const result = JSON.parse(runFixture([])) as Result
    expect(result.windows).toBe(2)
    expect(result.frames).toBeGreaterThan(0)
    expect(result.frame_areas).toHaveLength(1)
    expect(result.moved_areas).toEqual(result.frame_areas)
  }, 120_000)

  it('streams the user region of a 3D view in Quad View and moves that same region', () => {
    const result = JSON.parse(runFixture(['quad'])) as Result
    expect(result.frames).toBeGreaterThan(0)
    expect(result.frame_regions).toHaveLength(1)
    expect(result.moved_regions).toEqual(result.frame_regions)
  }, 120_000)

  it('checks the camera of the scene that the main 3D view shows', () => {
    const result = JSON.parse(runFixture([], SCENE_FIXTURE)) as { look: string | null; preset: string | null }
    expect(result.look).toBe('The scene has no active camera; set one first, or look at the viewport.')
    expect(result.preset).toBe('The scene has no active camera.')
  }, 120_000)
})
