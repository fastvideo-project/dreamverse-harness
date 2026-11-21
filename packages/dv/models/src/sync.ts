/**
 * Helpers that provider plugins share to register model entries from validated configuration: the model alias rule, a
 * registry that keeps registered entries equal to a desired list of groups, and two wirings of that registry to the
 * Loader's `loader/volatile-update` event. {@link syncModelEntries} serves a provider that resolves its models from
 * configuration alone and registers them during `apply`. {@link syncModelEntriesAsync} serves a provider that reads a
 * remote catalog to resolve its models, so a sync is asynchronous, can overlap with a newer one, and can fail.
 *
 * Every registration is an effect of the calling plugin: the helpers dispose all of their entries when the plugin
 * unloads.
 *
 * @module @dv/models
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { ModelEntry } from './types.ts'

/** The aliases that provider plugins accept: 1 to 120 lowercase letters, digits and hyphens that start with a letter or digit. */
export const MODEL_ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/

/**
 * Refuse a model alias that does not match {@link MODEL_ALIAS_PATTERN}.
 * @param alias - the alias, usually a key of the provider's `models` configuration.
 * @param message - the text of the error, which names the provider so the user can find the setting.
 * @throws Error with `message` when `alias` breaks the rule.
 */
export function assertModelAlias(alias: string, message: string): void {
  if (!MODEL_ALIAS_PATTERN.test(alias)) throw new Error(message)
}

/** The entries of one configured model, registered and disposed together. */
export interface ModelGroup {
  /** The identity of the group within one registry, such as an alias. Unique among the groups of a registry. */
  id: string
  /** Compared as a string with the stamp of the registered group; an equal stamp keeps the registered entries. */
  stamp: string
  /** Builds the entries, called only when the group is new or its stamp changed. Entry keys must be unique across groups. */
  entries: () => readonly ModelEntry[]
}

/** A set of registered model entries that follows a desired list of groups. */
export interface ModelEntryRegistry {
  /**
   * Make the registered groups equal to `groups`: dispose the groups that are absent or whose stamp changed, and
   * register the new and changed ones. Nothing changes when an entry would replace one that another plugin owns.
   * @param groups - the desired groups.
   * @throws Error with the registry's conflict message when another plugin registered the key of a new entry.
   */
  replace: (groups: readonly ModelGroup[]) => void
  /** Dispose every registered entry. */
  clear: () => void
}

/**
 * Create a registry over the model catalog.
 * @param models - the `dvModels` service.
 * @param conflict - the error text when another plugin already registered the key of a new entry.
 * @returns the registry; it holds no effect, so the caller disposes it with `clear`.
 */
export function createModelEntryRegistry(models: Pick<Context['dvModels'], 'get' | 'register'>, conflict: string): ModelEntryRegistry {
  const groups = new Map<string, { stamp: string; entries: readonly ModelEntry[]; remove: Array<() => void> }>()
  const dispose = (id: string): void => {
    for (const remove of groups.get(id)?.remove ?? []) remove()
    groups.delete(id)
  }
  const owned = (): Set<ModelEntry> => new Set([...groups.values()].flatMap(group => group.entries))
  return {
    replace: (desired) => {
      const wanted = new Map(desired.map(group => [group.id, group]))
      const added = [...wanted.values()].filter(group => groups.get(group.id)?.stamp !== group.stamp)
        .map(group => ({ group, entries: group.entries() }))
      const mine = owned()
      for (const { entries } of added) {
        for (const entry of entries) {
          const existing = models.get(entry)
          if (existing !== undefined && !mine.has(existing)) throw new Error(conflict)
        }
      }
      for (const id of [...groups.keys()]) {
        if (!wanted.has(id)) dispose(id)
      }
      for (const { group, entries } of added) {
        dispose(group.id)
        groups.set(group.id, { stamp: group.stamp, entries, remove: entries.map(entry => models.register(entry)) })
      }
    },
    clear: () => {
      for (const id of [...groups.keys()]) dispose(id)
    },
  }
}

/** Options of {@link syncModelEntries}. */
export interface ModelSyncOptions {
  /** The effect label, which names the registrations in the Loader's diagnostics. */
  label: string
  /** The error text when another plugin already registered the key of a new entry. */
  conflict: string
  /** The desired groups from the current configuration. Throws to refuse the configuration; the registered entries stay. */
  groups: () => readonly ModelGroup[]
}

