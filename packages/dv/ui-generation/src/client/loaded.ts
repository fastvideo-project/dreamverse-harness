/**
 * The operation declarations and task labels as observable sources that load on the first subscription, for the inject
 * `hooks` of the kit's chat card and take editor; a failed load keeps a source empty, so every reader falls back to
 * names until the next subscription loads again.
 *
 * @module @dv/ui-generation/loaded
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { loadedOnce } from '@dv/ui-kit/loaded.ts'
import { followChatAssets, NO_CHAT_ASSETS, type ChatAssets } from '@dv/ui-composer/chat-assets'
import type { WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import type { WireOperation } from '@dv/ui-kit/types.ts'

/** The label sources that the kit injects: the operation declarations and the task labels, empty until loaded. */
export interface GenerationInjected {
  hooks: {
    operations: HostObservable<readonly WireOperation[]>
    taskLabels: HostObservable<WireTaskLabels>
    /** Durable records and outputs of the open project, followed independently of tool results. */
    chatAssets: HostObservable<ChatAssets>
  }
}

/**
 * @param client - the API client of the registering plugin.
 * @returns the label sources.
 */
export function labelSources(client: DvClient): GenerationInjected {
  let value = NO_CHAT_ASSETS
  let stop: (() => void) | undefined
  const listeners = new Set<() => void>()
  const chatAssets: HostObservable<ChatAssets> = {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      if (stop === undefined) stop = followChatAssets(client, (next) => {
        value = next
        for (const each of listeners) each()
      })
      return () => {
        listeners.delete(listener)
        if (listeners.size !== 0) return
        stop?.(); stop = undefined; value = NO_CHAT_ASSETS
      }
    },
  }
  return {
    hooks: {
      operations: loadedOnce<readonly WireOperation[]>([], () => client.listOperations()),
      taskLabels: loadedOnce<WireTaskLabels>({}, () => client.getTaskLabels()),
      chatAssets,
    },
  }
}
