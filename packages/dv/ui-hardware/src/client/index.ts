/** Hardware and generation-model settings registered into the existing settings shell. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RunPodView, WorkerConfig, WorkerView } from '@dv/hardware/types'
import { currentLanguage } from '@dv/ui-kit/locale.ts'
import { HardwarePage, type InstalledModel } from './HardwarePage.tsx'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'configForms', 'remote', 'remote.credentials']

/** Read authenticated same-origin JSON without echoing worker responses into errors. */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`Generation settings request failed (HTTP ${response.status}).`)
  return await response.json() as T
}

/** Install settings contributions without replacing operator LLM configuration. */
export function apply(ctx: Context): void {
  const check = () => json<WorkerView[]>('/api/dv/hardware/check', { method: 'POST' })
  const catalog = async (worker: string): Promise<InstalledModel[]> => {
    const value = await json<{ data: unknown[] }>(`/api/dv/hardware/models?worker=${encodeURIComponent(worker)}`)
    if (!Array.isArray(value.data)) throw new Error('Invalid generation model catalog.')
    return value.data.map((row) => {
      if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string'
        || !('tasks' in row) || !Array.isArray(row.tasks) || !row.tasks.every((task: unknown) => typeof task === 'string')
        || !('installed' in row) || typeof row.installed !== 'boolean' || !('loaded' in row) || typeof row.loaded !== 'boolean') {
        throw new Error('The worker does not expose a managed model catalog.')
      }
      return { id: row.id, tasks: row.tasks, installed: row.installed, loaded: row.loaded }
    })
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dv-hardware', order: 11,
    label: () => (currentLanguage() === 'zh' ? zh : en).hardware,
    inject: () => ({
      form: ctx.configForms.get<{ workers: Record<string, WorkerConfig> }>('dv-hardware'),
      routing: ctx.configForms.get<{ useHardware: boolean }>('dv-fastvideo'), check,
      models: { catalog,
        action: async (worker: string, action: 'load' | 'unload', model: string, task: string) => {
          await json(`/api/dv/hardware/models?worker=${encodeURIComponent(worker)}`, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, model, task }) })
        },
      },
      runpodPods: async (credentialRef: string) => (await json<{ data: RunPodView[] }>('/api/dv/hardware/runpod/pods', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credentialRef }),
      })).data,
      storeCredential: async (ref: string, value: string) => {
        const response = await ctx.remote.credentials.set(ref, value)
        if (!response.ok) throw new Error(response.error.message)
      },
      removeCredential: async (ref: string) => {
        const response = await ctx.remote.credentials.unset(ref)
        if (!response.ok) throw new Error(response.error.message)
      },
    }),
  }, HardwarePage))
}
