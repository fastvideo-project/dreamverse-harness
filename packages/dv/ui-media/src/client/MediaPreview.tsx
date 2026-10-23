/**
 * The asset preview in DSH's `shell.overlay` list: the asset at purpose 'player', its name and facts, the
 * `dv.media.preview.action` entries and 关闭. The facts and the media box use the asset's stored dimensions, else those
 * of the loaded media; an asset of known dimensions has its box sized before the media loads, so the dialog has its
 * final box when it grows out of the element that opened it (`@dv/ui-kit/zoom.ts`). Escape, a click outside the
 * dialog and 关闭 close it. 关闭 has the focus while the preview is open, and the opener gets it back when the preview
 * closes.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { useText } from '@dv/ui-kit/locale.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { mediaBox, useZoomPresence } from '@dv/ui-kit/zoom.ts'
import css from './media.module.css'

/** One open request: the project and its asset, and the serial number of the request. */
export interface PreviewRequest {
  projectId: string
  asset: Asset
  serial: number
}

/** What the media plugin injects into the preview entry. */
export interface PreviewInjected {
  hooks: { preview: HostObservable<PreviewRequest | null> }
  /** The element that opened the newest request, or null when it is gone. */
  openerOf(): Element | null
  close(): void
}

/** The preview entry's composed props. */
export type MediaPreviewProps = PropsRenderSlots<'dv.media.preview.action'> & PropsRenderFactories & InjectFace<PreviewInjected>

interface Size {
  width: number
  height: number
}

function factsOf(asset: Asset, loaded: Size | null, pick: (zh: string, en: string) => string): string[] {
  const width = asset.width ?? loaded?.width ?? null
  const height = asset.height ?? loaded?.height ?? null
  return [
    width !== null && height !== null ? `${String(width)}×${String(height)}` : null,
    asset.duration_sec === null ? null : pick(`${asset.duration_sec.toFixed(1)} 秒`, `${asset.duration_sec.toFixed(1)} s`),
    asset.size_bytes < 1024 * 1024 ? `${(asset.size_bytes / 1024).toFixed(1)} KB` : `${(asset.size_bytes / 1024 / 1024).toFixed(1)} MB`,
  ].filter((fact): fact is string => fact !== null)
}

function focusOnMount(button: HTMLButtonElement | null): void {
  button?.focus()
}

/**
 * The preview.
 * @param props - the open request, its opener, the close callback, and the renderers of the media and the actions.
 * @returns the dialog, or nothing while no preview is open.
 */
export function MediaPreview({ usePreview, openerOf, close, renderSlot, renderFactorySlot }: MediaPreviewProps): ReactNode {
  const request = usePreview(value => value)
  const pick = useText()
  const zoom = useZoomPresence(request, () => openerOf())
  const [loaded, setLoaded] = useState<{ serial: number; size: Size } | null>(null)
  const open = request !== null
  useEffect(() => {
    if (!open) return
    // The preview closes before the canvas or an editor beneath it sees the key.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const opener = openerOf()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open, close, openerOf])
  if (zoom.shown === null) return null
  const { projectId, asset, serial } = zoom.shown
  const size = loaded?.serial === serial ? loaded.size : null
  const known = asset.width !== null && asset.height !== null && asset.height > 0 ? { width: asset.width, height: asset.height } : size
  const sized = known === null ? undefined : mediaBox(known.width, known.height, '80vw - 32px', '70vh')
  return (
    <div key={zoom.shown.serial} role="dialog" aria-modal="true" aria-label={asset.name} onClick={close} className={css.overlay}>
      <div ref={zoom.fadeRef} className={css.backdrop} aria-hidden="true" />
      <div ref={zoom.targetRef} onClick={(event) => { event.stopPropagation() }} className={css.dialog}>
        <div className={css.media} style={sized}>{renderFactorySlot('dv.media', { asset, purpose: 'player', onSize: (next) => { setLoaded({ serial, size: next }) } })}</div>
        <div className={css.facts}>
          <span className={css.name}>{asset.name}</span>
          <span className={css.factText}>{factsOf(asset, size, pick).join(' · ')}</span>
          <span style={{ flex: 1 }} />
          {renderSlot('dv.media.preview.action', { projectId, asset, buttonClass: css.button, close })}
          <button type="button" className={css.button} onClick={close} ref={focusOnMount}>{pick('关闭', 'Close')}</button>
        </div>
      </div>
    </div>
  )
}
