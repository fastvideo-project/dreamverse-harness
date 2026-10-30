/** The pure `textnode` reducer and the heading rules of `text.ts`: each operation, the ignored records and the agent summary. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, ProjectRecord, RecordId } from '@dv/project'
import { describe, expect, it } from 'vitest'
import { textReducer } from '../src/reducer.ts'
import { firstHeading, numberedLines } from '../src/text.ts'
import type { TextPath, TextState } from '../src/types.ts'

let counter = 0

/** A finished record of one operation with the given params and one output asset. */
function step(operation: string, params: Record<string, unknown>, fields: Partial<ProjectRecord> = {}): ProjectRecord {
  counter += 1
  return {
    id: brandString<RecordId>(`record-${String(counter)}`), parents: [], kind: 'operation', component: 'textnode', operation,
    operation_version: '1', actor: 'agent', surface: 'chat', turn: null, session: null, tool_call: null, intent: 'write', params,
    inputs: [], outputs: [brandString<AssetId>(`asset-${String(counter)}`)], based_on: null, supersedes: [], deterministic: false,
    status: 'done', created_at: new Date().toISOString(), ...fields,
  }
}

/** Reduce records in order from the initial slice. */
function reduceAll(records: ProjectRecord[]): TextState {
  return records.reduce((slice, record) => textReducer.reduce(slice, record), textReducer.initial())
}

/** The versions of one path as `version title body` text, for compact expectations. */
function versionsOf(slice: TextState, path: string): string[] {
  return (slice.texts[brandString<TextPath>(path)] ?? []).map(version => `${String(version.version)} ${version.title} ${version.body}`)
}

describe('textReducer', () => {
  it('appends a write as the next version, with the title of the write, else the previous title, else the first heading, else the path', () => {
    const slice = reduceAll([
      step('textnode.write', { path: 'beats.md', body: '# Beats\nA.' }),
      step('textnode.write', { path: 'beats.md', body: 'B.' }),
      step('textnode.write', { path: 'beats.md', body: 'C.', title: 'Story beats' }),
      step('textnode.write', { path: 'notes.md', body: 'no heading' }),
    ])
    expect(versionsOf(slice, 'beats.md')).toEqual(['1 Beats # Beats\nA.', '2 Beats B.', '3 Story beats C.'])
    expect(versionsOf(slice, 'notes.md')).toEqual(['1 notes.md no heading'])
  })

  it('stores the record and its first output as the version\'s producer and asset', () => {
    const write = step('textnode.write', { path: 'beats.md', body: 'A.' })
    const [version] = reduceAll([write]).texts[brandString<TextPath>('beats.md')] ?? []
    expect([version?.created_by, version?.asset]).toEqual([write.id, write.outputs[0]])
  })

  it('applies an edit to the previous body and keeps the previous title', () => {
    const slice = reduceAll([
      step('textnode.write', { path: 'beats.md', body: '# Beats\nMia finds the map.' }),
      step('textnode.edit', { path: 'beats.md', edits: [{ old_text: 'finds', new_text: 'steals' }] }),
    ])
    expect(versionsOf(slice, 'beats.md')).toEqual(['1 Beats # Beats\nMia finds the map.', '2 Beats # Beats\nMia steals the map.'])
  })

  it('ignores an edit that does not apply, an edit of a new path, records that are not done, records without an output, and other operations', () => {
    const first = step('textnode.write', { path: 'beats.md', body: 'A.' })
    const slice = reduceAll([
      first,
      step('textnode.edit', { path: 'beats.md', edits: [{ old_text: 'Z.', new_text: 'Y.' }] }),
      step('textnode.edit', { path: 'new.md', edits: [{ old_text: 'A.', new_text: 'B.' }] }),
      step('textnode.write', { path: 'beats.md', body: 'pending' }, { status: 'pending' }),
      step('textnode.write', { path: 'beats.md', body: 'failed' }, { status: 'failed' }),
      step('textnode.write', { path: 'beats.md', body: 'no output' }, { outputs: [] }),
      step('probe.write', { path: 'beats.md', body: 'other' }),
    ])
    expect(slice.texts).toEqual(reduceAll([first]).texts)
  })

  it('summarizes each text node once by its newest version, without its body', () => {
    const slice = reduceAll([
      step('textnode.write', { path: 'beats.md', body: '# Beats\nA.' }),
      step('textnode.write', { path: 'beats.md', body: '# Beats\nAB.' }),
    ])
    const newest = slice.texts[brandString<TextPath>('beats.md')]?.[1]
    expect(textReducer.agentSummary?.(slice)).toEqual({ texts: [{ path: 'beats.md', title: 'Beats', version: 2, chars: 11, asset: newest?.asset }] })
  })
})

describe('text headings', () => {
  const BODY = '```md\n# Not a heading\n```\n# Title\n~~~~\n## Inside\n```\n~~~\n~~~~\n## Act 1\nA.\n## Act 2\nB.'

  it('skips heading-like lines in fenced code blocks', () => {
    expect(firstHeading(BODY)).toBe('Title')
    expect(numberedLines(BODY, 'Act 1')).toBe('10\t## Act 1\n11\tA.')
    expect(() => numberedLines(BODY, 'Inside')).toThrow('the headings are: Title | Act 1 | Act 2.')
  })
})
