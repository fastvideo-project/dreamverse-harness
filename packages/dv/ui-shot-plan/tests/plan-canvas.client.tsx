/**
 * A slot test runtime with the shot plan plugin, the media plugins and the composer stack mounted beside a `dvCanvas`
 * from `createDvCanvas()`, and a root frame that declares `dv.canvas.card` and `dv.canvas.editor` and renders the entries
 * keyed by a node's type for one canvas node, as the canvas does for a selected node.
 */
import { expect, vi } from 'vitest'
import { waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import type { DvCanvas, EditorHost, NodeView } from '@dv/ui-canvas/contract'
import { createDvCanvas } from '@dv/ui-canvas/src/client/dv-canvas.ts'
import { buildCanvasGraph } from '@dv/ui-canvas/src/client/graph.ts'
import type { CanvasNode } from '@dv/ui-canvas/src/client/graph.ts'
import { apply as mediaApply, inject as mediaInject } from '@dv/ui-media/src/client/index.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { composerStack } from '../../ui-composer/tests/composer-stack.client.ts'
import { OPERATIONS, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, inject } from '../src/client/index.ts'

/** The canvas's preview and navigation, which a shot's tiles and chips call. */
export const hostPreview = vi.fn<EditorHost['preview']>()
export const hostOpenNode = vi.fn<EditorHost['openNode']>()

/** The canvas's writes, picker, preview and navigation; the plan card and editor call only the preview and navigation. */
export const HOST: EditorHost = {
  run: vi.fn(), rerun: vi.fn(() => Promise.resolve()), pickAssets: vi.fn(), preview: hostPreview, openNode: hostOpenNode,
  importFiles: vi.fn(() => Promise.resolve([])),
  setPlaced: vi.fn(), close: vi.fn(),
}

/**
 * The canvas nodes of a state under the registrations of a `dvCanvas`, as the canvas builds them.
 * @param canvas - the registries.
 * @param state - the project state.
 * @returns the nodes.
 */
export function canvasNodes(canvas: DvCanvas, state: WireState): CanvasNode[] {
  return buildCanvasGraph(state, new Set(), OPERATIONS, 'zh', {
    nodeTypes: canvas.nodeTypes.getSnapshot(), chainAnchors: canvas.chainAnchors.getSnapshot(),
    recordsInUse: canvas.recordsInUse.getSnapshot(), versionKinds: canvas.versionKinds.getSnapshot(),
  }).nodes
}

/** A mounted plan canvas: the runtime, the registries, the shot plan plugin, and the card and editor frames. */
export interface PlanCanvas {
  runtime: SlotTestRuntime
  canvas: DvCanvas
  plugin: FeatureHandle
  card: HTMLElement
  editor: HTMLElement
}

/**
 * Mount the media plugin, the asset pool (whose `dv.media.view` entries draw images, videos and audio), the composer
 * stack (whose read-only `dv.prompt` draws each shot's prompt) and the shot plan plugin, then render the card and the
 * editor of the canvas node `plan:p1` of `state`, with `GET /api/dv` routes served from `state`.
 * @param state - the project state.
 * @param options - the registries to provide (default empty ones) and the node ID to render under (default the node's own).
 * @returns the mounted canvas.
 */
export async function mountPlanCanvas(state: WireState, options: { canvas?: DvCanvas; nodeId?: string } = {}): Promise<PlanCanvas> {
  vi.stubGlobal('fetch', scriptedFetch({ state }).fetch)
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const canvas = options.canvas ?? createDvCanvas()
  runtime.ctx.provide('dvCanvas', canvas)
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount(composerStack)
  const plugin = await runtime.mount({ inject: [...inject], apply })
  const built = canvasNodes(canvas, state).find(node => node.id === 'plan:p1')
  if (built === undefined) throw new Error('the state has no plan p1')
  const node = { ...built, id: options.nodeId ?? built.id, unseen: false, rerunning: false } as NodeView
  const Frame = ({ renderSlot }: PropsRenderSlots<'dv.canvas.card' | 'dv.canvas.editor'>): ReactNode => (
    <>
      <section data-testid="card">{renderSlot('dv.canvas.card', { node, assets: {}, textScale: 1, host: HOST }, { entryKey: node.type })}</section>
      <section data-testid="editor">{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host: HOST }, { entryKey: node.type })}</section>
    </>
  )
  await runtime.root.declare({ 'dv.canvas.card': { kind: 'keyed', scope: 'root' }, 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } }, Frame)
  const { container } = runtime.renderRoot()
  await waitFor(() => { expect(planEntries(runtime)).toEqual({ card: 1, editor: 1 }) })
  return { runtime, canvas, plugin, card: within(container).getByTestId('card'), editor: within(container).getByTestId('editor') }
}

/**
 * @param runtime - the runtime.
 * @returns the number of `dv.canvas.card` and `dv.canvas.editor` entries keyed `plan` on the slot ledger.
 */
export function planEntries(runtime: SlotTestRuntime): { card: number; editor: number } {
  const count = (name: 'dv.canvas.card' | 'dv.canvas.editor'): number =>
    runtime.slots.entries(name).filter(entry => entry.options.key === 'plan').length
  return { card: count('dv.canvas.card'), editor: count('dv.canvas.editor') }
}
