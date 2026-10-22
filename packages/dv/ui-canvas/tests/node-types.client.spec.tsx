// @vitest-environment jsdom
/**
 * Node types in `dvCanvas`: the canvas draws each entry of a registered `NodeType` with the default card, its editor shows
 * the `dv.canvas.editor` entry keyed by the type's `id` and lends it the canvas's writes, asset picker (the asset pool's
 * `dv.canvas.picker` entry) and the `dvMedia` asset preview, and both leave when the registering plugin is disposed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { DvClient } from '@dv/ui-kit/api.ts'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'
import type { NodeType } from '@dv/ui-kit/registries.ts'
import { asset, fixtureState, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { planNodeType } from '../../ui-shot-plan/src/client/index.ts'
import { CanvasView } from '../src/client/CanvasView.tsx'
import { createDvCanvas } from '../src/client/dv-canvas.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import type { CanvasTranslate } from '../src/client/NodeCard.tsx'
import { zh } from '../src/client/locales.ts'
import { mountCanvasFrame } from './media-runtime.client.tsx'

/** A node type as a plugin's UI half registers it: one entry with media, one entry with a frame grid. */
const PROPS: NodeType = {
  id: '@dv/ui-prop', type: 'prop', label: () => '道具', color: 'rgb(1, 2, 3)', column: 1,
  entries: state => state.project.id === 'p1'
    ? [
      { id: 'prop:p1', record: null, title: '红伞', subtitle: '第 1 版', media: ['umbrella.png', 'umbrella-back.png'] },
      { id: 'prop:p2', record: null, title: '2 格', media: [], slots: 2 },
    ]
    : [],
}

