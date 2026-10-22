/**
 * The `dv.canvas` Component Factory: the canvas of one project, which the workspace center's 画布 view and the
 * right-Sidebar tab body each render as an occurrence. The definition declares the canvas's child slots once, so both
 * occurrences draw the same `dv.canvas.card`, `dv.canvas.editor`, `dv.canvas.editor.claimed` and `dv.canvas.picker`
 * entries. The registries reach the definition through the inject `hooks` compartment.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { FactoryComponentPropsOf, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { DvClient } from '@dv/ui-kit/api.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { ChainAnchor, NodeAction, NodeType, RecordsInUse } from './contract/index.ts'
import { CanvasView } from './CanvasView.tsx'
import type { CanvasFocus } from './CanvasView.tsx'
import type {} from './locales.ts'

/** What the canvas plugin injects into the Factory definition. */
export interface CanvasFactoryInjected {
  client: DvClient
  /** Open the asset preview of `dvMedia` for an asset of a project; nothing opens while no media plugin is loaded. */
  preview(projectId: string, asset: Asset, opener: Element | null): void
  hooks: {
    nodeTypes: HostObservable<readonly NodeType[]>
    chainAnchors: HostObservable<readonly ChainAnchor[]>
    recordsInUse: HostObservable<readonly RecordsInUse[]>
    versionKinds: HostObservable<readonly VersionKind[]>
    actions: HostObservable<readonly NodeAction[]>
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** The canvas of one project; the center view and the right-Sidebar tab body render occurrences. */
    'dv.canvas': {
      scope: 'root'
      props: { projectId: string; session: string | null; focus: CanvasFocus | null }
      children: {
        'dv.canvas.card': { kind: 'keyed'; scope: 'root' }
        'dv.canvas.editor': { kind: 'keyed'; scope: 'root' }
        'dv.canvas.editor.claimed': { kind: 'keyed'; scope: 'root' }
        'dv.canvas.picker': { kind: 'keyed'; scope: 'root' }
      }
      inject: CanvasFactoryInjected
      locale: 'dvCanvas'
    }
  }
}

/**
 * The definition: the registered descriptors, read through the inject hooks, handed to the canvas.
 * @param props - the occurrence's project, chat session and focus, the injected client, preview and hooks, the copy,
 *   and the slot and Factory renderers.
 * @returns the canvas.
 */
export function CanvasFactory(props: FactoryComponentPropsOf<'dv.canvas'>): ReactNode {
  const nodeTypes = props.useNodeTypes(value => value)
  const chainAnchors = props.useChainAnchors(value => value)
  const recordsInUse = props.useRecordsInUse(value => value)
  const versionKinds = props.useVersionKinds(value => value)
  const actions = props.useActions(value => value)
  const descriptors = useMemo(
    () => ({ nodeTypes, chainAnchors, recordsInUse, versionKinds, actions }),
    [nodeTypes, chainAnchors, recordsInUse, versionKinds, actions],
  )
  return (
    <CanvasView
      projectId={props.projectId} session={props.session} client={props.client} t={props.t} descriptors={descriptors}
      renderSlot={props.renderSlot} renderFactorySlot={props.renderFactorySlot} preview={props.preview} focus={props.focus}
    />
  )
}
