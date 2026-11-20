/**
 * Models-page extension slots — the seats through which a plugin
 * distributed outside this repository adds UI to the Models settings section
 * without editing it.
 *
 * `settings.models.provider-card` is keyed by the row's owning settings
 * namespace (`ProviderDirectoryEntry.settingsNs`): an adapter family's
 * companion plugin registers one entry under the family's namespace and
 * receives every card of that family — shipped, added, and hand-declared rows
 * alike — while the section never learns what the namespace means. Keying on
 * the namespace follows `settings.plugin.item`, and the key domain stays the
 * open string space because hand-declared route ids are user-chosen at
 * runtime.
 *
 * TYPE HOME RATIONALE: the Models section declares these slots at runtime,
 * and a plugin registering an extension already depends on this package for
 * the declaration. The types therefore live with their declarer.
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { ModelsSettingsState, ProviderDirectoryEntry, ProviderRow } from './store.ts'
import type { en } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One provider card's adapter extension area, dispatched with
     * `entryKey = settingsNs` on every card that renders a directory row: a
     * saved row's card (its first-run setup posture included) and the
     * add-provider draft card. The hand-declared draft card has no directory
     * row yet, so it dispatches nothing until saved. Without a registrant the
     * area renders nothing.
     */
    'settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardExtrasOwnerProps }
    /** Optional account login choice before the credential editor. */
    'settings.models.sign-in': { kind: 'single'; scope: 'root'; owner: { complete: () => void; useApiKey: () => void } }
    /**
     * Ordered extension area after the page intro and before the provider rows.
     * Without a registrant the area renders nothing.
     */
    'settings.models.header': { kind: 'list'; scope: 'root'; owner: ModelsHeaderOwnerProps }
    /**
     * Ordered extension area after the provider rows and the add controls.
     * Without a registrant the area renders nothing.
     */
    'settings.models.footer': { kind: 'list'; scope: 'root'; owner: ModelsFooterOwnerProps }
  }
}

/** Owner share of one provider-card extension occurrence. */
export interface ProviderCardExtrasOwnerProps {
  /** The card's directory row (route id, display name, settings address, live state). */
  provider: ProviderDirectoryEntry
  /** Whether any layer configures this provider (its profile resolves); `false` while the add-provider draft edits a dormant row. */
  configured: boolean
  /** Whether the row's referenced api-key credential is confirmed configured (the page's credential join). */
  keyConfigured: boolean
}

/** Owner share of the footer area (the section supplies nothing). */
export interface ModelsFooterOwnerProps {
  /** Marker field: footer owner props are intentionally empty. */
  children?: never
}

/**
 * Owner share of the header area: the page's provider join and the writes it
 * offers. A registered header takes over the provider list, because it draws
 * every provider row itself and the section's own rows and add controls stop
 * rendering.
 */
export interface ModelsHeaderOwnerProps {
  /** Every configurable or registered provider, with its credential state. */
  rows: readonly ProviderRow[]
  /** The settings namespaces the rows' editors write through, by namespace. */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
  /** Whether the settings documents accept writes. */
  writable: boolean
  /** The Host operations a provider editor writes and interrogates through. */
  operations: ModelsOperations
  /**
   * Remove one user-added provider profile, with the credential this page manages for it, and refresh the join.
   * @param row - the joined row to remove; the section decides which credential, if any, belongs to it.
   * @returns the failure message, or undefined once the removal landed.
   */
  remove(row: ProviderRow): Promise<string | undefined>
  /** Settings-owned schema and immutable path operations. */
  schema: SettingsSchemaOperations
  /** The join's load state, so an editor opened meanwhile can wait for it. */
  status: ModelsSettingsState['status']
  /** Section copy, over the dictionary the page uses. */
  t: (key: keyof typeof en) => string
}
