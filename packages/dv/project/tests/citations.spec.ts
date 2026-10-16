/**
 * Tests of the citations of a prompt: parsing, the cited assets, and replacement.
 */
import { describe, expect, it } from 'vitest'
import { citedAsset, citedInput, parsePromptCitations, promptAssets, replacePromptCitations } from '../src/index.ts'

const PROMPT = '@[Mia · front](dv:asset/a1) meets @[Bo](dv:asset/b%2F2) by @[the lake](dv:element/e1@2), then @[Mia](dv:asset/a1) waves'

describe('prompt citations', () => {
  it('finds each citation with its label, URI and offsets', () => {
    const citations = parsePromptCitations(PROMPT)
    expect(citations.map(({ label, uri }) => ({ label, uri }))).toEqual([
      { label: 'Mia · front', uri: 'dv:asset/a1' }, { label: 'Bo', uri: 'dv:asset/b%2F2' },
      { label: 'the lake', uri: 'dv:element/e1@2' }, { label: 'Mia', uri: 'dv:asset/a1' },
    ])
    expect(PROMPT.slice(citations[1]?.start, citations[1]?.end)).toBe('@[Bo](dv:asset/b%2F2)')
    expect(parsePromptCitations('a cat [x](dv:asset/a1) @[y](https://example.com)')).toEqual([])
  })

  it('names the cited assets once each, in the order of their first citation', () => {
    expect(citedAsset('dv:asset/b%2F2')).toBe('b/2')
    expect(citedAsset('dv:element/e1@2')).toBeNull()
    expect(citedInput('dv:input/first_frame')).toBe('first_frame')
    expect(citedInput('dv:asset/a1')).toBeNull()
    expect(promptAssets(PROMPT)).toEqual(['a1', 'b/2'])
    expect(promptAssets('a cat')).toEqual([])
  })

  it('replaces each citation and keeps the text around it', () => {
    expect(replacePromptCitations(PROMPT, citation => `<${citation.label}>`))
      .toBe('<Mia · front> meets <Bo> by <the lake>, then <Mia> waves')
    expect(replacePromptCitations('a cat', () => 'x')).toBe('a cat')
  })
})
