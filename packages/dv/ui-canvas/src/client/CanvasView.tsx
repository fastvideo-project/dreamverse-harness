/**
 * The project canvas as a standalone component: an infinite surface of asset and take nodes, and the entries of the node
 * types registered in `dvCanvas`, each drawn with the default card. Drag
 * empty space to pan, scroll to zoom around the cursor, drag a node to move it, click a node to select it and open its
 * editor panel, which grows out of the node and shrinks back into it on close (`@dv/ui-kit/zoom.ts`). Closing the
 * editor keeps the node selected (the accent ring); a click on empty canvas with no editor open
 * clears the selection. A scroll over an overlay marked `data-dv-scroll-island`, such as the editor panel, scrolls that
 * overlay. Node positions and the viewport are stored per project through `/api/dv/layout`; a project without a stored
 * viewport opens at 100%, or fitted when its nodes do not fit the view at 100%. A node without a stored position gets the
 * first free spot at or below its automatic position, and that spot is stored, so a node that appears later never moves
 * or covers another. A render started from the take editor or a failed take's 重试 closes the editor once the new take's
 * node appears, then centers and selects that node. A finished take that the user has not opened in this browser shows
 * an accent dot; the opened takes are kept per project in `localStorage`, and a project opened for the first time in a
 * browser starts with every finished take counted as opened. The canvas draws the project's current state and
 * follows every change of it; its writes go after the current position of the project's history. Colors come from the
 * `--dv-*` theme variables that `@dv/ui-shell` defines, so the canvas follows the app's light and dark themes. An image
 * or video that no take or entry node shows has a node only while it is on the project's canvas (the `asset`
 * slice's `placed`): dropping a 素材 tile on the canvas runs `asset.place` with its node under the pointer, dropping
 * image and video files imports them with `place`, and the asset node's "从画布移除" runs `asset.unplace`. Each of these
 * is a record, so History lists it and undo takes it back.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { DvClient } from '@dv/ui-kit/api.ts'
import { useLanguage } from '@dv/ui-kit/locale.ts'
import { formatInputRef } from '@dv/ui-kit/references.ts'
import type { DvCanvas, Registry } from '@dv/ui-kit/registries.ts'
import type { WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import type { Asset, CanvasViewport, NodePosition, OperationRequest, WireState } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { readStored, writeStored } from '@dv/ui-kit/storage.ts'
import { useOperations, useProjectState, useTaskLabels } from '@dv/ui-kit/useProject.ts'
import { useZoomPresence } from '@dv/ui-kit/zoom.ts'
import { createDvCanvas } from './dv-canvas.ts'
import { buildCanvasGraph, freePositions, NODE_WIDTH, ROW, slotFrames } from './graph.ts'
import type { CanvasEdge, CanvasNode } from './graph.ts'
import { NodeCard, nodeHeight, nodeTitle } from './NodeCard.tsx'
import type { CanvasTranslate, DrawMedia } from './NodeCard.tsx'
import { messageOf, NodeEditor } from './NodeEditor.tsx'
import type { EditorArea, RenderCanvasSlot } from './NodeEditor.tsx'
import { en, zh } from './locales.ts'
import type { DvCanvasKey } from './locales.ts'

/** Props of {@link CanvasView}. */
export interface CanvasViewProps {
  /** The project to draw. */
  projectId: string
  /** The API client; a same-origin client when omitted. */
  client?: DvClient
  /** The chat session the canvas sits beside, recorded as the `session` of the canvas's writes. */
  session?: string | null
  /** The `dvCanvas` translate; when omitted, the dictionary of the DSH interface language that `<html lang>` names. */
  t?: CanvasTranslate
  /** The `dvCanvas` registries that plugin UI halves fill for this view; without them, every take is a free take. */
  canvas?: DvCanvas
  /** Renders the canvas's slots in its editors: the `dv.canvas.editor` entry of an entry node, and the `dv.canvas.picker`
   *  entry of the asset pool; without it, an entry's editor shows only its header, and the asset picker offers only
   *  versioned items. */
  renderSlot?: RenderCanvasSlot
  /** Renders the `dv.canvas` assets through the `dv.media` Factory of `@dv/ui-media`; without it, no asset draws. */
  renderFactorySlot?: PropsRenderFactories['renderFactorySlot']
  /** Opens the asset preview of `dvMedia`, growing out of `opener`; without it, an asset opens no preview. */
  preview?: (asset: Asset, opener: Element | null) => void
  /** The record whose node to open once; none when null or omitted. */
  focus?: CanvasFocus | null
}

