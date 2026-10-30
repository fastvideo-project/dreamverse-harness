/**
 * The pure rules of a text node's Markdown: which paths are valid, how literal edits apply, which lines a heading's
 * section spans, and how a read numbers lines. The operations and the reducer share them, so a refused edit and a
 * reduced edit agree.
 *
 * @module @dv/text-node/text
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TextEdit, TextPath } from './types.ts'

/**
 * Parse a caller's path into a `TextPath`.
 * @param raw - the `path` param.
 * @returns the path.
 * @throws Error that names the rule the path breaks.
 */
export function parseTextPath(raw: string): TextPath {
  const rule = raw.trim() === '' ? 'is empty'
    : raw.startsWith('/') ? 'starts with /'
      : /[@#]/u.test(raw) ? 'contains @ or #'
        : raw.includes('..') ? 'contains ..'
          : null
  if (rule !== null) {
    throw new Error(`Text node path '${raw}' ${rule}; use a relative path such as beats.md or scripts/ep1.md.`)
  }
  return brandString<TextPath>(raw)
}

/** How many times `part` occurs in `text`, overlapping occurrences included. */
function occurrences(text: string, part: string): number {
  let count = 0
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) count += 1
  return count
}

/** The outcome of applying edits: the edited body, or one sentence per edit that does not apply. */
export type EditOutcome = { ok: true; body: string } | { ok: false; problems: string[] }

/**
 * Apply literal edits in order, each to the text that the edits before it left. An edit applies when its `old_text`
 * is not empty and occurs exactly once; an empty list of edits does not apply.
 * @param body - the text of the version the edits start from.
 * @param edits - the edits.
 * @returns the edited body, or the problems of every edit that does not apply.
 */
export function applyEdits(body: string, edits: readonly TextEdit[]): EditOutcome {
  if (edits.length === 0) return { ok: false, problems: ['edits is empty; pass at least one edit, or write nothing.'] }
  let text = body
  const problems: string[] = []
  edits.forEach((edit, index) => {
    const count = edit.old_text === '' ? 0 : occurrences(text, edit.old_text)
    if (count === 1) {
      const at = text.indexOf(edit.old_text)
      text = text.slice(0, at) + edit.new_text + text.slice(at + edit.old_text.length)
      return
    }
    problems.push(edit.old_text === ''
      ? `Edit ${String(index + 1)} has an empty old_text.`
      : `Edit ${String(index + 1)}: old_text occurs ${String(count)} times; it must occur exactly once, so copy it exactly `
        + 'and add neighboring lines until it is unique.')
  })
  return problems.length === 0 ? { ok: true, body: text } : { ok: false, problems }
}

/** A Markdown ATX heading line: its level and its text without closing `#` marks. */
function headingOf(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/u.exec(line)
  return match === null ? null : { level: match[1]?.length ?? 0, text: match[2] ?? '' }
}

/** The text of the first heading of a body, or null when it has none. */
export function firstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    const heading = headingOf(line)
    if (heading !== null) return heading.text
  }
  return null
}

/**
 * The lines of a body, each with its 1-based line number and a tab, as `textnode.read` returns them.
 * @param body - the body.
 * @param section - the text of a heading: only that heading's section, from the heading to the next heading of the
 *   same or a higher level; the first such heading when several have that text.
 * @returns the numbered lines, joined by newlines.
 * @throws Error that lists the headings when no heading has the text.
 */
export function numberedLines(body: string, section?: string): string {
  const lines = body.split('\n')
  let [start, end] = [0, lines.length]
  if (section !== undefined) {
    const headings = lines.map(headingOf)
    start = headings.findIndex(heading => heading?.text === section.trim())
    if (start < 0) {
      const names = headings.flatMap(heading => heading === null ? [] : [heading.text])
      throw new Error(`No heading '${section}'; the headings are: ${names.length === 0 ? 'none' : names.join(' | ')}.`)
    }
    const level = headings[start]?.level ?? 0
    const next = headings.findIndex((heading, index) => index > start && heading !== null && heading.level <= level)
    end = next < 0 ? lines.length : next
  }
  return lines.slice(start, end).map((line, index) => `${String(start + index + 1)}\t${line}`).join('\n')
}
