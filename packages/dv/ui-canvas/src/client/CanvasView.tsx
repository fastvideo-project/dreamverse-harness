/**
 * The project canvas: a pan-and-zoom surface that draws the nodes of the registered node types in the canvas chrome (a
 * caption above a frame) around each type's `dv.canvas.card` body; a click selects a node, and a double click opens its
 * editor panel, which grows out of the node and shrinks back into it (`@dv/ui-kit/zoom.ts`). Every node sits at the
 * position of the canvas's node list, with its type's default size where the stored size is null. The end of a drag or
 * of a resize from a resize handle of the selected node writes one `canvas.node_position` record, so undo reverts it;
 * the canvas draws the new box at once and drops it again when the write is refused. A node's right-click menu, the
 * trash button of its editor, and Delete or Backspace on the selected node remove it from the canvas with one
 * `canvas.node_remove` record after the user confirms. F2 on the selected node, its menu's Rename item, or a click on
 * the editor's title renames the node with one `canvas.node_rename` record, drawn at once the same way; a node whose
 * type has `rename` writes that type's request instead, which renames the item the node shows. A double click
 * on a node whose type has `open` runs it instead of opening the editor, and while a node whose entry declares `uses`
 * is selected, the nodes it uses wear an accent outline with a glow and the other nodes and edges fade. The toolbar's
 * add button opens the menu of the registered `AddMenuSection`s, whose picked item selects the node that shows it or
 * writes the item's request and selects the new node. The viewport is view state, stored per project through
 * `/api/dv/canvas/layout`. The opened versions are kept per project in `localStorage` for the unseen dot. Colors come
 * from the `--dv-*` theme variables that `@dv/ui-shell` defines and from each type's `color`. The canvas names no node
 * type.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { errorMessage } from '@dv/ui-kit/api.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import type { InlineRenameProps } from '@dv/ui-kit/InlineRename.tsx'
import { useLanguage } from '@dv/ui-kit/locale.ts'
import type { Asset, OperationRequest, ProjectRecord } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { readStored, writeStored } from '@dv/ui-kit/storage.ts'
import { useOperations, useProjectState } from '@dv/ui-kit/useProject.ts'
import { useZoomPresence } from '@dv/ui-kit/zoom.ts'
import type { CanvasViewport, NodePosition, NodeSpot } from '../canvas-layout.ts'
import { AddMenu } from './AddMenu.tsx'
import { cardsOf } from './agent-canvas.ts'
import type { CanvasViews } from './agent-canvas.ts'
import type { AddMenuItem, AddMenuSection, CanvasRequest, EditorHost, NodeAction, NodeHost, NodeView, RerunRequest } from './contract/index.ts'
import { boxOf as storedBox, buildCanvasGraph, isFinished, nodeTitle, previewOf, withNames } from './graph.ts'
import type { CanvasEdge, CanvasNode, CanvasRegistrations } from './graph.ts'
import { cardHeight, DIMMED_OPACITY, edgeAnchorY, NodeCard, NodeMenu, textScaleAt, TypeLabelBody } from './NodeCard.tsx'
import type { CanvasTranslate, NodeMenuItem } from './NodeCard.tsx'
import { readLayout, writeLayout } from './layout-client.ts'
import { NodeEditor } from './NodeEditor.tsx'
import type { EditorArea, RenderCanvasSlot, SurfaceHosts } from './NodeEditor.tsx'
import { resizedBox } from './resize.ts'
import type { ResizeHandle } from './resize.ts'

/** The registered descriptors that the canvas draws with. */
export interface CanvasDescriptors extends CanvasRegistrations {
  actions: readonly NodeAction[]
  addMenu: readonly AddMenuSection[]
}

/** Props of {@link CanvasView}. */
export interface CanvasViewProps extends PropsRenderFactories {
  /** The project to draw. */
  projectId: string
  client: DvClient
  /** The registry in which the canvas, while loaded, answers the canvas tools' reads. */
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
  /** A node ID, a version of a node, or a record whose first output a node shows. */
  record: string
  /** Mark the request as handled, so a remounted canvas does not open the node again. */
  take: () => void
}

