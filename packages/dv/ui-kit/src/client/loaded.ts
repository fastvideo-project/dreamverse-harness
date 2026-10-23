/**
 * An observable source of a value that loads on its first subscription, for the inject `hooks` compartment of a slot
 * registration.
 *
 * @module @dv/ui-kit/loaded
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * A source that starts empty and loads its value on its first subscription. A failed load keeps the value empty, and
 * the next subscription loads again.
 * @param empty - the value until the load settles.
 * @param load - reads the value.
 * @returns the source.
 */
export function loadedOnce<T>(empty: T, load: () => Promise<T>): HostObservable<T> {
  let value = empty
  let started = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      if (!started) {
        started = true
        load().then((loaded) => {
          value = loaded
          for (const each of [...listeners]) each()
        }, (error: unknown) => {
          // Readers keep the empty value; the next subscription retries the load.
          void error
          started = false
        })
      }
      return () => { listeners.delete(listener) }
    },
  }
}
