import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: {
      include: client
        ? ['vendor/*', 'packages/*/*', 'apps/cli']
        : ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/desktop', 'apps/desktop-host'],
      exclude: [
        // tsdown's default exclusions.
        '**/node_modules/**', '**/dist/**', '**/test?(s)/**', '**/t?(e)mp/**',
        // The FastVideo generation client loads from source through the dsh launcher's tsx hook and has no build step.
        'packages/dv/fastvideo-generation-client/**',
        // Video harness host packages load from source the same way; ui-kit, ui-reference-kit and ui-generation are
        // bundled into the client plugins that import them. One pattern per package: the matcher does not expand
        // braces.
        'packages/video-harness/oplog/**', 'packages/video-harness/runtime/**',
        'packages/dv/chat-references/**',
        'packages/dv/api/**', 'packages/dv/ui-kit/**', 'packages/dv/ui-reference-kit/**',
        'packages/dv/ui-generation/**',
        'packages/video-harness/stream/**',
        'packages/bundle/dv/**',
        // The Blender bundle ships a patch and no TypeScript.
        'packages/dv/blender/**',
        // The DreamVerse browser stories are tests only and have no build output.
        'packages/dv/e2e/**',
      ],
    },
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
