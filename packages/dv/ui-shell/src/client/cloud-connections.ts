/** Account and catalog state of the generation providers, shared by the Models settings header and footer. */
import type { CloudAccount, CloudModel, CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'

/** A provider's account while its first read is in flight, or its last answer. */
export type AccountState = { status: 'checking' } | CloudAccount

/** A provider's catalog while it loads, after it loaded, or after it failed. */
export type CatalogState = { status: 'loading' }
  | { status: 'ready'; models: readonly CloudModel[]; warning?: string }
  | { status: 'failed' }

/** One immutable snapshot of every provider's account and catalog. */
export interface ConnectionsSnapshot {
  accounts: ReadonlyMap<string, AccountState>
  catalogs: ReadonlyMap<string, CatalogState>
}

/**
 * The outcome of saving a key. `saved` stored the key and loaded the catalog. `rejected` and `unavailable` mean the
 * provider refused or could not check the candidate key, which is then not stored. `needs-setup` stored the key
 * because the provider accepted it, and carries what the account still needs. `missing` and `failed` come from the
 * catalog request after a stored key.
 */
export type SaveResult = { status: 'saved' | 'missing' | 'rejected' | 'unavailable' | 'failed' }
  | { status: 'needs-setup'; message: string }

const UNAVAILABLE: CloudAccount = { status: 'unavailable' }

/**
 * Read each provider's account once and load the catalog of every connected provider with its saved key. Requests of
 * one provider supersede that provider's earlier requests.
 */
export class CloudConnections {
  private snapshot: ConnectionsSnapshot = { accounts: new Map(), catalogs: new Map() }
  private readonly listeners = new Set<() => void>()
  private readonly requests = new Map<string, AbortController>()

  /**
   * Observe snapshot replacements.
   * @param listener - called after each change.
   * @returns the disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @returns the current snapshot, stable until the next change. */
  getSnapshot = (): ConnectionsSnapshot => this.snapshot

  private publish(id: string, account: AccountState | undefined, catalog: CatalogState | null | undefined): void {
    const accounts = new Map(this.snapshot.accounts)
    const catalogs = new Map(this.snapshot.catalogs)
    if (account !== undefined) accounts.set(id, account)
    if (catalog === null) catalogs.delete(id)
    else if (catalog !== undefined) catalogs.set(id, catalog)
    this.snapshot = { accounts, catalogs }
    for (const listener of this.listeners) listener()
  }

  private begin(id: string): AbortSignal {
    this.requests.get(id)?.abort()
    const controller = new AbortController()
    this.requests.set(id, controller)
    return controller.signal
  }

  /**
   * Read the providers whose account has not been read yet.
   * @param providers - the registered providers.
   */
  ensure(providers: readonly CloudModelSettings[]): void {
    for (const provider of providers) {
      if (!this.snapshot.accounts.has(provider.id)) void this.refresh(provider)
    }
  }

  /**
   * Read the account again and, while it is connected, the catalog.
   * @param provider - the provider to read.
   */
  async refresh(provider: CloudModelSettings): Promise<void> {
    const signal = this.begin(provider.id)
    this.publish(provider.id, { status: 'checking' }, undefined)
    const account = await provider.account(signal).catch((): CloudAccount => UNAVAILABLE)
    if (signal.aborted) return
    this.publish(provider.id, account, undefined)
    if (account.status === 'connected') await this.load(provider, '', signal)
  }

  /**
   * Check a candidate key, store it unless the provider refuses it, then load the catalog and read the account again.
   * @param provider - the provider to save the key of.
   * @param apiKey - the new key, or an empty string to check the saved key.
   * @returns what happened to the key.
   */
  async save(provider: CloudModelSettings, apiKey: string): Promise<SaveResult> {
    const signal = this.begin(provider.id)
    if (apiKey !== '') {
      const candidate = await provider.verify(apiKey, signal).catch((): CloudAccount => UNAVAILABLE)
      if (signal.aborted) return { status: 'failed' }
      if (candidate.status === 'rejected' || candidate.status === 'unavailable' || candidate.status === 'missing') {
        return { status: candidate.status === 'missing' ? 'rejected' : candidate.status }
      }
    }
    const loaded = await this.load(provider, apiKey, signal)
    const superseded = (): boolean => signal.aborted
    if (superseded()) return loaded
    const account = await provider.account(signal).catch((): CloudAccount => UNAVAILABLE)
    if (superseded()) return loaded
    this.publish(provider.id, account, undefined)
    if (loaded.status === 'saved' && account.status === 'needs-setup') return { status: 'needs-setup', message: account.message }
    return loaded
  }

  /**
   * Delete the provider's saved key and drop its catalog.
   * @param provider - the provider to disconnect.
   * @throws when the provider cannot delete the key.
   */
  async remove(provider: CloudModelSettings): Promise<void> {
    this.begin(provider.id)
    await provider.removeKey()
    this.publish(provider.id, { status: 'missing' }, null)
  }

  private async load(provider: CloudModelSettings, apiKey: string, signal: AbortSignal): Promise<SaveResult> {
    this.publish(provider.id, undefined, { status: 'loading' })
    try {
      const catalog = await provider.load(apiKey, signal)
      if (signal.aborted) return { status: 'failed' }
      if ('credentialError' in catalog) {
        this.publish(provider.id, undefined, { status: 'failed' })
        return { status: catalog.credentialError }
      }
      this.publish(provider.id, undefined, { status: 'ready', models: catalog.models,
        ...catalog.warning === undefined ? {} : { warning: catalog.warning } })
      return { status: 'saved' }
    } catch (_failed) {
      // The catalog request failed; the snapshot records it so the sheet and the table report it in place.
      if (!signal.aborted) this.publish(provider.id, undefined, { status: 'failed' })
      return { status: 'failed' }
    }
  }

  /** Cancel every request in flight. */
  dispose(): void {
    for (const request of this.requests.values()) request.abort()
    this.requests.clear()
  }
}
