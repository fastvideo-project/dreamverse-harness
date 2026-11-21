/** The LLM providers that can serve a request now, published by the Models page header for the model table below it. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Observable provider ids; `null` until the Models page has joined its provider rows. */
export interface LlmReadiness extends HostObservable<ReadonlySet<string> | null> {
  /**
   * Publish the provider ids that can serve a request.
   * @param providers - the usable provider ids.
   */
  set(providers: ReadonlySet<string>): void
}

/**
 * Create the shared readiness holder.
 * @returns an observable that starts at `null`.
 */
export function createLlmReadiness(): LlmReadiness {
  let current: ReadonlySet<string> | null = null
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(providers) {
      current = providers
      for (const listener of [...listeners]) listener()
    },
  }
}
