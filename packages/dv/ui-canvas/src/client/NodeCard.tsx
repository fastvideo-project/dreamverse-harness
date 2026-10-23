/**
 * The chrome of one canvas node on the `--dv-*` theme variables: the header row, then the failure row of a failed
 * claimed node or the frame grid and the `dv.canvas.card` body of any other node. The chrome names no node type.
 */
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { NodeAction, NodeView } from './contract/index.ts'
import { NODE_WIDTH } from './graph.ts'
import type { CanvasNode } from './graph.ts'
import type {} from './locales.ts'

/** The canvas namespace translate. */
export type CanvasTranslate = TranslateNS<'dvCanvas'>

/** Height of the chrome header row at base text size. */
export const HEADER_HEIGHT = 30
/** Height of the frame grid of a node with slots, when a slot has a frame. */
export const GRID_HEIGHT = 64
/** Height of the failed row of a failed claimed node. */
export const FAILED_ROW_HEIGHT = 22

/**
 * The card height at base text size, computed from the node without measuring the card.
 * @param node - the node.
 * @param hasFrames - for a node with slots, whether its frame grid shows.
 * @returns the height in canvas units.
 */
export function cardHeight(node: Pick<CanvasNode, 'claimed' | 'flags' | 'slots' | 'bodyHeight'>, hasFrames = false): number {
  if (node.claimed && node.flags.failed) return HEADER_HEIGHT + FAILED_ROW_HEIGHT
  return HEADER_HEIGHT + (node.slots !== undefined && hasFrames ? GRID_HEIGHT : 0) + node.bodyHeight
}

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
  x: number
  y: number
  selected: boolean
  /** The canvas zoom; text grows in canvas units below {@link READABLE_ZOOM} so it stays legible on screen. */
  zoom: number
  t: CanvasTranslate
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  /** The body: the `dv.canvas.card` entry of the node's type. */
  body: ReactNode
  /** For a node with slots, the media of each slot's frame; null for a slot without one. */
  frames: ReadonlyArray<ReactNode | null>
  /** For a failed claimed node, the actions that show on it; empty when the canvas is read-only. */
  failedActions: readonly NodeAction[]
  /** The action whose rerun the node waits for, whose button reads the running words; null for none. */
  rerunningAction: string | null
  onAction: (action: NodeAction) => void
}

/**
 * The card.
 * @param props - the node, its position, the canvas zoom, the body and frames, and the gesture and action callbacks.
 * @returns the element.
 */
export function NodeCard(props: NodeCardProps): ReactNode {
  const { node, view, x, y, selected, zoom, t } = props
  const { flags } = node
  const scale = textScaleAt(zoom)
  const size = (base: number): number => Math.round(base * scale)
  const text = (base: 12 | 13): CSSProperties => ({ fontSize: size(base), lineHeight: `${String(size({ 12: 16, 13: 20 }[base]))}px` })
  const failedRow = node.claimed && flags.failed
  // A selected card wears the accent ring; a stale card a danger outline; any other card the plain outline.
  let ring = '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-1)'
  if (selected) ring = '0 0 0 2px var(--dv-accent), 0 0 0 6px var(--dv-accent-soft)'
  else if (flags.stale) ring = '0 0 0 1px var(--dv-danger), var(--dv-shadow-1)'
  else if (failedRow) ring = '0 0 0 1px var(--dv-line)'
  const style: CSSProperties = {
    position: 'absolute', left: x, top: y, width: NODE_WIDTH, boxSizing: 'border-box', background: failedRow ? 'var(--dv-danger-soft)' : 'var(--dv-surface-2)',
    color: 'var(--dv-text)', borderRadius: 'var(--dv-radius-lg)', boxShadow: ring, cursor: 'grab', userSelect: 'none', overflow: 'hidden',
    opacity: flags.superseded ? 0.55 : 1, touchAction: 'none',
  }
  const status = node.claimed ? node.nodeType.claimed?.status : undefined
  const running = status?.running() ?? t('node.running')
  let marker: string | null = null
  if (flags.rendering) marker = running
  else if (flags.failed) marker = status?.failed() ?? t('node.failed')
  const header = (
    <div style={{ minHeight: size(HEADER_HEIGHT), boxSizing: 'border-box', padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ flex: 'none', width: size(6), height: size(6), borderRadius: 9999, background: node.nodeType.color }} />
      <span style={{ ...text(13), flex: 1, minWidth: 0, fontWeight: 500, ...ellipsis }}>{node.title}</span>
      {view.unseen
        ? <span role="img" aria-label={t('node.unseen')} title={t('node.unseen')} style={{ flex: 'none', width: size(8), height: size(8), borderRadius: 9999, background: 'var(--dv-accent)' }} />
        : null}
      {flags.stale ? <span style={{ ...text(12), flex: 'none', color: 'var(--dv-danger)' }}>{t('node.stale')}</span> : null}
      {node.meta === undefined ? null : <span style={{ ...text(12), ...mono, flex: 'none', color: 'var(--dv-text-2)' }}>{node.meta}</span>}
    </div>
  )
  let content: ReactNode
  if (failedRow) {
    content = (
      <div style={{ minHeight: FAILED_ROW_HEIGHT, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 4px' }}>
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
    const showGrid = props.frames.some(frame => frame !== null)
    content = (
      <>
        {showGrid
          ? (
            <div style={{ height: GRID_HEIGHT, boxSizing: 'border-box', padding: '0 10px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3, alignContent: 'start', overflow: 'hidden' }}>
              {props.frames.map((frame, index) => (
                <div key={index} style={{ aspectRatio: '16 / 9', borderRadius: 3, overflow: 'hidden', background: 'var(--dv-surface-3)' }}>{frame}</div>
              ))}
            </div>
          )
          : null}
        <div style={{ position: 'relative', minHeight: node.bodyHeight }}>
          {props.body}
          {marker !== null
            ? <span style={{ ...text(13), position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dv-overlay)', color: flags.failed ? 'var(--dv-danger)' : 'var(--dv-text)', fontWeight: 500 }}>{marker}</span>
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
      title={failedRow ? node.record.error?.message : undefined}
    >
      {header}
      {content}
    </div>
  )
}

/**
 * The fallback body of a node type without a `dv.canvas.card` entry: its type label.
 * @param props - the node's type label and the text scale.
 * @returns the element.
 */
export function TypeLabelBody({ label, textScale }: { label: string; textScale: number }): ReactNode {
  return <span style={{ display: 'block', padding: '0 10px 8px', fontSize: Math.round(12 * textScale), color: 'var(--dv-text-2)' }}>{label}</span>
}
