/**
 * The test-only generation kind `test_take` that the kit specs mount, with the slot runtime and canvas helpers that
 * those specs share.
 */
import { vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChildrenDecl } from '@deepseek-ai/dsh-client-ui-slots'
import type { HistoryRow } from '@dv/ui-history/contract'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type { ClaimedNodeView, DvCanvas, EditorHost, NodeView } from '../../ui-canvas/src/client/contract/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { buildCanvasGraph } from '../../ui-canvas/src/client/graph.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { composerStack } from '../../ui-composer/tests/composer-stack.client.ts'
import { defineGenerationUi } from '../src/client/generation-kit.tsx'

/** The test generation kind, whose still output stands for a take. */
export const testTake = defineGenerationUi({
  id: '@dv/ui-test-take', type: 'test_take', operations: ['shot.render', 'clip.extend'], label: ['测试版本', 'Test take'],
  color: 'var(--dv-node-3)',
  status: { running: ['生成中…', 'Generating…'], failed: ['没生成', 'Not generated'], done: ['已生成', 'Generated'] },
  preview: outputs => outputs.find(output => output.mime === 'image/png')?.id,
})

/** The `clip.extend` declaration: no label and no reference input. */
export const CLIP_EXTEND: WireOperation = {
  name: 'clip.extend', version: '1', description: 'Extend a clip.', inputs: {}, params: { prompt: { type: 'string', required: true } },
  outputs: [{ role: 'video', type: 'video' }], deterministic: false, resource: 'gpu', confirm: 'never',
}

/**
 * A slot runtime whose frame declares `children`, with the canvas and History registries that the kit registers into,
 * the real media and asset pool plugins, and the test kind mounted as a plugin.
 * @param children - the slots that the test frame declares, as the canvas Factory or DSH's tool tree declares them.
 * @param kind - the kind that the kit defines; the test kind by default.
 * @returns the runtime, the kit plugin's handle, the canvas registries and the History rows.
 */
export async function mountKit(children: ChildrenDecl, kind: typeof testTake = testTake): Promise<{
  runtime: SlotTestRuntime
  kit: FeatureHandle
  canvas: DvCanvas
  rows: ReturnType<typeof createRegistry<HistoryRow>>
}> {
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const canvas = createDvCanvas()
  const rows = createRegistry<HistoryRow>(row => [row.match], row => row.match)
  runtime.ctx.provide('dvCanvas', canvas)
  runtime.ctx.provide('dvHistory', { rows })
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.declare(children)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount(composerStack)
  const kit = await runtime.mount({ inject: [...kind.inject], apply: kind.apply })
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
    nodeTypes: canvas.nodeTypes.getSnapshot(),
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
 * A canvas host whose methods record their calls.
 * @param rerun - what `rerun` returns.
 * @returns the host.
 */
export function recordingHost(rerun: () => Promise<void> = () => Promise.resolve()) {
  return {
    run: vi.fn<EditorHost['run']>(),
    rerun: vi.fn<EditorHost['rerun']>(rerun),
    pickAssets: vi.fn<EditorHost['pickAssets']>(),
    preview: vi.fn<EditorHost['preview']>(),
    importFiles: vi.fn<EditorHost['importFiles']>(files => Promise.resolve(files.map(file => file.name))),
    openNode: vi.fn<EditorHost['openNode']>(),
    setPlaced: vi.fn<EditorHost['setPlaced']>(),
    close: vi.fn<EditorHost['close']>(),
  }
}
