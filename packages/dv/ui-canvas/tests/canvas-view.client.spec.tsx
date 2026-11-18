// @vitest-environment jsdom
/**
 * The canvas view in the workspace center, mounted with the real kind plugins over a scripted server so that cards,
 * editors and writes come from the plugins that the bundle loads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { asset, canvasNode, PROJECT, record } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import type { AddMenuSection, NodeAction, NodeType, NodeView } from '../src/client/contract/index.ts'
import { CanvasViews, httpLink } from '../src/client/agent-canvas.ts'
import type { StreamListener } from '../src/client/agent-canvas.ts'
import type { CanvasDrawn } from '../src/types.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import { zh } from '../src/client/locales.ts'
import { forgetCanvasStorage, KINDS, mountCanvas, mountDescriptors } from './canvas-runtime.client.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
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

/** Fail g1 and make it the one version of its node, so the node's newest version is the failed one. */
const failG1 = (state: FixtureState): void => {
  state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
    ? { ...entry, status: 'failed' as const, outputs: [], error: { code: 'operation_failed', message: 'GPU out of memory' } }
    : entry)
  addNode(state, 'g1', canvasNode('shot', ['g1'], 480, 0))
}

/**
 * Put a node in the served canvas slice, replacing a node of the same ID in place or adding it last.
 * @param state - the served state.
 * @param id - the node ID.
 * @param node - the node.
 */
function addNode(state: FixtureState, id: string, node: ReturnType<typeof canvasNode>): void {
  const canvas = state.components.canvas
  if (canvas.nodes[id] === undefined) canvas.order.push(id)
  canvas.nodes[id] = node
}

/**
 * @param id - a node ID.
 * @param versions - its versions, oldest first.
 * @returns a state edit that sets the node's versions and keeps its position.
 */
const withVersions = (id: string, versions: string[]) => (state: FixtureState): void => {
  const node = state.components.canvas.nodes[id]
  if (node !== undefined) node.versions = versions
}

/** A node type whose node is 117 units tall while its version renders and 400 once it is done. */
const PAINT: NodeType = {
  id: '@dv/ui-test-paint', type: 'paint', label: () => 'Paint', color: 'var(--dv-node-2)',
  status: { running: () => '渲染中', failed: () => '失败' },
  entry: ({ record: { status } }) => {
    const height = status === 'done' ? 400 : 117
    return { title: 'Paint', sizing: { kind: 'window', defaultSize: { width: 208, height }, minSize: { width: 104, height } } }
  },
}

/**
 * @param finished - whether the record pa has finished.
 * @returns a state edit that adds the paint node pa at (0, 600) at its default size, rendering until `finished`.
 */
const paintRecords = (finished: () => boolean) => (state: FixtureState): void => {
  state.components.proj.records.push(record({ id: 'pa', operation: 'test.paint', status: finished() ? 'done' : 'running' }))
  addNode(state, 'pa', canvasNode('paint', ['pa'], 0, 600))
}

/**
 * @param sizing - the node's default and minimum frame.
 * @returns a node type `half` titled Half that owns the asset shot1-last.png.
 */
const halfType = (sizing: { width: number; height: number; minWidth: number; minHeight: number }): NodeType => ({
  id: '@dv/ui-test-half', type: 'half', label: () => 'Half', color: '',
  entry: () => ({
    title: 'Half', assets: ['shot1-last.png'],
    sizing: { kind: 'window', defaultSize: { width: sizing.width, height: sizing.height }, minSize: { width: sizing.minWidth, height: sizing.minHeight } },
  }),
})

/**
 * @param position - the stored position of the node.
 * @returns a state edit that puts the `half` node h1, a version of the record x1, first in the node list.
 */
const halfNode = (position: { x: number; y: number; width: number | null; height: number | null }) => (state: FixtureState): void => {
  const canvas = state.components.canvas
  canvas.nodes['h1'] = { ...canvasNode('half', ['x1']), position }
  canvas.order.unshift('h1')
}

