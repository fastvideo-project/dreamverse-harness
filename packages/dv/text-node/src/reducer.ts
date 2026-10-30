/**
 * The pure reducer of the Text node component: the `textnode` slice from the finished `textnode.write` and
 * `textnode.edit` records.
 *
 * @module @dv/text-node/reducer
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectState, Reducer } from '@dv/project'
import { applyEdits, firstHeading } from './text.ts'
import type { TextEdit, TextPath, TextState, TextVersion } from './types.ts'

/** The title and body of the next version, or the problems that keep a call from writing one. */
export type NextText = { ok: true; title: string; body: string } | { ok: false; problems: string[] }

/** The newest version of a text node in a slice, or undefined for a path without versions. */
export function latestIn(slice: TextState, path: string): TextVersion | undefined {
  return slice.texts[brandString<TextPath>(path)]?.at(-1)
}

/** The newest version of a text node in a project state, or undefined for a path without versions. */
export function latestVersion(state: ProjectState, path: string): TextVersion | undefined {
  return latestIn(state.components.textnode, path)
}

/**
 * The title and body that a `textnode.write` or `textnode.edit` call gives the next version of a text node. A write takes its
 * `body`, and its `title`, else the previous title, else the first heading of the body, else the path. An edit applies
 * its `edits` to the previous body and keeps the previous title.
 * @param operation - `textnode.write` or `textnode.edit`.
 * @param params - the call's validated params.
 * @param previous - the newest version of the text node, when it has one.
 * @returns the next title and body, or the problems of the edits.
 */
export function nextText(operation: string, params: Record<string, unknown>, previous: TextVersion | undefined): NextText {
  const path = String(params['path'])
  if (operation === 'textnode.write') {
    const body = String(params['body'])
    const title = typeof params['title'] === 'string' ? params['title'] : previous?.title ?? firstHeading(body) ?? path
    return { ok: true, title, body }
  }
  if (previous === undefined) return { ok: false, problems: [`No text node ${path}; create it with dv_textnode_write.`] }
  const edited = applyEdits(previous.body, params['edits'] as TextEdit[])
  return edited.ok ? { ok: true, title: previous.title, body: edited.body } : edited
}

/**
 * The `textnode` reducer: a finished `textnode.write` or `textnode.edit` record appends the next version of the text node its
 * `path` param names, with the record's first output as its asset. Records of other operations, records that are not
 * `done`, and edits that no longer apply leave the slice unchanged.
 */
export const textReducer: Reducer<'textnode'> = {
  initial: () => ({ texts: {} }),
  reduce(slice, record) {
    if (record.status !== 'done' || (record.operation !== 'textnode.write' && record.operation !== 'textnode.edit')) return slice
    const path = brandString<TextPath>(String(record.params['path']))
    const versions = slice.texts[path] ?? []
    const next = nextText(record.operation, record.params, versions.at(-1))
    const asset = record.outputs[0]
    if (!next.ok || asset === undefined) return slice
    const version: TextVersion = { version: versions.length + 1, title: next.title, body: next.body, asset, created_by: record.id }
    return { texts: { ...slice.texts, [path]: [...versions, version] } }
  },
  agentSummary(slice) {
    // Each text node once: its newest version, without the body.
    return {
      texts: Object.entries(slice.texts).flatMap(([path, versions]) => {
        const latest = versions.at(-1)
        if (latest === undefined) return []
        const { title, version, asset } = latest
        return [{ path, title, version, chars: Array.from(latest.body).length, asset }]
      }),
    }
  },
}
