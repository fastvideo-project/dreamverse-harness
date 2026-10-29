/**
 * The REAL host composition of the bundle for its specs: the `dv-*` rows of `cordis.patch.yml`, with their `!!js`
 * configuration and `disabled` flags, boot through the Loader beside the DSH system prompt, the tool registry and the
 * rows that a spec adds. The disabled FastVideo row names a stand-in that records a mount, and the UniServe row a
 * stand-in that keeps its config and registers the fake model `fasth3`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvAudioGenerate from '@dv/audio-generate'
import DvCharacter from '@dv/character'
import DvFfmpeg from '@dv/ffmpeg'
import DvInspector from '@dv/inspector'
import DvLocation from '@dv/location'
import DvProject from '@dv/project'
import DvShotRender from '@dv/shot-render'
import DvStyle from '@dv/style'
import DvTextNode from '@dv/text-node'
import DvTimeline from '@dv/timeline'
import DvApi from '@dv/api'
import DvChatReferences from '@dv/chat-references'
import DvModels, { type ModelEntry } from '@dv/models'
import DvImageGenerate from '@dv/image-generate'
import * as SglangDiffusion from '@dv/sglang-diffusion'
import * as SglangOmni from '@dv/sglang-omni'
import * as WorkflowStory from '@dv/workflow-story'
import * as yaml from 'js-yaml'
import { vi } from 'vitest'
import { FakeModel, FFMPEG, FFPROBE } from '../../../dv/api/tests/support.ts'

/** Whether the stand-in FastVideo plugin was mounted. */
export const fastVideo: { mounted: boolean } = { mounted: false }

/** A stand-in for `@dv/fastvideo`: it records that it was mounted. */
const FakeFastVideo = {
  name: 'fake-fastvideo',
  apply(): void {
    fastVideo.mounted = true
  },
}

/** The config the stand-in UniServe plugin received from the bundle row. */
export const uniserve: { config: unknown } = { config: null }

/** The renderer of the fake model; its `requests` lists the render requests of the fake model. */
export const renderer = new FakeModel()

/** The fake model `fasth3` for task `ref2v` of provider `uniserve`, which renders through `renderer`. */
export const fasth3: ModelEntry<'ref2v'> = Object.create(renderer, { provider: { value: 'uniserve' } }) as ModelEntry<'ref2v'>

/** A stand-in for `@dv/uniserve`: it keeps the row's config and registers the fake model `fasth3` for task `ref2v`. */
const FakeUniserve = {
  name: 'fake-uniserve',
  inject: ['dvModels'],
  apply(ctx: Context, config: unknown): void {
    uniserve.config = config
    ctx.effect(() => ctx.dvModels.register(fasth3))
  },
}

/**
 * The plugin of each package a bundle row names, resolved through `globalThis` because Node imports the rows outside
 * Vite. The disabled FastVideo row names a stand-in that records a mount, and the UniServe row a stand-in that keeps
 * its config and registers a fake model.
 */
const PLUGINS: Record<string, object> = {
  '@deepseek-ai/dsh-system-prompt': SystemPrompt, '@deepseek-ai/dsh-tools': ToolRuntime, '@dv/project': DvProject,
  '@dv/ffmpeg': DvFfmpeg, '@dv/asset-pool': DvAssetPool, '@dv/inspector': DvInspector,
  '@dv/character': DvCharacter, '@dv/location': DvLocation, '@dv/style': DvStyle,
  '@dv/shot-render': DvShotRender, '@dv/text-node': DvTextNode, '@dv/timeline': DvTimeline,
  '@dv/api': DvApi, '@dv/chat-references': DvChatReferences,
  '@dv/models': DvModels, '@dv/fastvideo': FakeFastVideo, '@dv/uniserve': FakeUniserve, '@dv/workflow-story': WorkflowStory,
  '@dv/sglang-diffusion': SglangDiffusion, '@dv/image-generate': DvImageGenerate,
  '@dv/sglang-omni': SglangOmni, '@dv/audio-generate': DvAudioGenerate,
}

/** One row of a Loader entry list. */
export interface Row { id: string; name: string; config?: unknown; disabled?: unknown }

/**
 * The rows of the bundle patch that mount host plugins of DreamVerse, as the bundle writes them.
 * @returns the `dv-*` rows of the patch's first insert list, without the interface plugins.
 */
export function bundleRows(): Row[] {
  return insertRows().filter(row => row.id.startsWith('dv-') && !row.id.startsWith('dv-ui-'))
}

/** @returns every row of the bundle patch's first insert list, in patch order. */
export function insertRows(): Row[] {
  const patch = yaml.load(readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8'), { schema: entryListSchema })
  const [first] = patch as Array<{ insert?: Row[] }>
  return first?.insert ?? []
}

/** A booted composition, its state root, and its teardown. */
export interface Bundle {
  ctx: Context
  dir: string
  dispose: () => Promise<void>
}

/**
 * Boot the DSH system prompt and tool registry, the rows of `extra`, then the bundle rows through the Loader, with the
 * state root in a new temporary directory.
 * @param extra - the plugin of each row a spec adds, by row id.
 * @returns the composition; `dispose` stops it, restores the environment and removes the directory.
 */
export async function bootBundle(extra: Record<string, object> = {}): Promise<Bundle> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-composition-'))
  // The environment the bundle's `!!js` configuration reads.
  vi.stubEnv('DV_STATE_ROOT', dir)
  vi.stubEnv('DV_FFMPEG', FFMPEG)
  vi.stubEnv('DV_FFPROBE', FFPROBE)
  const globals = globalThis as typeof globalThis & { __dvComposition?: Record<string, object> }
  globals.__dvComposition = { ...PLUGINS, ...extra }
  // Each row keeps its id and `!!js` config; its package name points at a module that re-exports the plugin class.
  const entries = [
    { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' }, { id: 'tools', name: '@deepseek-ai/dsh-tools' },
    ...Object.keys(extra).map(id => ({ id, name: id })), ...bundleRows(),
  ].map((row) => {
    if (globals.__dvComposition?.[row.name] === undefined) throw new Error(`No plugin for bundle row ${row.id} (${row.name}).`)
    const file = join(dir, `${row.id}.mjs`)
    writeFileSync(file, `export default globalThis.__dvComposition[${JSON.stringify(row.name)}]\n`)
    return { ...row, name: pathToFileURL(file).href }
  })
  writeFileSync(join(dir, 'cordis.yml'), yaml.dump(entries, { schema: entryListSchema }))

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  return {
    ctx, dir,
    dispose: async () => {
      await ctx.fiber.dispose()
      delete globals.__dvComposition
      vi.unstubAllEnvs()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
