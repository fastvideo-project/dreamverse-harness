/**
 * The workflow skills of DreamVerse: while the DSH skill registry `skills` is mounted, one `FileSystemSkillProvider`
 * serves every `<name>/SKILL.md` of the package's `skills/` folder, and no other folder.
 *
 * @module @dv/workflow-story
 */
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dv-workflow-story'

/** Plugin configuration: the workflow skills have no deployment-varying values. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

/**
 * Serve the `skills/` folder while the skill registry is mounted.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['skills'], (child) => {
    child.effect(() => child.skills.registerProvider(control => new FileSystemSkillProvider(child, control, {
      providerName: 'workflow-story', includeDefaultRoots: false, customSkillDirs: [fileURLToPath(new URL('../skills', import.meta.url))],
    })), 'dv-workflow-story skills')
  })
}
