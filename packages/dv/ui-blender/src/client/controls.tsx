/**
 * The Blender viewport controls that the Blender tab and the viewport node's editor share: the standard views and the
 * framing buttons above the live viewport, which a drag orbits, a Shift-drag or right-drag pans, and the wheel zooms.
 * Each change is sent at most once per animation frame, with the movement since the last one. The controls move
 * Blender's view only while a Blender is connected whose add-on takes view changes (0.2.0 and later); otherwise they
 * are off, the wheel scrolls the page, and the line under the viewport says why.
 *
 * @module @fastvideo/dreamverse-ui-blender/controls
 */
import { useCallback, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useText } from '@dv/ui-kit/locale.ts'
import css from './controls.module.css'
import type { LiveView } from './live-view.ts'
import { addonNavigates, VIEW_COMMAND_LIMIT, type BlenderSource, type FrameStats, type ViewCommand, type ViewPreset } from './viewer.ts'

/** The class names of the shared buttons: `button` (outlined), `primary` (accent fill), `small` (28 px tall). */
export const buttons = { button: css.button, primary: css.primary, small: css.small }

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }
const centered: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, textAlign: 'center',
  color: 'var(--dv-text-2)', fontSize: 12, pointerEvents: 'none',
}

/**
 * The live picture of one view, letterboxed in its box, with the words shown in its place while there is none.
 * @param props - the live view, the words, the scale of the words, and the canvas's test ID.
 * @returns the element.
 */
export function LivePicture({ live, waiting, offline, textScale = 1, testId }: {
  live: LiveView
  waiting: string
  offline: string
  textScale?: number
  testId: string
}): ReactNode {
  const message = !live.linked.linked ? offline : live.frame === null ? waiting : null
  return (
    <>
      <canvas ref={live.canvas} data-testid={testId} style={{ ...fill, pointerEvents: 'none', visibility: live.frame === null ? 'hidden' : 'visible' }} />
      {message === null ? null : <p style={{ ...centered, margin: 0, fontSize: Math.round(12 * textScale) }}>{message}</p>}
    </>
  )
}

const PRESETS: ReadonlyArray<[ViewPreset, string, string]> = [
  ['front', '前', 'Front'], ['back', '后', 'Back'], ['left', '左', 'Left'], ['right', '右', 'Right'],
  ['top', '顶', 'Top'], ['bottom', '底', 'Bottom'], ['camera', '相机', 'Camera'],
]

const clampCommand = (value: number): number => Math.max(-VIEW_COMMAND_LIMIT, Math.min(VIEW_COMMAND_LIMIT, value))

/**
 * The stream readout: frames per second, the time from a move to its frame, and the add-on's draw and encode times.
 * @param stats - the measurements.
 * @param t - the locale's text picker.
 * @returns the readout's parts, joined by ` · `.
 */
export function statsText(stats: FrameStats, t: (zh: string, en: string) => string): string {
  const parts = [`${String(stats.fps)} fps`]
  if (stats.responseMs !== null) parts.push(t(`响应 ${String(stats.responseMs)} ms`, `response ${String(stats.responseMs)} ms`))
  if (stats.drawMs !== null && stats.encodeMs !== null) {
    parts.push(t(`Blender 绘制 ${String(Math.round(stats.drawMs))} ms，编码 ${String(Math.round(stats.encodeMs))} ms`,
      `Blender draw ${String(Math.round(stats.drawMs))} ms, encode ${String(Math.round(stats.encodeMs))} ms`))
  }
  return parts.join(' · ')
}

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
 * The viewport controls over one view's live viewport; see the module comment.
 * @param props - the view's live viewport, the page's link to the bridge, the test IDs of the surface and its canvas,
 * and the frame scheduler the tests replace.
 * @returns the element.
 */
export function ViewportControls(props: {
  live: LiveView
  source: BlenderSource
  surfaceTestId: string
  viewTestId: string
  schedule?: ((flush: () => void) => void) | undefined
}): ReactNode {
  const { live, source } = props
  const t = useText()
  const view = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ mode: 'orbit' | 'pan'; x: number; y: number } | null>(null)
  const gathered = useRef<Gathered>({ orbit: [0, 0], pan: [0, 0], zoom: 0 })
  const queued = useRef(false)
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

  const navigable = live.linked.linked && live.linked.state !== null && addonNavigates(live.linked.state.addon_version)
  const navigableRef = useRef(navigable)
  navigableRef.current = navigable

  // React registers `onWheel` as passive, so the wheel listener is native to stop the page from scrolling. Like a drag,
  // the wheel moves the view only while it can move; otherwise it scrolls the page as usual. The surface's callback ref
  // adds the listener on mount and removes it on unmount.
  const removeWheel = useRef<(() => void) | null>(null)
  const attachView = useCallback((element: HTMLDivElement | null): void => {
    view.current = element
    removeWheel.current?.()
    removeWheel.current = null
    if (element === null) return
    const onWheel = (event: WheelEvent): void => {
      if (!navigableRef.current) return
      event.preventDefault()
      const lines = event.deltaMode === 1 ? event.deltaY : event.deltaY / 100
      gathered.current.zoom += lines
      queueRef.current()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    removeWheel.current = () => { element.removeEventListener('wheel', onWheel) }
  }, [])

  /** Start an orbit drag with the left button, or a pan drag with the right button or Shift, while the view can move. */
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
  /** Add the drag's movement, as fractions of the shown picture, to the gathered view change and queue its sending. */
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

  const state = live.linked.state
  const small = `${css.button} ${css.small}`
  return (
    <div className={css.controls}>
      <div role="toolbar" aria-label={t('视图', 'Views')} className={css.toolbar}>
        <div className={css.presets}>
          {PRESETS.map(([preset, zh, en]) => (
            <button key={preset} type="button" className={css.preset} disabled={!navigable} onClick={() => { source.navigate({ action: 'preset', preset }) }}>
              {t(zh, en)}
            </button>
          ))}
        </div>
        <button type="button" className={small} disabled={!navigable} onClick={() => { source.navigate({ action: 'frame', target: 'all' }) }}>
          {t('显示全部', 'Frame all')}
        </button>
        <button type="button" className={small} disabled={!navigable} onClick={() => { source.navigate({ action: 'frame', target: 'selected' }) }}>
          {t('显示所选', 'Frame selected')}
        </button>
      </div>
      {/* The surface sizes itself at 16:9, because its parent, such as the canvas editor's body, is as tall as its content. */}
      <div
        ref={attachView} data-testid={props.surfaceTestId} className={css.surface} data-navigable={navigable ? '' : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onContextMenu={(event) => { event.preventDefault() }}
      >
        <LivePicture
          live={live} testId={props.viewTestId}
          waiting={t('等待视口画面…', 'Waiting for the viewport…')} offline={t('Blender 未连接', 'Blender is not connected')}
        />
      </div>
      {live.stats === null || !live.linked.linked ? null : <p data-testid="dv-blender-stats" className={css.stats}>{statsText(live.stats, t)}</p>}
      <p className={css.hint}>
        {state !== null && !addonNavigates(state.addon_version)
          ? t('请在 Blender 里更新 DreamVerse 插件，才能从这里移动视图。', 'Update the DreamVerse add-on in Blender to move the view from here.')
          : t('拖动旋转 · Shift 拖动或右键拖动平移 · 滚轮缩放。这里只移动视图。',
            'Drag to orbit · Shift-drag or right-drag to pan · Scroll to zoom. This moves only the view.')}
      </p>
    </div>
  )
}
