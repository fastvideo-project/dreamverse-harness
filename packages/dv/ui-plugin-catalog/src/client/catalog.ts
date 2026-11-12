/**
 * State of the Marketplace page: the catalog that `@dv/plugin-catalog` answers, the profile's bundles that the plugin
 * manager lists, and the install and remove requests in flight with their outcomes. The `pluginManager` Remote is
 * mounted only in a profile that provides the plugin manager; without it the page lists the catalog and offers nothing
 * to install.
 *
 * @module @dv/ui-plugin-catalog/catalog
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo, ChangeResult, PluginInstallRequestId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { CatalogAnswer, CatalogEntry } from '@dv/plugin-catalog/types'

/** The route of `@dv/plugin-catalog` that answers the catalog. */
export const CATALOG_ROUTE = '/api/dv/plugins/catalog'

/** Where a catalog plugin stands in the profile. */
export type PluginState = 'unknown' | 'absent' | 'on' | 'off' | 'error' | 'installing' | 'removing' | 'enabling'

/** What the last request for one plugin ended with. */
export type PluginOutcome =
  | { readonly kind: 'installed' | 'installed-restart' | 'removed' | 'removed-restart' | 'enabled' }
  | { readonly kind: 'scripts'; readonly packages: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string }

/** What the Marketplace page shows. */
export interface CatalogView {
  /** The catalog, null until it is read. */
  readonly catalog: CatalogAnswer | null
  /** Why the catalog could not be read. */
  readonly catalogError: string | null
  /** Whether the plugin manager is reachable, so plugins can be installed. */
  readonly manageable: boolean
  /** The profile's bundles by package name, null until listed. */
  readonly bundles: ReadonlyMap<string, BundleInfo> | null
  /** The requests in flight by package name. */
  readonly busy: ReadonlyMap<string, 'installing' | 'removing' | 'enabling'>
  /** The last outcome by package name. */
  readonly outcomes: ReadonlyMap<string, PluginOutcome>
}

/** The plugin manager calls, bound while its Remote is mounted. */
interface ManagerActions {
  install(spec: string): Promise<ChangeResult>
  remove(pkg: string): Promise<ChangeResult>
  enable(pkg: string): Promise<ChangeResult>
}

let catalog: CatalogAnswer | null = null
let catalogError: string | null = null
let bundles: Map<string, BundleInfo> | null = null
const busy = new Map<string, 'installing' | 'removing' | 'enabling'>()
const outcomes = new Map<string, PluginOutcome>()
let manager: ManagerActions | null = null
let view: CatalogView = { catalog: null, catalogError: null, manageable: false, bundles: null, busy: new Map(), outcomes: new Map() }
const listeners = new Set<() => void>()
let openPanel: (id: MainPanelId) => void = () => {}

function publish(): void {
  view = { catalog, catalogError, manageable: manager !== null, bundles, busy: new Map(busy), outcomes: new Map(outcomes) }
  for (const listener of listeners) listener()
}

function message(failure: unknown): string {
  if (failure instanceof Error) return failure.message
  if (typeof failure === 'object' && failure !== null && 'code' in failure) {
    const { code, diagnostic } = failure as { code: string; diagnostic?: string }
    return diagnostic === undefined ? code : `${code}: ${diagnostic}`
  }
  return String(failure)
}

/**
 * Read the Marketplace page's state.
 * @returns the state; the same object until it changes.
 */
export function useCatalog(): CatalogView {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => view,
  )
}

/**
 * Where one catalog plugin stands; `error` is a listed bundle with a load error, whose layer the profile skipped.
 * @param state - the page's state.
 * @param pkg - the plugin's package name.
 * @returns its state.
 */
export function pluginState(state: CatalogView, pkg: string): PluginState {
  const request = state.busy.get(pkg)
  if (request !== undefined) return request
  if (state.bundles === null) return 'unknown'
  const bundle = state.bundles.get(pkg)
  if (bundle === undefined) return 'absent'
  if (bundle.error !== undefined) return 'error'
  return bundle.enabled ? 'on' : 'off'
}

/**
 * What a plugin manager change ended with.
 * @param change - the change result.
 * @param done - the outcome of an applied change.
 * @param restart - the outcome of a change that takes effect at the next start.
 * @returns the outcome.
 */
export function outcomeOf(change: ChangeResult, done: PluginOutcome['kind'], restart: PluginOutcome['kind']): PluginOutcome {
  if (change.pendingBuilds !== undefined && change.pendingBuilds.length > 0) return { kind: 'scripts', packages: change.pendingBuilds }
  if (change.application === 'applied' || change.application === 'overridden') return { kind: done } as PluginOutcome
  if (change.application === 'restart-required') return { kind: restart } as PluginOutcome
  if (change.application === 'cancelled') return { kind: 'failed', message: 'cancelled' }
  const result = change.packageResult
  const reason = change.error !== undefined ? message(change.error) : result?.kind ?? 'failed'
  return { kind: 'failed', message: result === undefined ? reason : `${reason} (log: ${result.logPath})` }
}

