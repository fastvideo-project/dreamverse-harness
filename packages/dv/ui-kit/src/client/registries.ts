/**
 * The descriptor registry that plugin UI halves register into, the version kinds that the canvas, the composer and the
 * plan editor read, the `@` menu registry, and the plugin type that the UI kits return. Each registry is a client service
 * that the UI-core package which reads it provides at its `apply` top level: `@dv/ui-composer` provides `dvMentions`.
 * The canvas registries are declared in `@dv/ui-canvas/contract` and the History rows in `@dv/ui-history/contract`. A UI
 * half registers inside `ctx.inject([<service>], …)` and keeps its disposers.
 *
 * @module @dv/ui-kit/registries
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WireState } from './types.ts'

/**
 * A list of descriptors that plugins add and remove, with one owner per key. `getSnapshot` and `subscribe` make the
 * registry a bare observable source, so a slot registration can hand it to its component through the inject `hooks`
 * compartment.
 */
export interface Registry<D> {
  /** Throws on a key that another descriptor already holds, naming that descriptor's owner. */
  register(descriptor: D): () => void
  /** The same array until a change. */
  getSnapshot(): readonly D[]
  subscribe(listener: () => void): () => void
}

/**
 * Create an empty registry.
 * @param keys - the keys a descriptor holds; two descriptors never share one.
 * @param owner - the name of the descriptor's owner, such as its package, for the message of a refused key.
 * @returns the registry.
 */
export function createRegistry<D>(keys: (descriptor: D) => readonly string[], owner: (descriptor: D) => string): Registry<D> {
  let items: readonly D[] = []
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of [...listeners]) listener() }
  return {
    register(descriptor) {
      for (const key of keys(descriptor)) {
        const holder = items.find(item => keys(item).includes(key))
        if (holder !== undefined) throw new Error(`registry key "${key}" is already registered by ${owner(holder)}`)
      }
      items = [...items, descriptor]
      notify()
      return () => {
        if (!items.includes(descriptor)) return
        items = items.filter(item => item !== descriptor)
        notify()
      }
    },
    getSnapshot: () => items,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * What Cordis loads from a UI plugin that a kit defines; the plugin file writes
 * `export const { inject, apply } = define…Ui({ … })`, so it exports only `inject` and `apply`.
 */
export interface UiPlugin {
  readonly inject: readonly string[]
  readonly apply: (ctx: Context) => void
}

/** How the canvas, the composer and the plan editor read the versions of one reference kind of the kernel. */
export interface VersionKind {
  /** A reference kind of the kernel, such as 'character'. */
  kind: string
  /** The section title of the kind's items in the asset picker, such as 角色. */
  label(): string
  /** The canvas node ID of an item, such as 'character:c1'. */
  node(id: string): string
  /** Every item at its newest version. */
  latest(state: WireState): Array<{ id: string; version: number }>
  name(state: WireState, id: string, version: number): string | null
  /** The reference assets of the version, in order. */
  assets(state: WireState, id: string, version: number): string[]
}

/** The registry of the `@` menu, which `@dv/ui-composer` provides as `ctx.dvMentions`; `kinds` is keyed by `id`. */
export interface DvMentions { kinds: Registry<MentionKind> }
/** One kind of project item that the `@` menu lists, read from its plugin's own slice. */
export interface MentionKind {
  id: string
  /** The kind of the inserted address `dv:<kind>/<id>`. */
  kind: string
  /** Section order in the `@` menu; the core lists assets last. */
  order: number
  section(): string
  /** The items of a state; `thumb` is the asset whose image, or a video's first frame, the menu shows as the icon. */
  items(state: WireState): Array<{ uri: string; label: string; description?: string; thumb?: string }>
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    dvMentions: DvMentions
  }
}
