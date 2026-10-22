// @vitest-environment jsdom
/**
 * The canvas slots in the workspace center: under the real slot runtime, ui-canvas's `dv.center.view` entry declares the
 * canvas slots and hands them to its canvas, so the center canvas shows the slot bodies that plugin UI halves register,
 * draws its assets through `dv.media`, and opens the `dvMedia` preview while `@dv/ui-media` is loaded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'
import type { NodeType } from '@dv/ui-kit/registries.ts'
import type { CenterRequest, JsonFields } from '@dv/ui-shell/contract'
import { fixtureState, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as shotPlanApply } from '../../ui-shot-plan/src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import { zh } from '../src/client/locales.ts'
import { mountMediaPlugins } from './media-runtime.client.tsx'

/** A node type as a plugin's UI half registers it: one entry per project. */
const PROPS: NodeType = {
  id: '@dv/ui-prop', type: 'prop', label: () => '道具', color: 'rgb(1, 2, 3)', column: 1,
  entries: state => [{ id: 'prop:p1', record: null, title: `红伞 · ${state.project.id}`, media: [] }],
}

/** The reference noun `test_ref` of the fixture, declared as the UI package of a noun declares it. */
const testRef = defineReferenceUi({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref,
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

/**
 * The `dv.canvas.editor` entry of the node type.
 * @param props - the entry.
 * @returns the element.
 */
function PropEditor({ node }: PropsRuntime<'dv.canvas.editor'>): ReactNode {
  return <p data-testid="prop-editor">{node.title}</p>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.removeItem(EDITOR_RECT_KEY)
  window.localStorage.removeItem('dv-canvas-seen:p1')
  document.documentElement.lang = ''
})

/**
 * A slot runtime whose root frame declares the center slot and shows its canvas entry, as the shell's workspace center
 * does, above DSH's `shell.overlay` list, with the ui-canvas plugin mounted on the fixture project and its reference noun
 * `test_ref`.
 * @param request - the request that the center hands the canvas; none by default.
 * @returns the runtime, the rendered root, the mounted ui-canvas plugin, and the writes of the plugin's client.
 */
async function centerCanvas(request: CenterRequest | null = null) {
  // The plugin's own client calls the global fetch.
  const scripted = scriptedFetch({ state: () => withTestRef(fixtureState()) })
  vi.stubGlobal('fetch', scripted.fetch)
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  const Frame = ({ renderSlot }: PropsRenderSlots<'dv.center.view' | 'shell.overlay'>): ReactNode => (
    <>
      <div data-testid="center">{renderSlot('dv.center.view', { projectId: 'p1', session: 's5', request, fields: {}, note: () => {} }, { only: 'canvas' })}</div>
      {renderSlot('shell.overlay', {})}
    </>
  )
  await runtime.root.declare({ 'dv.center.view': { kind: 'list', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' } }, Frame)
  const view = runtime.renderRoot()
  const canvas = await runtime.mount({ inject: [...inject], apply })
  return { runtime, view, canvas, writes: scripted.writes }
}

/**
 * Open the editor of a drawn node with a click.
 * @param container - the rendered root.
 * @param id - the node ID.
 * @returns the editor.
 */
async function openEditor(container: HTMLElement, id: string): Promise<HTMLElement> {
  const card = await waitFor(() => {
    const node = container.querySelector(`[data-node-id="${id}"]`)
    expect(node).not.toBeNull()
    return node as HTMLElement
  })
  fireEvent.pointerDown(card, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
  fireEvent.pointerUp(container.querySelector('[data-testid="dv-canvas-view"]') as HTMLElement, { pointerId: 1 })
  return waitFor(() => within(container).getByTestId('dv-canvas-node-editor'))
}

describe('canvas slots in the workspace center', () => {
  it('shows the editor entry of a node entry in the center canvas, and leaves the center slot on disposal', async () => {
    const { runtime, view: { container, getByTestId }, canvas } = await centerCanvas()
    const prop = await runtime.mount({
      inject: ['dvCanvas', 'slots'],
      apply: (ctx: Context) => {
        ctx.effect(() => ctx.dvCanvas.nodeTypes.register(PROPS), 'test: node type')
        ctx.effect(() => ctx.slots.inject('dv.canvas.editor', () => ctx.slots.register(
          { name: 'dv.canvas.editor', key: PROPS.id }, PropEditor,
        )), 'test: editor entry')
      },
    })
    const editor = await openEditor(container, 'prop:p1')
    expect(within(editor).getByTestId('prop-editor').textContent).toBe('红伞 · p1')

    await prop.dispose()
    await canvas.dispose()
    expect(runtime.slots.entries('dv.center.view')).toHaveLength(0)
    await waitFor(() => { expect(getByTestId('center').textContent).toBe('') })
    await runtime.dispose()
  })

  it('shows the editor body of a reference noun in the center canvas', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, view: { container } } = await centerCanvas()
    await runtime.mount({ apply: testRef.apply })

    const editor = await openEditor(container, 'test_ref:hero')
    // The body of the noun's entry: the reference of the newest version, the description and 添加素材.

    expect(within(editor).getByText('A tired detective.')).toBeTruthy()
    expect(within(editor).getByText('＋ 添加素材')).toBeTruthy()
    // Without `@dv/ui-media` the reference opens no preview.
    fireEvent.click(within(editor).getByRole('button', { name: '查看 ref.png' }))
    expect(within(document.body).queryByRole('dialog', { name: 'ref.png' })).toBeNull()
    expect(within(container).getByTestId('dv-canvas-node-editor')).toBe(editor)
    // 添加素材 opens the canvas's picker over the editor, and Escape closes the picker only.
    fireEvent.click(within(editor).getByText('＋ 添加素材'))
    expect(within(document.body).getByTestId('dv-canvas-asset-picker')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(within(document.body).queryByTestId('dv-canvas-asset-picker')).toBeNull()
    expect(within(container).getByTestId('dv-canvas-node-editor')).toBe(editor)
    await runtime.dispose()
  })

  it('shows the plan editor body in the center canvas', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, view: { container } } = await centerCanvas()
    await runtime.mount({ apply: shotPlanApply })

    const editor = await openEditor(container, 'plan:p1')
    // The body of the ui-shot-plan entry: the version row with its status, and one card per shot.
    expect(within(editor).getByRole('group', { name: '分镜计划版次' })).toBeTruthy()
    expect(within(editor).getByTestId('dv-canvas-plan-status').textContent).toBe('待批准')
    expect(editor.querySelectorAll('li[data-shot]')).toHaveLength(2)
    await runtime.dispose()
  })

  it('draws the center canvas\'s assets through dv.media, shows the asset pool tiles in the asset picker, and opens the dvMedia preview', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, view } = await centerCanvas()
    await mountMediaPlugins(runtime)

    // The take's card draws its image output through the image view.
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="g1"] img')?.getAttribute('src')).toBe(assetUrl('shot1-last.png')) })
    const editor = await openEditor(view.container, 'g1')
    // 添加素材 opens the picker, which shows the asset pool's `dv.canvas.picker` entry below the versioned items.
    fireEvent.click(within(editor).getByText(zh['editor.addAsset']))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    const tile = await waitFor(() => {
      const found = picker.querySelector('[data-asset-id="shot1.mp4"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    fireEvent.click(tile)
    fireEvent.click(view.getByText('确认（1）'))
    // The picked asset's chip opens the `dvMedia` preview in DSH's `shell.overlay` list.
    fireEvent.click(within(editor).getByRole('button', { name: '查看 shot1.mp4' }))
    expect(await view.findByRole('dialog', { name: 'shot1.mp4' })).toBeTruthy()
    await runtime.dispose()
  })
})

describe('the center request of the canvas', () => {
  const requests: Array<[string, JsonFields | null, boolean]> = [
    ['a string record', { record: 'g2' }, true],
    ['a value without record', { timeline: 't1' }, false],
    ['a non-string record', { record: ['g2'] }, false],
    ['no request', null, false],
  ]
  it.each(requests)('opens the node of the record that the request names and takes the request, given %s', async (_name, value, opens) => {
    let taken = false
    const { runtime, view: { container }, writes } = await centerCanvas(value === null ? null : { value, take: () => { taken = true } })
    // The free spots that the canvas stores show that the layout and the graph are loaded, so the request has been read.
    await waitFor(() => { expect(writes.some(write => write.path === '/api/dv/layout')).toBe(true) })
    const editor = within(container).queryByTestId('dv-canvas-node-editor')
    const g2 = container.querySelector('[data-node-id="g2"]')
    expect([editor?.getAttribute('aria-label') ?? null, taken]).toEqual([opens ? g2?.getAttribute('aria-label') : null, opens])
    await runtime.dispose()
  })
})