describe('the canvas over the real kinds', () => {
  it('draws each node at its stored position, shows a reported badge, and writes one canvas.node_position per drag end', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas()
    await mountDescriptors(runtime, { inUse: { id: 'clips', uses: () => [], badges: () => [{ asset: 'shot2.mp4', label: '已裁剪' }] } })
    await waitFor(() => { node('g2') })
    expect([node('g1').style.left, node('g1').style.top, node('g2').style.top]).toEqual(['480px', '0px', '200px'])
    expect(node('g2').getAttribute('data-node-stale')).toBe('true')
    expect(within(node('g2')).getByText('已裁剪')).toBeTruthy()
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    expect(node('g2').style.left).toBe('530px')
    await waitFor(() => { expect(server.positionWrites).toEqual([{ node: 'g2', x: 530, y: 230 }]) })
    expect(operationsOf(server.writes)).toContainEqual(expect.objectContaining({ project: 'p1', operation: 'canvas.node_position', surface: 'canvas', session: 's5' }))
    // The node stays at its new spot once the state shows it.
    await settle()
    expect([node('g2').style.left, node('g2').style.top]).toEqual(['530px', '230px'])
    // A click on the node and a pan of empty canvas write no position.
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 2 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 2 })
    fireEvent.pointerDown(canvasOf(), { button: 0, clientX: 700, clientY: 500, pointerId: 3 })
    fireEvent.pointerMove(canvasOf(), { clientX: 760, clientY: 540, pointerId: 3 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 3 })
    await settle()
    expect(server.positionWrites).toHaveLength(1)
    await runtime.dispose()
  })

  it('puts a node back and writes no position when the browser cancels its drag or resize, and stores a cancelled pan', async () => {
    const { runtime, node, open, server, canvasOf, view } = await mountCanvas()
    await open('g2')
    fireEvent.click(view.getByRole('button', { name: zh['editor.close'] }))
    fireEvent.pointerCancel(canvasOf(), { pointerId: 1 })
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerCancel(canvasOf(), { pointerId: 1 })
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId: 2 })
    fireEvent.pointerMove(canvasOf(), { clientX: 50, clientY: 30, pointerId: 2 })
    expect([node('g2').style.left, node('g2').style.top]).toEqual(['530px', '230px'])
    fireEvent.pointerCancel(canvasOf(), { pointerId: 2 })
    expect([node('g2').style.left, node('g2').style.top]).toEqual(['480px', '200px'])
    const handle = node('g2').querySelector('[data-node-handle="se"]')
    if (handle === null) throw new Error('no south-east handle')
    const width = node('g2').style.width
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0, pointerId: 3 })
    fireEvent.pointerMove(canvasOf(), { clientX: 104, clientY: 0, pointerId: 3 })
    expect(node('g2').style.width).not.toBe(width)
    fireEvent.pointerCancel(canvasOf(), { pointerId: 3 })
    expect(node('g2').style.width).toBe(width)
    fireEvent.pointerDown(canvasOf(), { button: 0, clientX: 700, clientY: 500, pointerId: 4 })
    fireEvent.pointerMove(canvasOf(), { clientX: 760, clientY: 540, pointerId: 4 })
    fireEvent.pointerCancel(canvasOf(), { pointerId: 4 })
    await waitFor(() => { expect(server.layoutWrites).toEqual([{ project: 'p1', viewport: { x: 60, y: 40, zoom: 1 } }]) }, { timeout: 2000 })
    expect(server.positionWrites).toEqual([])
    await runtime.dispose()
  })

  it('writes only the corner of a dragged rendering node, which keeps its type\'s default size when it finishes', async () => {
    let finished = false
    const { runtime, node, server, canvasOf } = await mountCanvas({ edit: paintRecords(() => finished) })
    await mountDescriptors(runtime, { nodeType: PAINT })
    await waitFor(() => { node('pa') })
    fireEvent.pointerDown(node('pa'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 0, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    await waitFor(() => { expect(server.positionWrites).toEqual([{ node: 'pa', x: 0, y: 900 }]) })
    finished = true
    server.notify()
    await waitFor(() => { expect(node('pa').textContent).not.toContain('渲染中') })
    expect([node('pa').style.top, node('pa').querySelector<HTMLElement>('[data-node-frame]')?.style.height]).toEqual(['900px', '400px'])
    await runtime.dispose()
  })

  it('a click selects a node without opening its editor; a second click on it soon after opens it; two presses on a handle do not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { runtime, view, node, canvasOf } = await mountCanvas()
    await waitFor(() => { node('g1') })
    const press = (target: Element, pointerId: number): void => {
      fireEvent.pointerDown(target, { button: 0, clientX: 5, clientY: 5, pointerId })
      fireEvent.pointerUp(canvasOf(), { pointerId })
    }
    press(node('g1'), 1)
    expect([node('g1').getAttribute('data-node-selected'), view.queryByTestId('dv-canvas-node-editor')]).toEqual(['true', null])
    // Four corner handles and four edge strips.
    expect(node('g1').querySelectorAll('[data-node-handle]')).toHaveLength(8)
    // A second click after the double-click pause is another single click.
    vi.setSystemTime(Date.now() + 401)
    press(node('g1'), 2)
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    vi.setSystemTime(Date.now() + 200)
    press(node('g1'), 3)
    expect(view.getByTestId('dv-canvas-node-editor').getAttribute('aria-label')).toBe(node('g1').getAttribute('aria-label'))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    const handle = node('g1').querySelector('[data-node-handle="se"]')
    if (handle === null) throw new Error('no south-east handle')
    press(handle, 4)
    press(handle, 5)
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
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

  it('渲染新版本 runs the edited take based on it, reads 渲染中… until the new version appears, then closes the editor and selects the node', async () => {
    let started = false
    const { runtime, view, node, open, server } = await mountCanvas({
      holdOperations: true,
      edit: (state) => {
        if (!started) return
        state.components.proj.records.push(record({ id: 'n1', operation: 'shot.render', deterministic: false, based_on: 'g3', params: { prompt: 'hero runs' }, status: 'running' }))
        withVersions('g1', ['g1', 'g3', 'n1'])(state)
      },
    })
    const editor = await open('g1')
    fireEvent.change(await waitFor(() => within(editor).getByLabelText('时长')), { target: { value: '3' } })
    fireEvent.click(await sendIn(editor))
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '渲染中…' }).hasAttribute('disabled')).toBe(true) })
    await waitFor(() => { expect(operationsOf(server.writes)).toHaveLength(1) })
    expect(operationsOf(server.writes)[0]).toMatchObject({
      project: 'p1', operation: 'shot.render', surface: 'canvas', session: 's5', based_on: 'g3',
      params: { prompt: 'hero walks, wider', duration_sec: 3 },
    })
    server.notify()
    await settle()
    expect(within(editor).getByRole('button', { name: '渲染中…' })).toBeTruthy()
    started = true
    server.notify()
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    expect(within(node('g1')).getByText('v3')).toBeTruthy()
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
    await waitFor(() => { node('g1') })
    // Takes that were finished at the first load count as seen.
    expect(view.container.querySelectorAll('[data-node-unseen]')).toHaveLength(0)
    finished = true
    server.notify()
    await waitFor(() => { expect(node('g1').getAttribute('data-node-unseen')).toBe('true') })
    expect(within(node('g1')).getByRole('img', { name: zh['node.unseen'] })).toBeTruthy()
    await open('g1')
    expect(node('g1').getAttribute('data-node-unseen')).toBeNull()
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

  it('opens the node that has the requested record as a version, else the node that shows its first output, and nothing for a record no node shows', async () => {
    const opened = async (record: string): Promise<string | null> => {
      const take = vi.fn()
      const { runtime, view, node } = await mountCanvas({ request: { value: { record }, take } })
      await waitFor(() => { node('g1') })
      await settle()
      const editor = view.queryByTestId('dv-canvas-node-editor')
      const id = editor === null ? null : [...view.container.querySelectorAll('[data-node-id]')]
        .find(card => card.getAttribute('aria-label') === editor.getAttribute('aria-label'))?.getAttribute('data-node-id') ?? null
      expect(take).toHaveBeenCalledTimes(id === null ? 0 : 1)
      await runtime.dispose()
      cleanup()
      return id
    }
    // g3 is the second version of g1; the import u1 output ref.png, which the reference node e1 shows; c1 has no node.
    expect([await opened('g3'), await opened('u1'), await opened('c1')]).toEqual(['g1', 'e1', null])
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

describe('removing a node', () => {
  const removal = (...nodes: string[]) => ({ project: 'p1', operation: 'canvas.node_remove', surface: 'canvas', session: 's5', params: { nodes }, intent: expect.stringContaining('remove') as string })
  const removals = (server: { writes: ReadonlyArray<{ path: string; body: unknown }> }): unknown[] =>
    operationsOf(server.writes).filter(write => (write as { operation: string }).operation === 'canvas.node_remove')
  const menuOf = (view: { getByRole: (role: 'menu') => HTMLElement }): HTMLElement => view.getByRole('menu')

  it('opens the right-click menu of a node with its actions and 重命名 above 从画布移除, and OK removes the node, its edges and its selection', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { runtime, view, node, server, canvasOf } = await mountCanvas()
    await mountDescriptors(runtime, { actions: [{ id: '@dv/ui-test-probe:look', label: () => 'look', order: 1, shows: (entry): entry is NodeView => entry.id === 'g1', run: () => undefined }] })
    await waitFor(() => { node('g1') })
    expect(canvasOf().querySelector('[data-edge^="g1>"], [data-edge$=">g1"]')).not.toBeNull()
    fireEvent.contextMenu(node('g1'), { clientX: 300, clientY: 200 })
    const menu = menuOf(view)
    expect(menu.getAttribute('aria-label')).toBe('节点操作')
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['look', '重命名', '从画布移除⌫'])
    expect(within(menu).getByRole('menuitem', { name: /从画布移除/ }).getAttribute('aria-keyshortcuts')).toBe('Delete Backspace')
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /从画布移除/ }))
    expect(confirm).toHaveBeenCalledWith(`从画布移除「${String(node('g1').getAttribute('aria-label'))}」？它的版本保留在素材库中，可在历史记录中恢复该节点。`)
    expect(view.queryByRole('menu')).toBeNull()
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="g1"]')).toBeNull() })
    expect(removals(server)).toEqual([removal('g1')])
    expect(canvasOf().querySelector('[data-edge^="g1>"], [data-edge$=">g1"]')).toBeNull()
    expect(view.container.querySelector('[data-node-selected="true"]')).toBeNull()
    await runtime.dispose()
  })

  it('removes nothing when the user cancels the confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { runtime, view, node, server } = await mountCanvas()
    await waitFor(() => { node('g1') })
    fireEvent.contextMenu(node('g1'), { clientX: 300, clientY: 200 })
    fireEvent.click(within(menuOf(view)).getByRole('menuitem', { name: /从画布移除/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    await settle()
    expect([removals(server), view.queryByRole('menu')]).toEqual([[], null])
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    await runtime.dispose()
  })

  it('runs a node action from the menu and closes the menu', async () => {
    const run = vi.fn<NodeAction['run']>((_node, host) => { host.close() })
    const { runtime, view, node } = await mountCanvas()
    await mountDescriptors(runtime, { actions: [{ id: '@dv/ui-test-probe:look', label: () => 'look', order: 1, shows: (entry): entry is NodeView => entry.id === 'g1', run }] })
    await waitFor(() => { node('g1') })
    fireEvent.contextMenu(node('g1'), { clientX: 300, clientY: 200 })
    fireEvent.click(within(menuOf(view)).getByRole('menuitem', { name: 'look' }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }), expect.anything())
    expect(view.queryByRole('menu')).toBeNull()
    await runtime.dispose()
  })

  it('disables the menu\'s node actions while the node waits for a rerun, and keeps 重命名 and 从画布移除 enabled', async () => {
    const { runtime, view, node } = await mountCanvas({ edit: failG1, holdOperations: true })
    await waitFor(() => { within(node('g1')).getByRole('button', { name: '重试' }) })
    fireEvent.click(within(node('g1')).getByRole('button', { name: '重试' }))
    await waitFor(() => { within(node('g1')).getByRole('button', { name: '渲染中…' }) })
    fireEvent.contextMenu(node('g1'), { clientX: 300, clientY: 200 })
    const items = within(menuOf(view)).getAllByRole('menuitem')
    expect(items.map(item => [item.textContent, item.hasAttribute('disabled')])).toEqual([['重试', true], ['重命名', false], ['从画布移除⌫', false]])
    const inner = createEvent.contextMenu(items[0] as HTMLElement)
    fireEvent(items[0] as HTMLElement, inner)
    expect(inner.defaultPrevented).toBe(true)
    await runtime.dispose()
  })

  it('closes a stacked editor whose node is removed and keeps the editor beneath it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { runtime, view, open } = await mountCanvas()
    const editor = await open('g1')
    fireEvent.click(await tileIn(editor, 'hero@1'))
    const stacked = view.getAllByTestId('dv-canvas-node-editor')[1]
    if (stacked === undefined) throw new Error('no stacked editor')
    fireEvent.click(within(stacked).getByRole('button', { name: zh['node.remove'] }))
    await waitFor(() => { expect(view.getAllByTestId('dv-canvas-node-editor')).toEqual([editor]) })
    await runtime.dispose()
  })

  it('closes the menu on Escape, on a press outside it, and on a zoom, and opens none on empty canvas', async () => {
    const { runtime, view, node, canvasOf } = await mountCanvas()
    await waitFor(() => { node('g1') })
    const open = (): void => { fireEvent.contextMenu(node('g1'), { clientX: 300, clientY: 200 }) }
    open()
    fireEvent.pointerDown(menuOf(view), { button: 0 })
    expect(view.queryByRole('menu')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'a' })
    expect(view.queryByRole('menu')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()
    open()
    fireEvent.pointerDown(document.body, { button: 0 })
    expect(view.queryByRole('menu')).toBeNull()
    open()
    fireEvent.click(view.getByRole('button', { name: zh['canvas.zoomIn'] }))
    expect(view.queryByRole('menu')).toBeNull()
    const empty = createEvent.contextMenu(canvasOf(), { clientX: 700, clientY: 500 })
    fireEvent(canvasOf(), empty)
    expect([view.queryByRole('menu'), empty.defaultPrevented]).toEqual([null, false])
    await runtime.dispose()
  })

  it('keeps the menu inside the canvas: it opens at the pointer where it fits, and left of and above it near the far edges', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80)
    const { runtime, view, node } = await mountCanvas()
    await waitFor(() => { node('g1') })
    fireEvent.contextMenu(node('g1'), { clientX: 100, clientY: 100 })
    expect([menuOf(view).style.left, menuOf(view).style.top]).toEqual(['100px', '100px'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(node('g1'), { clientX: 790, clientY: 590 })
    expect([menuOf(view).style.left, menuOf(view).style.top]).toEqual(['610px', '510px'])
    await runtime.dispose()
  })

  it('removes the selected node on Delete or Backspace after the confirmation, and not while focus is in a text field, an editor is open, or a dialog is up', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { runtime, view, node, open, server, canvasOf } = await mountCanvas()
    await waitFor(() => { node('g1') })
    // No node is selected yet.
    fireEvent.keyDown(canvasOf(), { key: 'Delete' })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    for (const tag of ['input', 'textarea']) {
      const field = document.createElement(tag)
      canvasOf().append(field)
      fireEvent.keyDown(field, { key: 'Backspace' })
      field.remove()
    }
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    canvasOf().append(editable)
    fireEvent.keyDown(editable, { key: 'Delete' })
    editable.remove()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    fireEvent.keyDown(node('g1'), { key: 'Delete' })
    modal.remove()
    fireEvent.keyDown(node('g1'), { key: 'Enter' })
    expect(confirm).not.toHaveBeenCalled()
    const editor = await open('g2')
    fireEvent.keyDown(editor, { key: 'Delete' })
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(within(editor).getByRole('button', { name: zh['editor.close'] }))
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    fireEvent.keyDown(node('g2'), { key: 'Backspace' })
    expect(confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="g2"]')).toBeNull() })
    expect(removals(server)).toEqual([removal('g2')])
    await runtime.dispose()
  })

  it('removes the node of the open editor with its header\'s trash button after the confirmation, and closes the editor', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    const { runtime, view, open, server } = await mountCanvas()
    const editor = await open('g1')
    const trash = within(editor).getByRole('button', { name: zh['node.remove'] })
    expect(trash.getAttribute('title')).toBe('从画布移除')
    const buttons = within(editor).getAllByRole('button')
    expect(buttons.indexOf(trash)).toBe(buttons.indexOf(within(editor).getByRole('button', { name: zh['editor.close'] })) - 1)
    fireEvent.click(trash)
    await settle()
    expect([removals(server), view.queryByTestId('dv-canvas-node-editor')]).toEqual([[], editor])
    fireEvent.click(trash)
    expect(confirm).toHaveBeenCalledTimes(2)
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    expect(removals(server)).toEqual([removal('g1')])
    expect(view.container.querySelector('[data-node-id="g1"]')).toBeNull()
    await runtime.dispose()
  })

  it('drops the selection, the editor and the menu of a node that another writer removed, with no notice', async () => {
    let removed = false
    const { runtime, view, node, open, server } = await mountCanvas({
      edit: (state) => {
        if (!removed) return
        const canvas = state.components.canvas
        canvas.nodes = Object.fromEntries(Object.entries(canvas.nodes).filter(([id]) => id !== 'g1'))
        canvas.order = canvas.order.filter(id => id !== 'g1')
      },
    })
    await open('g1')
    fireEvent.contextMenu(node('g1'), { clientX: 300, clientY: 200 })
    removed = true
    server.notify()
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="g1"]')).toBeNull() })
    expect([view.queryByTestId('dv-canvas-node-editor'), view.queryByRole('menu'), view.queryByRole('alert')]).toEqual([null, null, null])
    expect(view.container.querySelector('[data-node-selected="true"]')).toBeNull()
    await runtime.dispose()
  })

  it('shows the error of a refused removal and keeps the node', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { runtime, view, node } = await mountCanvas({ refuse: (_path, body) => (body as { operation?: string }).operation === 'canvas.node_remove' ? 'The canvas has no node g1. Nothing was removed.' : null })
    await waitFor(() => { node('g1') })
    fireEvent.contextMenu(node('g1'), { clientX: 300, clientY: 200 })
    fireEvent.click(within(menuOf(view)).getByRole('menuitem', { name: /从画布移除/ }))
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('Nothing was removed.') })
    expect(node('g1')).toBeTruthy()
    await runtime.dispose()
  })
})

