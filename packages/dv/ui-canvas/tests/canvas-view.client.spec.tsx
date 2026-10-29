// @vitest-environment jsdom
/**
 * The canvas view in the workspace center, mounted with the real kind plugins over a scripted server so that cards,
 * editors and writes come from the plugins that the bundle loads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { asset, record } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import type { NodeAction, NodeType, NodeView } from '../src/client/contract/index.ts'
import { NODE_WIDTH } from '../src/client/graph.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import { zh } from '../src/client/locales.ts'
import { forgetCanvasStorage, KINDS, mountCanvas, mountDescriptors } from './canvas-runtime.client.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  forgetCanvasStorage()
})

/**
 * Press and release the pointer on empty canvas.
 * @param canvas - the canvas surface.
 */
function clickEmpty(canvas: HTMLElement): void {
  fireEvent.pointerDown(canvas, { button: 0, clientX: 700, clientY: 500, pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerId: 1 })
}

/**
 * Drop data on the canvas at a pointer position; jsdom's drop event carries no coordinates, so they are set on it.
 * @param canvas - the canvas surface.
 * @param dataTransfer - the dropped data.
 */
function dropAt(canvas: HTMLElement, dataTransfer: object): void {
  const drop = createEvent.drop(canvas, { dataTransfer })
  Object.defineProperties(drop, { clientX: { value: 500 }, clientY: { value: 300 } })
  fireEvent(canvas, drop)
}

/**
 * @param assetId - the dragged 素材 tile's asset.
 * @returns the data of a 素材 tile drag.
 */
const tileDrag = (assetId: string) => ({ types: [DV_ASSET_DRAG_TYPE], getData: (type: string) => type === DV_ASSET_DRAG_TYPE ? assetId : '', files: [] })

const operationsOf = (writes: ReadonlyArray<{ path: string; body: unknown }>): unknown[] =>
  writes.filter(write => write.path === '/api/dv/operation').map(write => write.body)

/**
 * The send button of an editor's composer once the composer's check of the call has answered.
 * @param editor - the editor panel.
 * @returns the enabled button.
 */
const sendIn = (editor: HTMLElement): Promise<HTMLButtonElement> => waitFor(() => {
  const button = within(editor).getByRole<HTMLButtonElement>('button', { name: '渲染新版本' })
  if (button.disabled) throw new Error('the composer has not checked the call yet')
  return button
})

const tileIn = (editor: HTMLElement, ref: string): Promise<HTMLElement> => waitFor(() => {
  const tile = editor.querySelector<HTMLElement>(`[data-reference-tile="${ref}"] button`)
  if (tile === null) throw new Error(`no tile of ${ref}`)
  return tile
})

const settle = (): Promise<void> => act(() => new Promise<void>((resolve) => { setTimeout(resolve, 200) }))

const failG1 = (state: FixtureState): void => {
  state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
    ? { ...entry, status: 'failed' as const, outputs: [], error: { code: 'operation_failed', message: 'GPU out of memory' } }
    : entry)
}

/** A claimed node type whose node is 117 units tall while its record renders and 400 once it is done. */
const PAINT: NodeType = {
  id: '@dv/ui-test-paint', type: 'paint', label: () => 'Paint', color: 'var(--dv-node-2)', column: 9,
  claimed: {
    operations: ['test.paint'],
    status: { running: () => '渲染中', failed: () => '失败' },
    entry: ({ record: { status } }) => ({ title: 'Paint', bodyHeight: status === 'done' ? 400 : 117 }),
  },
}

/**
 * @param finished - whether the record pa has finished.
 * @returns a state edit that adds the paint records pa, rendering until `finished`, and pb, done.
 */
const paintRecords = (finished: () => boolean) => (state: FixtureState): void => {
  state.components.proj.records.push(
    record({ id: 'pa', operation: 'test.paint', status: finished() ? 'done' : 'running' }),
    record({ id: 'pb', operation: 'test.paint' }),
  )
}

