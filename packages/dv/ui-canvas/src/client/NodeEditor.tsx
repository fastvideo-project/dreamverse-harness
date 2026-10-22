/**
 * The editor a canvas node opens: a panel over a dimmed canvas that opens centered in the canvas (720 px wide at most,
 * about 80% of the canvas height). Dragging the header's title row moves the panel, the bottom-right corner and the
 * right and bottom edges resize it, and a double click on the title row puts it back at the centered default. The last
 * position and size are kept in `localStorage` for every node and fitted into the canvas when restored. Every node offers
 * "问 agent" (a `dv:compose` event that prefills the chat composer). A take shows a large player (an audio output plays
 * in an audio player with sound), the failure reason of a failed take, its model and generation task (the task's label in
 * `GET /api/dv/tasks`, else its name), the params that its operation declares in `GET /api/dv/operations` (prompt
 * first), and reference chips when the operation takes references
 * and the task is not `t2v`, and offers "渲染新版本" (a user record of the take's operation in the take's model and task,
 * whose `based_on` is the take); a take whose operation the list does not name shows no params and no button.
 * While the render starts the button is disabled and reads 渲染中…, and a refused request shows its error under the
 * button. "添加素材" opens the asset picker; a reference chip opens the preview of its asset, or the editor of the node of
 * its versioned item (read through the registered version kinds) over this one. The picker's asset pool and the preview
 * are the `dv.canvas.picker` and `dv.canvas.preview` entries at key `assets`. An entry node (a node that a registered
 * `NodeType` drew) shows the `dv.canvas.editor` entry keyed by its `NodeType.id`, which the canvas lends its writes, its asset
 * picker of assets only and its asset preview; it shows only the header when no entry is registered or the host renders
 * no entries. A stale node offers "仍然保留", which keeps its record as it is (`proj.stale_accept`).
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { AssetMedia } from '@dv/ui-kit/asset-media.tsx'
import { dispatchCompose, type DvComposeRef } from '@dv/ui-kit/compose.ts'
import { fieldsOf, paramsOf, type FormField } from '@dv/ui-kit/form.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import { formatInputRef } from '@dv/ui-kit/references.ts'
import type { EntryEditorHost, VersionKind } from '@dv/ui-kit/registries.ts'
import { readStored, writeStored } from '@dv/ui-kit/storage.ts'
import { taskLabel, type WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import type { OperationRequest, ProjectAsset, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { AssetPicker, AssetPreview } from './AssetPicker.tsx'
import type { CanvasNode } from './graph.ts'
import { nodeTitle, typeColor, typeLabel } from './NodeCard.tsx'
import type { CanvasTranslate } from './NodeCard.tsx'

/** Renders the slots of the canvas's editors (`dv.canvas.editor`, `dv.canvas.picker`, `dv.canvas.preview`): the
 *  `renderSlot` of the slot entry that declares them. */
export type RenderCanvasSlot = PropsRenderSlots<'dv.canvas.editor' | 'dv.canvas.picker' | 'dv.canvas.preview'>['renderSlot']

/** Props of {@link NodeEditor}. */
export interface NodeEditorProps {
  node: CanvasNode
  state: WireState
  /** The operation declarations of `GET /api/dv/operations`; a take's editor shows the params of its operation. */
  operations: readonly WireOperation[]
  /** The task labels of `GET /api/dv/tasks`; a take shows its task by its label, else by its name. */
  taskLabels: WireTaskLabels
  /** The registered version kinds; reference chips and the picker read versioned items through them. */
  versionKinds: readonly VersionKind[]
  client: DvClient
  project: string
  /** The chat session the canvas sits beside, recorded as the `session` of the editor's writes. */
  session: string | null
  t: CanvasTranslate
  onClose: () => void
  /** Run a write and report its failure. */
  run: (work: () => Promise<unknown>) => Promise<void>
  /**
   * Start the render of a new take based on the open take. Settles once the new take is on the canvas, after the canvas
   * closed the editor; rejects when the request fails before that.
   */
  onRender: (request: OperationRequest & { based_on: string }) => Promise<void>
  /** Take an asset off the project's canvas list; the asset stays in the asset pool. */
  onRemoveFromCanvas: (assetId: string) => void
  /** Open the editor of another node over this one, which keeps its unsaved changes. */
  onOpenNode: (nodeId: string) => void
  /** The zoom transition's ref for the panel, which grows out of the node and shrinks back into it. */
  zoomRef: (element: HTMLElement | null) => void
  /** Renders the `dv.canvas.editor` entry of an entry node, and the asset pool in the picker and the preview; without it
   *  an entry node shows only its header, the picker offers only versioned items, and the preview shows nothing. */
  renderSlot?: RenderCanvasSlot
}

