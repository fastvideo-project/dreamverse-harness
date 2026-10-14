/**
 * The `@` source that lists the files attached to the draft and the project items of the project the shell has open:
 * clips by timeline name and position (`时间线 1 · 片段 2`, or `Timeline 1 · Clip 2` in English, for an unnamed
 * timeline), characters, locations, styles, and assets of every media type. A pick inserts a reference chip whose text
 * is `@[<label>](dv:<kind>/<id>)` and that shows the item's image or video; the host plugin `@dv/chat-references`
 * expands that address into record and asset IDs for the model, and puts the assets of the `dv:asset/<id>` chips of a
 * sent message on the canvas.
 *
 * A file attached to the draft is not an asset until the message is sent: the host imports the attachments of a sent
 * message as assets. Its chip text is `@[<label>](dv:upload/<DraftAttachmentId>)`, and sending serializes it to
 * `@[<label>](dv:attachment/<n>)`, where `<n>` is the 1-based position of the file among the message's attachments; a
 * chip whose file was removed from the draft before sending serializes to its label alone.
 *
 * @module @dv/ui-composer/mention
 */
import { createElement, type ComponentType } from 'react'
import type { ComposerAttachment, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerSource, ReferenceThumbnail,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import type { Character, WireState } from '@dv/ui-kit/types.ts'
import { getCurrentProject } from '@dv/ui-kit/current-project.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import { timelineName } from '@dv/ui-kit/timeline.ts'

/** The source name; reference chips carry it so their codec serializes them. */
export const MENTION_SOURCE = 'dv-project'

/**
 * The reference text of one project item.
 * @param label - the chip label.
 * @param uri - the `dv:` address.
 * @returns `@[label](uri)`.
 */
export function referenceText(label: string, uri: string): string {
  return `@[${label.replaceAll(']', '')}](${uri})`
}

/** A small thumbnail as a candidate icon. */
function thumbnailIcon({ url, video }: ReferenceThumbnail): ComponentType<IconProps> {
  // Sized to stay clear of the label in the 14 px icon column of the @ menu.
  const style = { width: 20, height: 14, objectFit: 'cover' as const, borderRadius: 3, flex: 'none' }
  return function Thumbnail() {
    return video ? createElement('video', { src: url, muted: true, preload: 'metadata', style }) : createElement('img', { src: url, alt: '', style })
  }
}

/** One listed item before query filtering. */
interface Item {
  uri: string
  label: string
  section: string
  description?: string
  /** The image or video of the item, shown in the @ menu row and in the inserted chip. */
  thumbnail?: ReferenceThumbnail
}

/** The thumbnail of a project asset: the asset itself when it is an image or a video. */
function assetThumbnail(asset: { id: string; mime: string }): ReferenceThumbnail | undefined {
  const video = asset.mime.startsWith('video/')
  return video || asset.mime.startsWith('image/') ? { url: assetUrl(asset.id), video } : undefined
}

/**
 * The story bible items of one kind: the latest version of each character, location or style.
 * @param kind - the URI kind.
 * @param versions - the versions by ID, oldest first.
 * @param section - the group name.
 * @returns the items.
 */
function bibleItems(kind: 'character' | 'location' | 'style', versions: Record<string, Character[]>, section: string): Item[] {
  return Object.entries(versions).flatMap(([id, list]): Item[] => {
    const latest = list[list.length - 1]
    if (latest === undefined) return []
    const image = latest.references[0]
    return [{
      uri: `dv:${kind}/${encodeURIComponent(id)}`, label: latest.name || id, section,
      description: latest.description.slice(0, 40), ...image === undefined ? {} : { thumbnail: { url: assetUrl(image), video: false } },
    }]
  })
}

/**
 * The project items of a project state: every clip of every timeline, the characters, locations and styles, and the
 * assets. Labels and group names follow the interface language at call time, so the label a pick inserts is in that
 * language.
 * @param state - the project's current state.
 * @returns the items in display order.
 */
export function projectItems(state: WireState): Item[] {
  const assetsById = new Map(state.assets.map(asset => [asset.id, asset]))
  const proj = state.components.proj
  const records = new Map(proj.records.map(record => [record.id, record]))
  const clips = state.components.timeline.timelines.flatMap(timeline => timeline.clips.map((clip, position): Item => {
    // A placeholder clip (no asset yet) takes its prompt from the render it waits for and shows no thumbnail.
    const producer = records.get(clip.asset === null ? clip.source?.record ?? '' : proj.created_by[clip.asset] ?? '')
    const frame = producer?.outputs.find(id => assetsById.get(id)?.mime.startsWith('image/') === true)
    const name = timelineName(timeline, n => pickText(`时间线 ${String(n)}`, `Timeline ${String(n)}`))
    const prompt = typeof producer?.params['prompt'] === 'string' ? producer.params['prompt'] : ''
    return {
      uri: `dv:clip/${encodeURIComponent(clip.id)}`,
      label: pickText(`${name} · 片段 ${String(position + 1)}`, `${name} · Clip ${String(position + 1)}`),
      section: pickText('片段', 'Clips'),
      ...prompt === '' ? {} : { description: prompt.slice(0, 40) },
      ...frame !== undefined
        ? { thumbnail: { url: assetUrl(frame), video: false } }
        : clip.asset === null ? {} : { thumbnail: { url: assetUrl(clip.asset), video: true } },
    }
  }))
  const bible = state.components.bible
  const settings = pickText('场景和风格', 'Locations and styles')
  const characters = [
    ...bibleItems('character', bible.characters, pickText('角色', 'Characters')),
    ...bibleItems('location', bible.locations, settings),
    ...bibleItems('style', bible.styles, settings),
  ]
  const assets = state.assets.filter(asset => ['image/', 'video/', 'audio/'].some(type => asset.mime.startsWith(type))).slice(-40).reverse()
    .map((asset): Item => {
      const media = assetThumbnail(asset)
      return {
        uri: `dv:asset/${encodeURIComponent(asset.id)}`, label: asset.name, section: pickText('素材', 'Assets'),
        ...media === undefined ? {} : { thumbnail: media },
      }
    })
  return [...clips, ...characters, ...assets]
}

/**
 * The files attached to a composer draft, as `@` items. An image shows its draft preview; another file shows no
 * thumbnail until it is sent and imported as an asset.
 * @param uploads - the draft attachments, in draft order.
 * @returns the items.
 */
export function uploadItems(uploads: readonly ComposerAttachment[]): Item[] {
  return uploads.map((upload): Item => ({
    uri: `dv:upload/${encodeURIComponent(upload.id)}`,
    label: upload.file.name === '' ? pickText('上传的文件', 'Uploaded file') : upload.file.name,
    section: pickText('本条消息的上传', 'Attached to this message'),
    ...upload.kind === 'image' ? { thumbnail: { url: upload.previewUrl, video: false } } : {},
  }))
}

/** The chip text of a file attached to the draft: `@[<label>](dv:upload/<DraftAttachmentId>)`. */
const UPLOAD_REFERENCE = /^@\[([^\]]*)\]\(dv:upload\/([^)\s]+)\)$/

