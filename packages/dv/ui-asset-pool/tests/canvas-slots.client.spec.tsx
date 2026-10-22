// @vitest-environment jsdom
/**
 * The asset pool's entry in the canvas's picker slot under the real slot runtime: at key `assets`, `dv.canvas.picker` is
 * the asset pool panel whose tile clicks go to the canvas, and it leaves with the plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { DvClient } from '@dv/ui-kit/api.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => { cleanup() })

describe('the canvas slots', () => {
  it('fills the picker with the asset pool panel, and it leaves with the plugin', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'dv.canvas.picker': { kind: 'keyed', scope: 'root' } })
    runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
    const plugin = await runtime.mount({ inject: [...inject], apply })
    expect(runtime.slots.entries('dv.canvas.picker')).toHaveLength(1)

    // A tile click goes to the canvas in place of the asset preview.
    const onOpen = vi.fn<(asset: Asset) => void>()
    const client = new DvClient(scriptedFetch().fetch)
    const picker = runtime.renderSlot('dv.canvas.picker', { projectId: 'p1', session: 's5', client, onOpen }, { entryKey: 'assets' })
    const tile = await waitFor(() => {
      const found = picker.container.querySelector('[data-asset-id="shot1.mp4"]')
      if (!(found instanceof HTMLElement)) throw new Error('no shot1.mp4 tile')
      return found
    })
    fireEvent.click(tile)
    expect(onOpen.mock.calls.map(([asset]) => asset.id)).toEqual(['shot1.mp4'])
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await plugin.dispose()
    expect(runtime.slots.entries('dv.canvas.picker')).toHaveLength(0)
    await waitFor(() => { expect(picker.container.querySelector('[data-testid="dv-asset-pool-panel"]')).toBeNull() })
    await runtime.dispose()
  })
})