/** The editor panel's position and size in px, relative to the canvas area's top-left corner. */
export interface EditorRect {
  x: number
  y: number
  width: number
  height: number
}

/** The size in px of the canvas area the editor panel sits in. */
export interface EditorArea {
  width: number
  height: number
}

/** The widest default panel, in px. */
const EDITOR_DEFAULT_WIDTH = 720
/** The space in px the default panel leaves on each side of the canvas area. */
const EDITOR_MARGIN = 24
/** The lowest panel height the default gives when the canvas area has room for it, in px. */
const EDITOR_DEFAULT_MIN_HEIGHT = 480
/** The smallest width a resize gives, in px; a narrower canvas area caps it at the area's width. */
const EDITOR_MIN_WIDTH = 480
/** The smallest height a resize gives, in px; a lower canvas area caps it at the area's height. */
const EDITOR_MIN_HEIGHT = 320
/** The length in px of the panel's header that a move keeps inside the canvas area, so the header stays draggable. */
const EDITOR_KEEP_VISIBLE = 48
/** The `localStorage` key of the last panel position and size, shared by every node. */
export const EDITOR_RECT_KEY = 'dv-canvas-editor-rect'

/**
 * Limit a number to a range; a range whose upper end is under its lower end yields the upper end.
 * @param value - the number.
 * @param low - the lower end.
 * @param high - the upper end.
 * @returns the limited number.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * The panel's default rectangle: centered in the canvas area, `min(720, width − 48)` wide, and about 80% of the area's
 * height but at least 480 px when the area has room for 480 px plus the 24 px margins.
 * @param area - the canvas area.
 * @returns the rectangle.
 */
export function defaultEditorRect(area: EditorArea): EditorRect {
  const width = Math.max(0, Math.min(EDITOR_DEFAULT_WIDTH, area.width - 2 * EDITOR_MARGIN))
  const height = Math.max(0, Math.min(area.height - 2 * EDITOR_MARGIN, Math.max(EDITOR_DEFAULT_MIN_HEIGHT, Math.round(area.height * 0.8))))
  return { x: Math.round((area.width - width) / 2), y: Math.round((area.height - height) / 2), width, height }
}

/**
 * Limit a panel size to the resize range: width between 480 px and the area's width, height between 320 px and the
 * area's height (an area smaller than the minimum caps the size at the area).
 * @param rect - the rectangle.
 * @param area - the canvas area.
 * @returns the rectangle with its size limited and its position unchanged.
 */
function limitSize(rect: EditorRect, area: EditorArea): EditorRect {
  return {
    ...rect,
    width: clamp(rect.width, Math.min(EDITOR_MIN_WIDTH, area.width), area.width),
    height: clamp(rect.height, Math.min(EDITOR_MIN_HEIGHT, area.height), area.height),
  }
}

/**
 * Limit a panel to the resize range and keep at least {@link EDITOR_KEEP_VISIBLE} px of its header inside the canvas
 * area: the top edge stays between the area's top and 48 px above its bottom, and 48 px of the width stay inside
 * horizontally.
 * @param rect - the rectangle.
 * @param area - the canvas area.
 * @returns the limited rectangle.
 */
export function clampEditorRect(rect: EditorRect, area: EditorArea): EditorRect {
  const sized = limitSize(rect, area)
  const keep = Math.min(EDITOR_KEEP_VISIBLE, sized.width)
  return {
    ...sized,
    x: clamp(sized.x, keep - sized.width, area.width - keep),
    y: clamp(sized.y, 0, Math.max(0, area.height - EDITOR_KEEP_VISIBLE)),
  }
}

/**
 * Fit a remembered panel into the canvas area: the size is limited to the resize range and the whole panel is moved
 * inside the area, so a rectangle stored under a larger window opens in full view.
 * @param rect - the remembered rectangle.
 * @param area - the canvas area.
 * @returns the fitted rectangle.
 */
export function fitEditorRect(rect: EditorRect, area: EditorArea): EditorRect {
  const sized = limitSize(rect, area)
  return { ...sized, x: clamp(sized.x, 0, area.width - sized.width), y: clamp(sized.y, 0, area.height - sized.height) }
}

/**
 * Move a panel by a pointer offset, keeping its header reachable (see {@link clampEditorRect}).
 * @param start - the rectangle when the move began.
 * @param dx - the horizontal pointer offset in px.
 * @param dy - the vertical pointer offset in px.
 * @param area - the canvas area.
 * @returns the moved rectangle.
 */
