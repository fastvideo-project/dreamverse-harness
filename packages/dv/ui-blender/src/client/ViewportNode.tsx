/**
 * The Blender viewport node of the canvas: one node while the project's `blender` slice says the viewport is on the
 * canvas. Its card shows the live viewport and takes no pointer input, so the canvas moves, selects, resizes and opens
 * the node as any other. Its editor, open after a double click, shows the viewport large and moves Blender's view:
 * a drag orbits, a Shift-drag or right-drag pans, the wheel zooms, and buttons switch to the standard views, frame the
 * scene or the selection, and take the node off the canvas. Each change is sent at most once per animation frame,
 * with the movement since the last one.
 *
 * @module @fastvideo/dreamverse-ui-blender/ViewportNode
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BlenderSlice } from '@fastvideo/dreamverse-blender-bridge/types'
import type { NodeEntry, NodeSizing, NodeType } from '@dv/ui-canvas/contract'
import { pickText, useText } from '@dv/ui-kit/locale.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { useLiveView, type FrameDrawer } from './live-view.ts'
import { addonNavigates, VIEW_COMMAND_LIMIT, VIEWPORT_OPERATION, type BlenderSource, type ViewCommand, type ViewPreset } from './viewer.ts'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { blender: BlenderSlice } }

/** The node type of the viewport node, its card and editor key. */
export const VIEWPORT_TYPE = 'blender-viewport'

/** The ID of the one viewport node. */
export const VIEWPORT_NODE = 'blender:viewport'

/** A media node at 16:9, the default aspect of Blender's viewport; a picture of another aspect is letterboxed. */
export const VIEWPORT_SIZING: NodeSizing = {
  kind: 'media', defaultSize: { width: 320, height: 180 }, minSize: { width: 160, height: 90 }, aspectRatio: { ratio: 16 / 9, fixedHeight: 0 },
}

/**
 * The record that put the viewport on the canvas, when it is there.
 * @param state - the project state.
 * @returns the record ID, or null when the viewport is not on the canvas or the server has no Blender component.
 */
export function placedRecord(state: WireState): string | null {
  return state.components.blender?.viewport ?? null
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
    column: 0,
    entries({ state }): NodeEntry[] {
      const placed = placedRecord(state)
      if (placed === null) return []
      const record = state.components.proj.records.find(candidate => candidate.id === placed) ?? null
      return [{ id: VIEWPORT_NODE, title: pickText('Blender 视口', 'Blender viewport'), record, assets: [], sizing: VIEWPORT_SIZING }]
    },
  }
}

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }
const centered: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, textAlign: 'center',
  color: 'var(--dv-text-2)', fontSize: 12, pointerEvents: 'none',
}

/**
 * The live picture of one view, letterboxed in its box, with the words shown in its place while there is none.
 * @param props - the live view and the words.
 * @returns the element.
 */
function LivePicture({ live, waiting, offline, textScale = 1 }: {
  live: ReturnType<typeof useLiveView>
  waiting: string
  offline: string
  textScale?: number
}): ReactNode {
  const message = !live.linked.linked ? offline : live.frame === null ? waiting : null
  return (
    <>
      <canvas ref={live.canvas} data-testid="dv-blender-node-view" style={{ ...fill, pointerEvents: 'none', visibility: live.frame === null ? 'hidden' : 'visible' }} />
      {message === null ? null : <p style={{ ...centered, margin: 0, fontSize: Math.round(12 * textScale) }}>{message}</p>}
    </>
  )
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
        live={live} textScale={props.textScale}
        waiting={t('等待视口画面…', 'Waiting for the viewport…')} offline={t('Blender 未连接', 'Blender is not connected')}
      />
    </div>
  )
}

const PRESETS: ReadonlyArray<[ViewPreset, string, string]> = [
  ['front', '前', 'Front'], ['back', '后', 'Back'], ['left', '左', 'Left'], ['right', '右', 'Right'],
  ['top', '顶', 'Top'], ['bottom', '底', 'Bottom'], ['camera', '相机', 'Camera'],
]

const clampCommand = (value: number): number => Math.max(-VIEW_COMMAND_LIMIT, Math.min(VIEW_COMMAND_LIMIT, value))

/** A width and height in pixels. */
type PixelSize = { width: number; height: number }

/** Movement gathered since the last sent change. */
interface Gathered { orbit: [number, number]; pan: [number, number]; zoom: number }

/**
 * The size of the picture inside a box when it is letterboxed to fit.
 * @param box - the box in CSS pixels.
 * @param frame - the picture's pixel size; null before the first frame.
 * @returns the shown picture's size in CSS pixels.
 */
export function shownSize(box: PixelSize, frame: PixelSize | null): PixelSize {
  if (frame === null || frame.width === 0 || frame.height === 0) return box
  const scale = Math.min(box.width / frame.width, box.height / frame.height)
  return { width: frame.width * scale || 1, height: frame.height * scale || 1 }
}

/**
 * The editor body of the viewport node; see the module comment.
 * @param props - the editor's props, the page's link to the bridge, and the frame drawer and frame scheduler the tests replace.
 * @returns the element.
 */
