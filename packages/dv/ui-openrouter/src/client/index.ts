/** OpenRouter video setup in the existing Settings shell. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { OpenRouterSettings, VideoModel } from '@dv/openrouter/types'
import { currentLanguage } from '@dv/ui-kit/locale.ts'
import { OpenRouterPage } from './OpenRouterPage.tsx'

export const inject = ['slots', 'configForms', 'remote', 'remote.credentials']
export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dv-video-apis', order: 13,
    label: () => currentLanguage() === 'zh' ? '视频 API' : 'Video APIs',
    inject: () => ({
      form: ctx.configForms.get<OpenRouterSettings>('dv-openrouter'),
      enableOperator: async (ref: string) => {
        const form = ctx.configForms.get<{ providers: Record<string, Record<string, unknown>> }>('llm-pi-ai')
        const state = form.getSnapshot()
        if (state.status !== 'ready' || !state.writable) throw new Error('Operator settings are unavailable.')
        const profile = state.value?.providers['openrouter'] ?? {}
        if (!await form.mutate([{ op: 'set', path: ['providers', 'openrouter'], value: { ...profile, apiKeyEnv: ref } }],
          state.revision)) throw new Error('Operator settings changed. Try again.')
      },
      storeKey: async (ref: string, key: string) => {
        if (!(await ctx.remote.credentials.set(ref, key)).ok) throw new Error('Could not store the API key.')
      },
      discover: async (): Promise<VideoModel[]> => {
        const response = await fetch('/api/dv/openrouter/catalog')
        if (!response.ok) throw new Error('OpenRouter video discovery failed.')
        const value: { data: VideoModel[]; error: string | null } = await response.json()
        if (value.error !== null) throw new Error(value.error)
        return value.data
      },
    }),
  }, OpenRouterPage))
}