export function moveEditorRect(start: EditorRect, dx: number, dy: number, area: EditorArea): EditorRect {
  return clampEditorRect({ ...start, x: start.x + dx, y: start.y + dy }, area)
}

/**
 * Resize a panel from its right edge, its bottom edge, or both (the corner); the top-left corner stays in place. A
 * moving edge stops at the canvas edge so the corner handle stays visible, unless the minimum size needs more room.
 * @param start - the rectangle when the resize began.
 * @param dx - the width change in px; ignored when `edges` lacks the right edge.
 * @param dy - the height change in px; ignored when `edges` lacks the bottom edge.
 * @param edges - the edges that move.
 * @param area - the canvas area.
 * @returns the resized rectangle.
 */
export function resizeEditorRect(
  start: EditorRect, dx: number, dy: number, edges: { right: boolean; bottom: boolean }, area: EditorArea,
): EditorRect {
  return clampEditorRect({
    ...start,
    width: edges.right ? Math.min(start.width + dx, Math.max(EDITOR_MIN_WIDTH, area.width - start.x)) : start.width,
    height: edges.bottom ? Math.min(start.height + dy, Math.max(EDITOR_MIN_HEIGHT, area.height - start.y)) : start.height,
  }, area)
}

/**
 * The remembered panel rectangle, or null when there is none, it is malformed, or storage is unavailable.
 * @returns the rectangle.
 */
function readEditorRect(): EditorRect | null {
  const text = readStored('local', EDITOR_RECT_KEY)
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    // A value another build wrote in a different format is ignored the same way.
    void error
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { x, y, width, height } = value as Partial<Record<keyof EditorRect, unknown>>
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null
}

/**
 * Remember the panel rectangle, or forget it when `rect` is null; a storage failure leaves the editor working.
 * @param rect - the rectangle, or null after a reset to the default.
 */
function writeEditorRect(rect: EditorRect | null): void {
  writeStored('local', EDITOR_RECT_KEY, rect === null ? null : JSON.stringify(rect))
}

/** The px a resize-handle arrow key adds to or takes from the panel's width or height. */
const RESIZE_STEP = 16

/** One pointer gesture on the panel: a move from the title row or a resize from a handle. */
interface PanelGesture {
  pointerId: number
  startX: number
  startY: number
  start: EditorRect
  /** Null for a move; the moving edges for a resize. */
  edges: { right: boolean; bottom: boolean } | null
}

// Editor styles draw on the `--dv-*` theme variables so the panel matches the app in the light and dark themes.
const panel: CSSProperties = {
  position: 'absolute', display: 'flex', flexDirection: 'column',
  overflow: 'hidden', background: 'var(--dv-surface-1)', color: 'var(--dv-text)', borderRadius: 'var(--dv-radius-xl)',
  boxShadow: '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-2)', zIndex: 10, fontSize: 13, lineHeight: '20px',
}
const label: CSSProperties = { display: 'block', fontSize: 12, lineHeight: '16px', fontWeight: 500, color: 'var(--dv-text-2)', margin: '12px 0 4px' }
const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--dv-surface-2)', color: 'var(--dv-text)',
  border: '1px solid var(--dv-line-strong)', borderRadius: 'var(--dv-radius-md)', padding: '6px 8px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px',
}
const button: CSSProperties = {
  height: 32, border: 'none', borderRadius: 'var(--dv-radius-md)', padding: '0 12px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', fontWeight: 500,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
/** A secondary button: 1px border, transparent fill (the `dv-canvas-btn` class paints the fill and the hover). */
const secondaryButton: CSSProperties = { ...button, border: '1px solid var(--dv-line-strong)', color: 'var(--dv-text)' }
const chip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 2px', borderRadius: 14, background: 'var(--dv-surface-3)', fontSize: 13, lineHeight: '20px' }
/** The part of a reference chip that opens the reference: its thumbnail and its name. */
const chipOpen: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }
/** The model key params: the model-and-task line shows them, and a new take keeps them. */
const MODEL_KEY = new Set(['modality', 'task', 'provider', 'model'])
/** The params whose fields keep their element ID and localized label; any other param shows its key. */
const SHARED_FIELDS: Readonly<Record<string, { id: string; label: 'editor.prompt' | 'editor.duration' | 'editor.seed' }>> = {
  prompt: { id: 'prompt', label: 'editor.prompt' }, duration_sec: { id: 'duration', label: 'editor.duration' }, seed: { id: 'seed', label: 'editor.seed' },
}

/**
 * The field of one declared param: the prompt as a text area, a param with choices as a select, else an input.
 * @param props - the field, the canvas translate, and the callback that gets the field's next text.
 * @returns the label and the control.
 */
