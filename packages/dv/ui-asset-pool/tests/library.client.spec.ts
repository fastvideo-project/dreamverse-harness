/** The asset pool panel's listing over synthetic project states: media groups, order, and the stills of video producers. */
import { describe, expect, it } from 'vitest'
import type { ProjectAsset, WireState } from '../../ui-kit/src/client/types.ts'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { assetLibrary } from '../src/client/library.ts'

describe('assetLibrary over a synthetic state', () => {
  /** An asset as the project sees it. */
  const asset = (
    id: string, mime: string, madeBy: string | null, createdAt = '2026-01-01T00:00:00.000Z', createdBy: string | null = null,
  ): ProjectAsset => ({
    id, mime, name: id, size_bytes: 10, created_by: createdBy, created_at: createdAt, width: null, height: null, duration_sec: null,
    made_by: madeBy,
  })
  /**
   * A state with the given assets.
   * @param assets - the assets of the project.
   * @returns the state.
   */
  const stateOf = (assets: ProjectAsset[]): WireState => ({ ...fixtureState(), assets })
  const assets = [
    asset('img', 'image/png', 'asset.import', '2026-10-05T09:00:00.000Z'), asset('vid', 'video/mp4', 'shot.render', '2026-10-05T09:01:00.000Z'),
    asset('out', 'video/mp4', 'timeline.export', '2026-10-05T09:03:00.000Z'),
  ]

  it('groups images, videos and audio files, newest first, and leaves out assets of other media types', () => {
    const library = assetLibrary(stateOf([
      ...assets, asset('notes', 'application/pdf', 'asset.import'), asset('older', 'video/mp4', 'asset.import', '2025-12-31T00:00:00.000Z'),
      asset('line', 'audio/wav', 'asset.import', '2026-10-05T09:02:00.000Z'), asset('take', 'audio/wav', 'voice.convert', '2026-10-05T09:04:00.000Z'),
    ]))
    expect(library.images.map(row => row.id)).toEqual(['img'])
    expect(library.videos.map(row => row.id)).toEqual(['out', 'vid', 'older'])
    expect(library.audios.map(row => row.id)).toEqual(['take', 'line'])
    expect([...library.images, ...library.videos, ...library.audios, ...library.extracted].map(row => row.id)).not.toContain('notes')
  })

  it('lists the images whose producer also output a video under extracted, and grabbed stills, image-only outputs and referenced images under images', () => {
    const library = assetLibrary(stateOf([
      ...assets, asset('shot1', 'video/mp4', 'shot.render', undefined, 'g1'), asset('shot1-last', 'image/png', 'shot.render', undefined, 'g1'),
      asset('shot2', 'video/mp4', 'shot.render', undefined, 'g2'), asset('shot2-last', 'image/png', 'shot.render', undefined, 'g2'),
      asset('grabbed', 'image/png', 'asset.grab_still', undefined, 'x1'), asset('cat', 'image/png', 'image.generate', undefined, 'i1'),
      asset('referenced', 'image/png', null),
    ]))
    expect(library.extracted.map(row => row.id).sort()).toEqual(['shot1-last', 'shot2-last'])
    expect(library.images.map(row => row.id).sort()).toEqual(['cat', 'grabbed', 'img', 'referenced'])
  })

  it('keeps the name and time the project gave each asset', () => {
    const named = { ...asset('img', 'image/png', 'asset.import', '2026-10-05T09:00:00.000Z'), name: 'dropped.png' }
    expect(assetLibrary(stateOf([named])).images).toEqual([named])
    expect(assetLibrary(fixtureState()).extracted.map(row => row.id).sort()).toEqual(['shot1-last.png', 'shot2-last.png'])
  })
})
