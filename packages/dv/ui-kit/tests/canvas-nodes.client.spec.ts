/** Which canvas node of a state's node list shows a record, and the name an asset takes from its node. */
import { describe, expect, it } from 'vitest'
import { assetLabel, nodeOfRecord } from '../src/client/canvas-nodes.ts'
import { asset, fixtureState } from './fixture.client.tsx'

describe('nodeOfRecord', () => {
  it('names the node that has the record as a version, and null for a record that no node shows or no record', () => {
    const state = fixtureState()
    expect([nodeOfRecord(state, 'g1'), nodeOfRecord(state, 'g3'), nodeOfRecord(state, 'c1'), nodeOfRecord(state, undefined)])
      .toEqual(['g1', 'g1', null, null])
  })
})

describe('assetLabel', () => {
  it('names the main asset of a named node by the node, its other assets by the node and their own name, and any other asset by its own name', () => {
    const state = fixtureState()
    const { nodes, assets } = state.components.canvas
    // old.mp4 is the output of an earlier version of g1, which the node no longer shows; lost.mp4 names a node that is gone.
    const old = asset('old.mp4', 'video/mp4', 'g1', 4)
    const imported = asset('imported.mp4', 'video/mp4', null, 3)
    const lost = asset('lost.mp4', 'video/mp4', null, 3)
    assets['lost.mp4'] = 'gone'
    const labels = (): string[] => [...state.assets.filter(entry => ['ref.png', 'shot1.mp4', 'shot2.mp4'].includes(entry.id)), old, imported, lost]
      .map(entry => assetLabel(state, entry))
    expect(labels()).toEqual(['ref.png', 'shot1.mp4', 'shot2.mp4', 'old.mp4', 'imported.mp4', 'lost.mp4'])
    if (nodes['g1'] !== undefined) nodes['g1'].name = '雨夜'
    if (nodes['g2'] !== undefined) nodes['g2'].name = '转身'
    // g1's newest version g3 is still running, so shot1.mp4 of its version g1 stays its main asset.
    expect(labels()).toEqual(['ref.png', '雨夜', '转身', '雨夜 · old.mp4', 'imported.mp4', 'lost.mp4'])
    expect(assetLabel(state, state.assets.find(entry => entry.id === 'shot1-last.png') ?? old)).toBe('雨夜 · shot1-last.png')
    // A placement node's main asset is its placed asset.
    nodes['p1'] = { kind: 'asset', name: '参考图', versions: ['u1'], asset: 'placed.png', position: { x: 0, y: 0, width: null, height: null } }
    assets['placed.png'] = 'p1'
    expect(assetLabel(state, asset('placed.png', 'image/png', 'u1'))).toBe('参考图')
  })
})
