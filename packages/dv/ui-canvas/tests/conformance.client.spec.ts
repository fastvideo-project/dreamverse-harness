// @vitest-environment jsdom
/** The graph of the fixture project of `fixtures/conformance-states.client.ts`, drawn with the kinds registered by their owning plugins. */
import { describe, expect, it } from 'vitest'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { WireState } from '@dv/ui-kit/types.ts'
import { defineReferenceUi } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import type { WireReferenceVersion } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as shotRenderApply, inject as shotRenderInject } from '../../ui-shot-render/src/client/index.ts'
import type { NodeType } from '../src/client/contract/index.ts'
import { buildCanvasGraph, previewOf } from '../src/client/graph.ts'
import type { CanvasRegistrations } from '../src/client/graph.ts'
import { apply, inject } from '../src/client/index.ts'
import { CLIPS, fixtureProject, OPS } from './fixtures/conformance-states.client.ts'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { test_ref: Record<string, WireReferenceVersion[]> } }

/**
 * Mount the canvas and the kind plugins, and register the cases' clip uses.
 * @returns the registrations that the canvas reads and the runtime.
 */
async function registered(): Promise<{ registrations: CanvasRegistrations; runtime: SlotTestRuntime }> {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.mount({ inject: [...inject], apply })
  const testRef = defineReferenceUi({
    id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref, color: 'var(--dv-node-1)',
    label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
  })
  await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount({ inject: [...shotRenderInject], apply: shotRenderApply })
  const canvas = runtime.ctx.dvCanvas
  canvas.recordsInUse.register(CLIPS)
  return {
    runtime,
    registrations: {
      nodeTypes: canvas.nodeTypes.getSnapshot(),
      recordsInUse: canvas.recordsInUse.getSnapshot(), versionKinds: canvas.versionKinds.getSnapshot(),
    },
  }
}

describe('fixture project', () => {
  it('draws a pending claimed record before it has outputs, with its type\'s running words', async () => {
    document.documentElement.lang = 'zh-CN'
    const { registrations, runtime } = await registered()
    const state = fixtureProject()
    const pending = buildCanvasGraph(state, new Set(), OPS, 'zh', registrations).nodes.find(node => node.id === 'g3')
    const facts = pending === undefined
      ? null
      : [pending.claimed, pending.assets, pending.flags.rendering, pending.nodeType.claimed?.status.running(), previewOf(pending)]
    expect(facts)
      .toEqual([true, [], true, '渲染中…', null])
    document.documentElement.lang = ''
    await runtime.dispose()
  })
})

describe('claims of an unloaded type', () => {
  /** A state with an `image.generate` record and a `shot.render` record that reads the image as its first frame. */
  function imageState(): WireState {
    const state = fixtureProject()
    const base = state.components.proj.records[0]
    if (base === undefined) throw new Error('no record')
    state.components.proj.records.push(
      { ...base, id: 'i1', operation: 'image.generate', deterministic: false, inputs: [], outputs: ['i1.png'], params: {} },
      {
        ...base, id: 'i2', operation: 'shot.render', deterministic: false, outputs: ['i2.mp4'], params: {},
        inputs: [{ role: 'first_frame', ref: { record: 'i1', output: 0 }, resolved_asset: 'i1.png' }],
      },
    )
    state.components.proj.created_by['i1.png'] = 'i1'
    state.components.proj.created_by['i2.mp4'] = 'i2'
    state.assets.push({ ...state.assets[0]!, id: 'i1.png', created_by: 'i1' }, { ...state.assets[1]!, id: 'i2.mp4', created_by: 'i2' })
    return state
  }

  it('draws no node for a record whose operation no loaded type claims, and links no edge from it', async () => {
    const { registrations, runtime } = await registered()
    const graph = buildCanvasGraph(imageState(), new Set(), OPS, 'zh', registrations)
    expect(graph.nodes.some(node => node.id === 'i1')).toBe(false)
    expect(graph.edges.filter(edge => edge.to === 'i2')).toEqual([])
    await runtime.dispose()
  })

  it('draws a claimed record of another type left of the take that reads it as its first frame, with a first-frame edge', async () => {
    const { registrations, runtime } = await registered()
    const still: NodeType = {
      id: '@dv/ui-test-still', type: 'still', label: () => 'still', color: '', column: 2,
      claimed: { operations: ['image.generate'], status: { running: () => '', failed: () => '' }, entry: () => ({ title: 'i1', bodyHeight: 117 }) },
    }
    const withStill: CanvasRegistrations = { ...registrations, nodeTypes: [...registrations.nodeTypes, still] }
    const graph = buildCanvasGraph(imageState(), new Set(), OPS, 'zh', withStill)
    const image = graph.nodes.find(node => node.id === 'i1')
    const take = graph.nodes.find(node => node.id === 'i2')
    expect(graph.edges.filter(edge => edge.to === 'i2')).toEqual([{ from: 'i1', to: 'i2', kind: 'input', role: 'first_frame' }])
    expect(image !== undefined && take !== undefined && take.x > image.x).toBe(true)
    await runtime.dispose()
  })
})
