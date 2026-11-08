/**
 * The `dvCanvas` service that the canvas provides: its four registries.
 *
 * @module @dv/ui-canvas/dv-canvas
 */
import { createRegistry, type VersionKind } from '@dv/ui-kit/registries.ts'
import type { DvCanvas, NodeAction, NodeType, RecordsInUse } from './contract/index.ts'

/**
 * Create empty canvas registries.
 * @returns the registries, each keyed as `DvCanvas` documents; a refused key names the package that holds it.
 */
export function createDvCanvas(): DvCanvas {
  return {
    nodeTypes: createRegistry<NodeType>(type => [type.type], type => type.id),
    recordsInUse: createRegistry<RecordsInUse>(uses => [uses.id], uses => uses.id),
    versionKinds: createRegistry<VersionKind>(kind => [kind.kind], kind => `the version kind ${kind.kind}`),
    actions: createRegistry<NodeAction>(action => [action.id], action => action.id.replace(/:.*/su, '')),
  }
}
