// @vitest-environment jsdom
/** The sound tracks under 原声 over a scripted API: their names, their sounds, the add-sound dialog, and each edit as a record. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { AssetId } from '@dv/project/types'
import type { Sound, SoundId, TimelineId } from '@dv/timeline/types'
import { DvClient } from '@dv/ui-kit/api.ts'
import { FALLBACK_CLIP_SECONDS } from '@dv/ui-kit/timeline.ts'
import { DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { asset, fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState, ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { timecode } from '../src/client/timelines.ts'
import { bootTimeline, centerView } from './center.client.tsx'
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
const assetDrag = (id: string, mime: string) => ({
  types: [DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE], getData: (type: string) => ({ [DV_ASSET_DRAG_TYPE]: id, [DV_ASSET_MIME_DRAG_TYPE]: mime })[type] ?? '',
})

/**
 * The shared fixture with two audio assets and two stored sound tracks on t1: track 1 (no stored name) holds theme.mp3
 * from 1 s for 2 s, and track 2, named 旁白, holds voice.wav, whose length the state does not know, from 0 s. A second
 * timeline t2 has no sounds.
 */
function soundState(): FixtureState {
  const state = fixtureState()
  state.assets.push(asset('theme.mp3', 'audio/mpeg', null, 2), asset('voice.wav', 'audio/wav', null))
  const [t1] = state.components.timeline.timelines
  if (t1 === undefined) throw new Error('no t1')
  t1.sounds = [
    { id: 'sd1' as SoundId, asset: 'theme.mp3' as AssetId, start_sec: 1, track: 0 },
    { id: 'sd2' as SoundId, asset: 'voice.wav' as AssetId, start_sec: 0, track: 1 },
  ]
  t1.sound_track_names = ['', '旁白']
  state.components.timeline.timelines.push({ id: 't2' as TimelineId, name: '片尾', sounds: [], sound_track_names: [], video_muted: false, muted_sound_tracks: [], clips: [] })
  return state
}

/**
 * {@link soundState} with no timelines.
 * @returns the state.
 */
function withoutTimelines(): FixtureState {
  const state = soundState()
  state.components.timeline.timelines = []
  return state
}

/**
 * {@link soundState} that gains each sound a `timeline.sound_add` writes, as `sd3`, `sd4`, …, once `shows()` is true.
 * @param shows - whether the served state shows the added sounds yet; while false, a refetch serves the state before them.
 * @returns the routes.
 */
function growingState(shows: () => boolean = () => true): ScriptedRoutes {
  const added: Sound[] = []
  return {
    state: () => {
      const state = soundState()
      state.components.timeline.timelines[0]?.sounds.push(...shows() ? added : [])
      return state
    },
    post: (path, body) => {
      if (path !== '/api/dv/operation') return { status: 200, body: { problems: [] } }
      const { operation, params = {} } = body as { operation: string; params?: Record<string, unknown> }
      if (operation === 'timeline.sound_add') {
        added.push({
          id: `sd${String(added.length + 3)}` as SoundId, asset: String(params['asset']) as AssetId, start_sec: Number(params['start_sec']),
          track: Number(params['track']),
        })
      }
      return { status: 200, body: record({ id: `new-${String(added.length)}`, operation, params }) }
    },
  }
}

