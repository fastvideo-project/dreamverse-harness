/**
 * The citations of a render prompt. A prompt cites a project item with the composer's mention syntax
 * `@[<label>](dv:<kind>/<id>)`; `RenderRequest.prompt` carries the citations, and each provider plugin replaces them
 * with the syntax of its model before the model reads the prompt.
 *
 * Citation URIs that a render prompt can hold:
 * - `dv:asset/<AssetId>`: one asset of the project.
 *
 * @module @dv/models/citations
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId } from '@dv/project'

/** One citation in a prompt. */
export interface PromptCitation {
  /** The label that the editor shows, such as `Jensen · front`. */
  label: string
  /** The `dv:` URI, such as `dv:asset/a1`. */
  uri: string
  /** The offset of the citation's `@` in the prompt. */
  start: number
  /** The offset after the citation's closing parenthesis. */
  end: number
}

/** A serialized citation: `@[label](dv:...)`. */
const CITATION = /@\[([^\]]*)\]\((dv:[^)\s]+)\)/g

/** The URI prefix of an asset citation. */
const ASSET_PREFIX = 'dv:asset/'

/**
 * Find every citation in a prompt.
 * @param prompt - the prompt.
 * @returns the citations in prompt order.
 */
export function parsePromptCitations(prompt: string): PromptCitation[] {
  return [...prompt.matchAll(CITATION)].map(match => ({
    label: match[1] ?? '', uri: match[2] ?? '', start: match.index, end: match.index + match[0].length,
  }))
}

/**
 * The asset that a citation URI names.
 * @param uri - a `dv:` URI.
 * @returns the asset ID of a `dv:asset/<AssetId>` URI; null for any other URI.
 */
export function citedAsset(uri: string): AssetId | null {
  return uri.startsWith(ASSET_PREFIX) ? brandString<AssetId>(decodeURIComponent(uri.slice(ASSET_PREFIX.length))) : null
}

/**
 * The assets that a prompt cites, each once.
 * @param prompt - the prompt.
 * @returns the asset IDs in the order of their first citation.
 */
export function promptAssets(prompt: string): AssetId[] {
  return [...new Set(parsePromptCitations(prompt).flatMap(citation => citedAsset(citation.uri) ?? []))]
}

/**
 * Replace each citation of a prompt with text.
 * @param prompt - the prompt.
 * @param replace - the text for one citation.
 * @returns the prompt with every citation replaced.
 */
export function replacePromptCitations(prompt: string, replace: (citation: PromptCitation) => string): string {
  let text = ''
  let last = 0
  for (const citation of parsePromptCitations(prompt)) {
    text += prompt.slice(last, citation.start) + replace(citation)
    last = citation.end
  }
  return text + prompt.slice(last)
}
