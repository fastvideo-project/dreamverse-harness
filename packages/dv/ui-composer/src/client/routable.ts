/** Which LLM providers can serve a request now, for the composer's language model picker. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { providerUsable, type ProviderRow } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** How long a readiness read waits for a settings namespace that is still loading before it gives up. */
const SETTINGS_WAIT_MS = 2000

/**
 * Read one settings form once its first load has settled, so an unloaded document is not mistaken for an unconfigured
 * provider.
 * @param form - the shared form of one settings namespace.
 * @returns the first settled snapshot, or undefined when the form stayed loading.
 */
async function settledSettings(form: ConfigForm<unknown>): Promise<ConfigFormSnapshot<unknown> | undefined> {
  const first = form.getSnapshot()
  if (first.status !== 'loading') return first
  return await new Promise((resolve) => {
    const finish = (snapshot: ConfigFormSnapshot<unknown> | undefined): void => {
      clearTimeout(timer)
      stop()
      resolve(snapshot)
    }
    const timer = setTimeout(() => { finish(undefined) }, SETTINGS_WAIT_MS)
    const stop = form.subscribe(() => {
      const next = form.getSnapshot()
      if (next.status !== 'loading') finish(next)
    })
  })
}

/**
 * Read a provider's profile inside its settings section.
 * @param value - the section value of the provider's settings namespace.
 * @param path - the path the provider directory declares; empty when the section itself is the profile.
 * @returns the profile, or undefined when nothing is configured there.
 */
function profileAt(value: unknown, path: readonly string[]): unknown {
  let node = value
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

/** The credential reference a profile names, when it names one. */
function keyRefOf(profile: unknown): string | undefined {
  const ref = typeof profile === 'object' && profile !== null ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv : undefined
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/**
 * Read the provider routes that can serve a request now. A configurable route counts once its settings profile exists
 * and the key the profile names is stored, which is the readiness the Models page uses (`providerUsable`); a profile
 * that names no key belongs to a keyless server. Routes the settings do not declare are listed as the host reports them.
 * Any read that fails lists every route the host reports as routable.
 * @param scope - the client scope holding the session, LLM, and credential remotes and the settings forms.
 * @returns the provider ids, or null when the host's model catalog cannot be read.
 */
export async function readRoutableProviders(scope: ClientContext): Promise<readonly string[] | null> {
  const response = await scope.remote.session.modelCatalog()
  if (!response.ok) return null
  const catalog = response.value
  const declaredResponse = await scope.remote.llm.listConfigurableProviders()
  const forms = scope.get('configForms')
  if (!declaredResponse.ok || forms === undefined) return catalog.routableProviders
  const rows = new Map<string, ProviderRow>()
  for (const entry of declaredResponse.value) {
    const settings = await settledSettings(forms.get<unknown>(entry.settingsNs))
    if (settings === undefined) return catalog.routableProviders
    const profile = profileAt(settings.value, entry.settingsPath)
    rows.set(entry.provider, {
      entry: { provider: entry.provider, displayName: entry.displayName, settingsNs: entry.settingsNs,
        settingsPath: entry.settingsPath, active: true },
      configured: profile !== undefined, removable: false, apiKeyEnv: keyRefOf(profile), credential: undefined,
    })
  }
  const refs = [...new Set([...rows.values()].flatMap(row => row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]))]
  let credentials: Record<string, CredentialInfo> = {}
  if (refs.length > 0) {
    const described = await scope.remote.credentials.describe(refs)
    if (!described.ok) return catalog.routableProviders
    credentials = described.value
  }
  const usable = new Set([...rows].filter(([, row]) => row.configured
    && providerUsable(row.apiKeyEnv === undefined ? row : { ...row, credential: credentials[row.apiKeyEnv] })).map(([id]) => id))
  usable.add(catalog.default.provider)
  return catalog.routableProviders.filter(id => !rows.has(id) || usable.has(id))
}
