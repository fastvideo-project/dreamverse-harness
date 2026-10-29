// @vitest-environment jsdom
/** Canvas nodes and edges derived from a project state and the node types that the kind packages register. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import { assetNodeType } from '../../ui-asset-pool/src/client/canvas.tsx'
import { asset, fixtureState, OPERATIONS, record, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { referenceDescriptors } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import { apply as shotRenderApply, inject as shotRenderInject } from '../../ui-shot-render/src/client/index.ts'
import type { ChainAnchor, NodeEntry, NodeType, RecordsInUse } from '../src/client/contract/index.ts'
import { buildCanvasGraph, freePositions, NODE_WIDTH, previewOf, ROW, slotFrames } from '../src/client/graph.ts'
import type { CanvasGraph, CanvasRegistrations } from '../src/client/graph.ts'
import { apply, inject } from '../src/client/index.ts'
import { CLIPS } from './fixtures/conformance-states.client.ts'

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
    nodeTypes: [testRef.nodeType, assetNodeType, take], chainAnchors: [],
    recordsInUse: [testRef.referencesInUse, CLIPS], versionKinds: [testRef.versionKind],
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

const anchorOf = (starter: string): ChainAnchor => ({ starter, anchor: start => `board:${String(start.params['board'])}` })

function sliceType(entries: ReadonlyArray<Omit<NodeEntry, 'bodyHeight'>>, column = 0): NodeType {
  return {
    id: '@dv/ui-test-slice', type: 'slice', label: () => 'slice', color: '', column,
    entries: () => entries.map(entry => ({ ...entry, bodyHeight: 30 })),
  }
}

describe('buildCanvasGraph', () => {
  it('draws the reference item and the takes with their input, first-frame and lineage edges, flags, badges and versions', () => {
    const graph = graphOf(withTestRef(fixtureState()), allKinds())
    expect(graph.nodes.map(node => [node.id, node.type])).toEqual([
      ['test_ref:hero', 'test_ref'], ['g1', 'take'], ['g2', 'take'], ['g3', 'take'],
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
      ...allKinds(), nodeTypes: nodeTypes.filter(type => type !== testRef.nodeType),
      recordsInUse: recordsInUse.filter(uses => uses !== CLIPS),
    })
    expect(graph.nodes.some(node => node.id === 'test_ref:hero')).toBe(false)
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
    const graph = graphOf(state, kinds({ nodeTypes: [prop, assetNodeType, take] }), placed)
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    expect(byId.get('prop:m1')).toMatchObject({ nodeType: prop, claimed: false, title: 'Red umbrella', assets: ['umbrella.png'], record: m1 })
    expect(byId.has('u2')).toBe(false)
    expect(graph.assetNodes['umbrella.png']).toBe('prop:m1')
    expect(graph.edges).toContainEqual({ from: 'prop:m1', to: 'g4', kind: 'input', role: 'reference' })
    expect(graph.edges.some(edge => edge.to === 'prop:m1')).toBe(false)
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
      record({ id: 'w0', operation: 'w.start', params: { board: 'b1' } }),
      record({ id: 'i1', operation: 'image.generate', deterministic: false, outputs: ['cat.png'] }),
      record({ id: 'i2', operation: 'image.generate', deterministic: false, based_on: 'i1', started_by: { record: 'w1', slot: 2 }, outputs: ['cat2.png'] }),
    )
    state.assets.push(asset('cat.png', 'image/png', 'i1'), asset('cat2.png', 'image/png', 'i2'))
    Object.assign(state.components.proj.created_by, { 'cat.png': 'i1', 'cat2.png': 'i2' })
    const graph = graphOf(state, kinds({ nodeTypes: [assetNodeType, image], chainAnchors: [anchorOf('w.start')] }), ['cat.png'])
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
      record({ id: 'n0', params: { board: 'b1' } }),
      record({
        id: 'g9', operation: 'shot.render', deterministic: false, params: { prompt: 'free' }, started_by: { record: 'n0', slot: 1 },
      }),
    )
    const graph = graphOf(state, kinds({ nodeTypes: [take], chainAnchors: [anchorOf('a.start')] }))
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

describe('chain grouping', () => {
  const takeRecord = (id: string, startedBy: ProjectRecord['started_by'], basedOn: string | null = null): ProjectRecord => record({
    id, operation: 'shot.render', deterministic: false, based_on: basedOn, outputs: [`${id}.png`],
    ...startedBy === undefined ? {} : { started_by: startedBy },
  })

  /**
   * The shared fixture plus the takes of two `a.start` starters, one `b.start` starter and one unloaded starter on board b1.
   * @param extra - more takes, placed right after h2.
   * @returns the state.
   */
  function chainState(extra: ProjectRecord[] = []): WireState {
    const state = fixtureState()
    const added = [
      record({ id: 'st0', operation: 'a.start', params: { board: 'b1' } }), takeRecord('n1', { record: 'st0', slot: 2 }),
      record({ id: 'st1', operation: 'a.start', params: { board: 'b1' } }), takeRecord('h1', { record: 'st1', slot: 1 }), takeRecord('h2', undefined, 'h1'),
      ...extra,
      record({ id: 'ad1', operation: 'b.start', params: { board: 'b1' } }),
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
  const ANCHORS = [anchorOf('a.start'), anchorOf('b.start')]

  it('draws the chain of the newest starter of each operation on each node, every free take, and the records a RecordsInUse uses', () => {
    const takes = (state: WireState, recordsInUse: RecordsInUse[] = []): string[] =>
      graphOf(state, kinds({ nodeTypes: [take], chainAnchors: ANCHORS, recordsInUse })).nodes.map(node => node.id)
    expect(takes(chainState())).toEqual(['g1', 'g2', 'g3', 'h1', 'h2', 'v9', 'v16', 'o1'])
    expect(takes(chainState(), [{ id: 'test-uses', uses: () => ['n1'] }])).toEqual(['g1', 'g2', 'g3', 'n1', 'h1', 'h2', 'v9', 'v16', 'o1'])
    const otherBoard = chainState()
    otherBoard.components.proj.records.push(record({ id: 'st2', operation: 'a.start', params: { board: 'b2' } }))
    expect(takes(otherBoard)).toEqual(['g1', 'g2', 'g3', 'h1', 'h2', 'v9', 'v16', 'o1'])
    expect(graphOf(chainState(), kinds({ nodeTypes: [take] })).nodes.some(node => node.id === 'n1')).toBe(true)
  })

  it('numbers records by based_on family, else by anchor, slot and lane, and fills each slot frame from the newest take anchored there', () => {
    const state = chainState([takeRecord('n2', { record: 'st1', slot: 2 })])
    const graph = graphOf(state, kinds({ nodeTypes: [sliceType([{ id: 'board:b1', title: 'b1', record: null, assets: [], slots: 2 }]), take], chainAnchors: ANCHORS, recordsInUse: [{ id: 'test-uses', uses: () => ['n1'] }] }), [], 'en')
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    expect(['h1', 'h2', 'n1', 'n2', 'v9', 'v16', 'o1'].map(id => [byId.get(id)?.chain ?? null, byId.get(id)?.version])).toEqual([
      [{ starter: 'st1', anchor: 'board:b1', slot: 1 }, 1], [{ starter: 'st1', anchor: 'board:b1', slot: 1 }, 2],
      [{ starter: 'st0', anchor: 'board:b1', slot: 2 }, 1], [{ starter: 'st1', anchor: 'board:b1', slot: 2 }, 2],
      [{ starter: 'ad1', anchor: 'board:b1', slot: 1, lane: '9:16' }, null], [{ starter: 'ad1', anchor: 'board:b1', slot: 1, lane: '16:9' }, null],
      [null, null],
    ])
    expect(graph.edges.filter(edge => edge.kind === 'chain').map(edge => `${edge.from}>${edge.to}`).sort())
      .toEqual(['h1', 'h2', 'n1', 'n2', 'v16', 'v9'].map(id => `board:b1>${id}`))
    expect(slotFrames(graph.nodes, 'board:b1', 2)).toEqual([{ node: 'v16', preview: 'v16.png' }, { node: 'n2', preview: 'n2.png' }])
  })

  it('lays out six takes in two lanes by anchor, slot (null last), lane in first-record order, then record order', () => {
    const state = fixtureState()
    const laneTake = (id: string, slot: number | null, lane: string): ProjectRecord => takeRecord(id, { record: 'ad1', slot, lane })
    state.components.proj.records.push(
      record({ id: 'ad1', operation: 'b.start', params: { board: 'b1' } }),
      laneTake('m0', null, '9:16'), laneTake('m2', 2, '9:16'), laneTake('m1', 1, '9:16'),
      laneTake('w2', 2, '16:9'), laneTake('w0', null, '16:9'), laneTake('w1', 1, '16:9'),
    )
    const graph = graphOf(state, kinds({ nodeTypes: [take], chainAnchors: [anchorOf('b.start')] }))
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
