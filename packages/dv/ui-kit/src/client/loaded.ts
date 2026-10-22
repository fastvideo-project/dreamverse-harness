/**
 * An observable source of a value that loads once, on its first subscription, for the inject `hooks` compartment of a
 * slot registration.
 *
 * @module @dv/ui-kit/loaded
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * A source that starts empty and loads its value on its first subscription; a failed load keeps it empty, so every
 * reader falls back to names.
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
          // An unreachable route leaves the names in place of the labels.
          void error
        })
      }
      return () => { listeners.delete(listener) }
    },
  }
}
