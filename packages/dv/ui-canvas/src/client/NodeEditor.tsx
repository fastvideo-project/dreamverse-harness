/**
 * The editor shell that a canvas node opens: a movable, resizable panel over a dimmed canvas. One position and size,
 * shared by every node, is kept in `localStorage` and fitted into the canvas when restored. The body is the entry of
 * the node's type in `dv.canvas.editor`; a type without an entry shows only the header. A node with several versions
 * shows a version strip above the body: selecting a version shows it in the editor, and the card keeps the newest. The
 * header shows the node's type and newest version above its title; a click on the title, or F2 on the canvas, turns the
 * title into the name field. The header's trash button removes the node from the canvas. A node whose type has `open`
 * has no editor body, so its editor is the name panel: a small fixed panel with the node's type, its name and a close
 * button, which closes when the name field does.
 */
import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { InlineRename } from '@dv/ui-kit/InlineRename.tsx'
import type { InlineRenameProps } from '@dv/ui-kit/InlineRename.tsx'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { readStored, writeStored } from '@dv/ui-kit/storage.ts'
import { AssetPicker } from './AssetPicker.tsx'
import type { CardHost, EditorHost, NodeAction, NodeHost, NodeView } from './contract/index.ts'
import { previewOf } from './graph.ts'
import type { CanvasNode } from './graph.ts'
import type { CanvasTranslate } from './NodeCard.tsx'

/** Renders the slots that the canvas's editors show: the `renderSlot` of the `dv.canvas` Factory. */
export type RenderCanvasSlot = PropsRenderSlots<
  'dv.canvas.card' | 'dv.canvas.editor' | 'dv.canvas.picker'
>['renderSlot']

/** The hosts that the canvas lends one surface. */
export interface SurfaceHosts {
  card: CardHost
  /** The node host of one action, whose rerun the canvas attributes to that action. */
  action: (id: string) => NodeHost
  editor: Omit<EditorHost, 'pickAssets'>
}