/** A node type `tl` that uses the shot assets of g1 and g2 and opens through `open` instead of the editor. */
const usingType = (open: (node: NodeView) => void): NodeType => ({
  id: '@dv/ui-test-uses', type: 'tl', label: () => 'Uses', color: 'var(--dv-node-3)', open,
  entry: () => ({
    title: 'Cut', sizing: { kind: 'window', defaultSize: { width: 208, height: 117 }, minSize: { width: 104, height: 59 } },
    uses: { assets: ['shot1.mp4', 'shot2.mp4'], records: ['missing'] },
  }),
})

/** @returns a state edit that adds the `tl` node t9 of the record t9 at (900, 0). */
const usingNode = (state: FixtureState): void => {
  state.components.proj.records.push(record({ id: 't9', operation: 'test.place', params: { item: 'one' } }))
  addNode(state, 't9', canvasNode('tl', ['t9'], 900, 0))
}

describe('nodes that use other nodes, and the add menu', () => {
  it('draws an edge from each used node, outlines the used nodes while the node is selected, and runs the type\'s open on a double click', async () => {
    const open = vi.fn()
    const { runtime, node, canvasOf, view } = await mountCanvas({ edit: usingNode })
    await mountDescriptors(runtime, { nodeType: usingType(open) })
    await waitFor(() => { expect(canvasOf().querySelectorAll('[data-edge$=">t9"]')).toHaveLength(2) })
    expect(canvasOf().querySelector('[data-edge="g1>t9"]')).not.toBeNull()
    expect(canvasOf().querySelector('[data-edge="g2>t9"]')).not.toBeNull()
    const used = (): string[] => [...canvasOf().querySelectorAll('[data-node-used="true"]')].map(card => card.getAttribute('data-node-id') ?? '')
    expect(used()).toEqual([])
    for (const pointerId of [1, 2]) {
      fireEvent.pointerDown(node('t9'), { button: 0, clientX: 5, clientY: 5, pointerId })
      fireEvent.pointerUp(canvasOf(), { pointerId })
    }
    expect(node('t9').getAttribute('data-node-selected')).toBe('true')
    expect(used()).toEqual(['g1', 'g2'])
    // Every other node and edge fades while t9 is selected; its own edges stay in the accent color.
    const dimmed = (): string[] => [...canvasOf().querySelectorAll('[data-node-dimmed="true"]')].map(card => card.getAttribute('data-node-id') ?? '')
    expect(dimmed()).toEqual(['e1'])
    expect([node('e1').style.opacity, node('g1').style.opacity, node('t9').style.opacity]).toEqual(['0.3', '1', '1'])
    const edgeOpacity = (id: string): string | undefined => canvasOf().querySelector<SVGPathElement>(`[data-edge="${id}"]`)?.style.strokeOpacity
    expect([edgeOpacity('g1>t9'), edgeOpacity('e1>g1')]).toEqual(['0.9', String(0.6 * 0.3)])
    expect(node('g1').querySelector<HTMLElement>('[data-node-frame]')?.style.boxShadow).toContain('16px 3px')
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]?.[0]).toMatchObject({ id: 't9', type: 'tl', title: 'Cut' })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 5, clientY: 5, pointerId: 3 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 3 })
    expect([used(), dimmed(), edgeOpacity('e1>g1')]).toEqual([[], [], '0.9'])
  })

  it('lists the add menu sections; an item already on the canvas selects its node, and another item writes its request and selects its new node', async () => {
    let placed = false
    const { runtime, node, canvasOf, view, server } = await mountCanvas({
      edit: (state) => {
        if (!placed) return
        state.components.proj.records.push(record({ id: 'new-1', operation: 'test.place', params: { item: 'two' } }))
        addNode(state, 'new-1', canvasNode('tl', ['new-1'], 900, 300))
      },
    })
    const section: AddMenuSection = {
      id: '@dv/ui-test-uses', order: 1, label: () => '项目',
      items: state => [
        { key: 'one', label: '第一项', node: state.components.canvas.nodes['g1'] === undefined ? null : 'g1', request: { operation: 'test.place', params: { item: 'one' } } },
        { key: 'two', label: '第二项', node: state.components.canvas.nodes['new-1'] === undefined ? null : 'new-1', request: { operation: 'test.place', params: { item: 'two' }, intent: 'place two' } },
      ],
    }
    const empty: AddMenuSection = { id: '@dv/ui-test-empty', order: 2, label: () => '空', items: () => [] }
    await mountDescriptors(runtime, { nodeType: usingType(() => undefined), addMenu: section })
    await mountDescriptors(runtime, { addMenu: empty })
    await waitFor(() => { node('g1') })
    const button = within(canvasOf()).getByRole('button', { name: zh['add.button'] })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    const menu = view.getByTestId('dv-canvas-add-menu')
    expect(menu.getAttribute('aria-label')).toBe(zh['add.label'])
    expect([...menu.querySelectorAll('[role="group"]')].map(group => group.getAttribute('aria-label'))).toEqual(['项目', '空'])
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([`第一项${zh['add.placed']}`, '第二项'])
    expect(within(menu).getByText(zh['add.empty'])).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: `第一项${zh['add.placed']}` }))
    expect(view.queryByTestId('dv-canvas-add-menu')).toBeNull()
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    expect(server.writes.filter(write => write.path === '/api/dv/operation')).toEqual([])
    fireEvent.click(button)
    // Another key, a press and a right click inside the menu keep it open.
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.pointerDown(view.getByTestId('dv-canvas-add-menu'), { button: 0, pointerId: 8 })
    expect(fireEvent.contextMenu(view.getByTestId('dv-canvas-add-menu'))).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-add-menu')).toBeNull()
    fireEvent.click(button)
    placed = true
    fireEvent.click(within(view.getByTestId('dv-canvas-add-menu')).getByRole('menuitem', { name: '第二项' }))
    await waitFor(() => { expect(server.writes.filter(write => write.path === '/api/dv/operation')).toHaveLength(1) })
    expect(server.writes.find(write => write.path === '/api/dv/operation')?.body).toMatchObject({
      project: 'p1', operation: 'test.place', params: { item: 'two' }, intent: 'place two', surface: 'canvas', session: 's5',
    })
    act(() => { server.notify() })
    await waitFor(() => { expect(node('new-1').getAttribute('data-node-selected')).toBe('true') })
    // A press outside the menu closes it.
    fireEvent.click(button)
    fireEvent.pointerDown(canvasOf(), { button: 2, pointerId: 9 })
    expect(view.queryByTestId('dv-canvas-add-menu')).toBeNull()
  })

  it('shows the empty words in an add menu without sections', async () => {
    const { canvasOf, view, node } = await mountCanvas()
    await waitFor(() => { node('g1') })
    fireEvent.click(within(canvasOf()).getByRole('button', { name: zh['add.button'] }))
    expect(within(view.getByTestId('dv-canvas-add-menu')).getByText(zh['add.empty'])).toBeTruthy()
  })
})

