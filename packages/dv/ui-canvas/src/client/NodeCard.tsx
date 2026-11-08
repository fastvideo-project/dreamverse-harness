/**
 * The chrome of one canvas node on the `--dv-*` theme variables: a caption above a frame. The caption is one line with
 * the title, the unseen dot, the stale tag, the version count of a node with several versions, and `meta`. The frame is
 * a rounded outline that wears the selection ring and holds the `dv.canvas.card` body, which paints its own fill, or,
 * for a node whose newest version failed, the failed words and actions on the card surface. A node with several
 * versions has two offset frames behind its frame. The selected node has a resize handle at each corner of its frame.
 * The chrome names no node type.
 */
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
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
 * The height where edges meet a node, below its top: the middle of the frame under the caption at the text scale.
 * @param frame - the frame size in canvas units.
 * @param textScale - the text enlargement ({@link textScaleAt}).
 * @returns the offset in canvas units.
 */
export function edgeAnchorY(frame: Pick<Size, 'height'>, textScale: number): number {
  return Math.round(CAPTION_HEIGHT * textScale) + frame.height / 2
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
}

/**
 * The node: the caption above the frame, and on the selected node a handle at each corner of the frame.
 * @param props - the node, its position and frame size, the canvas zoom, the body, and the gesture and action callbacks.
 * @returns the element.
 */
export function NodeCard(props: NodeCardProps): ReactNode {
  const { node, view, box, selected, zoom, t } = props
  const { flags } = node
  const scale = textScaleAt(zoom)
  const size = (base: number): number => Math.round(base * scale)
  const text = (base: 12 | 13): CSSProperties => ({ fontSize: size(base), lineHeight: `${String(size({ 12: 16, 13: 20 }[base]))}px` })
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
  let marker: string | null = null
  if (flags.rendering) marker = running
  else if (flags.failed) marker = status?.failed() ?? t('node.failed')
  const count = node.versions.length
  const meta = [count > 1 ? t('node.version', { n: String(count) }) : '', node.meta ?? ''].filter(part => part !== '').join(' · ')
  const caption = (
    <div style={{ ...text(12), height: size(CAPTION_HEIGHT), boxSizing: 'border-box', padding: '0 2px 4px', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--dv-text-2)' }}>
      <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{node.title}</span>
      {view.unseen
        ? <span role="img" aria-label={t('node.unseen')} title={t('node.unseen')} style={{ flex: 'none', width: size(8), height: size(8), borderRadius: 9999, background: 'var(--dv-accent)' }} />
        : null}
      {flags.stale ? <span style={{ flex: 'none', color: 'var(--dv-danger)' }}>{t('node.stale')}</span> : null}
      {meta === '' ? null : <span style={{ ...mono, flex: 'none' }}>{meta}</span>}
    </div>
  )
  let content: ReactNode
  if (failed) {
    content = (
      <div style={{ ...CARD_SURFACE, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px' }}>
        <span style={{ ...text(12), flex: 1, minWidth: 0, color: 'var(--dv-danger)', ...ellipsis }}>{marker}</span>
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
            style={{ position: 'absolute', left: step * VERSION_OFFSET, top: size(CAPTION_HEIGHT) - step * VERSION_OFFSET, width: '100%', height: box.height, boxSizing: 'border-box', borderRadius: 'var(--dv-radius-lg)', background: 'var(--dv-surface-2)', boxShadow: '0 0 0 1px var(--dv-line-strong)', opacity: step === 2 ? 0.5 : 0.8 }}
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
              ...corner.startsWith('n') ? { top: size(CAPTION_HEIGHT) - HANDLE_SIZE / 2 } : { bottom: -HANDLE_SIZE / 2 },
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