/** Props of {@link NodeEditor}. */
export interface NodeEditorProps extends PropsRenderFactories {
  node: CanvasNode
  /** The node as its editor body and actions receive it. */
  view: NodeView
  /** The node at one of its versions, for the version strip. */
  viewAt: (record: string) => NodeView
  state: WireState
  operations: readonly WireOperation[]
  /** The registered version kinds, whose items the picker lists when a body asks for them. */
  versionKinds: readonly VersionKind[]
  /** The node actions that show on the node. */
  actions: readonly NodeAction[]
  project: string
  session: string | null
  t: CanvasTranslate
  /** The hosts of the header's actions and of the body; the editor adds its own asset picker to the body's. */
  hosts: SurfaceHosts
  /** Keep a stale record as it is. */
  onAcceptStale: (record: string) => void
  /** Remove the node from the canvas, after the user confirms. */
  onRemove: () => void
  /** The name field that replaces the title while the node is renamed in the editor; null for none. */
  rename: Omit<InlineRenameProps, 'value'> | null
  /** Turn the title into the name field. */
  onRename: () => void
  onClose: () => void
  /** The zoom transition's ref for the panel, which grows out of the node and shrinks back into it. */
  zoomRef: (element: HTMLElement | null) => void
  /** The size of the canvas area that the panel sits in, which the canvas measures. */
  area: EditorArea
  renderSlot: RenderCanvasSlot
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
const button: CSSProperties = {
  height: 32, border: 'none', borderRadius: 'var(--dv-radius-md)', padding: '0 12px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', fontWeight: 500,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
/** A secondary button: 1px border, transparent fill (the `dv-canvas-btn` class paints the fill and the hover). */
const secondaryButton: CSSProperties = { ...button, border: '1px solid var(--dv-line-strong)', color: 'var(--dv-text)' }
const titleText: CSSProperties = { fontFamily: 'inherit', fontSize: 16, lineHeight: '24px', fontWeight: 600, color: 'var(--dv-text)' }

/** What {@link useEditorPlacement} gives the panel. */
interface EditorPlacement {
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
 * The panel's place in the canvas area and the gestures that change it.
 * @param area - the canvas area.
 * @returns the rectangle on show and the gesture handlers.
 */
function useEditorPlacement(area: EditorArea): EditorPlacement {
  // Null shows the default rectangle; a move, a resize, or a remembered rectangle replaces it.
  const [placed, setPlaced] = useState<EditorRect | null>(() => {
    const remembered = readEditorRect()
    return remembered === null ? null : fitEditorRect(remembered, area)
  })
  const gesture = useRef<PanelGesture | null>(null)
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
  return { rect, begin, follow, finish, reset, resizeBy }
}

/** The arrow keys of the resize handle and the width and height change each one makes. */
const RESIZE_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [RESIZE_STEP, 0], ArrowLeft: [-RESIZE_STEP, 0], ArrowDown: [0, RESIZE_STEP], ArrowUp: [0, -RESIZE_STEP],
}

interface Picking {
  chosen: readonly string[]
  versions: boolean
  onConfirm: (refs: string[]) => void
}

/**
 * The editor of a node: the name panel for a node whose type has `open`, which has no editor body, else the editor
 * panel.
 * @param props - the node, the state it came from, its actions, the canvas host and the slot renderers.
 * @returns the element.
 */
export function NodeEditor(props: NodeEditorProps): ReactNode {
  return props.node.nodeType.open === undefined ? <EditorPanel {...props} /> : <NamePanel {...props} />
}

/** The width of the name panel, in px; a narrower canvas area leaves the 24 px margins. */
const NAME_PANEL_WIDTH = 360
/** The height of the name panel with the hint line under its field, in px, which centers the panel in the canvas area. */
const NAME_PANEL_HEIGHT = 108
/** The box that the name field and the title it replaces share, so both sit at the same place and size. */
const nameBox: CSSProperties = {
  flex: 1, minWidth: 0, height: 32, boxSizing: 'border-box', padding: '0 5px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-1)',
  fontFamily: 'inherit', fontSize: 14, lineHeight: '20px', fontWeight: 500, color: 'var(--dv-text)',
}

/**
 * The name panel: a small fixed panel in the middle of the canvas area with the node's type, its name, and a close
 * button. The name is a field while the node is renamed, and the panel closes when the field does; otherwise a click
 * on the name turns it into the field. The type line, the name and the hint under the field start at the same left
 * edge.
 * @param props - the node, its view, the name field, and the close callback.
 * @returns the element.
 */
function NamePanel({ node, view, t, area, rename, onRename, onClose, zoomRef }: NodeEditorProps): ReactNode {
  const width = Math.max(0, Math.min(NAME_PANEL_WIDTH, area.width - 2 * EDITOR_MARGIN))
  const place: CSSProperties = {
    left: Math.round((area.width - width) / 2), top: Math.max(0, Math.round((area.height - NAME_PANEL_HEIGHT) / 2)), width,
    // The hint line sits under the field, inside the panel.
    padding: rename === null ? 16 : '16px 16px 36px', gap: 8,
  }
  return (
    <section
      ref={zoomRef} style={{ ...panel, ...place }} role="dialog" aria-label={view.title} data-testid="dv-canvas-node-editor" data-name-panel=""
      data-dv-scroll-island="" onPointerDown={(event) => { event.stopPropagation() }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: node.nodeType.color }} />
        {`${node.nodeType.label()} · ${t('node.rename')}`}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {rename === null
          ? (
            <button
              type="button" className="dv-canvas-title" title={t('node.rename')} data-testid="dv-canvas-editor-title" onClick={onRename}
              style={{ ...nameBox, border: '1px solid var(--dv-line-strong)', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'text' }}
            >
              {view.title}
            </button>
          )
          : (
            <InlineRename
              {...rename} value={view.title} onClose={() => { rename.onClose(); onClose() }}
              style={{ ...nameBox, border: '1px solid var(--dv-accent)', outline: 'none' }}
            />
          )}
        <button type="button" className="dv-canvas-btn" aria-label={t('editor.close')} title={t('editor.close')} style={{ ...button, flex: 'none', width: 32, padding: 0, color: 'var(--dv-text-2)' }} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </section>
  )
}

/**
 * The editor panel.
 * @param props - the node, the state it came from, its actions, the canvas host and the slot renderers.
 * @returns the element.
 */
function EditorPanel(props: NodeEditorProps): ReactNode {
  const { node, t, onClose } = props
  const [chosen, setChosen] = useState(node.record.id)
  // A version that leaves the node, such as after an undo, gives way to the newest.
  const version = node.versions.includes(chosen) ? chosen : node.record.id
  const view = version === node.record.id ? props.view : props.viewAt(version)
  const title = view.title
  const type = `${node.nodeType.label()} · ${t('node.version', { n: String(node.versions.length) })}`
  const staleRecord = view.flags.stale ? view.record : null
  const placement = useEditorPlacement(props.area)
  const [picking, setPicking] = useState<Picking | null>(null)
  const host: EditorHost = {
    ...props.hosts.editor,
    pickAssets: (chosen, options, onConfirm) => { setPicking({ chosen, versions: options.versions, onConfirm }) },
  }
  const { rect, begin, follow, finish, reset, resizeBy } = placement
  const gestureHandlers = { onPointerMove: follow, onPointerUp: finish, onPointerCancel: finish }
  const onResizeKey = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const step = RESIZE_KEYS[event.key]
    if (step === undefined) return
    event.preventDefault()
    resizeBy(step[0], step[1])
  }
  return (
    <section
      ref={props.zoomRef}
      style={{ ...panel, left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      role="dialog" aria-label={title} data-testid="dv-canvas-node-editor" data-dv-scroll-island="" onPointerDown={(event) => { event.stopPropagation() }}
      // F2 in the asset picker renames nothing.
      onKeyDown={(event) => { if (event.key === 'F2' && picking !== null) event.stopPropagation() }}
    >
      <header style={{ flex: 'none', padding: '16px 16px 12px 20px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--dv-line)' }}>
        <div
          data-testid="dv-canvas-editor-title-row" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'move', touchAction: 'none', userSelect: 'none' }}
          onPointerDown={begin(null)} {...gestureHandlers}
          onDoubleClick={(event) => { if (!(event.target instanceof Element && event.target.closest('button, input') !== null)) reset() }}
        >
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: node.nodeType.color }} />
              {type}
            </span>
            {props.rename === null
              ? (
                <h2 style={{ alignSelf: 'flex-start', maxWidth: 'calc(100% + 6px)', margin: '0 0 0 -6px', ...titleText }}>
                  <button
                    type="button" className="dv-canvas-title" title={t('node.rename')} data-testid="dv-canvas-editor-title" onClick={props.onRename}
                    style={{ ...titleText, maxWidth: '100%', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px', border: 'none', borderRadius: 'var(--dv-radius-sm)', cursor: 'text' }}
                  >
                    <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.57} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', color: 'var(--dv-text-2)' }}><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" /></svg>
                  </button>
                </h2>
              )
              : (
                <InlineRename
                  {...props.rename} value={props.view.title}
                  style={{ ...titleText, height: 26, boxSizing: 'border-box', margin: '-1px -6px', padding: '0 5px', border: '1px solid var(--dv-accent)', borderRadius: 'var(--dv-radius-sm)', background: 'var(--dv-surface-1)', outline: 'none' }}
                />
              )}
          </div>
          {props.actions.map(action => (
            <button key={action.id} type="button" className="dv-canvas-soft" style={button} disabled={view.rerunning} onClick={() => { action.run(view, props.hosts.action(action.id)) }}>{action.label()}</button>
          ))}
          <button type="button" className="dv-canvas-btn dv-canvas-danger" aria-label={t('node.remove')} title={t('node.remove')} style={{ ...button, width: 32, padding: 0 }} onClick={props.onRemove}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
          </button>
          <button type="button" className="dv-canvas-btn" aria-label={t('editor.close')} title={t('editor.close')} style={{ ...button, width: 32, padding: 0, color: 'var(--dv-text-2)' }} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
        {staleRecord !== null
          ? (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px', color: 'var(--dv-danger)' }}>
              {t('node.stale')}
              <button type="button" className="dv-canvas-btn" style={{ ...secondaryButton, height: 28 }} onClick={() => { props.onAcceptStale(staleRecord.id) }}>
                {t('editor.keepAnyway')}
              </button>
            </p>
          )
          : null}
        {node.versions.length > 1
          ? (
            <VersionStrip
              node={node} version={version} viewAt={props.viewAt} state={props.state} t={t} onChoose={setChosen}
              renderFactorySlot={props.renderFactorySlot}
            />
          )
          : null}
        {/* Each version mounts its own body, so a draft of one version never carries over to another. */}
        <div key={version}>{props.renderSlot('dv.canvas.editor', { node: view, state: props.state, operations: props.operations, host }, { entryKey: node.type })}</div>
      </div>
      {picking === null
        ? null
        : (
          <AssetPicker
            state={props.state} project={props.project} session={props.session} t={t} kinds={picking.versions ? props.versionKinds : []}
            chosen={picking.chosen} onCancel={() => { setPicking(null) }}
            onConfirm={(refs) => { setPicking(null); picking.onConfirm(refs) }}
            renderSlot={props.renderSlot} renderFactorySlot={props.renderFactorySlot}
          />
        )}
      {/* Thin strips on the right and bottom edges resize one dimension; the corner button resizes both and takes arrow keys. */}
      <div aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 16, width: 4, cursor: 'ew-resize', touchAction: 'none' }} onPointerDown={begin({ right: true, bottom: false })} {...gestureHandlers} />
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 16, bottom: 0, height: 4, cursor: 'ns-resize', touchAction: 'none' }} onPointerDown={begin({ right: false, bottom: true })} {...gestureHandlers} />
      <button
        type="button" className="dv-canvas-btn" aria-label={t('editor.resize')} title={t('editor.resize')} data-testid="dv-canvas-editor-resize"
        style={{ position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, padding: 0, border: 'none', borderRadius: 'var(--dv-radius-sm)', color: 'var(--dv-text-3)', cursor: 'nwse-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onPointerDown={begin({ right: true, bottom: true })} {...gestureHandlers} onKeyDown={onResizeKey}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true"><path d="M9 3 3 9M9 6.5 6.5 9" /></svg>
      </button>
    </section>
  )
}

