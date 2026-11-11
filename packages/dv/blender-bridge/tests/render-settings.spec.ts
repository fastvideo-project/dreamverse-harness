/**
 * The add-on's `commands.render` in a real Blender (`DV_BLENDER`, else `blender` on `PATH`); the suite skips when no
 * Blender runs.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BLENDER = process.env['DV_BLENDER'] ?? 'blender'
const HAS_BLENDER = spawnSync(BLENDER, ['--version'], { stdio: 'ignore' }).status === 0
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = fileURLToPath(new URL('fixtures/render-restores-settings.py', import.meta.url))
const RANGE_FIXTURE = fileURLToPath(new URL('fixtures/render-range.py', import.meta.url))

describe.skipIf(!HAS_BLENDER)('render in a real Blender (skipped: no Blender binary runs)', () => {
  it.each([
    ['png16', 'animation'],
    ['exr32', 'still'],
    ['jpeg', 'animation'],
    ['qtrle', 'animation'],
  ])('leaves the scene\'s render, FFmpeg and image settings as they were, for a %s output and a %s render', (output, kind) => {
    const run = spawnSync(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', FIXTURE, '--', PACKAGE, output, kind], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    const line = run.stdout.split('\n').find(text => text.startsWith('CHANGED '))
    expect(JSON.parse(line?.slice('CHANGED '.length) ?? 'null')).toEqual({})
  }, 60_000)

  it.each([
    [{ frame_start: 5 }, 'frames 5 to 2'],
    [{ frame_end: 0 }, 'frames 1 to 0'],
  ])('refuses an animation range %j that ends before it starts once the scene range 1 to 2 fills the missing end', (params, range) => {
    const run = spawnSync(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', RANGE_FIXTURE, '--', PACKAGE, JSON.stringify(params)], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    const line = run.stdout.split('\n').find(text => text.startsWith('RESULT ') || text.startsWith('ERROR '))
    expect(line).toMatch(/^ERROR frame_end must not come before frame_start/)
    expect(line).toContain(range)
  }, 60_000)
})
