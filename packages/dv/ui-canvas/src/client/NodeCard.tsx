/**
 * The chrome of one canvas node on the `--dv-*` theme variables: a caption above a frame. The caption is one line with
 * the title, or the name field while the node is renamed, the unseen dot, the stale tag, the version count of a node
 * with several versions, and `meta`. The frame is a rounded outline that wears the selection ring and holds the
 * `dv.canvas.card` body, which paints its own fill, or, for a node whose newest version failed, the failed words and
 * actions on the card surface. A node with several versions has two offset frames behind its frame. The selected node
 * has a resize handle at each corner of its frame. {@link NodeMenu} draws a node's right-click menu. The chrome names
 * no node type.
 */
import { useCallback, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, MutableRefObject, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { formatElapsed, useElapsedSeconds } from '@dv/ui-kit/elapsed.ts'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import { InlineRename } from '@dv/ui-kit/InlineRename.tsx'
import type { InlineRenameProps } from '@dv/ui-kit/InlineRename.tsx'
import { CAPTION_HEIGHT } from '../canvas-layout.ts'
import type { NodePosition } from '../canvas-layout.ts'
import type { NodeAction, NodeView, Size } from './contract/index.ts'
import type { CanvasNode } from './graph.ts'
import type {} from './locales.ts'
import type { ResizeCorner } from './resize.ts'

/** The canvas namespace translate. */
export type CanvasTranslate = TranslateNS<'dvCanvas'>

/**
 * The node height at base text size, caption + frame, computed from the frame size without measuring the node.
 * @param frame - the frame size in canvas units.
 * @returns the height in canvas units.
 */
export function cardHeight(frame: Pick<Size, 'height'>): number {
  return CAPTION_HEIGHT + frame.height
}

/**
 * The height where edges meet a node, below its top: the middle of the frame under the caption at the zoom.
 * @param frame - the frame size in canvas units.
 * @param zoom - the canvas zoom.
 * @returns the offset in canvas units.
 */
export function edgeAnchorY(frame: Pick<Size, 'height'>, zoom: number): number {
  return Math.round(CAPTION_HEIGHT * captionScaleAt(zoom)) + frame.height / 2
}

const CORNERS: readonly ResizeCorner[] = ['nw', 'ne', 'sw', 'se']
/** How far each frame behind a node with several versions sits up and right of the one in front, in canvas units. */
const VERSION_OFFSET = 4
/** The side of a handle square that overhangs the frame's corner, in canvas units. */
const HANDLE_SIZE = 10

/** The zoom at and above which node text keeps its base size; below it text scales up to stay readable. */
const READABLE_ZOOM = 0.8
/** The largest text enlargement, reached near the minimum zoom. */
const MAX_TEXT_SCALE = 2.6

/**
 * The text enlargement of node text at a canvas zoom.
 * @param zoom - the canvas zoom.
 * @returns the enlargement factor.
 */
export function textScaleAt(zoom: number): number {
  return Math.min(MAX_TEXT_SCALE, Math.max(1, READABLE_ZOOM / zoom))
}

/**
 * The largest caption enlargement. A caption grows into the free space above its node, which the node positions keep
 * fixed, so it grows at most 8 units.
 */
const MAX_CAPTION_SCALE = 1.4
/** The smallest caption font size on screen, in screen pixels; a node hides a caption that would render smaller. */
const MIN_CAPTION_PX = 8

/**
 * The caption enlargement at a canvas zoom: the text enlargement up to {@link MAX_CAPTION_SCALE}.
 * @param zoom - the canvas zoom.
 * @returns the enlargement factor.
 */
function captionScaleAt(zoom: number): number {
  return Math.min(MAX_CAPTION_SCALE, textScaleAt(zoom))
}

export const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
export const mono: CSSProperties = { fontFamily: 'var(--dv-font-mono)', fontVariantNumeric: 'tabular-nums' }

/** Props of {@link NodeCard}. */
export interface NodeCardProps {
  node: CanvasNode
  /** The node as its card body and actions receive it. */
  view: NodeView
  /** The node's stored position and frame size. */
  box: NodePosition
  selected: boolean
  /** The canvas zoom; text grows in canvas units below {@link READABLE_ZOOM} so it stays legible on screen. */
  zoom: number
  t: CanvasTranslate
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  /** A press on one of the selected node's corner handles, which the card keeps from `onPointerDown`. */
  onResizeDown: (corner: ResizeCorner, event: ReactPointerEvent<HTMLElement>) => void
  /** The body: the `dv.canvas.card` entry of the node's type. */
  body: ReactNode
  /** For a node whose newest version failed, the actions that show on it; empty when the canvas is read-only. */
  failedActions: readonly NodeAction[]
  /** The action whose rerun the node waits for, whose button reads the running words; null for none. */
  rerunningAction: string | null
  onAction: (action: NodeAction) => void
  /** The name field that replaces the title while the node is renamed on the canvas; null for none. */
  rename: Omit<InlineRenameProps, 'value'> | null
}

/**
 * The node: the caption above the frame, and on the selected node a handle at each corner of the frame.
 * @param props - the node, its position and frame size, the canvas zoom, the body, and the gesture and action callbacks.
 * @returns the element.
 */
export function NodeCard(props: NodeCardProps): ReactNode {
  const { node, view, box, selected, zoom, t } = props
  const { flags } = node
  const elapsed = useElapsedSeconds(node.record.started_at, flags.rendering && node.record.status === 'running')
  const scale = textScaleAt(zoom)
  const size = (base: number): number => Math.round(base * scale)
  const text = (base: 12 | 13): CSSProperties => ({ fontSize: size(base), lineHeight: `${String(size({ 12: 16, 13: 20 }[base]))}px` })
  const captionScale = captionScaleAt(zoom)
  const captionSize = (base: number): number => Math.round(base * captionScale)
  const captionText: CSSProperties = { fontSize: captionSize(12), lineHeight: `${String(captionSize(16))}px` }
  const failed = flags.failed
  // A selected frame wears the accent ring; a stale frame a danger outline; a failed frame the soft outline; any other
  // frame the plain outline.
  let ring = '0 0 0 1px var(--dv-line-strong)'
  if (selected) ring = '0 0 0 2px var(--dv-accent), 0 0 0 6px var(--dv-accent-soft)'
  else if (flags.stale) ring = '0 0 0 1px var(--dv-danger)'
  else if (failed) ring = '0 0 0 1px var(--dv-line)'
  const style: CSSProperties = {
    position: 'absolute', left: box.x, top: box.y, width: box.width, boxSizing: 'border-box', color: 'var(--dv-text)', cursor: 'grab', userSelect: 'none',
    opacity: flags.superseded ? 0.55 : 1, touchAction: 'none',
  }
  const status = node.nodeType.status
  const running = status?.running() ?? t('node.running')
  let marker: ReactNode = null
  let failedText: string | undefined
  if (flags.rendering) {
    if (node.record.status === 'pending') marker = t('node.queued')
    else if (elapsed === null) marker = running
    // One span, because the overlay is a flex box that drops a whitespace-only text node between its items.
    else marker = <span>{running} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsed)}</span></span>
  } else if (flags.failed) {
    const failedWords = status?.failed() ?? t('node.failed')
    const reason = node.record.error?.message
    failedText = reason === undefined || reason === '' ? failedWords : t('node.failedReason', { status: failedWords, reason })
    marker = failedText
  }
  const count = node.versions.length
  const meta = [count > 1 ? t('node.version', { n: String(count) }) : '', node.meta ?? ''].filter(part => part !== '').join(' · ')
  const caption = (
    <div style={{ ...captionText, height: captionSize(CAPTION_HEIGHT), boxSizing: 'border-box', padding: '0 2px 4px', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--dv-text-2)', visibility: 12 * captionScale * zoom < MIN_CAPTION_PX ? 'hidden' : undefined }}>
      {props.rename === null
        ? <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{node.title}</span>
        : (
          <InlineRename
            {...props.rename} value={node.title}
            style={{ ...captionText, height: captionSize(CAPTION_HEIGHT - 4), boxSizing: 'border-box', padding: `0 ${String(captionSize(4))}px`, border: '1px solid var(--dv-accent)', borderRadius: 'var(--dv-radius-sm)', background: 'var(--dv-surface-1)', color: 'var(--dv-text)', fontFamily: 'inherit', outline: 'none' }}
          />
        )}
      {view.unseen
        ? <span role="img" aria-label={t('node.unseen')} title={t('node.unseen')} style={{ flex: 'none', width: captionSize(8), height: captionSize(8), borderRadius: 9999, background: 'var(--dv-accent)' }} />
        : null}
      {flags.stale ? <span style={{ flex: 'none', color: 'var(--dv-danger)' }}>{t('node.stale')}</span> : null}
      {meta === '' ? null : <span style={{ ...mono, flex: 'none' }}>{meta}</span>}
    </div>
  )
  let content: ReactNode
  if (failed) {
    content = (
      <div style={{ ...CARD_SURFACE, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: 6, padding: '0 10px' }}>
        {/* oxlint-disable-next-line typescript/no-deprecated -- Browsers clamp lines only on a vertical -webkit-box. */}
        <span title={failedText} style={{ ...text(12), display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden', overflowWrap: 'anywhere', color: 'var(--dv-danger)' }}>{marker}</span>
        {props.failedActions.length === 0
          ? null
          : (
            <div style={{ display: 'flex', gap: 6 }}>
              {props.failedActions.map(action => (
                <button
                  key={action.id} type="button" className="dv-canvas-btn" disabled={view.rerunning}
                  style={{ fontFamily: 'inherit', ...text(12), flex: 'none', height: 20, padding: '0 6px', border: '1px solid var(--dv-line-strong)', borderRadius: 'var(--dv-radius-sm)', color: 'var(--dv-text)', cursor: view.rerunning ? 'default' : 'pointer', opacity: view.rerunning ? 0.6 : 1 }}
                  onPointerDown={(event) => { event.stopPropagation() }}
                  onClick={() => { props.onAction(action) }}
                >
                  {action.id === props.rerunningAction ? running : action.label()}
                </button>
              ))}
            </div>
          )}
      </div>
    )
  } else {
    content = (
      <>
        <div style={{ position: 'relative', height: box.height }}>
          {props.body}
          {marker !== null
            ? <span style={{ ...text(13), position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dv-overlay)', color: 'var(--dv-text)', fontWeight: 500 }}>{marker}</span>
            : null}
          {node.badges.length === 0
            ? null
            : (
              <span style={{ position: 'absolute', left: 6, bottom: 6, display: 'flex', gap: 4 }}>
                {node.badges.map(badge => <span key={badge} style={{ ...text(12), padding: '0 6px', borderRadius: 'var(--dv-radius-sm)', background: 'var(--dv-surface-3)', color: 'var(--dv-text-2)' }}>{badge}</span>)}
              </span>
            )}
        </div>
      </>
    )
  }
  return (
    <div
      style={style}
      data-node-id={node.id}
      data-node-type={node.type}
      data-node-stale={String(flags.stale)}
      data-node-selected={selected ? 'true' : undefined}
      data-node-unseen={view.unseen ? 'true' : undefined}
      onPointerDown={props.onPointerDown}
      role="button"
      tabIndex={0}
      aria-label={node.title}
      title={failed ? node.record.error?.message : undefined}
    >
      {caption}
      {count > 1
        ? [2, 1].map(step => (
          <div
            key={step} aria-hidden="true" data-node-version-frame=""
            style={{ position: 'absolute', left: step * VERSION_OFFSET, top: captionSize(CAPTION_HEIGHT) - step * VERSION_OFFSET, width: '100%', height: box.height, boxSizing: 'border-box', borderRadius: 'var(--dv-radius-lg)', background: 'var(--dv-surface-2)', boxShadow: '0 0 0 1px var(--dv-line-strong)', opacity: step === 2 ? 0.5 : 0.8 }}
          />
        ))
        : null}
      <div data-node-frame="" style={{ position: 'relative', height: box.height, overflow: 'hidden', borderRadius: 'var(--dv-radius-lg)', boxShadow: ring }}>
        {content}
      </div>
      {selected
        ? CORNERS.map(corner => (
          <span
            key={corner}
            role="button"
            aria-label={t('node.resize')}
            title={t('node.resize')}
            data-node-handle={corner}
            style={{
              position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE, boxSizing: 'border-box', borderRadius: 2,
              background: 'var(--dv-surface-1)', border: '2px solid var(--dv-accent)', touchAction: 'none',
              cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
              ...corner.startsWith('n') ? { top: captionSize(CAPTION_HEIGHT) - HANDLE_SIZE / 2 } : { bottom: -HANDLE_SIZE / 2 },
              ...corner.endsWith('w') ? { left: -HANDLE_SIZE / 2 } : { right: -HANDLE_SIZE / 2 },
            }}
            onPointerDown={(event) => { event.stopPropagation(); props.onResizeDown(corner, event) }}
          />
        ))
        : null}
    </div>
  )
}

/**
 * The fallback body of a node type without a `dv.canvas.card` entry: its type label on the card surface.
 * @param props - the node's type label and the text scale.
 * @returns the element.
 */
export function TypeLabelBody({ label, textScale }: { label: string; textScale: number }): ReactNode {
  return <span style={{ ...CARD_SURFACE, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: Math.round(12 * textScale), color: 'var(--dv-text-2)' }}>{label}</span>
}

/** One item of a node's right-click menu. */
export interface NodeMenuItem {
  id: string
  label: string
  /** Draws the item in the danger color, for an item that takes something away. */
  danger?: boolean
  /** The key that does the same on the selected node: the glyph at the item's end and its `aria-keyshortcuts`. */
  shortcut?: { glyph: string; keys: string }
  disabled?: boolean
  run: () => void
}

/** Props of {@link NodeMenu}. */
export interface NodeMenuProps {
  /** Where the right click landed, in px from the canvas area's top-left corner. */
  at: { x: number; y: number }
  /** The size of the canvas area, which the menu stays inside. */
  area: { width: number; height: number }
  items: readonly NodeMenuItem[]
  /** The menu's accessible name. */
  label: string
  /** The menu element, so the canvas can tell a press inside it from one outside. */
  menuRef: MutableRefObject<HTMLDivElement | null>
}

/** The space in px the menu keeps from the canvas area's edges. */
const MENU_MARGIN = 8

/**
 * A node's right-click menu, in the timeline tab menu's style: one row per item, opening at the pointer and moved left
 * or up of it when the canvas area has no room on the right or below.
 * @param props - the click point, the canvas area, the items, the label and the menu ref.
 * @returns the element.
 */
export function NodeMenu({ at, area, items, label, menuRef }: NodeMenuProps): ReactNode {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  // The menu draws once at the pointer, then moves by its measured size; the canvas mounts a new menu per right click.
  const attach = useCallback((element: HTMLDivElement | null) => {
    menuRef.current = element
    if (element !== null) setSize({ width: element.offsetWidth, height: element.offsetHeight })
  }, [menuRef])
  const fit = (point: number, extent: number, room: number): number =>
    point + extent + MENU_MARGIN <= room ? point : Math.max(MENU_MARGIN, point - extent)
  const left = size === null ? at.x : fit(at.x, size.width, area.width)
  const top = size === null ? at.y : fit(at.y, size.height, area.height)
  return (
    <div
      ref={attach} role="menu" aria-label={label} data-testid="dv-canvas-node-menu"
      style={{ position: 'absolute', left, top, zIndex: 12, minWidth: 180, padding: 6, boxSizing: 'border-box', background: 'var(--dv-surface-1)', boxShadow: '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-2)', outline: '1px solid transparent', borderRadius: 'var(--dv-radius-menu)' }}
      onPointerDown={(event) => { event.stopPropagation() }}
      onContextMenu={(event) => { event.preventDefault() }}
    >
      {items.map(item => (
        <button
          key={item.id} type="button" role="menuitem" className="dv-canvas-btn" disabled={item.disabled}
          aria-keyshortcuts={item.shortcut?.keys}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', height: 32, padding: '0 10px', border: 'none', borderRadius: 'var(--dv-radius-md)', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', textAlign: 'left', cursor: item.disabled === true ? 'default' : 'pointer', opacity: item.disabled === true ? 0.6 : 1, color: item.danger === true ? 'var(--dv-danger)' : 'var(--dv-text)' }}
          onClick={item.run}
        >
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.shortcut === undefined ? null : <span aria-hidden="true" style={{ ...mono, fontSize: 12, color: 'var(--dv-text-2)' }}>{item.shortcut.glyph}</span>}
        </button>
      ))}
    </div>
  )
}
