/**
 * Expansion of the composer's `dv:` mentions. The composer serializes a picked project item as
 * `@[<label>](dv:<kind>/<id>)`; this module finds those mentions in user text and describes each one with the
 * concrete record and asset IDs the model needs to act on it.
 *
 * Mention URIs:
 * - `dv:asset/<AssetId>`: a stored asset.
 * - `dv:record/<RecordId>`: a record.
 * - `dv:character/<CharacterId>`, `dv:location/<LocationId>`, `dv:style/<StyleId>`: a character, location or style.
 * - `dv:clip/<ClipId>`: a clip of a timeline; a clip ID is unique in the project.
 * - `dv:attachment/<n>`: the asset imported from the n-th attachment (1-based, image and file blocks together, in content
 *   order) of the user message that holds the mention. The composer writes it for a file attached to the same message,
 *   whose asset ID does not exist until the host imports the file.
 *
 * @module @dv/chat-references/expand
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { formatInputRef, toolNameOf, type AssetId, type ProjectId, type ProjectRecord, type ProjectState, type RecordId } from '@dv/project'
import type { Character, Location, Style } from '@dv/story-bible'
import type {} from '@dv/timeline'

/** One `dv:` mention found in user text. */
export interface Mention {
  label: string
  uri: string
}

/** The composer's serialized mention: `@[label](dv:...)`. */
const MENTION = /@\[([^\]]*)\]\((dv:[^)\s]+)\)/g

/**
 * Find every `dv:` mention in a text, in order.
 * @param text - user text.
 * @returns the mentions.
 */
export function parseMentions(text: string): Mention[] {
  return [...text.matchAll(MENTION)].map(match => ({ label: match[1] ?? '', uri: match[2] ?? '' }))
}

/**
 * The assets a text mentions with `dv:asset/<AssetId>`, each once, in order.
 * @param text - user text.
 * @returns the asset IDs.
 */
export function mentionedAssetIds(text: string): AssetId[] {
  return [...new Set(parseMentions(text).flatMap(mention => mention.uri.startsWith('dv:asset/')
    ? [brandString<AssetId>(decodeURIComponent(mention.uri.slice('dv:asset/'.length)))]
    : []))]
}

/**
 * Format one mention the way the composer serializes it.
 * @param label - the chip label, such as `时间线 1·片段 2`.
 * @param uri - the `dv:` URI.
 * @returns the mention text.
 */
export function formatMention(label: string, uri: string): string {
  return `@[${label.replaceAll(']', '')}](${uri})`
}

/**
 * Whether a text holds a `dv:attachment/<n>` mention.
 * @param text - user text.
 * @returns true when it does.
 */
export function mentionsAttachment(text: string): boolean {
  return parseMentions(text).some(mention => mention.uri.startsWith('dv:attachment/'))
}

/** One user message as expansion reads it. */
export interface MentionMessage {
  /** The text of the message's text blocks. */
  text: string
  /**
   * The asset imported from each attachment block of the message, in content order; null for a block that was not
   * imported. `dv:attachment/<n>` mentions of the message read entry n - 1.
   */
  attachments: ReadonlyArray<AssetId | null>
  /**
   * Whether the conversation had no project when the message entered a step: its attachments then import into the
   * project the conversation gets later, and {@link deferredAttachmentsBlock} names their assets.
   */
  importPending: boolean
}

/** One file a user attached while the conversation had no project, after the conversation got one. */
export interface DeferredAttachment {
  /** The file's display name. */
  name: string
  /** The 1-based position of the file among the attachments of its message, as `dv:attachment/<n>` numbers it. */
  position: number
  /** The 1-based position of its message among the messages whose attachments waited for the project. */
  message: number
  /** The asset imported from the file, or null when it was not imported. */
  asset: AssetId | null
}

/**
 * The context block that names the assets of the files a user attached while the conversation had no project, or null
 * when there are none.
 * @param entries - the files, in message order and then in attachment order.
 * @returns the block.
 */
export function deferredAttachmentsBlock(entries: readonly DeferredAttachment[]): string | null {
  if (entries.length === 0) return null
  const several = entries.some(entry => entry.message > 1)
  const lines = entries.map((entry) => {
    const where = `dv:attachment/${String(entry.position)} of ${several ? `earlier message ${String(entry.message)}` : 'the earlier message'}`
    return `- "${entry.name}" (${where}): ${entry.asset === null ? 'not imported as an asset' : `asset ${entry.asset}`}`
  })
  return `The files the user attached while this conversation had no project are now imported into its project:\n${lines.join('\n')}`
}

/** What expansion reads from the Project service. */
export interface ExpansionSources {
  /** The current state of a project. */
  getState(projectId: ProjectId): ProjectState
  /** A record, or undefined when the project has no such record. */
  getRecord(projectId: ProjectId, record: RecordId): ProjectRecord | undefined
}

/**
 * Describe one mention with concrete IDs.
 * @param mention - the mention.
 * @param projectId - the project the session works on.
 * @param sources - the Project reads.
 * @param message - the attachments of the message that holds the mention, as {@link MentionMessage} reads them.
 * @returns one line for the model.
 */
