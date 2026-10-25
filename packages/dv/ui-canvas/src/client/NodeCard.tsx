/**
 * The chrome of one canvas node on the `--dv-*` theme variables: a caption above a frame. The caption is one line with
 * the title, the unseen dot, the stale tag and `meta`. The frame is a rounded outline that wears the selection ring and
 * holds the frame grid and the `dv.canvas.card` body, which paints its own fill, or, for a failed claimed node, the
 * failed words and actions on the card surface. The chrome names no node type.
 */
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import type { NodeAction, NodeView } from './contract/index.ts'
import { NODE_WIDTH } from './graph.ts'
import type { CanvasNode } from './graph.ts'
import type {} from './locales.ts'

/** The canvas namespace translate. */
export type CanvasTranslate = TranslateNS<'dvCanvas'>

/** Height of the caption above the frame at base text size. */
export const CAPTION_HEIGHT = 20
/** Height of the frame grid of a node with slots, when a slot has a frame. */
export const GRID_HEIGHT = 64

type SizedNode = Pick<CanvasNode, 'slots' | 'bodyHeight'>

/**
 * The frame height: the frame grid of a node with slots, when it shows, above the body.
 * @param node - the node.
 * @param hasFrames - for a node with slots, whether its frame grid shows.
 * @returns the height in canvas units.
 */
function frameHeightOf(node: SizedNode, hasFrames: boolean): number {
  return (node.slots !== undefined && hasFrames ? GRID_HEIGHT : 0) + node.bodyHeight
}

/**
 * The node height at base text size, caption + frame, computed from the node without measuring it.
 * @param node - the node.
 * @param hasFrames - for a node with slots, whether its frame grid shows.
 * @returns the height in canvas units.
 */
export function cardHeight(node: SizedNode, hasFrames = false): number {
  return CAPTION_HEIGHT + frameHeightOf(node, hasFrames)
}

/**
 * The height where edges meet a node, below its top: the middle of the frame under the caption at the text scale.
 * @param node - the node.
 * @param hasFrames - for a node with slots, whether its frame grid shows.
 * @param textScale - the text enlargement ({@link textScaleAt}).
 * @returns the offset in canvas units.
 */
export function edgeAnchorY(node: SizedNode, hasFrames: boolean, textScale: number): number {
  return Math.round(CAPTION_HEIGHT * textScale) + frameHeightOf(node, hasFrames) / 2
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
 * The node: the caption above the frame.
 * @param props - the node, its position, the canvas zoom, the body and frames, and the gesture and action callbacks.
 * @returns the element.
 */
export function NodeCard(props: NodeCardProps): ReactNode {
  const { node, view, x, y, selected, zoom, t } = props
  const { flags } = node
  const scale = textScaleAt(zoom)
  const size = (base: number): number => Math.round(base * scale)
  const text = (base: 12 | 13): CSSProperties => ({ fontSize: size(base), lineHeight: `${String(size({ 12: 16, 13: 20 }[base]))}px` })
  const failed = node.claimed && flags.failed
  const showGrid = props.frames.some(frame => frame !== null)
  // A selected frame wears the accent ring; a stale frame a danger outline; a failed frame the soft outline; any other
  // frame the plain outline.
  let ring = '0 0 0 1px var(--dv-line-strong)'
  if (selected) ring = '0 0 0 2px var(--dv-accent), 0 0 0 6px var(--dv-accent-soft)'
  else if (flags.stale) ring = '0 0 0 1px var(--dv-danger)'
  else if (failed) ring = '0 0 0 1px var(--dv-line)'
  const style: CSSProperties = {
    position: 'absolute', left: x, top: y, width: NODE_WIDTH, boxSizing: 'border-box', color: 'var(--dv-text)', cursor: 'grab', userSelect: 'none',
    opacity: flags.superseded ? 0.55 : 1, touchAction: 'none',
  }
  const status = node.claimed ? node.nodeType.claimed?.status : undefined
  const running = status?.running() ?? t('node.running')
  let marker: string | null = null
  if (flags.rendering) marker = running
  else if (flags.failed) marker = status?.failed() ?? t('node.failed')
  const caption = (
    <div style={{ ...text(12), height: size(CAPTION_HEIGHT), boxSizing: 'border-box', padding: '0 2px 4px', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--dv-text-2)' }}>
      <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{node.title}</span>
      {view.unseen
        ? <span role="img" aria-label={t('node.unseen')} title={t('node.unseen')} style={{ flex: 'none', width: size(8), height: size(8), borderRadius: 9999, background: 'var(--dv-accent)' }} />
        : null}
      {flags.stale ? <span style={{ flex: 'none', color: 'var(--dv-danger)' }}>{t('node.stale')}</span> : null}
      {node.meta === undefined ? null : <span style={{ ...mono, flex: 'none' }}>{node.meta}</span>}
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
        {showGrid
          ? (
            <div style={{ ...CARD_SURFACE, height: GRID_HEIGHT, padding: '10px 10px 0', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3, alignContent: 'start', overflow: 'hidden' }}>
              {props.frames.map((frame, index) => (
                <div key={index} style={{ aspectRatio: '16 / 9', borderRadius: 3, overflow: 'hidden', background: 'var(--dv-surface-3)' }}>{frame}</div>
              ))}
            </div>
          )
          : null}
        <div style={{ position: 'relative', height: node.bodyHeight }}>
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
      title={failed ? node.record.error?.message : undefined}
    >
      {caption}
      <div data-node-frame="" style={{ position: 'relative', height: frameHeightOf(node, showGrid), overflow: 'hidden', borderRadius: 'var(--dv-radius-lg)', boxShadow: ring }}>
        {content}
      </div>
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
