// @vitest-environment jsdom
/** The plugin's registrations under the real slot runtime, and their removal when its fiber is disposed. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import type { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { HistoryRow } from '@dv/ui-history/contract'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import { CANVAS_ID, CANVAS_KIND } from '../src/client/definition.ts'
import { en, zh } from '../src/client/locales.ts'
import { forgetCanvasStorage, mountCanvas } from './canvas-runtime.client.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  forgetCanvasStorage()
})

describe('ui-canvas apply', () => {
  it('registers the dv-canvas tab type with its guide entry, the tab body, and the 画布 center view first in the view control', async () => {
    const { runtime, view } = await mountCanvas({ kinds: [], surfaces: ['center', 'tab'] })
    const definition = (runtime.ctx.get('sidebarRightTabs') as SidebarRightTabRegistry).get(CANVAS_KIND)
    expect([definition?.id, definition?.priority, definition?.keepMounted, definition?.title('sidebar://dv-canvas')]).toEqual([CANVAS_ID, 'builtin', true, '画布'])
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()])).toEqual([[40, zh['guide.title'], zh['guide.description']]])
    expect(runtime.slots.entries('sidebar.right.pane.tab').map(entry => entry.options.key)).toContain(CANVAS_ID)
    expect(runtime.slots.entries('dv.center.view').map(entry => [entry.options.id, entry.options.order])).toEqual([['canvas', 0]])
    await waitFor(() => { within(view.getByTestId('center')).getByTestId('dv-canvas-view') })
    within(view.getByTestId('tab')).getByTestId('dv-canvas-view')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    await runtime.dispose()
  })

  it('registers the History rows of canvas.node_position, canvas.node_remove and canvas.node_rename while dvHistory is loaded, and removes them with its fiber', async () => {
    const rows = createRegistry<HistoryRow>(row => [row.match], row => row.match)
    const { runtime, canvas } = await mountCanvas({ kinds: [], beforeCanvas: (mounted) => { mounted.ctx.provide('dvHistory', { rows, describe: () => null }) } })
    expect(rows.getSnapshot().map(row => row.match)).toEqual(['canvas.node_position', 'canvas.node_remove', 'canvas.node_rename'])
    await canvas.dispose()
    expect(rows.getSnapshot()).toEqual([])
    await runtime.dispose()
  })

  it('disposing its fiber removes dvCanvas, the dv.canvas Factory and its child slots, the tab type and body, and the center view', async () => {
    const { runtime, view, canvas } = await mountCanvas({ kinds: [], surfaces: ['center', 'tab'] })
    await waitFor(() => { within(view.getByTestId('tab')).getByTestId('dv-canvas-view') })
    await canvas.dispose()
    expect(runtime.ctx.get('dvCanvas')).toBeUndefined()
    expect(['dv.canvas.card', 'dv.canvas.editor', 'dv.canvas.picker'].map(slot => runtime.slots.spec(slot as 'dv.canvas.card'))).toEqual([undefined, undefined, undefined])
    expect((runtime.ctx.get('sidebarRightTabs') as SidebarRightTabRegistry).get(CANVAS_KIND)).toBeUndefined()
    expect(runtime.slots.entries('sidebar.right.pane.tab').map(entry => entry.options.key)).not.toContain(CANVAS_ID)
    expect(runtime.slots.entries('dv.center.view')).toEqual([])
    await waitFor(() => { expect(view.queryByTestId('dv-canvas-view')).toBeNull() })
    await runtime.dispose()
  })
})
