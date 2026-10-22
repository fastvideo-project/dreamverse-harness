/**
 * The media contract of DreamVerse: how a surface draws one asset by its media type. `@dv/ui-media` provides `dvMedia`,
 * registers the `dv.media` Component Factory, draws the file card fallback and the asset preview, and names no media
 * type; the media views are entries of `dv.media.view` keyed by the MIME top-level type, registered by the plugins
 * through which a media type enters a project. Types only.
 *
 * @module @dv/ui-media/contract
 */
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Registry } from '@dv/ui-kit/registries.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'

/** A pair of interface texts, Chinese then English. */
export type Text = readonly [zh: string, en: string]

/**
 * What a surface asks for: a small square, a card body, a full-width playable form, or a full-width playable form that
 * starts muted and loops, such as a take in its editor.
 */
export type MediaPurpose = 'thumb' | 'card' | 'player' | 'loop'

/**
 * One media type. Registry `dvMedia.types`, keyed by `id`, the MIME top-level type, so the key refuses a second view of
 * one type.
 */
export interface MediaType {
  /** The MIME top-level type, such as 'audio'; the key of its `dv.media.view` entry. */
  id: string
  label(): Text
  /** An icon name, drawn where no poster exists (the `@` menu, whose icon is a plain component). */
  icon: string
  /**
   * The asset ID of a still that stands for the asset where only an `<img>` can draw, such as the `@` menu icon, read
   * from the project state; null for none.
   */
  poster?(asset: Asset, state: WireState): string | null
}

/** Provided by `@dv/ui-media` as `ctx.dvMedia`. */
export interface DvMedia {
  types: Registry<MediaType>
  /**
   * Open the preview of an asset: its media at purpose 'player' with its facts and the `dv.media.preview.action`
   * entries, growing out of `opener` and shrinking back into it, in DSH's root `shell.overlay` list.
   */
  preview(asset: Asset, opener: Element | null): void
}

/** Occurrence props of the `dv.media` Factory, and owner props of each `dv.media.view` entry; the surface owns the box. */
export interface MediaOwner {
  asset: Asset
  purpose: MediaPurpose
  /** The asset ID of a still that a playable form shows before it plays, such as a take's image output. */
  poster?: string
  /** Receives the pixel size of the loaded media, for an asset whose stored size is unknown. */
  onSize?: (size: { width: number; height: number }) => void
}

/** Owner props of one action of the asset preview. */
export interface PreviewActionOwner {
  asset: Asset
  /** Close the preview. */
  close(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { dvMedia: DvMedia }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One asset drawn by its media type, keyed by `MediaType.id`; fallback: a file card with the name and media type. */
    'dv.media.view': { kind: 'keyed'; scope: 'root'; owner: MediaOwner }
    /** The buttons of the asset preview beside 关闭, such as 插入片段; each occupant decides whether it shows for the asset. */
    'dv.media.preview.action': { kind: 'list'; scope: 'root'; owner: PreviewActionOwner }
  }
  interface SlotFactoryMap {
    /** One asset by media type; any surface renders an occurrence without declaring a slot. */
    'dv.media': { scope: 'root'; props: MediaOwner; children: { 'dv.media.view': { kind: 'keyed'; scope: 'root' } } }
  }
}
