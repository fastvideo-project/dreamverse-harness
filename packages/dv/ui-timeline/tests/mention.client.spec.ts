// @vitest-environment jsdom
/** The clip mention kind of the composer's `@` menu, and the base clip items that the composer lists through it. */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssetId, RecordId } from '@dv/project/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import { projectItems } from '@dv/ui-composer/src/client/mention.ts'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { MEDIA_TYPES } from '../../ui-asset-pool/src/client/media.tsx'
import { asset, fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { clipMentionKind } from '../src/client/mention.ts'

afterEach(() => { document.documentElement.lang = '' })

/**
 * The shared fixture plus a timeline `片尾` with an imported clip (no producer) and a placeholder clip that waits for the
 * running render `g3`.
 * @returns the state.
 */
function clipState(): WireState {
  const state = fixtureState()
  state.assets.push(asset('imported.mp4', 'video/mp4', null, 3))
  state.components.timeline.timelines.push({ id: 't2' as TimelineId, name: '片尾', sounds: [], sound_track_names: [], muted_sound_tracks: [], video_track_volumes: [], sound_track_volumes: [], muted_video_tracks: [], track_order: ['video', 'sound'], clips: [
    { id: 'cl3' as ClipId, asset: 'imported.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
    { id: 'cl4' as ClipId, asset: null, source: { record: 'g3' as RecordId, output: 0 }, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
  ] })
  return state
}

describe('clipMentionKind', () => {
  it('lists each clip by timeline name and position, with the start of its producer\'s prompt and its producer\'s image, else its asset', () => {
    document.documentElement.lang = 'zh-CN'
    expect([clipMentionKind.id, clipMentionKind.kind, clipMentionKind.order, clipMentionKind.section()]).toEqual(['@dv/ui-timeline', 'clip', 0, '片段'])
    expect(clipMentionKind.items(clipState())).toEqual([
      { uri: 'dv:clip/cl1', label: '时间线 1 · 片段 1', description: 'hero walks through the rain at night in ', thumb: 'shot1-last.png' },
      { uri: 'dv:clip/cl2', label: '时间线 1 · 片段 2', description: 'hero turns', thumb: 'shot2-last.png' },
      { uri: 'dv:clip/cl3', label: '片尾 · 片段 1', thumb: 'imported.mp4' },
      { uri: 'dv:clip/cl4', label: '片尾 · 片段 2', description: 'hero walks, wider' },
    ])
    document.documentElement.lang = 'en'
    expect([clipMentionKind.section(), clipMentionKind.items(clipState())[1]?.label]).toEqual(['Clips', 'Timeline 1 · Clip 2'])
  })

  it('numbers the clips of each video track by start time, and names the track of a clip that is not on 视频 1', () => {
    document.documentElement.lang = 'zh-CN'
    const state = fixtureState()
    const [t1] = state.components.timeline.timelines
    // cl9 starts before cl8 on video track 1, so it is that track's first clip.
    t1?.clips.push(
      { id: 'cl8' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 6, track: 1 },
      { id: 'cl9' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 2, track: 1 },
    )
    const labels = (): string[] => clipMentionKind.items(state).map(item => item.label)
    expect(labels()).toEqual(['时间线 1 · 片段 1', '时间线 1 · 片段 2', '时间线 1 · 视频 2 · 片段 2', '时间线 1 · 视频 2 · 片段 1'])
    document.documentElement.lang = 'en'
    expect(labels().at(-1)).toBe('Timeline 1 · Video 2 · Clip 1')
  })

  it('lists a clip with neither an asset nor a render to wait for by its label alone', () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.timeline.timelines.push({ id: 't2' as TimelineId, name: 'Outro', sounds: [], sound_track_names: [], muted_sound_tracks: [], video_track_volumes: [], sound_track_volumes: [], muted_video_tracks: [], track_order: ['video', 'sound'], clips: [
      { id: 'cl3' as ClipId, asset: null, source: null, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
    ] })
    expect(clipMentionKind.items(state).at(-1)).toEqual({ uri: 'dv:clip/cl3', label: 'Outro · Clip 1' })
  })

  it('gives the composer\'s @ list the clip items of the base: first, with an image thumbnail, else the video\'s media-type glyph', () => {
    document.documentElement.lang = 'zh-CN'
    const items = projectItems(clipState(), [clipMentionKind], MEDIA_TYPES.map(entry => entry.type))
    expect(items.slice(0, 4).map(item => [item.label, item.section])).toEqual([
      ['时间线 1 · 片段 1', '片段'], ['时间线 1 · 片段 2', '片段'], ['片尾 · 片段 1', '片段'], ['片尾 · 片段 2', '片段'],
    ])
    const icons = items.slice(0, 4).map(item => item.icon === undefined ? null : renderToStaticMarkup(createElement(item.icon)))
    expect(icons[0]).toContain(`<img src="${assetUrl('shot1-last.png')}"`)
    expect(icons[2]).toContain('<svg')
    expect(icons[2]).not.toContain('<video')
    expect(icons[3]).toBeNull()
  })
})
