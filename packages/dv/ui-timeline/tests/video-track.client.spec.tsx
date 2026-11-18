// @vitest-environment jsdom
/**
 * The video tracks over a scripted API: their rows, names and order, the clip the preview shows and plays, and each edit
 * of their clips and tracks as a record. Every video track works the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { AssetId } from '@dv/project/types'
import type { ClipId } from '@dv/timeline/types'
import { DvClient } from '@dv/ui-kit/api.ts'
import { DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState, ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { addingTracks, bootTimeline, centerView } from './center.client.tsx'
import type { BootedTimeline } from './center.client.tsx'

let booted: BootedTimeline

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
 * The shared fixture with three video tracks on t1. 视频 1 (track 0) plays cl1 from 0 s to 4 s and cl2 from 4 s to 7 s;
 * 视频 2 (track 1) holds export.mp4 (3 s) from 1 s to 4 s as cl5; 视频 3 (track 2), muted, holds 2 s of shot1.mp4 from 6 s
 * to 8 s as cl6. The sound track sits between 视频 1 and 视频 2. Every row spans 62 px with the gap under it, so the rows
 * start at 0 px (视频 1), 62 px (声音 1), 124 px (视频 2) and 186 px (视频 3).
 */
function trackState(): FixtureState {
  const state = fixtureState()
  const [t1] = state.components.timeline.timelines
  if (t1 === undefined) throw new Error('no t1')
  t1.clips = [
    ...t1.clips.map((clip, index) => ({ ...clip, start_sec: index === 0 ? 0 : 4 })),
    { id: 'cl5' as ClipId, asset: 'export.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 1, track: 1 },
    { id: 'cl6' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: 0.5, out_sec: 2.5, start_sec: 6, track: 2 },
  ]
  t1.muted_video_tracks = [2]
  t1.track_order = ['video', 'sound', 'video', 'video']
  return state
}

/** One more clip for the first timeline of a state. */
function withClip(state: FixtureState, id: string, asset: string, start: number, track: number, out: number | null = null): FixtureState {
  const clip = { id: id as ClipId, asset: asset as AssetId, source: null, in_sec: null, out_sec: out, start_sec: start, track }
  state.components.timeline.timelines[0]?.clips.push(clip)
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
  const head = (track: number): HTMLElement => one(`[data-video-track-head="${String(track)}"]`)
  const block = (clip: string): HTMLElement => one(`[data-clip="${clip}"]`)
  const preview = (clip: string): HTMLVideoElement => one(`video[data-track-clip="${clip}"]`) as HTMLVideoElement
  const heads = (): Array<string | null> => [...view.container.querySelectorAll('[data-video-track-head]')].map(entry => entry.textContent)
  // The headers of the track rows, top to bottom, as `video N` and `sound N` by track number.
  const rowOrder = (): string[] => [...view.container.querySelectorAll('[data-video-track-head], [data-sound-track-head]')].map(entry =>
    entry.hasAttribute('data-video-track-head') ? `video ${String(entry.getAttribute('data-video-track-head'))}` : `sound ${String(entry.getAttribute('data-sound-track-head'))}`)
  const requests = (): Array<Record<string, unknown>> => writes.filter(write => write.path === '/api/dv/operation').map(write => write.body as Record<string, unknown>)
  const seek = (seconds: number): void => {
    const ruler = view.getByTestId('dv-timeline-ruler')
    fireEvent.pointerDown(ruler, { clientX: seconds * 40 })
    fireEvent.pointerUp(ruler, { clientX: seconds * 40 })
  }
  const pick = (element: HTMLElement): void => {
    fireEvent.pointerDown(element, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(element, { clientX: 0, clientY: 0 })
  }
  // Until a header write shows in the refreshed state, the header buttons stay disabled.
  const idle = async (): Promise<void> => {
    await waitFor(() => { expect((view.getByRole('button', { name: '静音 视频 2' }) as HTMLButtonElement).disabled).toBe(false) })
  }
  const ready = async (): Promise<void> => { await view.findByRole('list', { name: '视频轨道 2' }) }
  return { view, one, lane, head, block, preview, heads, rowOrder, requests, seek, pick, idle, ready }
}

const visible = (element: HTMLElement): boolean => element.style.visibility === 'visible'

describe('video tracks', () => {
  it('names the video tracks 视频 1, 视频 2, … from the top, and shows and plays the clip of the track with the lowest number at the playhead', async () => {
    // cl9 on track 1 runs from 7.2 s to 10.2 s, over the end of cl6 on track 2.
    const { view, lane, block, preview, heads, seek, ready } = mount({ state: () => withClip(trackState(), 'cl9', 'export.mp4', 7.2, 1) })
    await ready()
    expect(heads()).toEqual(['视频 1', '视频 2', '视频 3'])
    // A video clip's own audio has no row of its own.
    expect(view.queryByText(/原声/)).toBeNull()
    expect(within(lane(1)).getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['视频 2 的片段：export.mp4', '视频 2 的片段：export.mp4'])
    expect([block('cl5').style.left, block('cl5').style.width]).toEqual(['40px', '120px'])
    expect([block('cl6').style.left, block('cl6').style.opacity]).toEqual(['240px', '0.45'])
    // The preview plays to the end of the last clip of any track.
    expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:00.00 / 00:10.20')
    expect([visible(preview('cl1')), preview('cl1').muted]).toEqual([true, false])
    // 视频 1 covers cl5 while it plays.
    seek(2)
    await waitFor(() => { expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:02.00 / 00:10.20') })
    expect([visible(preview('cl1')), visible(preview('cl5')), visible(preview('cl6')), visible(preview('cl9'))]).toEqual([true, false, false, false])
    expect([preview('cl5').muted, preview('cl6').muted]).toEqual([true, true])
    // After 视频 1 ends, the clip of the muted track shows silent until 视频 2 has a clip again.
    seek(7.1)
    await waitFor(() => { expect(visible(preview('cl6'))).toBe(true) })
    expect([preview('cl6').muted, visible(preview('cl2'))]).toEqual([true, false])
    seek(7.5)
    await waitFor(() => { expect(visible(preview('cl9'))).toBe(true) })
    expect([visible(preview('cl6')), preview('cl9').muted]).toEqual([false, false])
    seek(5)
    await waitFor(() => { expect(visible(preview('cl2'))).toBe(true) })
    expect(preview('cl2').muted).toBe(false)
  })

  it('shows the clip of the track under a gap, on any track, and writes nothing for a drag that ends where it started', async () => {
    // cl2 starts at 6 s, leaving 4 s to 6 s of 视频 1 empty; cl5 plays from 4 s to 7 s on 视频 2, so it shows in the gap and
    // hides under cl2 after it.
    const routes: ScriptedRoutes = {
      state: () => {
        const state = trackState()
        const [t1] = state.components.timeline.timelines
        if (t1 !== undefined) t1.clips = t1.clips.flatMap(clip => clip.id === 'cl2' ? [{ ...clip, start_sec: 6 }] : clip.id === 'cl5' ? [{ ...clip, start_sec: 4 }] : clip.id === 'cl6' ? [] : [clip])
        return state
      },
    }
    const { view, block, preview, requests, seek, ready } = mount(routes)
    await ready()
    expect([block('cl1').style.left, block('cl2').style.left]).toEqual(['0px', '240px'])
    seek(5)
    await waitFor(() => { expect([visible(preview('cl5')), visible(preview('cl1')), visible(preview('cl2'))]).toEqual([true, false, false]) })
    seek(6.5)
    await waitFor(() => { expect([visible(preview('cl5')), visible(preview('cl2'))]).toEqual([false, true]) })
    // At the end of the last clip, where the playhead stops, that clip stays shown.
    seek(9)
    await waitFor(() => { expect([visible(preview('cl5')), visible(preview('cl2'))]).toEqual([false, true]) })
    expect(view.queryByTestId('dv-timeline-viewer-empty')).toBeNull()
    fireEvent.pointerDown(block('cl2'), { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(block('cl2'), { clientX: 0, clientY: 10 })
    fireEvent.pointerUp(block('cl2'), { clientX: 0, clientY: 10 })
    await act(async () => { await Promise.resolve() })
    expect(requests()).toEqual([])
  })

  it('holds the playhead while the clip the preview shows is still loading, and plays on once it can play', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const { view, preview, ready } = mount()
    await ready()
    // cl1, the clip at the playhead, is being fetched and has only its current frame.
    const loading = { readyState: HTMLMediaElement.HAVE_CURRENT_DATA as number }
    Object.defineProperties(preview('cl1'), {
      networkState: { get: () => HTMLMediaElement.NETWORK_LOADING }, readyState: { get: () => loading.readyState },
    })
    // The playhead sits 144 px of header and 40 px a second from the left.
    const playhead = (): number => (Number.parseFloat(view.getByTestId('dv-timeline-playhead').style.left) - 144) / 40
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      fireEvent.click(view.getByRole('button', { name: '播放' }))
      act(() => { vi.advanceTimersByTime(1000) })
      expect([playhead(), view.queryByRole('button', { name: '暂停' }) !== null]).toEqual([0, true])
      loading.readyState = HTMLMediaElement.HAVE_ENOUGH_DATA
      act(() => { vi.advanceTimersByTime(1000) })
      expect(playhead()).toBeCloseTo(1, 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lays out the video tracks and sound tracks in the order they were added, and moves a dragged clip to the video track nearest the row it ends on', async () => {
    const { view, block, rowOrder, requests, ready } = mount(addingTracks(trackState))
    await ready()
    expect(rowOrder()).toEqual(['video 0', 'sound 0', 'video 1', 'video 2'])
    // A new track goes at the bottom once the refreshed state stores it.
    fireEvent.click(view.getByRole('button', { name: '添加轨道' }))
    fireEvent.click(view.getByRole('menuitem', { name: '音轨' }))
    await waitFor(() => { expect(rowOrder()).toEqual(['video 0', 'sound 0', 'video 1', 'video 2', 'sound 1']) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.track_add', params: { timeline: 't1', kind: 'sound' }, intent: '添加音轨' })
    // cl1 ends 62 px down, on the sound row, as near 视频 1 (0 px) as 视频 2 (124 px), and goes the drag's way; the sound row
    // takes no clip.
    fireEvent.pointerDown(block('cl1'), { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(block('cl1'), { clientX: 0, clientY: 62 })
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]?.['params']).toEqual({ clip: 'cl1', start_sec: 0, track: 1 })
    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 0 })
    fireEvent.pointerUp(block('cl5'), { clientX: 40, clientY: -62 })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]?.['params']).toEqual({ clip: 'cl5', start_sec: 1, track: 0 })
  })

  it('moves a clip to another video track by a drag up or down, 视频 1 like any other, and in time by a drag along its row', async () => {
    const { block, requests, ready } = mount()
    await ready()
    fireEvent.pointerDown(block('cl1'), { clientX: 0, clientY: 0 })
    // 110 px down is nearer 视频 2 (124 px) than 视频 1 (0 px) or 视频 3 (186 px).
    fireEvent.pointerMove(block('cl1'), { clientX: 180, clientY: 110 })
    expect(block('cl1').style.transform).toBe('translate(180px, 110px)')
    fireEvent.pointerUp(block('cl1'), { clientX: 180, clientY: 110 })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.clip_move', params: { clip: 'cl1', start_sec: 4.5, track: 1 }, intent: '把片段移到 视频 2 的 00:04.50',
    })
    // A short drag up or down stays on the row and moves the clip in time there.
    fireEvent.pointerDown(block('cl1'), { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(block('cl1'), { clientX: 240, clientY: -20 })
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]?.['params']).toEqual({ clip: 'cl1', start_sec: 6 })
    // cl5 plays from 1 s on 视频 2; dragged straight up to 视频 1, it keeps its 1 s there.
    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 124 })
    fireEvent.pointerUp(block('cl5'), { clientX: 40, clientY: 10 })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_move', params: { clip: 'cl5', start_sec: 1, track: 0 }, intent: '把片段移到 视频 1 的 00:01.00' })
    // A drag past the timeline's start stops at 0 s.
    fireEvent.pointerDown(block('cl5'), { clientX: 40, clientY: 0 })
    fireEvent.pointerMove(block('cl5'), { clientX: -200, clientY: 10 })
    expect(block('cl5').style.transform).toBe('translate(-40px, 10px)')
    fireEvent.pointerUp(block('cl5'), { clientX: -200, clientY: 10 })
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]?.['params']).toEqual({ clip: 'cl5', start_sec: 0 })
    // A move or release from another press changes nothing.
    fireEvent.pointerMove(block('cl6'), { clientX: 400 })
    fireEvent.pointerUp(block('cl6'), { clientX: 400 })
    expect(requests()).toHaveLength(4)
  })

  it('selects one clip at a time by a click, and splits or removes the selected clip, else splits the clip the preview shows', async () => {
    const { view, block, requests, seek, pick, ready } = mount()
    await ready()
    const split = (): HTMLButtonElement => view.getByRole('button', { name: '拆分' }) as HTMLButtonElement
    // With nothing selected, the split button splits the clip the user sees at the playhead: cl1 at 2 s.
    expect(split().disabled).toBe(true)
    seek(2)
    await waitFor(() => { expect(split().disabled).toBe(false) })
    fireEvent.click(split())
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl1', at_sec: 2 }, intent: '在 00:02.00 拆分 视频 1 上的片段' })
    // A selected clip is the one that splits, though 视频 1 covers it; outside it, nothing splits.
    pick(block('cl5'))
    await waitFor(() => { expect(block('cl5').getAttribute('aria-pressed')).toBe('true') })
    fireEvent.click(split())
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl5', at_sec: 1 }, intent: '在 00:02.00 拆分 视频 2 上的片段' })
    seek(5)
    await waitFor(() => { expect(split().disabled).toBe(true) })
    fireEvent.click(view.getByRole('button', { name: '删除片段' }))
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl5' }, intent: '从 视频 2 移除片段' })
    await waitFor(() => { expect(block('cl5').getAttribute('aria-pressed')).toBe('false') })
    pick(block('cl6'))
    await waitFor(() => { expect(block('cl6').getAttribute('aria-pressed')).toBe('true') })
    pick(block('cl1'))
    await waitFor(() => { expect([block('cl1'), block('cl6')].map(each => each.getAttribute('aria-pressed'))).toEqual(['true', 'false']) })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Backspace' })
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl1' }, intent: '从 视频 1 移除片段' })
  })

  it('selects a clip that another view focuses or that a finished move placed instead of the selected clip', async () => {
    const { view, block, requests, pick, ready } = mount()
    await ready()
    pick(block('cl5'))
    act(() => { booted.stand.show({ timeline: 't1', clip: 'cl2' }) })
    expect([block('cl2').getAttribute('aria-pressed'), block('cl5').getAttribute('aria-pressed')]).toEqual(['true', 'false'])
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl2' } })
    // A clip picked while a move runs gives way to the moved clip once the move is done.
    fireEvent.pointerDown(block('cl6'), { clientX: 0 })
    fireEvent.pointerMove(block('cl6'), { clientX: 200 })
    fireEvent.pointerUp(block('cl6'), { clientX: 200 })
    pick(block('cl5'))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    await waitFor(() => { expect([block('cl5'), block('cl6')].map(each => each.getAttribute('aria-pressed'))).toEqual(['false', 'true']) })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl6' } })
  })

  it('trims a clip by its edges, a start trim keeping the clip inside the timeline', async () => {
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
    // The live drag moves the edge of the clip; a press that does not move writes nothing.
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
    await waitFor(() => { expect(heads()).toEqual(['视频 1', '视频 2', '视频 3', '视频 4']) })
    expect(rowOrder()).toEqual(['video 0', 'sound 0', 'video 1', 'video 2', 'video 3'])
    expect(requests()).toEqual([expect.objectContaining({ operation: 'timeline.track_add', params: { timeline: 't1', kind: 'video' }, intent: '添加视频轨' })])
    // Empty tracks add one under another.
    await waitFor(() => { expect(add().disabled).toBe(false) })
    fireEvent.click(add())
    await waitFor(() => { expect(heads()).toEqual(['视频 1', '视频 2', '视频 3', '视频 4', '视频 5']) })
    expect(view.queryByRole('menu', { name: '添加轨道' })).toBeNull()
    expect(fireEvent.dragOver(lane(3), { dataTransfer: assetDrag('shot2.mp4') })).toBe(false)
    expect(fireEvent.dragOver(lane(3), { dataTransfer: { types: ['text/plain'], getData: () => '' } })).toBe(true)
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 3 * 40 })
    Object.defineProperty(drop, 'dataTransfer', { value: assetDrag('shot2.mp4') })
    expect(fireEvent(lane(3), drop)).toBe(false)
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({
      operation: 'timeline.clip_add', params: { timeline: 't1', asset: 'shot2.mp4', track: 3, start_sec: 3 }, intent: '把片段放到 视频 4 的 00:03.00',
    })
    expect(fireEvent.drop(lane(0), { dataTransfer: assetDrag('ref.png', 'image/png') })).toBe(false)
    expect(view.getByRole('status').textContent).toBe('视频轨道只接受视频。')
    expect(fireEvent.drop(lane(0), { dataTransfer: { types: ['text/plain'], getData: () => '' } })).toBe(true)
    expect(requests()).toHaveLength(3)
  })

  it('adds a picked video from the ＋ of a video track after its last clip, or at the playhead on an empty track', async () => {
    const routes: ScriptedRoutes = {
      state: () => {
        const state = trackState()
        state.components.timeline.timelines[0]?.track_order.push('video')
        return state
      },
    }
    const { view, head, requests, ready } = mount(routes)
    await ready()
    // Each video track's ＋ sits in its header, right of the delete button.
    const plus = (track: number): HTMLElement => within(head(track)).getByRole('button', { name: `添加片段到 视频 ${String(track + 1)}` })
    const choose = (name: string): void => { fireEvent.click(within(view.getByRole('dialog', { name: '选一个素材放到这条轨道上' })).getByRole('button', { name })) }
    fireEvent.click(plus(1))
    expect(plus(1).getAttribute('aria-expanded')).toBe('true')
    choose('shot2.mp4')
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_add', params: { timeline: 't1', asset: 'shot2.mp4', track: 1, start_sec: 4 } })
    // The ＋ of another track turns the open picker to that track instead of closing it.
    fireEvent.click(plus(3))
    fireEvent.click(plus(0))
    expect([plus(0), plus(3)].map(button => button.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
    fireEvent.click(plus(3))
    choose('shot1.mp4')
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_add', params: { asset: 'shot1.mp4', track: 3, start_sec: 0 } })
    fireEvent.click(plus(0))
    choose('shot1.mp4')
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_add', params: { asset: 'shot1.mp4', track: 0, start_sec: 7 }, intent: '把片段放到 视频 1 的 00:07.00' })
  })

  it('opens the asset picker and the sound dialog beside the ＋ that opened them, upward from the lower half, and where a lane menu was opened', async () => {
    const { view, lane, ready } = mount()
    await ready()
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) })
    // The track area spans 100 px to 400 px down the screen; its lower half starts at 250 px.
    vi.spyOn(view.getByTestId('dv-timeline-track-area'), 'getBoundingClientRect').mockReturnValue(rect(0, 100, 1000, 300))
    const insert = view.getByRole('button', { name: '添加片段到 视频 1' })
    vi.spyOn(insert, 'getBoundingClientRect').mockReturnValue(rect(110, 150, 24, 24))
    fireEvent.click(insert)
    const place = (element: HTMLElement): string[] => [element.style.left, element.style.top, element.style.bottom, element.style.maxHeight]
    expect(place(view.getByRole('dialog', { name: '选一个素材放到这条轨道上' }))).toEqual(['138px', '50px', '', 'min(194px, calc(100% - 58px))'])
    const addSound = within(view.container.querySelector('[data-sound-track-head="0"]') as HTMLElement).getByRole('button', { name: '添加声音' })
    vi.spyOn(addSound, 'getBoundingClientRect').mockReturnValue(rect(110, 300, 24, 24))
    fireEvent.click(addSound)
    expect(place(view.getByRole('dialog', { name: '添加声音' }))).toEqual(['138px', '', '76px', 'min(234px, calc(100% - 84px))'])
    // Near the area's right edge, the picker opens as far right as it fits.
    fireEvent.contextMenu(lane(1), { clientX: 990, clientY: 120 })
    fireEvent.click(view.getByRole('menuitem', { name: '在这里添加视频' }))
    expect(place(view.getByRole('dialog', { name: /^选一个素材放到 / })).slice(0, 2)).toEqual(['772px', '20px'])
  })

  it('moves a video track up or down from the arrows in 轨道层级, 视频 1 too, one write until the refreshed state shows the move', async () => {
    // The served state swaps the two tracks of each posted move.
    const moves: Array<[number, number]> = []
    const routes: ScriptedRoutes = {
      state: () => {
        // A clip of an asset the project no longer lists, before cl6 on track 2.
        const state = withClip(trackState(), 'cl9', 'lost.mp4', 0, 2, 1)
        for (const [track, to] of moves) {
          for (const clip of state.components.timeline.timelines[0]?.clips ?? []) {
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
    // The top track cannot go up and the bottom one cannot go down.
    const arrows = ['上移 视频 1', '下移 视频 1', '上移 视频 2', '下移 视频 2', '上移 视频 3', '下移 视频 3']
    expect(arrows.map(label => arrow(label).disabled)).toEqual([true, false, false, false, false, true])
    fireEvent.click(arrow('上移 视频 3'))
    expect(arrow('下移 视频 2').disabled).toBe(true)
    await waitFor(() => { expect(contents()).toEqual(['shot1.mp4、shot2.mp4', 'lost.mp4、shot1.mp4', 'export.mp4']) })
    expect(requests()).toEqual([expect.objectContaining({ operation: 'timeline.video_track_move', params: { timeline: 't1', track: 2, to: 1 }, intent: '上移 视频 3' })])
    await waitFor(() => { expect(arrow('下移 视频 2').disabled).toBe(false) })
    fireEvent.click(arrow('下移 视频 2'))
    await waitFor(() => { expect(contents()).toEqual(['shot1.mp4、shot2.mp4', 'export.mp4', 'lost.mp4、shot1.mp4']) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.video_track_move', params: { track: 1, to: 2 }, intent: '下移 视频 2' })
    // 视频 1 moves down like any other track, which puts 视频 2's clips on top.
    await waitFor(() => { expect(arrow('下移 视频 1').disabled).toBe(false) })
    fireEvent.click(arrow('下移 视频 1'))
    await waitFor(() => { expect(contents()).toEqual(['export.mp4', 'shot1.mp4、shot2.mp4', 'lost.mp4、shot1.mp4']) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.video_track_move', params: { timeline: 't1', track: 0, to: 1 }, intent: '下移 视频 1' })
    await waitFor(() => { expect(arrow('上移 视频 2').disabled).toBe(false) })
    fireEvent.click(arrow('上移 视频 2'))
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.video_track_move', params: { track: 1, to: 0 } })
  })

  it('draws a line under each row and at the header column\'s edge, and shows the scrollbars only while the track area scrolls', async () => {
    const { view, ready } = mount()
    await ready()
    const grid = view.getByTestId('dv-timeline-grid')
    // The ruler (26 px), then 视频 1, the sound track, 视频 2 and 视频 3 (56 px each), with a 6 px gap under each row and the
    // line in its middle.
    expect([...grid.children].slice(0, -1).map(line => (line as HTMLElement).style.top)).toEqual(['29px', '91px', '153px', '215px', '277px'])
    expect((grid.lastElementChild as HTMLElement).style.left).toBe('143px')
    expect(view.getByTestId('dv-timeline-playhead').style.height).toBe('274px')
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

  it('lists the video tracks in 轨道层级 from the top, and closes the list by its button, a press outside or Escape', async () => {
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
    await waitFor(() => { expect(view.container.querySelectorAll('[data-video-track-head]')).toHaveLength(4) })
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

  it('mutes, unmutes and deletes any video track from its header, 视频 1 too, and deletes an empty track the menu added with a write', async () => {
    const { view, heads, requests, idle, ready } = mount(addingTracks(trackState))
    await ready()
    const button = (name: string): HTMLButtonElement => view.getByRole('button', { name }) as HTMLButtonElement
    fireEvent.click(button('静音 视频 1'))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.mute', params: { timeline: 't1', target: 'video_track', track: 0, muted: true }, intent: '把 视频 1 静音',
    })
    await idle()
    fireEvent.click(button('静音 视频 3'))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ params: { target: 'video_track', track: 2, muted: false }, intent: '取消 视频 3 的静音' })
    await idle()
    fireEvent.click(button('删除视频轨 视频 3'))
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.video_track_remove', params: { timeline: 't1', track: 2 }, intent: '删除视频轨 视频 3' })
    await idle()
    fireEvent.click(button('删除视频轨 视频 1'))
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.video_track_remove', params: { timeline: 't1', track: 0 }, intent: '删除视频轨 视频 1' })
    fireEvent.click(button('添加轨道'))
    await waitFor(() => { expect((view.getByRole('menuitem', { name: '视频轨' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(view.getByRole('menuitem', { name: '视频轨' }))
    // The scripted state applies only the track add, so the deleted tracks are still there.
    await waitFor(() => { expect(heads()).toEqual(['视频 1', '视频 2', '视频 3', '视频 4']) })
    await waitFor(() => { expect(button('删除视频轨 视频 4').disabled).toBe(false) })
    fireEvent.click(button('删除视频轨 视频 4'))
    await waitFor(() => { expect(requests()).toHaveLength(6) })
    expect(requests()[5]).toMatchObject({ operation: 'timeline.video_track_remove', params: { timeline: 't1', track: 3 }, intent: '删除视频轨 视频 4' })
  })

  it('names a lone video track 视频, and disables its header buttons in a project without timelines', async () => {
    const lone = mount({ state: fixtureState })
    await lone.view.findByRole('list', { name: '视频轨道' })
    expect(lone.heads()).toEqual(['视频'])
    const named = (view: typeof lone.view, name: string): HTMLButtonElement => view.getByRole('button', { name }) as HTMLButtonElement
    expect(['静音 视频', '删除视频轨 视频', '添加片段到 视频'].map(name => named(lone.view, name).disabled)).toEqual([false, false, false])
    fireEvent.click(named(lone.view, '删除视频轨 视频'))
    await waitFor(() => { expect(lone.requests()).toHaveLength(1) })
    expect(lone.requests()[0]).toMatchObject({ operation: 'timeline.video_track_remove', params: { timeline: 't1', track: 0 } })
    cleanup()

    const none = (): FixtureState => {
      const state = fixtureState()
      state.components.timeline.timelines = []
      return state
    }
    const empty = mount({ state: none })
    await empty.view.findByRole('list', { name: '视频轨道' })
    expect(['静音 视频', '删除视频轨 视频', '添加片段到 视频'].map(name => named(empty.view, name).disabled)).toEqual([true, true, true])
  })

  it('opens a menu on a right click on a clip or a track header, whose items split, delete, mute, move or delete the track', async () => {
    const { view, one, head, block, requests, seek, idle, ready } = mount()
    await ready()
    const items = (): string[] => within(view.getByRole('menu')).getAllByRole('menuitem')
      .map(item => `${item.textContent}${(item as HTMLButtonElement).disabled ? ' (off)' : ''}`)
    const choose = (name: string): void => { fireEvent.click(within(view.getByRole('menu')).getByRole('menuitem', { name })) }
    // A right press starts no drag on a clip.
    for (const element of [block('cl1'), block('cl5')]) {
      fireEvent.pointerDown(element, { button: 2, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(element, { clientX: 200, clientY: 0 })
      fireEvent.pointerUp(element, { clientX: 200, clientY: 0 })
    }
    expect(requests()).toEqual([])
    // At 0 s the playhead sits on cl1's start, where a split leaves no two parts.
    fireEvent.contextMenu(block('cl1'))
    expect(items()).toEqual(['在播放头处拆分 (off)', '删除'])
    expect(block('cl1').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    seek(2)
    fireEvent.contextMenu(block('cl1'))
    choose('在播放头处拆分')
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl1', at_sec: 2 } })
    expect(view.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(block('cl5'))
    expect([items(), block('cl5').getAttribute('aria-pressed'), block('cl1').getAttribute('aria-pressed')]).toEqual([['在播放头处拆分', '删除'], 'true', 'false'])
    choose('在播放头处拆分')
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl5', at_sec: 1 } })
    fireEvent.contextMenu(block('cl6'))
    expect(items()).toEqual(['在播放头处拆分 (off)', '删除'])
    choose('删除')
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl6' } })
    // The top track cannot move up; while a header write runs, the track menus offer nothing that writes.
    fireEvent.contextMenu(head(0))
    expect(items()).toEqual(['静音', '上移 (off)', '下移', '删除视频轨'])
    choose('静音')
    fireEvent.contextMenu(head(1))
    expect(items()).toEqual(['静音 (off)', '上移 (off)', '下移 (off)', '删除视频轨 (off)'])
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.mute', params: { target: 'video_track', track: 0, muted: true } })
    await idle()
    fireEvent.contextMenu(head(1))
    expect(items()).toEqual(['静音', '上移', '下移', '删除视频轨'])
    choose('下移')
    await waitFor(() => { expect(requests()).toHaveLength(5) })
    expect(requests()[4]).toMatchObject({ operation: 'timeline.video_track_move', params: { timeline: 't1', track: 1, to: 2 } })
    await idle()
    fireEvent.contextMenu(head(2))
    expect(items()).toEqual(['取消静音', '上移', '下移 (off)', '删除视频轨'])
    choose('上移')
    await waitFor(() => { expect(requests()).toHaveLength(6) })
    expect(requests()[5]).toMatchObject({ operation: 'timeline.video_track_move', params: { track: 2, to: 1 } })
    await idle()
    fireEvent.contextMenu(head(2))
    choose('取消静音')
    await waitFor(() => { expect(requests()).toHaveLength(7) })
    expect(requests()[6]).toMatchObject({ operation: 'timeline.mute', params: { target: 'video_track', track: 2, muted: false } })
    await idle()
    fireEvent.contextMenu(head(2))
    choose('删除视频轨')
    await waitFor(() => { expect(requests()).toHaveLength(8) })
    expect(requests()[7]).toMatchObject({ operation: 'timeline.video_track_remove', params: { track: 2 } })
    await idle()
    fireEvent.contextMenu(one('[data-sound-track-head="0"]'))
    expect(items()).toEqual(['静音', '重命名', '删除音轨'])
    choose('静音')
    await waitFor(() => { expect(requests()).toHaveLength(9) })
    expect(requests()[8]).toMatchObject({ operation: 'timeline.mute', params: { target: 'sound', track: 0, muted: true } })
    await idle()
    fireEvent.contextMenu(head(0))
    choose('删除视频轨')
    await waitFor(() => { expect(requests()).toHaveLength(10) })
    expect(requests()[9]).toMatchObject({ operation: 'timeline.video_track_remove', params: { timeline: 't1', track: 0 } })
  })

  it('adds a video where a free spot of a video lane was right-clicked, or a track at the bottom, from the lane menu', async () => {
    const { view, lane, requests, idle, ready } = mount()
    await ready()
    const items = (): string[] => within(view.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)
    const choose = (name: string): void => { fireEvent.click(within(view.getByRole('menu')).getByRole('menuitem', { name })) }
    fireEvent.contextMenu(lane(2), { clientX: 40 })
    expect(items()).toEqual(['在这里添加视频', '添加视频轨', '添加音轨'])
    choose('在这里添加视频')
    fireEvent.click(within(view.getByRole('dialog', { name: '选一个素材放到 00:01.00' })).getByRole('button', { name: 'shot2.mp4' }))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_add', params: { timeline: 't1', asset: 'shot2.mp4', track: 2, start_sec: 1 } })
    // 视频 1 takes a video at the right-clicked time the same way.
    fireEvent.contextMenu(lane(0), { clientX: 320 })
    choose('在这里添加视频')
    fireEvent.click(within(view.getByRole('dialog', { name: '选一个素材放到 00:08.00' })).getByRole('button', { name: 'shot1.mp4' }))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_add', params: { timeline: 't1', asset: 'shot1.mp4', track: 0, start_sec: 8 } })
    // Escape closes a picker that a menu opened and leaves focus on the editor.
    fireEvent.contextMenu(lane(1), { clientX: 400 })
    choose('在这里添加视频')
    fireEvent.keyDown(view.getByRole('dialog', { name: '选一个素材放到 00:10.00' }), { key: 'Escape' })
    expect([view.queryByRole('dialog'), document.activeElement]).toEqual([null, view.getByTestId('dv-timeline-editor')])
    fireEvent.contextMenu(lane(1), { clientX: 400 })
    choose('添加视频轨')
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.track_add', params: { timeline: 't1', kind: 'video' } })
    await idle()
    fireEvent.contextMenu(lane(1), { clientX: 400 })
    choose('添加音轨')
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.track_add', params: { kind: 'sound' } })
  })

  it('shows a timeline whose 视频 1 is empty, names a clip whose asset the state lacks by its asset ID, and marks a stale one', async () => {
    const routes: ScriptedRoutes = {
      state: () => {
        const state = trackState()
        const [t1] = state.components.timeline.timelines
        if (t1 !== undefined) t1.clips = t1.clips.filter(clip => clip.track !== 0)
        // shot2.mp4 comes from the stale render g2.
        return withClip(withClip(state, 'cl7', 'gone.mp4', 9, 1), 'cl8', 'shot2.mp4', 20, 1)
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
    expect(within(lane(1)).getByRole('listitem', { name: '视频 2 的片段：gone.mp4' })).toBeTruthy()
    expect(within(lane(1)).getByRole('listitem', { name: '视频 2 的片段：shot2.mp4 · 过期' })).toBe(block('cl8'))
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