describe('drops on the canvas', () => {
  it('puts a dropped 素材 tile on the canvas with asset.place, moves its node under the pointer, and 从画布移除 takes it off with canvas.node_remove', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { runtime, view, node, open, server, canvasOf } = await mountCanvas({
      edit: (state) => {
        state.assets.push(asset('pool.png', 'image/png', 'u2'))
        state.components.proj.records.push(record({ id: 'u2', operation: 'asset.import', params: { name: 'pool.png' }, outputs: ['pool.png'], surface: 'asset_pool' }))
        state.components.proj.created_by['pool.png'] = 'u2'
      },
    })
    await waitFor(() => { node('g1') })
    expect(view.container.querySelector('[data-node-id="place1"]')).toBeNull()
    dropAt(canvasOf(), tileDrag('pool.png'))
    await waitFor(() => { expect(node('place1').style.left).toBe(`${String(500 - 208 / 2)}px`) })
    expect(server.positionWrites).toEqual([expect.objectContaining({ node: 'place1', x: 500 - 208 / 2 })])
    const placement = (operation: string) => ({ project: 'p1', operation, surface: 'canvas', inputs: [{ role: 'asset', ref: 'pool.png' }], session: 's5' })
    await waitFor(() => { expect(operationsOf(server.writes)).toContainEqual(placement('asset.place')) })
    const editor = await open('place1')
    fireEvent.click(within(editor).getByRole('button', { name: '从画布移除' }))
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="place1"]')).toBeNull() })
    expect(operationsOf(server.writes)).toContainEqual(expect.objectContaining({ operation: 'canvas.node_remove', params: { nodes: ['place1'] } }))
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await runtime.dispose()
  })

  it('places a dropped 素材 tile of an asset that no record of the current state imported, and draws its placement node', async () => {
    const { runtime, view, node, server, canvasOf } = await mountCanvas({
      edit: (state) => { state.assets.push(asset('undone.png', 'image/png', 'u9', null, 'asset.import')) },
    })
    await waitFor(() => { node('g1') })
    dropAt(canvasOf(), tileDrag('undone.png'))
    await waitFor(() => {
      expect(operationsOf(server.writes)).toContainEqual({ project: 'p1', operation: 'asset.place', surface: 'canvas', inputs: [{ role: 'asset', ref: 'undone.png' }], session: 's5' })
    })
    await waitFor(() => { expect(node('place1').getAttribute('aria-label')).toBe('undone.png') })
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
        if (placed.includes('chat.png')) addNode(state, 'u2', canvasNode('asset', ['u2'], 0, 400))
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
    await waitFor(() => { expect(node('imp1').style.left).toBe(`${String(500 - 208 / 2)}px`) })
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
    return left < 0 || top < 0 || left + 208 * zoom > width || top + 180 * zoom > height
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
    const { runtime, node, canvasOf } = await mountCanvas({ layout: { viewport: null } })
    await waitFor(() => { node('g2') })
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

  it('fits the nodes at their stored positions when the stored viewport cannot be read', async () => {
    const { runtime, node, canvasOf } = await mountCanvas({ layout: null })
    await waitFor(() => { node('g1') })
    await waitFor(() => { expect(cardsOutside(canvasOf(), 800, 600)).toEqual([]) })
    expect(node('g1').style.left).toBe('480px')
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
    const panned = { project: 'p1', viewport: { x: 60, y: 40, zoom: 1 } }
    await waitFor(() => { expect(server.layoutWrites).toEqual([panned]) }, { timeout: 2000 })
    expect(server.positionWrites).toEqual([])
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
    // jsdom lays out nothing, so the canvas counts as 800 × 600 and zooms around (400, 300).
    fireEvent.click(within(zoomBar).getByRole('button', { name: zh['canvas.zoomIn'] }))
    expect(viewportOf(canvas)).toEqual({ x: -80, y: -60, zoom: 1.2 })
    expect(zoomBar.textContent).toContain('120%')
    fireEvent.click(within(zoomBar).getByRole('button', { name: zh['canvas.zoomOut'] }))
    expect(zoomBar.textContent).toContain('100%')
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(1) }, { timeout: 2000 })
    const { x, y, zoom } = server.layoutWrites[0]?.viewport ?? { x: NaN, y: NaN, zoom: NaN }
    expect([x, y, zoom].map(value => Math.round(value * 1000) / 1000)).toEqual([0, 0, 1])
    await settle()
    expect(server.layoutWrites).toHaveLength(1)
    await runtime.dispose()
  })

  it('适应 keeps the zoom of a canvas without nodes and of a project whose state fails to load, which shows the error', async () => {
    const empty = await mountCanvas({ kinds: [], edit: (state) => { state.components.canvas = { nodes: {}, order: [], assets: {} } } })
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
    const { runtime, view, node, server, canvasOf } = await mountCanvas({ refuse: path => path === '/api/dv/canvas/layout' ? 'read-only' : null })
    await waitFor(() => { node('g1') })
    act(() => { canvasOf().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })) })
    await waitFor(() => { expect(server.layoutWrites).toHaveLength(1) }, { timeout: 2000 })
    await settle()
    expect(view.queryByRole('alert')).toBeNull()
    await runtime.dispose()
  })

  it('keeps a node dragged before the stored viewport arrives at its dragged spot, which its move record stores', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas({ holdLayout: true })
    await waitFor(() => { node('g1') })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 300, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    server.releaseLayout('p1')
    await waitFor(() => { expect(server.positionWrites).toEqual([{ node: 'g1', x: 780, y: 300 }]) })
    await settle()
    expect([node('g1').style.left, node('g1').style.top]).toEqual(['780px', '300px'])
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
        const rerun = record({ id: 'n1', operation: 'shot.render', deterministic: false, based_on: 'g3', status: 'running' })
        state.components.proj.records.push(rerun)
        withVersions('g1', ['g1', 'g3', 'n1'])(state)
      },
    })
    const editor = await open('g1')
    fireEvent.click(await sendIn(editor))
    started = true
    server.notify()
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    expect(node('g1').getAttribute('data-node-selected')).toBe('true')
    server.releaseOperations()
    expect((await view.findByRole('alert')).textContent).toBe('失败：lost connection')
    await runtime.dispose()
  })

  it('draws no node for a dropped 素材 tile whose placement the server refuses, and shows the error', async () => {
    const { runtime, view, node, server, canvasOf } = await mountCanvas({
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
    // A later state still draws no node for the refused drop.
    server.notify()
    await settle()
    expect(view.container.querySelectorAll('[data-node-type="asset"]')).toHaveLength(0)
    await runtime.dispose()
  })
})