function mount(routes: ScriptedRoutes = { state: soundState }) {
  const scripted = scriptedFetch(routes)
  const imports: Array<Record<string, string>> = []
  let stateFetches = 0
  // The scripted fetch reads JSON bodies; an upload sends the file itself, so the import route answers here.
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host')
    if (url.pathname === '/api/dv/state') stateFetches += 1
    if (url.pathname !== '/api/dv/assets/import') return scripted.fetch(input, init)
    imports.push(Object.fromEntries(url.searchParams))
    const body = JSON.stringify({ asset: 'upload.mp3', record: record({ id: 'u9' }) })
    return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }))
  }
  const view = render(centerView(booted, { client: new DvClient(fetchImpl) }))
  const lane = (track: number): HTMLElement => {
    const element = view.container.querySelector(`[data-sound-track="${String(track)}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no sound track ${String(track)}`)
    return element
  }
  const head = (track: number): HTMLElement => {
    const element = view.container.querySelector(`[data-sound-track-head="${String(track)}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no sound track head ${String(track)}`)
    return element
  }
  const sound = (id: string): HTMLElement => {
    const element = view.container.querySelector(`div[data-sound="${id}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no sound ${id}`)
    return element
  }
  const lanes = (): number => view.container.querySelectorAll('[data-sound-track]').length
  const heads = (): Array<string | null> => [...view.container.querySelectorAll('[data-sound-track-head]')].map(entry => entry.textContent)
  const plus = (track: number, label = '添加声音'): HTMLElement => within(lane(track)).getByRole('button', { name: label })
  const dialog = (): HTMLElement | null => view.queryByRole('dialog', { name: '添加声音' })
  const requests = (): Array<Record<string, unknown>> =>
    scripted.writes.filter(write => write.path === '/api/dv/operation').map(write => write.body as Record<string, unknown>)
  const ready = async (): Promise<void> => { await view.findByRole('list', { name: '视频轨道' }) }
  const fetches = (): number => stateFetches
  const disabled = (): boolean[] => within(view.getByTestId('dv-timeline-editor')).getAllByRole('button', { name: '添加声音' })
    .map(button => (button as HTMLButtonElement).disabled)
  const addTrack = (): HTMLButtonElement => view.getByRole('button', { name: '添加音轨' }) as HTMLButtonElement
  return { view, lane, head, sound, lanes, heads, plus, dialog, requests, imports, ready, fetches, disabled, addTrack }
}

