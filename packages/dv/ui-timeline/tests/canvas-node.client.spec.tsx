// @vitest-environment jsdom
/**
 * The timeline on the canvas: the real ui-timeline plugin on the real canvas over the scripted server. The add menu puts
 * a timeline on the canvas with `timeline.place`, its card holds a small timeline editor whose preview plays above the
 * selected node, selecting it outlines the nodes that its clips come from, and a double click on its caption or the
 * editor's 打开编辑器 shows the timeline in the workspace center.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { ClipId, SoundId, TimelineId } from '@dv/timeline/types'
import type { AssetId, RecordId } from '@dv/project/types'
import { zh as canvasZh } from '../../ui-canvas/src/client/locales.ts'
import { forgetCanvasStorage, mountCanvas } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import { canvasNode, record } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  forgetCanvasStorage()
})

/**
 * @param state - the served state.
 * @param id - the node and record ID.
 * @param timeline - the timeline that the record places.
 */
function placeTimeline(state: FixtureState, id: string, timeline: string): void {
  state.components.proj.records.push(record({ id, operation: 'timeline.place', params: { timeline } }))
  state.components.canvas.nodes[id] = canvasNode('timeline', [id], 900, 0)
  state.components.canvas.order.push(id)
}

/**
 * Mount the canvas with the shot kind and the ui-timeline plugin, and `dvCenter` with a recording `show`.
 * @param edit - changes to the served state.
 * @param refuse - the error the server answers a write with, by path and body; null accepts it.
 * @returns the mounted canvas and the recording `show`.
 */
async function mountTimelineCanvas(edit: (state: FixtureState) => void, refuse?: (path: string, body: unknown) => string | null) {
  const mounted = await mountCanvas({ kinds: ['takes'], edit, ...refuse === undefined ? {} : { refuse } })
  const show = vi.fn()
  mounted.runtime.ctx.provide('dvCenter', { show } as never)
  await mounted.runtime.mount({ inject: [...inject], apply })
  return { ...mounted, show }
}

/** The JSON writes of `POST /api/dv/operation`, by operation name. */
const operationsOf = (writes: ReadonlyArray<{ path: string; body: unknown }>): string[] =>
  writes.filter(write => write.path === '/api/dv/operation').map(write => (write.body as { operation: string }).operation)

