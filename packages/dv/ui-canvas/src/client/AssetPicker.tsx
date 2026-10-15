/**
 * The asset pool as the canvas editors use it, drawn with the asset pool panel of `@dv/ui-asset-pool`: the picker that
 * adds references (the asset pool with its import drop zone), the preview of one asset, and the thumbnail of an image
 * or a video asset. This file is the canvas's only import of `@dv/ui-asset-pool`. The picker and the preview render on
 * `document.body` and close on Escape before the canvas sees the key, so the editor beneath them stays open.
 *
 * @module @dv/ui-canvas/AssetPicker
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AssetsPanel, Preview } from '@dv/ui-asset-pool/src/client/AssetsPanel.tsx'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { useZoomPresence } from '@dv/ui-kit/zoom.ts'
import type { CanvasTranslate } from './NodeCard.tsx'

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dv-overlay)',
}
const dialog: CSSProperties = {
  display: 'flex', flexDirection: 'column', width: 'min(880px, 90vw)', height: '80vh', overflow: 'hidden', background: 'var(--dv-surface-1)',
  color: 'var(--dv-text)', borderRadius: 'var(--dv-radius-xl)', boxShadow: '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-2)', fontSize: 13, lineHeight: '20px',
}
const button: CSSProperties = {
  height: 32, border: 'none', borderRadius: 'var(--dv-radius-md)', padding: '0 12px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', fontWeight: 500,
  cursor: 'pointer',
}

/**
 * Run `onEscape` on Escape while `active`, before every other Escape listener of the page.
 * @param active - whether the pop-up is open.
 * @param onEscape - closes the pop-up.
 */
function useEscapeFirst(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onEscape()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [active, onEscape])
}

/**
 * An image asset as an image and a video asset as its first frame; nothing for another media type or a missing asset.
 * @param props - the asset and the media's style.
 * @returns the element.
 */
export function AssetMedia(props: { asset: Asset | undefined; style: CSSProperties }): ReactNode {
  const { asset, style } = props
  if (asset === undefined) return null
  if (asset.mime.startsWith('video/')) return <video src={`${assetUrl(asset.id)}#t=0.1`} muted preload="metadata" style={style} />
  if (asset.mime.startsWith('image/')) return <img src={assetUrl(asset.id)} alt="" style={style} draggable={false} />
  return null
}

/** Props of {@link AssetPicker}. */
export interface AssetPickerProps {
  client: DvClient
  project: string
  /** The chat session the canvas sits beside, recorded as the `session` of the picker's imports. */
  session: string | null
  t: CanvasTranslate
  /** Receives the picked assets in pick order. */
  onConfirm: (assets: Asset[]) => void
  onCancel: () => void
}

/**
 * The picker: the asset pool panel, whose clicks pick assets. A click toggles an asset; the confirm button hands over
 * every picked asset.
 * @param props - the project and the callbacks.
 * @returns the dialog.
 */
export function AssetPicker(props: AssetPickerProps): ReactNode {
  const { t, onCancel } = props
  const [picked, setPicked] = useState<Asset[]>([])
  useEscapeFirst(true, onCancel)
  const toggle = (asset: Asset): void => {
    setPicked(current => current.some(other => other.id === asset.id)
      ? current.filter(other => other.id !== asset.id)
      : [...current, asset])
  }
  // The asset pool panel marks each tile with `data-asset-id`; the picker rings the picked ones.
  const pickedTiles = picked.map(asset => `[data-testid="dv-canvas-asset-picker"] [data-asset-id="${asset.id.replace(/["\\]/g, '\\$&')}"]`)
  const pickedRing = picked.length === 0 ? null : `${pickedTiles.join(',')}{box-shadow:0 0 0 2px var(--dv-accent)}`
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('picker.title')} data-testid="dv-canvas-asset-picker" style={overlay} onClick={onCancel}>
      <div style={dialog} onClick={(event) => { event.stopPropagation() }}>
        <h2 style={{ margin: 0, padding: '16px 16px 0', fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>{t('picker.title')}</h2>
        <div style={{ flex: 1, minHeight: 0 }}>
          {pickedRing === null ? null : <style>{pickedRing}</style>}
          <AssetsPanel projectId={props.project} session={props.session} client={props.client} onOpen={toggle} />
        </div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--dv-line)' }}>
          <button type="button" className="dv-canvas-btn" style={{ ...button, border: '1px solid var(--dv-line-strong)', color: 'var(--dv-text)' }} onClick={onCancel}>{t('picker.cancel')}</button>
          <button
            type="button" className="dv-canvas-soft" disabled={picked.length === 0}
            style={{ ...button, opacity: picked.length === 0 ? 0.5 : 1 }} onClick={() => { props.onConfirm(picked) }}
          >
            {t('picker.confirm', { count: picked.length })}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The asset pool's preview of one asset, growing out of the element that opened it and shrinking back into it.
 * @param props - the asset on show or null, the element it grows out of, and the close callback.
 * @returns the preview, or nothing while no asset is on show.
 */
export function AssetPreview(props: { asset: Asset | null; openerOf: (asset: Asset) => Element | null; onClose: () => void }): ReactNode {
  const zoom = useZoomPresence(props.asset, props.openerOf)
  useEscapeFirst(props.asset !== null, props.onClose)
  return zoom.shown === null ? null : <Preview key={zoom.shown.id} asset={zoom.shown} onClose={props.onClose} zoom={zoom} />
}
