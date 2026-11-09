/** Stored input references read without kind names, and the reference assets of a shot. */
import { describe, expect, it } from 'vitest'
import { formatInputRef, referenceAssets, referenceItems, versionRefOf } from '../src/client/references.ts'
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

/**
 * A test version kind over a fixed list of versions.
 * @param kind - the reference kind.
 * @param versions - item ID → its versions with their reference assets.
 * @returns the version kind.
 */
function testKind(kind: string, versions: Record<string, Array<{ version: number; assets: string[] }>>): VersionKind {
  const find = (id: string, version: number) => versions[id]?.find(entry => entry.version === version)
  return {
    kind, label: () => kind, node: (_state, id) => `test:${id}`, latest: () => [], name: (_state, id, version) => find(id, version) === undefined ? null : id,
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

describe('referenceItems', () => {
  it('names a version by its version kind with its first asset, and any other reference by its asset, in input order', () => {
    const state = fixtureState()
    const kinds = [testKind('test_character', { hero: [{ version: 1, assets: ['ref.png'] }], ghost: [{ version: 1, assets: [] }] })]
    expect(referenceItems(state, ['shot1-last.png', 'hero@1', 'ghost@1', 'nobody@1', 'missing.png'], kinds).map(item => [item.name, item.asset?.id ?? null]))
      .toEqual([['shot1-last.png', 'shot1-last.png'], ['hero', 'ref.png'], ['ghost', null]])
  })
})