export function describeMention(
  mention: Mention, projectId: ProjectId, sources: ExpansionSources, message: Pick<MentionMessage, 'attachments' | 'importPending'>,
): string {
  const [kind = '', ...rest] = mention.uri.slice('dv:'.length).split('/').map(decodeURIComponent)
  const id = rest.join('/')
  const head = `- ${mention.label} (${mention.uri})`
  const state = sources.getState(projectId)
  switch (kind) {
    case 'clip':
      return `${head}: ${clipText(state, id, projectId, sources)}`
    case 'asset': {
      const producer = state.components.proj.created_by[brandString<AssetId>(id)]
      return `${head}: asset ${id}${producerText(projectId, producer, sources)}`
    }
    case 'attachment': {
      const asset = attachmentAsset(id, message)
      if (asset === null) return attachmentText(head, id, message)
      const producer = state.components.proj.created_by[asset]
      return `${head}: attachment ${id} of this message, asset ${asset}${producerText(projectId, producer, sources)}`
    }
    case 'character':
    case 'location':
    case 'style': {
      const { characters, locations, styles } = state.components.bible
      const byId: Record<string, ReadonlyArray<Character | Location | Style>> =
        kind === 'character' ? characters : kind === 'location' ? locations : styles
      const latest = byId[id]?.at(-1)
      if (latest === undefined) return `${head}: no ${kind} ${id} in the current state`
      const version = `${id}@${String(latest.version)}`
      return `${head}: ${kind} ${version} "${latest.name}", reference images [${latest.references.join(', ')}]; pass it as input ${version}`
    }
    case 'record':
      return `${head}:${producerText(projectId, brandString<RecordId>(id), sources)}`
    default:
      return `${head}: unknown mention kind`
  }
}

/** The asset imported from attachment `id` of a message, or null when there is none. */
function attachmentAsset(id: string, message: Pick<MentionMessage, 'attachments'>): AssetId | null {
  return /^[1-9]\d*$/.test(id) ? message.attachments[Number(id) - 1] ?? null : null
}

/** The description of a `dv:attachment/<id>` mention whose message has no imported asset at that position. */
function attachmentText(head: string, id: string, message: Pick<MentionMessage, 'attachments' | 'importPending'>): string {
  if (!/^[1-9]\d*$/.test(id) || message.attachments.length < Number(id)) return `${head}: no attachment ${id} in this message`
  if (message.importPending) return `${head}: attachment ${id} of this message; it is imported as an asset once this conversation has a project`
  return `${head}: attachment ${id} of this message, not imported as an asset`
}

/**
 * A clip of a timeline in the current state: its timeline (with its name when it has one), its 1-based position, its
 * asset, and the record that produced the asset. A placeholder clip names the render record it waits for, whose
 * status tells whether the render is still running or failed.
 */
function clipText(state: ProjectState, clipId: string, projectId: ProjectId, sources: ExpansionSources): string {
  for (const timeline of state.components.timeline.timelines) {
    const index = timeline.clips.findIndex(clip => clip.id === clipId)
    const clip = timeline.clips[index]
    if (clip === undefined) continue
    const producer = clip.asset === null ? clip.source?.record : state.components.proj.created_by[clip.asset]
    const name = timeline.name === '' ? '' : ` "${timeline.name}"`
    return `clip ${clipId}, clip ${String(index + 1)} of timeline ${timeline.id}${name}, `
      + `${clip.asset === null ? 'a placeholder clip (no asset until its render is done), its render' : `asset ${clip.asset}`}`
      + producerText(projectId, producer, sources)
  }
  return `no clip ${clipId} in the current state`
}

/** The producing record of an asset, as ` made by …` text. */
function producerText(projectId: ProjectId, recordId: RecordId | undefined, sources: ExpansionSources): string {
  if (recordId === undefined) return ', imported (no producing record)'
  const record = sources.getRecord(projectId, recordId)
  if (record === undefined) return `, record ${recordId} not found`
  const prompt = typeof record.params['prompt'] === 'string' ? `, prompt "${record.params['prompt']}"` : ''
  const duration = record.report?.['duration_sec'] ?? record.params['duration_sec']
  const inputs = record.inputs.map(input => `${input.role}=${input.resolved_asset ?? formatInputRef(input.ref)}`).join(', ')
  const maker = record.operation === null ? record.kind : toolNameOf({ name: record.operation })
  return ` made by record ${record.id} (${maker}, ${record.status})${prompt}`
    + `${duration === undefined ? '' : `, duration ${String(duration)} s`}`
    + `, inputs [${inputs}], outputs [${record.outputs.join(', ')}]; to change it call the tool again with based_on ${record.id}`
}

/**
 * The context block for the mentions in one step's user messages, in message order, or null when they hold none. A
 * `dv:attachment/<n>` mention reads the attachments of its own message.
 * @param messages - the user messages.
 * @param projectId - the session's project, or null when none is bound.
 * @param sources - the Project reads.
 * @returns the block.
 */
export function expansionBlock(messages: readonly MentionMessage[], projectId: ProjectId | null, sources: ExpansionSources): string | null {
  const lines = messages.flatMap(message => parseMentions(message.text).map((mention) => {
    if (projectId !== null) return describeMention(mention, projectId, sources, message)
    const head = `- ${mention.label} (${mention.uri})`
    // A file attached to the message needs no project to be described; it imports once the conversation has one.
    if (mention.uri.startsWith('dv:attachment/')) return attachmentText(head, mention.uri.slice('dv:attachment/'.length), message)
    return `${head}: no project is bound to this conversation; call dv_proj_open first`
  }))
  if (lines.length === 0) return null
  return `The user referenced these project items:\n${lines.join('\n')}`
}
