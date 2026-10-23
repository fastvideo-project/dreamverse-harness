// @vitest-environment jsdom
/** Canvas nodes and edges derived from a project state and the node types that the kind packages register. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId, RecordId } from '@dv/project/types'
import type { PlanId, PlanVersion } from '@dv/shot-plan/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import type { ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import { assetNodeType } from '../../ui-asset-pool/src/client/canvas.tsx'
import { asset, fixtureState, OPERATIONS, record, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { referenceDescriptors } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import { planNodeType, planReferencesInUse } from '../../ui-shot-plan/src/client/index.ts'
import { apply as shotRenderApply, inject as shotRenderInject } from '../../ui-shot-render/src/client/index.ts'
import type { ChainAnchor, NodeEntry, NodeType, RecordsInUse } from '../src/client/contract/index.ts'
import { buildCanvasGraph, freePositions, NODE_WIDTH, previewOf, ROW, slotFrames } from '../src/client/graph.ts'
import type { CanvasGraph, CanvasRegistrations } from '../src/client/graph.ts'
import { apply, inject } from '../src/client/index.ts'
import { APPROVAL, CLIPS } from './fixtures/conformance-states.client.ts'

const testRef = referenceDescriptors({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref, color: 'var(--dv-node-1)',
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

let runtime: SlotTestRuntime
/** The `shot.render` take type of `@dv/ui-shot-render`, which only its mounted plugin registers. */
let take: NodeType

beforeEach(async () => {
  runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.mount({ inject: [...inject], apply })
  await runtime.mount({ inject: [...shotRenderInject], apply: shotRenderApply })
  const registered = runtime.ctx.dvCanvas.nodeTypes.getSnapshot().find(type => type.type === 'take')
  if (registered === undefined) throw new Error('@dv/ui-shot-render registered no take type')
  take = registered
})

afterEach(async () => {
  await runtime.dispose()
})

/**
 * @param parts - the descriptors that the test registers.
 * @returns the registrations, with no chain anchor, records in use or version kind unless `parts` names them.
 */
function kinds(parts: Partial<CanvasRegistrations> & Pick<CanvasRegistrations, 'nodeTypes'>): CanvasRegistrations {
  return { chainAnchors: [], recordsInUse: [], versionKinds: [], ...parts }
}

function allKinds(): CanvasRegistrations {
  return {
    nodeTypes: [testRef.nodeType, planNodeType, assetNodeType, take], chainAnchors: [APPROVAL],
    recordsInUse: [testRef.referencesInUse, planReferencesInUse, CLIPS], versionKinds: [testRef.versionKind],
  }
}

/**
 * @param state - a project state.
 * @param registrations - the registered descriptors.
 * @param placed - the assets on the canvas.
 * @param language - the interface language.
 * @returns the canvas graph.
 */
function graphOf(state: WireState, registrations: CanvasRegistrations, placed: readonly string[] = [], language: 'zh' | 'en' = 'zh'): CanvasGraph {
  return buildCanvasGraph(state, new Set(placed), OPERATIONS, language, registrations)
}

const anchorOf = (starter: string): ChainAnchor => ({ starter, anchor: approval => `plan:${String(approval.params['plan'])}` })

function sliceType(entries: ReadonlyArray<Omit<NodeEntry, 'bodyHeight'>>, column = 0): NodeType {
  return {
    id: '@dv/ui-test-slice', type: 'slice', label: () => 'slice', color: '', column,
    entries: () => entries.map(entry => ({ ...entry, bodyHeight: 30 })),
  }
}

/** Six shot prompts of plan p1 version 1; versions 2 and 3 change shot 3 and add shot 7, version 4 returns to these. */
const PROMPTS = ['rain', 'alley', 'door', 'stairs', 'roof', 'dawn']

/**
 * A project shaped like a creator's real one: plan p1 v1 with 6 shots approved and rendered (r1–r6); v2 changes shot 3
 * and adds shot 7 (s3, s7), with a retake of shot 7 (x7); v3 changes shot 5 (w5); the agent then put the v1 take of shot
 * 3 back on the timeline and wrote v4 equal to v1, whose approval reuses every v1 take. Records after `until` are left
 * out, as an undo or a jump to that record leaves the state.
 * @param until - the last record ID kept; every record by default.
 * @returns the state.
 */
