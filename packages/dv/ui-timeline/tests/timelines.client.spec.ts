/** The assets that the editor's insert picker offers. */
import { describe, expect, it } from 'vitest'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { videoAssets } from '../src/client/timelines.ts'

describe('videoAssets', () => {
  it('lists the video assets of a state, newest first', () => {
    expect(videoAssets(fixtureState()).map(video => video.id)).toEqual(['shot1.mp4', 'shot2.mp4', 'export.mp4'])
  })
})