export function ViewportEditor(props: PropsRuntime<'dv.canvas.editor'> & {
  source: BlenderSource
  draw?: FrameDrawer
  schedule?: (flush: () => void) => void
}): ReactNode {
  const { source, host } = props
  const t = useText()
  const live = useLiveView(source, props.draw)
  const view = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'orbit' | 'pan'; x: number; y: number } | null>(null)
  const gathered = useRef<Gathered>({ orbit: [0, 0], pan: [0, 0], zoom: 0 })
  const queued = useRef(false)
  const [removing, setRemoving] = useState(false)
  const frameRef = useRef(live.frame)
  frameRef.current = live.frame
  const schedule = props.schedule ?? ((flush: () => void) => { requestAnimationFrame(flush) })

  const flush = (): void => {
    queued.current = false
    const { orbit, pan, zoom } = gathered.current
    gathered.current = { orbit: [0, 0], pan: [0, 0], zoom: 0 }
    const send = (command: ViewCommand): void => { source.navigate(command) }
    if (orbit[0] !== 0 || orbit[1] !== 0) send({ action: 'orbit', dx: clampCommand(orbit[0]), dy: clampCommand(orbit[1]) })
    if (pan[0] !== 0 || pan[1] !== 0) send({ action: 'pan', dx: clampCommand(pan[0]), dy: clampCommand(pan[1]) })
    if (zoom !== 0) send({ action: 'zoom', steps: clampCommand(zoom) })
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  const queue = (): void => {
    if (queued.current) return
    queued.current = true
    schedule(() => { flushRef.current() })
  }
  const queueRef = useRef(queue)
  queueRef.current = queue

  // React registers `onWheel` as passive, so the wheel listener is native to stop the page from scrolling.
  useEffect(() => {
    const element = view.current
    if (element === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const lines = event.deltaMode === 1 ? event.deltaY : event.deltaY / 100
      gathered.current.zoom += lines
      queueRef.current()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [])

  const navigable = live.linked.linked && live.linked.state !== null && addonNavigates(live.linked.state.addon_version)
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!navigable || (event.button !== 0 && event.button !== 2)) return
    event.preventDefault()
    drag.current = { mode: event.button === 2 || event.shiftKey ? 'pan' : 'orbit', x: event.clientX, y: event.clientY }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch (error) {
      // A synthetic pointer without an active pointer ID cannot be captured; the drag still works inside the view.
      void error
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    const element = view.current
    if (current === null || element === null) return
    const shown = shownSize({ width: element.clientWidth || 1, height: element.clientHeight || 1 }, frameRef.current)
    const dx = (event.clientX - current.x) / shown.width
    const dy = (event.clientY - current.y) / shown.height
    current.x = event.clientX
    current.y = event.clientY
    const target = gathered.current[current.mode]
    target[0] += dx
    target[1] += dy
    queue()
  }
  const onPointerUp = (): void => { drag.current = null }
  const remove = (): void => {
    setRemoving(true)
    host.run({ operation: VIEWPORT_OPERATION, params: { on: false }, intent: t('把 Blender 视口从画布上拿下', 'Take the Blender viewport off the canvas') })
    host.close()
  }

  const state = live.linked.state
  return (
    <div ref={live.root} data-testid="dv-blender-node-editor" style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', padding: 12, boxSizing: 'border-box' }}>
      <div role="toolbar" aria-label={t('视图', 'Views')} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {PRESETS.map(([preset, zh, en]) => (
          <button key={preset} type="button" disabled={!navigable} onClick={() => { source.navigate({ action: 'preset', preset }) }}>{t(zh, en)}</button>
        ))}
        <span style={{ width: 8 }} />
        <button type="button" disabled={!navigable} onClick={() => { source.navigate({ action: 'frame', target: 'all' }) }}>{t('显示全部', 'Frame all')}</button>
        <button type="button" disabled={!navigable} onClick={() => { source.navigate({ action: 'frame', target: 'selected' }) }}>{t('显示所选', 'Frame selected')}</button>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={removing} onClick={remove}>{t('从画布移除', 'Remove from the canvas')}</button>
      </div>
      <div
        ref={view} data-testid="dv-blender-node-surface"
        style={{ position: 'relative', flex: 1, minHeight: 0, borderRadius: 'var(--dv-radius-lg, 8px)', overflow: 'hidden', background: 'var(--dv-media-bg, #111)', cursor: navigable ? 'grab' : 'default', touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onContextMenu={(event) => { event.preventDefault() }}
      >
        <LivePicture live={live} waiting={t('等待视口画面…', 'Waiting for the viewport…')} offline={t('Blender 未连接', 'Blender is not connected')} />
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--dv-text-2)' }}>
        {state !== null && !addonNavigates(state.addon_version)
          ? t('请在 Blender 里更新 DreamVerse 插件，才能从这里移动视图。', 'Update the DreamVerse add-on in Blender to move the view from here.')
          : t('拖动旋转 · Shift 拖动或右键拖动平移 · 滚轮缩放。这里只移动视图，不改场景。',
            'Drag to orbit · Shift-drag or right-drag to pan · Scroll to zoom. This moves only the view, never the scene.')}
      </p>
    </div>
  )
}