describe('the canvas over the real kinds', () => {
  it('draws stored positions, stores a free spot once for every other node, stores a dragged position, and shows a reported badge', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas()
    await mountDescriptors(runtime, { inUse: { id: 'clips', uses: () => [], badges: () => [{ asset: 'shot2.mp4', label: '已裁剪' }] } })
    await waitFor(() => { node('g3') })
    expect(node('g1').style.left).toBe('10px')
    expect(node('g2').getAttribute('data-node-stale')).toBe('true')
    expect(within(node('g2')).getByText('已裁剪')).toBeTruthy()
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(1) })
    const stored = server.layoutWrites[0] as { project: string; positions: Record<string, unknown> }
    expect([Object.keys(stored).sort(), stored.project, stored.positions['g2']]).toEqual([['positions', 'project'], 'p1', { x: 480, y: 0 }])
    expect(Object.keys(stored.positions)).not.toContain('g1')
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(2) }, { timeout: 2000 })
    expect(server.layoutWrites[1]).toMatchObject({ project: 'p1', positions: { g2: { x: 530, y: 30 } } })
    await runtime.dispose()
  })

  it('stores the spot of a rendering node only once it finishes, placed again at its final height', async () => {
    let finished = false
    const { runtime, node, server } = await mountCanvas({ edit: paintRecords(() => finished) })
    await mountDescriptors(runtime, { nodeType: PAINT })
    await waitFor(() => { node('pb') })
    await waitFor(() => { expect(server.layoutWrites.some(write => 'pb' in write.positions)).toBe(true) })
    const below = server.layoutWrites.find(write => 'pb' in write.positions)?.positions['pb']
    expect(below?.y).toBe(200)
    // The rendering node is drawn at its spot above pb, which the canvas does not store.
    expect([node('pa').style.left, node('pa').style.top]).toEqual([`${String(below?.x)}px`, '0px'])
    expect(server.layoutWrites.some(write => 'pa' in write.positions)).toBe(false)
    finished = true
    server.notify()
    await waitFor(() => { expect(server.layoutWrites.some(write => 'pa' in write.positions)).toBe(true) })
    // At its final height the node no longer fits above pb, which is 420 units tall from y 200, so it lands below pb.
    expect(server.layoutWrites.filter(write => 'pa' in write.positions).map(write => write.positions['pa'])).toEqual([{ x: below?.x, y: 800 }])
    expect(node('pa').style.top).toBe('800px')
    await runtime.dispose()
  })

  it('stores a dragged rendering node at once and keeps it there when it finishes', async () => {
    let finished = false
    const { runtime, node, server, canvasOf } = await mountCanvas({ edit: paintRecords(() => finished) })
    await mountDescriptors(runtime, { nodeType: PAINT })
    await waitFor(() => { node('pa') })
    const left = Number.parseFloat(node('pa').style.left)
    fireEvent.pointerDown(node('pa'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 0, clientY: 900, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    await waitFor(() => { expect(server.layoutWrites.some(write => 'pa' in write.positions)).toBe(true) }, { timeout: 2000 })
    finished = true
    server.notify()
    await waitFor(() => { expect(node('pa').textContent).not.toContain('渲染中') })
    await settle()
    expect(server.layoutWrites.filter(write => 'pa' in write.positions).map(write => write.positions['pa'])).toEqual([{ x: left, y: 900 }])
    expect(node('pa').style.top).toBe('900px')
    await runtime.dispose()
  })

  it('hangs and titles the takes of a chain off its anchor while a registered chain anchor lasts', async () => {
    const { runtime, view, node } = await mountCanvas({
      edit: (state) => {
        const records = state.components.proj.records.map(entry => entry.id === 'g1' ? { ...entry, started_by: { record: 'st1', slot: 1 } } : entry)
        state.components.proj.records = [...records, record({ id: 'st1', operation: 'test.start', params: { board: 'b1' } })]
      },
    })
    const edge = (id: string): Element | null => view.container.querySelector(`path[data-edge="board:b1>${id}"]`)
    await waitFor(() => { node('g1') })
    expect(edge('g1')).toBeNull()
    const board: NodeType = {
      id: '@dv/ui-test-board', type: 'test_board', label: () => 'board', color: '', column: 1,
      entries: () => [{ id: 'board:b1', title: 'b1', record: null, assets: [], bodyHeight: 30 }],
    }
    const anchor = await mountDescriptors(runtime, {
      nodeType: board, anchor: { starter: 'test.start', anchor: start => `board:${String(start.params['board'])}` },
    })
    await waitFor(() => { expect(edge('g1')).not.toBeNull() })
    expect(edge('g3')).not.toBeNull()
    expect([node('g1'), node('g3')].map(card => card.getAttribute('aria-label'))).toEqual(['镜头 1 · 第 1 次', '镜头 1 · 第 2 次'])
    await anchor.dispose()
    await waitFor(() => { expect(edge('g1')).toBeNull() })
    expect(edge('g3')).toBeNull()
    await runtime.dispose()
  })

  it('keeps the node selected after its editor closes; a click on empty canvas then clears the selection', async () => {
    const { runtime, view, node, open, canvasOf } = await mountCanvas()
    await open('g1')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    clickEmpty(canvasOf())
    expect(node('g1').getAttribute('data-node-selected')).toBeNull()
    await runtime.dispose()
  })

  it('渲染新版本 runs the edited take based on it, reads 渲染中… until the new take appears, then closes the editor and selects the new take', async () => {
    let started = false
    const { runtime, view, node, open, server } = await mountCanvas({
      holdOperations: true,
      edit: (state) => {
        if (started) state.components.proj.records.push(record({ id: 'n1', operation: 'shot.render', deterministic: false, based_on: 'g1', params: { prompt: 'hero runs' }, status: 'running' }))
      },
    })
    const editor = await open('g1')
    fireEvent.change(await waitFor(() => within(editor).getByLabelText('时长')), { target: { value: '3' } })
    fireEvent.click(await sendIn(editor))
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '渲染中…' }).hasAttribute('disabled')).toBe(true) })
    await waitFor(() => { expect(operationsOf(server.writes)).toHaveLength(1) })
    expect(operationsOf(server.writes)[0]).toMatchObject({
      project: 'p1', operation: 'shot.render', surface: 'canvas', session: 's5', based_on: 'g1',
      params: { prompt: 'hero walks through the rain at night in the city', duration_sec: 3 },
    })
    server.notify()
    await settle()
    expect(within(editor).getByRole('button', { name: '渲染中…' })).toBeTruthy()
    started = true
    server.notify()
    await waitFor(() => { expect(node('n1').getAttribute('data-node-selected')).toBe('true') })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    expect(node('g1').getAttribute('data-node-selected')).toBeNull()
    await open('g2')
    server.releaseOperations()
    await settle()
    expect(view.getByTestId('dv-canvas-node-editor').getAttribute('aria-label')).toBe(node('g2').getAttribute('aria-label'))
    await runtime.dispose()
  })

  it('shows the task label in a take editor that reopens after the read of the task labels failed', async () => {
    const { runtime, view, open } = await mountCanvas()
    const served = globalThis.fetch
    let reads = 0
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
      if (input.endsWith('/api/dv/tasks') && reads++ === 0) return Promise.reject(new TypeError('Failed to fetch'))
      return served(input, init)
    })
    const mode = (editor: HTMLElement): string | null => within(editor).getByTestId('dv-canvas-render-mode').textContent
    const first = await open('g1')
    await waitFor(() => { expect(reads).toBe(1) })
    expect(mode(first)).toBe('fasth3 · ref2v')
    fireEvent.click(within(first).getByRole('button', { name: zh['editor.close'] }))
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    const reopened = await open('g1')
    await waitFor(() => { expect(mode(reopened)).toBe('fasth3 · 参考图生成') })
    await runtime.dispose()
  })

  it('shows 重试 of a failed take in its failed row and its editor header, each rerunning the take based on it, and only in the failed row once the editor closes', async () => {
    const { runtime, view, node, open, server } = await mountCanvas({ edit: failG1 })
    await waitFor(() => { node('g1') })
    expect(node('g1').getAttribute('title')).toBe('GPU out of memory')
    expect(node('g1').textContent).toContain('生成失败')
    const retry = {
      project: 'p1', operation: 'shot.render', surface: 'canvas', session: 's5', based_on: 'g1',
      params: { prompt: 'hero walks through the rain at night in the city' }, inputs: [{ role: 'reference', ref: 'hero@1' }],
    }
    fireEvent.click(within(node('g1')).getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(operationsOf(server.writes)).toHaveLength(1) })
    expect(operationsOf(server.writes)[0]).toMatchObject(retry)
    const editor = await open('g1')
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '重试' }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(within(editor).getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(operationsOf(server.writes)).toHaveLength(2) })
    expect(operationsOf(server.writes)[1]).toMatchObject(retry)
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    expect(view.getAllByRole('button', { name: '重试' })).toEqual([within(node('g1')).getByRole('button', { name: '重试' })])
    await runtime.dispose()
  })

  it('marks a take that finished after the first load as unseen until its editor opens', async () => {
    let finished = false
    const { runtime, view, node, open, server } = await mountCanvas({
      edit: (state) => {
        if (!finished) return
        state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g3' ? { ...entry, status: 'done' as const, outputs: ['shot2.mp4'], finished_at: '2026-10-06T00:00:00Z' } : entry)
      },
    })
    await waitFor(() => { node('g3') })
    // Takes that were finished at the first load count as seen.
    expect(view.container.querySelectorAll('[data-node-unseen]')).toHaveLength(0)
    finished = true
    server.notify()
    await waitFor(() => { expect(node('g3').getAttribute('data-node-unseen')).toBe('true') })
    expect(within(node('g3')).getByRole('img', { name: zh['node.unseen'] })).toBeTruthy()
    await open('g3')
    expect(node('g3').getAttribute('data-node-unseen')).toBeNull()
    expect((JSON.parse(window.localStorage.getItem('dv-canvas-seen:p1') ?? '{}') as { ids?: string[] }).ids).toContain('g3')
    await runtime.dispose()
  })

  it('reads a stored array of opened nodes as the opened nodes alone, so every other finished take shows the dot', async () => {
    window.localStorage.setItem('dv-canvas-seen:p1', JSON.stringify(['g1', 7]))
    const { runtime, node } = await mountCanvas()
    await waitFor(() => { expect(node('g2').getAttribute('data-node-unseen')).toBe('true') })
    expect(node('g1').getAttribute('data-node-unseen')).toBeNull()
    await runtime.dispose()
  })

  it('counts the takes of a node type that registers after the first load as seen when they finished before it', async () => {
    const { runtime, view, node } = await mountCanvas({ canvasFirst: true })
    await waitFor(() => { node('g1') })
    expect(view.container.querySelectorAll('[data-node-unseen]')).toHaveLength(0)
    await runtime.dispose()
  })

  it('opens the record that the center request names and takes the request; empty-canvas clicks and Escape close the editor', async () => {
    const take = vi.fn()
    const { runtime, view, node, open, canvasOf } = await mountCanvas({ request: { value: { record: 'g2' }, take } })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    expect(editor.getAttribute('aria-label')).toBe(node('g2').getAttribute('aria-label'))
    expect(take).toHaveBeenCalled()
    expect(node('g2').getAttribute('data-node-selected')).toBe('true')
    clickEmpty(canvasOf())
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await open('g1')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await runtime.dispose()
  })

  it('keeps a center request until a node type that registers later draws its node, then takes it', async () => {
    const take = vi.fn()
    const { runtime, view, node } = await mountCanvas({ canvasFirst: true, request: { value: { record: 'g2' }, take } })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    expect(editor.getAttribute('aria-label')).toBe(node('g2').getAttribute('aria-label'))
    expect(take).toHaveBeenCalled()
    await runtime.dispose()
  })

  it('opens the editor centered, moves and resizes it, remembers the rectangle for the next node, and resets on a double click', async () => {
    // jsdom has no layout; a 1200 × 800 canvas area gives the default rectangle 240, 80, 720 × 640.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    const { runtime, view, open } = await mountCanvas()
    const box = (editor: HTMLElement): number[] =>
      [editor.style.left, editor.style.top, editor.style.width, editor.style.height].map(value => parseFloat(value))
    const drag = (target: HTMLElement, dx: number, dy: number): void => {
      fireEvent.pointerDown(target, { button: 0, clientX: 300, clientY: 100, pointerId: 2 })
      fireEvent.pointerMove(target, { clientX: 300 + dx, clientY: 100 + dy, pointerId: 2 })
      fireEvent.pointerUp(target, { clientX: 300 + dx, clientY: 100 + dy, pointerId: 2 })
    }
    let editor = await open('g2')
    expect(box(editor)).toEqual([240, 80, 720, 640])
    drag(view.getByTestId('dv-canvas-editor-title-row'), 50, 30)
    expect(box(editor)).toEqual([290, 110, 720, 640])
    // A press on a title-row button starts no move.
    const close = view.getByRole('button', { name: zh['editor.close'] })
    fireEvent.pointerDown(close, { button: 0, clientX: 0, clientY: 0, pointerId: 3 })
    fireEvent.pointerMove(close, { clientX: 400, clientY: 400, pointerId: 3 })
    expect(box(editor)).toEqual([290, 110, 720, 640])
    const resize = view.getByRole('button', { name: zh['editor.resize'] })
    drag(resize, 100, 50)
    expect(box(editor)).toEqual([290, 110, 820, 690])
    fireEvent.keyDown(resize, { key: 'ArrowLeft' })
    fireEvent.keyDown(resize, { key: 'ArrowUp' })
    expect(box(editor)).toEqual([290, 110, 804, 674])
    expect(JSON.parse(window.localStorage.getItem(EDITOR_RECT_KEY) ?? 'null')).toEqual({ x: 290, y: 110, width: 804, height: 674 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    editor = await open('g1')
    expect(box(editor)).toEqual([290, 110, 804, 674])
    fireEvent.doubleClick(view.getByTestId('dv-canvas-editor-title-row'))
    expect(box(editor)).toEqual([240, 80, 720, 640])
    expect(window.localStorage.getItem(EDITOR_RECT_KEY)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await runtime.dispose()
  })

  it('fits a remembered rectangle from a larger window into the canvas', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    window.localStorage.setItem(EDITOR_RECT_KEY, JSON.stringify({ x: 700, y: 300, width: 1000, height: 500 }))
    const { runtime, open } = await mountCanvas()
    const editor = await open('g2')
    expect([editor.style.left, editor.style.top, editor.style.width, editor.style.height]).toEqual(['0px', '100px', '800px', '500px'])
    await runtime.dispose()
  })

  it('a wheel over the open editor leaves the canvas viewport alone; a wheel over empty canvas zooms it', async () => {
    const { runtime, open, canvasOf } = await mountCanvas()
    const editor = await open('g1')
    const canvas = canvasOf()
    const transform = (): string => (canvas.querySelector('div[style*="transform"]') as HTMLElement).style.transform
    const before = transform()
    const overEditor = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    act(() => { (editor.querySelector('li') ?? editor).dispatchEvent(overEditor) })
    expect(overEditor.defaultPrevented).toBe(false)
    expect(transform()).toBe(before)
    const overCanvas = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    act(() => { canvas.dispatchEvent(overCanvas) })
    expect(overCanvas.defaultPrevented).toBe(true)
    expect(transform()).not.toBe(before)
    await runtime.dispose()
  })

  it('offers 仍然保留 on a stale node only, which accepts its record for the chat session beside the canvas', async () => {
    const { runtime, open, server } = await mountCanvas()
    const stale = await open('g2')
    fireEvent.click(within(stale).getByRole('button', { name: zh['editor.keepAnyway'] }))
    await waitFor(() => { expect(server.writes.some(write => write.path === '/api/dv/stale/accept')).toBe(true) })
    expect(server.writes.find(write => write.path === '/api/dv/stale/accept')?.body).toEqual({ project: 'p1', record: 'g2', surface: 'canvas', session: 's5' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    const fresh = await open('g1')
    expect(within(fresh).queryByRole('button', { name: zh['editor.keepAnyway'] })).toBeNull()
    await runtime.dispose()
  })

  it('a reference tile opens the noun\'s editor over the take editor, and closing it keeps the take editor\'s changes', async () => {
    const { runtime, view, open } = await mountCanvas()
    const editor = await open('g1')
    fireEvent.change(await waitFor(() => within(editor).getByLabelText('时长')), { target: { value: '3' } })
    const hero = await tileIn(editor, 'hero@1')
    fireEvent.click(hero)
    expect(view.getAllByTestId('dv-canvas-node-editor').map(panel => panel.getAttribute('aria-label'))).toEqual([editor.getAttribute('aria-label'), 'Hero'])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.getAllByTestId('dv-canvas-node-editor')).toHaveLength(1)
    expect(within(view.getByTestId('dv-canvas-node-editor')).getByLabelText<HTMLSelectElement>('时长').value).toBe('3')
    const openHero = (): HTMLElement => {
      fireEvent.click(hero)
      const stacked = view.getAllByTestId('dv-canvas-node-editor')[1]
      if (stacked === undefined) throw new Error('no stacked editor')
      return stacked
    }
    const beside = openHero().parentElement
    if (beside === null) throw new Error('no stacked editor cover')
    fireEvent.pointerDown(beside, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    expect(view.getAllByTestId('dv-canvas-node-editor')).toHaveLength(1)
    fireEvent.click(within(openHero()).getByRole('button', { name: zh['editor.close'] }))
    const panels = view.getAllByTestId('dv-canvas-node-editor')
    expect(panels.map(panel => panel.getAttribute('aria-label'))).toEqual([editor.getAttribute('aria-label')])
    await runtime.dispose()
  })

  it('the editor\'s picker lists the version kinds\' other items and the pool tiles, Escape closes only the picker, and the picks reach the take\'s rerun', async () => {
    const { runtime, view, open, server } = await mountCanvas({
      edit: (state) => {
        state.components.test_ref = {
          ...state.components.test_ref,
          villain: [{ id: 'villain', version: 2, name: 'Villain', description: '', references: [], created_by: 'e1' }],
        }
      },
    })
    const editor = await open('g1')
    fireEvent.click(await waitFor(() => within(editor).getByRole('button', { name: '添加素材' })))
    await view.findByTestId('dv-canvas-asset-picker')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    expect(view.getByTestId('dv-canvas-node-editor')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '添加素材' }))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    const villain = within(picker).getByRole('button', { name: 'Villain' })
    const noun = villain.closest('section')
    expect(noun?.querySelector('h3')?.textContent).toBe('参考')
    expect(within(noun as HTMLElement).getAllByRole('button').map(button => button.textContent)).toEqual(['Villain'])
    fireEvent.click(villain)
    const tile = await waitFor(() => {
      const found = picker.querySelector('[data-asset-id="shot1.mp4"]')
      if (!(found instanceof HTMLElement)) throw new Error('no shot1.mp4 tile')
      return found
    })
    fireEvent.click(tile)
    fireEvent.click(within(picker).getByRole('button', { name: '确认（2）' }))
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    const opened = vi.spyOn(runtime.ctx.dvMedia, 'preview')
    const shot = await tileIn(editor, 'shot1.mp4')
    fireEvent.click(shot)
    expect(opened.mock.calls).toEqual([['p1', expect.objectContaining({ id: 'shot1.mp4' }), shot]])
    expect(await view.findByRole('dialog', { name: 'shot1.mp4' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('dialog', { name: 'shot1.mp4' })).toBeNull() })
    expect(view.getByTestId('dv-canvas-node-editor')).toBeTruthy()
    fireEvent.click(await sendIn(editor))
    await waitFor(() => { expect(operationsOf(server.writes)).toHaveLength(1) })
    expect(operationsOf(server.writes)[0]).toMatchObject({
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'villain@2' }, { role: 'reference', ref: 'shot1.mp4' }],
    })
    await runtime.dispose()
  })

  it('imports the files of the editor\'s upload one after another as canvas imports, and the take\'s rerun sends them as references', async () => {
    const { runtime, open, server } = await mountCanvas()
    const editor = await open('g1')
    const upload = await waitFor(() => within(editor).getByTestId('dv-prompt-upload'))
    fireEvent.change(upload, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })] } })
    await waitFor(() => { expect(server.imports.map(file => [file.name, file.surface, file.session])).toEqual([['a.png', 'canvas', 's5'], ['b.png', 'canvas', 's5']]) })
    await tileIn(editor, 'b.png')
    fireEvent.click(await sendIn(editor))
    await waitFor(() => { expect(operationsOf(server.writes)).toHaveLength(1) })
    expect(operationsOf(server.writes)[0]).toMatchObject({
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'a.png' }, { role: 'reference', ref: 'b.png' }],
    })
    await runtime.dispose()
  })
})