describe('refused position writes', () => {
  it('draws a dragged node back at its stored spot and shows the error when the server refuses its move', async () => {
    const { runtime, view, node, server, canvasOf } = await mountCanvas({ refuse: refuseOperation('canvas.node_position', 'read-only project') })
    await waitFor(() => { node('g2') })
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    expect(node('g2').style.left).toBe('530px')
    expect((await view.findByRole('alert')).textContent).toBe('失败：read-only project')
    expect(server.positionWrites).toEqual([{ node: 'g2', x: 530, y: 230 }])
    await waitFor(() => { expect([node('g2').style.left, node('g2').style.top]).toEqual(['480px', '200px']) })
    await runtime.dispose()
  })

  it('keeps the box of a later move while the refusal of an earlier one arrives, then draws the node back at its stored spot', async () => {
    const { runtime, view, node, server, canvasOf } = await mountCanvas({ holdOperations: true, refuse: refuseOperation('canvas.node_position', 'read-only project') })
    await waitFor(() => { node('g2') })
    // The second drag starts from the box of the first, which the server has not answered yet.
    for (const pointerId of [1, 2]) {
      fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId })
      fireEvent.pointerMove(canvasOf(), { clientX: 50, clientY: 0, pointerId })
      fireEvent.pointerUp(canvasOf(), { pointerId })
    }
    expect(server.positionWrites).toEqual([{ node: 'g2', x: 530, y: 200 }, { node: 'g2', x: 580, y: 200 }])
    expect(node('g2').style.left).toBe('580px')
    server.releaseOperations()
    expect((await view.findByRole('alert')).textContent).toBe('失败：read-only project')
    await waitFor(() => { expect(node('g2').style.left).toBe('480px') })
    await runtime.dispose()
  })

  it('keeps the box of a later move while the state shows only the earlier move that the server answered', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas({ holdOperations: true })
    await waitFor(() => { node('g2') })
    for (const pointerId of [1, 2]) {
      fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId })
      fireEvent.pointerMove(canvasOf(), { clientX: 50, clientY: 0, pointerId })
      fireEvent.pointerUp(canvasOf(), { pointerId })
    }
    server.releaseOperations(1)
    await settle()
    expect(node('g2').style.left).toBe('580px')
    server.releaseOperations()
    await settle()
    expect(node('g2').style.left).toBe('580px')
    await runtime.dispose()
  })

  it('draws a resized node back at its stored size when the server refuses the resize', async () => {
    const { runtime, view, node, open, canvasOf } = await mountCanvas({ refuse: refuseOperation('canvas.node_position', 'read-only project') })
    await open('g2')
    const handle = node('g2').querySelector('[data-node-handle="se"]')
    if (handle === null) throw new Error('no south-east handle')
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0, pointerId: 2 })
    fireEvent.pointerMove(canvasOf(), { clientX: 104, clientY: 0, pointerId: 2 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 2 })
    expect(node('g2').style.width).toBe('312px')
    expect((await view.findByRole('alert')).textContent).toBe('失败：read-only project')
    await waitFor(() => { expect(node('g2').style.width).toBe('208px') })
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

  it('closes the editor once a rerun of a record that no node shows ends', async () => {
    const { runtime, view, open, server } = await mountCanvas({ holdOperations: true })
    await mountDescriptors(runtime, {
      actions: [onG1('rerun x1', 1, (_node, host) => { host.rerun({ operation: 'asset.grab_still', inputs: [], params: {}, intent: 'rerun x1', based_on: 'x1' }) })],
    })
    const editor = await open('g1')
    fireEvent.click(within(editor).getByRole('button', { name: 'rerun x1' }))
    await waitFor(() => { expect(operationsOf(server.writes)).toContainEqual(expect.objectContaining({ operation: 'asset.grab_still', based_on: 'x1' })) })
    expect(view.getByTestId('dv-canvas-node-editor')).toBeTruthy()
    server.releaseOperations()
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    await runtime.dispose()
  })

  it('ends the wait of a take editor whose rerun a rerun from a stacked editor replaces, with no failure notice', async () => {
    const { runtime, view, open } = await mountCanvas({ holdOperations: true })
    const rerunG2: NodeAction = {
      id: '@dv/ui-test-probe:rerun', label: () => 'rerun g2', order: 1, shows: (node): node is NodeView => node.id === 'e1',
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

  it('moves the node of a dropped 素材 tile that the canvas already draws under the pointer, centered at its stored width, and writes no placement', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas({
      edit: (state) => { addNode(state, 'g1', canvasNode('shot', ['g1', 'g3'], 10, 20, { position: { x: 10, y: 20, width: 312, height: 176 } })) },
    })
    await waitFor(() => { node('g1') })
    dropAt(canvasOf(), tileDrag('shot1.mp4'))
    expect([node('g1').style.left, node('g1').style.width]).toEqual([`${String(500 - 312 / 2)}px`, '312px'])
    await settle()
    expect(operationsOf(server.writes).map(write => (write as { operation: string }).operation)).toEqual(['canvas.node_position'])
    expect(server.positionWrites).toEqual([expect.objectContaining({ node: 'g1', x: 500 - 312 / 2 })])
    await runtime.dispose()
  })

  it('draws a dropped file\'s node as a plain card at the drop spot until the asset type registers, then as an asset', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas({ kinds: ['reference', 'takes', 'media'] })
    await waitFor(() => { node('g1') })
    dropAt(canvasOf(), { types: ['Files'], getData: () => '', files: [new File(['x'], 'later.png', { type: 'image/png' })] })
    await waitFor(() => { expect(server.imports).toHaveLength(1) })
    await waitFor(() => { expect(node('imp1').style.left).toBe(`${String(500 - 208 / 2)}px`) })
    expect(node('imp1').getAttribute('aria-label')).toBe('asset.import')
    await runtime.mount(KINDS.assets)
    await waitFor(() => { expect(node('imp1').getAttribute('aria-label')).toBe('later.png') })
    expect(node('imp1').style.left).toBe(`${String(500 - 208 / 2)}px`)
    await runtime.dispose()
  })
})

