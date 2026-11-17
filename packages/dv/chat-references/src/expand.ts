/**
 * Expansion of the composer's `dv:` mentions. The composer writes a picked project item as the citation
 * `@[<label>](dv:<kind>/<id>)` with `formatCitation` of `@dv/project`; this module reads those citations in user text
 * with the kernel's own parser and describes each one with the concrete record and asset IDs the model needs to act on
 * it.
 *
 * Mention URIs:
 * - `dv:asset/<AssetId>`: a stored asset.
 * - `dv:record/<RecordId>`: a record.
 * - `dv:<kind>/<id>` for a registered reference kind (`dvProject.listReferenceKinds()`): the newest version of an ID.
 * - `dv:clip/<ClipId>`: a clip of a timeline; a clip ID is unique in the project.
 *
 * @module @dv/chat-references/expand
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  citationTarget, formatInputRef, parsePromptCitations, toolNameOf, type AssetId, type ProjectId, type ProjectRecord, type ProjectState,
  type PromptCitation, type RecordId, type RecordInputRef,
} from '@dv/project'
import type {} from '@dv/timeline'

/** One `dv:` mention found in user text: a citation as the kernel's parser reads it. */
export type Mention = Pick<PromptCitation, 'label' | 'uri'>

/** What expansion reads from the Project service. */
export interface ExpansionSources {
  /** The current state of a project. */
  getState(projectId: ProjectId): ProjectState
  /** A record, or undefined when the project has no such record. */
  getRecord(projectId: ProjectId, record: RecordId): ProjectRecord | undefined
  /** The registered reference kinds. */
  listReferenceKinds(): readonly string[]
  /** The newest version of an ID in a reference kind, or null. */
  latestVersion(state: ProjectState, kind: string, id: string): number | null
  /** The assets of a version, or null for an unknown version. */
  assetsOf(state: ProjectState, ref: RecordInputRef): AssetId[] | null
}

/**
 * Describe one mention with concrete IDs.
 * @param mention - the mention.
 * @param projectId - the project the session works on.
 * @param sources - the Project reads.
 * @returns one line for the model.
 */
export function describeMention(mention: Mention, projectId: ProjectId, sources: ExpansionSources): string {
  const head = `- ${mention.label} (${mention.uri})`
  // A URI with a malformed escape names nothing, as the kernel reads it.
  const target = citationTarget(mention.uri)
  if (target === null) return `${head}: unknown mention kind`
  const { kind, id } = target
  const state = sources.getState(projectId)
  switch (kind) {
    case 'clip':
      return `${head}: ${clipText(state, id, projectId, sources)}`
    case 'asset': {
      const producer = state.components.proj.created_by[brandString<AssetId>(id)]
      return `${head}: asset ${id}${producerText(projectId, producer, sources)}`
    }
    case 'record':
      return `${head}:${producerText(projectId, brandString<RecordId>(id), sources)}`
    default:
      return sources.listReferenceKinds().includes(kind) ? `${head}: ${versionText(state, kind, id, sources)}` : `${head}: unknown mention kind`
  }
}

/** The newest version of an ID in a reference kind and the assets of that version, as the input text that names it. */
function versionText(state: ProjectState, kind: string, id: string, sources: ExpansionSources): string {
  const version = sources.latestVersion(state, kind, id)
  if (version === null) return `no ${kind} ${id} in the current state`
  const fields: Record<string, string | number> = { [kind]: id, version }
  const assets = sources.assetsOf(state, fields as RecordInputRef) ?? []
  const text = `${id}@${String(version)}`
  return `${kind} ${text}, reference assets [${assets.join(', ')}]; pass it as input ${text}`
}

/**
 * A clip of a timeline in the current state: its timeline (with its name when it has one), its 1-based place by start
 * time among the clips of its video track, as the mention menu numbers it, its asset, and the record that produced the
 * asset. A placeholder clip names the render record it waits for, whose
 * status tells whether the render is still running or failed.
 */
function clipText(state: ProjectState, clipId: string, projectId: ProjectId, sources: ExpansionSources): string {
  for (const timeline of state.components.timeline.timelines) {
    const clip = timeline.clips.find(each => each.id === clipId)
    if (clip === undefined) continue
    // A tie keeps the order the timeline stores the clips in, as the mention menu does.
    const place = timeline.clips.filter(each => each.track === clip.track).toSorted((a, b) => a.start_sec - b.start_sec).indexOf(clip) + 1
    const producer = clip.asset === null ? clip.source?.record : state.components.proj.created_by[clip.asset]
    const name = timeline.name === '' ? '' : ` "${timeline.name}"`
    return `clip ${clipId}, clip ${String(place)} by start time on video track ${String(clip.track)} of timeline ${timeline.id}${name}, `
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
 * The context block for the mentions in one user text, or null when the text has none.
 * @param text - the user text.
 * @param projectId - the session's project, or null when none is bound.
 * @param sources - the Project reads.
 * @returns the block.
 */
export function expansionBlock(text: string, projectId: ProjectId | null, sources: ExpansionSources): string | null {
  const mentions = parsePromptCitations(text)
  if (mentions.length === 0) return null
  const lines = projectId === null
    ? mentions.map(mention => `- ${mention.label} (${mention.uri}): this conversation has no project yet; call dv_proj_create first`)
    : mentions.map(mention => describeMention(mention, projectId, sources))
  return `The user referenced these project items:\n${lines.join('\n')}`
}
