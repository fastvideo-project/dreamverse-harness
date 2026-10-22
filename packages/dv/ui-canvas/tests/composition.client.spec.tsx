// @vitest-environment jsdom
/**
 * How kind plugins compose with the canvas: the `dv.canvas` Factory owns its child slots, a kind's contributions leave
 * with its fiber, two types never claim one operation, and kinds load in any order relative to the canvas.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { NodeType } from '../src/client/contract/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { forgetCanvasStorage, KINDS, mountCanvas } from './canvas-runtime.client.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  forgetCanvasStorage()
})

/**
 * @param runtime - the runtime.
 * @param slot - a keyed canvas slot.
 * @returns the keys of the slot's entries.
 */
const keysOf = (runtime: SlotTestRuntime, slot: 'dv.canvas.card' | 'dv.canvas.editor.claimed'): Array<string | undefined> => runtime.slots.entries(slot).map(entry => entry.options.key)

/** A second type that claims the video takes' operation. */
const OTHER_RENDER: NodeType = {
  id: '@dv/ui-other-render', type: 'other', label: () => 'other', color: '', column: 2,
  claimed: { operations: ['shot.render'], status: { running: () => '', failed: () => '' }, entry: () => ({ title: '', bodyHeight: 117 }) },
}

describe('the dv.canvas Factory', () => {
  it('owns the canvas child slots: another entry that declares dv.canvas.card is refused at registration', async () => {
    const { runtime } = await mountCanvas({ kinds: [] })
    expect(runtime.slots.spec('dv.canvas.card')).toEqual({ kind: 'keyed', scope: 'root' })
    expect(() => runtime.slots.register(
      { name: 'dv.center.view', id: 'second-canvas', children: { 'dv.canvas.card': { kind: 'keyed', scope: 'root' } } } as never, () => null,
    )).toThrow('dv.canvas.card')
    await runtime.dispose()
  })
})

describe('kind plugins', () => {
  it('disposing the video takes\' fiber removes their node type, operation claim, card and editor entries, 重试 action and nodes', async () => {
    const { runtime, node, kinds, view } = await mountCanvas()
    const canvas = runtime.ctx.dvCanvas
    await waitFor(() => { node('g1') })
    expect(canvas.nodeTypes.getSnapshot().map(type => type.type)).toContain('take')
    expect(keysOf(runtime, 'dv.canvas.card')).toContain('take')
    expect(keysOf(runtime, 'dv.canvas.editor.claimed')).toContain('take')
    expect(canvas.actions.getSnapshot().map(action => action.id)).toContain('@dv/ui-shot-render:retry')

    await kinds.takes?.dispose()
    expect(canvas.nodeTypes.getSnapshot().map(type => type.type)).not.toContain('take')
    expect(keysOf(runtime, 'dv.canvas.card')).not.toContain('take')
    expect(keysOf(runtime, 'dv.canvas.editor.claimed')).not.toContain('take')
    expect(canvas.actions.getSnapshot().map(action => action.id)).not.toContain('@dv/ui-shot-render:retry')
    await waitFor(() => { expect(view.container.querySelector('[data-node-id="g1"]')).toBeNull() })
    // The operation key `op:shot.render` left with the type, so another type may claim the operation.
    expect(() => canvas.nodeTypes.register(OTHER_RENDER)).not.toThrow()
    await runtime.dispose()
  })

  it('refuses a second type that claims shot.render, naming the package that holds it', async () => {
    const { runtime } = await mountCanvas({ kinds: ['takes'] })
    expect(() => runtime.ctx.dvCanvas.nodeTypes.register(OTHER_RENDER))
      .toThrow('registry key "op:shot.render" is already registered by @dv/ui-shot-render')
    await runtime.dispose()
  })

  it('kinds mounted before ui-canvas and ui-media register once they come, and register again after ui-canvas reloads', async () => {
    let before: { canvas: unknown; cards: Array<string | undefined> } | null = null
    const { runtime, node, canvas } = await mountCanvas({
      kinds: ['reference', 'takes'],
      beforeCanvas: (mounted) => { before = { canvas: mounted.ctx.get('dvCanvas'), cards: keysOf(mounted, 'dv.canvas.card') } },
    })
    expect(before).toEqual({ canvas: undefined, cards: [] })
    expect(runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(type => type.type).sort()).toEqual(['take', 'test_ref'])
    expect(keysOf(runtime, 'dv.canvas.card').sort()).toEqual(['take', 'test_ref'])
    await waitFor(() => { node('g1') })
    // ui-media mounts last; the takes' card then draws the still through its `dv.media` occurrence.
    expect(node('g1').querySelector('img')).toBeNull()
    await runtime.mount(KINDS.media)
    await runtime.mount(KINDS.assets)
    await waitFor(() => { expect(node('g1').querySelector('img')?.getAttribute('src')).toBe(assetUrl('shot1-last.png')) })

    await canvas.dispose()
    expect(keysOf(runtime, 'dv.canvas.card')).toEqual([])
    const reloaded = await runtime.mount({ inject: [...inject], apply })
    expect(runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(type => type.type).sort()).toEqual(['asset', 'take', 'test_ref'])
    expect(keysOf(runtime, 'dv.canvas.card').sort()).toEqual(['asset', 'take', 'test_ref'])
    await reloaded.dispose()
    await runtime.dispose()
  })
})
