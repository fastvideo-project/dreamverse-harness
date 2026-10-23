// @vitest-environment jsdom
/**
 * Node types in `dvCanvas`: the canvas draws each node of a registered type in its chrome around the type's
 * `dv.canvas.card` body, opens the type's `dv.canvas.editor` body in the editor shell and lends it the canvas's writes,
 * asset picker and asset preview, and each contribution leaves with the fiber that registered it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { asset } from '../../ui-kit/tests/fixture.client.tsx'
import type { NodeType } from '../src/client/contract/index.ts'
import { forgetCanvasStorage, mountCanvas } from './canvas-runtime.client.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  forgetCanvasStorage()
})

const PROPS: NodeType = {
  id: '@dv/ui-test-prop', type: 'test_prop', label: () => '道具', color: 'rgb(1, 2, 3)', column: 1,
  entries: ({ state }) => [{
    id: `prop:${state.project.id}`, title: '红伞', meta: '第 1 版', record: null, assets: ['umbrella.png'], bodyHeight: 40,
  }],
}

/**
 * The card body of a prop.
 * @param props - the node.
 * @returns the element.
 */
function PropCard({ node }: PropsRuntime<'dv.canvas.card'>): ReactNode {
  return <p data-testid="prop-card">{`matte · ${node.id}`}</p>
}

/**
 * The editor body of a prop.
 * @param props - the node and the state.
 * @returns the element.
 */
function PropEditor({ node, state }: PropsRuntime<'dv.canvas.editor'>): ReactNode {
  return <p data-testid="prop-editor">{`${node.title} · ${state.project.id}`}</p>
}

describe('node types', () => {
  it('draws a slice node in its chrome around the type\'s card body, else its type label, opens its editor body, and drops each with its fiber', async () => {
    const { runtime, view, node, open } = await mountCanvas({
      edit: (state) => {
        state.assets.push(asset('umbrella.png', 'image/png', null))
        state.components.asset.placed = ['umbrella.png']
      },
    })
    const card = (id: string): Element | null => view.container.querySelector(`[data-node-id="${id}"]`)
    await waitFor(() => { node('g1') })
    await waitFor(() => { expect(card('asset:umbrella.png')).not.toBeNull() })
    const type = await runtime.mount({
      inject: ['dvCanvas'],
      apply: (ctx: Context) => { ctx.effect(() => ctx.dvCanvas.nodeTypes.register(PROPS), 'test: prop type') },
    })
    await waitFor(() => { node('prop:p1') })
    expect(node('prop:p1').getAttribute('data-node-type')).toBe('test_prop')
    expect(node('prop:p1').textContent).toBe('红伞第 1 版道具')
    expect(node('prop:p1').innerHTML).toContain('background: rgb(1, 2, 3)')
    expect(card('asset:umbrella.png')).toBeNull()
    expect(node('prop:p1').style.left).toBe(node('plan:p1').style.left)

    const bodies = await runtime.mount({
      inject: ['slots'],
      apply: (ctx: Context) => {
        ctx.effect(() => ctx.slots.inject('dv.canvas.card', () => ctx.slots.register({ name: 'dv.canvas.card', key: 'test_prop' }, PropCard)), 'test: card')
        ctx.effect(() => ctx.slots.inject('dv.canvas.editor', () => ctx.slots.register({ name: 'dv.canvas.editor', key: 'test_prop' }, PropEditor)), 'test: editor')
      },
    })
    await waitFor(() => { expect(within(node('prop:p1')).getByTestId('prop-card').textContent).toBe('matte · prop:p1') })
    const editor = await open('prop:p1')
    expect(within(editor).getByRole('heading').textContent).toBe('红伞')
    expect(within(editor).getByTestId('prop-editor').textContent).toBe('红伞 · p1')

    await bodies.dispose()
    await waitFor(() => { expect(within(editor).queryByTestId('prop-editor')).toBeNull() })
    expect(within(editor).getByRole('heading').textContent).toBe('红伞')
    expect(node('prop:p1').textContent).toBe('红伞第 1 版道具')

    await type.dispose()
    await waitFor(() => { expect(card('prop:p1')).toBeNull() })
    expect(runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(each => each.type)).not.toContain('test_prop')
    await runtime.dispose()
  })

  it('lends the editor body its writes, picker and preview: the noun\'s editor previews a reference and appends picked assets', async () => {
    const { runtime, view, open, server } = await mountCanvas()
    const editor = await open('test_ref:hero')
    const opened = vi.spyOn(runtime.ctx.dvMedia, 'preview')
    const reference = within(editor).getByRole('button', { name: '查看 ref.png' })
    fireEvent.click(reference)
    expect(opened.mock.calls).toEqual([['p1', expect.objectContaining({ id: 'ref.png' }), reference]])
    expect(await view.findByRole('dialog', { name: 'ref.png' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('dialog', { name: 'ref.png' })).toBeNull() })
    expect(view.getByTestId('dv-canvas-node-editor')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '＋ 添加素材' }))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    expect(within(picker).queryByRole('heading', { name: '参考' })).toBeNull()
    const tile = await waitFor(() => {
      const found = picker.querySelector('[data-asset-id="shot1.mp4"]')
      if (!(found instanceof HTMLElement)) throw new Error('no shot1.mp4 tile')
      return found
    })
    fireEvent.click(tile)
    fireEvent.click(within(picker).getByRole('button', { name: '确认（1）' }))
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    await waitFor(() => { expect(server.writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    expect(server.writes.find(write => write.path === '/api/dv/operation')?.body).toEqual({
      project: 'p1', operation: 'test_ref.update', params: { test_ref: 'hero' },
      inputs: [{ role: 'reference', ref: 'ref.png' }, { role: 'reference', ref: 'shot1.mp4' }], intent: '在画布上给 Hero 添加参考',
      surface: 'canvas', session: 's5',
    })
    await runtime.dispose()
  })
})