/** The tallest a card grows (larger text at low zoom plus a badge row), used when fitting. */
const FIT_NODE_HEIGHT = 180
/** How far above the pointer a dropped node's top edge lands, in canvas units, so the pointer rests on its caption. */
const DROP_OFFSET_Y = 40
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const DRAG_THRESHOLD = 4
/** The longest pause between two clicks on one node that opens its editor, in ms. */
const DOUBLE_CLICK_MS = 400
const SAVE_DELAY_MS = 500
/** The operation that moves or resizes a node of the canvas's node list. */
const NODE_POSITION = 'canvas.node_position'
/** The operation that removes nodes from the canvas's node list. */
const NODE_REMOVE = 'canvas.node_remove'
/** The operation that names a node, and the longest name it takes, in characters. */
const NODE_RENAME = 'canvas.node_rename'
const NAME_MAX = 80
/** The zoom below which F2 renames a node in its editor, because the caption is too small to type in. */
const CAPTION_RENAME_ZOOM = 0.5
/** The zoom ref of a stacked editor, which opens and closes without the zoom transition. */
const noZoom = (element: HTMLElement | null): void => { void element }
/** Canvas dot grid pitch at 100%, in canvas units. */
const GRID = 20

// Hover and focus states, which inline styles cannot express; scoped to the canvas by class name. A focused node
// outlines its frame alone, so the outline matches the frame's selection ring instead of also wrapping the caption.
const CANVAS_CSS = `
.dv-canvas-btn { background: transparent; transition: background-color 120ms var(--dv-ease); }
@media (hover: hover) { .dv-canvas-btn:hover:not(:disabled) { background: var(--dv-surface-3); } }
.dv-canvas-btn:focus-visible, .dv-canvas-soft:focus-visible, [data-node-id]:focus-visible > [data-node-frame] { outline: 2px solid var(--dv-accent); outline-offset: 2px; }
[data-node-id]:focus-visible { outline: none; }
.dv-canvas-title { background: transparent; transition: background-color 120ms var(--dv-ease); }
.dv-canvas-title:focus-visible { background: var(--dv-surface-3); }
@media (hover: hover) { .dv-canvas-title:hover { background: var(--dv-surface-3); } }
.dv-canvas-title:focus-visible { outline: 2px solid var(--dv-accent); outline-offset: 2px; }
.dv-canvas-title > svg { opacity: 0; }
.dv-canvas-title:focus-visible > svg { opacity: 1; }
@media (hover: hover) { .dv-canvas-title:hover > svg { opacity: 1; } }
@media (hover: none) { .dv-canvas-title > svg { opacity: 1; } }
.dv-canvas-soft { background: var(--dv-accent-soft); color: var(--dv-accent-text); }
.dv-canvas-danger { color: var(--dv-text-2); }
@media (hover: hover) { .dv-canvas-danger:hover:not(:disabled) { color: var(--dv-danger); } }
@media (prefers-reduced-motion: reduce) { .dv-canvas-btn, .dv-canvas-title { transition: none; } }
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
 * The `localStorage` key prefix of a project's opened versions: JSON `{ since, ids }`, where `since` is the newest finish
 * (else creation) time of a record when the project was first opened in this browser and `ids` are the record IDs of the
 * versions opened since.
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
  return seen.ids.has(node.record.id) || settledAt(node.record) <= seen.since
}

function settledAt(record: ProjectRecord): string {
  return record.finished_at ?? record.created_at
}

/** A rerun whose new version the canvas waits for: the node, its versions before the request, and the settling. */
interface AwaitedRender {
  node: string
  known: ReadonlySet<string>
  resolve: () => void
}

/** Where a node's name field shows: in its caption on the canvas, or in the title of its open editor. */
interface Renaming {
  node: string
  place: 'caption' | 'editor'
}

/**
 * The controls inside a card body whose presses the body handles: native controls, sliders, menus and dialogs, and an
 * element marked `data-node-interactive` with everything inside it.
 */
const CARD_CONTROLS = 'button, input, select, textarea, a[href], [role="slider"], [role="menu"], [role="dialog"], [data-node-interactive]'

/** Whether a press lands on a control that a card body owns ({@link CARD_CONTROLS}). */
function inInteractive(target: EventTarget): boolean {
  return target instanceof Element && target.closest(CARD_CONTROLS) !== null
}

/** Whether a key comes from inside a card body that takes its own keys (`data-node-keys`). */
function inCardKeys(target: EventTarget): boolean {
  return target instanceof Element && target.closest('[data-node-keys]') !== null
}

/** Whether a key event comes from a field that takes text, where F2 belongs to the field. */
function inTextField(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/** An in-progress pointer gesture. A resize drags one corner or edge of the selected node ({@link resizedBox}). */
type Gesture =
  | { kind: 'pan'; startX: number; startY: number; origin: CanvasViewport; moved: boolean }
  | { kind: 'node'; id: string; startX: number; startY: number; origin: NodePosition; at: NodePosition; moved: boolean }
  | { kind: 'resize'; node: CanvasNode; handle: ResizeHandle; startX: number; startY: number; origin: NodePosition; at: NodePosition; moved: boolean }

/**
 * @param boxes - the boxes of the gestures and writes in flight, by node ID.
 * @param node - a node.
 * @returns its box in flight, else its stored box.
 */
const boxIn = (boxes: Readonly<Record<string, NodePosition>>, node: CanvasNode): NodePosition => boxes[node.id] ?? storedBox(node)

/**
 * @param record - boxes or any other record keyed by node ID.
 * @param keys - the keys to drop.
 * @returns a copy of the record without those keys.
 */
function withoutProperties<V>(record: Readonly<Record<string, V>>, keys: readonly string[]): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}

function viewOf(node: CanvasNode, unseen: boolean, rerunning: boolean): NodeView {
  const { nodeType: _nodeType, node: _node, ...entry } = node
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
  // The operation declarations, none until they load.
  const declared = useMemo(() => operations.value ?? [], [operations.value])
  /**
   * Put an asset on the project's canvas through an `asset.place` record.
   * @param assetId - the asset.
   * @returns settles when the record is written.
   */
  const placeAsset = (assetId: string): Promise<unknown> => client.placeOnCanvas(projectId, [assetId], session)
  // The names of `canvas.node_rename` writes until the project state shows them, by node ID; null clears a name.
  const [names, setNames] = useState<Record<string, string | null>>({})
  const namesRef = useRef(names)
  namesRef.current = names
  const baseRef = useRef(base.value)
  baseRef.current = base.value
  // The previous project's state stays loaded until the next project's arrives; the canvas draws only this project's.
  const graph = useMemo(() => {
    if (base.value === null || base.value.project.id !== projectId) return null
    const state = Object.keys(names).length === 0 ? base.value : withNames(base.value, names)
    return { state, ...buildCanvasGraph(state, declared, language, descriptors) }
  }, [base.value, names, projectId, declared, language, descriptors])
  const assetById = useMemo(() => new Map<string, Asset>((graph?.state.assets ?? []).map(asset => [asset.id, asset])), [graph])

  // The boxes of a gesture and of a `canvas.node_position` write until the project state shows them, by node ID.
  const [positions, setPositions] = useState<Record<string, NodePosition>>({})
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 40, y: 40, zoom: 1 })
  const [layoutReady, setLayoutReady] = useState(false)
  // The node with the accent ring, and the node whose editor is open; closing the editor keeps the ring.
  const [selected, setSelected] = useState<string | null>(null)
  // The element above the selected node's caption, which its card body may render into.
  const [above, setAbove] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  // The editor a reference chip opened over the `editing` one; it closes first, and with the editor beneath it.
  const [stacked, setStacked] = useState<string | null>(null)
  useEffect(() => { setStacked(null) }, [editing])
  // A name field in an editor closes with that editor.
  useEffect(() => {
    setRenaming(current => current?.place !== 'editor' || current.node === editing || current.node === stacked ? current : null)
  }, [editing, stacked])
  const [seen, setSeen] = useState<{ project: string; seen: Seen } | null>(null)
  // The node whose right-click menu is open, at the click point in px from the canvas's top-left corner.
  const [menu, setMenu] = useState<{ node: string; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // The add menu above the toolbar, and the record of an added item whose node the canvas selects once it appears.
  const [adding, setAdding] = useState(false)
  const addRef = useRef<HTMLDivElement | null>(null)
  const addButton = useRef<HTMLButtonElement | null>(null)
  const [revealing, setRevealing] = useState<string | null>(null)
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
  // The position fields of each node's last `canvas.node_position` write, by node ID.
  const written = useRef<Record<string, Partial<NodePosition>>>({})
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
    // A canvas without a stored viewport fits its nodes, so a failed read counts as none.
    void readLayout(projectId).catch(() => ({ viewport: null })).then((layout) => {
      if (!live) return
      setPositions({})
      if (layout.viewport !== null) setViewport(layout.viewport)
      needsFit.current = layout.viewport === null
      setLayoutReady(true)
    })
    return () => {
      live = false
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    }
  }, [projectId])

  /** Store the viewport after the pan or zoom settles. */
  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      // A lost save leaves the stored viewport; the next save carries the viewport again.
      void writeLayout(projectId, { viewport: viewportRef.current }).catch(() => null)
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
      // A scroll island keeps its wheel, except that a ctrl or meta wheel, such as a touchpad pinch, over an island inside
      // a node card zooms the canvas; the open editor's panel keeps every wheel. A wheel targets an element in the canvas.
      const island = (event.target as Element).closest('[data-dv-scroll-island]')
      if (island !== null && !((event.ctrlKey || event.metaKey) && island.closest('[data-node-id]') !== null)) return
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

  // A press outside the node menu, Escape, and a pan or zoom close the menu.
  useEffect(() => {
    if (menu === null) return
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target instanceof Node && menuRef.current?.contains(event.target) === true)) setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close) }
  }, [menu])
  useEffect(() => { setMenu(null) }, [viewport])
  // A press outside the add menu and its button, Escape, and a pan or zoom close the add menu.
  useEffect(() => {
    if (!adding) return
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && (addRef.current?.contains(target) === true || addButton.current?.contains(target) === true)
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !inside(event.target)) setAdding(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close) }
  }, [adding])
  useEffect(() => { setAdding(false) }, [viewport])

  // A node that leaves the list, such as after a removal, takes its selection, editor and menu with it.
  useEffect(() => {
    if (graph === null) return
    const gone = (id: string | null): boolean => id !== null && !graph.nodes.some(node => node.id === id)
    if (gone(selected)) setSelected(null)
    if (gone(editing)) setEditing(null)
    if (gone(stacked)) setStacked(null)
    if (gone(menu?.node ?? null)) setMenu(null)
    if (gone(renaming?.node ?? null)) setRenaming(null)
  }, [graph, selected, editing, stacked, menu, renaming])

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

  // An added item's node is selected and centered once it appears; its selection outlines the nodes it uses.
  useEffect(() => {
    const node = revealing === null ? undefined : graph?.nodes.find(candidate => candidate.id === revealing)
    if (node === undefined) return
    setRevealing(null)
    setSelected(node.id)
    centerOn(node)
  }, [revealing, graph, centerOn])

  // A focus request waits while no drawn node matches it, so a node type that registers later still opens its node;
  // only opening the node takes the request.
  useEffect(() => {
    if (focus === null || !layoutReady || graph === null) return
    const recordId = focus.record
    const firstOutput = graph.state.components.proj.records.find(record => record.id === recordId)?.outputs[0]
    const node = graph.nodes.find(candidate => candidate.id === recordId)
      ?? graph.nodes.find(candidate => candidate.versions.includes(recordId))
      ?? graph.nodes.find(candidate => firstOutput !== undefined && candidate.assets.includes(firstOutput))
    if (node === undefined) return
    focus.take()
    centerOn(node)
    setSelected(node.id)
    setEditing(node.id)
  }, [focus, layoutReady, graph, centerOn])

  // The project state on show when the server answered each node's write; a later state is past the write.
  const answered = useRef(new Map<string, unknown>())
  /**
   * Write a node's new box as one `canvas.node_position` record: the corner of a move, or the whole box of a resize. The
   * canvas draws the box until the project state shows it, or until the first state after the server answered, such as
   * the state of an undo that came first; it drops the box again when the write is refused.
   * @param node - the node.
   * @param box - the new box.
   * @param resized - whether the size changed too.
   */
  const writePosition = useCallback((node: CanvasNode, box: NodePosition, resized: boolean) => {
    answered.current.delete(node.id)
    positionsRef.current = { ...positionsRef.current, [node.id]: box }
    setPositions(all => ({ ...all, [node.id]: box }))
    setNotice(null)
    const corner = { node: node.id, x: box.x, y: box.y }
    written.current = { ...written.current, [node.id]: resized ? box : { x: box.x, y: box.y } }
    client.runOperation({
      project: projectId, operation: NODE_POSITION, surface: 'canvas', ...session === null ? {} : { session },
      params: resized ? { ...corner, width: box.width, height: box.height } : corner,
      intent: `${resized ? 'resize' : 'move'} ${node.title} on the canvas`,
    }).then(() => {
      if (positionsRef.current[node.id] === box) answered.current.set(node.id, graphRef.current?.state)
    }, (error: unknown) => {
      setPositions(all => all[node.id] === box ? withoutProperties(all, [node.id]) : all)
      setNotice(t('error', { message: errorMessage(error) }))
    })
  }, [client, projectId, session, t])

  // A box in flight leaves once the project state shows the fields its write set. A move sets only the corner, so a node
  // without a stored size takes its type's default size then, even when that size changed since the drag.
  useEffect(() => {
    if (graph === null) return
    const shown = graph.nodes.flatMap((node) => {
      const box = positions[node.id]
      const fields = written.current[node.id]
      const stored = node.node.position
      const showsWrite = fields !== undefined
        && Object.entries(fields).every(([field, value]) => stored[field as keyof NodePosition] === value)
      const settled = answered.current.has(node.id) && answered.current.get(node.id) !== graph.state
      return box !== undefined && gesture.current === null && (showsWrite || settled) ? [node.id] : []
    })
    for (const id of shown) answered.current.delete(id)
    if (shown.length > 0) setPositions(all => withoutProperties(all, shown))
  }, [graph, positions])

  const renamedAt = useRef(new Map<string, unknown>())
  /**
   * Write a node's new name as one record: `canvas.node_rename`, or the write that the node's type gives for the item
   * it shows (`NodeType.rename`). The canvas draws the name until the project state shows it, or until the first state
   * after the server answered, and drops it again when the write is refused.
   * @param node - the node.
   * @param title - the trimmed name; empty clears the name of a node that has its own.
   */
  const renameNode = (node: CanvasNode, title: string): void => {
    const name = title === '' ? null : title
    const { nodeType } = node
    const write = nodeType.rename === undefined
      ? { operation: NODE_RENAME, params: { node: node.id, name }, intent: `rename ${node.title} on the canvas` }
      : nodeType.rename(viewFor(node), title)
    if (write === null || (nodeType.rename === undefined && name === node.node.name)) return
    setNames(all => ({ ...all, [node.id]: name }))
    renamedAt.current.delete(node.id)
    setNotice(null)
    client.runOperation(canvasRequest(write))
      .then(() => { if (namesRef.current[node.id] === name) renamedAt.current.set(node.id, baseRef.current) }, (error: unknown) => {
        setNames(all => all[node.id] === name ? withoutProperties(all, [node.id]) : all)
        setNotice(t('error', { message: errorMessage(error) }))
      })
  }
  useEffect(() => {
    const state = base.value
    if (state === null) return
    // A node whose type renames its item reads the new name from the title that its type computes. The name of any
    // other node waits for the node's own name, since its type's title can equal the typed name before the write lands.
    const renamesItem = (id: string): boolean =>
      descriptors.nodeTypes.find(type => type.type === state.components.canvas.nodes[id]?.kind)?.rename !== undefined
    const titled = (id: string): boolean => renamesItem(id) && nodeTitle(state, declared, language, descriptors.nodeTypes, id) === names[id]
    const shown = Object.keys(names).filter(id => state.components.canvas.nodes[id]?.name === names[id] || titled(id)
      || (renamedAt.current.has(id) && renamedAt.current.get(id) !== state))
    for (const id of shown) renamedAt.current.delete(id)
    if (shown.length > 0) setNames(all => withoutProperties(all, shown))
  }, [base.value, names, declared, language, descriptors])
  /** The name field of a node, which saves through {@link renameNode} and refuses a name over {@link NAME_MAX}. */
  const renameField = (node: CanvasNode): Omit<InlineRenameProps, 'value'> => ({
    label: t('node.renameAria'),
    check: title => title.length > NAME_MAX ? t('node.renameTooLong', { max: String(NAME_MAX) }) : null,
    onSave: (title) => { renameNode(node, title) },
    onClose: () => { setRenaming(null) },
  })
  /** Rename a node in its caption, or in its editor when the editor is open or the zoom is low. */
  const startRename = (id: string): void => {
    if (editing === null && viewport.zoom >= CAPTION_RENAME_ZOOM) {
      setRenaming({ node: id, place: 'caption' })
      return
    }
    if (id !== stacked) setEditing(id)
    setRenaming({ node: id, place: 'editor' })
  }
  /** F2 renames the node of the top open editor, or the selected node. */
  const renameKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const id = stacked ?? editing ?? selected
    if (event.key !== 'F2' || inTextField(event.target) || id === null) return
    event.preventDefault()
    startRename(id)
  }

  /** Move a node so that its top edge is centered on a dropped canvas point; the node keeps its size. */
  const placeNode = useCallback((node: CanvasNode, point: NodeSpot) => {
    const size = boxIn(positionsRef.current, node)
    setTopNode(node.id)
    writePosition(node, { ...size, x: point.x - size.width / 2, y: point.y }, false)
  }, [writePosition])

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

  // Registered once per load, so that a graph refetch neither re-registers the canvas nor reorders the registry.
  const drawnRef = useRef(graph?.nodes ?? [])
  drawnRef.current = graph?.nodes ?? []
  const loaded = layoutReady && graph !== null
  useEffect(() => {
    if (!loaded) return undefined
    return views.mount({
      projectId, session,
      cards: () => cardsOf(drawnRef.current, node => boxIn(positionsRef.current, node)),
    })
  }, [loaded, projectId, session, views])

  const awaitedRender = useRef<AwaitedRender | null>(null)
  const [rerunning, setRerunning] = useState<{ node: string; action: string | null } | null>(null)
  const settleAwaited = (): void => {
    awaitedRender.current = null
    setRerunning(null)
  }
  useEffect(() => {
    const awaited = awaitedRender.current
    if (awaited === null || graph === null) return
    const node = graph.nodes.find(candidate =>
      candidate.id === awaited.node && candidate.versions.some(version => !awaited.known.has(version)))
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
    const next = { since: seenNodes.since, ids: new Set(seenNodes.ids).add(opened.record.id) }
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
    // A press on a control that the card body owns selects the node and leaves the gesture to the body.
    if (inInteractive(event.target)) {
      setSelected(node.id)
      return
    }
    const origin = boxOf(node)
    gesture.current = { kind: 'node', id: node.id, startX: event.clientX, startY: event.clientY, origin, at: origin, moved: false }
    capture(event)
  }
  // The handle stops the press before the card's `onNodeDown`, so a resize starts no move and opens no editor.
  const onResizeDown = (node: CanvasNode) => (handle: ResizeHandle, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const origin = boxOf(node)
    gesture.current = { kind: 'resize', node, handle, startX: event.clientX, startY: event.clientY, origin, at: origin, moved: false }
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
      const at = resizedBox(current.node.sizing, current.origin, current.handle, dx / zoom, dy / zoom)
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
        const node = graph?.nodes.find(candidate => candidate.id === current.id)
        if (node?.nodeType.open === undefined) setEditing(current.id)
        else node.nodeType.open(viewFor(node))
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
    if (current.kind === 'pan') {
      scheduleSave()
      return
    }
    const node = current.kind === 'resize' ? current.node : graph?.nodes.find(candidate => candidate.id === current.id)
    if (node !== undefined) writePosition(node, current.at, current.kind === 'resize')
  }
  // A cancelled drag or resize writes no position, so the node goes back to the box it showed before.
  const onPointerCancel = (): void => {
    const current = gesture.current
    gesture.current = null
    if (current === null || !current.moved) return
    if (current.kind === 'pan') {
      scheduleSave()
      return
    }
    const id = current.kind === 'resize' ? current.node.id : current.id
    setPositions(all => withoutProperties(all, [id]))
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
   * Ask the user to confirm, then remove a node from the canvas with one `canvas.node_remove` record. The node leaves
   * once the project state shows the record, and its selection and editor go with it.
   * @param node - the node.
   */
  const removeNode = (node: CanvasNode): void => {
    setMenu(null)
    if (!window.confirm(t('node.removeConfirm', { title: node.title }))) return
    void run(() => client.runOperation(canvasRequest({ operation: NODE_REMOVE, params: { nodes: [node.id] }, intent: `remove ${node.title} from the canvas` })))
  }
  /**
   * Put an item of the add menu on the canvas. An item that a node already shows selects and centers that node; any
   * other item runs its write, and the canvas selects and centers the node of its record once the node appears.
   * @param item - the picked item.
   */
  const addItem = (item: AddMenuItem): void => {
    setAdding(false)
    const shown = item.node === null ? undefined : graph?.nodes.find(node => node.id === item.node)
    if (shown !== undefined) {
      setSelected(shown.id)
      centerOn(shown)
      return
    }
    void run(async () => { setRevealing((await client.runOperation(canvasRequest(item.request))).id) })
  }
  /**
   * F2 renames the selected node ({@link renameKey}). Delete or Backspace removes the selected node while no editor, asset
   * picker or media preview is open and the key does not go to a text field.
   * @param event - the key press inside the canvas.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || inCardKeys(event.target)) return
    renameKey(event)
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    const target = event.target as HTMLElement
    if (editing !== null || target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]') !== null) return
    if (document.querySelector('[aria-modal="true"]') !== null) return
    const node = graph?.nodes.find(candidate => candidate.id === selected)
    if (node === undefined) return
    event.preventDefault()
    removeNode(node)
  }
  /**
   * A right click on a node selects it and opens its menu at the pointer; elsewhere the browser's menu opens.
   * @param event - the right click inside the canvas.
   */
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // A right click that the card body handled, such as the timeline editor's track menu, stays with the body.
    if (event.defaultPrevented) return
    const card = (event.target as Element).closest('[data-node-id]')
    const node = graph?.nodes.find(candidate => candidate.id === card?.getAttribute('data-node-id'))
    if (node === undefined) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setSelected(node.id)
    setMenu({ node: node.id, x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
  /**
   * Start a rerun of a version and wait for the node's new version, which the canvas reveals as soon as the project
   * state shows it because `runOperation` resolves only when the operation ends.
   * @param request - the request; its `based_on` is the version it runs again.
   * @param action - the node action that started the rerun, or null for a body.
   * @returns settles once the new version is revealed or once a later rerun replaces this one; rejects with the error of
   *   a request that fails before that.
   */
  const rerun = (request: RerunRequest, action: string | null): Promise<void> => new Promise((resolve, reject) => {
    const node = graphRef.current?.nodes.find(candidate => candidate.versions.includes(request.based_on))
    const awaited: AwaitedRender = { node: node?.id ?? request.based_on, known: new Set(node?.versions), resolve }
    awaitedRender.current?.resolve()
    awaitedRender.current = awaited
    setRerunning({ node: awaited.node, action })
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
      void run(() => placeAsset(assetId))
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
    background: 'var(--dv-surface-2)', boxShadow: '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-1)', outline: '1px solid transparent', zIndex: 5,
  }
  const toolButton: CSSProperties = {
    height: 28, minWidth: 28, border: 'none', borderRadius: 'var(--dv-radius-sm)', color: 'var(--dv-text-2)', padding: '0 6px', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12, lineHeight: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  const centered: CSSProperties = { position: 'absolute', inset: 0, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontSize: 14, lineHeight: '22px', color: 'var(--dv-text-2)' }
  const actionsFor = (view: NodeView): NodeAction[] => descriptors.actions.filter(action => action.shows(view, assetById))
    .toSorted((a, b) => a.order - b.order)
  const viewFor = (node: CanvasNode): NodeView => viewOf(
    node, seenNodes !== null && isFinished(node) && !wasSeen(seenNodes, node), node.id === rerunning?.node,
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
    // While the selected node uses other nodes, they glow and every other node and edge fades.
    const usedList = selected === null ? undefined : graph.usedNodes[selected]
    const used = new Set(usedList)
    const fading = usedList !== undefined
    const anchorOf = (node: CanvasNode): number => edgeAnchorY(boxOf(node), viewport.zoom)
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
                style={{
                  stroke: highlighted ? 'var(--dv-accent)' : from.nodeType.color,
                  strokeOpacity: highlighted ? 0.9 : fading ? 0.6 * DIMMED_OPACITY : 0.6,
                }}
                strokeWidth={highlighted ? 2 : 1.5}
                vectorEffect="non-scaling-stroke"
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
              used={used.has(node.id)}
              dimmed={fading && node.id !== selected && !used.has(node.id)}
              zoom={viewport.zoom}
              t={t}
              onPointerDown={onNodeDown(node)}
              onResizeDown={onResizeDown(node)}
              body={renderSlot('dv.canvas.card', {
                node: view, state: graph.state, session, selected: node.id === selected && node.id !== editing,
                above: node.id === selected ? above : null, assets, textScale, host: hosts.card,
              }, {
                entryKey: node.type, fallback: <TypeLabelBody label={node.nodeType.label()} textScale={textScale} />,
              })}
              failedActions={node.flags.failed ? actionsFor(view) : []}
              rerunningAction={view.rerunning ? rerunning?.action ?? null : null}
              onAction={(action) => { action.run(view, hosts.action(action.id)) }}
              rename={renaming?.place === 'caption' && renaming.node === node.id ? renameField(node) : null}
              aboveRef={setAbove}
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
  /**
   * The items of a node's right-click menu: the node actions that show on it, then 从画布移除. Every menu item of the
   * canvas goes in this one list.
   * @param node - the node.
   * @returns the items, top first.
   */
  const menuItems = (node: CanvasNode): NodeMenuItem[] => {
    const view = viewFor(node)
    const host = hostsOf(() => { setEditing(null) })
    return [
      ...actionsFor(view).map(action => ({
        id: action.id, label: action.label(), disabled: view.rerunning,
        run: () => { setMenu(null); action.run(view, host.action(action.id)) },
      })),
      { id: 'rename', label: t('node.rename'), run: () => { setMenu(null); startRename(node.id) } },
      { id: 'remove', label: t('node.remove'), danger: true, shortcut: { glyph: '⌫', keys: 'Delete Backspace' }, run: () => { removeNode(node) } },
    ]
  }
  const menuNode = menu === null ? undefined : graph?.nodes.find(node => node.id === menu.node)
  /** The props that the editor of the open node and the stacked editor share. */
  const sharedEditorProps = (shown: NonNullable<typeof graph>, node: CanvasNode, close: () => void) => {
    const view = viewFor(node)
    return {
      node, view, viewAt: (record: string) => viewFor(shown.atVersion(node, record)),
      operations: declared, versionKinds: descriptors.versionKinds,
      actions: actionsFor(view), project: projectId, session, t, hosts: hostsOf(close), area, renderSlot, renderFactorySlot,
      onAcceptStale: (record: string) => { void run(() => client.acceptStale(projectId, record, 'canvas', session)) },
      onRemove: () => { removeNode(node) },
      rename: renaming?.place === 'editor' && renaming.node === node.id ? { ...renameField(node), hint: t('node.renameHint') } : null,
      onRename: () => { setRenaming({ node: node.id, place: 'editor' }) },
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
      onPointerCancel={onPointerCancel}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOver(false) }}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <style>{CANVAS_CSS}</style>
      {content}
      {menu !== null && menuNode !== undefined
        ? <NodeMenu key={`${menu.node}@${String(menu.x)},${String(menu.y)}`} at={menu} area={area} items={menuItems(menuNode)} label={t('menu.label')} menuRef={menuRef} />
        : null}
      {notice !== null ? <p role="alert" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', margin: 0, padding: '6px 10px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-1)', border: '1px solid var(--dv-danger)', color: 'var(--dv-danger)', fontSize: 13, lineHeight: '20px', zIndex: 12 }}>{notice}</p> : null}
      {adding && graph !== null
        ? (
          <AddMenu
            sections={descriptors.addMenu.toSorted((a, b) => a.order - b.order)
              .map(section => ({ section, items: section.items(graph.state) }))}
            label={t('add.label')} empty={t('add.empty')} placed={t('add.placed')} onPick={addItem} menuRef={addRef}
          />
        )
        : null}
      <div role="toolbar" aria-label={t('canvas.zoom')} style={{ ...floating, position: 'absolute', left: 16, bottom: 16, display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 10 }} onPointerDown={(event) => { event.stopPropagation() }}>
        <button
          ref={addButton} type="button" className="dv-canvas-btn" aria-haspopup="menu" aria-expanded={adding} disabled={graph === null}
          style={{ ...toolButton, gap: 4, padding: '0 8px' }} onClick={() => { setAdding(open => !open) }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {t('add.button')}
        </button>
        <span aria-hidden="true" style={{ width: 1, height: 16, margin: '0 2px', background: 'var(--dv-line)' }} />
        <button type="button" className="dv-canvas-btn" aria-label={t('canvas.zoomOut')} title={t('canvas.zoomOut')} style={toolButton} onClick={() => { zoomBy(1 / 1.2) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <span style={{ minWidth: 44, textAlign: 'center', fontFamily: 'var(--dv-font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>{`${String(Math.round(viewport.zoom * 100))}%`}</span>
        <button type="button" className="dv-canvas-btn" aria-label={t('canvas.zoomIn')} title={t('canvas.zoomIn')} style={toolButton} onClick={() => { zoomBy(1.2) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" className="dv-canvas-btn" style={{ ...toolButton, padding: '0 8px' }} onClick={() => { autoFit.current = true; fit(); scheduleSave() }}>{t('canvas.fit')}</button>
      </div>
      {editingNode !== null && graph !== null
        ? (
          <>
            <div ref={editorZoom.fadeRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'var(--dv-overlay)', zIndex: 9 }} />
            <NodeEditor
              key={editingNode.id} zoomRef={editorZoom.targetRef} state={graph.state}
              {...sharedEditorProps(graph, editingNode, () => { setEditing(null) })}
            />
          </>
        )
        : null}
      {stackedNode !== null && graph !== null
        ? (
          // The stacked editor covers the canvas area; a press outside its panel closes it, not the editor beneath.
          <div style={{ position: 'absolute', inset: 0, zIndex: 11 }} onPointerDown={(event) => { event.stopPropagation(); setStacked(null) }}>
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'var(--dv-overlay)' }} />
            <NodeEditor key={`stacked:${stackedNode.id}`} zoomRef={noZoom} {...sharedEditorProps(graph, stackedNode, () => { setStacked(null) })} state={graph.state} />
          </div>
        )
        : null}
    </div>
  )
}
