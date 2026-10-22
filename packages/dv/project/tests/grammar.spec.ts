/**
 * Tests of the reference grammars: the citation writer and readers, and the input reference split and writer.
 */
import { describe, expect, it } from 'vitest'
import {
  citationTarget, citedElement, elementCitationUri, formatCitation, formatInputRef, formatInputSyntax, parsePromptCitations, splitInputRef,
} from '../src/grammar.ts'

describe('citation grammar', () => {
  it('writes an ID with parentheses so that the reader returns the whole URI and the element (V1)', () => {
    const citation = formatCitation('Mia', 'character', 'mia(young)')
    expect(citation).toBe('@[Mia](dv:character/mia%28young%29)')
    const [parsed] = parsePromptCitations(`${citation} waves`)
    expect(parsed?.uri).toBe('dv:character/mia%28young%29')
    expect(citedElement(parsed?.uri ?? '')).toEqual({ kind: 'character', id: 'mia(young)' })
    expect(elementCitationUri({ character: 'mia(young)', version: 1 } as never)).toBe(parsed?.uri)
  })

  it('never writes an empty label or a label with a line break, and still reads both (V2)', () => {
    expect(formatCitation('', 'asset', 'a1')).toBe('@[a1](dv:asset/a1)')
    expect(formatCitation('Mia\nfront', 'asset', 'a1')).toBe('@[Mia front](dv:asset/a1)')
    expect(parsePromptCitations('@[](dv:asset/a1) @[Mia\nfront](dv:asset/a1)').map(c => c.label)).toEqual(['', 'Mia\nfront'])
  })

  it('reads the kind and the ID of any citation URI, which the writer writes back', () => {
    expect(citationTarget('dv:clip/c%201')).toEqual({ kind: 'clip', id: 'c 1' })
    expect(formatCitation('Clip', 'clip', 'c 1')).toBe('@[Clip](dv:clip/c%201)')
    expect([citationTarget('https://x'), citationTarget('dv:nothing')]).toEqual([null, null])
  })

  it('names no element for an asset, a record or an input citation', () => {
    expect(['dv:asset/a1', 'dv:record/r1', 'dv:input/first_frame', 'https://x'].map(citedElement)).toEqual([null, null, null, null])
  })
})

describe('input reference grammar', () => {
  it('splits each syntax and writes it back', () => {
    expect(splitInputRef('a1')).toEqual({ asset: 'a1' })
    expect(splitInputRef('r7#0')).toEqual({ record: 'r7', output: 0 })
    expect(splitInputRef('mia@2')).toEqual({ id: 'mia', version: 2 })
    expect(splitInputRef('@2')).toEqual({ asset: '@2' })
    expect([{ asset: 'a1' }, { record: 'r7', output: 0 }, { character: 'mia', version: 2 }].map(ref => formatInputRef(ref as never)))
      .toEqual(['a1', 'r7#0', 'mia@2'])
    expect(['a1', 'r7#0', 'mia@2'].map(text => formatInputSyntax(splitInputRef(text)))).toEqual(['a1', 'r7#0', 'mia@2'])
  })
})