/** The reference noun `test_ref` of the fixture, declared as the UI package of a noun declares it. */
const testRef = defineReferenceUi({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref,
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

/**
 * The `dv.canvas.editor` entry of the node type: its title, a button per asset ID that asks the host for the asset's
 * preview, among them an ID that no asset of the project has, and a rename that the host runs.
 * @param props - the entry, the state and the host.
 * @returns the element.
 */
function PropEditor({ node, state, host }: PropsRuntime<'dv.canvas.editor'>): ReactNode {
  return (
    <>
      <p data-testid="prop-editor">{`${node.title} · ${state.project.id}`}</p>
      {['umbrella.png', 'gone.png'].map(id => <button key={id} type="button" onClick={(event) => { host.preview(id, event.currentTarget) }}>{`preview ${id}`}</button>)}
      <button type="button" onClick={() => { host.run({ operation: 'prop.rename', params: { prop: 'p1', name: '蓝伞' }, intent: '改名' }) }}>rename</button>
    </>
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.removeItem(EDITOR_RECT_KEY)
  window.localStorage.removeItem('dv-canvas-seen:p1')
  document.documentElement.lang = ''
})

describe('node types', () => {
  it('draws each entry with the default card, shows the type\'s editor entry, and removes both on disposal', async () => {
    const runtime = await SlotTestRuntime.create()
    const canvas = createDvCanvas()
    // The entries of `test_ref` hold column 0, as a noun's do in the bundle, so the plan stays in the column it had before
    // the type came.
    canvas.nodeTypes.register(testRef.nodeType)
    canvas.nodeTypes.register(planNodeType)
    runtime.ctx.provide('dvCanvas', canvas)
    const state = withTestRef(fixtureState())
    state.assets.push(asset('umbrella.png', 'image/png', null), asset('umbrella-back.png', 'image/png', null))
    state.components.asset.placed = ['umbrella.png']
    const scripted = scriptedFetch({ state })
    const client = new DvClient(scripted.fetch)
    const t: CanvasTranslate = makeTranslate(zh)
    // The root frame declares the slots, as the canvas center view does, and hands the canvas its renderers and the
    // `dvMedia` preview; the canvas sits beside no chat session.
    await mountCanvasFrame(runtime, ({ renderSlot, renderFactorySlot, preview }) => (
      <CanvasView projectId="p1" client={client} t={t} canvas={canvas} renderSlot={renderSlot} renderFactorySlot={renderFactorySlot} preview={preview} />
    ))
    const { container } = runtime.renderRoot()
    const card = (id: string): HTMLElement | null => container.querySelector(`[data-node-id="${id}"]`)
    await waitFor(() => { expect(card('g1')).not.toBeNull() })
    expect(card('prop:p1')).toBeNull()

    const types = await runtime.mount({
      inject: ['dvCanvas'],
      apply: (ctx: Context) => { ctx.effect(() => ctx.dvCanvas.nodeTypes.register(PROPS), 'test: node type') },
    })
    const editors = await runtime.mount({
      inject: ['slots'],
      apply: (ctx: Context) => {
        ctx.effect(() => ctx.slots.inject('dv.canvas.editor', () => ctx.slots.register(
          { name: 'dv.canvas.editor', key: PROPS.id }, PropEditor,
        )), 'test: editor entry')
      },
    })
    await waitFor(() => { expect(card('prop:p1')).not.toBeNull() })
    const media = card('prop:p1')
    expect(media?.getAttribute('data-node-type')).toBe('prop')
    expect(media?.textContent).toBe('道具 · 第 1 版+1红伞')
    expect(media?.querySelector('img')?.getAttribute('src')).toContain('umbrella.png')
    expect(media?.innerHTML).toContain('background: rgb(1, 2, 3)')
    // An entry with slots reads like a plan card: its type label above its title, with no grid while no slot has a frame.
    expect(card('prop:p2')?.textContent).toBe('道具2 格')
    // The type's column 1 is also the column of the plan type, so the entries sit under the plan node.
    expect(card('prop:p1')?.style.left).toBe(card('plan:p1')?.style.left)
    // The entry's media belong to its node, so the placed umbrella image has no asset node of its own.
    expect(card('asset:umbrella.png')).toBeNull()

    fireEvent.pointerDown(card('prop:p1') as HTMLElement, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(container.querySelector('[data-testid="dv-canvas-view"]') as HTMLElement, { pointerId: 1 })
    const editor = await waitFor(() => within(container).getByTestId('dv-canvas-node-editor'))
    expect(within(editor).getByTestId('prop-editor').textContent).toBe('红伞 · p1')
    // The host previews an asset of the project, growing out of the element that asked, and ignores any other ID.
    const opened = vi.spyOn(runtime.ctx.dvMedia, 'preview')
    fireEvent.click(within(editor).getByRole('button', { name: 'preview gone.png' }))
    expect(opened).not.toHaveBeenCalled()
    const known = within(editor).getByRole('button', { name: 'preview umbrella.png' })
    fireEvent.click(known)
    expect(opened.mock.calls).toEqual([[expect.objectContaining({ id: 'umbrella.png' }), known]])
    expect(await within(document.body).findByRole('dialog', { name: 'umbrella.png' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(within(document.body).queryByRole('dialog', { name: 'umbrella.png' })).toBeNull() })
    // The entry's write carries the canvas's project and surface, and no chat session.
    fireEvent.click(within(editor).getByRole('button', { name: 'rename' }))
    await waitFor(() => { expect(scripted.writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(scripted.writes.find(write => write.path === '/api/dv/operation')?.body).toEqual({
      operation: 'prop.rename', params: { prop: 'p1', name: '蓝伞' }, intent: '改名', project: 'p1', surface: 'canvas',
    })

    await editors.dispose()
    expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(0)
    await waitFor(() => { expect(within(editor).queryByTestId('prop-editor')).toBeNull() })
    expect(within(editor).getByRole('heading').textContent).toBe('红伞')

    await types.dispose()
    expect(canvas.nodeTypes.list()).toEqual([testRef.nodeType, planNodeType])
    await waitFor(() => { expect(card('prop:p1')).toBeNull() })
    expect(card('prop:p2')).toBeNull()
    await runtime.dispose()
  })

  it('lends the editor entry its writes, picker and preview: the entry of a reference noun previews a reference and appends picked assets', async () => {
    document.documentElement.lang = 'zh-CN'
    const runtime = await SlotTestRuntime.create()
    const canvas = createDvCanvas()
    runtime.ctx.provide('dvCanvas', canvas)
    const scripted = scriptedFetch({ state: () => withTestRef(fixtureState()) })
    const client = new DvClient(scripted.fetch)
    const t: CanvasTranslate = makeTranslate(zh)
    // The asset pool fills the picker slot; this host hands the canvas no `dv.media` renderer.
    await mountCanvasFrame(runtime, ({ renderSlot, preview }) => (
      <CanvasView projectId="p1" client={client} session="s5" t={t} canvas={canvas} renderSlot={renderSlot} preview={preview} />
    ))
    await runtime.mount({ apply: testRef.apply })
    const { container } = runtime.renderRoot()
    const hero = await waitFor(() => {
      const found = container.querySelector('[data-node-id="test_ref:hero"]')
      if (!(found instanceof HTMLElement)) throw new Error('no test_ref:hero node')
      return found
    })
    fireEvent.pointerDown(hero, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(container.querySelector('[data-testid="dv-canvas-view"]') as HTMLElement, { pointerId: 1 })
    const editor = await waitFor(() => within(container).getByTestId('dv-canvas-node-editor'))
    // The entry's reference opens the `dvMedia` preview from the reference; Escape closes the preview and leaves the
    // editor open.
    const opened = vi.spyOn(runtime.ctx.dvMedia, 'preview')
    const reference = within(editor).getByRole('button', { name: '查看 ref.png' })
    fireEvent.click(reference)
    expect(opened.mock.calls).toEqual([[expect.objectContaining({ id: 'ref.png' }), reference]])
    const view = within(document.body)
    expect(await view.findByRole('dialog', { name: 'ref.png' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('dialog', { name: 'ref.png' })).toBeNull() })
    // 添加素材 opens the canvas's picker of assets only, which Escape closes; the write carries the canvas's project,
    // session and surface.
    fireEvent.click(within(editor).getByText('＋ 添加素材'))
    await view.findByTestId('dv-canvas-asset-picker')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    expect(within(container).getByTestId('dv-canvas-node-editor')).toBe(editor)
    fireEvent.click(within(editor).getByText('＋ 添加素材'))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    expect(picker.textContent).not.toContain('参考')
    const tile = await waitFor(() => {
      const found = picker.querySelector('[data-asset-id="shot1.mp4"]')
      if (!(found instanceof HTMLElement)) throw new Error('no shot1.mp4 tile')
      return found
    })
    fireEvent.click(tile)
    fireEvent.click(view.getByText('确认（1）'))
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    await waitFor(() => { expect(scripted.writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(scripted.writes.find(write => write.path === '/api/dv/operation')?.body).toEqual({
      project: 'p1', operation: 'test_ref.update', params: { test_ref: 'hero' },

      inputs: [{ role: 'reference', ref: 'ref.png' }, { role: 'reference', ref: 'shot1.mp4' }], intent: '在画布上给 Hero 添加参考',
      surface: 'canvas', session: 's5',
    })
    await runtime.dispose()
  })
})