describe('drops on the canvas', () => {
  it('puts a dropped 素材 tile on the canvas under the pointer with asset.place, and 从画布移除 in its editor takes it off with asset.unplace', async () => {
    const { runtime, view, node, open, server, canvasOf } = await mountCanvas({
      edit: (state) => {
        state.assets.push(asset('pool.png', 'image/png', 'u2'))
        state.components.proj.records.push(record({ id: 'u2', operation: 'asset.import', params: { name: 'pool.png' }, outputs: ['pool.png'], surface: 'asset_pool' }))
        state.components.proj.created_by['pool.png'] = 'u2'
      },
    })
    await waitFor(() => { node('g1') })
    expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull()
    dropAt(canvasOf(), tileDrag('pool.png'))
    await waitFor(() => { expect(node('u2').style.left).toBe(`${String(500 - NODE_WIDTH / 2)}px`) })
    const placement = (operation: string) => ({ project: 'p1', operation, surface: 'canvas', inputs: [{ role: 'asset', ref: 'pool.png' }], session: 's5' })
    await waitFor(() => { expect(operationsOf(server.writes)).toContainEqual(placement('asset.place')) })
    const editor = await open('u2')
    fireEvent.click(within(editor).getByRole('button', { name: '从画布移除' }))
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull() })
    await waitFor(() => { expect(operationsOf(server.writes)).toContainEqual(placement('asset.unplace')) })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await runtime.dispose()
  })

  it('places a dropped 素材 tile of an asset that no record of the current state imported, and draws it as asset:<id>', async () => {
    const { runtime, view, node, server, canvasOf } = await mountCanvas({
      edit: (state) => { state.assets.push(asset('undone.png', 'image/png', 'u9', null, 'asset.import')) },
    })
    await waitFor(() => { node('g1') })
    dropAt(canvasOf(), tileDrag('undone.png'))
    await waitFor(() => {
      expect(operationsOf(server.writes)).toContainEqual({ project: 'p1', operation: 'asset.place', surface: 'canvas', inputs: [{ role: 'asset', ref: 'undone.png' }], session: 's5' })
    })
    await waitFor(() => { node('asset:undone.png') })
    expect(view.queryByRole('alert')).toBeNull()
    await runtime.dispose()
  })

  it('draws an asset that another writer put on the project\'s canvas once the project changes', async () => {
    const placed: string[] = []
    const { runtime, view, node, server } = await mountCanvas({
      edit: (state) => {
        state.assets.push(asset('chat.png', 'image/png', 'u2'))
        state.components.proj.records.push(record({ id: 'u2', operation: 'asset.import', params: { name: 'chat.png' }, outputs: ['chat.png'], surface: 'chat' }))
        state.components.proj.created_by['chat.png'] = 'u2'
        state.components.asset.placed = [...placed]
      },
    })
    await waitFor(() => { node('g1') })
    expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull()
    placed.push('chat.png')
    server.notify()
    await waitFor(() => { node('u2') })
    await runtime.dispose()
  })

  it('imports a dropped file of any media type onto the canvas under the pointer, and draws a type without a view as the dv.media file card', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas()
    await waitFor(() => { node('g1') })
    const file = new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' })
    dropAt(canvasOf(), { types: ['Files'], getData: () => '', files: [file] })
    await waitFor(() => { expect(server.imports).toHaveLength(1) })
    expect(server.imports[0]).toEqual({ project: 'p1', name: 'brief.pdf', mime: 'application/pdf', surface: 'canvas', session: 's5' })
    await waitFor(() => { expect(node('imp1').style.left).toBe(`${String(500 - NODE_WIDTH / 2)}px`) })
    const card = node('imp1').querySelector('[data-dv-media="file"]')
    expect(card?.textContent).toContain('brief.pdf')
    expect(card?.textContent).toContain('application/pdf')
    await runtime.dispose()
  })
})

