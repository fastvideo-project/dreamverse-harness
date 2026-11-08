/**
 * The project canvas: a pan-and-zoom surface that draws the nodes of the registered node types in the canvas chrome
 * (a caption above a frame) around each type's `dv.canvas.card` body; a click selects a node, and a double click opens
 * its editor panel, which grows out of the node and shrinks back into it (`@dv/ui-kit/zoom.ts`). Node positions, frame
 * sizes, and the viewport are stored per project through `/api/dv/canvas/layout`; a node without a stored position
 * gets its type's default size at the first free spot at or below its automatic position, and that box is stored once
 * the node's record stops rendering, so a node that appears later never moves or covers another. The corner handles of
 * the selected node resize it within its type's sizing. The opened nodes are kept per
 * project in `localStorage` for the unseen dot. Colors come from the `--dv-*` theme variables that `@dv/ui-shell`
 * defines and from each type's `color`. The canvas names no node type.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { errorMessage } from '@dv/ui-kit/api.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { useLanguage } from '@dv/ui-kit/locale.ts'
import type { Asset, OperationRequest, ProjectRecord } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { readStored, writeStored } from '@dv/ui-kit/storage.ts'
import { useOperations, useProjectState } from '@dv/ui-kit/useProject.ts'
import { useZoomPresence } from '@dv/ui-kit/zoom.ts'
import type { CanvasViewport, NodePosition, NodeSpot } from '../canvas-layout.ts'
import { cardsOf } from './agent-canvas.ts'
import type { CanvasViews } from './agent-canvas.ts'
import type { CanvasRequest, EditorHost, NodeAction, NodeHost, NodeView, RerunRequest } from './contract/index.ts'
import { buildCanvasGraph, freePositions, isFinished, previewOf, ROW } from './graph.ts'
import type { CanvasEdge, CanvasNode, CanvasRegistrations } from './graph.ts'
import { cardHeight, edgeAnchorY, NodeCard, textScaleAt, TypeLabelBody } from './NodeCard.tsx'
import type { CanvasTranslate } from './NodeCard.tsx'
import { readLayout, writeLayout } from './layout-client.ts'
import { NodeEditor } from './NodeEditor.tsx'
import type { EditorArea, RenderCanvasSlot, SurfaceHosts } from './NodeEditor.tsx'
import { resizedBox } from './resize.ts'
import type { ResizeCorner } from './resize.ts'

/** The registered descriptors that the canvas draws with. */
export interface CanvasDescriptors extends CanvasRegistrations {
  actions: readonly NodeAction[]
}

/** Props of {@link CanvasView}. */
export interface CanvasViewProps extends PropsRenderFactories {
  /** The project to draw. */
  projectId: string
  client: DvClient
  /** The registry in which the canvas, while loaded, answers the canvas tools' reads and draws their stored moves. */
  views: CanvasViews
  /** The chat session the canvas sits beside, recorded as the `session` of the canvas's writes. */
  session: string | null
  t: CanvasTranslate
  /** The descriptors that plugin UI halves registered in `dvCanvas`. */
  descriptors: CanvasDescriptors
  renderSlot: RenderCanvasSlot
  preview: (projectId: string, asset: Asset, opener: Element | null) => void
  /** The record whose node to open once; null for none. */
  focus: CanvasFocus | null
}

/** A request to open the node of a record, such as a History selection, until the canvas takes it. */
export interface CanvasFocus {
  record: string
  /** Mark the request as handled, so a remounted canvas does not open the node again. */
  take: () => void
}

/** The tallest a card grows (larger text at low zoom plus a badge row), used when fitting. */
const FIT_NODE_HEIGHT = ROW - 20
/** How far above the pointer a dropped node's top edge lands, in canvas units, so the pointer rests on its caption. */
const DROP_OFFSET_Y = 40
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const DRAG_THRESHOLD = 4
/** The longest pause between two clicks on one node that opens its editor, in ms. */
const DOUBLE_CLICK_MS = 400
const SAVE_DELAY_MS = 500
/** The zoom ref of a stacked editor, which opens and closes without the zoom transition. */
const noZoom = (element: HTMLElement | null): void => { void element }
/** Canvas dot grid pitch at 100%, in canvas units. */
const GRID = 20

// Hover and focus states, which inline styles cannot express; scoped to the canvas by class name. A focused node
// outlines its frame alone, so the outline matches the frame's selection ring instead of also wrapping the caption.
const CANVAS_CSS = `
.dv-canvas-btn { background: transparent; transition: background-color 120ms var(--dv-ease); }
.dv-canvas-btn:hover:not(:disabled) { background: var(--dv-surface-3); }
.dv-canvas-btn:focus-visible, .dv-canvas-soft:focus-visible, [data-node-id]:focus-visible > [data-node-frame] { outline: 2px solid var(--dv-accent); outline-offset: 2px; }
[data-node-id]:focus-visible { outline: none; }
.dv-canvas-soft { background: var(--dv-accent-soft); color: var(--dv-accent-text); }
@media (prefers-reduced-motion: reduce) { .dv-canvas-btn { transition: none; } }
`

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

function sizeOf(element: Element | null): { width: number; height: number } {
  const rect = element?.getBoundingClientRect()
  return { width: rect?.width || 800, height: rect?.height || 600 }
}