function ParamField({ param, t, onText }: { param: FormField; t: CanvasTranslate; onText: (text: string) => void }): ReactNode {
  const shared = SHARED_FIELDS[param.key]
  const id = `dv-canvas-editor-${shared?.id ?? param.key}`
  const change = (event: { target: { value: string } }): void => { onText(event.target.value) }
  let control: ReactNode
  if (param.key === 'prompt') control = <textarea id={id} style={{ ...field, minHeight: 72, resize: 'vertical' }} value={param.text} onChange={change} />
  else if (param.control === 'select') control = <select id={id} style={field} value={param.text} onChange={change}><option value="" />{param.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
  else if (param.control === 'checkbox') control = <input id={id} type="checkbox" checked={param.text === 'true'} onChange={(event) => { onText(String(event.target.checked)) }} />
  else control = <input id={id} type={param.control === 'number' ? 'number' : 'text'} style={field} placeholder={param.key === 'seed' ? t('editor.seedRandom') : undefined} value={param.text} onChange={change} />
  return <div style={{ flex: '1 1 200px' }}><label style={label} htmlFor={id}>{shared === undefined ? param.key : t(shared.label)}</label>{control}</div>
}

/** One input of the edited record. */
interface EditedInput {
  role: string
  ref: string
}

/** A versioned item at its newest version, with the version kind that reads it. */
interface VersionedItem {
  kind: VersionKind
  id: string
  version: number
}

/**
 * The first item of the version kinds that matches, at its newest version.
 * @param state - the project state.
 * @param kinds - the registered version kinds.
 * @param matches - whether an item ID of a kind is the one sought.
 * @returns the item, or null when no kind holds a matching item.
 */
function findItem(
  state: WireState, kinds: readonly VersionKind[], matches: (kind: VersionKind, id: string) => boolean,
): VersionedItem | null {
  for (const kind of kinds) {
    const item = kind.latest(state).find(entry => matches(kind, entry.id))
    if (item !== undefined) return { kind, ...item }
  }
  return null
}

/**
 * The item that reference text such as `hero@1` names, at its newest version.
 * @param state - the project state.
 * @param kinds - the registered version kinds.
 * @param ref - reference text.
 * @returns the item; null for `<id>@<n>` text that no kind holds; undefined for any other text.
 */
function namedItem(state: WireState, kinds: readonly VersionKind[], ref: string): VersionedItem | null | undefined {
  const id = /^(.+)@\d+$/.exec(ref)?.[1]
  return id === undefined ? undefined : findItem(state, kinds, (_kind, other) => other === id)
}

/**
 * The asset that shows a reference: the first reference asset of the newest version of its item, or the asset itself.
 * @param state - the project state.
 * @param kinds - the registered version kinds.
 * @param ref - reference text such as `hero@1` or an asset ID.
 * @returns the asset ID, or null.
 */
function refImage(state: WireState, kinds: readonly VersionKind[], ref: string): string | null {
  const item = namedItem(state, kinds, ref)
  if (item !== undefined) return item === null ? null : item.kind.assets(state, item.id, item.version)[0] ?? null
  return state.assets.some(asset => asset.id === ref) ? ref : null
}

/**
 * A reference chip label: the name of the newest version of its item, or the asset's name.
 * @param state - the project state.
 * @param kinds - the registered version kinds.
 * @param ref - reference text.
 * @returns the label.
 */
function refName(state: WireState, kinds: readonly VersionKind[], ref: string): string {
  const item = namedItem(state, kinds, ref)
  if (item === null) return ref.slice(0, ref.lastIndexOf('@'))
  if (item !== undefined) return item.kind.name(state, item.id, item.version) ?? item.id
  return state.assets.find(asset => asset.id === ref)?.name ?? ref
}

/** What {@link useEditorPlacement} gives the panel. */
interface EditorPlacement {
  /** Attach to the panel; its parent element is the canvas area that is measured. */
  panelRef: { current: HTMLElement | null }
  /** The rectangle on show. */
  rect: EditorRect
  /** Pointer handlers that start a move (`edges` null) or a resize, and follow and finish either. */
  begin: (edges: PanelGesture['edges']) => (event: ReactPointerEvent<HTMLElement>) => void
  follow: (event: ReactPointerEvent<HTMLElement>) => void
  finish: (event: ReactPointerEvent<HTMLElement>) => void
  /** Return to the default rectangle and forget the remembered one. */
  reset: () => void
  /** Resize from the corner by one arrow-key step. */
  resizeBy: (dx: number, dy: number) => void
}

/**
 * The panel's place in the canvas area and the gestures that change it. The area is the panel's parent element,
 * measured before paint and again whenever it changes size. The panel starts at the remembered rectangle fitted into
 * the area, else at the default; while the area is smaller than the panel, the panel shrinks and moves to stay usable,
 * and returns to its size when the area grows again. A finished move or resize, an arrow-key resize, and a reset
 * update the remembered rectangle.
 * @returns the panel ref, the rectangle on show, and the gesture handlers.
 */
function useEditorPlacement(): EditorPlacement {
  const panelRef = useRef<HTMLElement | null>(null)
  const [area, setArea] = useState<EditorArea>({ width: 0, height: 0 })
  // Null shows the default rectangle; a move, a resize, or a remembered rectangle replaces it.
  const [placed, setPlaced] = useState<EditorRect | null>(null)
  const gesture = useRef<PanelGesture | null>(null)
  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement
    if (parent === null || parent === undefined) return
    const measure = (): EditorArea => ({ width: parent.clientWidth, height: parent.clientHeight })
    const first = measure()
    setArea(first)
    const remembered = readEditorRect()
    if (remembered !== null) setPlaced(fitEditorRect(remembered, first))
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { setArea(measure()) })
    observer.observe(parent)
    return () => { observer.disconnect() }
  }, [])
  const rect = placed === null ? defaultEditorRect(area) : clampEditorRect(placed, area)
  /** The rectangle a gesture gives at a pointer position. */
  const gestureRect = (current: PanelGesture, event: ReactPointerEvent<HTMLElement>): EditorRect => {
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    return current.edges === null
      ? moveEditorRect(current.start, dx, dy, area)
      : resizeEditorRect(current.start, dx, dy, current.edges, area)
  }
  const begin = (edges: PanelGesture['edges']) => (event: ReactPointerEvent<HTMLElement>): void => {
    // The title row's buttons keep their clicks; only the row itself starts a move.
    if (event.button !== 0 || (edges === null && event.target instanceof Element && event.target.closest('button') !== null)) return
    event.preventDefault()
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start: rect, edges }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch (error) {
      // A synthetic pointer without an active pointer ID cannot be captured; the gesture still follows it over the panel.
      void error
    }
  }
  const follow = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = gesture.current
    if (current !== null && current.pointerId === event.pointerId) setPlaced(gestureRect(current, event))
  }
  const finish = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = gesture.current
    if (current === null || current.pointerId !== event.pointerId) return
    gesture.current = null
    // A press without movement (a click, or half of a double click) leaves the remembered rectangle alone.
    if (event.clientX === current.startX && event.clientY === current.startY) return
    const next = gestureRect(current, event)
    setPlaced(next)
    writeEditorRect(next)
  }
  const reset = (): void => {
    setPlaced(null)
    writeEditorRect(null)
  }
  const resizeBy = (dx: number, dy: number): void => {
    const next = resizeEditorRect(rect, dx, dy, { right: true, bottom: true }, area)
    setPlaced(next)
    writeEditorRect(next)
  }
  return { panelRef, rect, begin, follow, finish, reset, resizeBy }
}

