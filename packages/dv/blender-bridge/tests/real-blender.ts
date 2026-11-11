/**
 * The real Blender that the real-Blender specs run (`DV_BLENDER`, else `blender` on `PATH`), and the arguments that run
 * a script of `fixtures/` in it with this package's folder, the parent of the add-on, as the script's first argument.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The Blender binary. */
export const BLENDER = process.env['DV_BLENDER'] ?? 'blender'
/** Whether {@link BLENDER} runs; the real-Blender suites skip otherwise. */
export const HAS_BLENDER = spawnSync(BLENDER, ['--version'], { stdio: 'ignore' }).status === 0
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/**
 * The Blender arguments that run a fixture script in a factory-startup Blender, which exits with status 1 when the
 * script raises.
 * @param fixture - the script's file name in `fixtures/`.
 * @param args - the script's arguments after the package folder.
 * @returns the arguments after the Blender binary and its `-b`, when the run has no window.
 */
export function fixtureArgs(fixture: string, args: string[] = []): string[] {
  return ['--factory-startup', '--python-exit-code', '1', '--python', fileURLToPath(new URL(`fixtures/${fixture}`, import.meta.url)), '--', PACKAGE, ...args]
}
