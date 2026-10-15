/**
 * The citations of a shot prompt. A prompt cites an asset with the chat composer's mention syntax
 * `@[<label>](dv:asset/<AssetId>)`, where the asset ID is URI-component-encoded. `shot.render` reads its `reference`
 * inputs from these citations: the distinct cited assets in the order of their first citation. A view splits a prompt
 * at its citations to draw each cited asset, and writes citations into a prompt to add references to it.
 *
 * @module @dv/ui-kit/references
 */
import type { ProjectAsset } from './types.ts'

/** One run of a prompt: plain text, or a citation of one asset that keeps its original text for alt text. */
export type PromptPart = { text: string } | { asset: string; label: string; text: string }

/** A serialized citation: `@[label](dv:...)`. */
const CITATION = /@\[([^\]]*)\]\((dv:[^)\s]+)\)/g

/** The URI prefix of an asset citation. */
const ASSET_PREFIX = 'dv:asset/'

/**
 * The asset that a citation URI names.
 * @param uri - a `dv:` URI.
 * @returns the decoded asset ID of a `dv:asset/<AssetId>` URI; null for any other URI or a malformed escape.
 */
function citedAsset(uri: string): string | null {
  if (!uri.startsWith(ASSET_PREFIX)) return null
  try {
    return decodeURIComponent(uri.slice(ASSET_PREFIX.length))
  } catch (error) {
    // A creator can type a malformed `%` escape into a prompt; that text names no asset.
    void error
    return null
  }
}

/**
 * Split a prompt at its asset citations. A citation of anything other than an asset stays text.
 * @param prompt - the shot prompt.
 * @returns the text runs and citations in prompt order.
 */
export function promptParts(prompt: string): PromptPart[] {
  const parts: PromptPart[] = []
  let last = 0
  // Both groups of `CITATION` always participate in a match, so `String` only narrows their types.
  for (const match of prompt.matchAll(CITATION)) {
    const asset = citedAsset(String(match[2]))
    if (asset === null) continue
    if (match.index > last) parts.push({ text: prompt.slice(last, match.index) })
    parts.push({ asset, label: String(match[1]), text: match[0] })
    last = match.index + match[0].length
  }
  if (last < prompt.length) parts.push({ text: prompt.slice(last) })
  return parts
}

/**
 * The assets that a prompt cites, each once, as `shot.render` derives its `reference` inputs from them.
 * @param prompt - the shot prompt.
 * @returns the asset IDs in the order of their first citation.
 */
export function citedAssets(prompt: string): string[] {
  return [...new Set(promptParts(prompt).flatMap(part => 'asset' in part ? [part.asset] : []))]
}

/**
 * The citation of one asset, labeled with its name; a `]` in the name is dropped, as the chat composer does.
 * @param asset - the cited asset.
 * @returns `@[<name>](dv:asset/<encoded ID>)`.
 */
export function assetCitation(asset: Pick<ProjectAsset, 'id' | 'name'>): string {
  return `@[${asset.name.replaceAll(']', '')}](${ASSET_PREFIX}${encodeURIComponent(asset.id)})`
}

/**
 * Remove every citation of one asset from a prompt; the text around each citation stays as it is.
 * @param prompt - the shot prompt.
 * @param asset - the asset ID.
 * @returns the prompt without the asset's citations.
 */
export function removeCitations(prompt: string, asset: string): string {
  return promptParts(prompt).filter(part => !('asset' in part) || part.asset !== asset).map(part => part.text).join('')
}

/**
 * Insert text into a prompt at a position, with a space between it and any adjacent non-space character.
 * @param prompt - the shot prompt.
 * @param position - the insertion offset; an offset at or past the prompt's end inserts at the end.
 * @param text - the text to insert, such as citations joined by spaces.
 * @returns the prompt with the text inserted.
 */
export function insertAt(prompt: string, position: number, text: string): string {
  const before = prompt.slice(0, position)
  const after = prompt.slice(position)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = after === '' || /^\s/.test(after) ? '' : ' '
  return `${before}${lead}${text}${trail}${after}`
}
