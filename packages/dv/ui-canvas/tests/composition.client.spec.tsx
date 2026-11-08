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
import { apply as characterApply, inject as characterInject } from '../../ui-character/src/client/index.ts'
import { apply as locationApply, inject as locationInject } from '../../ui-location/src/client/index.ts'
import { apply as styleApply, inject as styleInject } from '../../ui-style/src/client/index.ts'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  forgetCanvasStorage()
})

const keysOf = (runtime: SlotTestRuntime, slot: 'dv.canvas.card' | 'dv.canvas.editor'): Array<string | undefined> => runtime.slots.entries(slot).map(entry => entry.options.key)

const OTHER_SHOT: NodeType = {
  id: '@dv/ui-other-render', type: 'shot', label: () => 'other', color: '',
  entry: () => ({ title: 'other shot', sizing: { kind: 'window', defaultSize: { width: 208, height: 117 }, minSize: { width: 104, height: 117 } } }),
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
  it('gives each node type of today\'s kinds its own slot of the theme\'s node palette', async () => {
    const { runtime } = await mountCanvas({ kinds: ['assets', 'takes', 'media'] })
    const nouns = [
      { inject: characterInject, apply: characterApply }, { inject: locationInject, apply: locationApply },
      { inject: styleInject, apply: styleApply },
    ]
    for (const noun of nouns) await runtime.mount({ inject: [...noun.inject], apply: noun.apply })
    const colors = runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(type => [type.type, type.color]).sort()
    expect(colors).toEqual([
      ['asset', 'var(--dv-node-6)'], ['character', 'var(--dv-node-1)'], ['location', 'var(--dv-node-5)'],
      ['shot', 'var(--dv-node-3)'], ['style', 'var(--dv-node-7)'],
    ])
    await runtime.dispose()
  })

  it('disposing the shots\' fiber removes their node type, card and editor entries and 重试 action, and their nodes draw as plain cards', async () => {
    const { runtime, node, kinds } = await mountCanvas()
    const canvas = runtime.ctx.dvCanvas
    await waitFor(() => { node('g1') })
    expect(canvas.nodeTypes.getSnapshot().map(type => type.type)).toContain('shot')
    expect(keysOf(runtime, 'dv.canvas.card')).toContain('shot')
    expect(keysOf(runtime, 'dv.canvas.editor')).toContain('shot')
    expect(canvas.actions.getSnapshot().map(action => action.id)).toContain('@dv/ui-shot-render:shot:retry')
    await waitFor(() => { expect(node('g2').querySelector('[data-node-frame] img')).not.toBeNull() })

    await kinds.takes?.dispose()
    expect(canvas.nodeTypes.getSnapshot().map(type => type.type)).not.toContain('shot')
    expect(keysOf(runtime, 'dv.canvas.card')).not.toContain('shot')
    expect(keysOf(runtime, 'dv.canvas.editor')).not.toContain('shot')
    expect(canvas.actions.getSnapshot().map(action => action.id)).not.toContain('@dv/ui-shot-render:shot:retry')
    await waitFor(() => { expect(node('g2').querySelector('[data-node-frame]')?.textContent).toBe('shot') })
    expect(() => canvas.nodeTypes.register(OTHER_SHOT)).not.toThrow()
    await runtime.dispose()
  })

  it('refuses a second type of the shot kind, naming the package that holds it', async () => {
    const { runtime } = await mountCanvas({ kinds: ['takes'] })
    expect(() => runtime.ctx.dvCanvas.nodeTypes.register(OTHER_SHOT))
      .toThrow('registry key "shot" is already registered by @dv/ui-shot-render')
    await runtime.dispose()
  })

  it('kinds mounted before ui-canvas and ui-media register once they come, and register again after ui-canvas reloads', async () => {
    let before: { canvas: unknown; cards: Array<string | undefined> } | null = null
    const { runtime, node, canvas } = await mountCanvas({
      kinds: ['reference', 'takes'],
      beforeCanvas: (mounted) => { before = { canvas: mounted.ctx.get('dvCanvas'), cards: keysOf(mounted, 'dv.canvas.card') } },
    })
    expect(before).toEqual({ canvas: undefined, cards: [] })
    expect(runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(type => type.type).sort()).toEqual(['shot', 'test_ref'])
    expect(keysOf(runtime, 'dv.canvas.card').sort()).toEqual(['shot', 'test_ref'])
    await waitFor(() => { node('g2') })
    // ui-media mounts last; the shots' card then draws the still through its `dv.media` occurrence.
    expect(node('g2').querySelector('img')).toBeNull()
    await runtime.mount(KINDS.media)
    await runtime.mount(KINDS.assets)
    await waitFor(() => { expect(node('g2').querySelector('img')?.getAttribute('src')).toBe(assetUrl('shot2-last.png')) })

    await canvas.dispose()
    expect(keysOf(runtime, 'dv.canvas.card')).toEqual([])
    const reloaded = await runtime.mount({ inject: [...inject], apply })
    expect(runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(type => type.type).sort()).toEqual(['asset', 'shot', 'test_ref'])
    expect(keysOf(runtime, 'dv.canvas.card').sort()).toEqual(['asset', 'shot', 'test_ref'])
    await reloaded.dispose()
    await runtime.dispose()
  })
})