/** The arrow keys of the resize handle and the width and height change each one makes. */
const RESIZE_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [RESIZE_STEP, 0], ArrowLeft: [-RESIZE_STEP, 0], ArrowDown: [0, RESIZE_STEP], ArrowUp: [0, -RESIZE_STEP],
}

/**
 * The editor: a header with the node type, the title, "问 agent" and close, above the body
 * of the node's type. The title row moves the panel and a double click on it resets the panel; the handles on the right
 * edge, the bottom edge, and the bottom-right corner resize it.
 * @param props - the node, the state it came from, and the write callbacks.
 * @returns the element.
 */
export function NodeEditor(props: NodeEditorProps): ReactNode {
  const { node, t, onClose } = props
  const title = nodeTitle(node, t)
  // A node without its own title is titled by its type, so the label beside the type dot would repeat the title.
  const type = typeLabel(node, t)
  const staleRecord = node.flags.stale ? node.record : null
  const placement = useEditorPlacement()
  // The versioned item that an entry stands for: the item whose version kind names the entry's node.
  const item = node.type === 'entry' ? findItem(props.state, props.versionKinds, (kind, id) => kind.node(id) === node.id) : null
  const askAgent = (): void => {
    const shown = node.thumb ?? node.video ?? node.references[0] ?? null
    // An asset node without a record (`asset:<id>`) is referenced as the asset itself.
    const ref: DvComposeRef = node.type === 'asset' && node.record === null && shown !== null
      ? { kind: 'asset', id: shown, label: title, assetId: shown }
      : { kind: item?.kind.kind ?? 'record', id: item?.id ?? node.record?.id ?? node.id, label: title, ...shown === null ? {} : { assetId: shown } }
    dispatchCompose({ text: t('compose.text', { title }), refs: [ref] })
    onClose()
  }
  let body: ReactNode
  switch (node.type) {
    case 'take': body = <TakeForm {...props} title={title} />; break
    case 'asset': body = <AssetPanel node={node} t={t} onRemoveFromCanvas={props.onRemoveFromCanvas} />; break
    case 'entry':
      body = <EntryForm {...props} node={node} />
      break
  }
  const { panelRef, rect, begin, follow, finish, reset, resizeBy } = placement
  const gestureHandlers = { onPointerMove: follow, onPointerUp: finish, onPointerCancel: finish }
  const onResizeKey = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const step = RESIZE_KEYS[event.key]
    if (step === undefined) return
    event.preventDefault()
    resizeBy(step[0], step[1])
  }
  return (
    <section
      ref={(element) => { panelRef.current = element; props.zoomRef(element) }}
      style={{ ...panel, left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      role="dialog" aria-label={title} data-testid="dv-canvas-node-editor" data-dv-scroll-island="" onPointerDown={(event) => { event.stopPropagation() }}
    >
      <header style={{ flex: 'none', padding: '16px 16px 12px 20px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--dv-line)' }}>
        <div
          data-testid="dv-canvas-editor-title-row" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'move', touchAction: 'none', userSelect: 'none' }}
          onPointerDown={begin(null)} {...gestureHandlers}
          onDoubleClick={(event) => { if (!(event.target instanceof Element && event.target.closest('button') !== null)) reset() }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 9999, background: typeColor(node) }} />
            {type === title ? null : type}
          </span>
          <h2 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
          <button type="button" className="dv-canvas-soft" style={button} onClick={askAgent}>{t('editor.askAgent')}</button>
          <button type="button" className="dv-canvas-btn" aria-label={t('editor.close')} title={t('editor.close')} style={{ ...button, width: 32, padding: 0, color: 'var(--dv-text-2)' }} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
        {staleRecord !== null
          ? (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px', color: 'var(--dv-danger)' }}>
              {t('node.stale')}
              <button
                type="button" className="dv-canvas-btn" style={{ ...secondaryButton, height: 28 }}
                onClick={() => { void props.run(() => props.client.acceptStale(props.project, staleRecord.id, 'canvas', props.session)) }}
              >
                {t('editor.keepAnyway')}
              </button>
            </p>
          )
          : null}
        {body}
      </div>
      {/* Thin strips on the right and bottom edges resize one dimension; the corner button resizes both and takes arrow keys. */}
      <div aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 16, width: 4, cursor: 'ew-resize', touchAction: 'none' }} onPointerDown={begin({ right: true, bottom: false })} {...gestureHandlers} />
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 16, bottom: 0, height: 4, cursor: 'ns-resize', touchAction: 'none' }} onPointerDown={begin({ right: false, bottom: true })} {...gestureHandlers} />
      <button
        type="button" className="dv-canvas-btn" aria-label={t('editor.resize')} title={t('editor.resize')} data-testid="dv-canvas-editor-resize"
        style={{ position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, padding: 0, border: 'none', borderRadius: 'var(--dv-radius-sm)', color: 'var(--dv-text-3)', cursor: 'nwse-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onPointerDown={begin({ right: true, bottom: true })} {...gestureHandlers} onKeyDown={onResizeKey}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" aria-hidden="true"><path d="M9 3 3 9M9 6.5 6.5 9" /></svg>
      </button>
    </section>
  )
}