/** Props of {@link VersionStrip}. */
interface VersionStripProps extends PropsRenderFactories {
  node: CanvasNode
  /** The version on show in the editor. */
  version: string
  viewAt: (record: string) => NodeView
  state: WireState
  t: CanvasTranslate
  onChoose: (record: string) => void
}

/**
 * The versions of a node as thumbnails in time order, the one on show outlined, and which version the editor shows.
 * @param props - the node, the version on show, the version views, the state for the thumbnails, and the choice.
 * @returns the element.
 */
function VersionStrip({ node, version, viewAt, state, t, onChoose, renderFactorySlot }: VersionStripProps): ReactNode {
  const index = node.versions.indexOf(version)
  const thumb: CSSProperties = {
    position: 'relative', flex: 'none', width: 56, height: 40, padding: 0, borderRadius: 'var(--dv-radius-sm)', overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dv-surface-3)', color: 'var(--dv-text-2)',
    border: 'none', cursor: 'pointer', fontFamily: 'var(--dv-font-mono)', fontSize: 12,
  }
  return (
    <div data-testid="dv-canvas-version-strip" style={{ margin: '0 0 12px' }}>
      <span style={{ display: 'block', fontSize: 12, lineHeight: '16px', fontWeight: 500, color: 'var(--dv-text-2)', margin: '0 0 6px' }}>{t('editor.versions')}</span>
      <div role="listbox" aria-label={t('editor.versions')} style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        {node.versions.map((record, at) => {
          const each = record === node.record.id ? node : viewAt(record)
          const preview = previewOf(each)
          const asset = preview === null ? undefined : state.assets.find(candidate => candidate.id === preview)
          const label = t('node.version', { n: String(at + 1) })
          return (
            <button
              key={record} type="button" role="option" aria-selected={record === version} aria-label={label} title={label} data-version={record}
              style={{ ...thumb, boxShadow: record === version ? '0 0 0 2px var(--dv-accent)' : '0 0 0 1px var(--dv-line)' }}
              onClick={() => { onChoose(record) }}
            >
              {asset === undefined ? label : renderFactorySlot('dv.media', { asset, purpose: 'thumb' })}
            </button>
          )
        })}
      </div>
      <span style={{ display: 'block', marginTop: 6, fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }}>
        {t('editor.versionOf', { i: String(index + 1), n: String(node.versions.length) })}
      </span>
    </div>
  )
}
