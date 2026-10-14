/**
 * The DreamVerse entry of DSH's `conversation.chat.reference` chain: in a sent user message, a `dv:asset/<id>` chip and
 * a `dv:attachment/<n>` chip show their image or video in front of the label, as the composer chip did before sending.
 * A `dv:attachment/<n>` chip names the n-th attachment of the same message: an image attachment is the chip's media
 * from the moment the message is sent, with or without a project. The host imports every attachment as an asset under
 * the file's name, so a chip whose attachment is another file finds the newest asset of the open project with the
 * chip's label as its name. Until one of these media exists, and for every other `dv:` address, DSH's default label
 * chip stays.
 *
 * @module @dv/ui-composer/sent-references
 */
import type { MessageAttachmentSource } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UserTextReference } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, type ReactNode } from 'react'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { AssetKinds } from './asset-kinds.ts'
import css from './views.module.css'

/** The asset that a sent chip names: by ID, or as the 1-based `position` of a file attached to its message. */
export type SentReference =
  | { readonly kind: 'asset'; readonly asset: string }
  | { readonly kind: 'attachment'; readonly position: number; readonly name: string }

/** The media of a sent chip. */
export interface SentMedia {
  readonly url: string
  readonly video: boolean
}

/**
 * Find the asset of one sent reference by its address; the chain entry's `select`.
 * @param reference - the label and address of the sent chip.
 * @returns the asset reference, or null to keep DSH's default label chip.
 */
export function selectSentReference({ label, uri }: UserTextReference): SentReference | null {
  if (uri.startsWith('dv:attachment/')) {
    const position = Number(uri.slice('dv:attachment/'.length))
    return Number.isSafeInteger(position) && position > 0 ? { kind: 'attachment', position, name: label } : null
  }
  if (!uri.startsWith('dv:asset/')) return null
  try {
    return { kind: 'asset', asset: decodeURIComponent(uri.slice('dv:asset/'.length)) }
  } catch (_error) {
    // A malformed escape names no asset.
    return null
  }
}

/**
 * @param reference - the asset reference that {@link selectSentReference} found.
 * @param kinds - the asset index of the open project.
 * @returns the media of the asset, or null while the index does not list it as an image or a video.
 */
export function resolveSentMedia(reference: SentReference, kinds: AssetKinds): SentMedia | null {
  if (reference.kind === 'asset') {
    const entry = kinds.get(reference.asset)
    return entry === undefined ? null : { url: assetUrl(reference.asset), video: entry.kind === 'video' }
  }
  // The index keeps the state's asset order, oldest first; the newest asset of that name is the latest upload.
  const found = [...kinds].findLast(([, entry]) => entry.name === reference.name)
  return found === undefined ? null : { url: assetUrl(found[0]), video: found[1].kind === 'video' }
}

/** The image attachment that a chip names: its URL, or null while the durable image loads. */
interface AttachedImage {
  readonly url: string | null
}

/**
 * The image attachment that a chip names: the submission echo's preview URL, or the durable image through the session's
 * loader.
 * @param attachment - the message attachment that a chip names, if the message has one at that position.
 * @param loadImage - the session-authorized image loader.
 * @returns the image, or null for a file that is not an image and for an image that failed to load.
 */
function useAttachmentImage(attachment: MessageAttachmentSource | undefined, loadImage: MessageImageLoader): AttachedImage | null {
  const image = attachment?.type === 'image' ? attachment.image : undefined
  const durable = image !== undefined && 'attachment' in image ? image.attachment : undefined
  // `url` null records a failed load of `source`.
  const [loaded, setLoaded] = useState<{ readonly source: Parameters<MessageImageLoader>[0]; readonly url: string | null } | null>(null)
  useEffect(() => {
    if (durable === undefined || loadImage.peek?.(durable) !== undefined) return
    let live = true
    loadImage(durable).then((url) => { if (live) setLoaded({ source: durable, url }) }, (_error: unknown) => {
      // An image that fails to load leaves the chip to the asset index.
      if (live) setLoaded({ source: durable, url: null })
    })
    return () => { live = false }
  }, [durable, loadImage])
  if (image === undefined) return null
  if ('preview' in image) return { url: image.preview.url }
  const peeked = loadImage.peek?.(image.attachment)
  if (peeked !== undefined) return { url: peeked }
  if (loaded?.source !== image.attachment) return { url: null }
  return loaded.url === null ? null : { url: loaded.url }
}

/** The props that the chain entry's component reads. */
export interface SentReferenceEntryProps {
  /** The `select` result. */
  readonly matched: SentReference
  /** The label and address of the sent chip. */
  readonly reference: UserTextReference
  /** DSH's default label chip. */
  readonly fallback: ReactNode
  /** The attachments of the message that holds the chip, in content order. */
  readonly attachments: readonly MessageAttachmentSource[]
  /** The session-authorized image loader. */
  readonly loadImage: MessageImageLoader
  /** Selects from the open project's asset index. */
  readonly useAssetKinds: SnapshotSelectorHook<AssetKinds>
}

/**
 * The chain entry's component: the chip with its attached image or its asset's media, or DSH's default label chip
 * while neither exists. While a durable image attachment loads, the chip keeps its form with an empty media box, so the
 * swap from the submission echo to the admitted message does not flash the label chip.
 * @param props - the matched asset, the reference, the default chip, the message attachments, the image loader, and
 *   the asset-index hook.
 * @returns the chip.
 */
export function SentReferenceEntry({
  matched, reference, fallback, attachments, loadImage, useAssetKinds,
}: SentReferenceEntryProps): ReactNode {
  const attached = useAttachmentImage(matched.kind === 'attachment' ? attachments[matched.position - 1] : undefined, loadImage)
  const indexed = useAssetKinds(kinds => resolveSentMedia(matched, kinds), (a, b) => a?.url === b?.url && a?.video === b?.video)
  const media = attached === null || attached.url === null ? indexed : { url: attached.url, video: false }
  if (media === null && attached === null) return fallback
  return (
    <span className={css.sentReference} title={reference.label} data-dv-sent-reference="">
      {media === null
        ? <span className={`${css.sentReferenceMedia} ${css.sentReferencePending}`} aria-hidden />
        : media.video
          ? <video className={css.sentReferenceMedia} src={media.url} muted preload="metadata" />
          : <img className={css.sentReferenceMedia} src={media.url} alt="" />}
      <span className={css.sentReferenceLabel}>{reference.label}</span>
    </span>
  )
}