/**
 * Register the groups that `options.groups` returns now and again after every `loader/volatile-update`. A throw from
 * `options.groups` or a conflict leaves the registered entries unchanged: the first call fails the plugin's load, and a
 * later call rejects in the event emitter.
 * @param ctx - the plugin context; the plugin injects `dvModels`.
 * @param options - the label, conflict text and group source.
 * @returns a function that runs one sync now.
 */
export function syncModelEntries(ctx: Context, options: ModelSyncOptions): () => void {
  const registry = createModelEntryRegistry(ctx.dvModels, options.conflict)
  ctx.effect(() => () => { registry.clear() }, options.label)
  const sync = (): void => { registry.replace(options.groups()) }
  ctx.on('loader/volatile-update', sync)
  sync()
  return sync
}

/** The groups one asynchronous sync resolved. */
export interface ModelSyncResult {
  /** The desired groups. */
  groups: readonly ModelGroup[]
  /**
   * One sentence for each configured model that its source does not offer. The groups still register, and the next
   * sync starts again instead of waiting for a configuration change.
   */
  unavailable: readonly string[]
}

/** What a current asynchronous sync reports to {@link ModelSyncAsyncOptions.settled}. */
export type ModelSyncOutcome = { ok: true; unavailable: readonly string[] } | { ok: false; error: unknown }

/** Options of {@link syncModelEntriesAsync}. */
export interface ModelSyncAsyncOptions {
  /** The effect label, which names the registrations in the Loader's diagnostics. */
  label: string
  /** The error text when another plugin already registered the key of a new entry. */
  conflict: string
  /** A string of the configuration that decides the groups; a sync is skipped while it equals the last complete sync's. */
  stamp: () => string
  /** Resolve the desired groups; may reject. The signal aborts when the plugin unloads. */
  resolve: (signal: AbortSignal) => Promise<ModelSyncResult>
  /** Called after a sync that no newer sync and no unload superseded. A failure has already disposed every entry. */
  settled?: (outcome: ModelSyncOutcome) => void
}

/** The handle that {@link syncModelEntriesAsync} returns. */
export interface ModelSyncHandle {
  /** Run one sync. Rejects with the failure of `resolve`, of the conflict check, or of a registration. */
  sync: () => Promise<void>
}

/**
 * Register the groups that `options.resolve` returns, and again after every `loader/volatile-update`. A newer sync
 * supersedes an older one that is still resolving, and unloading aborts the signal, waits for running syncs and
 * disposes every entry. A failed current sync disposes every entry, so a refused configuration does not keep serving
 * old models. A volatile update never rejects: the failure reaches `settled`, and the next sync retries.
 * @param ctx - the plugin context; the plugin injects `dvModels`.
 * @param options - the label, conflict text, stamp, resolver and settle hook.
 * @returns the handle for syncs outside the event, such as a discovery route or the first sync during `apply`.
 */
export function syncModelEntriesAsync(ctx: Context, options: ModelSyncAsyncOptions): ModelSyncHandle {
  const registry = createModelEntryRegistry(ctx.dvModels, options.conflict)
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  let disposed = false
  let revision = 0
  let current = ''
  const run = async (): Promise<void> => {
    const stamp = options.stamp()
    if (current === stamp) return
    const version = ++revision
    const superseded = (): boolean => disposed || version !== revision
    try {
      const { groups, unavailable } = await options.resolve(lifetime.signal)
      if (superseded()) return
      registry.replace(groups)
      // An unavailable model leaves `current` unset so that the next sync registers it once its source offers it.
      current = unavailable.length === 0 ? stamp : ''
      options.settled?.({ ok: true, unavailable })
    } catch (error) {
      if (!superseded()) {
        registry.clear()
        current = ''
        options.settled?.({ ok: false, error })
      }
      throw error
    }
  }
  const sync = (): Promise<void> => {
    const work = run()
    const tracked = work.catch(() => undefined)
    pending.add(tracked)
    void tracked.finally(() => { pending.delete(tracked) })
    return work
  }
  ctx.effect(() => async () => {
    disposed = true
    revision++
    lifetime.abort()
    await Promise.allSettled([...pending])
    registry.clear()
  }, options.label)
  ctx.on('loader/volatile-update', () => { sync().catch(() => undefined) })
  return { sync }
}
