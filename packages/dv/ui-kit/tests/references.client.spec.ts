/** The asset citations of a shot prompt: the split at citations, the cited assets, and writing and removing citations. */
import { describe, expect, it } from 'vitest'
import { assetCitation, citedAssets, insertAt, promptParts, removeCitations } from '../src/client/references.ts'

describe('promptParts', () => {
  it('splits a prompt at its asset citations, decodes their IDs, and keeps their text', () => {
    expect(promptParts('@[Hero](dv:asset/ref.png) walks past @[a b](dv:asset/a%20b.png) at night')).toEqual([
      { asset: 'ref.png', label: 'Hero', text: '@[Hero](dv:asset/ref.png)' }, { text: ' walks past ' },
      { asset: 'a b.png', label: 'a b', text: '@[a b](dv:asset/a%20b.png)' }, { text: ' at night' },
    ])
    expect(promptParts('no citations')).toEqual([{ text: 'no citations' }])
    expect(promptParts('')).toEqual([])
  })

  it('leaves a citation of anything other than an asset, and a malformed escape, as text', () => {
    expect(promptParts('@[Hero](dv:character/hero) and @[x](dv:asset/%E0) then @[y](dv:asset/y.png)')).toEqual([
      { text: '@[Hero](dv:character/hero) and @[x](dv:asset/%E0) then ' }, { asset: 'y.png', label: 'y', text: '@[y](dv:asset/y.png)' },
    ])
  })
})

describe('citedAssets', () => {
  it('lists each cited asset once, in the order of its first citation', () => {
    expect(citedAssets('@[b](dv:asset/b.png) and @[a](dv:asset/a.png), then @[b again](dv:asset/b.png)')).toEqual(['b.png', 'a.png'])
    expect(citedAssets('plain text')).toEqual([])
  })
})

describe('assetCitation', () => {
  it('labels the citation with the asset name without `]` and encodes the ID', () => {
    const citation = assetCitation({ id: 'shots/a b.png', name: 'take [1]' })
    expect(citation).toBe('@[take [1](dv:asset/shots%2Fa%20b.png)')
    expect(citedAssets(citation)).toEqual(['shots/a b.png'])
  })
})

describe('removeCitations', () => {
  it('removes every citation of one asset and keeps the rest of the prompt', () => {
    expect(removeCitations('@[a](dv:asset/a.png) meets @[b](dv:asset/b.png) and @[a](dv:asset/a.png).', 'a.png'))
      .toBe(' meets @[b](dv:asset/b.png) and .')
  })
})

describe('insertAt', () => {
  it('separates the inserted text from adjacent non-space characters with one space', () => {
    expect(insertAt('hero walks', 4, 'X')).toBe('hero X walks')
    expect(insertAt('herowalks', 4, 'X')).toBe('hero X walks')
    expect(insertAt('hero walks', 99, 'X')).toBe('hero walks X')
    expect(insertAt('hero walks ', 11, 'X')).toBe('hero walks X')
    expect(insertAt('', 0, 'X')).toBe('X')
  })
})
