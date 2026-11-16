// @vitest-environment jsdom
/**
 * The video tracks under the 视频 track over a scripted API: their rows, names and order, the clip the preview shows and
 * plays, and each edit of their clips and tracks as a record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { AssetId, RecordId } from '@dv/project/types'
import type { ClipId } from '@dv/timeline/types'
import { DvClient } from '@dv/ui-kit/api.ts'
import { DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState, ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { addingTracks, bootTimeline, centerView } from './center.client.tsx'
import type { BootedTimeline } from './center.client.tsx'

let booted: BootedTimeline

/** The height of one track row and the gap under it, in pixels: a vertical drag of this many pixels moves one row. */
const ROW_STEP = 62

beforeEach(async () => {
  document.documentElement.lang = 'zh-CN'
  booted = await bootTimeline()
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await booted.fiber.dispose() })

/**
 * The drag data of an asset pool tile.
 * @param id - the asset ID.
 * @param mime - the asset's MIME type.
 * @returns the `dataTransfer` of the drag.
 */
const assetDrag = (id: string, mime = 'video/mp4') => ({
  types: [DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE], getData: (type: string) => ({ [DV_ASSET_DRAG_TYPE]: id, [DV_ASSET_MIME_DRAG_TYPE]: mime })[type] ?? '',
})

/**
 * The shared fixture, whose 视频 track plays 0 s to 7 s, with two video tracks under its sound track on t1: track 0 holds
 * export.mp4 (3 s) from 1 s to 4 s, and track 1, muted, holds 2 s of shot1.mp4 from 6 s to 8 s, past the 视频 track's end.
 */
function trackState(): FixtureState {
  const state = fixtureState()
  const [t1] = state.components.timeline.timelines
  if (t1 === undefined) throw new Error('no t1')
  t1.track_clips = [
    { id: 'cl5' as ClipId, asset: 'export.mp4' as AssetId, in_sec: null, out_sec: null, start_sec: 1, track: 0 },
    { id: 'cl6' as ClipId, asset: 'shot1.mp4' as AssetId, in_sec: 0.5, out_sec: 2.5, start_sec: 6, track: 1 },
  ]
  t1.muted_video_tracks = [1]
  t1.track_order = ['sound', 'video', 'video']
  return state
}

function mount(routes: ScriptedRoutes = { state: trackState }) {
  const { fetch, writes } = scriptedFetch(routes)
  const view = render(centerView(booted, { client: new DvClient(fetch) }))
  const one = (selector: string): HTMLElement => {
    const element = view.container.querySelector(selector)
    if (!(element instanceof HTMLElement)) throw new Error(`no ${selector}`)
    return element
  }
  const lane = (track: number): HTMLElement => one(`[data-video-track="${String(track)}"]`)
  const block = (clip: string): HTMLElement => one(`[data-track-clip-block="${clip}"]`)
  const preview = (clip: string): HTMLVideoElement => one(`video[data-track-clip="${clip}"]`) as HTMLVideoElement
  const mainVideos = (): HTMLVideoElement[] => [...view.getByTestId('dv-timeline-viewer').querySelectorAll('video:not([data-track-clip])')] as HTMLVideoElement[]
  const heads = (): Array<string | null> => [...view.container.querySelectorAll('[data-video-track-head]')].map(entry => entry.textContent)
  // The headers of the rows under the 原声 row, top to bottom, as `video N` and `sound N` by track number.
  const rowOrder = (): string[] => [...view.container.querySelectorAll('[data-video-track-head], [data-sound-track-head]')].map(entry =>
    entry.hasAttribute('data-video-track-head') ? `video ${String(entry.getAttribute('data-video-track-head'))}` : `sound ${String(entry.getAttribute('data-sound-track-head'))}`)
  const requests = (): Array<Record<string, unknown>> => writes.filter(write => write.path === '/api/dv/operation').map(write => write.body as Record<string, unknown>)
  const seek = (seconds: number): void => {
    const ruler = view.getByTestId('dv-timeline-ruler')
    fireEvent.pointerDown(ruler, { clientX: seconds * 40 })
    fireEvent.pointerUp(ruler, { clientX: seconds * 40 })
  }
  const ready = async (): Promise<void> => { await view.findByRole('list', { name: '视频轨道 2' }) }
  return { view, lane, block, preview, mainVideos, heads, rowOrder, requests, seek, ready }
}