/**
 * The node's asset at full width: the video when there is one (an audio asset in an audio player, not muted), else the image.
 * @param props - the node, and whether its video asset is audio.
 * @returns the element.
 */
function Preview({ node, audio = false }: { node: CanvasNode; audio?: boolean }): ReactNode {
  const style: CSSProperties = { width: '100%', maxHeight: 360, borderRadius: 'var(--dv-radius-lg)', background: 'var(--dv-media-bg)', display: 'block' }
  if (node.video !== null && audio) return <audio src={assetUrl(node.video)} controls style={{ width: '100%', display: 'block' }} />
  if (node.video !== null) {
    return (
      <video
        src={assetUrl(node.video)}
        poster={node.thumb === null ? undefined : assetUrl(node.thumb)}
        controls
        autoPlay
        muted
        loop
        style={style}
      />
    )
  }
  if (node.thumb !== null) return <img src={assetUrl(node.thumb)} alt={node.title} style={{ ...style, objectFit: 'contain' }} />
  return null
}

/**
 * An imported asset: its preview and "从画布移除", which takes it off the canvas list and leaves it in the asset pool.
 * @param props - the node, the canvas translate, and the removal callback.
 * @returns the element.
 */
function AssetPanel(
  { node, t, onRemoveFromCanvas }: { node: CanvasNode; t: CanvasTranslate; onRemoveFromCanvas: (assetId: string) => void },
): ReactNode {
  const assetId = node.thumb ?? node.video
  return (
    <>
      <Preview node={node} />
      {assetId === null
        ? null
        : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="dv-canvas-btn" style={secondaryButton} onClick={() => { onRemoveFromCanvas(assetId) }}>{t('editor.removeFromCanvas')}</button>
          </div>
        )}
    </>
  )
}