/** A request to open the node of a record, such as a History selection, until the canvas takes it. */
export interface CanvasFocus {
  record: string
  /** Mark the request as handled, so a remounted canvas does not open the node again. */
  take: () => void
}

/** The tallest a card grows (larger text at low zoom plus a badge row), used when fitting. */
const FIT_NODE_HEIGHT = ROW - 20
/** How far above the pointer a dropped node's top edge lands, in canvas units, so the pointer rests on its header. */
const DROP_OFFSET_Y = 40
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const DRAG_THRESHOLD = 4
const SAVE_DELAY_MS = 500
/** The zoom ref of a stacked editor, which opens and closes without the zoom transition. */
const noZoom = (element: HTMLElement | null): void => { void element }
/** The task labels while `GET /api/dv/tasks` loads or after it failed: every task shows its name. */
const NO_TASK_LABELS: WireTaskLabels = {}

/** Edge stroke per kind: the type color of the node the edge leaves (a reference leaves an entry or an asset). */
const EDGE_COLOR: Record<CanvasEdge['kind'], string> = {
  reference: 'var(--dv-kind-character)', first_frame: 'var(--dv-kind-take)', chain: 'var(--dv-kind-plan)', take: 'var(--dv-kind-take)',
}
/** The registries of a view mounted without `dvCanvas`: empty, so every take is a free take. */
const NO_CANVAS = createDvCanvas()

/**
 * @param registry - a registry.
 * @returns its descriptors, read again on each change.
 */
function useRegistry<D>(registry: Registry<D>): readonly D[] {
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry])
  return useSyncExternalStore(subscribe, () => registry.list())
}
/** Canvas dot grid pitch at 100%, in canvas units. */
const GRID = 20

// Hover and focus states, which inline styles cannot express; scoped to the canvas by class name.
const CANVAS_CSS = `
.dv-canvas-btn { background: transparent; transition: background-color 120ms var(--dv-ease); }
.dv-canvas-btn:hover:not(:disabled) { background: var(--dv-surface-3); }
.dv-canvas-btn:focus-visible, .dv-canvas-soft:focus-visible, [data-node-id]:focus-visible { outline: 2px solid var(--dv-accent); outline-offset: 2px; }
.dv-canvas-soft { background: var(--dv-accent-soft); color: var(--dv-accent-text); }
@media (prefers-reduced-motion: reduce) { .dv-canvas-btn { transition: none; } }
`

/**
 * A translate over one `dvCanvas` dictionary, for hosts that mount the canvas without a locale binding. The canvas asks
 * only for keys of its own namespace, which each dictionary holds, and never for a key of the common vocabulary.
 * @param dictionary - the Chinese or English dictionary.
 * @returns the translate.
 */
function dictionaryTranslate(dictionary: Record<DvCanvasKey, string>): CanvasTranslate {
  return (key, params) => {
    let text = dictionary[key as DvCanvasKey]
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }
}
const translates = { zh: dictionaryTranslate(zh), en: dictionaryTranslate(en) }

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

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

/** The `localStorage` key prefix of a project's opened takes, a JSON array of take node IDs. */
const SEEN_KEY = 'dv-canvas-seen:'

/**
 * @param node - a node.
 * @returns whether the node is a take whose render finished with an image or a video.
 */
function isFinishedTake(node: CanvasNode): boolean {
  return node.type === 'take' && !node.flags.rendering && (node.video !== null || node.thumb !== null)
}

