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
import { installMiniMax } from './minimax.ts'
import { isMiniMaxSkill, type MiniMaxSkill } from './minimax-routing.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Optional MiniMax selection and instructions, recorded as an ordinary context message. */
    'dv-minimax-skill': { kind: 'dv-minimax-skill'; form: 'instructions'; skill: MiniMaxSkill | null; selection: string }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dv-workflow-story'

/** Optional MiniMax integration; disabled deployments keep the original workflows. */
export interface Config {
  minimaxSkillsMode?: 'off' | 'auto' | 'manual'
  minimaxSkill?: string
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  minimaxSkillsMode: z.union(['off', 'auto', 'manual']).default('off'),
  minimaxSkill: z.string(),
})

/**
 * Serve the `skills/` folder while the skill registry is mounted.
 * @param ctx - plugin context.
 * @param config - optional MiniMax routing settings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const mode = config.minimaxSkillsMode ?? 'off'
  const selection = config.minimaxSkill ?? ''
  if (mode === 'manual' && !isMiniMaxSkill(selection)) {
    throw new Error('DV_MINIMAX_SKILL must name an official MiniMax skill when DV_MINIMAX_SKILLS_MODE=manual.')
  }
  ctx.inject(['skills', 'tools', 'agents', 'systemPrompt', 'dvProject'], (child) => {
    installMiniMax(child, mode === 'manual' ? selection : mode)
  })
  ctx.inject(['skills'], (child) => {
    child.effect(() => child.skills.registerProvider(control => new FileSystemSkillProvider(child, control, {
      providerName: 'workflow-story', includeDefaultRoots: false, customSkillDirs: [fileURLToPath(new URL('../skills', import.meta.url))],
    })), 'dv-workflow-story skills')
  })
}