function rollbackProject(until?: string): WireState {
  const hero = { role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }
  // The approval of version n is a<n>: it starts each render, with its shot as slot, and its timeline record; a retake
  // has no started_by of its own.
  const render = (id: string, version: number, shot: number, basedOn: string | null = null): ProjectRecord => record({
    id, operation: 'shot.render', deterministic: false, inputs: [hero], based_on: basedOn, outputs: [`${id}.mp4`, `${id}.png`],
    params: { prompt: `shot ${String(shot)} v${String(version)}`, plan: 'p1', plan_version: version, shot },
    ...basedOn === null ? { started_by: { record: `a${String(version)}`, slot: shot } } : {},
  })
  const layout = (id: string, operation: string, clips: string[]): ProjectRecord => record({
    id, operation, params: { timeline: 't1', plan: 'p1' }, started_by: { record: `a${id.slice(1)}`, slot: null },
    inputs: clips.map(clip => ({ role: 'clip', ref: { record: clip, output: 0 }, resolved_asset: `${clip}.mp4` })),
  })
  const approve = (id: string, version: number): ProjectRecord => record({ id, operation: 'plan.approve', params: { plan: 'p1', version } })
  const v1 = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
  const all = [
    record({ id: 'u1', operation: 'asset.import', params: { name: 'ref.png' }, outputs: ['ref.png'] }),
    record({ id: 'e1', operation: 'test_ref.create', params: { test_ref: 'hero', name: 'Hero' } }),
    record({ id: 'q1', operation: 'plan.create', report: { plan: 'p1', version: 1 } }),
    approve('a1', 1), ...v1.map((id, index) => render(id, 1, index + 1)), layout('l1', 'timeline.create', v1),
    record({ id: 'q2', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } }),
    approve('a2', 2), render('s3', 2, 3), render('s7', 2, 7), layout('l2', 'timeline.update', ['r1', 'r2', 's3', 'r4', 'r5', 'r6', 's7']),
    render('x7', 2, 7, 's7'),
    record({ id: 'q3', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 3 } }),
    approve('a3', 3), render('w5', 3, 5), layout('l3', 'timeline.update', ['r1', 'r2', 's3', 'r4', 'w5', 'r6', 's7']),
    record({ id: 'k1', operation: 'timeline.clip_replace', params: { timeline: 't1', clip: 'cl3' }, inputs: [{ role: 'clip', ref: { asset: 'r3.mp4' }, resolved_asset: 'r3.mp4' }] }),
    record({ id: 'q4', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 4 } }),
    approve('a4', 4), layout('l4', 'timeline.update', v1),
  ]
  const kept = until === undefined ? all : all.slice(0, all.findIndex(entry => entry.id === until) + 1)
  const ids = new Set(kept.map(entry => entry.id))
  const shots = (count: number, changed: Record<number, string> = {}): PlanVersion['shots'] =>
    Array.from({ length: count }, (_, index) => ({ prompt: changed[index + 1] ?? PROMPTS[index] ?? 'end', modality: 'video' as const, task: 'ref2v' as const, provider: 'fastvideo', model: 'fasth3' }))
  const versions: PlanVersion[] = [
    { version: 1, shots: shots(6), created_by: 'q1' as RecordId },
    { version: 2, shots: shots(7, { 3: 'door, closer' }), created_by: 'q2' as RecordId },
    { version: 3, shots: shots(7, { 3: 'door, closer', 5: 'roof, wider' }), created_by: 'q3' as RecordId },
    { version: 4, shots: shots(6), created_by: 'q4' as RecordId },
  ].filter(version => ids.has(version.created_by))
  const clips = (kept.findLast(entry => entry.operation?.startsWith('timeline.') === true && entry.id.startsWith('l'))?.inputs ?? [])
    .map((input, index) => ({ id: `cl${String(index + 1)}` as ClipId, asset: input.resolved_asset as AssetId | null, source: null, in_sec: null, out_sec: null }))
  if (ids.has('k1') && !ids.has('l4')) clips[2] = { id: 'cl3' as ClipId, asset: 'r3.mp4' as AssetId, source: null, in_sec: null, out_sec: null }
  const renders = kept.filter(entry => entry.operation === 'shot.render')
  const state = withTestRef(fixtureState())
  state.components.proj = {
    records: kept, stale: {}, superseded: {},
    created_by: Object.fromEntries<string>([['ref.png', 'u1'], ...renders.flatMap(entry => entry.outputs.map(output => [output, entry.id] as const))]),
  }
  state.components.plan.plans = { ['p1' as PlanId]: versions }
  state.components.timeline.timelines = [{ id: 't1' as TimelineId, name: '', clips }]
  state.assets = [
    asset('ref.png', 'image/png', 'u1'),
    ...renders.flatMap(entry => [asset(`${entry.id}.mp4`, 'video/mp4', entry.id, 1), asset(`${entry.id}.png`, 'image/png', entry.id)]),
  ]
  return state
}

/**
 * @param state - a project state.
 * @returns the `[id, type]` pairs of the nodes that every kind package draws for it, in node order.
 */