/**
 * Run one plugin manager request for a plugin and record its outcome.
 * @param pkg - the plugin's package name.
 * @param request - what is in flight.
 * @param run - the request.
 * @param done - the outcome of an applied change.
 * @param restart - the outcome of a change that takes effect at the next start.
 */
function track(
  pkg: string, request: 'installing' | 'removing' | 'enabling', run: (actions: ManagerActions) => Promise<ChangeResult>,
  done: PluginOutcome['kind'], restart: PluginOutcome['kind'],
): void {
  const actions = manager
  if (actions === null || busy.has(pkg)) return
  busy.set(pkg, request)
  outcomes.delete(pkg)
  publish()
  run(actions).then((change) => { outcomes.set(pkg, outcomeOf(change, done, restart)) }, (failure: unknown) => {
    outcomes.set(pkg, { kind: 'failed', message: message(failure) })
  }).finally(() => { busy.delete(pkg); publish() })
}

/**
 * Install a catalog plugin at the version its entry names and switch its bundle on.
 * @param entry - the plugin's catalog entry.
 */
export function installPlugin(entry: Pick<CatalogEntry, 'package' | 'version'>): void {
  track(entry.package, 'installing', actions => actions.install(`${entry.package}@${entry.version}`), 'installed', 'installed-restart')
}

/**
 * Remove an installed catalog plugin.
 * @param pkg - the plugin's package name.
 */
export function removePlugin(pkg: string): void {
  track(pkg, 'removing', actions => actions.remove(pkg), 'removed', 'removed-restart')
}

/**
 * Switch an installed catalog plugin's bundle on.
 * @param pkg - the plugin's package name.
 */
export function enablePlugin(pkg: string): void {
  track(pkg, 'enabling', actions => actions.enable(pkg), 'enabled', 'installed-restart')
}

/** Open DSH's Plugins page, which approves package scripts and lists every bundle. */
export function openPluginsPage(): void {
  openPanel('plugins' as MainPanelId)
}

/**
 * Read the catalog.
 * @param signal - stops the request when the plugin unloads.
 */
async function readCatalog(signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(CATALOG_ROUTE, { signal })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    catalog = await response.json() as CatalogAnswer
    catalogError = null
  } catch (failure) {
    if (signal.aborted) return
    catalogError = message(failure)
  }
  publish()
}

/**
 * Read the catalog, wire the Plugins page link, and follow the profile's bundles while the plugin manager is mounted.
 * @param ctx - the plugin's client context.
 */
export function followCatalog(ctx: Context): void {
  ctx.effect(() => {
    const stop = new AbortController()
    void readCatalog(stop.signal)
    return () => {
      stop.abort()
      catalog = null
      catalogError = null
      outcomes.clear()
      publish()
    }
  }, 'ui-plugin-catalog: catalog')
  ctx.inject(['layout'], (scope) => {
    openPanel = (id) => { scope.layout.selectPanel(id) }
    scope.effect(() => () => { openPanel = () => {} }, 'ui-plugin-catalog: Plugins page link')
  })
  ctx.inject(['remote', 'remote.pluginManager'], (scope) => {
    const unwrap = async <T>(call: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>): Promise<T> => {
      const result = await call
      if (!result.ok) throw result.error
      return result.value
    }
    const refresh = (): void => {
      unwrap(scope.remote.pluginManager.listBundles()).then((list) => {
        bundles = new Map(list.map(bundle => [bundle.name, bundle]))
        publish()
      }, (failure: unknown) => { console.warn('ui-plugin-catalog: could not list the bundles', failure) })
    }
    scope.effect(() => {
      manager = {
        install: spec => unwrap(scope.remote.pluginManager.installBundle(spec, {
          enabled: true, requestId: randomUUID() as PluginInstallRequestId,
        })),
        remove: pkg => unwrap(scope.remote.pluginManager.removeBundle(pkg)),
        enable: pkg => unwrap(scope.remote.pluginManager.setBundleEnabled(pkg, true)),
      }
      publish()
      refresh()
      return () => {
        manager = null
        bundles = null
        busy.clear()
        publish()
      }
    }, 'ui-plugin-catalog: plugin manager')
    scope.effect(() => scope.remote.$on('plugin-manager/changed', refresh), 'ui-plugin-catalog: bundle changes')
  })
}