describe('the node card', () => {
  it('fades a node whose newest version is superseded, and draws the failure words of a type without its own', async () => {
    const { runtime, node } = await mountCanvas({
      edit: (state) => {
        state.components.proj.superseded = { g3: 'g9' }
        const records = state.components.proj.records
        state.components.proj.records = records.map(entry => entry.id === 'e1' ? { ...entry, status: 'failed' as const } : entry)
      },
    })
    await waitFor(() => { node('e1') })
    expect([node('g1').style.opacity, node('g2').style.opacity]).toEqual(['0.55', '1'])
    expect(node('e1').textContent).toContain(zh['node.failed'])
    await runtime.dispose()
  })

  it('draws every node as a caption above a frame that holds its body, with no card fill or shadow, and rings the selected frame', async () => {
    const { runtime, node, open } = await mountCanvas({ edit: (state) => { addNode(state, 'n1', canvasNode('note', ['x1'], 0, 400)) } })
    await waitFor(() => { node('e1') })
    for (const id of ['e1', 'g1']) {
      const frame = node(id).querySelector<HTMLElement>(':scope > [data-node-frame]')
      if (frame === null) throw new Error(`no frame of ${id}`)
      expect([node(id).style.background, node(id).style.boxShadow, frame.style.background]).toEqual(['', '', ''])
      expect(frame.style.boxShadow).toBe('0 0 0 1px var(--dv-line-strong)')
      // The caption is the node's first child, outside the frame, and carries the title.
      expect(node(id).firstElementChild?.textContent).toContain(node(id).getAttribute('aria-label'))
      expect(frame.contains(node(id).firstElementChild)).toBe(false)
    }
    // A kind without a card body draws its type label on the card surface.
    expect(node('n1').querySelector('[data-node-frame]')?.textContent).toBe('note')
    await open('g1')
    expect(node('g1').querySelector<HTMLElement>('[data-node-frame]')?.style.boxShadow).toBe('0 0 0 2px var(--dv-accent), 0 0 0 6px var(--dv-accent-soft)')
    await runtime.dispose()
  })

  it('draws a node whose stored width and height are null at its type\'s default size, and anchors its edges there', async () => {
    const { runtime, view, node, server } = await mountCanvas({ edit: halfNode({ x: 0, y: 400, width: null, height: null }) })
    // The half node comes first in the node list and owns g1's last frame, so g2's first-frame edge starts at it.
    await mountDescriptors(runtime, { nodeType: halfType({ width: 312, height: 104, minWidth: 104, minHeight: 52 }) })
    await waitFor(() => { expect(node('h1').getAttribute('aria-label')).toBe('Half') })
    expect([node('h1').style.width, node('h1').querySelector<HTMLElement>('[data-node-frame]')?.style.height]).toEqual(['312px', '104px'])
    const edge = await waitFor(() => {
      const found = view.container.querySelector('path[data-edge="h1>g2"]')
      if (found === null) throw new Error('no edge from h1')
      return found
    })
    const [x1, y1] = (edge.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? []
    expect([x1, y1]).toEqual([Number.parseFloat(node('h1').style.left) + 312, Number.parseFloat(node('h1').style.top) + 20 + 104 / 2])
    await settle()
    expect(server.positionWrites).toEqual([])
    await runtime.dispose()
  })

  it('draws a node at its stored size, resizes the selected node from its south-east handle at the zoom, writes one request per resize end, and keeps the size through a drag', async () => {
    const { runtime, node, open, server, canvasOf } = await mountCanvas({
      layout: { viewport: { x: 0, y: 0, zoom: 0.5 } },
      edit: (state) => { addNode(state, 'g1', canvasNode('shot', ['g1', 'g3'], 0, 0, { position: { x: 10, y: 20, width: 312, height: 90 } })) },
    })
    await waitFor(() => { node('g1') })
    const box = (): string[] => [node('g1').style.left, node('g1').style.top, node('g1').style.width, node('g1').querySelector<HTMLElement>('[data-node-frame]')?.style.height ?? '']
    expect(box()).toEqual(['10px', '20px', '312px', '90px'])
    expect(node('g1').querySelector('[data-node-handle]')).toBeNull()
    await open('g1')
    // Four corner handles and four edge strips.
    expect(node('g1').querySelectorAll('[data-node-handle]')).toHaveLength(8)
    const handle = node('g1').querySelector('[data-node-handle="se"]')
    if (handle === null) throw new Error('no south-east handle')
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0, pointerId: 2 })
    fireEvent.pointerMove(canvasOf(), { clientX: 26, clientY: 0, pointerId: 2 })
    fireEvent.pointerMove(canvasOf(), { clientX: 52, clientY: 0, pointerId: 2 })
    expect(server.positionWrites).toEqual([])
    fireEvent.pointerUp(canvasOf(), { pointerId: 2 })
    // 52 px at 50% zoom are 104 units; g1 is a 16:9 take, so its frame keeps 16:9 and its top-left corner stays.
    expect(box()).toEqual(['10px', '20px', '416px', '234px'])
    await waitFor(() => { expect(server.positionWrites).toEqual([{ node: 'g1', x: 10, y: 20, width: 416, height: 234 }]) })
    fireEvent.pointerDown(node('g1'), { button: 0, clientX: 0, clientY: 0, pointerId: 3 })
    fireEvent.pointerMove(canvasOf(), { clientX: 10, clientY: 10, pointerId: 3 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 3 })
    await waitFor(() => { expect(server.positionWrites).toHaveLength(2) })
    expect(server.positionWrites[1]).toEqual({ node: 'g1', x: 30, y: 40 })
    await settle()
    expect(box()).toEqual(['30px', '40px', '416px', '234px'])
    await runtime.dispose()
  })

  it('a north-west handle resizes a window node in width and height apart, keeps the opposite corner in place, and stops at its minimum size; a still press or another button changes nothing', async () => {
    const { runtime, view, node, canvasOf } = await mountCanvas({ edit: halfNode({ x: 100, y: 100, width: 208, height: 104 }) })
    await mountDescriptors(runtime, { nodeType: halfType({ width: 208, height: 104, minWidth: 120, minHeight: 60 }) })
    await waitFor(() => { expect(node('h1').getAttribute('aria-label')).toBe('Half') })
    fireEvent.pointerDown(node('h1'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    await waitFor(() => { expect(node('h1').getAttribute('data-node-selected')).toBe('true') })
    const handle = (): Element => {
      const found = node('h1').querySelector('[data-node-handle="nw"]')
      if (found === null) throw new Error('no north-west handle')
      return found
    }
    const box = (): string[] => [
      node('h1').style.left, node('h1').style.top, node('h1').style.width, node('h1').querySelector<HTMLElement>('[data-node-frame]')?.style.height ?? '',
    ]
    const drag = (dx: number, dy: number, pointerId: number, button = 0): void => {
      fireEvent.pointerDown(handle(), { button, clientX: 0, clientY: 0, pointerId })
      fireEvent.pointerMove(canvasOf(), { clientX: dx, clientY: dy, pointerId })
      fireEvent.pointerUp(canvasOf(), { pointerId })
    }
    // 100 units wider and 10 taller: the node moves up and left so its bottom-right corner stays at (308, 204).
    drag(-100, -10, 2)
    expect(box()).toEqual(['0px', '90px', '308px', '114px'])
    drag(500, 500, 3)
    expect(box()).toEqual(['188px', '144px', '120px', '60px'])
    fireEvent.pointerDown(handle(), { button: 0, clientX: 0, clientY: 0, pointerId: 4 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 4 })
    await settle()
    expect([node('h1').getAttribute('data-node-selected'), view.queryAllByTestId('dv-canvas-node-editor')]).toEqual(['true', []])
    drag(-300, 0, 5, 2)
    expect(box()).toEqual(['188px', '144px', '120px', '60px'])
    await runtime.dispose()
  })

  it('keeps the frame height of a failed take and draws its failed words and 重试 inside the frame', async () => {
    const { runtime, node } = await mountCanvas({ edit: failG1 })
    await waitFor(() => { node('g1') })
    const frame = node('g1').querySelector<HTMLElement>('[data-node-frame]')
    expect(frame?.style.height).toBe('117px')
    expect(frame?.textContent).toBe('生成失败：GPU out of memory重试')
    await runtime.dispose()
  })

  it('draws the failed words and reason of a failed take on lines of their own, clamped to 3, above a row of its actions', async () => {
    const { runtime, node } = await mountCanvas({ edit: failG1 })
    await waitFor(() => { node('g1') })
    const reason = [...node('g1').querySelectorAll<HTMLElement>('[data-node-frame] span')].find(span => span.textContent === '生成失败：GPU out of memory')
    expect(reason?.parentElement?.style.flexDirection).toBe('column')
    expect(reason?.querySelector('button')).toBeNull()
    expect(reason?.nextElementSibling?.querySelectorAll('button').length).toBe(1)
    expect([reason?.style.whiteSpace, reason?.style.getPropertyValue('-webkit-line-clamp')]).toEqual(['', '3'])
    await runtime.dispose()
  })

  it('reads Queued… on a pending node and the running words on a running node that has no start time, neither with a time', async () => {
    const { runtime, node } = await mountCanvas({
      edit: (state) => {
        state.components.proj.records.push(record({ id: 'pa', operation: 'test.paint', status: 'pending' }), record({ id: 'pb', operation: 'test.paint', status: 'running' }))
        addNode(state, 'pa', canvasNode('paint', ['pa'], 0, 600))
        addNode(state, 'pb', canvasNode('paint', ['pb'], 300, 600))
      },
    })
    await mountDescriptors(runtime, { nodeType: PAINT })
    await waitFor(() => { node('pb') })
    expect([node('pa').textContent, node('pb').textContent]).toEqual([expect.stringContaining(zh['node.queued']), expect.stringContaining('渲染中')])
    expect(node('pa').textContent).not.toMatch(/\d:\d\d/)
    expect(node('pb').textContent).not.toMatch(/\d:\d\d/)
    await runtime.dispose()
  })

  it('counts the time a running node has rendered, once a second, in tabular numerals', async () => {
    // Only the clock and the tick are fake, so the canvas's fetches and `waitFor` keep their real timeouts.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-11-09T10:01:12Z'))
    const startedAt = '2026-11-09T10:00:00Z'
    const { runtime, node } = await mountCanvas({
      edit: (state) => {
        state.components.proj.records.push(record({ id: 'pa', operation: 'test.paint', status: 'running', started_at: startedAt }))
        addNode(state, 'pa', canvasNode('paint', ['pa'], 0, 600))
      },
    })
    await mountDescriptors(runtime, { nodeType: PAINT })
    const timeOf = (): string | undefined => node('pa').querySelector<HTMLElement>('span[style*="tabular-nums"]')?.textContent
    await waitFor(() => { expect(timeOf()).toBe('1:12') })
    // The overlay is a flex box, so the running words and the time stay one child element to keep the space between them.
    const overlay = [...node('pa').querySelectorAll<HTMLElement>('span')].find(span => span.style.display === 'flex' && span.textContent.includes('渲染中'))
    expect([overlay?.childNodes.length, overlay?.firstElementChild?.textContent]).toEqual([1, '渲染中 1:12'])
    act(() => { vi.advanceTimersByTime(1000) })
    expect(timeOf()).toBe('1:13')
    expect(node('pa').textContent).toContain('渲染中')
    await runtime.dispose()
  })

  it('draws only the failed words of a failed take whose record carries no error', async () => {
    const { runtime, node } = await mountCanvas({
      edit: (state) => {
        failG1(state)
        state.components.proj.records = state.components.proj.records.map((entry) => {
          if (entry.id !== 'g1') return entry
          const { error: _error, ...withoutError } = entry
          return withoutError
        })
      },
    })
    await waitFor(() => { node('g1') })
    expect(node('g1').querySelector<HTMLElement>('[data-node-frame]')?.textContent).toBe('生成失败重试')
    await runtime.dispose()
  })

  it('attaches an edge at the middle of each node\'s frame, below the caption', async () => {
    const { runtime, view, node } = await mountCanvas()
    const edge = await waitFor(() => {
      const found = view.container.querySelector('path[data-edge="e1>g1"]')
      if (found === null) throw new Error('no edge into g1')
      return found
    })
    const points = (edge.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? []
    const [x1, y1] = points
    const [x2, y2] = points.slice(-2)
    const top = (id: string): number => Number.parseFloat(node(id).style.top)
    const frameHeight = (id: string): number => Number.parseFloat(node(id).querySelector<HTMLElement>('[data-node-frame]')?.style.height ?? '')
    expect([x1, y1]).toEqual([Number.parseFloat(node('e1').style.left) + 208, top('e1') + 20 + frameHeight('e1') / 2])
    expect([x2, y2]).toEqual([Number.parseFloat(node('g1').style.left), top('g1') + 20 + 117 / 2])
    await runtime.dispose()
  })

  it('grows a caption at most 1.4 times on a zoomed-out canvas, with the frame and edges below it, and hides it below 8 px on screen', async () => {
    const at = async (zoom: number): Promise<{ font: string; height: string; visibility: string; edgeY: number | undefined }> => {
      const { runtime, view, node } = await mountCanvas({ layout: { viewport: { x: 0, y: 0, zoom } } })
      const edge = await waitFor(() => {
        const found = view.container.querySelector('path[data-edge="e1>g1"]')
        if (found === null) throw new Error('no edge into g1')
        return found
      })
      const caption = node('g1').firstElementChild as HTMLElement
      const y = (edge.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number).at(-1)
      const result = { font: caption.style.fontSize, height: caption.style.height, visibility: caption.style.visibility, edgeY: y === undefined ? undefined : y - Number.parseFloat(node('g1').style.top) }
      await runtime.dispose()
      return result
    }
    // At 50% zoom the body text grows 1.6 times; the caption stops at 1.4 times: a 17 px font in a 28-unit caption.
    expect(await at(0.5)).toEqual({ font: '17px', height: '28px', visibility: '', edgeY: 28 + 117 / 2 })
    // At 40% zoom a 1.4-times caption is 6.7 px on screen, so the node hides it and keeps its frame in place.
    expect(await at(0.4)).toEqual({ font: '17px', height: '28px', visibility: 'hidden', edgeY: 28 + 117 / 2 })
  })
})

describe('node versions', () => {
  /** A state edit that finishes g3 and adds g4, a third version of g1 based on g3. */
  const threeVersions = (state: FixtureState): void => {
    const records = state.components.proj.records.map(entry => entry.id === 'g3' ? { ...entry, status: 'done' as const, outputs: ['shot3.mp4'] } : entry)
    const g4 = record({ id: 'g4', operation: 'shot.render', deterministic: false, based_on: 'g3', params: { prompt: 'hero sits down' }, outputs: ['shot4.mp4'] })
    state.components.proj.records = [...records, g4]
    state.assets.push(asset('shot3.mp4', 'video/mp4', 'g3', 2, 'shot.render'), asset('shot4.mp4', 'video/mp4', 'g4', 5, 'shot.render'))
    Object.assign(state.components.proj.created_by, { 'shot3.mp4': 'g3', 'shot4.mp4': 'g4' })
    withVersions('g1', ['g1', 'g3', 'g4'])(state)
  }

  it('captions a node of several versions with its version count beside the type meta, and draws two frames behind it', async () => {
    const { runtime, node } = await mountCanvas({ edit: threeVersions })
    await waitFor(() => { expect(within(node('g1')).getByText('v3 · 5.0s')).toBeTruthy() })
    expect(node('g1').querySelectorAll('[data-node-version-frame]')).toHaveLength(2)
    expect(within(node('g2')).getByText('6.0s')).toBeTruthy()
    expect(node('g2').querySelectorAll('[data-node-version-frame]')).toHaveLength(0)
    await runtime.dispose()
  })

  it('shows the versions in order in the editor\'s strip; choosing one shows it in the editor while the card keeps the newest', async () => {
    const { runtime, node, open } = await mountCanvas({ edit: threeVersions })
    const editor = await open('g1')
    const strip = within(editor).getByTestId('dv-canvas-version-strip')
    const versions = (): Array<[string | null, string | null]> => [...strip.querySelectorAll('button[data-version]')]
      .map(button => [button.getAttribute('data-version'), button.getAttribute('aria-selected')])
    expect(versions()).toEqual([['g1', 'false'], ['g3', 'false'], ['g4', 'true']])
    expect(strip.textContent).toContain('第 3 / 3 版')
    await waitFor(() => { expect(editor.textContent).toContain('hero sits down') })
    const card = node('g1').innerHTML
    fireEvent.click(within(strip).getByRole('option', { name: 'v1' }))
    expect(versions()).toEqual([['g1', 'true'], ['g3', 'false'], ['g4', 'false']])
    await waitFor(() => { expect(editor.textContent).toContain('hero walks through the rain at night in the city') })
    expect(editor.textContent).not.toContain('hero sits down')
    expect(strip.textContent).toContain('第 1 / 3 版')
    expect(node('g1').innerHTML).toBe(card)
    await runtime.dispose()
  })

  it('shows the newest version again once the chosen version leaves the node', async () => {
    let undone = false
    const { runtime, open, server } = await mountCanvas({
      edit: (state) => {
        threeVersions(state)
        if (undone) withVersions('g1', ['g1', 'g4'])(state)
      },
    })
    const editor = await open('g1')
    fireEvent.click(within(within(editor).getByTestId('dv-canvas-version-strip')).getByRole('option', { name: 'v2' }))
    await waitFor(() => { expect(editor.textContent).toContain('hero walks, wider') })
    undone = true
    server.notify()
    await waitFor(() => { expect(editor.textContent).toContain('hero sits down') })
    expect(within(editor).getByTestId('dv-canvas-version-strip').textContent).toContain('第 2 / 2 版')
    await runtime.dispose()
  })

  it('shows no version strip for a node of one version', async () => {
    const { runtime, open } = await mountCanvas()
    const editor = await open('g2')
    expect(within(editor).queryByTestId('dv-canvas-version-strip')).toBeNull()
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

  it('shows the type and the newest version above the title in the header', async () => {
    const { runtime, open } = await mountCanvas({ edit: (state) => { addNode(state, 'n1', canvasNode('note', ['x1'], 0, 400)) } })
    await mountDescriptors(runtime, {
      nodeType: {
        id: '@dv/ui-test-note', type: 'note', label: () => 'Note', color: '',
        entry: () => ({ title: 'Note', sizing: { kind: 'window', defaultSize: { width: 208, height: 30 }, minSize: { width: 104, height: 30 } } }),
      },
    })
    const editor = await open('n1')
    expect(editor.querySelector('header')?.textContent).toBe('Note · v1Note')
    await runtime.dispose()
  })
})

describe('the canvas answering the canvas tools', () => {
  /**
   * Mount the canvas over a scripted canvas link, and return `ask`, which writes a read frame on every open stream of a
   * project and returns the answer, and the streams opened so far.
   */
  async function mountForAgent(options: Parameters<typeof mountCanvas>[0] = {}) {
    const streams: Array<{ project: string; session: string | null; listener: StreamListener; open: boolean }> = []
    vi.spyOn(httpLink, 'open').mockImplementation((project, session, listener) => {
      const stream = { project, session, listener, open: true }
      streams.push(stream)
      return () => { stream.open = false }
    })
    const answers: CanvasDrawn[] = []
    vi.spyOn(httpLink, 'answer').mockImplementation((drawn) => { answers.push(drawn) })
    const mounted = await mountCanvas(options)
    const live = (project: string) => streams.filter(stream => stream.open && stream.project === project)
    let reads = 0
    const ask = (project: string): CanvasDrawn | undefined => {
      const id = `read-${String(reads += 1)}`
      act(() => { for (const stream of live(project)) stream.listener.read({ id, stream: project }) })
      return answers.find(answer => answer.id === id)
    }
    return { ...mounted, ask, streams }
  }

  /** The id and the drawn corner of each card of a read answer. */
  const cornersOf = (answer: CanvasDrawn | undefined): unknown => answer?.cards.map(({ id, x, y }) => [id, x, y])

  it('opens one stream beside its chat session and answers a read with the drawn cards, their shown version and version count', async () => {
    const { runtime, node, canvasOf, ask, streams } = await mountForAgent()
    await waitFor(() => { node('g1') })
    await waitFor(() => { expect(streams.map(({ project, session, open }) => [project, session, open])).toEqual([['p1', 's5', true]]) })
    const read = ask('p1')
    expect(read?.project).toBe('p1')
    expect(read?.cards.find(card => card.id === 'g1')).toMatchObject({ type: 'shot', shown: 'g3', versions: 2, x: 480, y: 0, width: 208, height: 117 })
    // A drag shows in the next read at once, before the state shows the move.
    fireEvent.pointerDown(node('g2'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf(), { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 1 })
    expect(ask('p1')?.cards.find(card => card.id === 'g2')).toMatchObject({ x: 530, y: 230 })
    await runtime.dispose()
    expect(streams.map(stream => stream.open)).toEqual([false])
  })

  it('keeps two canvases of different projects apart: each read reaches only its project\'s canvas', async () => {
    const mount = vi.spyOn(CanvasViews.prototype, 'mount')
    const other = { id: 'p2', title: 'Other', created_at: '2026-10-06T00:00:00Z', path: '/dv/Other' }
    const { runtime, node, server, canvasOf, ask } = await mountForAgent({ surfaces: ['center', 'tab'], projects: [other, PROJECT] })
    await waitFor(() => { expect(mount).toHaveBeenCalledTimes(2) })
    const center = cornersOf(ask('p1'))
    expect(center).toContainEqual(['g2', 480, 200])
    expect(ask('p2')?.project).toBe('p2')
    server.notify()
    await settle()
    expect(cornersOf(ask('p1'))).toEqual(center)
    expect(mount).toHaveBeenCalledTimes(2)
    // A drag on the tab's canvas shows in the read of its project and not in the other project's.
    fireEvent.pointerDown(node('g2', 'tab'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(canvasOf('tab'), { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvasOf('tab'), { pointerId: 1 })
    expect([cornersOf(ask('p2')), cornersOf(ask('p1'))]).toEqual([expect.arrayContaining([['g2', 530, 230]]), center])
    expect(server.positionWrites).toEqual([{ node: 'g2', x: 530, y: 230 }])
    await runtime.dispose()
  })

})

describe('renaming a node', () => {
  const renameWrites = (server: { writes: ReadonlyArray<{ path: string; body: unknown }> }): unknown[] => operationsOf(server.writes)
    .filter(body => (body as { operation?: string }).operation === 'canvas.node_rename').map(body => (body as { params?: unknown }).params)
  /** Select a node with one click. */
  const select = (card: HTMLElement, canvas: HTMLElement): void => {
    fireEvent.pointerDown(card, { button: 0, clientX: 5, clientY: 5, pointerId: 9 })
    fireEvent.pointerUp(canvas, { pointerId: 9 })
  }
  const field = (within_: HTMLElement): HTMLInputElement => within(within_).getByLabelText<HTMLInputElement>(zh['node.renameAria'])

  it('a click on the editor title renames the node with one canvas.node_rename; the card and the title show the name at once', async () => {
    const { runtime, view, node, server, open } = await mountCanvas({ holdOperations: true })
    const editor = await open('g2')
    const before = node('g2').getAttribute('aria-label') ?? ''
    expect(within(editor).getByText(`镜头 · ${zh['node.version'].replace('{n}', '1')}`)).toBeTruthy()
    fireEvent.click(within(editor).getByTestId('dv-canvas-editor-title'))
    const input = field(editor)
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual([before, 0, before.length])
    expect(within(editor).getByText(zh['node.renameHint'])).toBeTruthy()
    fireEvent.change(input, { target: { value: ' 港口黎明 ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(node('g2').getAttribute('aria-label')).toBe('港口黎明')
    expect(within(editor).getByTestId('dv-canvas-editor-title').textContent).toBe('港口黎明')
    expect(renameWrites(server)).toEqual([{ node: 'g2', name: '港口黎明' }])
    expect(operationsOf(server.writes)).toContainEqual(expect.objectContaining({ project: 'p1', operation: 'canvas.node_rename', surface: 'canvas', session: 's5' }))
    server.releaseOperations()
    await settle()
    expect(node('g2').getAttribute('aria-label')).toBe('港口黎明')
    expect(view.queryByRole('alert')).toBeNull()
    await runtime.dispose()
  })

  it('Escape in the title field cancels the rename and leaves the editor open; the next Escape closes it', async () => {
    const { runtime, view, server, open } = await mountCanvas()
    const editor = await open('g2')
    fireEvent.click(within(editor).getByTestId('dv-canvas-editor-title'))
    fireEvent.change(field(editor), { target: { value: 'Other' } })
    fireEvent.doubleClick(field(editor))
    fireEvent.keyDown(field(editor), { key: 'Escape' })
    expect(view.getByTestId('dv-canvas-node-editor')).toBe(editor)
    expect(within(editor).queryByLabelText(zh['node.renameAria'])).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    expect(renameWrites(server)).toEqual([])
    await runtime.dispose()
  })

  it('F2 on the selected node turns its caption into the name field, whose presses start no drag', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas()
    await waitFor(() => { node('g2') })
    fireEvent.keyDown(node('g2'), { key: 'F2' })
    expect(within(node('g2')).queryByLabelText(zh['node.renameAria'])).toBeNull()
    select(node('g2'), canvasOf())
    fireEvent.keyDown(node('g2'), { key: 'Enter' })
    fireEvent.keyDown(node('g2'), { key: 'F2' })
    const input = field(node('g2'))
    fireEvent.pointerDown(input, { button: 0, clientX: 0, clientY: 0, pointerId: 3 })
    fireEvent.pointerMove(canvasOf(), { clientX: 60, clientY: 40, pointerId: 3 })
    fireEvent.pointerUp(canvasOf(), { pointerId: 3 })
    expect(node('g2').style.left).toBe('480px')
    fireEvent.change(input, { target: { value: 'Harbor' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(renameWrites(server)).toEqual([{ node: 'g2', name: 'Harbor' }]) })
    expect(server.positionWrites).toEqual([])
    expect(node('g2').getAttribute('aria-label')).toBe('Harbor')
    await runtime.dispose()
  })

  it('重命名 in the right-click menu closes the menu and turns the caption into the focused name field', async () => {
    const { runtime, view, node, server } = await mountCanvas()
    await waitFor(() => { node('g2') })
    const title = node('g2').getAttribute('aria-label') ?? ''
    fireEvent.contextMenu(node('g2'), { clientX: 300, clientY: 200 })
    fireEvent.click(within(view.getByRole('menu')).getByRole('menuitem', { name: '重命名' }))
    expect(view.queryByRole('menu')).toBeNull()
    const input = field(node('g2'))
    expect([document.activeElement, input.value]).toEqual([input, title])
    fireEvent.change(input, { target: { value: 'Harbor' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(renameWrites(server)).toEqual([{ node: 'g2', name: 'Harbor' }]) })
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await runtime.dispose()
  })

  it('keeps the field open with the message for a name over 80 characters, and clears a name with an empty field', async () => {
    const named = (state: FixtureState): void => { const g2 = state.components.canvas.nodes['g2']; if (g2 !== undefined && g2.name === null && !cleared) g2.name = 'Harbor' }
    let cleared = false
    const { runtime, view, node, server, open } = await mountCanvas({ edit: named })
    const editor = await open('g2')
    expect(node('g2').getAttribute('aria-label')).toBe('Harbor')
    fireEvent.click(within(editor).getByTestId('dv-canvas-editor-title'))
    fireEvent.change(field(editor), { target: { value: '镜'.repeat(81) } })
    fireEvent.keyDown(field(editor), { key: 'Enter' })
    expect(within(editor).getByRole('alert').textContent).toBe(zh['node.renameTooLong'].replace('{max}', '80'))
    expect(field(editor).getAttribute('aria-invalid')).toBe('true')
    expect(renameWrites(server)).toEqual([])
    cleared = true
    fireEvent.change(field(editor), { target: { value: '  ' } })
    fireEvent.blur(field(editor))
    await waitFor(() => { expect(renameWrites(server)).toEqual([{ node: 'g2', name: null }]) })
    await waitFor(() => { expect(node('g2').getAttribute('aria-label')).not.toBe('Harbor') })
    // Clearing a node that has no name writes nothing.
    fireEvent.click(within(view.getByTestId('dv-canvas-node-editor')).getByTestId('dv-canvas-editor-title'))
    fireEvent.change(field(editor), { target: { value: '' } })
    fireEvent.keyDown(field(editor), { key: 'Enter' })
    await settle()
    expect(renameWrites(server)).toHaveLength(1)
    await runtime.dispose()
  })

  it('draws the name back and shows the error when the server refuses the rename; a later name stays while an earlier refusal arrives', async () => {
    const refused = refuseOperation('canvas.node_rename', 'read-only project')
    const { runtime, view, node, server, canvasOf } = await mountCanvas({
      holdOperations: true, refuse: (path, body) => (body as { params?: { name?: unknown } }).params?.name === 'Two' ? null : refused(path, body),
    })
    await waitFor(() => { node('g2') })
    const before = node('g2').getAttribute('aria-label')
    select(node('g2'), canvasOf())
    const rename = (name: string): void => {
      fireEvent.keyDown(node('g2'), { key: 'F2' })
      fireEvent.change(field(node('g2')), { target: { value: name } })
      fireEvent.keyDown(field(node('g2')), { key: 'Enter' })
    }
    rename('Back')
    expect(node('g2').getAttribute('aria-label')).toBe('Back')
    server.releaseOperations()
    expect((await view.findByRole('alert')).textContent).toBe('失败：read-only project')
    await waitFor(() => { expect(node('g2').getAttribute('aria-label')).toBe(before) })
    rename('One')
    rename('Two')
    server.releaseOperations(1)
    expect((await view.findByRole('alert')).textContent).toBe('失败：read-only project')
    await settle()
    expect(node('g2').getAttribute('aria-label')).toBe('Two')
    server.releaseOperations()
    await settle()
    expect(node('g2').getAttribute('aria-label')).toBe('Two')
    await runtime.dispose()
  })

  it('keeps a later name while the state shows the earlier one that the server accepted first', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas({ holdOperations: true })
    await waitFor(() => { node('g2') })
    select(node('g2'), canvasOf())
    for (const name of ['One', 'Two']) {
      fireEvent.keyDown(node('g2'), { key: 'F2' })
      fireEvent.change(field(node('g2')), { target: { value: name } })
      fireEvent.keyDown(field(node('g2')), { key: 'Enter' })
    }
    server.releaseOperations(1)
    await settle()
    expect(node('g2').getAttribute('aria-label')).toBe('Two')
    server.releaseOperations()
    await settle()
    expect(node('g2').getAttribute('aria-label')).toBe('Two')
    await runtime.dispose()
  })

  it('F2 over a stacked editor renames the stacked node and keeps both editors open', async () => {
    const { runtime, view, server, open } = await mountCanvas()
    const editor = await open('g1')
    fireEvent.click(await tileIn(editor, 'hero@1'))
    const stacked = view.getAllByTestId('dv-canvas-node-editor')[1]
    if (stacked === undefined) throw new Error('no stacked editor')
    const hero = view.getByTestId('center').querySelector('[data-node-id][aria-label="Hero"]')?.getAttribute('data-node-id')
    fireEvent.keyDown(stacked, { key: 'F2' })
    expect(within(editor).queryByLabelText(zh['node.renameAria'])).toBeNull()
    fireEvent.change(field(stacked), { target: { value: 'Villain' } })
    fireEvent.keyDown(field(stacked), { key: 'Enter' })
    await waitFor(() => { expect(renameWrites(server)).toEqual([{ node: hero, name: 'Villain' }]) })
    expect(view.getAllByTestId('dv-canvas-node-editor')).toEqual([editor, stacked])
    await runtime.dispose()
  })

  it('closes a refused name field with its editor, and with its node when the node leaves the canvas', async () => {
    let removed = false
    const { runtime, view, node, server, open, canvasOf } = await mountCanvas({ edit: (state) => { if (removed) delete state.components.canvas.nodes['g2'] } })
    const editor = await open('g2')
    fireEvent.click(within(editor).getByTestId('dv-canvas-editor-title'))
    fireEvent.change(field(editor), { target: { value: '镜'.repeat(81) } })
    fireEvent.blur(field(editor))
    expect(within(editor).getByRole('alert')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    expect(within(await open('g2')).queryByLabelText(zh['node.renameAria'])).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    select(node('g2'), canvasOf())
    fireEvent.keyDown(node('g2'), { key: 'F2' })
    fireEvent.change(field(node('g2')), { target: { value: '镜'.repeat(81) } })
    fireEvent.keyDown(field(node('g2')), { key: 'Enter' })
    removed = true
    server.notify()
    await waitFor(() => { expect(view.getByTestId('center').querySelector('[data-node-id="g2"]')).toBeNull() })
    removed = false
    server.notify()
    await waitFor(() => { node('g2') })
    expect(within(node('g2')).queryByLabelText(zh['node.renameAria'])).toBeNull()
    expect(renameWrites(server)).toEqual([])
    await runtime.dispose()
  })

  it('drops the drawn name once a state after the answer does not show it, as after an undo that came first', async () => {
    const { runtime, node, server, canvasOf } = await mountCanvas()
    // Every served state shows g2 without a name, as the state after an undo of the rename does.
    const served = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await served(input, init)
      if (!(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes('/api/dv/state')) return response
      const body = await response.json() as FixtureState
      const g2 = body.components.canvas.nodes['g2']
      if (g2 !== undefined) g2.name = null
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await waitFor(() => { node('g2') })
    const before = node('g2').getAttribute('aria-label')
    select(node('g2'), canvasOf())
    fireEvent.keyDown(node('g2'), { key: 'F2' })
    fireEvent.change(field(node('g2')), { target: { value: 'Gone' } })
    fireEvent.keyDown(field(node('g2')), { key: 'Enter' })
    expect(node('g2').getAttribute('aria-label')).toBe('Gone')
    await waitFor(() => { expect(renameWrites(server)).toHaveLength(1) })
    await waitFor(() => { expect(node('g2').getAttribute('aria-label')).toBe(before) })
    await runtime.dispose()
  })

  it('F2 below 50% zoom opens the editor with its title field; F2 with the editor open renames there, but not from a text field or the picker', async () => {
    const { runtime, view, node, canvasOf } = await mountCanvas({ layout: { viewport: { x: 0, y: 0, zoom: 0.4 } } })
    await waitFor(() => { node('g2') })
    select(node('g2'), canvasOf())
    fireEvent.keyDown(node('g2'), { key: 'F2' })
    const editor = await view.findByTestId('dv-canvas-node-editor')
    expect(document.activeElement).toBe(field(editor))
    fireEvent.keyDown(field(editor), { key: 'Escape' })
    // A text field of the editor body, such as a prompt, keeps F2.
    const textField = editor.appendChild(document.createElement('textarea'))
    fireEvent.keyDown(textField, { key: 'F2' })
    textField.remove()
    expect(within(editor).queryByLabelText(zh['node.renameAria'])).toBeNull()
    fireEvent.click(await waitFor(() => within(editor).getByRole('button', { name: '添加素材' })))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    fireEvent.keyDown(picker, { key: 'F2' })
    expect(within(editor).queryByLabelText(zh['node.renameAria'])).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(node('g2'), { key: 'F2' })
    expect(field(editor)).toBeTruthy()
    await runtime.dispose()
  })
})
