// @vitest-environment jsdom
/** The generation plugin checks of `plugin-proofs.client.tsx`, run on `@dv/ui-shot-render` and on plain values. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import { OPERATIONS } from '../../ui-kit/tests/fixture.client.tsx'
import { forgetCanvasStorage } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import * as shotRender from '../../ui-shot-render/src/client/index.ts'
import { mountPrimitive, notJsonOrCallback, onlyNodeOf } from './plugin-proofs.client.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  forgetCanvasStorage()
})

describe('the generation plugin checks', () => {
  it('mount a plugin before ui-canvas and find exactly one node of its record', async () => {
    const operation = OPERATIONS[0]
    if (operation === undefined) throw new Error('no shot.render declaration')
    const canvas = await mountPrimitive(
      shotRender, { operation, type: 'shot', output: { id: 'p1d.mp4', mime: 'video/mp4' } }, false, ['reference', 'assets', 'media'],
    )
    const node = await onlyNodeOf(canvas, 'p1d', 'shot')
    await waitFor(() => { expect(node.querySelector('video')?.getAttribute('src')).toBe(`${assetUrl('p1d.mp4')}#t=0.1`) })
    await canvas.runtime.dispose()
  })

  it('name every path that is not JSON data or a function, and skip the hooks compartment', () => {
    const source = { getSnapshot: () => 1, subscribe: () => () => undefined }
    expect(notJsonOrCallback({ a: [1, 'x', null, { b: true }], run: () => undefined, hooks: { source: new DvClient() } })).toEqual([])
    expect(notJsonOrCallback({ client: new DvClient(), list: [new Date()], nested: { set: new Set() }, source })).toEqual([
      '$.client', '$.list[0]', '$.nested.set',
    ])
  })
})