/**
 * The model text of one chip. A chip of a file attached to the draft becomes `@[<label>](dv:attachment/<n>)`, with
 * `<n>` the 1-based position of the file among the attachments the message carries, or its label alone when the file
 * is no longer attached; every other chip keeps its text.
 * @param ref - the chip text.
 * @param attachmentIds - the draft attachments sent with the message, in message order.
 * @returns the model text.
 */
export function serializeReference(ref: string, attachmentIds: readonly DraftAttachmentId[]): string {
  const match = UPLOAD_REFERENCE.exec(ref)
  if (match === null) return ref
  const label = match[1] ?? ''
  const id = decodeURIComponent(match[2] ?? '')
  const position = attachmentIds.findIndex(attachment => attachment === id) + 1
  return position === 0 ? label : referenceText(label, `dv:attachment/${String(position)}`)
}

/**
 * The `@` source over the `/api/dv` routes.
 * @param draftUploads - the files attached to a session's composer draft, in draft order.
 * @returns the source.
 */
export function projectMentionSource(
  draftUploads: (sessionId: ClientSessionContext['sessionId']) => readonly ComposerAttachment[],
): InputTriggerSource {
  const client = new DvClient()
  return {
    trigger: '@',
    name: MENTION_SOURCE,
    showGroupTitle: false,
    async candidates(session, { query, signal }): Promise<readonly InputTriggerCandidate[]> {
      // The project the shell has open; the entry page lists only the files attached to the draft.
      const projectId = getCurrentProject()
      const uploads = uploadItems(draftUploads(session.sessionId))
      const items = projectId === null ? uploads : [...uploads, ...projectItems(await client.getState(projectId, signal))]
      const needle = query.toLowerCase()
      // The menu shows a candidate name that differs from its label as a trailing alias, so the name is the label
      // (numbered when labels repeat) and the `dv:` address travels in `value`.
      const seen = new Map<string, number>()
      return items
        .filter(item => needle === '' || item.label.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle))
        .map((item): InputTriggerCandidate => {
          const count = (seen.get(item.label) ?? 0) + 1
          seen.set(item.label, count)
          return {
            name: count === 1 ? item.label : `${item.label} (${String(count)})`, section: item.section,
            value: JSON.stringify({ uri: item.uri, label: item.label, thumbnail: item.thumbnail }),
            ...item.description === undefined ? {} : { description: item.description },
            ...item.thumbnail === undefined ? {} : { icon: thumbnailIcon(item.thumbnail) },
          }
        })
    },
    onPick({ candidate }) {
      const { uri, label, thumbnail } = JSON.parse(candidate.value ?? '{}') as { uri?: string; label?: string; thumbnail?: ReferenceThumbnail }
      if (uri === undefined || label === undefined) return undefined
      const text = referenceText(label, uri)
      return { insert: { source: MENTION_SOURCE, ref: text, label, ...thumbnail === undefined ? {} : { thumbnail }, clipboardText: text } }
    },
    codec: {
      clipboardText: ref => ref,
      serialize: (ref, _signal, attachmentIds) => Promise.resolve(serializeReference(ref, attachmentIds)),
    },
  }
}