function viewportOf(canvas: HTMLElement): { x: number; y: number; zoom: number } {
  const layer = canvas.querySelector('div[style*="transform"]')
  if (!(layer instanceof HTMLElement)) throw new Error('no node layer')
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/u.exec(layer.style.transform)
  if (match === null) throw new Error(`unexpected transform ${layer.style.transform}`)
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) }
}

function cardsOutside(canvas: HTMLElement, width: number, height: number): string[] {
  const { x, y, zoom } = viewportOf(canvas)
  return [...canvas.querySelectorAll<HTMLElement>('[data-node-id]')].filter((card) => {
    const left = x + parseFloat(card.style.left) * zoom
    const top = y + parseFloat(card.style.top) * zoom
    return left < 0 || top < 0 || left + NODE_WIDTH * zoom > width || top + 180 * zoom > height
  }).map(card => card.getAttribute('data-node-id') ?? '')
}

const mockCanvasSize = (width: number, height: number): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, height))
}

function stubResizeObservers(): () => void {
  const callbacks: Array<() => void> = []
  vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { callbacks.push(() => { callback([], this) }) }
    observe(): void { /* The test fires the callbacks itself. */ }
    unobserve(): void {}
    disconnect(): void {}
  })
  return () => { act(() => { callbacks.forEach((callback) => { callback() }) }) }
}

