// @vitest-environment jsdom
/**
 * The canvas conformance check: with today's kinds registered by their owning packages (the reference noun through the
 * reference kit, the plan by `@dv/ui-shot-plan`, assets by `@dv/ui-asset-pool`, video takes by `@dv/ui-shot-render`
 * through the generation kit), the kind-free builder draws the graph that the canvas of `origin/main` drew for each of
 * the 23 cases: node IDs and types, titles and meta, default positions, version numbers, badges, flags, unseen
 * eligibility, card heights, slot frames, edges with the first-frame role, and the node of each asset. The History
 * panel labels each record of a case as `main` labelled it, with the rows that the same packages register.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import { defineReferenceUi } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import type { WireReferenceVersion } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as shotPlanApply, inject as shotPlanInject } from '../../ui-shot-plan/src/client/index.ts'
import { apply as shotRenderApply, inject as shotRenderInject } from '../../ui-shot-render/src/client/index.ts'
import { apply as historyApply, inject as historyInject } from '../../ui-history/src/client/index.ts'
import type { HistoryRow } from '../../ui-history/src/client/contract/index.ts'
import { actionLabel } from '../../ui-history/src/client/rows.ts'
import type { NodeType } from '../src/client/contract/index.ts'
import { buildCanvasGraph, isFinished, previewOf, slotFrames } from '../src/client/graph.ts'
import type { CanvasRegistrations } from '../src/client/graph.ts'
import { apply, inject } from '../src/client/index.ts'
import { cardHeight } from '../src/client/NodeCard.tsx'
import { APPROVAL, CLIPS, conformanceCases, OPS } from './fixtures/conformance-states.client.ts'
import type { ComparedGraph, ComparedNode } from './fixtures/conformance-states.client.ts'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { test_ref: Record<string, WireReferenceVersion[]> } }

/**
 * The graphs of the canvas and the History labels of `origin/main` at the branch's merge base, written by
 * `fixtures/main-graph.gen.client.ts`.
 */
const MAIN = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/main-graph.json'), 'utf8')) as Record<string, ComparedGraph>

/**
 * The canvas and History with today's kinds, mounted through their plugins, plus the cases' chain anchor and clip uses.
 * @returns the registrations that the canvas reads, the registered History rows, and the runtime.
 */
