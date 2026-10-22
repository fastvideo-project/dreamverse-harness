/**
 * The asset pool as the DreamVerse bundle loads it: the real `@dv/ui-media` and asset pool plugins in a slot test
 * runtime that provides `dvCanvas` and the right-Sidebar tab registry, under a root frame that declares the slots the
 * asset pool fills and draws what a test asks for.
 */
import type { ReactNode } from 'react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { WireState } from '@dv/ui-kit/types.ts'
import type { EditorHost, NodeView } from '../../ui-canvas/src/client/contract/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { buildCanvasGraph } from '../../ui-canvas/src/client/graph.ts'
import { OPERATIONS } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'

const SLOTS = {
  'dv.canvas.card': { kind: 'keyed', scope: 'root' },
  'dv.canvas.editor': { kind: 'keyed', scope: 'root' },
  'dv.canvas.picker': { kind: 'keyed', scope: 'root' },
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  'shell.overlay': { kind: 'list', scope: 'root' },
} as const

/** What the root frame hands a test's drawing. */
export type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

/** The mounted runtime and the asset pool plugin's handle. */
export interface MountedAssetPool {
  runtime: SlotTestRuntime
  assetPool: FeatureHandle
}

const runtimes: SlotTestRuntime[] = []

/**
 * Mount the media plugin and the asset pool plugin under a frame that draws `draw` above the `shell.overlay` list. The
 * test renders the root itself with `runtime.renderRoot()`, so `draw` can read what it computed from the mounted
 * registries.
 * @param draw - what the frame draws.
 * @returns the runtime and the asset pool plugin's handle.
 */
export async function mountAssetPool(draw: (props: FrameProps) => ReactNode): Promise<MountedAssetPool> {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  runtime.ctx.provide('dvCanvas', createDvCanvas())
  await runtime.root.declare(SLOTS, props => <>{draw(props)}{props.renderSlot('shell.overlay', {})}</>)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  const assetPool = await runtime.mount({ inject: [...inject], apply })
  return { runtime, assetPool }
}

/** Dispose every runtime that {@link mountAssetPool} created. */
export async function disposeRuntimes(): Promise<void> {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
}

/**
 * The nodes that the canvas draws for a state from the node types registered in the runtime's `dvCanvas`, as the canvas
 * hands them to a card, an editor and an action.
 * @param runtime - a runtime from {@link mountAssetPool}.
 * @param state - the project state.
 * @param placed - the assets on the project's canvas list.
 * @returns the nodes.
 */
export function canvasNodes(runtime: SlotTestRuntime, state: WireState, placed: readonly string[]): NodeView[] {
  const canvas = runtime.ctx.dvCanvas
  const graph = buildCanvasGraph(state, new Set(placed), OPERATIONS, 'zh', {
    nodeTypes: canvas.nodeTypes.getSnapshot(), chainAnchors: canvas.chainAnchors.getSnapshot(),
    recordsInUse: canvas.recordsInUse.getSnapshot(), versionKinds: canvas.versionKinds.getSnapshot(),
  })
  return graph.nodes.map(node => ({ ...node, unseen: false, rerunning: false }))
}

/**
 * An editor host that records each call as one line, such as `setPlaced poster.png false`.
 * @param calls - the list the host appends to.
 * @returns the host.
 */
export function recordingHost(calls: string[]): EditorHost {
  const log = (...parts: unknown[]): void => { calls.push(parts.map(String).join(' ')) }
  return {
    run: (request) => { log('run', request.operation) },
    rerun: (request) => { log('rerun', request.operation); return Promise.resolve() },
    pickAssets: (chosen) => { log('pickAssets', ...chosen) },
    preview: (asset) => { log('preview', asset) },
    openNode: (nodeId) => { log('openNode', nodeId) },
    setPlaced: (asset, on) => { log('setPlaced', asset, on) },
    close: () => { log('close') },
  }
}