const refuseOperation = (operation: string, error: string) => (path: string, body: unknown): string | null => {
  const named = typeof body === 'object' && body !== null && 'operation' in body && body.operation === operation
  return path === '/api/dv/operation' && named ? error : null
}



describe('the opened nodes in storage', () => {
  const malformed = ['not json', '5', '{"ids":[]}', '{"since":1,"ids":[]}']
  it.each(malformed)('reads %s as none stored, so every finished take counts as seen', async (stored) => {
    window.localStorage.setItem('dv-canvas-seen:p1', stored)
    const { runtime, view, node } = await mountCanvas()
    await waitFor(() => { node('g2') })
    expect(view.container.querySelectorAll('[data-node-unseen]')).toHaveLength(0)
    expect(JSON.parse(window.localStorage.getItem('dv-canvas-seen:p1') ?? 'null')).toEqual({ since: '2026-10-05T00:00:00Z', ids: [] })
    await runtime.dispose()
  })
})

describe('the viewport', () => {
  it('fits every node into view when no viewport is stored, refits on a resize until the user zooms, and 适应 fits again', async () => {
    const resize = stubResizeObservers()
    mockCanvasSize(1000, 700)
    const { runtime, node, canvasOf } = await mountCanvas({ layout: { positions: {}, viewport: null } })
    await waitFor(() => { node('g3') })
    const canvas = canvasOf()
    await waitFor(() => { expect(viewportOf(canvas)).not.toEqual({ x: 40, y: 40, zoom: 1 }) })
    expect(cardsOutside(canvas, 1000, 700)).toEqual([])
    expect(viewportOf(canvas).zoom).toBeLessThanOrEqual(1)
    mockCanvasSize(500, 300)
    resize()
    expect(cardsOutside(canvas, 500, 300)).toEqual([])
    act(() => { canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })) })
    const zoomed = viewportOf(canvas)
    mockCanvasSize(1000, 700)
    resize()
    expect(viewportOf(canvas)).toEqual(zoomed)
    fireEvent.click(within(canvas).getByRole('button', { name: zh['canvas.fit'] }))
    expect(cardsOutside(canvas, 1000, 700)).toEqual([])
    await runtime.dispose()
  })

  it('draws the automatic layout, fitted, when the stored layout cannot be read', async () => {
    const { runtime, node, canvasOf } = await mountCanvas({ layout: null })
    await waitFor(() => { node('g1') })
    await waitFor(() => { expect(cardsOutside(canvasOf(), 800, 600)).toEqual([]) })
    expect(node('g1').style.left).not.toBe('10px')
    await runtime.dispose()
  })

  it('pans on a drag of empty canvas with the grabbing cursor and stores the viewport; a jitter under 4 px is a click', async () => {
    const { runtime, node, open, server, canvasOf, view } = await mountCanvas()
    await open('g1')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    const canvas = canvasOf()
    fireEvent.pointerDown(canvas, { button: 0, clientX: 700, clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 701, clientY: 501, pointerId: 1 })
    expect(viewportOf(canvas)).toEqual({ x: 0, y: 0, zoom: 1 })
    fireEvent.pointerMove(canvas, { clientX: 730, clientY: 520, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 760, clientY: 540, pointerId: 1 })
    expect(viewportOf(canvas)).toEqual({ x: 60, y: 40, zoom: 1 })
    expect(canvas.style.cursor).toBe('grabbing')
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    const panned = { project: 'p1', positions: {}, viewport: { x: 60, y: 40, zoom: 1 } }
    await waitFor(() => { expect(server.layoutWrites).toContainEqual(panned) }, { timeout: 2000 })
    await runtime.dispose()
  })

  it('ignores presses of other buttons than the primary one on empty canvas and on a node', async () => {
    const { runtime, view, node, open, canvasOf } = await mountCanvas()
    await open('g1')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    fireEvent.pointerDown(canvasOf(), { button: 2, clientX: 700, clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    fireEvent.pointerDown(node('g2'), { button: 2, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await runtime.dispose()
  })

  it('放大 and 缩小 zoom around the canvas center and store the viewport once; a press on the zoom bar keeps the selection', async () => {
    const { runtime, view, node, open, server, canvasOf } = await mountCanvas()
    await open('g1')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    const canvas = canvasOf()
    const zoomBar = within(canvas).getByRole('toolbar', { name: zh['canvas.zoom'] })
    fireEvent.pointerDown(zoomBar, { button: 0, clientX: 30, clientY: 580, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(1) })
    // jsdom lays out nothing, so the canvas counts as 800 × 600 and zooms around (400, 300).
    fireEvent.click(within(zoomBar).getByRole('button', { name: zh['canvas.zoomIn'] }))
    expect(viewportOf(canvas)).toEqual({ x: -80, y: -60, zoom: 1.2 })
    expect(zoomBar.textContent).toContain('120%')
    fireEvent.click(within(zoomBar).getByRole('button', { name: zh['canvas.zoomOut'] }))
    expect(zoomBar.textContent).toContain('100%')
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(2) }, { timeout: 2000 })
    const { x, y, zoom } = server.layoutWrites[1]?.viewport ?? { x: NaN, y: NaN, zoom: NaN }
    expect([x, y, zoom].map(value => Math.round(value * 1000) / 1000)).toEqual([0, 0, 1])
    await settle()
    expect(server.layoutWrites).toHaveLength(2)
    await runtime.dispose()
  })

  it('适应 keeps the zoom of a canvas without nodes and of a project whose state fails to load, which shows the error', async () => {
    const empty = await mountCanvas({ kinds: [] })
    await waitFor(() => { expect(empty.canvasOf().textContent).toContain(zh['canvas.empty']) })
    fireEvent.click(within(empty.canvasOf()).getByRole('button', { name: zh['canvas.fit'] }))
    expect(empty.canvasOf().textContent).toContain('100%')
    await empty.runtime.dispose()
    cleanup()
    const failing = await mountCanvas({ edit: () => { throw new Error('offline') } })
    await waitFor(() => { expect(failing.canvasOf().textContent).toContain('失败：') })
    fireEvent.click(within(failing.canvasOf()).getByRole('button', { name: zh['canvas.fit'] }))
    expect(failing.canvasOf().textContent).toContain('100%')
    await failing.runtime.dispose()
  })

  it('leaves the canvas working when the server refuses to store the layout', async () => {
    const { runtime, view, node, server, canvasOf } = await mountCanvas({ refuse: path => path === '/api/dv/layout' ? 'read-only' : null })
    await waitFor(() => { node('g3') })
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(1) })
    act(() => { canvasOf().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })) })
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(2) }, { timeout: 2000 })
    await settle()
    expect(view.queryByRole('alert')).toBeNull()
    await runtime.dispose()
  })

  it('drops a node dragged before the stored layout arrives back to its stored spot, and does not store the drag', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas({ holdLayout: true })
    await waitFor(() => { node('g1') })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 300, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    server.releaseLayout('p1')
    await waitFor(() => { expect(node('g1').style.left).toBe('10px') })
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(2) }, { timeout: 2000 })
    expect(server.layoutWrites.map(write => write.positions['g1'])).toEqual([undefined, undefined])
    await runtime.dispose()
  })
})

