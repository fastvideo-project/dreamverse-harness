/** The reference assets of a shot, which of them the model numbers as Picture N, and the split of a prompt at its Picture N tokens. */
import { describe, expect, it } from 'vitest'
import { isPicture, pictureParts, referenceAssets, shotReferences } from '../src/client/references.ts'
import { asset, fixtureState } from './fixture.client.tsx'

describe('referenceAssets', () => {
  it('expands a character version to its references in version order, keeps input order and every media type, and skips what the state lacks', () => {
    const state = fixtureState()
    state.components.bible.characters['hero']?.push({
      id: 'hero', version: 2, name: 'Hero', description: '', references: ['side.png', 'ref.png'], created_by: 'e2',
    })
    state.components.bible.locations['alley'] = [{ id: 'alley', version: 1, name: 'Alley', description: '', references: ['alley.png'], created_by: 'e3' }]
    state.assets.push(asset('side.png', 'image/png', null), asset('alley.png', 'image/png', null), asset('score.wav', 'audio/wav', null))
    expect(referenceAssets(state, ['alley@1', 'hero@2', 'g1#1', 'shot1-last.png', 'hero@9', 'g1#0', 'score.wav', 'missing.png']).map(entry => entry.id))
      .toEqual(['alley.png', 'side.png', 'ref.png', 'shot1-last.png', 'shot1-last.png', 'shot1.mp4', 'score.wav'])
  })
})

describe('isPicture', () => {
  it('numbers images only', () => {
    expect([asset('a.png', 'image/png', null), asset('b.mp4', 'video/mp4', null), asset('c.wav', 'audio/wav', null)].map(isPicture))
      .toEqual([true, false, false])
  })
})

describe('shotReferences', () => {
  it('uses the shot\'s own references, else the plan version\'s, as plan.approve does; a shot in mode text has none', () => {
    expect(shotReferences({ references: ['hero@1'] }, { mode: 'reference', references: ['a.png'] })).toEqual(['a.png'])
    expect(shotReferences({ references: ['hero@1'] }, { mode: 'reference' })).toEqual(['hero@1'])
    expect(shotReferences({ references: ['hero@1'] }, { mode: 'reference', references: [] })).toEqual([])
    expect(shotReferences({}, { mode: 'reference' })).toEqual([])
    expect(shotReferences({ references: ['hero@1'] }, { mode: 'text' })).toEqual([])
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