async function registered(): Promise<{ registrations: CanvasRegistrations; rows: readonly HistoryRow[]; runtime: SlotTestRuntime }> {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.mount({ inject: [...inject], apply })
  await runtime.mount({ inject: [...historyInject], apply: historyApply })
  const testRef = defineReferenceUi({
    id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref, color: 'var(--dv-node-1)',
    label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
  })
  await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
  await runtime.mount({ inject: [...shotPlanInject], apply: shotPlanApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount({ inject: [...shotRenderInject], apply: shotRenderApply })
  const canvas = runtime.ctx.dvCanvas
  canvas.chainAnchors.register(APPROVAL)
  canvas.recordsInUse.register(CLIPS)
  return {
    runtime,
    rows: runtime.ctx.dvHistory.rows.getSnapshot(),
    registrations: {
      nodeTypes: canvas.nodeTypes.getSnapshot(), chainAnchors: canvas.chainAnchors.getSnapshot(),
      recordsInUse: canvas.recordsInUse.getSnapshot(), versionKinds: canvas.versionKinds.getSnapshot(),
    },
  }
}

/**
 * The SDK graph and History labels of one case as the check compares them.
 * @param state - the case's state.
 * @param placed - the assets on the canvas.
 * @param registrations - the registered descriptors.
 * @param rows - the registered History rows.
 * @returns the compared graph.
 */
function sdkGraph(
  state: WireState, placed: readonly string[], registrations: CanvasRegistrations, rows: readonly HistoryRow[],
): ComparedGraph {
  const graph = buildCanvasGraph(state, new Set(placed), OPS, 'zh', registrations)
  const nodes = graph.nodes.map((node): ComparedNode => {
    const frames = node.slots === undefined ? null : slotFrames(graph.nodes, node.id, node.slots).map(frame => frame?.preview ?? null)
    return {
      id: node.id, type: node.type, x: node.x, y: node.y, number: node.version, title: node.title, meta: node.meta ?? null,
      badges: node.badges, flags: node.flags,
      finished: isFinished(node), height: cardHeight(node, frames?.some(frame => frame !== null) === true), frames,
    }
  })
  const edges = graph.edges.map(edge => `${edge.from}>${edge.to}:${edge.kind}${edge.role === 'first_frame' ? ':first_frame' : ''}`).sort()
  const records = new Map(state.components.proj.records.map(record => [record.id, record]))
  const labelOf = (record: ProjectRecord): string => actionLabel(record, { operations: OPS, rows, records })[0]
  const labels = Object.fromEntries([...records.values()].map(record => [record.id, labelOf(record)]))
  return { nodes, edges, assetNodes: graph.assetNodes, labels }
}

describe('canvas conformance with origin/main', () => {
  it('draws the graph and the History labels of main on all 23 cases with the kinds registered by their owning packages', async () => {
    document.documentElement.lang = 'zh-CN'
    const { registrations, rows, runtime } = await registered()
    expect(registrations.nodeTypes.map(type => type.type).sort()).toEqual(['asset', 'plan', 'take', 'test_ref'])
    const cases = conformanceCases()
    expect(cases).toHaveLength(23)
    const byId = (graph: ComparedGraph): Record<string, ComparedNode> => Object.fromEntries(graph.nodes.map(node => [node.id, node]))
    for (const { name, state, placed } of cases) {
      const main = MAIN[name]
      const sdk = sdkGraph(state, placed, registrations, rows)
      expect({ name, ...sdk, nodes: byId(sdk) }).toEqual({ name, ...main, nodes: byId(main as ComparedGraph) })
    }
    document.documentElement.lang = ''
    await runtime.dispose()
  })

  it('computes the card heights of main: 60 for a noun, 76 and 140 for a plan, 147 for a take or an asset, 52 for a failed take', async () => {
    const { registrations, runtime } = await registered()
    const heights = new Set(Object.values(MAIN).flatMap(graph => graph.nodes.map(node => node.height)))
    expect([...heights].sort((a, b) => a - b)).toEqual([60, 76, 140, 147])
    // No case holds a failed take, so its height comes from a take of the fixture project whose record failed.
    const state = conformanceCases().find(each => each.name === 'fixture project')?.state
    if (state === undefined) throw new Error('no fixture project')
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g2' ? { ...entry, status: 'failed' as const } : entry)
    const failed = buildCanvasGraph(state, new Set(), OPS, 'zh', registrations).nodes.find(node => node.id === 'g2')
    expect(failed === undefined ? null : [failed.claimed, failed.flags.failed, cardHeight(failed)]).toEqual([true, true, 52])
    await runtime.dispose()
  })

  it('draws a pending claimed record before it has outputs, with its type\'s running words', async () => {
    document.documentElement.lang = 'zh-CN'
    const { registrations, runtime } = await registered()
    const state = conformanceCases().find(each => each.name === 'fixture project')?.state
    if (state === undefined) throw new Error('no fixture project')
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
  /**
   * A state with an `image.generate` record of the chain of approval `a1`, a newer approval `a9` of the same plan, and a
   * free `shot.render` record that reads the image as its first frame.
   */
  function imageState(): WireState {
    const state = conformanceCases().find(each => each.name === 'fixture project')?.state
    if (state === undefined) throw new Error('no fixture project')
    const base = state.components.proj.records[0]
    if (base === undefined) throw new Error('no record')
    state.components.proj.records.push(
      { ...base, id: 'i1', operation: 'image.generate', deterministic: false, inputs: [], outputs: ['i1.png'], params: {}, started_by: { record: 'a1', slot: 1 } },
      { ...base, id: 'a9', operation: 'plan.approve', params: { plan: 'p1' } },
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

  it('keeps a claimed record of an earlier chain drawn while a current record of another type reads it as its first frame', async () => {
    const { registrations, runtime } = await registered()
    const still: NodeType = {
      id: '@dv/ui-test-still', type: 'still', label: () => 'still', color: '', column: 2,
      claimed: { operations: ['image.generate'], status: { running: () => '', failed: () => '' }, entry: () => ({ title: 'i1', bodyHeight: 117 }) },
    }
    const withStill = { ...registrations, nodeTypes: [...registrations.nodeTypes, still] }
    const graph = buildCanvasGraph(imageState(), new Set(), OPS, 'zh', withStill)
    const image = graph.nodes.find(node => node.id === 'i1')
    const take = graph.nodes.find(node => node.id === 'i2')
    expect(graph.edges.filter(edge => edge.to === 'i2')).toEqual([{ from: 'i1', to: 'i2', kind: 'input', role: 'first_frame' }])
    expect(image !== undefined && take !== undefined && take.x > image.x).toBe(true)
    // Without the reader, the image is a record of a replaced chain and is not drawn.
    const unread = imageState()
    unread.components.proj.records = unread.components.proj.records.filter(entry => entry.id !== 'i2')
    expect(buildCanvasGraph(unread, new Set(), OPS, 'zh', withStill).nodes.some(node => node.id === 'i1')).toBe(false)
    await runtime.dispose()
  })
})