describe('writes and failures', () => {
  it('draws the canvas and opens an editor while the operation declarations fail to load', async () => {
    const { runtime, node, open } = await mountCanvas({ operations: null })
    const editor = await open('g1')
    expect(editor.getAttribute('aria-label')).toBe(node('g1').getAttribute('aria-label'))
    await runtime.dispose()
  })

  it('a press on 重试 in the failed row selects nothing; a refused 重试 shows the error and offers 重试 again', async () => {
    const { runtime, view, node, canvasOf } = await mountCanvas({ edit: failG1, refuse: refuseOperation('shot.render', 'GPU busy') })
    await waitFor(() => { node('g1') })
    const retry = within(node('g1')).getByRole('button', { name: '重试' })
    fireEvent.pointerDown(retry, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    expect(node('g1').getAttribute('data-node-selected')).toBeNull()
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    fireEvent.click(retry)
    expect((await view.findByRole('alert')).textContent).toBe('失败：GPU busy')
    await waitFor(() => { expect(within(node('g1')).getByRole('button', { name: '重试' }).hasAttribute('disabled')).toBe(false) })
    await runtime.dispose()
  })

  it('shows a refused 重试 of the editor header in the canvas notice over the editor, and offers 重试 again', async () => {
    const { runtime, view, open } = await mountCanvas({ edit: failG1, refuse: refuseOperation('shot.render', 'GPU busy') })
    const editor = await open('g1')
    fireEvent.click(within(editor).getByRole('button', { name: '重试' }))
    const notice = await view.findByRole('alert')
    expect(notice.textContent).toBe('失败：GPU busy')
    expect(Number(notice.style.zIndex)).toBeGreaterThan(Number(editor.style.zIndex))
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '重试' }).hasAttribute('disabled')).toBe(false) })
    await runtime.dispose()
  })

  it('shows the error of a rerun that fails after its new take appeared', async () => {
    let started = false
    const { runtime, view, node, open, server } = await mountCanvas({
      holdOperations: true, refuse: refuseOperation('shot.render', 'lost connection'),
      edit: (state) => {
        if (!started) return
        const rerun = record({ id: 'n1', operation: 'shot.render', deterministic: false, based_on: 'g1', status: 'running' })
        state.components.proj.records.push(rerun)
      },
    })
    const editor = await open('g1')
    fireEvent.click(await sendIn(editor))
    started = true
    server.notify()
    await waitFor(() => { expect(node('n1').getAttribute('data-node-selected')).toBe('true') })
    server.releaseOperations()
    expect((await view.findByRole('alert')).textContent).toBe('失败：lost connection')
    await runtime.dispose()
  })

  it('takes a dropped 素材 tile\'s node back off the canvas when the server refuses the placement, and shows the error', async () => {
    const { runtime, view, node, canvasOf } = await mountCanvas({
      refuse: refuseOperation('asset.place', 'no room'),
      edit: (state) => {
        state.assets.push(asset('pool.png', 'image/png', 'u2'))
        const imported = record({
          id: 'u2', operation: 'asset.import', params: { name: 'pool.png' }, outputs: ['pool.png'], surface: 'asset_pool',
        })
        state.components.proj.records.push(imported)
        state.components.proj.created_by['pool.png'] = 'u2'
      },
    })
    await waitFor(() => { node('g1') })
    dropAt(canvasOf(), tileDrag('pool.png'))
    expect((await view.findByRole('alert')).textContent).toBe('失败：no room')
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="u2"]')).toBeNull() })
    await runtime.dispose()
  })
})