describe('sound tracks', () => {
  // A track added with 添加音轨 is empty and belongs to the shown timeline; another timeline shows its own tracks.
  it('draws each track under 原声 by its stored or numbered name, with its sounds at their start and length', async () => {
    const { view, lane, sound, lanes, heads, ready } = mount()
    await ready()
    expect(heads()).toEqual(['声音 1', '旁白'])
    expect(lane(0).getAttribute('aria-label')).toBe('声音 1')
    expect(within(lane(0)).getByText('theme.mp3')).toBeTruthy()
    expect([sound('sd1').style.left, sound('sd1').style.width]).toEqual(['40px', '80px'])
    expect(sound('sd1').title).toBe('声音：theme.mp3')
    expect(within(lane(1)).getByText('voice.wav')).toBeTruthy()
    expect(sound('sd2').style.width).toBe(`${String(FALLBACK_CLIP_SECONDS * 40)}px`)
    const audio = view.container.querySelector('audio[data-sound="sd1"]')
    expect(audio?.getAttribute('src')).toBe('/dv/assets/theme.mp3')
    // The preview reads only each file's length until it plays.
    expect(audio?.getAttribute('preload')).toBe('metadata')
    expect(view.getByTestId('dv-timeline-export-no-sounds').textContent).toBe('导出暂不包含声音')

    fireEvent.click(view.getByRole('button', { name: '添加音轨' }))
    expect(lanes()).toBe(3)
    expect(heads()).toEqual(['声音 1', '旁白', '声音 3'])
    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    expect(heads()).toEqual(['声音 1'])
    expect(view.container.querySelectorAll('div[data-sound]')).toHaveLength(0)
    expect(view.queryByTestId('dv-timeline-export-no-sounds')).toBeNull()
  })

  it('gives a sound of unknown asset length the length its audio element measures, once that is a positive number', async () => {
    const { view, sound, ready } = mount()
    await ready()
    const audio = view.container.querySelector('audio[data-sound="sd2"]')
    if (!(audio instanceof HTMLAudioElement)) throw new Error('no audio for sd2')
    const fallback = `${String(FALLBACK_CLIP_SECONDS * 40)}px`
    for (const duration of [Number.NaN, 0]) {
      Object.defineProperty(audio, 'duration', { configurable: true, value: duration })
      fireEvent.loadedMetadata(audio)
      expect(sound('sd2').style.width).toBe(fallback)
    }
    Object.defineProperty(audio, 'duration', { configurable: true, value: 3 })
    fireEvent.loadedMetadata(audio)
    expect(sound('sd2').style.width).toBe('120px')
  })

  it('adds a project audio asset after the last sound of its track, or at the playhead on an empty track', async () => {
    const { view, sound, plus, dialog, requests, ready, disabled } = mount(growingState())
    await ready()
    fireEvent.click(plus(0))
    expect([plus(0), plus(1)].map(button => button.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
    const shown = dialog() as HTMLElement
    expect(within(shown).getByText('从 00:03.00 开始')).toBeTruthy()
    expect(document.activeElement).toBe(within(shown).getByRole('button', { name: '上传本地音频' }))
    fireEvent.click(within(shown).getByText('theme.mp3'))
    expect(dialog()).toBeNull()
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.sound_add', params: { timeline: 't1', asset: 'theme.mp3', start_sec: 3, track: 0 }, intent: '在 00:03.00 添加声音',
    })
    // Once the refreshed state shows the new sound, the next sound on its track starts after it.
    await waitFor(() => { expect(disabled()).toEqual([false, false]) })
    expect(sound('sd3').style.left).toBe('120px')
    fireEvent.click(plus(0))
    expect(within(dialog() as HTMLElement).getByText('从 00:05.00 开始')).toBeTruthy()
    fireEvent.click(plus(0))

    fireEvent.click(view.getByRole('button', { name: '添加音轨' }))
    fireEvent.pointerDown(view.getByTestId('dv-timeline-ruler'), { clientX: 60 })
    fireEvent.pointerUp(view.getByTestId('dv-timeline-ruler'), { clientX: 60 })
    fireEvent.click(plus(2))
    expect(within(dialog() as HTMLElement).getByText('从 00:01.50 开始')).toBeTruthy()
    fireEvent.click(within(dialog() as HTMLElement).getByText('voice.wav'))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({
      operation: 'timeline.sound_add', params: { timeline: 't1', asset: 'voice.wav', start_sec: 1.5, track: 2 },
    })
  })

  it('adds an audio tile dropped on a sound track where it lands, adds no second sound while the first add runs, and refuses other assets there and audio on the video track', async () => {
    const { view, lane, requests, ready } = mount()
    await ready()
    // jsdom has no DragEvent, so the drop is a mouse event that carries the pointer position.
    const dropAt = (target: HTMLElement, id: string, mime: string, clientX: number): boolean => {
      const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX })
      Object.defineProperty(drop, 'dataTransfer', { value: assetDrag(id, mime) })
      return fireEvent(target, drop)
    }
    expect(fireEvent.dragOver(lane(1), { dataTransfer: assetDrag('theme.mp3', 'audio/mpeg') })).toBe(false)
    expect(fireEvent.dragOver(lane(1), { dataTransfer: { types: ['text/plain'], getData: () => '' } })).toBe(true)
    expect(fireEvent.drop(lane(1), { dataTransfer: { types: ['text/plain'], getData: () => '' } })).toBe(true)
    // At 40 px a second, a drop 100 px into the track lands at 2.5 s, over voice.wav, which the new sound overlaps.
    expect(dropAt(lane(1), 'theme.mp3', 'audio/mpeg', 100)).toBe(false)
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.sound_add', params: { timeline: 't1', asset: 'theme.mp3', start_sec: 2.5, track: 1 }, intent: '在 00:02.50 添加声音',
    })

    // The fixture state never shows the added sound, so the add stays running.
    expect(dropAt(lane(0), 'voice.wav', 'audio/wav', 40)).toBe(false)
    expect(dropAt(lane(0), 'shot2.mp4', 'video/mp4', 40)).toBe(false)
    expect(view.getByRole('status').textContent).toBe('声音轨道只接受音频。')
    expect(dropAt(view.getByRole('list', { name: '视频轨道' }), 'voice.wav', 'audio/wav', 40)).toBe(false)
    expect(view.getByRole('status').textContent).toBe('视频轨道只接受视频。音频请拖到声音轨道上。')
    expect(requests()).toHaveLength(1)
  })

  it('adds nothing for an audio tile dropped on the sound track of a project without timelines, and refuses a video tile there', async () => {
    const { view, lane, requests, ready } = mount({ state: withoutTimelines })
    await ready()
    fireEvent.drop(lane(0), { dataTransfer: assetDrag('theme.mp3', 'audio/mpeg') })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.drop(lane(0), { dataTransfer: assetDrag('shot2.mp4', 'video/mp4') })
    expect(view.getByRole('status').textContent).toBe('声音轨道只接受音频。')
    expect(requests()).toEqual([])
  })

  it('uploads a picked local file into the asset pool and adds it to the track, and adds nothing when no file is picked', async () => {
    const { view, plus, dialog, requests, imports, ready } = mount()
    await ready()
    fireEvent.click(plus(0))
    const input = view.container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input')
    expect(input.accept).toBe('audio/*')
    const opened = vi.fn()
    input.addEventListener('click', opened)
    fireEvent.click(within(dialog() as HTMLElement).getByRole('button', { name: '上传本地音频' }))
    expect(opened).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { files: [] } })
    expect(dialog()).not.toBeNull()

    fireEvent.change(input, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })
    expect(dialog()).toBeNull()
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(imports).toEqual([{ project: 'p1', name: 'song.mp3', mime: 'audio/mpeg', surface: 'asset_pool' }])
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.sound_add', params: { timeline: 't1', asset: 'upload.mp3', start_sec: 3, track: 0 }, intent: '在 00:03.00 添加声音',
    })
  })

  it('tells a project without audio that it has none, and starts the new sound at the playhead', async () => {
    const state = fixtureState()
    const { plus, dialog, ready } = mount({ state })
    await ready()
    fireEvent.click(plus(0))
    expect(within(dialog() as HTMLElement).getByText('项目里还没有音频')).toBeTruthy()
    expect(within(dialog() as HTMLElement).getByText('从 00:00.00 开始')).toBeTruthy()
  })

  it('selects a sound by click, removes it by Delete, the toolbar, or its menu, and selects one clip or sound at a time', async () => {
    const { view, sound, requests, ready } = mount()
    await ready()
    const clip = (): HTMLElement => view.container.querySelector('[data-clip-position="1"]') as HTMLElement
    fireEvent.pointerDown(clip(), { clientX: 0 })
    fireEvent.pointerUp(clip(), { clientX: 0 })
    fireEvent.click(sound('sd1'))
    expect([clip().getAttribute('aria-pressed'), sound('sd1').getAttribute('aria-pressed')]).toEqual(['false', 'true'])
    expect(document.activeElement).toBe(view.getByTestId('dv-timeline-editor'))
    fireEvent.pointerDown(clip(), { clientX: 0 })
    fireEvent.pointerUp(clip(), { clientX: 0 })
    expect([clip().getAttribute('aria-pressed'), sound('sd1').getAttribute('aria-pressed')]).toEqual(['true', 'false'])

    fireEvent.click(sound('sd1'))
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.sound_remove', params: { sound: 'sd1' }, intent: '删除声音 theme.mp3' })
    expect(requests()[0]?.['params']).toEqual({ sound: 'sd1' })
    await waitFor(() => { expect(sound('sd1').getAttribute('aria-pressed')).toBe('false') })
    expect(view.getByRole('button', { name: '删除片段' })).toBeTruthy()

    fireEvent.click(sound('sd2'))
    fireEvent.click(view.getByRole('button', { name: '删除声音' }))
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.sound_remove', params: { sound: 'sd2' } })

    fireEvent.contextMenu(sound('sd1'))
    expect(sound('sd1').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(view.getByRole('menuitem', { name: '删除' }))
    expect(view.queryByRole('menu')).toBeNull()
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.sound_remove', params: { sound: 'sd1' } })
  })

  it('keeps the sound selected when its removal fails', async () => {
    const { view, sound, requests, ready } = mount({ state: soundState, post: () => ({ status: 500, body: { error: 'busy' } }) })
    await ready()
    fireEvent.click(sound('sd1'))
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Backspace' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    await act(async () => { await Promise.resolve() })
    expect(sound('sd1').getAttribute('aria-pressed')).toBe('true')
  })

  it('renames a track by double-click or its menu, and writes nothing for an empty, unchanged, or cancelled name', async () => {
    const { view, head, heads, requests, ready } = mount()
    await ready()
    const box = (): HTMLInputElement => {
      const input = view.getByRole('textbox', { name: '音轨名称' })
      if (!(input instanceof HTMLInputElement)) throw new Error('no track name box')
      return input
    }
    const editing = (): boolean => view.queryByRole('textbox', { name: '音轨名称' }) !== null
    fireEvent.doubleClick(head(0))
    expect(box().value).toBe('声音 1')
    fireEvent.keyDown(box(), { key: 'Delete' })
    expect(editing()).toBe(true)
    fireEvent.change(box(), { target: { value: ' 对白 ' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(editing()).toBe(false)
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.sound_track_rename', params: { timeline: 't1', track: 0, name: '对白' }, intent: '把音轨重命名为 对白',
    })

    fireEvent.contextMenu(head(1))
    fireEvent.click(view.getByRole('menuitem', { name: '重命名' }))
    expect(view.queryByRole('menu')).toBeNull()
    expect(box().value).toBe('旁白')
    fireEvent.blur(box())
    fireEvent.doubleClick(head(1))
    fireEvent.change(box(), { target: { value: '  ' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.doubleClick(head(0))
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(editing()).toBe(false)
    await act(async () => { await Promise.resolve() })
    expect(requests()).toHaveLength(1)
    expect(heads()).toEqual(['声音 1', '旁白'])
  })

  it('deletes a stored track through timeline.sound_track_remove, and an empty track added in this view without a write', async () => {
    const { view, head, lanes, requests, ready, addTrack } = mount()
    await ready()
    expect(addTrack().disabled).toBe(false)
    fireEvent.click(addTrack())
    expect(lanes()).toBe(3)
    // One empty track at a time: the operations accept a track up to the one after the last stored track.
    expect(addTrack().disabled).toBe(true)
    fireEvent.click(addTrack())
    expect(lanes()).toBe(3)
    fireEvent.contextMenu(head(2))
    fireEvent.click(view.getByRole('menuitem', { name: '删除音轨' }))
    expect(lanes()).toBe(2)
    expect(addTrack().disabled).toBe(false)
    await act(async () => { await Promise.resolve() })
    expect(requests()).toEqual([])

    fireEvent.contextMenu(head(1))
    fireEvent.click(view.getByRole('menuitem', { name: '删除音轨' }))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({
      operation: 'timeline.sound_track_remove', params: { timeline: 't1', track: 1 }, intent: '删除音轨 2',
    })
  })

  it('deletes the first track of a timeline that stores no track without a write, and offers 添加音轨 again after it', async () => {
    const { view, head, heads, requests, ready, addTrack } = mount()
    await ready()
    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    expect([heads(), addTrack().disabled]).toEqual([['声音 1'], false])
    fireEvent.click(addTrack())
    expect([heads(), addTrack().disabled]).toEqual([['声音 1', '声音 2'], true])
    for (const track of [1, 0]) {
      fireEvent.contextMenu(head(track))
      fireEvent.click(view.getByRole('menuitem', { name: '删除音轨' }))
    }
    // The view always shows one track.
    expect([heads(), addTrack().disabled]).toEqual([['声音 1'], false])
    await act(async () => { await Promise.resolve() })
    expect(requests()).toEqual([])
  })

  it('writes timeline.mute from the video header and from a sound track header, and plays muted audio silent', async () => {
    // The served state applies each timeline.mute the editor writes.
    const muted = { video: false, tracks: [] as number[] }
    const routes: ScriptedRoutes = {
      state: () => {
        const state = soundState()
        const [t1] = state.components.timeline.timelines
        if (t1 !== undefined) Object.assign(t1, { video_muted: muted.video, muted_sound_tracks: [...muted.tracks] })
        return state
      },
      post: (_path, body) => {
        const { operation, params = {} } = body as { operation: string; params?: Record<string, unknown> }
        const on = params['muted'] === true
        if (params['target'] === 'video') muted.video = on
        else muted.tracks = [...muted.tracks.filter(track => track !== params['track']), ...on ? [Number(params['track'])] : []]
        return { status: 200, body: record({ id: 'm1', operation, params }) }
      },
    }
    const { view, head, sound, requests, ready } = mount(routes)
    await ready()
    const videos = [...view.getByTestId('dv-timeline-viewer').querySelectorAll('video')]
    const audio = (id: string): HTMLAudioElement => view.container.querySelector(`audio[data-sound="${id}"]`) as HTMLAudioElement
    const pressed = (button: HTMLElement): string | null => button.getAttribute('aria-pressed')
    const videoMute = (): HTMLElement => view.getByRole('button', { name: '静音 视频' })
    const trackMute = (): HTMLElement => within(head(1)).getByRole('button', { name: '静音 旁白' })
    expect([pressed(videoMute()), videos.map(video => video.muted)]).toEqual(['false', [false, false]])

    fireEvent.click(videoMute())
    await waitFor(() => { expect([pressed(videoMute()), videos.map(video => video.muted)]).toEqual(['true', [true, true]]) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.mute', params: { timeline: 't1', target: 'video', muted: true }, intent: '把视频原声静音' })

    fireEvent.click(trackMute())
    await waitFor(() => { expect([pressed(trackMute()), audio('sd1').muted, audio('sd2').muted]).toEqual(['true', false, true]) })
    expect(requests()[1]).toMatchObject({ params: { timeline: 't1', target: 'sound', track: 1, muted: true }, intent: '把 旁白 静音' })
    expect([sound('sd1').style.opacity, sound('sd2').style.opacity]).toEqual(['', '0.45'])
    // A double click on the button does not open the track's rename box.
    fireEvent.doubleClick(trackMute())
    expect(view.queryByRole('textbox', { name: '音轨名称' })).toBeNull()

    // Another timeline has its own mutes.
    fireEvent.click(view.getAllByRole('tab')[1] as HTMLElement)
    expect(videos.map(video => video.muted)).toEqual([false, false])
    fireEvent.click(view.getAllByRole('tab')[0] as HTMLElement)

    fireEvent.click(trackMute())
    await waitFor(() => { expect(audio('sd2').muted).toBe(false) })
    fireEvent.click(videoMute())
    await waitFor(() => { expect(videos.map(video => video.muted)).toEqual([false, false]) })
    expect(requests().slice(2).map(each => each['intent'])).toEqual(['取消 旁白 的静音', '取消视频原声的静音'])
  })

  it('shows a track that only a mute stores, deletes a track from its header, and disables the speakers without a timeline', async () => {
    const mutedThird = (): FixtureState => {
      const state = soundState()
      const [t1] = state.components.timeline.timelines
      if (t1 !== undefined) t1.muted_sound_tracks = [2]
      return state
    }
    const { head, heads, requests, ready } = mount({ state: mutedThird })
    await ready()
    expect(heads()).toEqual(['声音 1', '旁白', '声音 3'])
    expect(within(head(2)).getByRole('button', { name: '静音 声音 3' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(head(1)).getByRole('button', { name: '删除音轨 旁白' }))
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.sound_track_remove', params: { timeline: 't1', track: 1 } })
    cleanup()

    const empty = mount({ state: withoutTimelines })
    await empty.ready()
    const speakers = [empty.view.getByRole('button', { name: '静音 视频' }), within(empty.head(0)).getByRole('button', { name: '静音 声音 1' })]
    expect(speakers.map(button => (button as HTMLButtonElement).disabled)).toEqual([true, true])
  })

  it('keeps the typed track name on a double-click inside the name box, and leaves its right-click to the text menu', async () => {
    const { view, head, ready } = mount()
    await ready()
    fireEvent.doubleClick(head(1))
    const box = view.getByRole('textbox', { name: '音轨名称' }) as HTMLInputElement
    fireEvent.change(box, { target: { value: '对白' } })
    fireEvent.doubleClick(box)
    expect(box.value).toBe('对白')
    // The track menu does not open, and the browser's own menu is not prevented.
    expect(fireEvent.contextMenu(box)).toBe(true)
    expect(view.queryByRole('menu')).toBeNull()
    expect(view.getByRole('textbox', { name: '音轨名称' })).toBe(box)
  })

  it('selects a clip that another view focuses or that a finished move placed, instead of a selected sound, so Delete removes the clip', async () => {
    const { view, sound, requests, ready } = mount()
    await ready()
    const clip = (position: number): HTMLElement => view.container.querySelector(`[data-clip-position="${String(position)}"]`) as HTMLElement
    fireEvent.click(sound('sd1'))
    act(() => { booted.stand.show({ timeline: 't1', clip: 'cl2' }) })
    expect([clip(2).getAttribute('aria-pressed'), sound('sd1').getAttribute('aria-pressed')]).toEqual(['true', 'false'])
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    expect(requests()[0]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl2' } })

    // A sound picked while the move runs gives way to the moved clip once the move is done.
    fireEvent.pointerDown(clip(1), { clientX: 0 })
    fireEvent.pointerMove(clip(1), { clientX: 200 })
    fireEvent.pointerUp(clip(1), { clientX: 200 })
    fireEvent.click(sound('sd1'))
    expect(sound('sd1').getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => { expect(requests()).toHaveLength(2) })
    expect(requests()[1]).toMatchObject({ operation: 'timeline.clip_move', params: { clip: 'cl1', to: 2 } })
    await waitFor(() => { expect(sound('sd1').getAttribute('aria-pressed')).toBe('false') })
    fireEvent.keyDown(view.getByTestId('dv-timeline-editor'), { key: 'Delete' })
    await waitFor(() => { expect(requests()).toHaveLength(3) })
    expect(requests()[2]).toMatchObject({ operation: 'timeline.clip_remove', params: { clip: 'cl1' } })
  })

  it('disables every sound track ＋ while a sound add runs and until the refreshed state shows its sound', async () => {
    let shown = false
    const { view, head, plus, dialog, requests, ready, fetches, disabled } = mount(growingState(() => shown))
    await ready()
    expect(disabled()).toEqual([false, false])
    fireEvent.click(plus(1))
    fireEvent.click(within(dialog() as HTMLElement).getByText('theme.mp3'))
    expect(disabled()).toEqual([true, true])
    await waitFor(() => { expect(requests()).toHaveLength(1) })
    // A refreshed state that does not show the sound yet keeps them disabled.
    await waitFor(() => { expect(fetches()).toBeGreaterThanOrEqual(2) })
    await act(async () => { await Promise.resolve() })
    expect(disabled()).toEqual([true, true])
    shown = true
    fireEvent.doubleClick(head(0))
    fireEvent.change(view.getByRole('textbox', { name: '音轨名称' }), { target: { value: '音乐' } })
    fireEvent.keyDown(view.getByRole('textbox', { name: '音轨名称' }), { key: 'Enter' })
    await waitFor(() => { expect(disabled()).toEqual([false, false]) })
    expect(view.container.querySelector('div[data-sound="sd3"]')).not.toBeNull()
  })

  it('enables the sound track ＋ again after a sound add from the project or an upload fails', async () => {
    const { view, plus, dialog, requests, imports, ready, disabled } = mount({ state: soundState, post: () => ({ status: 500, body: { error: 'busy' } }) })
    await ready()
    fireEvent.click(plus(0))
    fireEvent.click(within(dialog() as HTMLElement).getByText('theme.mp3'))
    expect(disabled()).toEqual([true, true])
    await waitFor(() => { expect(disabled()).toEqual([false, false]) })
    expect(requests()).toHaveLength(1)

    fireEvent.click(plus(0))
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })
    expect(disabled()).toEqual([true, true])
    await waitFor(() => { expect(disabled()).toEqual([false, false]) })
    expect([imports.length, requests().length]).toEqual([1, 2])
  })

  it('closes the sound and track menu on Escape or a press outside it', async () => {
    const { view, sound, ready } = mount()
    await ready()
    const menu = (): HTMLElement | null => view.queryByRole('menu')
    fireEvent.contextMenu(sound('sd1'))
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.pointerDown(view.getByRole('menuitem', { name: '删除' }))
    expect(menu()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(menu()).toBeNull()
    fireEvent.contextMenu(sound('sd1'))
    fireEvent.pointerDown(document.body)
    expect(menu()).toBeNull()
    fireEvent.contextMenu(sound('sd1'))
    fireEvent.pointerDown(window)
    expect(menu()).toBeNull()
  })

  it('closes the add-sound dialog with its close button, Escape, a press outside it, or its ＋, and adds nothing', async () => {
    const { plus, dialog, requests, ready } = mount()
    await ready()
    fireEvent.click(plus(0))
    fireEvent.click(within(dialog() as HTMLElement).getByRole('button', { name: '关闭' }))
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(plus(0))

    fireEvent.click(plus(1))
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.pointerDown(within(dialog() as HTMLElement).getByText('theme.mp3'))
    expect(dialog()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(plus(1))

    fireEvent.click(plus(0))
    fireEvent.pointerDown(document.body)
    expect(dialog()).toBeNull()

    fireEvent.click(plus(0))
    fireEvent.pointerDown(plus(0))
    expect(dialog()).not.toBeNull()
    fireEvent.click(plus(0))
    expect(dialog()).toBeNull()
    expect(plus(0).getAttribute('aria-expanded')).toBe('false')
    await act(async () => { await Promise.resolve() })
    expect(requests()).toEqual([])
  })

  it('moves the add-sound dialog to another track\'s ＋, and shows one of the add-sound dialog and the asset picker at a time', async () => {
    const { view, plus, dialog, ready } = mount()
    await ready()
    fireEvent.click(plus(0))
    fireEvent.click(plus(1))
    expect([plus(0), plus(1)].map(button => button.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
    expect(within(dialog() as HTMLElement).getByText(`从 ${timecode(FALLBACK_CLIP_SECONDS)} 开始`)).toBeTruthy()
    fireEvent.click(view.getByLabelText('插入片段'))
    expect(dialog()).toBeNull()
    expect(view.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(plus(0))
    expect(view.getAllByRole('dialog')).toEqual([dialog()])
  })

  it('closes the add-sound dialog when focus leaves it and its ＋', async () => {
    const { view, plus, dialog, ready } = mount()
    await ready()
    fireEvent.click(plus(0))
    const upload = (): HTMLElement => within(dialog() as HTMLElement).getByRole('button', { name: '上传本地音频' })
    fireEvent.blur(upload(), { relatedTarget: null })
    fireEvent.blur(upload(), { relatedTarget: view.getByTestId('dv-timeline-editor') })
    fireEvent.blur(upload(), { relatedTarget: plus(0) })
    expect(dialog()).not.toBeNull()
    fireEvent.blur(upload(), { relatedTarget: view.getByLabelText('撤销') })
    expect(dialog()).toBeNull()
  })

  it('leaves Escape to a focused field outside the add-sound dialog, and closes it on Escape from the editor or inside it', async () => {
    const { view, plus, dialog, ready } = mount()
    await ready()
    const composer = document.body.appendChild(document.createElement('textarea'))
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    try {
      fireEvent.click(plus(0))
      composer.focus()
      fireEvent.keyDown(composer, { key: 'Escape' })
      expect(dialog()).not.toBeNull()
      expect(outer).toHaveBeenCalledTimes(1)

      within(dialog() as HTMLElement).getByText('theme.mp3').focus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', isComposing: true })
      expect(dialog()).not.toBeNull()
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
      expect(dialog()).toBeNull()
      expect(outer).toHaveBeenCalledTimes(2)

      fireEvent.click(plus(0))
      view.getByTestId('dv-timeline-editor').focus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(plus(0))
    } finally {
      window.removeEventListener('keydown', outer)
      composer.remove()
    }
  })

  it('plays a sound from the playhead\'s time inside it while the timeline plays', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const { view, ready } = mount()
    await ready()
    const audio = view.container.querySelector('audio[data-sound="sd1"]')
    fireEvent.pointerDown(view.getByTestId('dv-timeline-ruler'), { clientX: 80 })
    fireEvent.pointerUp(view.getByTestId('dv-timeline-ruler'), { clientX: 80 })
    expect(play.mock.contexts).not.toContain(audio)
    fireEvent.click(view.getByRole('button', { name: '播放' }))
    expect(play.mock.contexts).toContain(audio)
  })

  it('shows English copy for the sound tracks when the DSH language is English', async () => {
    document.documentElement.lang = 'en'
    const { view, plus, heads } = mount()
    await view.findByRole('list', { name: 'Video track' })
    expect(heads()).toEqual(['Sound 1', '旁白'])
    expect(view.getByRole('button', { name: 'Add track' })).toBeTruthy()
    expect([view.getByRole('button', { name: 'Mute Video' }), view.getByRole('button', { name: 'Delete track Sound 1' })]).toHaveLength(2)
    expect(view.getByTestId('dv-timeline-export-no-sounds').textContent).toBe('Export does not include sounds yet')
    fireEvent.click(plus(0, 'Add sound'))
    expect(within(view.getByRole('dialog', { name: 'Add sound' })).getByText('Starts at 00:03.00')).toBeTruthy()
  })
})
