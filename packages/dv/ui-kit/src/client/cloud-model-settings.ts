/** Provider contributions to the generation model settings table. */
import type { ComponentType } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { Registry } from './registries.ts'

/** Output type shown in the table and composer. */
export type CloudMedia = 'video' | 'image' | 'audio'

/** One provider model, grouped independently of the tasks it serves. */
export interface CloudModel {
  id: string
  name: string
  media: CloudMedia
  unavailable?: 'catalog' | 'provider' | 'workflow'
}

/** Effective provider settings read from the host. */
export interface CloudSelection {
  writable: boolean
  enabled: readonly CloudModel[]
}

/** A catalog response or a credential problem that requires a new key: the provider answered 503 or 401. */
export type CloudCatalogResult = { models: readonly CloudModel[]; warning?: string }
  | { credentialError: 'missing' | 'rejected' }

/**
 * A credential's state and the provider's remaining balance. `missing` means no key is saved; `rejected` means the
 * provider refused the key; `unavailable` means the account could not be read for another reason; `needs-setup`
 * means the provider accepted the key but the account needs a step the `message` names. It mirrors the host wire type
 * `AccountStatus` of `@dv/models`, which UI core may not import.
 */
export type CloudAccount = { status: 'missing' | 'rejected' | 'unavailable' }
  | { status: 'needs-setup'; message: string }
  | { status: 'connected'; balanceUsd: number | null; label: string | null; limitRemainingUsd: number | null }

/** A credential editor and a model catalog supplied by a provider plugin. */
export interface CloudModelSettings {
  id: string
  name: string
  /** The provider's host name shown under its name, such as `openrouter.ai`. */
  domain: string
  /** Where the user creates an API key. */
  keyUrl: string
  /** The provider's logo, drawn in `currentColor` at the given pixel size. */
  logo: ComponentType<{ size: number }>
  media: readonly CloudMedia[]
  settings: HostObservable<CloudSelection>
  /**
   * Read the saved key's state and the remaining balance.
   * @param signal - cancels the request.
   */
  account(this: void, signal: AbortSignal): Promise<CloudAccount>
  /**
   * Check a candidate key without saving it.
   * @param apiKey - the key the user typed.
   * @param signal - cancels the request.
   */
  verify(this: void, apiKey: string, signal: AbortSignal): Promise<CloudAccount>
  /**
   * Save a non-empty key, then read the catalog with the saved key.
   * @param apiKey - the new key, or an empty string to keep the saved key.
   * @param signal - cancels the request.
   */
  load(this: void, apiKey: string, signal: AbortSignal): Promise<CloudCatalogResult>
  /** Delete the saved key. Enabled models stay in the settings and read as unavailable until a key is saved again. */
  removeKey(this: void): Promise<void>
  setEnabled(this: void, model: CloudModel, enabled: boolean): Promise<void>
  /** Let the saved key serve chat requests. */
  enableOperator?(this: void): Promise<void>
  /** Stop the provider's key from serving chat requests, keeping the key itself saved. */
  disableOperator?(this: void): Promise<void>
  /**
   * Whether the provider's saved key is already the one its chat route uses,
   * read from the live operator settings.
   * @returns true while the chat profile names a key for this provider.
   */
  operatorEnabled?(this: void): boolean
}

/**
 * Read the account state a provider's account route answers.
 * @param response - the route's response.
 * @returns the account state; an answer that is not a known state reads as `unavailable`.
 */
async function readAccount(response: Response): Promise<CloudAccount> {
  if (!response.ok) return { status: 'unavailable' }
  const body = await response.json() as Partial<Record<'status' | 'message' | 'balanceUsd' | 'label' | 'limitRemainingUsd', unknown>>
  if (body.status === 'missing' || body.status === 'rejected' || body.status === 'unavailable') return { status: body.status }
  if (body.status === 'needs-setup') return { status: 'needs-setup', message: typeof body.message === 'string' ? body.message : '' }
  if (body.status !== 'connected') return { status: 'unavailable' }
  return {
    status: 'connected',
    balanceUsd: typeof body.balanceUsd === 'number' ? body.balanceUsd : null,
    label: typeof body.label === 'string' ? body.label : null,
    limitRemainingUsd: typeof body.limitRemainingUsd === 'number' ? body.limitRemainingUsd : null,
  }
}

/**
 * Read the saved key's state from a provider's `/api/dv/<provider>/account` route.
 * @param url - the same-origin account route.
 * @param signal - cancels the request.
 * @returns the account state.
 */
export async function fetchCloudAccount(url: string, signal: AbortSignal): Promise<CloudAccount> {
  return await readAccount(await fetch(url, { signal, cache: 'no-store' }))
}

/**
 * Check a candidate key through the same account route, which does not store it.
 * @param url - the same-origin account route.
 * @param apiKey - the candidate key; it is sent in the request body only.
 * @param signal - cancels the request.
 * @returns the account state the key would give.
 */
export async function verifyCloudKey(url: string, apiKey: string, signal: AbortSignal): Promise<CloudAccount> {
  return await readAccount(await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: apiKey }), signal, cache: 'no-store',
  }))
}

/**
 * Read a provider's catalog route, mapping a missing key (503) and a rejected key (401) the same way for every provider.
 * @param url - the same-origin catalog route.
 * @param signal - cancels the request.
 * @returns the parsed catalog body, or the credential problem.
 * @throws when the provider answers any other failure.
 */
export async function fetchCloudCatalog<T>(url: string, signal: AbortSignal | undefined): Promise<T | { credentialError: 'missing' | 'rejected' }> {
  const response = await fetch(url, { signal: signal ?? null, cache: 'no-store' })
  if (response.status === 401) return { credentialError: 'rejected' }
  if (response.status === 503) return { credentialError: 'missing' }
  if (!response.ok) throw new Error(`The catalog request failed with HTTP ${response.status}.`)
  return await response.json() as T
}

/**
 * Name a provider for display: the registered cloud provider's name, or the provider id with each word capitalized.
 * @param providers - the registered cloud providers.
 * @param id - the provider id of a catalog entry.
 * @returns the display name.
 */
export function providerName(providers: readonly Pick<CloudModelSettings, 'id' | 'name'>[], id: string): string {
  return providers.find(provider => provider.id === id)?.name
    ?? id.split(/[-_.\s]+/).filter(Boolean).map(word => word.slice(0, 1).toUpperCase() + word.slice(1)).join(' ')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dvCloudModels: Registry<CloudModelSettings>
  }
}

/**
 * Project a settings observable, keeping the result stable until the source changes.
 * @param source - the provider's revisioned configuration form.
 * @param project - reads the editable state and enabled models.
 * @returns a settings observable for the table.
 */
export function cloudSelection<S>(source: HostObservable<S>, project: (value: S) => CloudSelection): HostObservable<CloudSelection> {
  let last = source.getSnapshot()
  let selection = project(last)
  return {
    subscribe: listener => source.subscribe(listener),
    getSnapshot() {
      const next = source.getSnapshot()
      if (last !== next) {
        last = next
        selection = project(next)
      }
      return selection
    },
  }
}
