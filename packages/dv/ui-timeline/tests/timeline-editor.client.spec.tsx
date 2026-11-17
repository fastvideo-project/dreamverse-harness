// @vitest-environment jsdom
/** The timeline editor over a scripted API: timeline tabs, the track, and each gesture as a record that names its timeline or clip. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { AssetId, RecordId } from '@dv/project/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import { DvClient } from '@dv/ui-kit/api.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { asset, fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState, ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { FALLBACK_CLIP_SECONDS } from '@dv/ui-kit/timeline.ts'
import { placeClips } from '../src/client/timelines.ts'
import { copyFor } from '../src/client/TimelineView.tsx'
import { bootTimeline, centerView } from './center.client.tsx'
import type { BootedTimeline } from './center.client.tsx'

let booted: BootedTimeline

beforeEach(async () => {
  document.documentElement.lang = 'zh-CN'
  booted = await bootTimeline()
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await booted.fiber.dispose() })

const selected = (): string | undefined => booted.stand.getSnapshot().fields['timeline']

const shownTabs = (view: { getAllByRole: (role: string) => HTMLElement[] }): Array<string | null> =>
  view.getAllByRole('tab').map(tab => tab.getAttribute('aria-selected'))

/** The shared fixture with a second timeline holding one imported clip. */
function twoTimelines(): FixtureState {
  const state = fixtureState()
  state.assets.push(asset('imported.mp4', 'video/mp4', null, 3))
  state.components.timeline.timelines.push({ id: 't2' as TimelineId, name: '片尾', sounds: [], sound_track_names: [], muted_sound_tracks: [], muted_video_tracks: [], track_order: ['video', 'sound'], clips: [{ id: 'cl3' as ClipId, asset: 'imported.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 0, track: 0 }] })
  return state
}

function mount(routes: ScriptedRoutes = { state: twoTimelines }) {
  const { fetch, writes } = scriptedFetch(routes)
  const view = render(centerView(booted, { client: new DvClient(fetch) }))
  // The fixture's clips cl1 and cl2 play one after the other on the one video track.
  const clip = (position: number): HTMLElement => {
    const element = view.container.querySelector(`[data-clip="cl${String(position)}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no clip ${String(position)}`)
    return element
  }
  const requests = (): Array<Record<string, unknown>> => writes.filter(write => write.path === '/api/dv/operation').map(write => write.body as Record<string, unknown>)
  return { view, writes, clip, requests, track: () => view.findByRole('list', { name: '视频轨道' }) }
}

describe('TimelineView', () => {
  it('shows one tab per timeline and lays the clips out by their in and out points', async () => {
    const { view, clip, track } = mount()
    await track()
    expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['时间线 1', '片尾'])
    expect(clip(1).style.width).toBe('160px')
    expect(clip(2).style.width).toBe('120px')
    expect(clip(2).getAttribute('data-clip-stale')).toBe('true')
    expect(clip(2).getAttribute('data-clip')).toBe('cl2')
    expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:00.00 / 00:07.00')
    expect(shownTabs(view)).toEqual(['true', 'false'])
    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    expect(view.container.querySelectorAll('[data-clip]')).toHaveLength(1)
  })

  it('offers 仍然保留 for a selected stale clip, which accepts the record behind its asset', async () => {
    const { view, clip, writes, track } = mount()
    await track()
    fireEvent.pointerDown(clip(1), { clientX: 0 })
    fireEvent.pointerUp(clip(1), { clientX: 0 })
    expect(view.queryByRole('button', { name: '仍然保留' })).toBeNull()
    fireEvent.pointerDown(clip(2), { clientX: 0 })
    fireEvent.pointerUp(clip(2), { clientX: 0 })
    fireEvent.click(view.getByRole('button', { name: '仍然保留' }))
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/stale/accept')).toBe(true) })
    expect(writes.find(write => write.path === '/api/dv/stale/accept')?.body).toEqual({ project: 'p1', record: 'g2', surface: 'timeline' })
  })

  it('writes remove, split, move, trim, create, and add as timeline records of the shown timeline', async () => {
    const { view, clip, requests, track } = mount()
    await track()
    fireEvent.pointerDown(clip(2), { clientX: 0 })
    fireEvent.pointerUp(clip(2), { clientX: 0 })
    await waitFor(() => { expect(clip(2).getAttribute('aria-pressed')).toBe('true') })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ project: 'p1', surface: 'timeline', operation: 'timeline.clip_remove', params: { clip: 'cl2' } })
    // A clip operation names the clip by its clip ID alone; only an add names the timeline.
    expect(requests()[0]?.['params']).toEqual({ clip: 'cl2' })

    fireEvent.pointerDown(view.getByTestId('dv-timeline-ruler'), { clientX: 60 })
    fireEvent.pointerUp(view.getByTestId('dv-timeline-ruler'), { clientX: 60 })
    fireEvent.click(view.getByRole('button', { name: '拆分' }))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_split', params: { clip: 'cl1', at_sec: 1.5 } })

    fireEvent.pointerDown(clip(1), { clientX: 0 })
    fireEvent.pointerMove(clip(1), { clientX: 200 })
    fireEvent.pointerUp(clip(1), { clientX: 200 })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    // A drag along its track moves the clip in time: 200 px is 5 s.
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_move', params: { clip: 'cl1', start_sec: 5 }, intent: '把片段移到 视频 的 00:05.00' })
    expect(requests()[2]?.['params']).not.toHaveProperty('track')

    const start = within(clip(1)).getByLabelText('拖动裁剪 shot1.mp4 的开头')
    fireEvent.pointerDown(start, { clientX: 0 })
    fireEvent.pointerMove(start, { clientX: 40 })
    fireEvent.pointerUp(start, { clientX: 40 })
    await waitFor(() => { expect(requests()).toHaveLength(4) })
    expect(requests()[3]).toMatchObject({ operation: 'timeline.clip_trim', params: { clip: 'cl1', in_sec: 1 } })
    expect(requests()[3]?.['params']).not.toHaveProperty('out_sec')

    fireEvent.click(view.getByText('＋ 新建'))
    await waitFor(() => { expect(requests()).toHaveLength(5) })
    expect(requests()[4]).toMatchObject({ operation: 'timeline.create', params: { timeline: 't3', assets: [] }, intent: '在时间线里新建 时间线 3' })
    expect(requests()[4]?.['params']).not.toHaveProperty('name')

    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    // The ＋ of a track adds after the track's last clip: imported.mp4 ends at 3 s.
    fireEvent.click(view.getByLabelText('添加片段到 视频'))
    fireEvent.click(within(view.getByRole('dialog')).getByText('shot1.mp4'))
    await waitFor(() => { expect(requests()).toHaveLength(6) })
    expect(requests()[5]).toMatchObject({ operation: 'timeline.clip_add', params: { timeline: 't2', asset: 'shot1.mp4', track: 0, start_sec: 3 } })
  })

  it('resets the viewer and playhead when another timeline is shown, and blanks the viewer for a timeline without clips', async () => {
    const { fetch } = scriptedFetch({
      state: () => {
        const state = twoTimelines()
        state.components.timeline.timelines.push({ id: 't3' as TimelineId, name: '', sounds: [], sound_track_names: [], muted_sound_tracks: [], muted_video_tracks: [], track_order: ['video', 'sound'], clips: [] })
        return state
      },
    })
    const view = render(centerView(booted, { client: new DvClient(fetch) }))
    await view.findByRole('list', { name: '视频轨道' })
    const frames = (): HTMLVideoElement[] => [...view.getByTestId('dv-timeline-viewer').querySelectorAll('video')]
    expect(frames()[0]?.getAttribute('src')).toBe('/dv/assets/shot1.mp4')
    fireEvent.pointerDown(view.getByTestId('dv-timeline-ruler'), { clientX: 200 })
    fireEvent.pointerUp(view.getByTestId('dv-timeline-ruler'), { clientX: 200 })
    expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:05.00 / 00:07.00')

    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:00.00 / 00:03.00')
    expect(frames()[0]?.getAttribute('src')).toBe('/dv/assets/imported.mp4')

    fireEvent.click(view.getAllByRole('tab')[2] as HTMLElement)
    expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:00.00 / 00:00.00')
    expect(frames()).toEqual([])
    expect(view.getByTestId('dv-timeline-viewer-empty').textContent).toBe('这条时间线还没有片段，从素材库拖入或点 ＋ 插入')
  })

  it('skips the playhead 5 s back and forward within the timeline, by button and by J and L', async () => {
    const { view, track } = mount()
    await track()
    const time = (): string | null => view.getByTestId('dv-timeline-time').textContent
    fireEvent.click(view.getByRole('button', { name: '前进 5 秒' }))
    expect(time()).toBe('00:05.00 / 00:07.00')
    fireEvent.click(view.getByRole('button', { name: '前进 5 秒' }))
    expect(time()).toBe('00:07.00 / 00:07.00')
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'j' })
    expect(time()).toBe('00:02.00 / 00:07.00')
    fireEvent.click(view.getByRole('button', { name: '后退 5 秒' }))
    expect(time()).toBe('00:00.00 / 00:07.00')
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'ArrowRight', shiftKey: true })
    expect(time()).toBe('00:05.00 / 00:07.00')
  })

  it('cycles the playback speed and keeps it for the browser session', async () => {
    window.sessionStorage.clear()
    const { view, track } = mount()
    await track()
    const speed = view.getByTestId('dv-timeline-speed')
    expect(speed.textContent).toBe('1×')
    fireEvent.click(speed)
    expect(speed.textContent).toBe('1.5×')
    fireEvent.click(speed)
    fireEvent.click(speed)
    expect(speed.textContent).toBe('0.5×')
    expect(speed.getAttribute('aria-label')).toBe('播放速度 0.5×，点击切换')
    view.unmount()
    const again = mount()
    await again.track()
    expect(again.view.getByTestId('dv-timeline-speed').textContent).toBe('0.5×')
    window.sessionStorage.clear()
  })

  it('notes a picked timeline as the project\'s timeline center field, and shows the first timeline while the field names none or a lost one', async () => {
    const { view, track } = mount()
    await track()
    expect([selected(), shownTabs(view)]).toEqual([undefined, ['true', 'false']])
    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    expect([selected(), shownTabs(view)]).toEqual(['t2', ['false', 'true']])
    act(() => { booted.stand.note({ timeline: 't9' }) })
    expect(shownTabs(view)).toEqual(['true', 'false'])
    act(() => { booted.tab().select('p1', 't2') })
    expect(shownTabs(view)).toEqual(['true', 'false'])
  })

  it('applies a request once: its timeline is selected, and its clip selected and played from its start', async () => {
    const { fetch } = scriptedFetch({ state: twoTimelines })
    const client = new DvClient(fetch)
    booted.stand.show({ timeline: 't1', clip: 'cl2' })
    const view = render(centerView(booted, { client }))
    await view.findByRole('list', { name: '视频轨道' })
    const pressed = (): Array<string | null> => [...document.querySelectorAll('[data-clip]')].map(clip => clip.getAttribute('aria-pressed'))
    await waitFor(() => { expect(pressed()).toEqual(['false', 'true']) })
    expect(view.getByTestId('dv-timeline-time').textContent).toBe('00:04.00 / 00:07.00')
    expect([selected(), booted.stand.getSnapshot().request]).toEqual(['t1', null])
    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    view.unmount()
    const again = render(centerView(booted, { client }))
    await again.findByRole('list', { name: '视频轨道' })
    expect(shownTabs(again)).toEqual(['false', 'true'])
    act(() => { booted.stand.show({ timeline: 't2', clip: 'cl3' }) })
    await waitFor(() => { expect(pressed()).toEqual(['true']) })
    act(() => { booted.stand.show({ timeline: 't1', clip: null }) })
    expect([selected(), shownTabs(again), booted.stand.getSnapshot().request]).toEqual(['t1', ['true', 'false'], null])
    act(() => { booted.stand.show({ timeline: 7 }) })
    act(() => { booted.stand.show({ timeline: 't2', clip: 7 }) })
    expect([selected(), shownTabs(again)]).toEqual(['t1', ['true', 'false']])
  })

  it('renames a timeline by double-click and deletes it from the tab menu after a confirmation', async () => {
    const { view, requests, track } = mount()
    await track()
    fireEvent.doubleClick(view.getAllByRole('tab')[1] as HTMLElement)
    const box = within(view.getByRole('tablist')).getByRole('textbox')
    fireEvent.change(box, { target: { value: '结尾' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.rename', params: { timeline: 't2', name: '结尾' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.contextMenu(view.getAllByRole('tab')[1] as HTMLElement)
    fireEvent.click(view.getByRole('menuitem', { name: '删除时间线' }))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.delete', params: { timeline: 't2' } })
  })

  it('edits the project at once, with the chat session beside it recorded on each edit; undo and redo move the current position', async () => {
    const { fetch, writes } = scriptedFetch({ state: () => ({ ...fixtureState(), tip: 'later' }) })
    const editing = render(centerView(booted, { client: new DvClient(fetch), session: 's5' }))
    await editing.findByRole('list', { name: '视频轨道' })
    // Redo is enabled while a step lies after the current position.
    expect((editing.getByRole('button', { name: '重做' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(editing.getByRole('button', { name: '撤销' }))
    fireEvent.click(editing.getByRole('button', { name: '重做' }))
    await waitFor(() => {
      expect(writes.filter(write => write.path === '/api/dv/undo' || write.path === '/api/dv/redo')).toEqual([
        { path: '/api/dv/undo', body: { project: 'p1' } }, { path: '/api/dv/redo', body: { project: 'p1' } },
      ])
    })
    fireEvent.contextMenu(editing.getAllByRole('tab')[0] as HTMLElement)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(editing.getByRole('menuitem', { name: '删除时间线' }))
    await waitFor(() => { expect(writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({ session: 's5', operation: 'timeline.delete' }) })
  })

  it('keeps a dropped file from reaching document listeners and explains that the track takes assets only', async () => {
    const { view, requests, track } = mount()
    await track()
    const seen = vi.fn()
    document.addEventListener('drop', seen)
    fireEvent.drop(await track(), { dataTransfer: { types: ['Files'], files: [], getData: () => '' } })
    document.removeEventListener('drop', seen)
    expect(seen).not.toHaveBeenCalled()
    expect(requests()).toHaveLength(0)
    expect(view.getByRole('status').textContent).toBe('时间线只接受素材库里的素材。请先把文件导入素材库，再从素材库拖到轨道上。')
  })

  it('places a placeholder clip at its render length, marks it rendering or failed, and holds export until it is ready', async () => {
    const state = twoTimelines()
    state.components.proj.records.push(
      record({ id: 'r8', operation: 'shot.render', status: 'running', params: { duration_sec: 2 } }),
      record({ id: 'r9', operation: 'shot.render', status: 'failed', params: {} }),
    )
    const timeline = state.components.timeline.timelines[0]
    timeline?.clips.push(
      { id: 'cl8' as ClipId, asset: null, source: { record: 'r8' as RecordId, output: 0 }, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
      { id: 'cl9' as ClipId, asset: null, source: { record: 'r9' as RecordId, output: 0 }, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
    )
    const placed = placeClips(state, timeline ?? null).clips.slice(-2)
    expect(placed.map(clip => [clip.status, clip.seconds])).toEqual([['rendering', 2], ['failed', FALLBACK_CLIP_SECONDS]])
    const { fetch } = scriptedFetch({ state: () => state })
    const view = render(centerView(booted, { client: new DvClient(fetch) }))
    await view.findByRole('list', { name: '视频轨道' })
    expect(view.container.querySelector('[data-clip="cl8"]')?.getAttribute('title')).toContain('渲染中…')
    expect(view.container.querySelector('[data-clip="cl9"]')?.getAttribute('title')).toContain('渲染失败')
    expect(view.container.querySelectorAll('[data-clip="cl8"] [data-trim]')).toHaveLength(0)
    // A placeholder follows a drag as any clip does, up and down too.
    const placeholder = view.container.querySelector('[data-clip="cl8"]') as HTMLElement
    fireEvent.pointerDown(placeholder, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(placeholder, { clientX: 80, clientY: 200 })
    expect(placeholder.style.transform).toBe('translate(80px, 200px)')
    fireEvent.pointerUp(placeholder, { clientX: 80, clientY: 200 })
    expect(view.getByTestId('dv-timeline-export-waiting').textContent).toBe('还有 2 个片段没就绪，全部就绪后才能导出')
    expect((view.getByText('导出') as HTMLButtonElement).disabled).toBe(true)
    // cl8 plays from 7 s and cl9 from 9 s; the preview shows the status of the placeholder at the playhead.
    fireEvent.pointerDown(view.getByTestId('dv-timeline-ruler'), { clientX: 7.5 * 40 })
    expect(view.getByTestId('dv-timeline-viewer-placeholder').textContent).toBe('视频 上的片段：渲染中…')
    fireEvent.pointerDown(view.getByTestId('dv-timeline-ruler'), { clientX: 9.5 * 40 })
    expect(view.getByTestId('dv-timeline-viewer-placeholder').textContent).toBe('视频 上的片段：渲染失败')
  })

  it('shows English copy and default timeline names when the DSH language is English', async () => {
    document.documentElement.lang = 'en'
    const { view } = mount()
    await view.findByRole('list', { name: 'Video track' })
    expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Timeline 1', '片尾'])
    expect(view.getByRole('button', { name: 'Split' })).toBeTruthy()
  })

  it('exports the shown timeline with one timeline.export call', async () => {
    const { view, requests, track } = mount()
    await track()
    fireEvent.click(view.getByText('导出'))
    await waitFor(() => { expect(view.getByTestId('dv-timeline-exported').getAttribute('href')).toBe('/dv/assets/new.mp4') })
    expect(requests().map(body => body['operation'])).toEqual(['timeline.export'])
    expect(requests()[0]).toMatchObject({ params: { timeline: 't1' } })
  })

  it('puts the asset of an insert request on 视频 1 of the selected timeline where its last clip ends, for the chat session beside it', async () => {
    const { fetch, writes } = scriptedFetch({ state: twoTimelines })
    const view = render(centerView(booted, { client: new DvClient(fetch), session: 's5' }))
    await view.findByRole('list', { name: '视频轨道' })
    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    act(() => { booted.stand.show({ insert: 'shot1.mp4' }) })
    expect(booted.stand.getSnapshot().request).toBeNull()
    await waitFor(() => { expect(writes.filter(write => write.path === '/api/dv/operation')).toHaveLength(1) })
    expect(writes.find(write => write.path === '/api/dv/operation')?.body).toEqual({
      project: 'p1', operation: 'timeline.clip_add', params: { timeline: 't2', asset: 'shot1.mp4', track: 0, start_sec: 3 }, intent: '把片段放到视频 1 的 3 秒',
      surface: 'timeline', session: 's5',
    })
  })

  it('inserts the asset of an insert request handed before the state is read, as t1 holding the clip in a project without timelines', async () => {
    const state = fixtureState()
    state.components.timeline.timelines = []
    const { fetch, writes } = scriptedFetch({ state: () => state })
    booted.stand.show({ insert: 'shot2.mp4' })
    render(centerView(booted, { client: new DvClient(fetch) }))
    await waitFor(() => {
      expect(writes.filter(write => write.path === '/api/dv/operation').map(write => write.body)).toEqual([{
        project: 'p1', operation: 'timeline.create', params: { timeline: 't1', assets: ['shot2.mp4'] }, intent: '新建时间线', surface: 'timeline',
      }])
    })
    expect([selected(), booted.stand.getSnapshot().request]).toEqual(['t1', null])
  })
})

function withoutTimelineSlice(): WireState {
  const base = fixtureState()
  return { ...base, components: { proj: base.components.proj, canvas: base.components.canvas } }
}

describe('timeline editor gestures', () => {
  it('drops the selection when the selected clip leaves the timeline, and selects nothing for a requested clip the timeline lacks', async () => {
    let state: FixtureState = twoTimelines()
    const { fetch } = scriptedFetch({ state: () => state })
    booted.stand.show({ timeline: 't1', clip: 'gone' })
    const view = render(centerView(booted, { client: new DvClient(fetch) }))
    await view.findByRole('list', { name: '视频轨道' })
    const pressed = (): Array<string | null> => [...view.container.querySelectorAll('[data-clip]')].map(clip => clip.getAttribute('aria-pressed'))
    await waitFor(() => { expect(booted.stand.getSnapshot().request).toBeNull() })
    expect(pressed()).toEqual(['false', 'false'])
    const second = view.container.querySelector('[data-clip="cl2"]') as HTMLElement
    fireEvent.pointerDown(second, { clientX: 0 })
    fireEvent.pointerUp(second, { clientX: 0 })
    expect(pressed()).toEqual(['false', 'true'])
    state = twoTimelines()
    state.components.timeline.timelines[0]?.clips.pop()
    fireEvent.click(view.getByRole('button', { name: '撤销' }))
    await waitFor(() => { expect(pressed()).toEqual(['false']) })
    expect((view.getByRole('button', { name: '删除片段' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds a video tile dropped on a video track where it lands, refuses other media there, and keeps file and asset drags elsewhere in the editor from the page', async () => {
    const { view, requests, track } = mount()
    const list = await track()
    const assetDrag = (id: string, mime = 'video/mp4') => ({
      types: [DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE], getData: (type: string) => ({ [DV_ASSET_DRAG_TYPE]: id, [DV_ASSET_MIME_DRAG_TYPE]: mime })[type] ?? '',
    })
    const otherDrag = { types: ['text/plain'], getData: () => '' }
    expect(fireEvent.dragOver(list, { dataTransfer: assetDrag('shot2.mp4') })).toBe(false)
    expect(fireEvent.dragOver(list, { dataTransfer: otherDrag })).toBe(true)
    // The drop puts the video at the 2.5 s it lands at. jsdom has no DragEvent, so the drop is a mouse event that carries
    // the pointer position.
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 2.5 * 40 })
    Object.defineProperty(drop, 'dataTransfer', { value: assetDrag('shot2.mp4') })
    expect(fireEvent(list, drop)).toBe(false)
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.clip_add', params: { timeline: 't1', asset: 'shot2.mp4', track: 0, start_sec: 2.5 }, intent: '把片段放到 视频 的 00:02.50',
    })
    expect(fireEvent.drop(list, { dataTransfer: assetDrag('ref.png', 'image/png') })).toBe(false)
    expect(view.getByRole('status').textContent).toBe('视频轨道只接受视频。音频请拖到声音轨道上。')
    expect(requests()).toHaveLength(1)
    const editor = view.getByTestId('dv-timeline-editor')
    const viewer = view.getByTestId('dv-timeline-viewer')
    expect(fireEvent.dragEnter(editor, { dataTransfer: { types: ['Files'], getData: () => '' } })).toBe(false)
    expect(fireEvent.dragOver(editor, { dataTransfer: otherDrag })).toBe(true)
    expect(fireEvent.drop(viewer, { dataTransfer: otherDrag })).toBe(true)
    expect(fireEvent.drop(viewer, { dataTransfer: assetDrag('shot2.mp4') })).toBe(false)
    expect(requests()).toHaveLength(1)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      // A repeated refusal shows its notice for the full four seconds after the latest drop.
      fireEvent.drop(viewer, { dataTransfer: { types: ['Files'], getData: () => '' } })
      act(() => { vi.advanceTimersByTime(3500) })
      fireEvent.drop(viewer, { dataTransfer: { types: ['Files'], getData: () => '' } })
      act(() => { vi.advanceTimersByTime(3999) })
      expect(view.getByRole('status')).toBeTruthy()
      act(() => { vi.advanceTimersByTime(1) })
      expect(view.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the tab menu on Escape or a press outside it, and writes no rename or delete that the user cancels or leaves unchanged', async () => {
    const { view, requests, track } = mount()
    await track()
    const tab = (): HTMLElement => view.getAllByRole('tab')[1] as HTMLElement
    fireEvent.contextMenu(tab())
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.pointerDown(view.getByRole('menuitem', { name: '重命名' }))
    expect(view.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(tab())
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('menu')).toBeNull()

    const box = (): HTMLInputElement => within(view.getByRole('tablist')).getByRole('textbox')
    fireEvent.contextMenu(tab())
    fireEvent.click(view.getByRole('menuitem', { name: '重命名' }))
    expect(box().value).toBe('片尾')
    fireEvent.keyDown(box(), { key: 'b' })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(within(view.getByRole('tablist')).queryByRole('textbox')).toBeNull()
    fireEvent.doubleClick(tab())
    fireEvent.change(box(), { target: { value: '   ' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.doubleClick(tab())
    fireEvent.blur(box())
    expect(view.getAllByRole('tab').map(entry => entry.textContent)).toEqual(['时间线 1', '片尾'])

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.contextMenu(tab())
    fireEvent.click(view.getByRole('menuitem', { name: '删除时间线' }))
    expect(confirm).toHaveBeenCalledWith('删除「片尾」？它的片段所用的素材会保留在项目里。')
    await act(async () => { await Promise.resolve() })
    expect(requests()).toEqual([])
  })

  it('closes the asset picker with its close button, Escape, a press outside it, or ＋, and inserts nothing', async () => {
    const { view, requests, track } = mount()
    await track()
    const add = (): HTMLElement => view.getByLabelText('添加片段到 视频')
    const picker = (): HTMLElement | null => view.queryByRole('dialog')
    fireEvent.click(add())
    expect(add().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(within(picker() as HTMLElement).getByRole('button', { name: '关闭' }))
    expect(picker()).toBeNull()
    expect(document.activeElement).toBe(add())

    fireEvent.click(add())
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.pointerDown(within(picker() as HTMLElement).getByText('shot1.mp4'))
    expect(picker()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(picker()).toBeNull()
    expect(document.activeElement).toBe(add())

    fireEvent.click(add())
    fireEvent.pointerDown(document.body)
    expect(picker()).toBeNull()

    fireEvent.click(add())
    fireEvent.pointerDown(add())
    expect(picker()).not.toBeNull()
    fireEvent.click(add())
    expect(picker()).toBeNull()
    expect(add().getAttribute('aria-expanded')).toBe('false')
    await act(async () => { await Promise.resolve() })
    expect(requests()).toEqual([])
  })

  it('closes the asset picker on a press on a clip or on a surface that stops the press from propagating', async () => {
    const { view, clip, track } = mount()
    await track()
    const add = (): HTMLElement => view.getByLabelText('添加片段到 视频')
    fireEvent.click(add())
    fireEvent.pointerDown(clip(1), { clientX: 0 })
    expect(view.queryByRole('dialog')).toBeNull()

    const surface = document.body.appendChild(document.createElement('button'))
    try {
      surface.addEventListener('pointerdown', (event) => { event.stopPropagation() })
      fireEvent.click(add())
      fireEvent.pointerDown(surface)
      expect(view.queryByRole('dialog')).toBeNull()
    } finally {
      surface.remove()
    }
  })

  it('moves focus into the asset picker and closes it when focus leaves the picker and ＋', async () => {
    const { view, track } = mount()
    await track()
    const add = (): HTMLElement => view.getByLabelText('添加片段到 视频')
    const picker = (): HTMLElement | null => view.queryByRole('dialog')
    const undo = (): HTMLElement => view.getByLabelText('撤销')
    fireEvent.click(add())
    const first = within(picker() as HTMLElement).getByText('shot1.mp4')
    expect(document.activeElement).toBe(first)
    fireEvent.blur(first, { relatedTarget: view.getByTestId('dv-timeline-editor') })
    expect(picker()).not.toBeNull()
    fireEvent.blur(first, { relatedTarget: add() })
    expect(picker()).not.toBeNull()
    fireEvent.blur(add(), { relatedTarget: undo() })
    expect(picker()).toBeNull()

    fireEvent.click(add())
    fireEvent.blur(within(picker() as HTMLElement).getByText('shot1.mp4'), { relatedTarget: undo() })
    expect(picker()).toBeNull()
  })

  it('closes the asset picker on Escape after a press on its title moves focus to the editor', async () => {
    const { view, track } = mount()
    await track()
    const add = (): HTMLElement => view.getByLabelText('添加片段到 视频')
    fireEvent.click(add())
    view.getByTestId('dv-timeline-editor').focus()
    expect(view.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(add())
  })

  it('leaves Escape to the focused field outside the asset picker, and consumes the Escape it handles', async () => {
    const { view, track } = mount()
    await track()
    const add = (): HTMLElement => view.getByLabelText('添加片段到 视频')
    const picker = (): HTMLElement | null => view.queryByRole('dialog')
    const composer = document.body.appendChild(document.createElement('textarea'))
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    try {
      fireEvent.click(add())
      composer.focus()
      fireEvent.keyDown(composer, { key: 'Escape' })
      expect(picker()).not.toBeNull()
      expect(document.activeElement).toBe(composer)
      expect(outer).toHaveBeenCalledTimes(1)

      within(picker() as HTMLElement).getByText('shot1.mp4').focus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', isComposing: true })
      expect(picker()).not.toBeNull()
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
      expect(picker()).toBeNull()
      expect(document.activeElement).toBe(add())
      expect(outer).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener('keydown', outer)
      composer.remove()
    }
  })

  it('returns to the shown timeline when creating one fails, and keeps the selection when a removal or a move fails', async () => {
    const { view, clip, requests, track } = mount({ state: twoTimelines, post: () => ({ status: 500, body: { error: 'busy' } }) })
    await track()
    fireEvent.click(view.getByText('＋ 新建'))
    expect(selected()).toBe('t3')
    await waitFor(() => { expect(selected()).toBe('t1') })
    expect(view.getByRole('alert').textContent).toBe('失败：busy')
    fireEvent.pointerDown(clip(2), { clientX: 0 })
    fireEvent.pointerUp(clip(2), { clientX: 0 })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Backspace' })
    fireEvent.pointerDown(clip(1), { clientX: 0 })
    fireEvent.pointerMove(clip(1), { clientX: 200 })
    fireEvent.pointerUp(clip(1), { clientX: 200 })
    await waitFor(() => { expect(requests().map(body => body['operation'])).toEqual(['timeline.create', 'timeline.clip_remove', 'timeline.clip_move']) })
    await act(async () => { await Promise.resolve() })
    expect(clip(2).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows a created timeline once the refetched state lists it', async () => {
    let created = false
    const { view, track } = mount({
      state: () => {
        const state = twoTimelines()
        if (created) state.components.timeline.timelines.push({ id: 't3' as TimelineId, name: '', sounds: [], sound_track_names: [], muted_sound_tracks: [], muted_video_tracks: [], track_order: ['video', 'sound'], clips: [] })
        return state
      },
      post: () => { created = true; return { status: 200, body: record({ id: 'n1', operation: 'timeline.create' }) } },
    })
    await track()
    fireEvent.click(view.getByText('＋ 新建'))
    await waitFor(() => { expect(view.getAllByRole('tab').map(tab => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([['时间线 1', 'false'], ['片尾', 'false'], ['时间线 3', 'true']]) })
    expect(selected()).toBe('t3')
  })

  it('tells a project without timelines to create one, and names a created timeline after the first free ID', async () => {
    const empty = mount({ state: withoutTimelineSlice })
    await waitFor(() => { expect(empty.view.getByTestId('dv-timeline-viewer-empty').textContent).toBe('项目还没有时间线。点上方的 ＋ 新建 创建一条。') })
    expect((empty.view.getByRole('button', { name: '添加片段到 视频' }) as HTMLButtonElement).disabled).toBe(true)
    empty.view.unmount()
    const state = fixtureState()
    state.components.timeline.timelines = [{ id: 't2' as TimelineId, name: '', sounds: [], sound_track_names: [], muted_sound_tracks: [], muted_video_tracks: [], track_order: ['video', 'sound'], clips: [] }]
    const { view, requests } = mount({ state })
    await waitFor(() => { expect(view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['时间线 2']) })
    fireEvent.click(view.getByText('＋ 新建'))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.create', params: { timeline: 't3' } })
  })

  it('names a clip whose asset the state lacks by its asset ID and gives it the fallback length', async () => {
    const state = fixtureState()
    const first = state.components.timeline.timelines[0]?.clips[0]
    if (first !== undefined) first.asset = 'lost.mp4' as AssetId
    const { clip, track } = mount({ state })
    await track()
    expect(clip(1).getAttribute('aria-label')).toBe('视频 的片段：lost.mp4')
    expect(clip(1).style.width).toBe(`${String(FALLBACK_CLIP_SECONDS * 40)}px`)
  })

  it('trims a clip end without naming its unset start, and writes nothing for a handle click, a drag too short to move, or a release without a press', async () => {
    const { clip, requests, track } = mount()
    await track()
    const end = within(clip(1)).getByLabelText('拖动裁剪 shot1.mp4 的结尾')
    fireEvent.pointerDown(end, { clientX: 160 })
    fireEvent.pointerMove(end, { clientX: 120 })
    expect(clip(1).style.width).toBe('120px')
    fireEvent.pointerUp(end, { clientX: 120 })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]?.['params']).toEqual({ clip: 'cl1', out_sec: 3 })

    const start = within(clip(2)).getByLabelText('拖动裁剪 shot2.mp4 的开头')
    fireEvent.pointerDown(start, { clientX: 160 })
    fireEvent.pointerUp(start, { clientX: 160 })
    fireEvent.pointerDown(clip(1), { clientX: 0 })
    fireEvent.pointerMove(clip(1), { clientX: 2 })
    fireEvent.pointerUp(clip(1), { clientX: 2 })
    fireEvent.pointerUp(clip(2), { clientX: 0 })
    await act(async () => { await Promise.resolve() })
    expect(requests()).toHaveLength(1)
    // The 2 px drag counts as a click, which selects clip 1.
    expect([clip(1), clip(2)].map(element => element.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('splits only away from a clip edge, and removes the selected clip from the toolbar', async () => {
    const { view, clip, requests, track } = mount()
    await track()
    fireEvent.click(view.getByRole('button', { name: '拆分' }))
    fireEvent.pointerDown(clip(2), { clientX: 0 })
    fireEvent.pointerUp(clip(2), { clientX: 0 })
    fireEvent.click(view.getByRole('button', { name: '删除片段' }))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl2' } })
  })

  it('seeks while the ruler is dragged, and plays and pauses by the play button and by Space on the editor', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const { view, track } = mount()
    await track()
    const ruler = view.getByTestId('dv-timeline-ruler')
    const time = (): string | null => view.getByTestId('dv-timeline-time').textContent
    fireEvent.pointerDown(ruler, { clientX: 40 })
    fireEvent.pointerMove(ruler, { clientX: 80 })
    fireEvent.pointerUp(ruler, { clientX: 80 })
    fireEvent.pointerMove(ruler, { clientX: 120 })
    expect(time()).toBe('00:02.00 / 00:07.00')

    const playing = (): boolean => view.queryByRole('button', { name: '暂停' }) !== null
    fireEvent.click(view.getByRole('button', { name: '播放' }))
    expect(playing()).toBe(true)
    fireEvent.click(view.getByRole('button', { name: '暂停' }))
    expect(playing()).toBe(false)
    const editor = view.getByTestId('dv-timeline-editor')
    fireEvent.keyDown(editor, { key: ' ' })
    expect(playing()).toBe(true)
    fireEvent.keyDown(editor, { key: ' ' })
    expect(playing()).toBe(false)
    fireEvent.keyDown(view.getByTestId('dv-timeline-speed'), { key: ' ' })
    fireEvent.keyDown(editor, { key: 'x' })
    expect(playing()).toBe(false)
  })

  it('shows the preview frame full screen, leaves it inline when the browser refuses, and exits full screen', async () => {
    const requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')))
    const exitFullscreen = vi.fn(() => Promise.resolve())
    let fullscreen: Element | null = null
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    try {
      const { view, track } = mount()
      await track()
      const frame = view.getByTestId('dv-timeline-viewer')
      fireEvent.click(view.getByRole('button', { name: '全屏' }))
      expect(requestFullscreen.mock.contexts).toEqual([frame])
      fullscreen = frame
      fireEvent.click(view.getByRole('button', { name: '全屏' }))
      expect(exitFullscreen).toHaveBeenCalledTimes(1)
      expect(requestFullscreen).toHaveBeenCalledTimes(1)
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
      Reflect.deleteProperty(document, 'exitFullscreen')
      Reflect.deleteProperty(document, 'fullscreenElement')
    }
  })

  it('offers no asset to insert in a project without videos, and exports a timeline whose export made no file without a link', async () => {
    const state = fixtureState()
    state.assets = state.assets.filter(entry => !entry.mime.startsWith('video/'))
    const { view, requests } = mount({ state, post: () => ({ status: 200, body: record({ id: 'n1', operation: 'timeline.export' }) }) })
    fireEvent.click(await view.findByLabelText('添加片段到 视频'))
    expect(within(view.getByRole('dialog')).getByText('项目里还没有视频素材')).toBeTruthy()
    fireEvent.click(view.getByText('导出'))
    await waitFor(() => { expect((view.getByText('导出') as HTMLButtonElement).disabled).toBe(false) })
    expect(requests().map(body => body['operation'])).toEqual(['timeline.export'])
    expect(view.queryByTestId('dv-timeline-exported')).toBeNull()
  })
})

/**
 * Lay out every element as a browser would, which jsdom does not: every box spans from `top` to `bottom`, and every
 * element has the given offset height, client height and client width.
 * @param box - the box edges and sizes in pixels.
 */
function layOut(box: { top: number; bottom: number; offsetHeight: number; clientHeight: number; clientWidth: number }): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, box.top, 0, box.bottom - box.top))
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(box.offsetHeight)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(box.clientHeight)
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(box.clientWidth)
}

describe('timeline editor layout', () => {
  beforeEach(() => { window.localStorage.clear() })
  afterEach(() => { window.localStorage.clear() })

  it('resizes the track area by drag and by ArrowUp and ArrowDown within its bounds, and remembers the height for the browser', async () => {
    // The preview and the track area share 800 - 100 - 1 = 699 px, so the track area takes at most 699 - 160 = 539 px;
    // its toolbar needs 300 - 400 = -100 px, and the ruler and the first track row, which the 300 px rows hold, 26 + 6 + 56 = 88
    // px with the 14 px padding, so it takes at least 2 px; the rows under them scroll.
    layOut({ top: 100, bottom: 800, offsetHeight: 300, clientHeight: 400, clientWidth: 0 })
    const { view, track } = mount()
    await track()
    const handle = (): HTMLElement => view.getByRole('separator')
    const height = (): string | null => handle().getAttribute('aria-valuenow')
    const stored = (): string | null => window.localStorage.getItem('dv-timeline-track-height')
    fireEvent.pointerCancel(handle())
    fireEvent.pointerMove(handle(), { clientY: 0 })
    fireEvent.pointerUp(handle(), { clientY: 0 })
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect([height(), stored()]).toEqual([null, null])
    fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    expect([height(), stored()]).toEqual(['316', '316'])
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect([height(), stored()]).toEqual(['300', '300'])
    fireEvent.pointerDown(handle(), { clientY: 500 })
    fireEvent.pointerMove(handle(), { clientY: 300 })
    expect(height()).toBe('500')
    fireEvent.pointerMove(handle(), { clientY: 100 })
    fireEvent.pointerUp(handle(), { clientY: 100 })
    expect([height(), stored()]).toEqual(['539', '539'])
    fireEvent.pointerDown(handle(), { clientY: 100 })
    fireEvent.pointerMove(handle(), { clientY: 700 })
    fireEvent.pointerCancel(handle())
    expect([height(), stored()]).toEqual(['2', '2'])
    view.unmount()

    // A remembered height is clamped again in a shorter editor: 600 - 100 - 1 - 160 = 339 px at most.
    window.localStorage.setItem('dv-timeline-track-height', '539')
    vi.restoreAllMocks()
    layOut({ top: 100, bottom: 600, offsetHeight: 300, clientHeight: 400, clientWidth: 0 })
    const again = mount()
    await again.track()
    expect(again.view.getByRole('separator').getAttribute('aria-valuenow')).toBe('339')
    // Before layout, as under a hidden editor, a key press steps the height without bounds.
    vi.restoreAllMocks()
    fireEvent.keyDown(again.view.getByRole('separator'), { key: 'ArrowUp' })
    expect(again.view.getByRole('separator').getAttribute('aria-valuenow')).toBe('355')
  })

  it('fits the timeline to the track width while the panel resizes, until the user picks a zoom, and labels the ruler every 10 s at the narrowest zoom', async () => {
    const resizes: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resizes.push(callback) }
      observe(): void {}
      disconnect(): void {}
    })
    // 1000 px of track width less the 144 px header and 60 px of room fits the 7 s timeline at 796 / 7 ≈ 114 px per second.
    layOut({ top: 0, bottom: 0, offsetHeight: 0, clientHeight: 0, clientWidth: 1000 })
    const { view, clip, track } = mount()
    await track()
    expect(clip(1).style.width).toBe(`${String(4 * 114)}px`)
    fireEvent.change(view.getByRole('slider'), { target: { value: '5' } })
    expect(clip(1).style.width).toBe('20px')
    // At 5 px per second the 200 px lane spans 40 s: a tick every 5 s and a label every 10 s.
    const marks = [...view.getByTestId('dv-timeline-ruler').children]
    expect(marks.filter(mark => mark.textContent === '')).toHaveLength(9)
    expect(marks.map(mark => mark.textContent).filter(text => text !== '')).toEqual(['00:00', '00:10', '00:20', '00:30', '00:40'])
    const width = vi.spyOn(Element.prototype, 'clientWidth', 'get')
    width.mockReturnValue(700)
    act(() => { for (const resize of resizes) resize() })
    expect(clip(1).style.width).toBe('20px')
    // 700 - 144 - 60 = 496 px fits the timeline at 496 / 7 ≈ 71 px per second.
    fireEvent.click(view.getByRole('button', { name: '适配' }))
    expect(clip(1).style.width).toBe(`${String(4 * 71)}px`)
    width.mockReturnValue(1000)
    act(() => { for (const resize of resizes) resize() })
    expect(clip(1).style.width).toBe(`${String(4 * 114)}px`)
  })
})

describe('the tab body\'s timeline selection', () => {
  it('selects per project, clears a selection, and publishes nothing for a selection that stays', () => {
    const { hooks, select } = booted.tab()
    const notified = vi.fn()
    const unsubscribe = hooks.selection.subscribe(notified)
    select('p1', 't2')
    select('p2', 't1')
    select('p2', 't1')
    expect(hooks.selection.getSnapshot()).toEqual({ p1: 't2', p2: 't1' })
    select('p1', null)
    unsubscribe()
    expect([hooks.selection.getSnapshot(), notified.mock.calls.length]).toEqual([{ p2: 't1' }, 3])
  })
})

describe('TimelineView copy and failures', () => {
  it('keeps a placeholder that a translation receives no value for', () => {
    expect(copyFor('en')('tabs.defaultTitle')).toBe('Timeline {n}')
    expect(copyFor('zh')('tabs.defaultTitle', { n: 2 })).toBe('时间线 2')
  })

  it('shows a failed state read as an alert', async () => {
    const { fetch } = scriptedFetch()
    const failing: typeof fetch = (input, init) => input === '/api/dv/state?project=p1'
      ? Promise.resolve(new Response(JSON.stringify({ error: 'no state' }), { status: 500 }))
      : fetch(input, init)
    const view = render(centerView(booted, { client: new DvClient(failing) }))
    await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('失败：no state') })
  })
})
