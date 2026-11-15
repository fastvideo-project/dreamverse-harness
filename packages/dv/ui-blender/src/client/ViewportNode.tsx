/**
 * The Blender viewport node of the canvas: the node of kind {@link VIEWPORT_TYPE} that a `blender.viewport` record puts
 * in the canvas's node list. Its card shows the live viewport and takes no pointer input, so the canvas moves, selects,
 * resizes and opens the node as any other. Its editor, open after a double click, shows the viewport large with the
 * viewport controls that the Blender tab shows too (see `controls.tsx`); the canvas's own remove button and the Delete
 * key take the node off the canvas.
 *
 * @module @fastvideo/dreamverse-ui-blender/ViewportNode
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NodeSizing, NodeType, TypeEntry } from '@dv/ui-canvas/contract'
import { pickText, useText } from '@dv/ui-kit/locale.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { LivePicture, ViewportControls } from './controls.tsx'
import { useLiveView, type FrameDrawer } from './live-view.ts'
import type { BlenderSource } from './viewer.ts'

/** The node kind of the viewport node: its node type, card and editor key, as the bridge registers it with the canvas. */
export const VIEWPORT_TYPE = 'blender-viewport'

/** A media node at 16:9, the default aspect of Blender's viewport; a picture of another aspect is letterboxed. */
export const VIEWPORT_SIZING: NodeSizing = {
  kind: 'media', defaultSize: { width: 320, height: 180 }, minSize: { width: 160, height: 90 }, aspectRatio: { ratio: 16 / 9, fixedHeight: 0 },
}

/**
 * The viewport node of the canvas, when the viewport is on it.
 * @param state - the project state.
 * @returns the node ID, or null when the canvas holds no viewport node.
 */
export function viewportNode(state: WireState): string | null {
  return state.components.canvas.order.find(id => state.components.canvas.nodes[id]?.kind === VIEWPORT_TYPE) ?? null
}

/**
 * The viewport node type.
 * @param id - the registering package.
 * @returns the node type.
 */
export function viewportNodeType(id: string): NodeType {
  return {
    id,
    type: VIEWPORT_TYPE,
    label: () => pickText('Blender 视口', 'Blender viewport'),
    color: 'var(--dv-node-4)',
    entry: (): TypeEntry => ({ title: pickText('Blender 视口', 'Blender viewport'), assets: [], sizing: VIEWPORT_SIZING }),
  }
}

/**
 * The card body of the viewport node: the live viewport on the media fill. It handles no pointer input, so a drag on
 * it moves the node.
 * @param props - the card's props, the page's link to the bridge, and the frame drawer the tests replace.
 * @returns the element.
 */
export function ViewportCard(props: PropsRuntime<'dv.canvas.card'> & { source: BlenderSource; draw?: FrameDrawer }): ReactNode {
  const t = useText()
  const live = useLiveView(props.source, props.draw)
  return (
    <div ref={live.root} data-testid="dv-blender-node-card" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--dv-media-bg, #111)' }}>
      <LivePicture
        live={live} textScale={props.textScale} testId="dv-blender-node-view"
        waiting={t('等待视口画面…', 'Waiting for the viewport…')} offline={t('Blender 未连接', 'Blender is not connected')}
      />
    </div>
  )
}

/**
 * The editor body of the viewport node: the viewport controls over the live viewport.
 * @param props - the editor's props, the page's link to the bridge, and the frame drawer and frame scheduler the tests replace.
 * @returns the element.
 */
export function ViewportEditor(props: PropsRuntime<'dv.canvas.editor'> & {
  source: BlenderSource
  draw?: FrameDrawer
  schedule?: (flush: () => void) => void
}): ReactNode {
  const live = useLiveView(props.source, props.draw)
  return (
    <div ref={live.root} data-testid="dv-blender-node-editor">
      <ViewportControls
        live={live} source={props.source} schedule={props.schedule} surfaceTestId="dv-blender-node-surface" viewTestId="dv-blender-node-editor-view"
      />
    </div>
  )
}
