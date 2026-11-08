/** Which canvas node of a state's node list shows a record. */
import { describe, expect, it } from 'vitest'
import { nodeOfRecord } from '../src/client/canvas-nodes.ts'
import { fixtureState } from './fixture.client.tsx'

describe('nodeOfRecord', () => {
  it('names the node that has the record as a version, and null for a record that no node shows or no record', () => {
    const state = fixtureState()
    expect([nodeOfRecord(state, 'g1'), nodeOfRecord(state, 'g3'), nodeOfRecord(state, 'c1'), nodeOfRecord(state, undefined)])
      .toEqual(['g1', 'g1', null, null])
  })
})