/** Zoom change per pixel of a mouse wheel's deltaY: one notch (about 100 px) zooms by about 14%. */
const WHEEL_ZOOM_RATE = 0.0015
/**
 * Zoom change per pixel of a touchpad pinch's deltaY. Browsers report a pinch as wheel events with `ctrlKey` and
 * deltas of a few pixels each, so the pinch needs a larger rate than a mouse wheel to follow the fingers.
 */
const PINCH_ZOOM_RATE = 0.01
/** Pixels per line for wheel events that report `deltaMode` in lines (Firefox mouse wheels). */
const LINE_HEIGHT_PX = 16

/**
 * The factor one wheel event multiplies the canvas zoom by.
 * @param event - the wheel event's deltaY, deltaMode, and ctrlKey (set for a touchpad pinch).
 * @returns the zoom factor; above 1 zooms in.
 */
export function wheelZoomFactor(event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>): number {
  const pixels = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT_PX : event.deltaY
  return Math.exp(-pixels * (event.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE))
}

/**
 * The `localStorage` key prefix of a project's opened nodes: JSON `{ since, ids }`, where `since` is the newest finish (else
 * creation) time of a record when the project was first opened in this browser and `ids` are the node IDs opened since.
 */
const SEEN_KEY = 'dv-canvas-seen:'

/** The nodes opened in this browser: every node whose record finished by `since`, and the opened `ids`. */
interface Seen {
  since: string
  ids: ReadonlySet<string>
}

/**
 * @param projectId - the project.
 * @returns the opened nodes, or null when the project has none stored or the stored value is malformed.
 */
function readSeen(projectId: string): Seen | null {
  const raw = readStored('local', SEEN_KEY + projectId)
  if (raw === null) return null
  const strings = (ids: unknown[]): ReadonlySet<string> => new Set(ids.filter((id): id is string => typeof id === 'string'))
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return { since: '', ids: strings(parsed) }
    if (typeof parsed !== 'object' || parsed === null || !('since' in parsed) || !('ids' in parsed)) return null
    const { since, ids } = parsed
    if (typeof since !== 'string' || !Array.isArray(ids)) return null
    return { since, ids: strings(ids) }
  } catch (error) {
    // Malformed JSON counts as none stored.
    void error
    return null
  }
}

/**
 * @param projectId - the project.
 * @param seen - the opened nodes.
 */
function writeSeen(projectId: string, seen: Seen): void {
  writeStored('local', SEEN_KEY + projectId, JSON.stringify({ since: seen.since, ids: [...seen.ids] }))
}

function wasSeen(seen: Seen, node: CanvasNode): boolean {
  return seen.ids.has(node.id) || (node.record !== null && settledAt(node.record) <= seen.since)
}

function settledAt(record: ProjectRecord): string {
  return record.finished_at ?? record.created_at
}

/** A rerun whose new node the canvas waits for; `known` holds the nodes drawn before the request. */
interface AwaitedRender {
  basedOn: string
  known: ReadonlySet<string>
  resolve: () => void
}

/** An in-progress pointer gesture. A resize drags one corner of the selected node ({@link resizedBox}). */
type Gesture =
  | { kind: 'pan'; startX: number; startY: number; origin: CanvasViewport; moved: boolean }
  | { kind: 'node'; id: string; startX: number; startY: number; origin: NodePosition; at: NodePosition; moved: boolean }
  | { kind: 'resize'; node: CanvasNode; corner: ResizeCorner; startX: number; startY: number; origin: NodePosition; at: NodePosition; moved: boolean }

/**
 * @param boxes - the boxes that the canvas gave the nodes, by node ID.
 * @param node - a node.
 * @returns its box, else, until the canvas gives it one, its automatic position at its type's default size.
 */
const boxIn = (boxes: Readonly<Record<string, NodePosition>>, node: CanvasNode): NodePosition =>
  boxes[node.id] ?? { x: node.x, y: node.y, ...node.sizing.defaultSize }

/**
 * @param map - a map.
 * @param keys - the keys to drop.
 * @returns a copy of the map without those keys.
 */
function withoutKeys<V>(map: ReadonlyMap<string, V>, keys: readonly string[]): Map<string, V> {
  const next = new Map(map)
  for (const key of keys) next.delete(key)
  return next
}

/**
 * @param record - positions or any other record keyed by node ID.
 * @param keys - the keys to drop.
 * @returns a copy of the record without those keys.
 */
function withoutProperties<V>(record: Readonly<Record<string, V>>, keys: readonly string[]): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}

function viewOf(node: CanvasNode, unseen: boolean, rerunning: boolean): NodeView {
  const { nodeType: _nodeType, x: _x, y: _y, ...entry } = node
  return { ...entry, unseen, rerunning }
}

/**
 * The canvas.
 * @param props - the project, chat session, client, translate, registered descriptors, slot renderers, preview and
 *   focus.
 * @returns the element.
 */
