/**
 * The text nodes of a project state as the browser half reads them: the `textnode` slice, the version that a record
 * wrote, and the newest version of each path.
 *
 * @module @dv/ui-text-node/texts
 */
import type { TextState, TextVersion } from '@dv/text-node/types'
import type { ProjectRecord, WireState } from '@dv/ui-kit/types.ts'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { textnode: TextState } }

/** The node type, the reference kind and the component key of text nodes. */
export const TEXT_KIND = 'textnode'

/** The operations whose records are text node versions. */
export const TEXT_OPERATIONS = ['textnode.write', 'textnode.edit'] as const

/** The versions of every text node by path, oldest first; a state without the `textnode` slice holds none. */
export const textsOf = (state: WireState): Readonly<Record<string, readonly TextVersion[]>> => state.components.textnode?.texts ?? {}

/** The path that a text node record names. */
export function pathOf(record: ProjectRecord): string {
  const path = record.params['path']
  return typeof path === 'string' ? path : ''
}

/** The version number in a text node record's report, or null before the record is done. */
export function reportedVersion(record: ProjectRecord): number | null {
  const version = record.report?.['version']
  return typeof version === 'number' ? version : null
}

/** The path and the newest version of every text node of a state, in slice order. */
export function newestTexts(state: WireState): Array<[string, TextVersion]> {
  return Object.entries(textsOf(state)).flatMap(([path, versions]) => {
    const latest = versions.at(-1)
    return latest === undefined ? [] : [[path, latest] as [string, TextVersion]]
  })
}

/**
 * Turn each citation `@[label](dv:…)` of a text into its label.
 * @param text - Markdown with citations.
 * @param citations - the citations of the text, as `parsePromptCitations` of `@dv/project/grammar` reads them.
 * @returns the text with each citation replaced by its label.
 */
export function withLabels(text: string, citations: ReadonlyArray<{ label: string; start: number; end: number }>): string {
  let out = ''
  let at = 0
  for (const citation of citations) {
    out += text.slice(at, citation.start) + citation.label
    at = citation.end
  }
  return out + text.slice(at)
}