/**
 * A take: its player, the failure reason of a failed take, its model and task, the params that its operation declares
 * with the references, and "渲染新版本"; a take whose operation the list does not name shows no params and no button.
 * @param props - editor props plus the title used in the record intent.
 * @returns the element.
 */
function TakeForm(
  { node, state, operations, taskLabels, versionKinds, client, project, session, t, onRender, onOpenNode, renderSlot, title }:
    NodeEditorProps & { title: string },
): ReactNode {
  const pick = useText()
  const record = node.record
  const declared = operations.find(candidate => candidate.name === record?.operation)
  const [inputs, setInputs] = useState<EditedInput[]>(
    () => record?.inputs.map(input => ({ role: input.role, ref: formatInputRef(input.ref) })) ?? [],
  )
  // The text of each field the user changed; the other fields show the record's params.
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({})
  const fields = declared === undefined ? [] : fieldsOf(declared.params, record?.params)
    .filter(param => !MODEL_KEY.has(param.key)).map(param => ({ ...param, text: texts[param.key] ?? param.text }))
  const [starting, setStarting] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const references = inputs.filter(input => input.role === 'reference')
  const [picking, setPicking] = useState(false)
  const [previewed, setPreviewed] = useState<ProjectAsset | null>(null)
  const chips = useRef<HTMLDivElement | null>(null)
  const assets = new Map(state.assets.map(asset => [asset.id, asset]))
  const addReferences = (refs: readonly string[]): void => {
    setPicking(false)
    const added = refs.filter(ref => !references.some(input => input.ref === ref))
    setInputs([...inputs, ...added.map(ref => ({ role: 'reference', ref }))])
  }
  const operation = record?.operation ?? null
  const model = typeof record?.params['model'] === 'string' ? record.params['model'] : ''
  const task = typeof record?.params['task'] === 'string' ? record.params['task'] : ''
  // Reference chips need a declared `reference` input; a text render (task `t2v`) takes no reference images.
  const withReferences = declared?.inputs['reference'] !== undefined && task !== 't2v'
  const renderTake = (): void => {
    if (record === null || operation === null) return
    let edited: Record<string, unknown>
    try {
      edited = paramsOf(fields)
    } catch (error) {
      // A field whose text does not parse, or an empty required field, starts no render.
      setRenderError(error instanceof Error ? error.message : String(error))
      return
    }
    // The take's other params stay, the model key among them; an emptied field drops its param.
    const kept = Object.entries(record.params).filter(([key]) => !fields.some(param => param.key === key))
    const params = { ...Object.fromEntries(kept), ...edited }
    setStarting(true)
    setRenderError(null)
    // On success the canvas closes the editor and selects the new take.
    onRender({
      project, operation, inputs, params, surface: 'canvas', intent: t('intent.renderTake', { title }), based_on: record.id,
      ...session === null ? {} : { session },
    }).catch((error: unknown) => {
      setStarting(false)
      setRenderError(error instanceof Error ? error.message : String(error))
    })
  }
  // `||` also maps an empty message to null, so a failure without a reason shows no banner.
  const failure = node.flags.failed ? record?.error?.message || null : null
  const fieldOf = (param: FormField): ReactNode => (
    <ParamField key={param.key} param={param} t={t} onText={(text) => { setTexts(current => ({ ...current, [param.key]: text })) }} />
  )
  return (
    <div>
      <Preview node={node} audio={assets.get(node.video ?? '')?.mime.startsWith('audio/') === true} />
      {failure === null
        ? null
        : <p role="note" style={{ margin: 0, padding: '8px 12px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-danger-soft)', color: 'var(--dv-danger)' }}>{t('editor.failure', { message: failure })}</p>}
      <span style={label}>{t('editor.modelTask')}</span>
      <span data-testid="dv-canvas-render-mode">{t('editor.modelTaskValue', { model, task: pick(...taskLabel(task, taskLabels)) })}</span>
      {fields.filter(param => param.key === 'prompt').map(fieldOf)}
      {!withReferences ? null : <><span style={label}>{t('editor.references')}</span><div ref={chips} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {references.map((input) => {
          const shown = refImage(state, versionKinds, input.ref)
          const name = refName(state, versionKinds, input.ref)
          const item = namedItem(state, versionKinds, input.ref)
          const asset = shown === null ? undefined : assets.get(shown)
          // A versioned item opens the editor of its node; an asset opens its preview.
          const open = (): void => {
            if (item !== undefined && item !== null) onOpenNode(item.kind.node(item.id))
            else if (asset !== undefined) setPreviewed(asset)
          }
          return (
            <span key={input.ref} style={chip}>
              <button type="button" data-reference={input.ref} aria-label={t('editor.openReference', { name })} style={chipOpen} onClick={open}>
                <AssetMedia asset={asset} style={{ width: 22, height: 22, borderRadius: 11, objectFit: 'cover' }} />
                {name}
              </button>
              <button type="button" aria-label={t('editor.removeReference', { name })} style={{ border: 'none', background: 'transparent', color: 'var(--dv-text-2)', cursor: 'pointer' }} onClick={() => { setInputs(inputs.filter(other => other !== input)) }}>×</button>
            </span>
          )
        })}
        <button type="button" className="dv-canvas-btn" style={{ ...secondaryButton, height: 28 }} onClick={() => { setPicking(true) }}>{t('editor.addAsset')}</button>
      </div></>}
      {picking
        ? (
          <AssetPicker
            state={state} client={client} project={project} session={session} t={t} kinds={versionKinds}
            chosen={references.map(input => input.ref)} onConfirm={addReferences} onCancel={() => { setPicking(false) }}
            {...renderSlot === undefined ? {} : { renderSlot }}
          />
        )
        : null}
      <AssetPreview
        asset={previewed} onClose={() => { setPreviewed(null) }}
        openerOf={asset => chips.current?.querySelector(`[data-reference="${asset.id}"]`) ?? null}
        {...renderSlot === undefined ? {} : { renderSlot }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12 }}>{fields.filter(param => param.key !== 'prompt').map(fieldOf)}</div>
      {declared === undefined ? null : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 14 }}>
        {renderError === null ? null : <p role="alert" style={{ flex: 1, minWidth: 0, margin: 0, color: 'var(--dv-danger)' }}>{t('error', { message: renderError })}</p>}
        <button
          type="button" className="dv-canvas-soft" disabled={operation === null || starting}
          style={{ ...button, opacity: operation === null || starting ? 0.5 : 1 }} onClick={renderTake}
        >
          {starting ? t('node.rendering') : t('editor.renderTake')}
        </button>
      </div>}
    </div>
  )
}