describe('video tracks under the 视频 track', () => {
  it('names the 视频 track 视频 1 and the video tracks after it, keeps the 视频 track on top, and after its end plays the clip of the track with the lowest number', async () => {
    // cl9 on track 0 runs from 7.2 s to 10.2 s, over the end of cl6 on track 1.
    const routes: ScriptedRoutes = {
      state: () => {
        const state = trackState()
        state.components.timeline.timelines[0]?.track_clips.push({ id: 'cl9' as ClipId, asset: 'export.mp4' as AssetId, in_sec: null, out_sec: null, start_sec: 7.2, track: 0 })
        return state
      },
    }
    const { view, lane, block, preview, mainVideos, heads, seek, ready } = mount(routes)
    await ready()
    expect(heads()).toEqual(['视频 2', '视频 3'])
    expect(view.getByRole('button', { name: '静音 视频 1' })).toBeTruthy()
    expect(within(lane(0)).getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['视频 2 的片段：export.mp4', '视频 2 的片段：export.mp4'])
    expect(block('cl5').style.left).toBe('40px')
    expect(block('cl5').style.width).toBe('120px')
    expect(block('cl6').style.left).toBe('240px')
    expect(block('cl6').style.opacity).toBe('0.45')
    // The preview plays to the end of the last track clip, past the 视频 track's 7 s.
    expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:00.00 / 00:10.20')
    const visible = (element: HTMLElement): boolean => element.style.visibility === 'visible'
    expect(mainVideos().some(visible)).toBe(true)
    // The 视频 track covers cl5 while it plays.
    seek(2)
    await waitFor(() => { expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:02.00 / 00:10.20') })
    expect(mainVideos().some(visible)).toBe(true)
    expect([visible(preview('cl5')), visible(preview('cl6')), visible(preview('cl9'))]).toEqual([false, false, false])
    expect([preview('cl5').muted, preview('cl6').muted]).toEqual([true, true])
    // After the 视频 track ends, the clip of the muted track shows silent until track 0 has a clip again.
    seek(7.1)
    await waitFor(() => { expect(visible(preview('cl6'))).toBe(true) })
    expect(preview('cl6').muted).toBe(true)
    expect(mainVideos().some(visible)).toBe(false)
    seek(7.5)
    await waitFor(() => { expect(visible(preview('cl9'))).toBe(true) })
    expect([visible(preview('cl6')), preview('cl9').muted]).toEqual([false, false])
    seek(5)
    await waitFor(() => { expect(mainVideos().some(visible)).toBe(true) })
    expect(mainVideos().every(video => !video.muted)).toBe(true)
  })

  it('lays out the video tracks and sound tracks in the order they were added, and moves a dragged clip to the video track nearest the row it ends on', async () => {
    const { view, block, rowOrder, requests, ready } = mount(addingTracks(() => {
      const state = trackState()
      const [t1] = state.components.timeline.timelines
      if (t1 !== undefined) t1.track_order = ['video', 'sound', 'video']
      return state
    }))
    await ready()
    expect(rowOrder()).toEqual(['video 0', 'sound 0', 'video 1'])
    // A new track goes at the bottom once the refreshed state stores it.
    fireEvent.click(view.getByRole('button', { name: '添加轨道' }))
    fireEvent.click(view.getByRole('menuitem', { name: '音轨' }))
    await waitFor(() => { expect(rowOrder()).toEqual(['video 0', 'sound 0', 'video 1', 'sound 1']) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.track_add', params: { timeline: 't1', kind: 'sound' }, intent: '添加音轨' })
    // One row down from track 0 lands on the sound track, as near track 1 as track 0, and goes the drag's way.
    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 0 })
    fireEvent.pointerUp(block('cl5'), { clientX: 40, clientY: ROW_STEP })
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]?.['params']).toEqual({ clip: 'cl5', start_sec: 1, track: 1 })
    fireEvent.pointerDown(block('cl6'), { clientX: 240, clientY: 0 })
    fireEvent.pointerUp(block('cl6'), { clientX: 240, clientY: -ROW_STEP })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]?.['params']).toEqual({ clip: 'cl6', start_sec: 6, track: 0 })
  })

  it('adds video tracks at the bottom, one write per menu click, and puts a dropped video on a track where it lands', async () => {
    const { view, lane, heads, rowOrder, requests, ready } = mount(addingTracks(trackState))
    await ready()
    const add = (): HTMLButtonElement => {
      if (view.queryByRole('menu', { name: '添加轨道' }) === null) fireEvent.click(view.getByRole('button', { name: '添加轨道' }))
      return view.getByRole('menuitem', { name: '视频轨' }) as HTMLButtonElement
    }
    fireEvent.click(add())
    expect(view.queryByRole('menu', { name: '添加轨道' })).toBeNull()
    // Until the refreshed state shows the new track, the menu adds no other.
    expect(add().disabled).toBe(true)
    await waitFor(() => { expect(heads()).toEqual(['视频 2', '视频 3', '视频 4']) })
    expect(rowOrder()).toEqual(['sound 0', 'video 0', 'video 1', 'video 2'])
    expect(requests()).toEqual([expect.objectContaining({ operation: 'timeline.track_add', params: { timeline: 't1', kind: 'video' }, intent: '添加视频轨' })])
    // Empty tracks add one under another.
    await waitFor(() => { expect(add().disabled).toBe(false) })
    fireEvent.click(add())
    await waitFor(() => { expect(heads()).toEqual(['视频 2', '视频 3', '视频 4', '视频 5']) })
    expect(view.queryByRole('menu', { name: '添加轨道' })).toBeNull()
    expect(fireEvent.dragOver(lane(2), { dataTransfer: assetDrag('shot2.mp4') })).toBe(false)
    expect(fireEvent.dragOver(lane(2), { dataTransfer: { types: ['text/plain'], getData: () => '' } })).toBe(true)
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 3 * 40 })
    Object.defineProperty(drop, 'dataTransfer', { value: assetDrag('shot2.mp4') })
    expect(fireEvent(lane(2), drop)).toBe(false)
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({
      operation: 'timeline.track_clip_add', params: { timeline: 't1', asset: 'shot2.mp4', track: 2, start_sec: 3 }, intent: '把片段放到 视频 4 的 00:03.00',
    })
    expect(fireEvent.drop(lane(0), { dataTransfer: assetDrag('ref.png', 'image/png') })).toBe(false)
    expect(view.getByRole('status').textContent).toBe('视频轨道只接受视频。音频请拖到声音轨道上。')
    expect(fireEvent.drop(lane(0), { dataTransfer: { types: ['text/plain'], getData: () => '' } })).toBe(true)
    expect(requests()).toHaveLength(3)
  })

  it('adds a picked video from the ＋ of a video track after its last clip, or at the playhead on an empty track', async () => {
    const routes: ScriptedRoutes = {
      state: () => {
        const state = trackState()
        const [t1] = state.components.timeline.timelines
        if (t1 !== undefined) t1.track_order = ['sound', 'video', 'video', 'video']
        return state
      },
    }
    const { view, requests, ready } = mount(routes)
    await ready()
    // Each video track's ＋ sits in its header, right of the delete button.
    const head = (track: number): HTMLElement => view.container.querySelector(`[data-video-track-head="${String(track)}"]`) as HTMLElement
    const plus = (track: number): HTMLElement => within(head(track)).getByRole('button', { name: `添加片段到 视频 ${String(track + 2)}` })
    const pick = (name: string): void => { fireEvent.click(within(view.getByRole('dialog', { name: '选一个素材插入到末尾' })).getByRole('button', { name })) }
    fireEvent.click(plus(0))
    expect(plus(0).getAttribute('aria-expanded')).toBe('true')
    pick('shot2.mp4')
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.track_clip_add', params: { timeline: 't1', asset: 'shot2.mp4', track: 0, start_sec: 4 } })
    fireEvent.click(plus(2))
    // The ＋ of the 视频 track turns the open picker to the 视频 track instead of closing it.
    fireEvent.click(view.getByRole('button', { name: '插入片段' }))
    expect(view.getByRole('button', { name: '插入片段' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(plus(2))
    pick('shot1.mp4')
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.track_clip_add', params: { asset: 'shot1.mp4', track: 2, start_sec: 0 } })
    fireEvent.click(plus(2))
    fireEvent.click(view.getByRole('button', { name: '插入片段' }))
    pick('shot1.mp4')
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_insert', params: { at: 3, asset: 'shot1.mp4' } })
  })

  it('opens the asset picker and the sound dialog beside the ＋ that opened them, upward from the lower half, and where a lane menu was opened', async () => {
    const { view, lane, ready } = mount()
    await ready()
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) })
    // The track area spans 100 px to 400 px down the screen; its lower half starts at 250 px.
    vi.spyOn(view.getByTestId('dv-timeline-track-area'), 'getBoundingClientRect').mockReturnValue(rect(0, 100, 1000, 300))
    const insert = view.getByRole('button', { name: '插入片段' })
    vi.spyOn(insert, 'getBoundingClientRect').mockReturnValue(rect(110, 150, 24, 24))
    fireEvent.click(insert)
    const place = (element: HTMLElement): string[] => [element.style.left, element.style.top, element.style.bottom, element.style.maxHeight]
    expect(place(view.getByRole('dialog', { name: '选一个素材插入到末尾' }))).toEqual(['138px', '50px', '', 'min(194px, calc(100% - 58px))'])
    const addSound = within(view.container.querySelector('[data-sound-track-head="0"]') as HTMLElement).getByRole('button', { name: '添加声音' })
    vi.spyOn(addSound, 'getBoundingClientRect').mockReturnValue(rect(110, 300, 24, 24))
    fireEvent.click(addSound)
    expect(place(view.getByRole('dialog', { name: '添加声音' }))).toEqual(['138px', '', '76px', 'min(234px, calc(100% - 84px))'])
    // Near the area's right edge, the picker opens as far right as it fits.
    fireEvent.contextMenu(lane(1), { clientX: 990, clientY: 120 })
    fireEvent.click(view.getByRole('menuitem', { name: '在这里添加视频' }))
    expect(place(view.getByRole('dialog', { name: /^选一个素材放到/ })).slice(0, 2)).toEqual(['772px', '20px'])
  })

  it('moves a track clip in time and to another track by a drag, selects it by a click, and removes or splits the selected clip', async () => {
    const { view, block, requests, seek, ready } = mount()
    await ready()
    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 0 })
    fireEvent.pointerMove(block('cl5'), { clientX: 120, clientY: 62 })
    expect(block('cl5').style.transform).toBe('translate(80px, 62px)')
    fireEvent.pointerUp(block('cl5'), { clientX: 120, clientY: 62 })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.track_clip_move', params: { clip: 'cl5', start_sec: 3, track: 1 }, intent: '把片段移到 视频 3 的 00:03.00',
    })
    // A drag past the timeline's start stops at 0 s, and a drag within the row keeps the track.
    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 0 })
    fireEvent.pointerMove(block('cl5'), { clientX: -200, clientY: 10 })
    expect(block('cl5').style.transform).toBe('translate(-40px, 10px)')
    fireEvent.pointerUp(block('cl5'), { clientX: -200, clientY: 10 })
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]?.['params']).toEqual({ clip: 'cl5', start_sec: 0 })
    // A move or release from another press changes nothing.
    fireEvent.pointerMove(block('cl6'), { clientX: 400 })
    fireEvent.pointerUp(block('cl6'), { clientX: 400 })
    expect(requests()).toHaveLength(2)

    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 0 })
    fireEvent.pointerUp(block('cl5'), { clientX: 41, clientY: 1 })
    await waitFor(() => { expect(block('cl5').getAttribute('aria-pressed')).toBe('true') })
    const split = (): HTMLButtonElement => view.getByRole('button', { name: '拆分' }) as HTMLButtonElement
    // The selected track clip is not under the playhead at 0 s, so there is nothing to split.
    expect(split().disabled).toBe(true)
    seek(2)
    await waitFor(() => { expect(split().disabled).toBe(false) })
    fireEvent.click(split())
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl5', at_sec: 1 }, intent: '在 00:02.00 拆分 视频 2 上的片段' })
    fireEvent.click(view.getByRole('button', { name: '删除片段' }))
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl5' }, intent: '从 视频 2 移除片段' })
    await waitFor(() => { expect(block('cl5').getAttribute('aria-pressed')).toBe('false') })
    fireEvent.pointerDown(block('cl6'), { clientX: 240, clientY: 0 })
    fireEvent.pointerUp(block('cl6'), { clientX: 240, clientY: 0 })
    await waitFor(() => { expect(block('cl6').getAttribute('aria-pressed')).toBe('true') })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Backspace' })
    await waitFor(() => { expect(requests()).toHaveLength(5) })
    expect(requests()[4]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl6' } })
    // Selecting a clip of the 视频 track or a sound drops the track clip selection.
    const main = view.container.querySelector('[data-clip-position="1"]') as HTMLElement
    fireEvent.pointerDown(main, { clientX: 0 })
    fireEvent.pointerUp(main, { clientX: 0 })
    await waitFor(() => { expect(block('cl6').getAttribute('aria-pressed')).toBe('false') })
  })

  it('selects a 视频 track clip that another view focuses or that a finished move placed instead of a selected track clip', async () => {
    const { view, block, requests, ready } = mount()
    await ready()
    const clip = (position: number): HTMLElement => view.container.querySelector(`[data-clip-position="${String(position)}"]`) as HTMLElement
    const pick = (element: HTMLElement): void => {
      fireEvent.pointerDown(element, { clientX: 0 })
      fireEvent.pointerUp(element, { clientX: 0 })
    }
    // A drag that ends on the same row at the same time writes nothing.
    fireEvent.pointerDown(block('cl5'), { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(block('cl5'), { clientX: 0, clientY: 10 })
    fireEvent.pointerUp(block('cl5'), { clientX: 0, clientY: 10 })
    pick(block('cl5'))
    act(() => { booted.stand.show({ timeline: 't1', clip: 'cl2' }) })
    expect([clip(2).getAttribute('aria-pressed'), block('cl5').getAttribute('aria-pressed')]).toEqual(['true', 'false'])
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl2' } })
    // A track clip picked while a move of the 视频 track runs gives way to the moved clip once the move is done.
    fireEvent.pointerDown(clip(1), { clientX: 0 })
    fireEvent.pointerMove(clip(1), { clientX: 200 })
    fireEvent.pointerUp(clip(1), { clientX: 200 })
    pick(block('cl5'))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    await waitFor(() => { expect(block('cl5').getAttribute('aria-pressed')).toBe('false') })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl1' } })
  })

  it('trims a track clip by its edges, a start trim keeping the clip inside the timeline', async () => {
    const { block, requests, ready } = mount()
    await ready()
    const edge = (clip: string, side: 'start' | 'end'): HTMLElement => block(clip).querySelector(`[data-trim="${side}"]`) as HTMLElement
    const drag = (element: HTMLElement, dx: number): void => {
      fireEvent.pointerDown(element, { clientX: 100 })
      fireEvent.pointerMove(element, { clientX: 100 + dx })
      fireEvent.pointerUp(element, { clientX: 100 + dx })
    }
    drag(edge('cl5', 'start'), 40)
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_trim', params: { clip: 'cl5', in_sec: 1 }, intent: '裁剪 视频 2 上的片段' })
    expect(requests()[0]?.['params']).toEqual({ clip: 'cl5', in_sec: 1 })
    // cl5 starts at 1 s with its asset's start, so a start trim cannot reach before either.
    drag(edge('cl5', 'start'), -200)
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]?.['params']).toEqual({ clip: 'cl5', in_sec: 0 })
    drag(edge('cl5', 'end'), -40)
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]?.['params']).toEqual({ clip: 'cl5', out_sec: 2 })
    drag(edge('cl6', 'start'), 40)
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]?.['params']).toEqual({ clip: 'cl6', in_sec: 1.5, out_sec: 2.5 })
    // The live drag moves the edge; a press that does not move writes nothing.
    fireEvent.pointerDown(edge('cl6', 'start'), { clientX: 100 })
    fireEvent.pointerMove(edge('cl6', 'start'), { clientX: 120 })
    expect(block('cl6').style.left).toBe('260px')
    fireEvent.pointerUp(edge('cl6', 'start'), { clientX: 100 })
    fireEvent.pointerDown(edge('cl6', 'end'), { clientX: 100 })
    fireEvent.pointerMove(edge('cl6', 'end'), { clientX: 60 })
    expect(block('cl6').style.width).toBe('40px')
    fireEvent.pointerUp(edge('cl6', 'end'), { clientX: 100 })
    expect(requests()).toHaveLength(4)
  })

  it('moves a video track up or down from the arrows in 轨道层级, one write until the refreshed state shows the move', async () => {
    // The served state swaps the two tracks of each posted move.
    const moves: Array<[number, number]> = []
    const routes: ScriptedRoutes = {
      state: () => {
        const state = trackState()
        // A clip of an asset the project no longer lists, before cl6 on track 1.
        state.components.timeline.timelines[0]?.track_clips.push({ id: 'cl9' as ClipId, asset: 'lost.mp4' as AssetId, in_sec: 0, out_sec: 1, start_sec: 0, track: 1 })
        for (const [track, to] of moves) {
          for (const clip of state.components.timeline.timelines[0]?.track_clips ?? []) {
            clip.track = clip.track === track ? to : clip.track === to ? track : clip.track
          }
        }
        return state
      },
      post: (_path, body) => {
        const { operation, params = {} } = body as { operation: string; params?: Record<string, unknown> }
        if (operation === 'timeline.video_track_move') moves.push([Number(params['track']), Number(params['to'])])
        return { status: 200, body: record({ id: `m${String(moves.length)}`, operation, params }) }
      },
    }
    const { view, requests, ready } = mount(routes)
    await ready()
    fireEvent.click(view.getByRole('button', { name: '轨道层级' }))
    const arrow = (label: string): HTMLButtonElement => view.getByRole('button', { name: label }) as HTMLButtonElement
    const contents = (): Array<string | null> => [...view.container.querySelectorAll('[data-layer-contents]')].map(item => item.textContent)
    // The top track cannot go up and the bottom one cannot go down; 视频 1 and 视频 2 swap with each other.
    const arrows = ['上移 视频 1', '下移 视频 1', '上移 视频 2', '下移 视频 2', '上移 视频 3', '下移 视频 3']
    expect(arrows.map(label => arrow(label).disabled)).toEqual([true, false, false, false, false, true])
    fireEvent.click(arrow('上移 视频 3'))
    expect(arrow('下移 视频 2').disabled).toBe(true)
    await waitFor(() => { expect(contents()).toEqual(['shot1.mp4、shot2.mp4', 'lost.mp4、shot1.mp4', 'export.mp4']) })
    expect(requests()).toEqual([expect.objectContaining({ operation: 'timeline.video_track_move', params: { timeline: 't1', track: 1, to: 0 }, intent: '上移 视频 3' })])
    await waitFor(() => { expect(arrow('下移 视频 2').disabled).toBe(false) })
    fireEvent.click(arrow('下移 视频 2'))
    await waitFor(() => { expect(contents()).toEqual(['shot1.mp4、shot2.mp4', 'export.mp4', 'lost.mp4、shot1.mp4']) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.video_track_move', params: { track: 0, to: 1 }, intent: '下移 视频 2' })
    await waitFor(() => { expect(arrow('下移 视频 1').disabled).toBe(false) })
    fireEvent.click(arrow('下移 视频 1'))
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.main_track_swap', params: { timeline: 't1' }, intent: '对调 视频 1 和 视频 2' })
    await waitFor(() => { expect(arrow('上移 视频 2').disabled).toBe(false) })
    fireEvent.click(arrow('上移 视频 2'))
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.main_track_swap' })
  })

  it('moves a clip of the 视频 track down onto a video track, and a track clip up into the 视频 track, by dragging it', async () => {
    const { view, block, requests, ready } = mount()
    await ready()
    const main = (clip: string): HTMLElement => view.container.querySelector(`[data-clip="${clip}"]`) as HTMLElement
    // The row of video track 0 sits under the 视频 track (56 px), 原声 (36 px) and the sound track (56 px), each with its
    // 6 px gap: 166 px down.
    fireEvent.pointerDown(main('cl1'), { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(main('cl1'), { clientX: 180, clientY: 150 })
    expect(main('cl1').style.transform).toBe('translate(180px, 150px)')
    fireEvent.pointerUp(main('cl1'), { clientX: 180, clientY: 150 })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.track_clip_move', params: { clip: 'cl1', start_sec: 4.5, track: 0 }, intent: '把片段移到 视频 2 的 00:04.50',
    })
    // A short drag up or down stays on the 视频 track and reorders it.
    fireEvent.pointerDown(main('cl1'), { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(main('cl1'), { clientX: 240, clientY: -20 })
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_move', params: { clip: 'cl1', to: 2 } })
    // cl5 plays from 1 s to 4 s on video track 0; dragged up to the 视频 track, its middle lands at 2.5 s.
    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 166 })
    fireEvent.pointerUp(block('cl5'), { clientX: 40, clientY: 10 })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_move', params: { clip: 'cl5', to: 2 }, intent: '把片段移到 视频 1 的第 2 个位置' })
  })

  it('draws a line under each row and at the header column\'s edge, and shows the scrollbars only while the track area scrolls', async () => {
    const { view, ready } = mount()
    await ready()
    const grid = view.getByTestId('dv-timeline-grid')
    // The ruler (26 px), the 视频 track (56 px), 原声 (36 px), then the sound track and two video tracks (56 px each),
    // with a 6 px gap under each row and the line in its middle.
    expect([...grid.children].slice(0, -1).map(line => (line as HTMLElement).style.top)).toEqual(['29px', '91px', '133px', '195px', '257px', '319px'])
    expect((grid.lastElementChild as HTMLElement).style.left).toBe('143px')
    const scroller = grid.parentElement as HTMLElement
    expect(scroller.className).toBe('dv-tl-autohide-scrollbar')
    expect(scroller.style.overflow).toBe('auto')
    fireEvent.scroll(scroller)
    expect(scroller.hasAttribute('data-scrolling')).toBe(true)
    fireEvent.scroll(scroller)
    await waitFor(() => { expect(scroller.hasAttribute('data-scrolling')).toBe(false) }, { timeout: 2000 })
    // A scroll right before the editor closes leaves no timer behind.
    fireEvent.scroll(scroller)
  })

  it('lists the video tracks in 轨道层级, the 视频 track first, and closes the list by its button, a press outside or Escape', async () => {
    const { view, ready } = mount(addingTracks(trackState))
    await ready()
    const layers = (): HTMLElement | null => view.queryByRole('dialog', { name: '轨道层级' })
    const button = view.getByRole('button', { name: '轨道层级' })
    fireEvent.click(button)
    const listed = (): Array<string | null> => [...(layers() as HTMLElement).querySelectorAll('li')].map(item => item.getAttribute('data-layer'))
    expect(listed()).toEqual(['视频 1', '视频 2', '视频 3'])
    // Under each name, the assets of the track's clips in play order.
    expect([...(layers() as HTMLElement).querySelectorAll('[data-layer-contents]')].map(item => item.textContent)).toEqual(['shot1.mp4、shot2.mp4', 'export.mp4', 'shot1.mp4'])
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // A press inside the list keeps it open.
    fireEvent.pointerDown(layers() as HTMLElement)
    expect(layers()).not.toBeNull()
    fireEvent.click(button)
    expect(layers()).toBeNull()
    // Opening the add menu closes the list, and a track added from it shows in the list.
    fireEvent.click(button)
    fireEvent.click(view.getByRole('button', { name: '添加轨道' }))
    expect(layers()).toBeNull()
    fireEvent.click(view.getByRole('menuitem', { name: '视频轨' }))
    // The add button closes its own open menu.
    fireEvent.click(view.getByRole('button', { name: '添加轨道' }))
    fireEvent.click(view.getByRole('button', { name: '添加轨道' }))
    expect(view.queryByRole('menu', { name: '添加轨道' })).toBeNull()
    await waitFor(() => { expect(view.container.querySelectorAll('[data-video-track-head]')).toHaveLength(3) })
    fireEvent.click(button)
    expect(listed()).toEqual(['视频 1', '视频 2', '视频 3', '视频 4'])
    expect((layers() as HTMLElement).querySelectorAll('[data-layer-contents]')[3]?.textContent).toBe('空轨道')
    fireEvent.pointerDown(view.getByTestId('dv-timeline-ruler'))
    expect(layers()).toBeNull()
    fireEvent.click(button)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(layers()).toBeNull()
    // An Escape that another handler consumed leaves the list open.
    fireEvent.click(button)
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    consumed.preventDefault()
    window.dispatchEvent(consumed)
    expect(layers()).not.toBeNull()
  })

  it('mutes, unmutes and deletes a video track from its header, and deletes an empty track the menu added with a write', async () => {
    const { view, heads, requests, ready } = mount(addingTracks(trackState))
    await ready()
    fireEvent.click(view.getByRole('button', { name: '静音 视频 2' }))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.mute', params: { timeline: 't1', target: 'video_track', track: 0, muted: true }, intent: '把 视频 2 静音',
    })
    await waitFor(() => { expect((view.getByRole('button', { name: '静音 视频 3' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(view.getByRole('button', { name: '静音 视频 3' }))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ params: { target: 'video_track', track: 1, muted: false }, intent: '取消 视频 3 的静音' })
    await waitFor(() => { expect((view.getByRole('button', { name: '删除视频轨 视频 3' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(view.getByRole('button', { name: '删除视频轨 视频 3' }))
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.video_track_remove', params: { timeline: 't1', track: 1 }, intent: '删除视频轨 3' })
    fireEvent.click(view.getByRole('button', { name: '添加轨道' }))
    await waitFor(() => { expect((view.getByRole('menuitem', { name: '视频轨' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(view.getByRole('menuitem', { name: '视频轨' }))
    // The scripted state applies only the track add, so 视频 3 is still there.
    await waitFor(() => { expect(heads()).toEqual(['视频 2', '视频 3', '视频 4']) })
    await waitFor(() => { expect((view.getByRole('button', { name: '删除视频轨 视频 4' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(view.getByRole('button', { name: '删除视频轨 视频 4' }))
    await waitFor(() => { expect(requests()).toHaveLength(5) })
    expect(requests()[4]).toMatchObject({ operation: 'timeline.video_track_remove', params: { timeline: 't1', track: 2 }, intent: '删除视频轨 4' })
  })

  it('deletes the 视频 track from its header, which makes 视频 2 the 视频 track, and disables the button with nothing to delete', async () => {
    const { view, requests, ready } = mount()
    await ready()
    fireEvent.click(view.getByRole('button', { name: '删除视频轨 视频 1' }))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.main_track_remove', params: { timeline: 't1' }, intent: '删除主视频轨 视频 1' })
    cleanup()

    const emptyState = (): FixtureState => {
      const state = fixtureState()
      const [t1] = state.components.timeline.timelines
      if (t1 !== undefined) t1.clips = []
      return state
    }
    const empty = mount({ state: emptyState })
    const button = await empty.view.findByRole('button', { name: '删除视频轨 视频' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    // While a clip of the 视频 track still renders, it cannot swap with 视频 2.
    const renderingState = (): FixtureState => {
      const state = trackState()
      const [t1] = state.components.timeline.timelines
      if (t1 !== undefined) t1.clips = t1.clips.map((clip, index) => index === 1 ? { ...clip, asset: null, source: { record: 'g3' as RecordId, output: 0 } } : clip)
      return state
    }
    const rendering = mount({ state: renderingState })
    await rendering.ready()
    fireEvent.click(rendering.view.getByRole('button', { name: '轨道层级' }))
    const disabled = (label: string): boolean => (rendering.view.getByRole('button', { name: label }) as HTMLButtonElement).disabled
    expect([disabled('下移 视频 1'), disabled('上移 视频 2')]).toEqual([true, true])
  })

  it('opens a menu on a right click on a clip, a track header or the 原声 row, whose items split, delete, mute, move or delete the track', async () => {
    const { view, block, requests, seek, ready } = mount()
    await ready()
    const items = (): string[] => within(view.getByRole('menu')).getAllByRole('menuitem')
      .map(item => `${item.textContent}${(item as HTMLButtonElement).disabled ? ' (off)' : ''}`)
    const choose = (name: string): void => { fireEvent.click(within(view.getByRole('menu')).getByRole('menuitem', { name })) }
    const one = (selector: string): HTMLElement => view.container.querySelector(selector) as HTMLElement
    const idle = async (): Promise<void> => {
      await waitFor(() => { expect((view.getByRole('button', { name: '静音 视频 2' }) as HTMLButtonElement).disabled).toBe(false) })
    }
    // A right press starts no drag on a clip of either kind.
    for (const element of [one('[data-clip="cl1"]'), block('cl5')]) {
      fireEvent.pointerDown(element, { button: 2, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(element, { clientX: 200, clientY: 0 })
      fireEvent.pointerUp(element, { clientX: 200, clientY: 0 })
    }
    expect(requests()).toEqual([])
    // At 0 s the playhead sits on cl1's start, where a split leaves no two parts.
    fireEvent.contextMenu(one('[data-clip="cl1"]'))
    expect(items()).toEqual(['在播放头处拆分 (off)', '删除'])
    expect(one('[data-clip="cl1"]').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    seek(2)
    fireEvent.contextMenu(one('[data-clip="cl1"]'))
    choose('在播放头处拆分')
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl1', at_sec: 2 } })
    expect(view.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(block('cl5'))
    expect([items(), block('cl5').getAttribute('aria-pressed')]).toEqual([['在播放头处拆分', '删除'], 'true'])
    choose('在播放头处拆分')
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl5', at_sec: 1 } })
    fireEvent.contextMenu(block('cl6'))
    expect(items()).toEqual(['在播放头处拆分 (off)', '删除'])
    choose('删除')
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl6' } })
    fireEvent.contextMenu(one('[data-clip="cl2"]'))
    choose('删除')
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl2' } })
    fireEvent.contextMenu(one('[data-main-track-head]'))
    expect(items()).toEqual(['静音', '上移 (off)', '下移', '删除视频轨'])
    choose('静音')
    // While the mute runs, the track menus offer nothing that writes.
    fireEvent.contextMenu(one('[data-video-track-head="0"]'))
    expect(items()).toEqual(['静音 (off)', '上移 (off)', '下移 (off)', '删除视频轨 (off)'])
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(requests()).toHaveLength(5) })
    expect(requests()[4]).toMatchObject({ operation: 'timeline.mute', params: { target: 'video', muted: true } })
    await idle()
    fireEvent.contextMenu(one('[data-video-track-head="0"]'))
    expect(items()).toEqual(['静音', '上移', '下移', '删除视频轨'])
    choose('下移')
    await waitFor(() => { expect(requests()).toHaveLength(6) })
    expect(requests()[5]).toMatchObject({ operation: 'timeline.video_track_move', params: { timeline: 't1', track: 0, to: 1 } })
    await idle()
    fireEvent.contextMenu(one('[data-video-track-head="1"]'))
    expect(items()).toEqual(['取消静音', '上移', '下移 (off)', '删除视频轨'])
    choose('上移')
    await waitFor(() => { expect(requests()).toHaveLength(7) })
    expect(requests()[6]).toMatchObject({ operation: 'timeline.video_track_move', params: { track: 1, to: 0 } })
    await idle()
    fireEvent.contextMenu(one('[data-video-track-head="1"]'))
    choose('取消静音')
    await waitFor(() => { expect(requests()).toHaveLength(8) })
    expect(requests()[7]).toMatchObject({ operation: 'timeline.mute', params: { target: 'video_track', track: 1, muted: false } })
    await idle()
    fireEvent.contextMenu(one('[data-video-track-head="1"]'))
    choose('删除视频轨')
    await waitFor(() => { expect(requests()).toHaveLength(9) })
    expect(requests()[8]).toMatchObject({ operation: 'timeline.video_track_remove', params: { track: 1 } })
    await idle()
    // The 原声 row, header or lane, mutes the 视频 track's own audio.
    fireEvent.contextMenu(one('[data-audio-head]'))
    expect(items()).toEqual(['静音'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(one('[data-audio-lane]'))
    choose('静音')
    await waitFor(() => { expect(requests()).toHaveLength(10) })
    expect(requests()[9]).toMatchObject({ operation: 'timeline.mute', params: { target: 'video', muted: true } })
    await idle()
    fireEvent.contextMenu(one('[data-sound-track-head="0"]'))
    expect(items()).toEqual(['静音', '重命名', '删除音轨'])
    choose('静音')
    await waitFor(() => { expect(requests()).toHaveLength(11) })
    expect(requests()[10]).toMatchObject({ operation: 'timeline.mute', params: { target: 'sound', track: 0, muted: true } })
    await idle()
    fireEvent.contextMenu(one('[data-main-track-head]'))
    choose('删除视频轨')
    await waitFor(() => { expect(requests()).toHaveLength(12) })
    expect(requests()[11]).toMatchObject({ operation: 'timeline.main_track_remove', params: { timeline: 't1' } })
  })

  it('adds a video where a free spot of a video lane was right-clicked, or a track at the bottom, from the lane menu', async () => {
    const { view, lane, requests, ready } = mount()
    await ready()
    const items = (): string[] => within(view.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)
    const choose = (name: string): void => { fireEvent.click(within(view.getByRole('menu')).getByRole('menuitem', { name })) }
    fireEvent.contextMenu(lane(1), { clientX: 40 })
    expect(items()).toEqual(['在这里添加视频', '添加视频轨', '添加音轨'])
    choose('在这里添加视频')
    fireEvent.click(within(view.getByRole('dialog', { name: '选一个素材放到 00:01.00' })).getByRole('button', { name: 'shot2.mp4' }))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.track_clip_add', params: { timeline: 't1', asset: 'shot2.mp4', track: 1, start_sec: 1 } })
    // On the 视频 track, the video goes in before the clip whose middle is after the right-clicked time.
    fireEvent.contextMenu(view.getByRole('list', { name: '视频轨道' }), { clientX: 200 })
    choose('在这里添加视频')
    fireEvent.click(within(view.getByRole('dialog', { name: '选一个素材放到 00:05.00' })).getByRole('button', { name: 'shot1.mp4' }))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_insert', params: { at: 2, asset: 'shot1.mp4' } })
    // Escape closes a picker that a menu opened and leaves focus on the editor.
    fireEvent.contextMenu(lane(0), { clientX: 400 })
    choose('在这里添加视频')
    fireEvent.keyDown(view.getByRole('dialog', { name: '选一个素材放到 00:10.00' }), { key: 'Escape' })
    expect([view.queryByRole('dialog'), document.activeElement]).toEqual([null, view.getByTestId('dv-timeline-editor')])
    fireEvent.contextMenu(lane(0), { clientX: 400 })
    choose('添加视频轨')
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.track_add', params: { timeline: 't1', kind: 'video' } })
    await waitFor(() => { expect((view.getByRole('button', { name: '静音 视频 2' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.contextMenu(lane(0), { clientX: 400 })
    choose('添加音轨')
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.track_add', params: { kind: 'sound' } })
  })

  it('shows a timeline whose only clips are on the video tracks, names a track clip whose asset the state lacks by its asset ID, and marks a stale one', async () => {
    const routes: ScriptedRoutes = {
      state: () => {
        const state = trackState()
        const [t1] = state.components.timeline.timelines
        if (t1 !== undefined) {
          t1.clips = []
          t1.track_clips.push(
            { id: 'cl7' as ClipId, asset: 'gone.mp4' as AssetId, in_sec: null, out_sec: null, start_sec: 9, track: 0 },
            // shot2.mp4 comes from the stale render g2.
            { id: 'cl8' as ClipId, asset: 'shot2.mp4' as AssetId, in_sec: null, out_sec: null, start_sec: 20, track: 0 },
          )
        }
        return state
      },
      // A refused removal keeps the clip selected.
      post: (_path, body) => (body as { operation?: string }).operation === 'timeline.clip_remove'
        ? { status: 409, body: {} }
        : { status: 200, body: { problems: [] } },
    }
    const { view, lane, block, requests, ready } = mount(routes)
    await ready()
    expect(view.queryByTestId('dv-timeline-viewer-empty')).toBeNull()
    expect((view.getByRole('button', { name: '播放' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(lane(0)).getByRole('listitem', { name: '视频 2 的片段：gone.mp4' })).toBeTruthy()
    expect([block('cl5').getAttribute('data-clip-stale'), block('cl8').getAttribute('data-clip-stale')]).toEqual(['false', 'true'])
    expect(block('cl8').style.boxShadow).toContain('2px')
    fireEvent.pointerDown(block('cl8'), { clientX: 800, clientY: 0 })
    fireEvent.pointerUp(block('cl8'), { clientX: 800, clientY: 0 })
    await waitFor(() => { expect(block('cl8').getAttribute('aria-pressed')).toBe('true') })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('HTTP 409') })
    expect(block('cl8').getAttribute('aria-pressed')).toBe('true')
  })
})
