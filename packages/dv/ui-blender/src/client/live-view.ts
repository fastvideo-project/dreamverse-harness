/**
 * The live Blender viewport for one view (the tab panel, a canvas card, the node editor): the link status and the
 * frames of the page's shared viewport socket, drawn onto the view's canvas. A view watches only while it is on screen
 * and the page is visible, and skips to the newest frame while one is still being drawn, so frames never queue up.
 *
 * @module @fastvideo/dreamverse-ui-blender/live-view
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { BlenderSource, BlenderState, FrameStats, ViewFrame } from './viewer.ts'

/** Draws one frame onto the canvas; the page decodes it with `createImageBitmap`. */
export type FrameDrawer = (canvas: HTMLCanvasElement, frame: ViewFrame) => Promise<void>

/**
 * Decode a frame off the main thread and draw it, resizing the canvas to the frame.
 * @param canvas - the viewport canvas.
 * @param frame - the frame.
 */
export const drawFrame: FrameDrawer = async (canvas, frame) => {
  const bitmap = await createImageBitmap(frame.image)
  try {
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  } finally {
    bitmap.close()
  }
}

/** What {@link useLiveView} gives a view. */
export interface LiveView {
  /** Attach to the view's outer element, whose visibility decides whether the view watches. */
  root: RefObject<HTMLDivElement>
  /** Attach to the canvas the frames are drawn on. */
  canvas: RefObject<HTMLCanvasElement>
  /** Whether a Blender is connected, and what it reported. */
  linked: { linked: boolean; state: BlenderState | null }
  /** The pixel size of the newest frame; null before the first frame and after a disconnect. */
  frame: { width: number; height: number } | null
  /** How the stream performs, updated at most every {@link STATS_INTERVAL_MS}; null before the first measured frame. */
  stats: FrameStats | null
}

/** How often a view refreshes its {@link LiveView.stats}, in milliseconds, so the numbers stay readable. */
export const STATS_INTERVAL_MS = 500

/**
 * Watch the viewport for one view.
 * @param source - the page's link to the bridge.
 * @param draw - the frame drawer; the tests replace {@link drawFrame}.
 * @returns the refs to attach and the live status.
 */
export function useLiveView(source: BlenderSource, draw: FrameDrawer = drawFrame): LiveView {
  const [linked, setLinked] = useState<LiveView['linked']>({ linked: false, state: null })
  const [frame, setFrame] = useState<LiveView['frame']>(null)
  const [stats, setStats] = useState<FrameStats | null>(null)
  const statsAt = useRef(0)
  const [visible, setVisible] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // The frame being drawn and the newest frame that arrived meanwhile; older waiting frames are dropped.
  const drawing = useRef<{ busy: boolean; next: ViewFrame | null }>({ busy: false, next: null })

  // Watch only while the view is on screen and the page is visible; a hidden tab of another chat streams nothing.
  useEffect(() => {
    const element = root.current
    const update = (onScreen: boolean): void => { setVisible(onScreen && document.visibilityState === 'visible') }
    const onVisibility = (): void => { update(element === null || element.getClientRects().length > 0) }
    document.addEventListener('visibilitychange', onVisibility)
    let observer: IntersectionObserver | null = null
    if (element !== null && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => { update(entries.some(entry => entry.isIntersecting)) })
      observer.observe(element)
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
    }
  }, [])

  // Draw a frame, or keep it as the newest waiting one while another is drawn or the canvas is not mounted yet.
  const paint = useRef<(next: ViewFrame) => void>(() => {})
  paint.current = (next: ViewFrame): void => {
    const target = canvas.current
    if (drawing.current.busy || target === null) {
      drawing.current.next = next
      return
    }
    drawing.current = { busy: true, next: null }
    draw(target, next).catch(() => null).finally(() => {
      const queued = drawing.current.next
      drawing.current = { busy: false, next: null }
      if (queued !== null) paint.current(queued)
    })
  }

  useEffect(() => {
    if (!visible) return
    return source.watch({
      status: (isLinked, state) => {
        setLinked({ linked: isLinked, state })
        if (!isLinked) {
          setFrame(null)
          setStats(null)
        }
      },
      frame: (next) => {
        setFrame(current => (current?.width === next.width && current.height === next.height
          ? current
          : { width: next.width, height: next.height }))
        if (next.stats !== undefined && performance.now() - statsAt.current >= STATS_INTERVAL_MS) {
          statsAt.current = performance.now()
          setStats(next.stats)
        }
        paint.current(next)
      },
    })
  }, [source, visible])

  // A frame that arrived before the canvas was mounted is drawn once it is.
  useEffect(() => {
    const waiting = drawing.current.next
    if (frame !== null && waiting !== null && !drawing.current.busy) paint.current(waiting)
  }, [frame])

  return { root, canvas, linked, frame, stats }
}