describe('node actions', () => {
  const onG1 = (name: string, order: number, run: NodeAction['run'] = () => undefined): NodeAction => ({
    id: `@dv/ui-test-probe:${name}`, label: () => name, order, shows: (node): node is NodeView => node.id === 'g1', run,
  })

  it('orders the actions in the editor header; an action previews no unknown asset', async () => {
    const { runtime, view, open } = await mountCanvas()
    await mountDescriptors(runtime, {
      actions: [
        onG1('second', 2, (_node, host) => {
          host.preview('gone.png', null)
        }),
        onG1('first', 1),
      ],
    })
    const editor = await open('g1')
    const labels = within(editor).getAllByRole('button').map(button => button.textContent)
    expect(labels.filter(label => label === 'first' || label === 'second')).toEqual(['first', 'second'])
    fireEvent.click(within(editor).getByRole('button', { name: 'second' }))
    expect(view.getAllByRole('dialog')).toEqual([editor])
    await runtime.dispose()
  })

  it('ends the wait of a take editor whose rerun a rerun from a stacked editor replaces, with no failure notice', async () => {
    const { runtime, view, open } = await mountCanvas({ holdOperations: true })
    const rerunG2: NodeAction = {
      id: '@dv/ui-test-probe:rerun', label: () => 'rerun g2', order: 1, shows: (node): node is NodeView => node.id === 'test_ref:hero',
      run: (_node, host) => { host.rerun({ operation: 'shot.render', inputs: [], params: {}, intent: 'rerun g2', based_on: 'g2' }) },
    }
    await mountDescriptors(runtime, { actions: [rerunG2] })
    const editor = await open('g1')
    fireEvent.click(await sendIn(editor))
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '渲染中…' }).hasAttribute('disabled')).toBe(true) })
    fireEvent.click(await tileIn(editor, 'hero@1'))
    const stacked = view.getAllByTestId('dv-canvas-node-editor')[1]
    if (stacked === undefined) throw new Error('no stacked editor')
    fireEvent.click(within(stacked).getByRole('button', { name: 'rerun g2' }))
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '渲染新版本' }).hasAttribute('disabled')).toBe(false) })
    expect(view.queryByRole('alert')).toBeNull()
    await runtime.dispose()
  })

  it('shows no canvas notice for a rerun of a failed-row action that a rerun from an editor replaces', async () => {
    const { runtime, view, node, open } = await mountCanvas({ edit: failG1, holdOperations: true })
    await waitFor(() => { within(node('g1')).getByRole('button', { name: '重试' }) })
    fireEvent.click(within(node('g1')).getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(within(node('g1')).getByRole('button', { name: '渲染中…' }).hasAttribute('disabled')).toBe(true) })
    const editor = await open('g2')
    fireEvent.click(await sendIn(editor))
    await act(() => new Promise((resolve) => { setTimeout(resolve, 20) }))
    expect(view.queryByRole('alert')).toBeNull()
    await runtime.dispose()
  })

  it('reads the running words only on the failed-row button whose action started the rerun, and disables every button', async () => {
    const { runtime, node } = await mountCanvas({ edit: failG1, holdOperations: true })
    await mountDescriptors(runtime, { actions: [onG1('probe', 10)] })
    await waitFor(() => { within(node('g1')).getByRole('button', { name: 'probe' }) })
    fireEvent.click(within(node('g1')).getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(within(node('g1')).getByRole('button', { name: '渲染中…' }).hasAttribute('disabled')).toBe(true) })
    expect(within(node('g1')).getByRole('button', { name: 'probe' }).hasAttribute('disabled')).toBe(true)
    await runtime.dispose()
  })

  it('an action in a failed row closes the open editor through its host', async () => {
    const { runtime, view, node, open } = await mountCanvas({ edit: failG1 })
    await mountDescriptors(runtime, { actions: [onG1('close', 1, (_node, host) => { host.close() })] })
    await open('g2')
    fireEvent.click(within(node('g1')).getByRole('button', { name: 'close' }))
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    await runtime.dispose()
  })
})

describe('drags over the canvas', () => {
  it('accepts and outlines a drag of files, keeps the outline over a node, clears it on leaving, and ignores a text drag', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas()
    await waitFor(() => { node('g1') })
    const canvas = canvasOf()
    const files = { types: ['Files'], dropEffect: 'none' }
    expect(fireEvent.dragEnter(canvas, { dataTransfer: files })).toBe(false)
    expect(fireEvent.dragOver(canvas, { dataTransfer: files })).toBe(false)
    expect(files.dropEffect).toBe('copy')
    expect(canvas.style.boxShadow).toBe('inset 0 0 0 2px var(--dv-accent)')
    fireEvent.dragLeave(node('g1'), { dataTransfer: files })
    expect(canvas.style.boxShadow).toBe('inset 0 0 0 2px var(--dv-accent)')
    fireEvent.dragLeave(canvas, { dataTransfer: files })
    expect(canvas.style.boxShadow).toBe('none')
    const text = { types: ['text/plain'], getData: () => 'hello', files: [] }
    expect(fireEvent.dragEnter(canvas, { dataTransfer: text })).toBe(true)
    expect(fireEvent.dragOver(canvas, { dataTransfer: text })).toBe(true)
    expect(canvas.style.boxShadow).toBe('none')
    dropAt(canvas, text)
    await settle()
    expect(operationsOf(server.writes)).toEqual([])
    expect(server.imports).toEqual([])
    await runtime.dispose()
  })

  it('moves the node of a dropped 素材 tile that the canvas already draws under the pointer, and writes no placement', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas()
    await waitFor(() => { node('g1') })
    dropAt(canvasOf(), tileDrag('shot1.mp4'))
    expect(node('g1').style.left).toBe(`${String(500 - NODE_WIDTH / 2)}px`)
    await settle()
    expect(operationsOf(server.writes)).toEqual([])
    await runtime.dispose()
  })

  it('keeps a dropped file\'s spot until a node type that draws it registers', async () => {
    const { runtime, view, node, server, canvasOf } = await mountCanvas({ kinds: ['reference', 'takes', 'media'] })
    await waitFor(() => { node('g1') })
    dropAt(canvasOf(), { types: ['Files'], getData: () => '', files: [new File(['x'], 'later.png', { type: 'image/png' })] })
    await waitFor(() => { expect(server.imports).toHaveLength(1) })
    await settle()
    expect(view.container.querySelector('[data-node-id="imp1"]')).toBeNull()
    await runtime.mount(KINDS.assets)
    await waitFor(() => { expect(node('imp1').style.left).toBe(`${String(500 - NODE_WIDTH / 2)}px`) })
    await runtime.dispose()
  })
})

