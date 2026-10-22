/**
 * Stored input references read without kind names, the reference assets of a shot, which of them the model numbers as
 * Picture N, and the split of a prompt at its Picture N tokens.
 */
import { describe, expect, it } from 'vitest'
import { formatInputRef, isPicture, parseVersionedReference, pictureParts, referenceAssets, versionRefOf } from '../src/client/references.ts'
import type { VersionKind } from '../src/client/registries.ts'
import type { WireInputRef } from '../src/client/types.ts'
import { asset, fixtureState } from './fixture.client.tsx'

/** One stored input reference of each form: an asset, a record output, and versions of three kinds. */
const REFS: WireInputRef[] = [
  { asset: 'a1' }, { record: 'g1', output: 1 }, { character: 'hero', version: 2 }, { location: 'alley', version: 1 },
  { zz: 'z1', version: 3 },
]

describe('formatInputRef', () => {
  it('writes stored input references as the reference text of an operation request, for a version of any kind', () => {
    expect(REFS.map(formatInputRef)).toEqual(['a1', 'g1#1', 'hero@2', 'alley@1', 'z1@3'])
  })
})

describe('versionRefOf', () => {
  it('names the kind, ID and version of a version reference, and nothing for an asset or a record output', () => {
    expect(REFS.map(versionRefOf)).toEqual([
      null, null, { kind: 'character', id: 'hero', version: 2 }, { kind: 'location', id: 'alley', version: 1 },
      { kind: 'zz', id: 'z1', version: 3 },
    ])
  })

  it('reads a version reference without a kind key as no version, and writes it as its JSON text', () => {
    const kindless: WireInputRef = { version: 2 }
    expect(versionRefOf(kindless)).toBeNull()
    expect(formatInputRef(kindless)).toBe('{"version":2}')
  })
})

describe('parseVersionedReference', () => {
  it('reads the text after the last @ as the version when Number gives an integer, and the text before it as the ID', () => {
    const texts = ['hero@2', 'a@b@2', 'hero@1.0', 'hero@', 'hero@-1', '@1', 'hero@x', 'a@b.png', 'g1#1', 'shot1.mp4']
    expect(texts.map(text => parseVersionedReference(text))).toEqual([
      { id: 'hero', version: 2 }, { id: 'a@b', version: 2 }, { id: 'hero', version: 1 }, { id: 'hero', version: 0 }, { id: 'hero', version: -1 },
      null, null, null, null, null,
    ])
  })
})

/**
 * A test version kind over a fixed list of versions.
 * @param kind - the reference kind.
 * @param versions - item ID → its versions with their reference assets.
 * @returns the version kind.
 */
function testKind(kind: string, versions: Record<string, Array<{ version: number; assets: string[] }>>): VersionKind {
  const find = (id: string, version: number) => versions[id]?.find(entry => entry.version === version)
  return {
    kind, label: () => kind, node: id => `test:${id}`, latest: () => [], name: (_state, id, version) => find(id, version) === undefined ? null : id,
    assets: (_state, id, version) => find(id, version)?.assets ?? [],
  }
}

describe('referenceAssets', () => {
  it('expands a version through the version kinds to its assets in version order, keeps input order and every media type, and skips what the state lacks', () => {
    const state = fixtureState()
    state.assets.push(asset('side.png', 'image/png', null), asset('alley.png', 'image/png', null), asset('score.wav', 'audio/wav', null))
    const kinds = [
      testKind('test_character', { hero: [{ version: 1, assets: ['ref.png'] }, { version: 2, assets: ['side.png', 'ref.png'] }] }),
      testKind('test_location', { alley: [{ version: 1, assets: ['alley.png'] }] }),
    ]
    const refs = ['alley@1', 'hero@2', 'g1#1', 'shot1-last.png', 'hero@9', 'g1#0', 'score.wav', 'missing.png']
    expect(referenceAssets(state, refs, kinds).map(entry => entry.id))
      .toEqual(['alley.png', 'side.png', 'ref.png', 'shot1-last.png', 'shot1-last.png', 'shot1.mp4', 'score.wav'])
    // Without a version kind, a version reference stands for no asset.
    expect(referenceAssets(state, ['hero@2', 'score.wav'], []).map(entry => entry.id)).toEqual(['score.wav'])
  })

  it('adds nothing for a record output whose record, or whose output, the state does not hold', () => {
    expect(referenceAssets(fixtureState(), ['missing#0', 'g1#9'], [])).toEqual([])
  })
})

describe('isPicture', () => {
  it('numbers images only', () => {
    expect([asset('a.png', 'image/png', null), asset('b.mp4', 'video/mp4', null), asset('c.wav', 'audio/wav', null)].map(isPicture))
      .toEqual([true, false, false])
  })
})

describe('pictureParts', () => {
  it('splits a prompt at Picture N and picture N tokens and keeps their text', () => {
    expect(pictureParts('Picture 1 walks past picture 12 at night; Pictures 3 and Picture 0 stay text')).toEqual([
      { picture: 1, text: 'Picture 1' }, { text: ' walks past ' }, { picture: 12, text: 'picture 12' },
      { text: ' at night; Pictures 3 and Picture 0 stay text' },
    ])
    expect(pictureParts('no images')).toEqual([{ text: 'no images' }])
    expect(pictureParts('')).toEqual([])
  })

  it('takes the angle brackets of a <Picture N> token into the token and leaves other tokens as text', () => {
    expect(pictureParts('<Subject 1> is the woman in <Picture 1>; <picture 2> and <Picture 0> follow')).toEqual([
      { text: '<Subject 1> is the woman in ' }, { picture: 1, text: '<Picture 1>' }, { text: '; ' },
      { picture: 2, text: '<picture 2>' }, { text: ' and <Picture 0> follow' },
    ])
  })
})