/**
 * @param projectId - the project.
 * @returns the take node IDs opened in this browser, or null when the project has none stored.
 */
function readSeen(projectId: string): Set<string> | null {
  const raw = readStored('local', SEEN_KEY + projectId)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch (error) {
    // Malformed JSON counts as none stored.
    void error
    return null
  }
}

/**
 * @param projectId - the project.
 * @param ids - the take node IDs opened in this browser.
 */
function writeSeen(projectId: string, ids: ReadonlySet<string>): void {
  writeStored('local', SEEN_KEY + projectId, JSON.stringify([...ids]))
}

/** A render whose new take the canvas waits for: the take it is based on and every node drawn before the request. */
interface AwaitedRender {
  basedOn: string
  known: ReadonlySet<string>
  resolve: () => void
}

/** An in-progress pointer gesture. */
type Gesture =
  | { kind: 'pan'; startX: number; startY: number; origin: CanvasViewport; moved: boolean }
  | { kind: 'node'; id: string; startX: number; startY: number; origin: NodePosition; moved: boolean }

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
 * The canvas.
 * @param props - the project, chat session, and optional client, translate, registries, editor slot, media renderer,
 *   preview and focus.
 * @returns the element.
 */
export function CanvasView(
  {
    projectId, client: given, session = null, t: givenT, canvas = NO_CANVAS, renderSlot, renderFactorySlot, preview, focus,
  }: CanvasViewProps,
): ReactNode {
  const client = useMemo(() => given ?? new DvClient(), [given])
  const language = useLanguage()
  const t = givenT ?? translates[language]
  const base = useProjectState(client, projectId)
  const operations = useOperations(client)
  const taskLabels = useTaskLabels(client)
  const anchors = useRegistry(canvas.chainAnchors)
  const inUse = useRegistry(canvas.takesInUse)
  const nodeTypes = useRegistry(canvas.nodeTypes)
  const versionKinds = useRegistry(canvas.versionKinds)
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
    return {
      state: base.value, ...buildCanvasGraph(base.value, placed, operations.value ?? [], language, anchors, inUse, nodeTypes, versionKinds),
    }
  }, [base.value, placed, projectId, operations.value, language, anchors, inUse, nodeTypes, versionKinds])
  // The frame grid of each entry with slots. Memoized on the graph, because a pan or zoom re-renders the view on every
  // pointer move.
  const grids = useMemo(() => new Map(graph === null ? [] : graph.nodes.flatMap(node => node.type === 'entry' && node.entry.slots !== undefined
    ? [[node.id, { frames: slotFrames(graph.nodes, node.id, node.entry.slots) }] as const]
    : [])), [graph])

  const [positions, setPositions] = useState<Record<string, NodePosition>>({})
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 40, y: 40, zoom: 1 })
  const [layoutReady, setLayoutReady] = useState(false)
  // The node with the accent ring, and the node whose editor is open; closing the editor keeps the ring.
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // The editor a reference chip opened over the `editing` one; it closes first, and with the editor beneath it.
  const [stacked, setStacked] = useState<string | null>(null)
  useEffect(() => { setStacked(null) }, [editing])
  // The take node IDs opened in this browser, for the project they belong to; null until the graph first loads.
  const [seen, setSeen] = useState<{ project: string; ids: ReadonlySet<string> } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const moved = useRef(new Set<string>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const needsFit = useRef(false)
  // True while the viewport is an automatic fit; resizing the canvas refits until the user pans or zooms.
  const autoFit = useRef(false)
  // Imported or dropped assets waiting for their node to appear, with the canvas point they were dropped at.
  const pendingDrops = useRef(new Map<string, NodePosition>())
  const [dragOver, setDragOver] = useState(false)
  // The node the user last dragged or dropped is drawn above the others.
  const [topNode, setTopNode] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLayoutReady(false)
    // A canvas without stored positions still works with the automatic layout, so a failed read counts as empty.
    void client.getLayout(projectId).catch(() => ({ positions: {}, viewport: null })).then((layout) => {
      if (!live) return
      setPositions(layout.positions)
      if (layout.viewport !== null) setViewport(layout.viewport)
      needsFit.current = layout.viewport === null
      setLayoutReady(true)
    })
    return () => {
      live = false
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    }
  }, [client, projectId])

  /** Store the moved positions and the viewport after the gesture settles. */
  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const patch: Record<string, NodePosition> = {}
      for (const id of moved.current) {
        const position = positionsRef.current[id]
        if (position !== undefined) patch[id] = position
      }
      moved.current.clear()
      // The next save carries the viewport again; lost positions fall back to the automatic layout.
      void client.updateLayout(projectId, { positions: patch, viewport: viewportRef.current }).catch(() => null)
    }, SAVE_DELAY_MS)
  }, [client, projectId])

  const positionOf = useCallback((node: CanvasNode): NodePosition => positions[node.id] ?? { x: node.x, y: node.y }, [positions])

  /** Pan and zoom so every node is visible, at 100% at most: content that fits the view keeps its true size. */
  const fit = useCallback(() => {
    const element = container.current
    if (graph === null || graph.nodes.length === 0 || element === null) return
    const rect = element.getBoundingClientRect()
    const width = rect.width || 800
    const height = rect.height || 600
    const points = graph.nodes.map(positionOf)
    const minX = Math.min(...points.map(point => point.x))
    const minY = Math.min(...points.map(point => point.y))
    const spanX = Math.max(...points.map(point => point.x)) + NODE_WIDTH - minX
    const spanY = Math.max(...points.map(point => point.y)) + FIT_NODE_HEIGHT - minY
    const zoom = clampZoom(Math.min((width - 80) / spanX, (height - 80) / spanY, 1))
    setViewport({ x: (width - spanX * zoom) / 2 - minX * zoom, y: (height - spanY * zoom) / 2 - minY * zoom, zoom })
  }, [graph, positionOf])

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
  // The canvas area that the editor panels sit in, measured as the canvas element's client size.
  const [area, setArea] = useState<EditorArea>({ width: 0, height: 0 })
  const detachCanvas = useRef<(() => void) | null>(null)
  /**
   * Attach the canvas element's native listeners when React mounts it, and detach them when React unmounts it: a size
   * observer that measures the editor area and keeps an automatic fit, and a wheel listener that zooms around the cursor,
   * registered natively because React's wheel listener is passive.
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
    const rect = container.current?.getBoundingClientRect()
    const position = positionsRef.current[node.id] ?? { x: node.x, y: node.y }
    autoFit.current = false
    setViewport(current => ({
      ...current,
      x: (rect?.width || 800) / 2 - (position.x + NODE_WIDTH / 2) * current.zoom,
      y: (rect?.height || 600) / 2 - (position.y + nodeHeight(node) / 2) * current.zoom,
    }))
  }, [])

  // Open and center the node of the focused record once the layout and the graph are loaded.
  useEffect(() => {
    if (focus === undefined || focus === null || !layoutReady || graph === null) return
    // The record's own node, else the entry node whose version it wrote, else the node of its first output.
    const recordId = focus.record
    const firstOutput = graph.state.components.proj.records.find(record => record.id === recordId)?.outputs[0]
    const outputNode = firstOutput === undefined ? undefined : graph.assetNodes[firstOutput]
    const node = graph.nodes.find(candidate => candidate.id === recordId)
      ?? graph.nodes.find(candidate => candidate.record?.id === recordId)
      ?? graph.nodes.find(candidate => candidate.type === 'entry' && candidate.entry.records?.includes(recordId) === true)
      ?? graph.nodes.find(candidate => candidate.id === outputNode)
    focus.take()
    if (node === undefined) return
    centerOn(node)
    setSelected(node.id)
    setEditing(node.id)
  }, [focus, layoutReady, graph, centerOn])

  /** Move a node to a canvas point and store the position. */
  const placeNode = useCallback((id: string, position: NodePosition) => {
    setPositions(all => ({ ...all, [id]: position }))
    setTopNode(id)
    moved.current.add(id)
    scheduleSave()
  }, [scheduleSave])

  // Place dropped assets whose nodes have appeared.
  const graphRef = useRef(graph)
  graphRef.current = graph
  const placePending = useCallback(() => {
    const current = graphRef.current
    if (current === null) return
    for (const [assetId, position] of pendingDrops.current) {
      const id = current.assetNodes[assetId]
      if (id === undefined) continue
      pendingDrops.current.delete(assetId)
      placeNode(id, position)
    }
  }, [placeNode])
  useEffect(() => { placePending() }, [graph, placePending])

  // Store a free spot for every node without a stored position. The ref is updated at once so that the reveal of a new
  // take below centers on the stored spot; an earlier queued position, such as a dropped asset's, wins over the free spot.
  useEffect(() => {
    if (!layoutReady || graph === null) return
    const added = freePositions(graph.nodes, positionsRef.current, node => nodeHeight(node, true))
    if (Object.keys(added).length === 0) return
    positionsRef.current = { ...added, ...positionsRef.current }
    setPositions(all => ({ ...added, ...all }))
    void client.updateLayout(projectId, { positions: added }).catch(() => null)
  }, [layoutReady, graph, client, projectId])

  // Reveal the take a render started: close the editor, center the new node, and select it.
  const awaitedRender = useRef<AwaitedRender | null>(null)
  // The failed take whose 重试 started the awaited render; its button reads 渲染中… until the render is settled.
  const [retryingFrom, setRetryingFrom] = useState<string | null>(null)
  const settleAwaited = (): void => {
    awaitedRender.current = null
    setRetryingFrom(null)
  }
  useEffect(() => {
    const awaited = awaitedRender.current
    if (awaited === null || graph === null) return
    const node = graph.nodes.find(candidate => candidate.type === 'take' && candidate.record?.based_on === awaited.basedOn && !awaited.known.has(candidate.id))
    if (node === undefined) return
    settleAwaited()
    setEditing(null)
    setSelected(node.id)
    centerOn(node)
    awaited.resolve()
  }, [graph, centerOn])

  // Load the opened takes once the graph is there, and count the take an editor opens as opened.
  const seenIds = seen?.project === projectId ? seen.ids : null
  useEffect(() => {
    if (graph === null) return
    if (seenIds === null) {
      const ids = readSeen(projectId) ?? new Set(graph.nodes.filter(isFinishedTake).map(node => node.id))
      writeSeen(projectId, ids)
      setSeen({ project: projectId, ids })
      return
    }
    const opened = editing === null ? undefined : graph.nodes.find(node => node.id === editing)
    if (opened === undefined || !isFinishedTake(opened) || seenIds.has(opened.id)) return
    const ids = new Set(seenIds).add(opened.id)
    writeSeen(projectId, ids)
    setSeen({ project: projectId, ids })
  }, [graph, seenIds, editing, projectId])

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
    gesture.current = { kind: 'node', id: node.id, startX: event.clientX, startY: event.clientY, origin: positionOf(node), moved: false }
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
    setPositions(all => ({ ...all, [current.id]: { x: current.origin.x + dx / zoom, y: current.origin.y + dy / zoom } }))
  }
  const onPointerUp = (): void => {
    const current = gesture.current
    gesture.current = null
    if (current === null) return
    if (current.kind === 'node' && !current.moved) {
      setSelected(current.id)
      setEditing(current.id)
      return
    }
    // A click on empty canvas closes the floating editor, or clears the selection when no editor is open.
    if (current.kind === 'pan' && !current.moved) {
      if (editing === null) setSelected(null)
      else setEditing(null)
      return
    }
    if (current.kind === 'node') moved.current.add(current.id)
    scheduleSave()
  }
  const zoomBy = (factor: number): void => {
    autoFit.current = false
    const element = container.current
    const rect = element?.getBoundingClientRect()
    const cx = (rect?.width || 800) / 2
    const cy = (rect?.height || 600) / 2
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
      setNotice(t('error', { message: messageOf(error) }))
    }
  }
  /**
   * Start a render of a new take and wait for its node. The request itself returns when the render ends, so the canvas
   * reveals the new take as soon as the project state shows its node. When the request returns first, as for a take that
   * the canvas does not draw, the editor closes then.
   * @param request - the render request; its `based_on` is the take it renders again.
   * @returns settles once the new take is revealed; rejects with the error of a request that fails before that.
   */
  const startRender = (request: OperationRequest & { based_on: string }): Promise<void> => new Promise((resolve, reject) => {
    const known = new Set(graphRef.current?.nodes.map(node => node.id))
    const awaited: AwaitedRender = { basedOn: request.based_on, known, resolve }
    awaitedRender.current = awaited
    setNotice(null)
    client.runOperation(request).then(() => {
      if (awaitedRender.current !== awaited) return
      settleAwaited()
      setEditing(null)
      resolve()
    }, (error: unknown) => {
      const message = messageOf(error)
      if (awaitedRender.current !== awaited) { setNotice(t('error', { message })); return }
      settleAwaited()
      reject(new Error(message))
    })
  })
  /**
   * Render a failed take again: its own operation, inputs, and params, as a new take based on it. This is the request
   * the take editor's 渲染新版本 sends when nothing was edited.
   * @param node - the failed take's node.
   */
  const retryTake = (node: CanvasNode): void => {
    const record = node.record
    const operation = record?.operation ?? null
    if (record === null || operation === null) return
    setRetryingFrom(record.id)
    startRender({
      project: projectId, operation, inputs: record.inputs.map(input => ({ role: input.role, ref: formatInputRef(input.ref) })),
      params: record.params, surface: 'canvas', intent: t('intent.retryTake', { title: nodeTitle(node, t) }), based_on: record.id,
      ...session === null ? {} : { session },
    }).catch((error: unknown) => { setNotice(t('error', { message: messageOf(error) })) })
  }
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
   * Place a dropped 素材 tile's asset on the canvas with its node under the pointer, or import dropped image and video
   * files and place their nodes there.
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
      x: (event.clientX - rect.left - view.x) / view.zoom - NODE_WIDTH / 2,
      y: (event.clientY - rect.top - view.y) / view.zoom - DROP_OFFSET_Y,
    }
    setNotice(null)
    const assetId = event.dataTransfer.getData(DV_ASSET_DRAG_TYPE)
    if (assetId !== '') {
      const id = graph?.assetNodes[assetId]
      if (id !== undefined) { placeNode(id, point); return }
      // Any other asset of the asset pool panel goes on the canvas, with its node under the pointer.
      pendingDrops.current.set(assetId, point)
      void run(() => changePlacement(assetId, true))
      return
    }
    Array.from(event.dataTransfer.files).forEach((file, index) => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { setNotice(t('drop.notMedia', { name: file.name })); return }
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
  let content: ReactNode = null
  if (graph === null) {
    content = <p style={centered}>{base.error !== null ? t('error', { message: base.error }) : t('loading')}</p>
  } else if (graph.nodes.length === 0) {
    content = <p style={{ ...centered, pointerEvents: 'none' }}>{t('canvas.empty')}</p>
  } else {
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    const assets = new Map(graph.state.assets.map(asset => [asset.id, asset]))
    const drawMedia: DrawMedia = (assetId, purpose) => {
      const asset = assets.get(assetId ?? '')
      return asset === undefined || renderFactorySlot === undefined ? null : renderFactorySlot('dv.media', { asset, purpose })
    }
    const heightOf = (node: CanvasNode): number => nodeHeight(node, grids.get(node.id)?.frames.some(frame => frame !== null) === true)
    // The selected node's edges are drawn last, so they stay on top of the others.
    const touchesSelected = (edge: CanvasEdge): boolean => selected !== null && (edge.from === selected || edge.to === selected)
    const edges = [...graph.edges.filter(edge => !touchesSelected(edge)), ...graph.edges.filter(touchesSelected)]
    content = (
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${String(viewport.x)}px, ${String(viewport.y)}px) scale(${String(viewport.zoom)})`, transformOrigin: '0 0' }}>
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }} aria-hidden="true">
          {edges.map((edge) => {
            // `buildCanvasGraph` draws an edge only between two of its nodes.
            const from = byId.get(edge.from) as CanvasNode
            const to = byId.get(edge.to) as CanvasNode
            const a = positionOf(from)
            const b = positionOf(to)
            const x1 = a.x + NODE_WIDTH
            const y1 = a.y + heightOf(from) / 2
            const x2 = b.x
            const y2 = b.y + heightOf(to) / 2
            const bend = Math.max(40, Math.abs(x2 - x1) / 2)
            const highlighted = touchesSelected(edge)
            return (
              <path
                key={`${edge.from}>${edge.to}`}
                d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`}
                fill="none"
                style={{ stroke: highlighted ? 'var(--dv-accent)' : EDGE_COLOR[edge.kind], strokeOpacity: highlighted ? 0.9 : 0.6 }}
                strokeWidth={highlighted ? 2 : 1.5}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={edge.kind === 'take' ? '6 5' : undefined}
                data-edge={`${edge.from}>${edge.to}`}
              />
            )
          })}
        </svg>
        {[...graph.nodes.filter(node => node.id !== topNode), ...graph.nodes.filter(node => node.id === topNode)].map((node) => {
          const position = positionOf(node)
          const grid = grids.get(node.id)
          return (
            <NodeCard
              key={node.id}
              node={node}
              x={position.x}
              y={position.y}
              selected={node.id === selected}
              zoom={viewport.zoom}
              t={t}
              onPointerDown={onNodeDown(node)}
              {...grid === undefined ? {} : { frames: grid.frames }}
              {...node.type === 'take' && node.flags.failed ? { onRetry: () => { retryTake(node) }, retrying: retryingFrom === node.id } : {}}
              unseen={seenIds !== null && isFinishedTake(node) && !seenIds.has(node.id)}
              drawMedia={drawMedia}
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
  const removeFromCanvas = (assetId: string): void => {
    setEditing(null)
    setSelected(null)
    void run(() => changePlacement(assetId, false))
  }
  /** The props that the editor of the open node and the stacked editor share. */
  const sharedEditorProps = (state: WireState) => ({
    state,
    operations: operations.value ?? [],
    taskLabels: taskLabels.value ?? NO_TASK_LABELS,
    versionKinds,
    client,
    project: projectId,
    session,
    t,
    ...renderSlot === undefined ? {} : { renderSlot },
    ...renderFactorySlot === undefined ? {} : { renderFactorySlot },
    ...preview === undefined ? {} : { preview },
    run,
    onRender: startRender,
    onRemoveFromCanvas: removeFromCanvas,
    onOpenNode: setStacked,
    area,
  })
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
      {notice !== null ? <p role="alert" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', margin: 0, padding: '6px 10px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-1)', border: '1px solid var(--dv-danger)', color: 'var(--dv-danger)', fontSize: 13, lineHeight: '20px', zIndex: 6 }}>{notice}</p> : null}
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
              key={editingNode.id}
              node={editingNode}
              zoomRef={editorZoom.targetRef}
              {...sharedEditorProps(graph.state)}
              onClose={() => { setEditing(null) }}
            />
          </>
        )
        : null}
      {stackedNode !== null && graph !== null
        ? (
          // The stacked editor covers the canvas area; a press outside its panel closes it, not the editor beneath.
          <div style={{ position: 'absolute', inset: 0, zIndex: 11 }} onPointerDown={(event) => { event.stopPropagation(); setStacked(null) }}>
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'var(--dv-overlay)' }} />
            <NodeEditor
              key={`stacked:${stackedNode.id}`}
              node={stackedNode}
              zoomRef={noZoom}
              {...sharedEditorProps(graph.state)}
              onClose={() => { setStacked(null) }}
            />
          </div>
        )
        : null}
    </div>
  )
}
