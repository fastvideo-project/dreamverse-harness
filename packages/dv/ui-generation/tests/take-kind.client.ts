/**
 * The test-only generation kind `test_take` that the kit specs mount: one `defineGenerationUi` declaration that claims
 * `shot.render` and `clip.extend`, plus the canvas registries it registers into and a recording canvas host.
 */
import { vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChildrenDecl } from '@deepseek-ai/dsh-client-ui-slots'
import type { HistoryRow } from '@dv/ui-history/contract'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type { ChainAnchor, ClaimedNodeView, DvCanvas, NodeHost, NodeView, ReferenceFacts } from '../../ui-canvas/src/client/contract/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { buildCanvasGraph } from '../../ui-canvas/src/client/graph.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { defineGenerationUi } from '../src/client/generation-kit.tsx'

declare module '../../ui-canvas/src/client/contract/index.ts' { interface NodeDataMap { test_take: null } }

/** The test kind: takes of `shot.render` and `clip.extend`, whose still output stands for a take, and no references for `t2v`. */
export const testTake = defineGenerationUi({
  id: '@dv/ui-test-take', type: 'test_take', operations: ['shot.render', 'clip.extend'], label: ['测试版本', 'Test take'],
  color: 'var(--dv-kind-take)',
  status: { running: ['生成中…', 'Generating…'], failed: ['没生成', 'Not generated'], done: ['已生成', 'Generated'] },
  references: record => record.params['task'] !== 't2v',
  preview: (record, state) => record.outputs.find(id => state.assets.find(asset => asset.id === id)?.mime === 'image/png'),
})

/** The chain anchor of the fixture's approval `a1`: the records it started hang off `plan:p1`. */
export const APPROVAL: ChainAnchor = { starter: 'plan.approve', anchor: record => `plan:${String(record.params['plan'])}` }

/** The `clip.extend` declaration: no label and no reference input. */
export const CLIP_EXTEND: WireOperation = {
  name: 'clip.extend', version: '1', description: 'Extend a clip.', inputs: {}, params: { prompt: { type: 'string', required: true } },
  outputs: [{ role: 'video', type: 'video' }], deterministic: false, resource: 'gpu', confirm: 'never',
}

/**
 * A slot runtime whose frame declares `children`, with the canvas registries and the History registry that the kit
 * registers into, the real media plugin and the real asset pool plugin (its image, video and audio views), and the test
 * kind mounted as a plugin.
 * @param children - the slots that the test frame declares, as the canvas Factory or DSH's tool tree declares them.
 * @returns the runtime, the kit plugin's handle, the canvas registries and the History rows.
 */
export async function mountKit(children: ChildrenDecl): Promise<{
  runtime: SlotTestRuntime
  kit: FeatureHandle
  canvas: DvCanvas
  rows: ReturnType<typeof createRegistry<HistoryRow>>
}> {
  const runtime = await SlotTestRuntime.create()
  const canvas = createDvCanvas()
  const rows = createRegistry<HistoryRow>(row => [row.match], row => row.match)
  runtime.ctx.provide('dvCanvas', canvas)
  runtime.ctx.provide('dvHistory', { rows })
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.declare(children)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  const kit = await runtime.mount({ inject: [...testTake.inject], apply: testTake.apply })
  return { runtime, kit, canvas, rows }
}

/**
 * The canvas nodes that the real graph builder draws from a state with the registered node types, as their cards and
 * editors receive them.
 * @param canvas - the canvas registries.
 * @param state - the project state.
 * @param operations - the operation declarations.
 * @param language - the interface language.
 * @returns the node of each ID.
 */
export function nodesOf(canvas: DvCanvas, state: WireState, operations: readonly WireOperation[], language: 'zh' | 'en'): Map<string, NodeView> {
  const graph = buildCanvasGraph(state, new Set(), operations, language, {
    nodeTypes: canvas.nodeTypes.getSnapshot(), chainAnchors: canvas.chainAnchors.getSnapshot(),
    recordsInUse: canvas.recordsInUse.getSnapshot(), versionKinds: canvas.versionKinds.getSnapshot(),
  })
  return new Map(graph.nodes.map(node => [node.id, { ...node, unseen: false, rerunning: false }]))
}

/**
 * The claimed nodes that the real graph builder draws, as the editor of their type's claimed nodes receives them.
 * @param canvas - the canvas registries.
 * @param state - the project state.
 * @param operations - the operation declarations.
 * @param language - the interface language.
 * @returns the claimed node of each record ID.
 */
export function claimedOf(canvas: DvCanvas, state: WireState, operations: readonly WireOperation[], language: 'zh' | 'en'): Map<string, ClaimedNodeView> {
  return new Map([...nodesOf(canvas, state, operations, language)].flatMap(([id, node]) => node.claimed ? [[id, node] as const] : []))
}

/**
 * A canvas host whose methods record their calls; `reference` names `hero@1` and `villain@2` as items with nodes and
 * any other text as the asset of that ID in `state`.
 * @param rerun - what `rerun` returns.
 * @param state - the state whose assets `reference` reads.
 * @returns the host.
 */
export function recordingHost(rerun: () => Promise<void> = () => Promise.resolve(), state: WireState = fixtureState()) {
  const assetOf = (id: string) => state.assets.find(asset => asset.id === id) ?? null
  const items: Record<string, ReferenceFacts> = {
    'hero@1': { name: 'Hero', asset: assetOf('ref.png'), node: 'test_ref:hero' },
    'villain@2': { name: 'Villain', asset: null, node: 'test_ref:villain' },
  }
  return {
    run: vi.fn<NodeHost['run']>(),
    rerun: vi.fn<NodeHost['rerun']>(rerun),
    pickAssets: vi.fn<NodeHost['pickAssets']>(),
    preview: vi.fn<NodeHost['preview']>(),
    reference: vi.fn<NodeHost['reference']>(ref => items[ref] ?? { name: ref, asset: assetOf(ref), node: null }),
    openNode: vi.fn<NodeHost['openNode']>(),
    setPlaced: vi.fn<NodeHost['setPlaced']>(),
    close: vi.fn<NodeHost['close']>(),
  }
}