function drawn(state: WireState): string[][] {
  return graphOf(state, allKinds()).nodes.map(node => [node.id, node.type])
}

describe('buildCanvasGraph', () => {
  it('draws the reference item, the plan and the takes with their input, first-frame and lineage edges, flags, badges and versions', () => {
    const graph = graphOf(withTestRef(fixtureState()), allKinds())
    expect(graph.nodes.map(node => [node.id, node.type])).toEqual([
      ['test_ref:hero', 'test_ref'], ['plan:p1', 'plan'], ['g1', 'take'], ['g2', 'take'], ['g3', 'take'],
    ])
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    const g1 = byId.get('g1')
    expect(byId.get('test_ref:hero')).toMatchObject({
      type: 'test_ref', nodeType: testRef.nodeType, claimed: false, assets: ['ref.png'], x: 0,
    })
    expect(g1).toMatchObject({ claimed: true, assets: ['shot1.mp4', 'shot1-last.png'] })
    expect([byId.get('test_ref:hero')?.record?.id, g1?.record?.id]).toEqual(['e1', 'g1'])
    expect(g1 === undefined ? null : previewOf(g1)).toBe('shot1-last.png')
    expect(g1?.flags).toEqual({ stale: false, rendering: false, failed: false, superseded: false })
    expect(byId.get('g2')?.flags.stale).toBe(true)
    expect(byId.get('g3')?.flags.rendering).toBe(true)
    expect(byId.get('g2')?.badges).toEqual(['trim'])
    expect(graph.edges).toHaveLength(5)
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'test_ref:hero', to: 'g1', kind: 'input', role: 'reference' },
      { from: 'test_ref:hero', to: 'g2', kind: 'input', role: 'reference' },
      { from: 'g1', to: 'g2', kind: 'input', role: 'first_frame' },
      { from: 'test_ref:hero', to: 'g3', kind: 'input', role: 'reference' },
      { from: 'g1', to: 'g3', kind: 'lineage' },
    ]))
    expect(byId.get('g2')?.x).toBeGreaterThan(g1?.x ?? Infinity)
    expect(byId.get('g3')?.x).toBe(g1?.x)
    expect(['g1', 'g3', 'g2'].map(id => byId.get(id)?.version)).toEqual([1, 2, null])
    expect(graph.assetNodes).toMatchObject({
      'ref.png': 'test_ref:hero', 'shot1.mp4': 'g1', 'export.mp4': 'g2', 'export-last.png': 'g2',
    })
  })

  it('draws only the nodes of registered types and only the badges that a RecordsInUse reports', () => {
    const { nodeTypes, recordsInUse } = allKinds()
    const graph = graphOf(withTestRef(fixtureState()), {
      ...allKinds(), nodeTypes: nodeTypes.filter(type => type !== planNodeType), recordsInUse: recordsInUse.filter(uses => uses !== CLIPS),
    })
    expect(graph.nodes.some(node => node.id === 'plan:p1')).toBe(false)
    expect(graph.nodes.find(node => node.id === 'g2')?.badges).toEqual([])
  })

  it('draws no node for a generation record that no node type claims: the canvas has no take rule of its own', () => {
    // Without the take type, the done shot.render records with video and still outputs are the records that a
    // built-in take rule in the canvas would draw as takes.
    const { nodeTypes } = allKinds()
    const state = withTestRef(fixtureState())
    const graph = graphOf(state, { ...allKinds(), nodeTypes: nodeTypes.filter(type => type !== take) })
    const renders = state.components.proj.records.filter(entry => entry.operation === 'shot.render').map(entry => entry.id)
    expect(renders.length).toBeGreaterThan(0)
    expect(graph.nodes.filter(node => renders.includes(node.id) || node.record?.operation === 'shot.render')).toEqual([])
  })

  it('draws an imported asset only while it is on the canvas list, and never a reference image of an item', () => {
    const state = withTestRef(fixtureState())
    const proj = state.components.proj
    const names = ['pool.png', 'used.png', 'listed.png', 'side.png']
    state.assets.push(...names.map((name, index) => asset(name, 'image/png', `u${String(index + 2)}`)))
    proj.records.push(...names.map((name, index) => record({ id: `u${String(index + 2)}`, operation: 'asset.import', params: { name }, outputs: [name] })))
    names.forEach((name, index) => { proj.created_by[name] = `u${String(index + 2)}` })
    proj.records.push(record({
      id: 'e2', operation: 'test_ref.update', params: { test_ref: 'hero' },
      inputs: [{ role: 'reference', ref: { asset: 'side.png' }, resolved_asset: 'side.png' }],
    }))
    state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['ref.png', 'side.png'], created_by: 'e2' })
    proj.records.push(record({
      id: 'g9', operation: 'shot.render', deterministic: false, params: { prompt: 'alone' },
      inputs: [{ role: 'reference', ref: { asset: 'used.png' }, resolved_asset: 'used.png' }],
    }))
    const graph = graphOf(state, allKinds(), ['listed.png', 'side.png', 'ref.png'])
    expect(graph.nodes.filter(node => node.type === 'asset').map(node => node.id)).toEqual(['u4'])
    expect(graph.nodes.find(node => node.id === 'test_ref:hero')?.assets).toEqual(['ref.png', 'side.png'])
    expect(graph.edges.filter(edge => edge.to === 'g9')).toEqual([])
    expect(graph.assetNodes).toMatchObject({ 'listed.png': 'u4', 'side.png': 'test_ref:hero' })
    expect([graph.assetNodes['pool.png'], graph.assetNodes['used.png']]).toEqual([undefined, undefined])
    const listed = graphOf(state, allKinds(), ['listed.png', 'used.png'])
    expect(listed.edges).toContainEqual({ from: 'u3', to: 'g9', kind: 'input', role: 'reference' })
  })

  it('gives an earlier version\'s assets to the node of its item through the version kind, so a placed old reference draws no stand-in', () => {
    const state = withTestRef(fixtureState())
    state.assets.push(asset('side.png', 'image/png', null))
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
      ? { ...entry, inputs: [{ role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }] }
      : entry)
    // Version 2 of Hero replaced ref.png with side.png; ref.png stays on the canvas.
    state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['side.png'], created_by: 'e2' })
    const graph = graphOf(state, allKinds(), ['ref.png'])
    expect(graph.nodes.filter(node => node.type === 'asset')).toEqual([])
    expect(graph.assetNodes['ref.png']).toBe('test_ref:hero')
    expect(graph.edges).toContainEqual({ from: 'test_ref:hero', to: 'g1', kind: 'input', role: 'reference' })
    const noVersionKind = graphOf(state, { ...allKinds(), versionKinds: [] }, ['ref.png'])
    expect(noVersionKind.nodes.filter(node => node.type === 'asset').map(node => node.id)).toEqual(['u1'])
    expect(noVersionKind.edges).toContainEqual({ from: 'u1', to: 'g1', kind: 'input', role: 'reference' })
    const { nodeTypes } = allKinds()
    const noNoun = graphOf(state, { ...allKinds(), nodeTypes: nodeTypes.filter(type => type !== testRef.nodeType) }, ['ref.png'])
    expect(noNoun.nodes.filter(node => node.type === 'asset').map(node => node.id)).toEqual(['u1'])
  })

  it('links a version input from the node of its item when its kind has a VersionKind, else from the node that owns its asset', () => {
    const state = withTestRef(fixtureState())
    state.assets.push(asset('zz.png', 'image/png', 'u9'))
    state.components.proj.created_by['zz.png'] = 'u9'
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g1'
      ? { ...entry, inputs: [{ role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }] }
      : entry)
    state.components.proj.records.push(
      record({ id: 'u9', operation: 'asset.import', params: { name: 'zz.png' }, outputs: ['zz.png'] }),
      record({
        id: 'g9', operation: 'shot.render', deterministic: false, params: { prompt: 'z1 waits' },
        inputs: [{ role: 'reference', ref: { zz: 'z1', version: 3 }, resolved_asset: 'zz.png' }],
      }),
    )
    const board = sliceType([{ id: 'board:b1', title: 'Mood board', record: null, assets: ['ref.png'] }])
    const { nodeTypes } = allKinds()
    const graph = graphOf(state, { ...allKinds(), nodeTypes: [board, ...nodeTypes] }, ['zz.png'])
    expect(graph.edges).toContainEqual({ from: 'test_ref:hero', to: 'g1', kind: 'input', role: 'reference' })
    expect(graph.edges).toContainEqual({ from: 'u9', to: 'g9', kind: 'input', role: 'reference' })
    expect(graph.edges).toContainEqual({ from: 'board:b1', to: 'g2', kind: 'input', role: 'reference' })
  })

  it('draws a placed asset that no record of the current state imported as asset:<id>, and no stand-in for an asset another node owns', () => {
    const state = fixtureState()
    // An undo went back past the import of undone.png: the asset pool keeps it, the current state has no import record.
    state.assets.push(asset('undone.png', 'image/png', 'u9', null, 'asset.import'))
    const graph = graphOf(state, kinds({ nodeTypes: [assetNodeType, take] }), ['undone.png', 'shot1-last.png', 'export-last.png'])
    expect(graph.nodes.find(node => node.id === 'asset:undone.png'))
      .toMatchObject({ type: 'asset', claimed: false, title: 'undone.png', record: null, assets: ['undone.png'] })
    expect(graph.nodes.filter(node => node.type === 'asset').map(node => node.id).sort())
      .toEqual(['asset:export-last.png', 'asset:undone.png'])
    expect(graph.assetNodes).toMatchObject({ 'undone.png': 'asset:undone.png', 'shot1-last.png': 'g1' })
  })

  it('draws one node for an asset imported twice', () => {
    const state = fixtureState()
    state.assets.push(asset('twice.png', 'image/png', 'u2'))
    state.components.proj.records.push(
      record({ id: 'u2', operation: 'asset.import', params: { name: 'twice.png' }, outputs: ['twice.png'] }),
      record({ id: 'u3', operation: 'asset.import', params: { name: 'twice.png' }, outputs: ['twice.png'] }),
    )
    state.components.proj.created_by['twice.png'] = 'u3'
    const graph = graphOf(state, kinds({ nodeTypes: [assetNodeType] }), ['twice.png'])
    expect(graph.nodes.filter(node => node.type === 'asset').map(node => node.id)).toEqual(['u2'])
    expect(graph.assetNodes['twice.png']).toBe('u2')
  })

  it('draws a slice node in its type\'s column with its assets, so a take that reads one links from it and its import draws no stand-in', () => {
    const state = fixtureState()
    const reads = (id: string): ProjectRecord['inputs'] => [{ role: 'reference', ref: { asset: id }, resolved_asset: id }]
    const m1 = record({ id: 'm1', operation: 'prop.create', inputs: reads('ref.png') })
    state.components.proj.records.push(
      record({ id: 'u2', operation: 'asset.import', params: { name: 'umbrella.png' }, outputs: ['umbrella.png'] }), m1,
      record({ id: 'g4', operation: 'shot.render', deterministic: false, inputs: reads('umbrella.png'), outputs: ['g4.png'] }),
    )
    state.assets.push(asset('umbrella.png', 'image/png', 'u2'), asset('g4.png', 'image/png', 'g4'))
    Object.assign(state.components.proj.created_by, { 'umbrella.png': 'u2', 'g4.png': 'g4' })
    const prop = sliceType([{ id: 'prop:m1', record: m1, title: 'Red umbrella', assets: ['umbrella.png'] }], 1)
    const placed = ['umbrella.png']
    expect(graphOf(state, kinds({ nodeTypes: [assetNodeType, take] }), placed).nodes.some(node => node.id === 'u2')).toBe(true)
    const graph = graphOf(state, kinds({ nodeTypes: [prop, planNodeType, assetNodeType, take] }), placed)
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    expect(byId.get('prop:m1')).toMatchObject({ nodeType: prop, claimed: false, title: 'Red umbrella', assets: ['umbrella.png'], record: m1 })
    expect(byId.has('u2')).toBe(false)
    expect(graph.assetNodes['umbrella.png']).toBe('prop:m1')
    expect(graph.edges).toContainEqual({ from: 'prop:m1', to: 'g4', kind: 'input', role: 'reference' })
    expect(graph.edges.some(edge => edge.to === 'prop:m1')).toBe(false)
    expect(byId.get('prop:m1')?.x).toBe(byId.get('plan:p1')?.x)
  })

  it('refuses to draw two nodes with one ID and names both node types', () => {
    const twin = (type: string): NodeType => ({
      id: `@dv/ui-test-${type}`, type, label: () => type, color: '', column: 0,
      entries: () => [{ id: 'twin:1', title: type, record: null, assets: [], bodyHeight: 30 }],
    })
    const registrations = { nodeTypes: [twin('left'), twin('right')], chainAnchors: [], recordsInUse: [], versionKinds: [] }
    expect(() => buildCanvasGraph(fixtureState(), new Set(), OPERATIONS, 'zh', registrations))
      .toThrow('canvas node ID "twin:1" is drawn by the node types left and right')
  })

  it('draws each current record of a claimed type with its outputs as assets, numbers its based_on family, and leaves a chain with an unloaded starter unanchored', () => {
    const image: NodeType = {
      id: '@dv/ui-test-image', type: 'image', label: () => 'image', color: '', column: 2,
      claimed: { operations: ['image.generate'], status: { running: () => '', failed: () => '' }, entry: ({ record: { id } }) => ({ title: id, bodyHeight: 117 }) },
    }
    const state = fixtureState()
    state.components.proj.records.push(
      record({ id: 'w0', operation: 'w.approve', params: { plan: 'p1' } }),
      record({ id: 'i1', operation: 'image.generate', deterministic: false, outputs: ['cat.png'] }),
      record({ id: 'i2', operation: 'image.generate', deterministic: false, based_on: 'i1', started_by: { record: 'w1', slot: 2 }, outputs: ['cat2.png'] }),
    )
    state.assets.push(asset('cat.png', 'image/png', 'i1'), asset('cat2.png', 'image/png', 'i2'))
    Object.assign(state.components.proj.created_by, { 'cat.png': 'i1', 'cat2.png': 'i2' })
    const graph = graphOf(state, kinds({ nodeTypes: [assetNodeType, image], chainAnchors: [anchorOf('w.approve')] }), ['cat.png'])
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    expect([byId.get('i1'), byId.get('i2')].map(node => node === undefined ? null : [node.claimed, node.assets, node.version, node.chain]))
      .toEqual([[true, ['cat.png'], 1, null], [true, ['cat2.png'], 2, null]])
    expect(graph.edges).toEqual([{ from: 'i1', to: 'i2', kind: 'lineage' }])
    expect(graph.nodes.filter(node => node.type === 'asset')).toEqual([])
    expect(graph.assetNodes).toMatchObject({ 'cat.png': 'i1', 'cat2.png': 'i2' })
  })

  it('wraps a long shot list into a block of columns without overlapping cards', () => {
    const full = fixtureState()
    const records = full.components.proj.records
    const g2 = records.find(entry => entry.id === 'g2')
    if (g2 === undefined) throw new Error('fixture lacks g2')
    const shots = Array.from({ length: 22 }, (_, index) => ({ ...g2, id: `s${String(index)}`, inputs: [], params: { prompt: 'p', shot: index + 1 }, outputs: [] }))
    full.components.proj.records = [...records.filter(entry => entry.operation !== 'shot.render'), ...shots]
    const takes = graphOf(full, kinds({ nodeTypes: [take] })).nodes
    expect(takes).toHaveLength(22)
    expect(new Set(takes.map(node => `${String(node.x)},${String(node.y)}`)).size).toBe(22)
    const width = Math.max(...takes.map(node => node.x)) - Math.min(...takes.map(node => node.x))
    const height = Math.max(...takes.map(node => node.y))
    expect(width).toBeGreaterThan(0)
    expect(height).toBeLessThan(width * 2)
  })

  it('draws a take whose input resolved to no asset without an input edge', () => {
    const state = fixtureState()
    state.components.proj.records.push(record({
      id: 'g9', operation: 'shot.render', deterministic: false, params: { prompt: 'lost' },
      inputs: [{ role: 'reference', ref: { asset: 'gone.png' }, resolved_asset: null }],
    }))
    const graph = graphOf(state, kinds({ nodeTypes: [take] }))
    expect(graph.nodes.some(node => node.id === 'g9')).toBe(true)
    expect(graph.edges.filter(edge => edge.to === 'g9')).toEqual([])
  })

  it('anchors no chain on a record without an operation', () => {
    const state = fixtureState()
    state.components.proj.records.push(
      record({ id: 'n0', params: { plan: 'p1' } }),
      record({
        id: 'g9', operation: 'shot.render', deterministic: false, params: { prompt: 'free' }, started_by: { record: 'n0', slot: 1 },
      }),
    )
    const graph = graphOf(state, kinds({ nodeTypes: [take], chainAnchors: [anchorOf('story.approve')] }))
    expect(graph.nodes.find(node => node.id === 'g9')?.chain).toBeNull()
    expect(graph.edges.some(edge => edge.kind === 'chain')).toBe(false)
  })

  it('shows a badge label once on the node of its asset, and no badge for an asset that no node shows', () => {
    const { recordsInUse } = allKinds()
    const repeated: RecordsInUse = {
      id: 'test-badges', uses: () => [], badges: () => [{ asset: 'shot2.mp4', label: 'trim' }, { asset: 'nowhere.png', label: 'lost' }],
    }
    const graph = graphOf(withTestRef(fixtureState()), { ...allKinds(), recordsInUse: [...recordsInUse, repeated] })
    expect(graph.nodes.find(node => node.id === 'g2')?.badges).toEqual(['trim'])
    expect(graph.nodes.flatMap(node => node.badges)).toEqual(['trim'])
  })

  it('lays out two takes based on each other in their type\'s column', () => {
    const state = fixtureState()
    state.components.proj.records.push(
      record({ id: 'k1', operation: 'shot.render', deterministic: false, based_on: 'k2', params: { prompt: 'one' } }),
      record({ id: 'k2', operation: 'shot.render', deterministic: false, based_on: 'k1', params: { prompt: 'two' } }),
    )
    const graph = graphOf(state, kinds({ nodeTypes: [take] }))
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'k2', to: 'k1', kind: 'lineage' }, { from: 'k1', to: 'k2', kind: 'lineage' },
    ]))
    const column = byId.get('g1')?.x
    expect([byId.get('k1')?.x, byId.get('k2')?.x]).toEqual([column, column])
  })
})

