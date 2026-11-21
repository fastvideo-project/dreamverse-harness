/** Adapt OpenRouter's configuration and catalog to the DreamVerse models table. */
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { OpenRouterCatalog, OpenRouterSettings } from '@dv/openrouter/types'
import { cloudSelection, type CloudAccount, type CloudCatalogResult, type CloudMedia, type CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { OpenRouterLogo } from './logo.tsx'

interface Options {
  form: ConfigForm<OpenRouterSettings>
  storeKey: (ref: string, key: string) => Promise<void>
  removeKey: (ref: string) => Promise<void>
  discover: (signal?: AbortSignal) => Promise<OpenRouterCatalog | Extract<CloudCatalogResult, { credentialError: string }>>
  enableOperator: (ref: string) => Promise<void>
  /** Stop the saved key from serving chat requests. */
  disableOperator: () => Promise<void>
  /** Whether the chat route already carries this provider's key. */
  operatorEnabled: () => boolean
  account: (signal: AbortSignal) => Promise<CloudAccount>
  verify: (apiKey: string, signal: AbortSignal) => Promise<CloudAccount>
}

const fields = { video: 'models', image: 'imageModels', audio: 'audioModels' } as const
const media: readonly CloudMedia[] = ['video', 'image', 'audio']

/**
 * Contribute OpenRouter models and write their aliases to the host settings.
 * @param options - the existing catalog and credential operations.
 * @returns the OpenRouter contribution.
 */
export function openRouterSettings({
  form, storeKey, removeKey, discover, enableOperator, disableOperator, operatorEnabled, account, verify,
}: Options): CloudModelSettings {
  const settings = cloudSelection(form, state => ({
    writable: state.status === 'ready' && state.writable,
    enabled: media.flatMap(kind => [...new Set(Object.values(state.value?.[fields[kind]] ?? {}))]
      .map(id => ({ id, name: id, media: kind }))),
  }))

  const keyRef = (): string => form.getSnapshot().value?.credentialRef ?? 'OPENROUTER_API_KEY'

  return {
    id: 'openrouter', name: 'OpenRouter', domain: 'openrouter.ai', keyUrl: 'https://openrouter.ai/settings/keys',
    logo: OpenRouterLogo, media, settings, account, verify,
    async load(apiKey, signal) {
      if (apiKey !== '') await storeKey(keyRef(), apiKey)
      signal.throwIfAborted()
      const catalog = await discover(signal)
      if ('credentialError' in catalog) return catalog
      const { videos, images, speech, error } = catalog
      return {
        models: [
          ...videos.map(({ id, name }) => ({ id, name, media: 'video' as const })),
          ...images.map(({ id, name }) => ({ id, name, media: 'image' as const })),
          ...speech.map(({ id, name }) => ({ id, name, media: 'audio' as const })),
        ],
        ...(error === null ? {} : { warning: error }),
      }
    },
    async setEnabled(model, enabled) {
      const state = form.getSnapshot()
      const field = fields[model.media]
      const values = state.value?.[field] ?? {}
      if (Object.values(values).includes(model.id) === enabled) return
      const alias = model.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)
      if (enabled && (alias === '' || Object.hasOwn(values, alias))) throw new Error('Alias collision')
      const next = enabled ? { ...values, [alias]: model.id }
        : Object.fromEntries(Object.entries(values).filter(([, id]) => id !== model.id))
      if (!await form.mutate([{ op: 'set', path: [field], value: next }], state.revision)) throw new Error('Settings write refused')
    },
    removeKey: async () => {
      if (operatorEnabled()) await disableOperator()
      await removeKey(keyRef())
    },
    enableOperator: async () => { await enableOperator(keyRef()) },
    disableOperator,
    operatorEnabled,
  }
}
