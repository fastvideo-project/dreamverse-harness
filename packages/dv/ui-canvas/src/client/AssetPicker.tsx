/**
 * The asset pool as the canvas editors use it: the picker that adds references (the items of each registered version
 * kind under the kind's label, each drawn by its first asset through the `dv.media` Factory, then the `dv.canvas.picker`
 * entry at key `assets`, which `@dv/ui-asset-pool` fills with its asset pool panel and import drop zone). Without a slot
 * renderer the picker offers only the items. The picker renders on `document.body` and closes on Escape before the
 * canvas sees the key, so the editor beneath it stays open.
 *
 * @module @dv/ui-canvas/AssetPicker
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { DvClient } from '@dv/ui-kit/api.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'
import type { CanvasTranslate } from './NodeCard.tsx'

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dv-overlay)',
}
const dialog: CSSProperties = {
  display: 'flex', flexDirection: 'column', width: 'min(880px, 90vw)', height: '80vh', overflow: 'hidden', background: 'var(--dv-surface-1)',
  color: 'var(--dv-text)', borderRadius: 'var(--dv-radius-xl)', boxShadow: '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-2)', fontSize: 13, lineHeight: '20px',
}
const sectionTitle: CSSProperties = { margin: '0 0 8px', fontSize: 12, lineHeight: '16px', fontWeight: 500, color: 'var(--dv-text-2)' }
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }
const tile: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, padding: 4, border: 'none', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-3)',
  color: 'var(--dv-text)', fontFamily: 'inherit', fontSize: 12, lineHeight: '16px', cursor: 'pointer', textAlign: 'left',
}
const tileMedia: CSSProperties = { width: '100%', aspectRatio: '1', overflow: 'hidden', borderRadius: 'var(--dv-radius-sm)', display: 'block' }
const button: CSSProperties = {
  height: 32, border: 'none', borderRadius: 'var(--dv-radius-md)', padding: '0 12px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', fontWeight: 500,
  cursor: 'pointer',
}

/**
 * Run `onEscape` on Escape while the pop-up is mounted, before every other Escape listener of the page.
 * @param onEscape - closes the pop-up.
 */
function useEscapeFirst(onEscape: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onEscape()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onEscape])
}

/** Props of {@link AssetPicker}. */
export interface AssetPickerProps {
  state: WireState
  client: DvClient
  project: string
  /** The chat session the canvas sits beside, recorded as the `session` of the picker's imports. */
  session: string | null
  t: CanvasTranslate
  /** The version kinds whose items the picker offers at their newest version, one section per kind; none for a picker of
   *  assets only. */
  kinds: readonly VersionKind[]
  /** The references the editor already holds; an item version among them is not offered again. */
  chosen: readonly string[]
  /** Receives the picked references in pick order: asset IDs, and `<id>@<version>` for item versions. */
  onConfirm: (refs: string[]) => void
  onCancel: () => void
  /** Renders the `dv.canvas.picker` entry, the asset pool panel; without it the picker offers only the items. */
  renderSlot?: PropsRenderSlots<'dv.canvas.picker'>['renderSlot']
  /** Renders the `dv.media` occurrence of each item's first asset; without it, no item draws an asset. */
  renderFactorySlot?: PropsRenderFactories['renderFactorySlot']
}

/**
 * The picker: for each kind of `kinds` that offers an item, a section titled with the kind's label that holds the newest
 * version of each of its items, then the asset pool panel of the `dv.canvas.picker` entry, whose clicks pick assets.
 * A click toggles an item; the confirm button hands over every picked reference.
 * @param props - the project, the offered kinds, and the callbacks.
 * @returns the dialog.
 */
export function AssetPicker(props: AssetPickerProps): ReactNode {
  const { t, onCancel } = props
  const [picked, setPicked] = useState<string[]>([])
  useEscapeFirst(onCancel)
  const toggle = (ref: string): void => {
    setPicked(current => current.includes(ref) ? current.filter(other => other !== ref) : [...current, ref])
  }
  const assets = new Map(props.state.assets.map(asset => [asset.id, asset]))
  // One section per kind that offers an item, titled with the kind's label.
  const sections = props.kinds.map(kind => ({
    kind: kind.kind, title: kind.label(), items: kind.latest(props.state).flatMap(({ id, version }) => {
      const ref = `${id}@${String(version)}`
      if (props.chosen.includes(ref)) return []
      return [{ ref, name: kind.name(props.state, id, version) || id, cover: assets.get(kind.assets(props.state, id, version)[0] ?? '') }]
    }),
  })).filter(section => section.items.length > 0)
  const pickedSet = new Set(picked)
  // The asset pool panel marks each tile with `data-asset-id`; the picker rings the picked ones.
  const pickedRing = picked.length === 0
    ? null
    : `${picked.map(ref => `[data-testid="dv-canvas-asset-picker"] [data-asset-id="${ref.replace(/["\\]/g, '\\$&')}"]`).join(',')}{box-shadow:0 0 0 2px var(--dv-accent)}`
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('picker.title')} data-testid="dv-canvas-asset-picker" style={overlay} onClick={onCancel}>
      <div style={dialog} onClick={(event) => { event.stopPropagation() }}>
        <h2 style={{ margin: 0, padding: '16px 16px 0', fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>{t('picker.title')}</h2>
        {sections.map(section => (
          <section key={section.kind} style={{ padding: '12px 16px 0' }}>
            <h3 style={sectionTitle}>{section.title}</h3>
            <div style={grid}>
              {section.items.map(item => (
                <button
                  key={item.ref} type="button" aria-pressed={pickedSet.has(item.ref)} onClick={() => { toggle(item.ref) }}
                  style={{ ...tile, boxShadow: pickedSet.has(item.ref) ? '0 0 0 2px var(--dv-accent)' : '0 0 0 1px var(--dv-line)' }}
                >
                  <span style={tileMedia}>{item.cover === undefined ? null : props.renderFactorySlot?.('dv.media', { asset: item.cover, purpose: 'thumb' })}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <div style={{ flex: 1, minHeight: 0 }}>
          {pickedRing === null ? null : <style>{pickedRing}</style>}
          {props.renderSlot?.('dv.canvas.picker', {
            projectId: props.project, session: props.session, client: props.client, onOpen: (asset) => { toggle(asset.id) },
          }, { entryKey: 'assets' })}
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