describe('current state', () => {
  it('shows the latest plan version and the current take of each of its shots, not every take ever rendered', () => {
    const graph = graphOf(rollbackProject(), allKinds())
    expect(graph.nodes.map(node => [node.id, node.type])).toEqual([
      ['test_ref:hero', 'test_ref'], ['plan:p1', 'plan'], ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(id => [id, 'take']),
    ])
    const plan = graph.nodes.find(node => node.id === 'plan:p1')
    expect([plan?.slots, plan?.record?.id]).toEqual([6, 'q4'])
    expect(graph.nodes.filter(node => node.type === 'take').map(node => [node.chain?.slot, node.version]))
      .toEqual([1, 2, 3, 4, 5, 6].map(shot => [shot, null]))
    expect(graph.edges.filter(edge => edge.kind === 'chain').map(edge => [edge.from, edge.to]))
      .toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(id => ['plan:p1', id]))
    expect(graph.assetNodes['s7.mp4']).toBeUndefined()
    expect(graph.assetNodes['r3.mp4']).toBe('r3')
  })

  it('a jump back to an earlier step changes the canvas to that step\'s plan version and takes', () => {
    const l3 = graphOf(rollbackProject('l3'), allKinds())
    expect(l3.nodes.map(node => [node.id, node.type])).toEqual([
      ['test_ref:hero', 'test_ref'], ['plan:p1', 'plan'], ...['r1', 'r2', 'r4', 'r6', 's3', 's7', 'x7', 'w5'].map(id => [id, 'take']),
    ])
    expect(l3.nodes.find(node => node.id === 'plan:p1')?.slots).toBe(7)
    expect(drawn(rollbackProject('l1'))).toEqual([
      ['test_ref:hero', 'test_ref'], ['plan:p1', 'plan'], ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(id => [id, 'take']),
    ])
    expect(drawn(rollbackProject('e1'))).toEqual([['test_ref:hero', 'test_ref']])
  })

  it('keeps a take that a timeline clip plays current, and an unapproved latest version keeps the played takes', () => {
    const takesOf = (state: WireState): string[] => drawn(state).filter(([, type]) => type === 'take').map(([id]) => id ?? '')
    expect(takesOf(rollbackProject('k1'))).toEqual(['r1', 'r2', 'r3', 'r4', 'r6', 's7', 'x7', 'w5'])
    const pending = rollbackProject('q4')
    expect(pending.components.proj.records.some(entry => entry.id === 'a4')).toBe(false)
    expect(takesOf(pending)).toEqual(['r1', 'r2', 'r3', 'r4', 'r6', 's7', 'x7', 'w5'])
  })
})