describe('a timeline node on the canvas', () => {
  it('goes on the canvas from the add menu, shows the small editor with its preview above the node while selected, and outlines its clips\' nodes', async () => {
    let placed = false
    const { node, canvasOf, view, server, show } = await mountTimelineCanvas((state) => { if (placed) placeTimeline(state, 'new-1', 't1') })
    await waitFor(() => { node('g1') })
    fireEvent.click(within(canvasOf()).getByRole('button', { name: canvasZh['add.button'] }))
    const menu = view.getByTestId('dv-canvas-add-menu')
    expect(within(menu).getByRole('group', { name: zh['canvas.addSection'] })).toBeTruthy()
    placed = true
    fireEvent.click(within(menu).getByRole('menuitem', { name: '时间线 1' }))
    await waitFor(() => { expect(operationsOf(server.writes)).toEqual(['timeline.place']) })
    expect(server.writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({
      operation: 'timeline.place', params: { timeline: 't1' }, intent: 'place 时间线 1 on the canvas', surface: 'canvas',
    })
    act(() => { server.notify() })
    await waitFor(() => { expect(node('new-1').getAttribute('data-node-selected')).toBe('true') })
    expect(node('new-1').getAttribute('aria-label')).toBe('时间线 1')
    // shot1.mp4 plays 4 s and shot2.mp4 plays from 1 s to 4 s.
    expect(node('new-1').textContent).toContain('7.0s')
    expect([...canvasOf().querySelectorAll('[data-node-used="true"]')].map(card => card.getAttribute('data-node-id'))).toEqual(['g1', 'g2'])
    expect([...canvasOf().querySelectorAll('[data-node-dimmed="true"]')].map(card => card.getAttribute('data-node-id'))).toEqual(['e1'])
    expect(canvasOf().querySelector('[data-edge="g1>new-1"]')).not.toBeNull()
    const card = node('new-1').querySelector('[data-timeline-card="t1"]') as HTMLElement
    const editor = within(card).getByTestId('dv-timeline-editor')
    // The card holds the editor without its timeline tabs and with 打开编辑器 at the end of its toolbar.
    expect(within(editor).queryByRole('tablist')).toBeNull()
    expect([...editor.querySelectorAll('[data-clip]')].map(clip => clip.getAttribute('data-clip'))).toEqual(['cl1', 'cl2'])
    fireEvent.click(within(editor).getByRole('button', { name: zh['tool.openEditor'] }))
    expect(show).toHaveBeenCalledWith({ view: 'timeline', target: { timeline: 't1', clip: null } })
    // The preview plays above the node, in the area the canvas gives the selected node, at the first clip's ratio.
    const preview = node('new-1').querySelector('[data-node-above] [data-testid="dv-timeline-preview"]')
    expect(preview).not.toBeNull()
    expect(within(preview as HTMLElement).getByTestId('dv-timeline-viewer').style.aspectRatio).toBe('16 / 9')
    expect(within(preview as HTMLElement).getByRole('button', { name: zh['tool.play'] })).toBeTruthy()
    // A press on empty canvas clears the selection, and the preview goes with it.
    fireEvent.pointerDown(canvasOf(), { button: 0, clientX: 2000, clientY: 2000, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    expect(node('new-1').querySelector('[data-testid="dv-timeline-preview"]')).toBeNull()
    // The menu names the node that shows the timeline, and picking it selects the node and writes nothing more.
    fireEvent.click(within(canvasOf()).getByRole('button', { name: canvasZh['add.button'] }))
    fireEvent.click(within(view.getByTestId('dv-canvas-add-menu')).getByRole('menuitem', { name: `时间线 1${canvasZh['add.placed']}` }))
    expect(operationsOf(server.writes)).toEqual(['timeline.place'])
    expect(node('new-1').getAttribute('data-node-selected')).toBe('true')
  })

  it('selects the node on a press inside the editor without moving it, and keeps the editor\'s keys and right clicks from the canvas', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { node, canvasOf, server, show } = await mountTimelineCanvas((state) => { placeTimeline(state, 'k1', 't1') })
    await waitFor(() => { expect(node('k1').querySelector('[data-testid="dv-timeline-editor"]')).not.toBeNull() })
    const editor = node('k1').querySelector('[data-testid="dv-timeline-editor"]') as HTMLElement
    const ruler = within(editor).getByTestId('dv-timeline-ruler')
    // The track area scrolls without showing a scrollbar.
    expect(ruler.closest('[data-dv-scroll-island]')?.classList.contains('dv-tl-no-scrollbar')).toBe(true)
    // The canvas draws the editor at its zoom: half size on screen here, so a press 50 px right of the ruler's start lands
    // 100 px in, at 2.5 s with 40 px per second.
    Object.defineProperty(editor, 'offsetWidth', { configurable: true, value: 1000 })
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 500, height: 150, right: 500, bottom: 150, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 500, height: 13, right: 500, bottom: 13, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(ruler, { button: 0, clientX: 50, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(ruler, { pointerId: 1 })
    expect(node('k1').getAttribute('data-node-selected')).toBe('true')
    await waitFor(() => { expect(node('k1').querySelector('[data-testid="dv-timeline-time"]')?.textContent).toContain('00:02.50') })
    expect(server.positionWrites).toEqual([])
    // A second press inside the editor opens no editor panel and shows no timeline view.
    fireEvent.pointerDown(ruler, { button: 0, clientX: 50, clientY: 5, pointerId: 2 })
    fireEvent.pointerUp(ruler, { pointerId: 2 })
    expect([document.querySelector('[data-testid="dv-canvas-node-editor"]'), show.mock.calls.length]).toEqual([null, 0])
    // Delete on a selected clip removes the clip and leaves the node.
    const clip = editor.querySelector('[data-clip="cl1"]') as HTMLElement
    fireEvent.pointerDown(clip, { button: 0, clientX: 10, pointerId: 3 })
    fireEvent.pointerUp(clip, { clientX: 10, pointerId: 3 })
    fireEvent.keyDown(editor, { key: 'Delete' })
    await waitFor(() => { expect(operationsOf(server.writes)).toEqual(['timeline.clip_remove']) })
    expect(confirm).not.toHaveBeenCalled()
    // A right click on a sound track opens the editor's track menu inside the editor, at the press, and no node menu.
    const head = editor.querySelector('[data-sound-track-head="0"]') as HTMLElement
    fireEvent.contextMenu(head, { clientX: 40, clientY: 60 })
    const trackMenu = within(editor).getByRole('menu')
    expect([trackMenu.style.position, trackMenu.style.left, trackMenu.style.top]).toEqual(['absolute', '80px', '120px'])
    expect(canvasOf().querySelector('[data-testid="dv-canvas-node-menu"]')).toBeNull()
    // A right click on a clip opens the editor's clip menu and no node menu.
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(editor.querySelector('[data-clip="cl2"]') as HTMLElement, { clientX: 20, clientY: 20 })
    expect(within(within(editor).getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['在播放头处拆分', '删除'])
    expect(canvasOf().querySelector('[data-testid="dv-canvas-node-menu"]')).toBeNull()
    // A right click where the editor has no menu of its own, such as on the ruler, opens the node's menu, not the browser's.
    fireEvent.keyDown(window, { key: 'Escape' })
    const rulerClick = createEvent.contextMenu(ruler, { clientX: 20, clientY: 5 })
    fireEvent(ruler, rulerClick)
    expect([rulerClick.defaultPrevented, canvasOf().querySelector('[data-testid="dv-canvas-node-menu"]') !== null]).toEqual([true, true])
  })

  it('styles the preview above the node as the editor, and keeps the keys of its buttons from the canvas', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { node, canvasOf, server } = await mountTimelineCanvas((state) => { placeTimeline(state, 'k1', 't1') })
    await waitFor(() => { node('k1') })
    fireEvent.pointerDown(node('k1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    const preview = await waitFor(() => node('k1').querySelector('[data-node-above] [data-testid="dv-timeline-preview"]') as HTMLElement)
    const speed = within(preview).getByTestId('dv-timeline-speed')
    fireEvent.keyDown(speed, { key: 'Delete' })
    fireEvent.keyDown(speed, { key: 'Backspace' })
    expect(confirm).not.toHaveBeenCalled()
    expect(operationsOf(server.writes)).toEqual([])
    // The preview sits outside the editor's root, so it carries the editor's class for its button styles itself.
    expect([preview.classList.contains('dv-tl-editor'), speed.classList.contains('dv-tl-btn')]).toEqual([true, true])
  })

  it('keeps the card\'s editor on its timeline, with no control that selects or creates another, which writes nothing', async () => {
    const { node, server } = await mountTimelineCanvas((state) => {
      const [timeline] = state.components.timeline.timelines
      if (timeline === undefined) return
      state.components.timeline.timelines.push({ ...timeline, id: 't2' as TimelineId, name: '片尾', clips: [] })
      placeTimeline(state, 'k1', 't1')
    })
    await waitFor(() => { expect(node('k1').querySelector('[data-timeline-card="t1"]')).not.toBeNull() })
    const editor = within(node('k1').querySelector('[data-timeline-card="t1"]') as HTMLElement).getByTestId('dv-timeline-editor')
    expect([within(editor).queryByRole('tablist'), within(editor).queryByRole('tab'), within(editor).queryByRole('button', { name: zh['tabs.new'] })]).toEqual([null, null, null])
    act(() => { server.notify() })
    await act(() => Promise.resolve())
    expect(node('k1').querySelector('[data-timeline-card="t1"]')).not.toBeNull()
    expect(operationsOf(server.writes)).toEqual([])
  })

  it('shows a deleted timeline, an empty one, and opens the timeline view on a double click on the caption', async () => {
    const { node, canvasOf, show } = await mountTimelineCanvas((state) => {
      const [timeline] = state.components.timeline.timelines
      if (timeline === undefined) return
      state.components.timeline.timelines.push({ ...timeline, id: 't2' as TimelineId, name: '片尾', clips: [] })
      placeTimeline(state, 'k2', 't9')
      placeTimeline(state, 'k3', 't2')
    })
    await waitFor(() => { node('k3') })
    expect(node('k2').getAttribute('aria-label')).toBe(zh['node.deleted'])
    expect(node('k2').querySelector('[data-timeline-card="deleted"]')?.textContent).toBe(zh['node.deleted'])
    expect(node('k3').getAttribute('aria-label')).toBe('片尾')
    const caption = within(node('k3')).getByText('片尾')
    for (const pointerId of [1, 2]) {
      fireEvent.pointerDown(caption, { button: 0, clientX: 5, clientY: 5, pointerId })
      fireEvent.pointerUp(canvasOf(), { pointerId })
    }
    expect(show).toHaveBeenCalledWith({ view: 'timeline', target: { timeline: 't2', clip: null } })
    expect(node('k3').querySelector('[data-node-above]')?.textContent).toContain(zh['viewer.empty'])
  })

  it('sizes the preview by the first clip\'s picture, and shows a refused write of the editor above it', async () => {
    const { node, canvasOf } = await mountTimelineCanvas((state) => {
      const [timeline] = state.components.timeline.timelines
      if (timeline === undefined) return
      state.assets = state.assets.map((entry) => {
        if (entry.id === 'shot1.mp4') return { ...entry, width: 1280, height: 720 }
        return entry.id === 'export.mp4' ? { ...entry, width: 10, height: 0 } : entry
      })
      const clip = { id: 'cl9' as ClipId, asset: 'export.mp4' as AssetId, source: null, in_sec: null, out_sec: null }
      // cl8 waits for the render g2, and the sound plays ref.png's import.
      const pending = { id: 'cl8' as ClipId, asset: null, source: { record: 'g2' as RecordId, output: 0 }, in_sec: null, out_sec: null }
      const sounds = [{ id: 'sd1' as SoundId, asset: 'ref.png' as AssetId, in_sec: null, out_sec: null, start_sec: 0, track: 0 }]
      // cl7 on the video track above plays g1's shot.
      const tracked = [{ id: 'cl7' as ClipId, asset: 'shot1.mp4' as AssetId, in_sec: null, out_sec: null, start_sec: 0, track: 0 }]
      state.components.timeline.timelines.push({ ...timeline, id: 't2' as TimelineId, clips: [clip, pending], track_clips: tracked, sounds })
      placeTimeline(state, 'k1', 't1')
      placeTimeline(state, 'k2', 't2')
    }, (_path, body) => (body as { operation?: string }).operation === 'timeline.clip_remove' ? '片段被锁定' : null)
    const select = (id: string): void => {
      fireEvent.pointerDown(within(node(id)).getByTestId('dv-timeline-ruler'), { button: 0, clientX: 0, pointerId: 1 })
      fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    }
    await waitFor(() => { node('k2') })
    const ratio = (id: string): string | undefined => node(id).querySelector<HTMLElement>('[data-node-above] [data-testid="dv-timeline-viewer"]')?.style.aspectRatio
    select('k1')
    expect(ratio('k1')).toBe('1280 / 720')
    select('k2')
    expect(ratio('k2')).toBe('16 / 9')
    // The node uses its clips' assets on every video track, the render its placeholder clip waits for, and its sounds' assets.
    expect([...canvasOf().querySelectorAll('[data-edge$=">k2"]')].map(edge => edge.getAttribute('data-edge')).sort()).toEqual(['g1>k2', 'g2>k2'])
    expect([...canvasOf().querySelectorAll('[data-node-used="true"]')].map(card => card.getAttribute('data-node-id')).sort()).toEqual(['g1', 'g2'])
    const editor = node('k1').querySelector('[data-testid="dv-timeline-editor"]') as HTMLElement
    const clip = editor.querySelector('[data-clip="cl1"]') as HTMLElement
    fireEvent.pointerDown(clip, { button: 0, clientX: 10, pointerId: 2 })
    fireEvent.pointerUp(clip, { clientX: 10, pointerId: 2 })
    fireEvent.keyDown(editor, { key: 'Delete' })
    await waitFor(() => { expect(within(node('k1')).getByRole('alert').textContent).toContain('片段被锁定') })
  })

  it('moves the node from the preview and the editor\'s free areas, selects it on a click there, and grows the preview with the node\'s height', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    // The card measures its frame in canvas units: 640 wide and 585 tall here, so the preview is 585 × 640 / 390 = 960 wide.
    const sizes = { offsetWidth: 640, offsetHeight: 585 }
    const originals = Object.fromEntries(Object.keys(sizes).map(key => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)]))
    for (const [key, value] of Object.entries(sizes)) {
      Object.defineProperty(HTMLElement.prototype, key, {
        configurable: true,
        get(this: HTMLElement) { return this.hasAttribute('data-timeline-card') ? value : 0 },
      })
    }
    try {
      const { node, canvasOf, server } = await mountTimelineCanvas((state) => { placeTimeline(state, 'k1', 't1') })
      await waitFor(() => { expect(node('k1').querySelector('[role="toolbar"]')).not.toBeNull() })
      const toolbar = node('k1').querySelector('[data-testid="dv-timeline-editor"] [role="toolbar"]') as HTMLElement
      fireEvent.pointerDown(toolbar, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
      fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
      expect([node('k1').getAttribute('data-node-selected'), server.positionWrites]).toEqual(['true', []])
      const preview = node('k1').querySelector<HTMLElement>('[data-node-above] [data-testid="dv-timeline-preview"]') as HTMLElement
      // The editor and the preview draw at min(640 / 480, 585 / 290) = 4 / 3: the 960-unit preview lays out 720 wide.
      const scale = String(640 / 480)
      expect([preview.style.width, preview.style.marginLeft, preview.style.transform]).toEqual(['720px', '50%', `translateX(-50%) scale(${scale})`])
      const editorRoot = node('k1').querySelector<HTMLElement>('[data-testid="dv-timeline-editor"]') as HTMLElement
      expect([editorRoot.style.transform, editorRoot.style.width]).toEqual([`scale(${scale})`, `${String(100 / (640 / 480))}%`])
      // A press at 3/4 of the progress bar moves the playhead to 3/4 of the 7-second timeline.
      const progress = within(preview).getByTestId('dv-timeline-progress')
      vi.spyOn(progress, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 14, right: 400, bottom: 14, x: 0, y: 0, toJSON: () => ({}) })
      fireEvent.pointerDown(progress, { button: 0, clientX: 300, pointerId: 5 })
      await waitFor(() => { expect(progress.getAttribute('aria-valuenow')).toBe('5') })
      expect([node('k1').getAttribute('data-node-selected'), server.positionWrites]).toEqual(['true', []])
      fireEvent.pointerDown(within(preview).getByTestId('dv-timeline-viewer'), { button: 0, clientX: 0, clientY: 0, pointerId: 2 })
      fireEvent.pointerMove(canvasOf(), { clientX: 30, clientY: 40, pointerId: 2 })
      fireEvent.pointerUp(canvasOf(), { pointerId: 2 })
      await waitFor(() => { expect(server.positionWrites).toEqual([{ node: 'k1', x: 930, y: 40 }]) })
      // Backspace in the editor with nothing selected in it leaves the node alone.
      fireEvent.keyDown(node('k1').querySelector('[data-testid="dv-timeline-editor"]') as HTMLElement, { key: 'Backspace' })
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor !== undefined) Object.defineProperty(HTMLElement.prototype, key, descriptor)
      }
    }
  })
})
