// @vitest-environment jsdom
/**
 * The canvas as a right-Sidebar tab body: the body declares no canvas slot and passes no slot renderer, so an entry editor
 * there opens with only its header and the asset picker lists only the versioned items, each with no error. Under the
 * real slot runtime, with the canvas plugin and the media plugins mounted, the body draws its assets through `dv.media`
 * and an asset chip opens the `dvMedia` preview; a tab without projects asks the agent for one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'
import type { NodeType } from '@dv/ui-kit/registries.ts'
import { fixtureState, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import type { ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { CanvasBody } from '../src/client/CanvasBody.tsx'
import type { CanvasBodyProps } from '../src/client/CanvasBody.tsx'
import { CANVAS_ID } from '../src/client/definition.ts'
import { createDvCanvas } from '../src/client/dv-canvas.ts'
import { apply, inject } from '../src/client/index.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import type { CanvasTranslate } from '../src/client/NodeCard.tsx'
import { zh } from '../src/client/locales.ts'
import { mountMediaPlugins } from './media-runtime.client.tsx'

/** The reference noun `test_ref` of the fixture, declared as the UI package of a noun declares it. */
const testRef = defineReferenceUi({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref,
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

/** A node type as a plugin's UI half registers it: one entry. */
const PROPS: NodeType = {
  id: '@dv/ui-prop', type: 'prop', label: () => '道具', color: 'rgb(1, 2, 3)', column: 1,
  entries: () => [{ id: 'prop:p1', record: null, title: '红伞', media: [] }],
}

/** The slots that the root frame declares: the right Sidebar's tab body slot and DSH's `shell.overlay` list. */
const SLOTS = {
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  'shell.overlay': { kind: 'list', scope: 'root' },
} as const

/** What the root frame hands its drawing. */
type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

/** Runtimes and retained chat sessions that a test created, released after it. */
const runtimes: SlotTestRuntime[] = []
const sessions: Disposable[] = []

afterEach(async () => {
  cleanup()
  for (const session of sessions.splice(0)) session[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.removeItem(EDITOR_RECT_KEY)
  window.localStorage.removeItem('dv-canvas-seen:p1')
  document.documentElement.lang = ''
})

/**
 * Mount the canvas plugin, the media plugin and the asset pool plugin, and draw the canvas tab body in chat session s5
 * in Chinese above DSH's `shell.overlay` list, as the right Sidebar and the shell draw them, over the scripted
 * `/api/dv` routes.
 * @param routes - the answers of the page's `fetch`, which the plugins' API clients call.
 * @returns the runtime and the rendered page.
 */
async function mountTab(routes: ScriptedRoutes) {
  document.documentElement.lang = 'zh-CN'
  vi.stubGlobal('fetch', scriptedFetch(routes).fetch)
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  const reference: { current: ReturnType<SlotTestRuntime['sessions']['retain']> | undefined } = { current: undefined }
  await runtime.root.declare(SLOTS, ({ renderSlot, SessionProvider }: FrameProps) => (
    <>
      {reference.current === undefined
        ? null
        : (
          <SessionProvider session={reference.current}>
            <div data-testid="tab">{renderSlot('sidebar.right.pane.tab', {}, { entryKey: CANVAS_ID, hookContext: {} as never })}</div>
          </SessionProvider>
        )}
      {renderSlot('shell.overlay', {})}
    </>
  ))
  await runtime.mount({ inject: [...inject], apply })
  await mountMediaPlugins(runtime)
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
  return { runtime, view: runtime.renderRoot() }
}

describe('canvas tab body', () => {
  it('opens an entry editor with its header and no slot body, without an error', async () => {
    const canvas = createDvCanvas()
    canvas.nodeTypes.register(PROPS)
    const t: CanvasTranslate = makeTranslate(zh)
    // The slot runtime hands `renderSlot` only to an entry that declares children, so the body gets none in the right
    // Sidebar either; it reads only its client, its registries and its copy.
    const props = { client: new DvClient(scriptedFetch().fetch), canvas, t } as CanvasBodyProps
    const { container } = render(<CanvasBody {...props} />)
    const card = await waitFor(() => {
      const node = container.querySelector('[data-node-id="prop:p1"]')
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    fireEvent.pointerDown(card, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(container.querySelector('[data-testid="dv-canvas-view"]') as HTMLElement, { pointerId: 1 })
    const editor = await waitFor(() => within(container).getByTestId('dv-canvas-node-editor'))
    expect(within(editor).getByRole('heading').textContent).toBe('红伞')
    expect(within(container).getByTestId('dv-canvas-body')).toBeTruthy()
  })

  it('draws its assets through dv.media, opens the asset picker with only the versioned items, and an asset chip opens the dvMedia preview', async () => {
    const errors = vi.spyOn(console, 'error')
    // The first take also references an asset, so its editor shows an asset chip beside the chip of hero; an item
    // that the take does not reference is a versioned item of the picker.
    const state = withTestRef(fixtureState())
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
      ? { ...entry, inputs: [...entry.inputs, { role: 'reference', ref: { asset: 'shot2-last.png' }, resolved_asset: 'shot2-last.png' }] }
      : entry)
    state.components.test_ref = { ...state.components.test_ref, alley: [{ id: 'alley', version: 1, name: 'Alley', description: '', references: ['ref.png'], created_by: 'e1' }] }
    const { runtime, view } = await mountTab({ state })
    await runtime.mount({ apply: testRef.apply })
    const tab = view.getByTestId('tab')
    const card = await waitFor(() => {
      const node = tab.querySelector('[data-node-id="g1"]')
      expect(node).not.toBeNull()
      return node as HTMLElement
    })
    // The take's card draws its image output through the image view.
    expect(card.querySelector('img')?.getAttribute('src')).toBe(assetUrl('shot1-last.png'))
    fireEvent.pointerDown(card, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(within(tab).getByTestId('dv-canvas-view'), { pointerId: 1 })
    const editor = await waitFor(() => within(tab).getByTestId('dv-canvas-node-editor'))

    fireEvent.click(within(editor).getByText(zh['editor.addAsset']))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    // The item's tile draws the item's first asset; the tab renders no asset pool panel.
    expect(within(picker).getByRole('button', { name: 'Alley' }).querySelector('img')?.getAttribute('src')).toBe(assetUrl('ref.png'))
    expect(picker.querySelector('[data-asset-id]')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByTestId('dv-canvas-asset-picker')).toBeNull()
    fireEvent.click(within(editor).getByRole('button', { name: '查看 shot2-last.png' }))
    expect(await view.findByRole('dialog', { name: 'shot2-last.png' })).toBeTruthy()
    expect(within(tab).getByTestId('dv-canvas-node-editor')).toBe(editor)
    expect(errors).not.toHaveBeenCalled()
  })

  it('tells a tab without projects to ask the agent for one', async () => {
    const { view } = await mountTab({ projects: [] })
    await waitFor(() => { expect(view.getByTestId('tab').textContent).toContain(zh['empty.projects']) })
  })
})