describe('the node card', () => {
  it('fades a superseded take, and draws the failure words over the body of a slice node whose record failed', async () => {
    const { runtime, node } = await mountCanvas({
      edit: (state) => {
        state.components.proj.superseded = { g1: 'g3' }
        const records = state.components.proj.records
        state.components.proj.records = records.map(entry => entry.id === 'e1' ? { ...entry, status: 'failed' as const } : entry)
      },
    })
    await waitFor(() => { node('test_ref:hero') })
    expect(node('g1').style.opacity).toBe('0.55')
    expect(node('test_ref:hero').textContent).toContain(zh['node.failed'])
    await runtime.dispose()
  })

  it('draws every node as a caption above a frame that holds its body, with no card fill or shadow, and rings the selected frame', async () => {
    const { runtime, node, open } = await mountCanvas()
    await waitFor(() => { node('test_ref:hero') })
    for (const id of ['test_ref:hero', 'g1']) {
      const frame = node(id).querySelector<HTMLElement>(':scope > [data-node-frame]')
      if (frame === null) throw new Error(`no frame of ${id}`)
      expect([node(id).style.background, node(id).style.boxShadow, frame.style.background]).toEqual(['', '', ''])
      expect(frame.style.boxShadow).toBe('0 0 0 1px var(--dv-line-strong)')
      // The caption is the node's first child, outside the frame, and carries the title.
      expect(node(id).firstElementChild?.textContent).toContain(node(id).getAttribute('aria-label'))
      expect(frame.contains(node(id).firstElementChild)).toBe(false)
    }
    expect(node('test_ref:hero').querySelector('[data-node-frame]')?.textContent).toBe('参考')
    await open('g1')
    expect(node('g1').querySelector<HTMLElement>('[data-node-frame]')?.style.boxShadow).toBe('0 0 0 2px var(--dv-accent), 0 0 0 6px var(--dv-accent-soft)')
    await runtime.dispose()
  })

  it('keeps the frame height of a failed take and draws its failed words and 重试 inside the frame', async () => {
    const { runtime, node } = await mountCanvas({ edit: failG1 })
    await waitFor(() => { node('g1') })
    const frame = node('g1').querySelector<HTMLElement>('[data-node-frame]')
    expect(frame?.style.height).toBe('117px')
    expect(frame?.textContent).toBe('生成失败重试')
    await runtime.dispose()
  })

  it('attaches an edge at the middle of each node\'s frame, below the caption', async () => {
    const { runtime, view, node } = await mountCanvas()
    const edge = await waitFor(() => {
      const found = view.container.querySelector('path[data-edge="test_ref:hero>g1"]')
      if (found === null) throw new Error('no edge into g1')
      return found
    })
    const points = (edge.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? []
    const [x1, y1] = points
    const [x2, y2] = points.slice(-2)
    const top = (id: string): number => Number.parseFloat(node(id).style.top)
    expect([x1, y1]).toEqual([Number.parseFloat(node('test_ref:hero').style.left) + NODE_WIDTH, top('test_ref:hero') + 20 + 30 / 2])
    expect([x2, y2]).toEqual([Number.parseFloat(node('g1').style.left), top('g1') + 20 + 117 / 2])
    await runtime.dispose()
  })
})

describe('the editor panel', () => {
  const malformed = ['not json', '5', '{"x":1}', '{"x":1e999,"y":0,"width":500,"height":400}']
  it.each(malformed)('opens at the default rectangle over the remembered value %s', async (stored) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    window.localStorage.setItem(EDITOR_RECT_KEY, stored)
    const { runtime, open } = await mountCanvas()
    const editor = await open('g2')
    expect([editor.style.left, editor.style.top, editor.style.width, editor.style.height]).toEqual(['240px', '80px', '720px', '640px'])
    await runtime.dispose()
  })

  it('keeps the panel on a still press, another pointer\'s release, another key and a double click on a button', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    const { runtime, view, open } = await mountCanvas()
    const editor = await open('g2')
    const box = (): string[] => [editor.style.left, editor.style.top, editor.style.width, editor.style.height]
    const title = view.getByTestId('dv-canvas-editor-title-row')
    fireEvent.pointerUp(title, { clientX: 400, clientY: 400, pointerId: 2 })
    fireEvent.pointerDown(title, { button: 0, clientX: 300, clientY: 100, pointerId: 2 })
    fireEvent.pointerUp(title, { clientX: 400, clientY: 400, pointerId: 3 })
    fireEvent.pointerUp(title, { clientX: 300, clientY: 100, pointerId: 2 })
    expect(box()).toEqual(['240px', '80px', '720px', '640px'])
    expect(window.localStorage.getItem(EDITOR_RECT_KEY)).toBeNull()
    fireEvent.keyDown(view.getByRole('button', { name: zh['editor.resize'] }), { key: 'Enter' })
    expect(box()).toEqual(['240px', '80px', '720px', '640px'])
    fireEvent.pointerDown(title, { button: 0, clientX: 300, clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(title, { clientX: 300, clientY: 140, pointerId: 2 })
    fireEvent.pointerUp(title, { clientX: 300, clientY: 140, pointerId: 2 })
    expect(box()).toEqual(['240px', '120px', '720px', '640px'])
    fireEvent.doubleClick(view.getByRole('button', { name: zh['editor.close'] }))
    expect(box()).toEqual(['240px', '120px', '720px', '640px'])
    expect(JSON.parse(window.localStorage.getItem(EDITOR_RECT_KEY) ?? 'null')).toEqual({ x: 240, y: 120, width: 720, height: 640 })
    await runtime.dispose()
  })

  it('shows the type label once in the header of a node titled by its type', async () => {
    const { runtime, open } = await mountCanvas()
    await mountDescriptors(runtime, {
      nodeType: {
        id: '@dv/ui-test-note', type: 'note', label: () => 'Note', color: '', column: 0,
        entries: () => [{ id: 'note:1', title: 'Note', record: null, assets: [], bodyHeight: 30 }],
      },
    })
    const editor = await open('note:1')
    expect(editor.querySelector('header')?.textContent).toBe('Note')
    await runtime.dispose()
  })
})
