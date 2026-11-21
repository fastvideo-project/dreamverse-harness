/** Adapt Reactor's deployment aliases and account catalog to the DreamVerse models table. */
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReactorCatalog, ReactorCatalogModel, ReactorModelConfig, ReactorSettings } from '@dv/reactor/types'
import { cloudSelection, type CloudAccount, type CloudCatalogResult, type CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { ReactorLogo } from './logo.tsx'

interface Options {
  form: ConfigForm<ReactorSettings>
  storeKey: (ref: string, key: string) => Promise<void>
  removeKey: (ref: string) => Promise<void>
  discover: (signal: AbortSignal) => Promise<ReactorCatalog | Extract<CloudCatalogResult, { credentialError: string }>>
  account: (signal: AbortSignal) => Promise<CloudAccount>
  verify: (apiKey: string, signal: AbortSignal) => Promise<CloudAccount>
}

const deployment = (entry: ReactorModelConfig): string => entry.modelId ?? `reactor/${entry.profile}`

/**
 * Contribute Reactor models whose workflows DreamVerse supports.
 * @param options - the host configuration, key storage, and authenticated model catalog.
 * @returns the Reactor contribution.
 */
export function reactorSettings({ form, storeKey, removeKey, discover, account, verify }: Options): CloudModelSettings {
  let offers = new Map<string, ReactorCatalogModel>()
  return {
    id: 'reactor', name: 'Reactor', domain: 'reactor.inc', keyUrl: 'https://www.reactor.inc/dashboard',
    logo: ReactorLogo, media: ['video'], account, verify,
    settings: cloudSelection(form, state => ({
      writable: state.status === 'ready' && state.writable && state.value !== undefined,
      enabled: [...new Set(Object.values(state.value?.models ?? {}).map(deployment))]
        .map(id => ({ id, name: id, media: 'video' })),
    })),
    async load(apiKey, signal) {
      if (apiKey !== '') await storeKey(form.getSnapshot().value?.credentialRef ?? 'REACTOR_API_KEY', apiKey)
      signal.throwIfAborted()
      const result = await discover(signal)
      signal.throwIfAborted()
      if ('credentialError' in result) return result
      const { models } = result
      offers = new Map(models.map(model => [model.name, model]))
      // Keep custom configured deployments visible, even without a known catalog profile.
      return { models: models.filter(model => model.profile !== undefined || model.shotModels.length > 0)
        .map(model => ({
          id: model.name, name: model.displayName ?? model.name, media: 'video',
          ...(model.status === 'disabled' ? { unavailable: 'provider' as const }
            : model.profile === undefined ? { unavailable: 'workflow' as const } : {}),
        })) }
    },
    removeKey: async () => { await removeKey(form.getSnapshot().value?.credentialRef ?? 'REACTOR_API_KEY') },
    async setEnabled(model, enabled) {
      const state = form.getSnapshot()
      const models = state.value?.models ?? {}
      const aliases = new Set(offers.get(model.id)?.shotModels)
      const matches = (alias: string, entry: ReactorModelConfig): boolean => deployment(entry) === model.id || aliases.has(alias)
      const alreadyEnabled = Object.entries(models).some(([alias, entry]) => matches(alias, entry))
      if (alreadyEnabled === enabled) return
      const next = Object.fromEntries(Object.entries(models).filter(([alias, entry]) => !matches(alias, entry)))
      if (enabled) {
        const offer = offers.get(model.id)
        const alias = offer?.profile
        if (alias === undefined || Object.hasOwn(next, alias) || offer?.status === 'disabled') throw new Error('Unavailable model')
        next[alias] = { profile: alias, modelId: model.id }
      }
      if (!await form.mutate([{ op: 'set', path: ['models'], value: next }], state.revision)) throw new Error('Settings write refused')
    },
  }
}