describe('chain grouping', () => {
  const takeRecord = (id: string, startedBy: ProjectRecord['started_by'], basedOn: string | null = null): ProjectRecord => record({
    id, operation: 'shot.render', deterministic: false, based_on: basedOn, outputs: [`${id}.png`],
    ...startedBy === undefined ? {} : { started_by: startedBy },
  })

  /**
   * The shared fixture plus the takes of two story approvals, one ad approval and one unloaded starter on plan p1.
   * @param extra - more takes, placed right after h2.
   * @returns the state.
   */
  function chainState(extra: ProjectRecord[] = []): WireState {
    const state = fixtureState()
    const added = [
      record({ id: 'st0', operation: 'story.approve', params: { plan: 'p1' } }), takeRecord('n1', { record: 'st0', slot: 2 }),
      record({ id: 'st1', operation: 'story.approve', params: { plan: 'p1' } }), takeRecord('h1', { record: 'st1', slot: 1 }), takeRecord('h2', undefined, 'h1'),
      ...extra,
      record({ id: 'ad1', operation: 'ad.approve', params: { plan: 'p1' } }),
      takeRecord('v9', { record: 'ad1', slot: 1, lane: '9:16' }), takeRecord('v16', { record: 'ad1', slot: 1, lane: '16:9' }),
      takeRecord('o1', { record: 'zz1', slot: 2 }),
    ]
    state.components.proj.records.push(...added)
    for (const { id } of added.filter(entry => entry.operation === 'shot.render')) {
      state.assets.push(asset(`${id}.png`, 'image/png', id))
      state.components.proj.created_by[`${id}.png`] = id
    }
    return state
  }
  const ANCHORS = [anchorOf('story.approve'), anchorOf('ad.approve')]

  it('draws the chain of the newest starter of each operation on each node, every free take, and the records a RecordsInUse uses', () => {
    const takes = (state: WireState, recordsInUse: RecordsInUse[] = []): string[] =>
      graphOf(state, kinds({ nodeTypes: [take], chainAnchors: ANCHORS, recordsInUse })).nodes.map(node => node.id)
    expect(takes(chainState())).toEqual(['g1', 'g2', 'g3', 'h1', 'h2', 'v9', 'v16', 'o1'])
    expect(takes(chainState(), [{ id: 'test-uses', uses: () => ['n1'] }])).toEqual(['g1', 'g2', 'g3', 'n1', 'h1', 'h2', 'v9', 'v16', 'o1'])
    const otherPlan = chainState()
    otherPlan.components.proj.records.push(record({ id: 'st2', operation: 'story.approve', params: { plan: 'p2' } }))
    expect(takes(otherPlan)).toEqual(['g1', 'g2', 'g3', 'h1', 'h2', 'v9', 'v16', 'o1'])
    expect(graphOf(chainState(), kinds({ nodeTypes: [take] })).nodes.some(node => node.id === 'n1')).toBe(true)
  })

  it('numbers records by based_on family, else by anchor, slot and lane, and fills each slot frame from the newest take anchored there', () => {
    const state = chainState([takeRecord('n2', { record: 'st1', slot: 2 })])
    const graph = graphOf(state, kinds({ nodeTypes: [planNodeType, take], chainAnchors: ANCHORS, recordsInUse: [{ id: 'test-uses', uses: () => ['n1'] }] }), [], 'en')
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    expect(['h1', 'h2', 'n1', 'n2', 'v9', 'v16', 'o1'].map(id => [byId.get(id)?.chain ?? null, byId.get(id)?.version])).toEqual([
      [{ starter: 'st1', anchor: 'plan:p1', slot: 1 }, 1], [{ starter: 'st1', anchor: 'plan:p1', slot: 1 }, 2],
      [{ starter: 'st0', anchor: 'plan:p1', slot: 2 }, 1], [{ starter: 'st1', anchor: 'plan:p1', slot: 2 }, 2],
      [{ starter: 'ad1', anchor: 'plan:p1', slot: 1, lane: '9:16' }, null], [{ starter: 'ad1', anchor: 'plan:p1', slot: 1, lane: '16:9' }, null],
      [null, null],
    ])
    expect(graph.edges.filter(edge => edge.kind === 'chain').map(edge => `${edge.from}>${edge.to}`).sort())
      .toEqual(['h1', 'h2', 'n1', 'n2', 'v16', 'v9'].map(id => `plan:p1>${id}`))
    expect(slotFrames(graph.nodes, 'plan:p1', 2)).toEqual([{ node: 'v16', preview: 'v16.png' }, { node: 'n2', preview: 'n2.png' }])
  })

  it('lays out six takes in two lanes by anchor, slot (null last), lane in first-record order, then record order', () => {
    const state = fixtureState()
    const laneTake = (id: string, slot: number | null, lane: string): ProjectRecord => takeRecord(id, { record: 'ad1', slot, lane })
    state.components.proj.records.push(
      record({ id: 'ad1', operation: 'ad.approve', params: { plan: 'p1' } }),
      laneTake('m0', null, '9:16'), laneTake('m2', 2, '9:16'), laneTake('m1', 1, '9:16'),
      laneTake('w2', 2, '16:9'), laneTake('w0', null, '16:9'), laneTake('w1', 1, '16:9'),
    )
    const graph = graphOf(state, kinds({ nodeTypes: [take], chainAnchors: [anchorOf('ad.approve')] }))
    const placed = graph.nodes.filter(node => node.id !== 'g2').sort((a, b) => a.x - b.x || a.y - b.y).map(node => node.id)
    expect(placed).toEqual(['g1', 'g3', 'm1', 'w1', 'm2', 'w2', 'm0', 'w0'])
    expect(graph.nodes.map(node => node.id)).toEqual(['g1', 'g2', 'g3', 'm0', 'm2', 'm1', 'w2', 'w0', 'w1'])
  })
})

describe('freePositions', () => {
  it('moves a node whose automatic spot is taken down a row at a time, and leaves stored nodes alone', () => {
    const [template] = graphOf(fixtureState(), kinds({ nodeTypes: [take] })).nodes
    if (template === undefined) throw new Error('fixture has no nodes')
    const at = (id: string, x: number, y: number) => ({ ...template, id, x, y })
    // `moved` is stored half a card to the right of `a`'s automatic spot; `b`'s automatic spot is where `a` moves to.
    const nodes = [at('moved', 0, 0), at('a', 0, 0), at('b', 0, ROW)]
    const placed = freePositions(nodes, { moved: { x: NODE_WIDTH / 2, y: 0 } }, () => 150)
    expect(placed).toEqual({ a: { x: 0, y: ROW }, b: { x: 0, y: 2 * ROW } })
  })
})
