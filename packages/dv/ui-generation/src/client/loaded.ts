/**
 * The operation declarations and task labels as observable sources that load once, on the first subscription, for the
 * inject `hooks` of the kit's chat card and take editor; a failed load keeps a source empty, so every reader falls back
 * to names.
 *
 * @module @dv/ui-generation/loaded
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { loadedOnce } from '@dv/ui-kit/loaded.ts'
import type { WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import type { WireOperation } from '@dv/ui-kit/types.ts'

/** The label sources that the kit injects: the operation declarations and the task labels, empty until loaded. */
export interface GenerationInjected {
  hooks: {
    operations: HostObservable<readonly WireOperation[]>
    taskLabels: HostObservable<WireTaskLabels>
  }
}

/**
 * @param client - the API client of the registering plugin.
 * @returns the label sources.
 */
export function labelSources(client: DvClient): GenerationInjected {
  return {
    hooks: {
      operations: loadedOnce<readonly WireOperation[]>([], () => client.listOperations()),
      taskLabels: loadedOnce<WireTaskLabels>({}, () => client.getTaskLabels()),
    },
  }
}