/**
 * The body of an entry node: the `dv.canvas.editor` entry keyed by its `NodeType.id`, lent the canvas's writes (with
 * the canvas's project, chat session and surface), the asset picker of assets only, and the asset preview.
 * @param props - editor props of an entry node.
 * @returns the element.
 */
function EntryForm(props: NodeEditorProps & { node: Extract<CanvasNode, { type: 'entry' }> }): ReactNode {
  const { node, state, client, project, session, t, run } = props
  const [picking, setPicking] = useState<{ chosen: readonly string[]; onConfirm: (assets: string[]) => void } | null>(null)
  const [previewed, setPreviewed] = useState<ProjectAsset | null>(null)
  // The element that the preview grows out of and shrinks back into.
  const opener = useRef<Element | null>(null)
  const host: EntryEditorHost = {
    run: (request) => { void run(() => client.runOperation({ ...request, project, surface: 'canvas', ...session === null ? {} : { session } })) },
    pickAssets: (chosen, onConfirm) => { setPicking({ chosen, onConfirm }) },
    preview: (assetId, element) => {
      opener.current = element
      setPreviewed(state.assets.find(asset => asset.id === assetId) ?? null)
    },
  }
  return (
    <>
      {props.renderSlot?.('dv.canvas.editor', { node: node.entry, state, host }, { entryKey: node.nodeType.id })}
      {picking === null
        ? null
        : (
          <AssetPicker
            state={state} client={client} project={project} session={session} t={t} kinds={[]} chosen={picking.chosen}
            onConfirm={(assets) => { setPicking(null); picking.onConfirm(assets) }} onCancel={() => { setPicking(null) }}
            {...props.renderSlot === undefined ? {} : { renderSlot: props.renderSlot }}
          />
        )}
      <AssetPreview
        asset={previewed} onClose={() => { setPreviewed(null) }} openerOf={() => opener.current}
        {...props.renderSlot === undefined ? {} : { renderSlot: props.renderSlot }}
      />
    </>
  )
}
