/**
 * The media contract of DreamVerse: how a surface draws one asset by its media type. `@dv/ui-media` provides `dvMedia`,
 * registers the `dv.media` Component Factory, draws the file card fallback and the asset preview, and names no media
 * type; the media views are entries of `dv.media.view` keyed by the media type, registered with their `MediaType` by the
 * plugins through which a media type enters a project. Types only.
 *
 * @module @dv/ui-media/contract
 */
import type { ComponentType } from 'react'
import type {} from '@deepseek-ai/cordis'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Registry } from '@dv/ui-kit/registries.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'

/**
 * What a surface asks for: a small square, a card body, a full-width playable form, or a full-width playable form that
 * starts muted and loops, such as a take in its editor.
 */
export type MediaPurpose = 'thumb' | 'card' | 'player' | 'loop'

/**
 * One media type. Registry `dvMedia.types`, keyed by `id`, so the key refuses a second type of one id. The plugin that
 * registers a type registers its `dv.media.view` entry under the same key, in the same step.
 */
export interface MediaType {
  /** The media type, such as 'audio', as `mediaTypeOf` of `@dv/ui-kit/media-type.ts` reads it; the key of its `dv.media.view` entry. */
  id: string
  /** The icon drawn where no poster exists, such as the `@` menu. */
  icon: ComponentType<IconProps>
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
   * Open the preview of an asset of a project: its media at purpose 'player' with its facts and the
   * `dv.media.preview.action` entries, growing out of `opener` and shrinking back into it, in DSH's root
   * `shell.overlay` list. The preview closes when the open project of the DreamVerse shell changes.
   */
  preview(projectId: string, asset: Asset, opener: Element | null): void
}

/**
 * The facts of an asset that a media view draws: its ID and MIME type, and its name, pixel size and duration where the
 * surface knows them, such as a project cover that the summary names by ID and MIME type only.
 */
export type MediaAsset = Pick<Asset, 'id' | 'mime'> & Partial<Pick<Asset, 'name' | 'width' | 'height' | 'duration_sec'>>

/** Occurrence props of the `dv.media` Factory; the surface owns the box. */
export interface MediaOwner {
  asset: MediaAsset
  purpose: MediaPurpose
  /** The asset ID of a still that a playable form shows before it plays, such as a take's image output. */
  poster?: string
  /** Mark the still of a playable asset with a play badge, such as a chat card whose click opens the player. */
  playBadge?: true
  /** Receives the pixel size of the loaded media, for an asset whose stored size is unknown. */
  onSize?: (size: { width: number; height: number }) => void
}

/** Owner props of each `dv.media.view` entry: the occurrence's props, and the call that reports a failed draw. */
export interface MediaViewOwner extends MediaOwner {
  /** Report that the browser cannot draw the asset, such as an image it cannot decode; the Factory then draws the file card. */
  unsupported: () => void
}

/** Owner props of one action of the asset preview. */
export interface PreviewActionOwner {
  /** The project of the previewed asset. */
  projectId: string
  asset: Asset
  /** The class of the preview's buttons, which an action's button takes so that it looks, hovers and focuses as 关闭 does. */
  buttonClass: string | undefined
  /** Close the preview. */
  close(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { dvMedia: DvMedia }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One asset drawn by its media type, keyed by `MediaType.id`; fallback: a file card with the name and MIME type. */
    'dv.media.view': { kind: 'keyed'; scope: 'root'; owner: MediaViewOwner }
    /** The buttons of the asset preview beside 关闭, such as 插入片段; each occupant decides whether it shows for the asset. */
    'dv.media.preview.action': { kind: 'list'; scope: 'root'; owner: PreviewActionOwner }
  }
  interface SlotFactoryMap {
    /** One asset by media type; any surface renders an occurrence without declaring a slot. */
    'dv.media': { scope: 'root'; props: MediaOwner; children: { 'dv.media.view': { kind: 'keyed'; scope: 'root' } } }
  }
}
