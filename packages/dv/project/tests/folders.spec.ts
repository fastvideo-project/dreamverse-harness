/**
 * The DreamVerse folder of `dvProject`: the configured folder, else the DSH first-use Documents rule, a load failure
 * that names `DV_PROJECTS_FOLDER` when that rule does not resolve, and fresh, distinct folders for new chats.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DvProject from '../src/index.ts'
import { tempRoot } from './support.ts'
import { provideChatServices } from './workspaces.ts'

const documents = vi.hoisted(() => ({ folder: null as string | null }))

vi.mock('@deepseek-ai/dsh-api-workspace-controller', () => ({
  defaultWorkspaceDirectory: (name: string) => documents.folder === null
    ? Promise.reject(new Error('system Documents directory is unavailable'))
    : Promise.resolve(join(documents.folder, 'deepseek-harness', name)),
}))

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/**
 * Load `dvProject`.
 * @param config - the config besides the defaults.
 * @returns the plugin's fiber and the context.
 */
function load(config: { projectsFolder?: string }) {
  const context = new Context()
  contexts.push(context)
  provideChatServices(context)
  const fiber = context.plugin(DvProject, {
    cpuConcurrency: 1, gpuConcurrency: 1, promptSectionOrder: 4900, ...config,
  })
  return { context, fiber }
}

describe('the DreamVerse folder', () => {
  it('makes fresh folders with distinct names in the configured folder', async () => {
    const root = tempRoot()
    const { context, fiber } = load({ projectsFolder: join(root, 'DreamVerse') })
    await fiber.await()
    const folders = await Promise.all([context.dvProject.newProjectFolder('a/b'), context.dvProject.newProjectFolder('a/b')])
    expect(folders.sort()).toEqual([join(root, 'DreamVerse', 'a-b'), join(root, 'DreamVerse', 'a-b 2')])
    expect(readdirSync(join(root, 'DreamVerse')).sort()).toEqual(['a-b', 'a-b 2'])
    await expect(context.dvProject.newProjectFolder(' ')).rejects.toMatchObject({ code: 'invalid_params' })
  })

  it('defaults to DreamVerse under the Documents folder, and fails to load naming DV_PROJECTS_FOLDER without one or for a relative one', async () => {
    const root = tempRoot()
    documents.folder = join(root, 'Documents')
    const found = load({})
    await found.fiber.await()
    expect(await found.context.dvProject.newProjectFolder('Untitled project'))
      .toBe(join(root, 'Documents', 'deepseek-harness', 'DreamVerse', 'Untitled project'))
    documents.folder = null
    const missing = load({})
    await expect(missing.fiber.await()).rejects.toThrow(/Set DV_PROJECTS_FOLDER/)
    await expect(load({ projectsFolder: '' }).fiber.await()).rejects.toThrow(/must be an absolute path/)
    await expect(load({ projectsFolder: 'relative/DreamVerse' }).fiber.await()).rejects.toThrow(/must be an absolute path/)
  })
})