export function CanvasView(
  { projectId, client, views, session, t, descriptors, renderSlot, renderFactorySlot, preview, focus }: CanvasViewProps,
): ReactNode {
  const language = useLanguage()
  const base = useProjectState(client, projectId)
  const operations = useOperations(client)
  // This view's placements whose record the project state does not show yet: asset ID → on the canvas.
  const [inFlight, setInFlight] = useState<ReadonlyMap<string, boolean>>(new Map())
  // The project's canvas, with this view's placements in flight already applied.
  const placed = useMemo(() => {
    const next = new Set(base.value?.components.asset.placed ?? [])
    for (const [assetId, on] of inFlight) {
      if (on) next.add(assetId)
      else next.delete(assetId)
    }
    return next
  }, [base.value, inFlight])
  // A placement leaves the in-flight map once the project state shows it.
  useEffect(() => {
    if (base.value === null || inFlight.size === 0) return
    const shown = new Set(base.value.components.asset.placed)
    const settled = [...inFlight].filter(([assetId, on]) => shown.has(assetId) === on)
    if (settled.length > 0) setInFlight(current => withoutKeys(current, settled.map(([assetId]) => assetId)))
  }, [base.value, inFlight])
  /**
   * Put an asset on the project's canvas or take it off: at once in this view, then through an `asset.place` or
   * `asset.unplace` record.
   * @param assetId - the asset.
   * @param on - true to place it, false to remove it.
   * @returns settles when the record is written; a refused write puts the canvas back as it was.
   */
  const changePlacement = (assetId: string, on: boolean): Promise<unknown> => {
    setInFlight(current => new Map(current).set(assetId, on))
    return client.placeOnCanvas(projectId, [assetId], on, session).catch((error: unknown) => {
      setInFlight(current => withoutKeys(current, [assetId]))
      throw error
    })
  }
  // The previous project's state stays loaded until the next project's arrives; the canvas draws only this project's.
  const graph = useMemo(() => {
    if (base.value === null || base.value.project.id !== projectId) return null
    return { state: base.value, ...buildCanvasGraph(base.value, placed, operations.value ?? [], language, descriptors) }
  }, [base.value, placed, projectId, operations.value, language, descriptors])
  const assetById = useMemo(() => new Map<string, Asset>((graph?.state.assets ?? []).map(asset => [asset.id, asset])), [graph])

  const [positions, setPositions] = useState<Record<string, NodePosition>>({})
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 40, y: 40, zoom: 1 })
  const [layoutReady, setLayoutReady] = useState(false)
  // The node with the accent ring, and the node whose editor is open; closing the editor keeps the ring.
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // The editor a reference chip opened over the `editing` one; it closes first, and with the editor beneath it.
  const [stacked, setStacked] = useState<string | null>(null)
  useEffect(() => { setStacked(null) }, [editing])
  const [seen, setSeen] = useState<{ project: string; seen: Seen } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  // The last click on a node, so a second click on it within DOUBLE_CLICK_MS opens the editor. The canvas captures the
  // pointer on each press, which makes the browser fire `dblclick` on the canvas instead of the card, so the card's own
  // double-click event cannot serve.
  const lastClick = useRef<{ id: string; at: number } | null>(null)
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const moved = useRef(new Map<string, NodePosition>())
  // The nodes whose box the canvas chose while their record was rendering. Such a box is drawn and counts as occupied,
  // but is not stored until the node's default size is final.
  const unsavedSpots = useRef(new Set<string>())
  // Stored corners without a size, from a layout file written before nodes had a stored size or from an agent's move
  // of a node that this canvas has not given a final box yet: the canvas gives each node its default size there once
  // and stores the box.
  const sizeless = useRef<Record<string, NodeSpot>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const needsFit = useRef(false)
  // True while the viewport is an automatic fit; resizing the canvas refits until the user pans or zooms.
  const autoFit = useRef(false)
  // Imported or dropped assets waiting for their node to appear, with the canvas point they were dropped at.
  const pendingDrops = useRef(new Map<string, NodeSpot>())
  const [dragOver, setDragOver] = useState(false)
  // The node the user last dragged or dropped is drawn above the others.
  const [topNode, setTopNode] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLayoutReady(false)
    // A canvas without stored positions still works with the automatic layout, so a failed read counts as empty.
    void readLayout(projectId).catch(() => ({ positions: {}, viewport: null })).then((layout) => {
      if (!live) return
      // The stored layout wins over a drag made before it arrived.
      moved.current.clear()
      unsavedSpots.current.clear()
      const stored: Record<string, NodePosition> = {}
      sizeless.current = {}
      for (const [id, { x, y, width, height }] of Object.entries(layout.positions)) {
        if (width === undefined || height === undefined) sizeless.current[id] = { x, y }
        else stored[id] = { x, y, width, height }
      }
      setPositions(stored)
      if (layout.viewport !== null) setViewport(layout.viewport)
      needsFit.current = layout.viewport === null
      setLayoutReady(true)
    })
    return () => {
      live = false
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    }
  }, [projectId])

  /** Store the moved positions and the viewport after the gesture settles. */
  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const patch = Object.fromEntries(moved.current)
      moved.current.clear()
      // The next save carries the viewport again; lost positions fall back to the automatic layout.
      void writeLayout(projectId, { positions: patch, viewport: viewportRef.current }).catch(() => null)
    }, SAVE_DELAY_MS)
  }, [projectId])

  const boxOf = useCallback((node: CanvasNode): NodePosition => boxIn(positions, node), [positions])

  /** Pan and zoom so every node is visible, at 100% at most: content that fits the view keeps its true size. */
  const fit = useCallback(() => {
    if (graph === null || graph.nodes.length === 0) return
    const { width, height } = sizeOf(container.current)
    const boxes = graph.nodes.map(boxOf)
    const minX = Math.min(...boxes.map(box => box.x))
    const minY = Math.min(...boxes.map(box => box.y))
    const spanX = Math.max(...boxes.map(box => box.x + box.width)) - minX
    const spanY = Math.max(...boxes.map(box => box.y + Math.max(FIT_NODE_HEIGHT, cardHeight(box)))) - minY
    const zoom = clampZoom(Math.min((width - 80) / spanX, (height - 80) / spanY, 1))
    setViewport({ x: (width - spanX * zoom) / 2 - minX * zoom, y: (height - spanY * zoom) / 2 - minY * zoom, zoom })
  }, [graph, boxOf])

  useEffect(() => {
    if (layoutReady && needsFit.current && graph !== null && graph.nodes.length > 0) {
      needsFit.current = false
      autoFit.current = true
      fit()
    }
  }, [layoutReady, graph, fit])

  // The canvas can change size after the first fit, for example when the right panel opens; keep the automatic fit.
  const fitRef = useRef(fit)
  fitRef.current = fit
  const [area, setArea] = useState<EditorArea>({ width: 0, height: 0 })
  const detachCanvas = useRef<(() => void) | null>(null)
  /**
   * Attach the canvas element's size observer and wheel listener on mount and detach them on unmount; the wheel
   * listener is native because React registers `onWheel` as passive, so `preventDefault` there has no effect.
   */
  const attachCanvas = useCallback((element: HTMLDivElement | null) => {
    container.current = element
    detachCanvas.current?.()
    detachCanvas.current = null
    if (element === null) return
    const measure = (): void => { setArea({ width: element.clientWidth, height: element.clientHeight }) }
    measure()
    const observer = new ResizeObserver(() => {
      measure()
      if (autoFit.current) fitRef.current()
    })
    observer.observe(element)
    const onWheel = (event: WheelEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-dv-scroll-island]') !== null) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      autoFit.current = false
      setViewport((current) => {
        const zoom = clampZoom(current.zoom * wheelZoomFactor(event))
        return { zoom, x: px - (px - current.x) / current.zoom * zoom, y: py - (py - current.y) / current.zoom * zoom }
      })
      scheduleSave()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    detachCanvas.current = () => {
      observer.disconnect()
      element.removeEventListener('wheel', onWheel)
    }
  }, [scheduleSave])

  // Escape closes the top floating editor wherever focus is.
  useEffect(() => {
    if (editing === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (stacked === null) setEditing(null)
      else setStacked(null)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [editing, stacked])

  /** Pan so a node sits at the center of the canvas, keeping the zoom. */
  const centerOn = useCallback((node: CanvasNode) => {
    const { width, height } = sizeOf(container.current)
    const box = boxIn(positionsRef.current, node)
    autoFit.current = false
    setViewport(current => ({
      ...current,
      x: width / 2 - (box.x + box.width / 2) * current.zoom,
      y: height / 2 - (box.y + cardHeight(box) / 2) * current.zoom,
    }))
  }, [])

  // A focus request waits while no drawn node matches it, so a node type that registers later still opens its node;
  // only opening the node takes the request.
  useEffect(() => {
    if (focus === null || !layoutReady || graph === null) return
    const recordId = focus.record
    const firstOutput = graph.state.components.proj.records.find(record => record.id === recordId)?.outputs[0]
    const node = graph.nodes.find(candidate => candidate.id === recordId)
      ?? graph.nodes.find(candidate => candidate.record?.id === recordId)
      ?? graph.nodes.find(candidate => candidate.records?.includes(recordId) === true)
      ?? graph.nodes.find(candidate => firstOutput !== undefined && candidate.assets.includes(firstOutput))
    if (node === undefined) return
    focus.take()
    centerOn(node)
    setSelected(node.id)
    setEditing(node.id)
  }, [focus, layoutReady, graph, centerOn])

  /** Move a node so that its top edge is centered on a dropped canvas point, and store its box; the node keeps its size. */
  const placeNode = useCallback((node: CanvasNode, point: NodeSpot) => {
    const size = boxIn(positionsRef.current, node)
    const box = { ...size, x: point.x - size.width / 2, y: point.y }
    positionsRef.current = { ...positionsRef.current, [node.id]: box }
    setPositions(all => ({ ...all, [node.id]: box }))
    setTopNode(node.id)
    moved.current.set(node.id, box)
    unsavedSpots.current.delete(node.id)
    scheduleSave()
  }, [scheduleSave])

  // Place dropped assets whose nodes have appeared.
  const graphRef = useRef(graph)
  graphRef.current = graph
  const placePending = useCallback(() => {
    const current = graphRef.current
    if (current === null) return
    for (const [assetId, spot] of pendingDrops.current) {
      const node = current.nodes.find(entry => entry.id === current.assetNodes[assetId])
      if (node === undefined) continue
      pendingDrops.current.delete(assetId)
      placeNode(node, spot)
    }
  }, [placeNode])
  useEffect(() => { placePending() }, [graph, placePending])

  // Give every node without a stored box its default size at a free spot, or at its stored corner of an older layout
  // file, and store the box once the node's default size is final. A rendering node's box stays unsaved: it is drawn and
  // occupied, and when the node stops rendering the canvas drops the box and places the node again at its final default
  // size, then stores that box. The ref is updated at once so that the reveal of a new node below centers on its spot;
  // an earlier queued position, such as a dropped asset's, wins over the free spot.
  useEffect(() => {
    if (!layoutReady || graph === null) return
    const rendering = new Set(graph.nodes.flatMap(node => node.flags.rendering ? [node.id] : []))
    const settled = [...unsavedSpots.current].filter(id => !rendering.has(id))
    for (const id of settled) unsavedSpots.current.delete(id)
    const kept = withoutProperties(positionsRef.current, settled)
    const added = freePositions(graph.nodes, kept, sizeless.current, cardHeight)
    if (settled.length === 0 && Object.keys(added).length === 0) return
    for (const id of Object.keys(added)) if (rendering.has(id)) unsavedSpots.current.add(id)
    positionsRef.current = { ...added, ...kept }
    setPositions(all => ({ ...added, ...withoutProperties(all, settled) }))
    const final = Object.fromEntries(Object.entries(added).filter(([id]) => !rendering.has(id)))
    sizeless.current = withoutProperties(sizeless.current, Object.keys(final))
    if (Object.keys(final).length > 0) void writeLayout(projectId, { positions: final }).catch(() => null)
  }, [layoutReady, graph, projectId])

  // Registered once per load, so that a graph refetch neither re-registers the canvas nor reorders the registry.
  const drawnRef = useRef(graph?.nodes ?? [])
  drawnRef.current = graph?.nodes ?? []
  const loaded = layoutReady && graph !== null
  useEffect(() => {
    if (!loaded) return undefined
    return views.mount({
      projectId, session,
      cards: () => cardsOf(drawnRef.current, node => boxIn(positionsRef.current, node)),
      // An agent's move is drawn as a drop is, and a drag that waits to be saved no longer carries its nodes.
      place: (patch) => {
        const placed: Record<string, NodePosition> = {}
        for (const [id, spot] of Object.entries(patch)) {
          moved.current.delete(id)
          const box = positionsRef.current[id]
          if (box === undefined || unsavedSpots.current.has(id)) sizeless.current[id] = spot
          if (box !== undefined) placed[id] = { ...box, ...spot }
        }
        positionsRef.current = { ...positionsRef.current, ...placed }
        setPositions(all => ({ ...all, ...placed }))
      },
    })
  }, [loaded, projectId, session, views])

  const awaitedRender = useRef<AwaitedRender | null>(null)
  const [rerunning, setRerunning] = useState<{ record: string; action: string | null } | null>(null)
  const settleAwaited = (): void => {
    awaitedRender.current = null
    setRerunning(null)
  }
  useEffect(() => {
    const awaited = awaitedRender.current
    if (awaited === null || graph === null) return
    const node = graph.nodes.find(candidate =>
      candidate.claimed && candidate.record.based_on === awaited.basedOn && !awaited.known.has(candidate.id))
    if (node === undefined) return
    settleAwaited()
    setEditing(null)
    setSelected(node.id)
    centerOn(node)
    awaited.resolve()
  }, [graph, centerOn])

  // A project opened for the first time in this browser counts every record up to its newest as seen, so the finished
  // nodes of a node type that registers later show no unseen dot either.
  const seenNodes = seen?.project === projectId ? seen.seen : null
  useEffect(() => {
    if (graph === null) return
    if (seenNodes === null) {
      const since = graph.state.components.proj.records.map(settledAt).reduce((newest, at) => at > newest ? at : newest, '')
      const loaded = readSeen(projectId) ?? { since, ids: new Set<string>() }
      writeSeen(projectId, loaded)
      setSeen({ project: projectId, seen: loaded })
      return
    }
    const opened = editing === null ? undefined : graph.nodes.find(node => node.id === editing)
    if (opened === undefined || !isFinished(opened) || wasSeen(seenNodes, opened)) return
    const next = { since: seenNodes.since, ids: new Set(seenNodes.ids).add(opened.id) }
    writeSeen(projectId, next)
    setSeen({ project: projectId, seen: next })
  }, [graph, seenNodes, editing, projectId])

  const capture = (event: ReactPointerEvent): void => {
    try {
      container.current?.setPointerCapture(event.pointerId)
    } catch (error) {
      // A synthetic pointer without an active pointer ID cannot be captured; the gesture still works inside the canvas.
      void error
    }
  }
  const onBackgroundDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    gesture.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, origin: viewportRef.current, moved: false }
    capture(event)
  }
  const onNodeDown = (node: CanvasNode) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    const origin = boxOf(node)
    gesture.current = { kind: 'node', id: node.id, startX: event.clientX, startY: event.clientY, origin, at: origin, moved: false }
    capture(event)
  }
  // The handle stops the press before the card's `onNodeDown`, so a resize starts no move and opens no editor.
  const onResizeDown = (node: CanvasNode) => (corner: ResizeCorner, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const origin = boxOf(node)
    gesture.current = { kind: 'resize', node, corner, startX: event.clientX, startY: event.clientY, origin, at: origin, moved: false }
    capture(event)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = gesture.current
    if (current === null) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    if (!current.moved && current.kind === 'node') setTopNode(current.id)
    current.moved = true
    if (current.kind === 'pan') {
      autoFit.current = false
      setViewport({ ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy })
      return
    }
    const zoom = viewportRef.current.zoom
    if (current.kind === 'resize') {
      const at = resizedBox(current.node.sizing, current.origin, current.corner, dx / zoom, dy / zoom)
      current.at = at
      setPositions(all => ({ ...all, [current.node.id]: at }))
      return
    }
    const at = { ...current.origin, x: current.origin.x + dx / zoom, y: current.origin.y + dy / zoom }
    current.at = at
    setPositions(all => ({ ...all, [current.id]: at }))
  }
  const onPointerUp = (): void => {
    const current = gesture.current
    gesture.current = null
    if (current === null) return
    // A click on a node selects it; a second click on the same node soon after opens its editor.
    if (current.kind === 'node' && !current.moved) {
      setSelected(current.id)
      const previous = lastClick.current
      const at = Date.now()
      lastClick.current = { id: current.id, at }
      if (previous !== null && previous.id === current.id && at - previous.at <= DOUBLE_CLICK_MS) {
        lastClick.current = null
        setEditing(current.id)
      }
      return
    }
    // A click on empty canvas closes the floating editor, or clears the selection when no editor is open.
    if (current.kind === 'pan' && !current.moved) {
      if (editing === null) setSelected(null)
      else setEditing(null)
      return
    }
    // A press on a handle without movement changes nothing.
    if (current.kind === 'resize' && !current.moved) return
    if (current.kind === 'node' || current.kind === 'resize') {
      const id = current.kind === 'node' ? current.id : current.node.id
      moved.current.set(id, current.at)
      unsavedSpots.current.delete(id)
    }
    scheduleSave()
  }
  const zoomBy = (factor: number): void => {
    autoFit.current = false
    const size = sizeOf(container.current)
    const cx = size.width / 2
    const cy = size.height / 2
    setViewport((current) => {
      const zoom = clampZoom(current.zoom * factor)
      return { zoom, x: cx - (cx - current.x) / current.zoom * zoom, y: cy - (cy - current.y) / current.zoom * zoom }
    })
    scheduleSave()
  }
  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setNotice(null)
    try {
      await work()
    } catch (error) {
      setNotice(t('error', { message: errorMessage(error) }))
    }
  }
  const canvasRequest = (request: CanvasRequest): OperationRequest => ({
    ...request, project: projectId, surface: 'canvas', ...session === null ? {} : { session },
  })
  /**
   * Start a rerun of a record and wait for its new node, which the canvas reveals as soon as the project state shows it
   * because `runOperation` resolves only when the operation ends.
   * @param request - the request; its `based_on` is the record it runs again.
   * @param action - the node action that started the rerun, or null for a body.
   * @returns settles once the new node is revealed or once a later rerun replaces this one; rejects with the error of a
   *   request that fails before that.
   */
  const rerun = (request: RerunRequest, action: string | null): Promise<void> => new Promise((resolve, reject) => {
    const known = new Set(graphRef.current?.nodes.map(node => node.id))
    const awaited: AwaitedRender = { basedOn: request.based_on, known, resolve }
    awaitedRender.current?.resolve()
    awaitedRender.current = awaited
    setRerunning({ record: request.based_on, action })
    setNotice(null)
    client.runOperation(canvasRequest(request)).then(() => {
      if (awaitedRender.current !== awaited) return
      settleAwaited()
      setEditing(null)
      resolve()
    }, (error: unknown) => {
      const message = errorMessage(error)
      if (awaitedRender.current !== awaited) { setNotice(t('error', { message })); return }
      settleAwaited()
      reject(new Error(message))
    })
  })
  const accepts = (event: ReactDragEvent): boolean => event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE) || event.dataTransfer.types.includes('Files')
  // A drag the canvas accepts stops here, so the chat composer's document-level file listeners neither show their drop
  // overlay nor attach the dropped files.
  const onDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!accepts(event)) return
    event.preventDefault()
    event.stopPropagation()
  }
  const onDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!accepts(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  /**
   * Place a dropped 素材 tile's asset on the canvas with its node under the pointer, or import the dropped files, of any
   * media type, and place their nodes there.
   * @param event - the drop event.
   */
  const onDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    setDragOver(false)
    if (!accepts(event)) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const view = viewportRef.current
    const point = {
      x: (event.clientX - rect.left - view.x) / view.zoom,
      y: (event.clientY - rect.top - view.y) / view.zoom - DROP_OFFSET_Y,
    }
    setNotice(null)
    const assetId = event.dataTransfer.getData(DV_ASSET_DRAG_TYPE)
    if (assetId !== '') {
      const node = graph?.nodes.find(entry => entry.id === graph.assetNodes[assetId])
      if (node !== undefined) { placeNode(node, point); return }
      // Any other asset of the asset pool panel goes on the canvas, with its node under the pointer.
      pendingDrops.current.set(assetId, point)
      void run(() => changePlacement(assetId, true))
      return
    }
    Array.from(event.dataTransfer.files).forEach((file, index) => {
      const position = { x: point.x + index * 32, y: point.y + index * 32 }
      void run(async () => {
        // An import from the canvas also puts the asset on the canvas.
        const assetId = (await client.importAsset(projectId, file, 'canvas', session)).asset
        pendingDrops.current.set(assetId, position)
      })
    })
  }

  // The surface is the app background under a dot grid that pans and zooms with the nodes.
  const grid = GRID * viewport.zoom
  const root: CSSProperties = {
    position: 'relative', width: '100%', height: '100%', minHeight: 320, overflow: 'hidden', backgroundColor: 'var(--dv-bg)',
    color: 'var(--dv-text)', fontFamily: 'var(--dv-font-sans)', fontSize: 13, lineHeight: '20px',
    backgroundImage: 'radial-gradient(var(--dv-grid) 1px, transparent 1px)',
    backgroundSize: `${String(grid)}px ${String(grid)}px`, backgroundPosition: `${String(viewport.x)}px ${String(viewport.y)}px`,
    cursor: gesture.current?.kind === 'pan' ? 'grabbing' : 'default', touchAction: 'none',
    boxShadow: dragOver ? 'inset 0 0 0 2px var(--dv-accent)' : 'none',
  }
  const floating: CSSProperties = {
    background: 'var(--dv-surface-2)', boxShadow: '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-1)', zIndex: 5,
  }
  const toolButton: CSSProperties = {
    height: 28, minWidth: 28, border: 'none', borderRadius: 'var(--dv-radius-sm)', color: 'var(--dv-text-2)', padding: '0 6px', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12, lineHeight: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  const centered: CSSProperties = { position: 'absolute', inset: 0, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontSize: 14, lineHeight: '22px', color: 'var(--dv-text-2)' }
  const actionsFor = (view: NodeView): NodeAction[] => descriptors.actions.filter(action => action.shows(view, assetById))
    .toSorted((a, b) => a.order - b.order)
  const viewFor = (node: CanvasNode): NodeView => viewOf(
    node, seenNodes !== null && isFinished(node) && !wasSeen(seenNodes, node), node.record !== null && node.record.id === rerunning?.record,
  )
  let content: ReactNode = null
  if (graph === null) {
    content = <p style={centered}>{base.error !== null ? t('error', { message: base.error }) : t('loading')}</p>
  } else if (graph.nodes.length === 0) {
    content = <p style={{ ...centered, pointerEvents: 'none' }}>{t('canvas.empty')}</p>
  } else {
    // The selected node's edges are drawn last, so they stay on top of the others.
    const touchesSelected = (edge: CanvasEdge): boolean => selected !== null && (edge.from === selected || edge.to === selected)
    const links = [...graph.links.filter(link => !touchesSelected(link.edge)), ...graph.links.filter(link => touchesSelected(link.edge))]
    const textScale = textScaleAt(viewport.zoom)
    const anchorOf = (node: CanvasNode): number => edgeAnchorY(boxOf(node), textScale)
    const hosts = hostsOf(() => { setEditing(null) })
    content = (
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${String(viewport.x)}px, ${String(viewport.y)}px) scale(${String(viewport.zoom)})`, transformOrigin: '0 0' }}>
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }} aria-hidden="true">
          {links.map(({ edge, source: from, target: to }) => {
            const a = boxOf(from)
            const b = boxOf(to)
            const x1 = a.x + a.width
            const y1 = a.y + anchorOf(from)
            const x2 = b.x
            const y2 = b.y + anchorOf(to)
            const bend = Math.max(40, Math.abs(x2 - x1) / 2)
            const highlighted = touchesSelected(edge)
            return (
              <path
                key={`${edge.from}>${edge.to}`}
                d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`}
                fill="none"
                style={{ stroke: highlighted ? 'var(--dv-accent)' : from.nodeType.color, strokeOpacity: highlighted ? 0.9 : 0.6 }}
                strokeWidth={highlighted ? 2 : 1.5}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={edge.kind === 'lineage' ? '6 5' : undefined}
                data-edge={`${edge.from}>${edge.to}`}
              />
            )
          })}
        </svg>
        {[...graph.nodes.filter(node => node.id !== topNode), ...graph.nodes.filter(node => node.id === topNode)].map((node) => {
          const view = viewFor(node)
          const assets: Record<string, Asset> = {}
          for (const id of [...node.assets, previewOf(node) ?? '']) {
            const asset = assetById.get(id)
            if (asset !== undefined) assets[id] = asset
          }
          return (
            <NodeCard
              key={node.id}
              node={node}
              view={view}
              box={boxOf(node)}
              selected={node.id === selected}
              zoom={viewport.zoom}
              t={t}
              onPointerDown={onNodeDown(node)}
              onResizeDown={onResizeDown(node)}
              body={renderSlot('dv.canvas.card', { node: view, assets, textScale, host: hosts.card }, {
                entryKey: node.type, fallback: <TypeLabelBody label={node.nodeType.label()} textScale={textScale} />,
              })}
              failedActions={node.claimed && node.flags.failed ? actionsFor(view) : []}
              rerunningAction={view.rerunning ? rerunning?.action ?? null : null}
              onAction={(action) => { action.run(view, hosts.action(action.id)) }}
            />
          )
        })}
      </div>
    )
  }
  // The card lookup is scoped to this canvas because the center view and the tab body can both draw a node.
  const canvasId = useId()
  const nodeCard = (id: string): Element | null =>
    document.querySelector(`[data-dv-canvas="${canvasId}"] [data-node-id="${id.replace(/["\\]/g, '\\$&')}"]`)
  const editorZoom = useZoomPresence(editing, nodeCard)
  const editingNode = graph?.nodes.find(node => node.id === editorZoom.shown) ?? null
  const stackedNode = editingNode === null ? null : graph?.nodes.find(node => node.id === stacked) ?? null
  /**
   * The hosts of one surface, built only here: the host of its card bodies, the node host of each of its actions, and
   * the host of an editor body without the editor's picker.
   * @param close - closes the editor of the surface; on the canvas, the open editor.
   * @returns the hosts.
   */
  function hostsOf(close: () => void): SurfaceHosts {
    const services: Omit<NodeHost, 'rerun'> = {
      run: (request) => { void run(() => client.runOperation(canvasRequest(request))) },
      preview: (assetId, opener) => {
        const asset = assetById.get(assetId)
        if (asset !== undefined) preview(projectId, asset, opener)
      },
      openNode: setStacked,
      setPlaced: (assetId, on) => { void run(() => changePlacement(assetId, on)) },
      close,
    }
    const shown = (action: string | null): NodeHost['rerun'] => (request) => { void run(() => rerun(request, action)) }
    const editor: Omit<EditorHost, 'pickAssets'> = {
      ...services,
      rerun: request => rerun(request, null),
      importFiles: async (files) => {
        const imported: string[] = []
        await run(async () => {
          for (const file of files) imported.push((await client.importAsset(projectId, file, 'canvas', session)).asset)
        })
        return imported
      },
    }
    return { card: { run: services.run, rerun: shown(null) }, action: id => ({ ...services, rerun: shown(id) }), editor }
  }
  /** The props that the editor of the open node and the stacked editor share. */
  const sharedEditorProps = (node: CanvasNode, close: () => void) => {
    const view = viewFor(node)
    return {
      node, view, operations: operations.value ?? [], versionKinds: descriptors.versionKinds,
      actions: actionsFor(view), project: projectId, session, t, hosts: hostsOf(close), area, renderSlot, renderFactorySlot,
      onAcceptStale: (record: string) => { void run(() => client.acceptStale(projectId, record, 'canvas', session)) },
      onClose: close,
    }
  }
  return (
    <div
      ref={attachCanvas}
      style={root}
      data-testid="dv-canvas-view"
      data-dv-canvas={canvasId}
      aria-label={t('canvas.aria')}
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOver(false) }}
      onDrop={onDrop}
    >
      <style>{CANVAS_CSS}</style>
      {content}
      {notice !== null ? <p role="alert" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', margin: 0, padding: '6px 10px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-1)', border: '1px solid var(--dv-danger)', color: 'var(--dv-danger)', fontSize: 13, lineHeight: '20px', zIndex: 12 }}>{notice}</p> : null}
      <div role="toolbar" aria-label={t('canvas.zoom')} style={{ ...floating, position: 'absolute', left: 16, bottom: 16, display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 10 }} onPointerDown={(event) => { event.stopPropagation() }}>
        <button type="button" className="dv-canvas-btn" aria-label={t('canvas.zoomOut')} title={t('canvas.zoomOut')} style={toolButton} onClick={() => { zoomBy(1 / 1.2) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <span style={{ minWidth: 44, textAlign: 'center', fontFamily: 'var(--dv-font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>{`${String(Math.round(viewport.zoom * 100))}%`}</span>
        <button type="button" className="dv-canvas-btn" aria-label={t('canvas.zoomIn')} title={t('canvas.zoomIn')} style={toolButton} onClick={() => { zoomBy(1.2) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" className="dv-canvas-btn" style={{ ...toolButton, padding: '0 8px' }} onClick={() => { autoFit.current = true; fit(); scheduleSave() }}>{t('canvas.fit')}</button>
      </div>
      {editingNode !== null && graph !== null
        ? (
          <>
            <div ref={editorZoom.fadeRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'var(--dv-overlay)', zIndex: 9 }} />
            <NodeEditor
              key={editingNode.id} zoomRef={editorZoom.targetRef} state={graph.state}
              {...sharedEditorProps(editingNode, () => { setEditing(null) })}
            />
          </>
        )
        : null}
      {stackedNode !== null && graph !== null
        ? (
          // The stacked editor covers the canvas area; a press outside its panel closes it, not the editor beneath.
          <div style={{ position: 'absolute', inset: 0, zIndex: 11 }} onPointerDown={(event) => { event.stopPropagation(); setStacked(null) }}>
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'var(--dv-overlay)' }} />
            <NodeEditor key={`stacked:${stackedNode.id}`} zoomRef={noZoom} {...sharedEditorProps(stackedNode, () => { setStacked(null) })} state={graph.state} />
          </div>
        )
        : null}
    </div>
  )
}
