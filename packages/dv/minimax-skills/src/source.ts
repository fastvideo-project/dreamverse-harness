/** Historical instruction-message metadata, independent of optional project services. */
import type { MiniMaxSkill } from './catalog.ts'
import type {} from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Historical MiniMax context remains readable after extraction into the standalone plugin. */
    'dv-minimax-skill': { kind: 'dv-minimax-skill'; form: 'instructions'; skill: MiniMaxSkill | null; selection: string }
  }
}
