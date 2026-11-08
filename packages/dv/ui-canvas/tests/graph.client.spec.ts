// @vitest-environment jsdom
/** Canvas nodes and edges derived from a project state and the node types that the kind packages register. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { assetNodeType } from '../../ui-asset-pool/src/client/canvas.tsx'
import { asset, canvasNode, fixtureState, OPERATIONS, record, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { referenceDescriptors } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import { apply as shotRenderApply, inject as shotRenderInject } from '../../ui-shot-render/src/client/index.ts'
import type { NodeType, RecordsInUse } from '../src/client/contract/index.ts'
import { boxOf, buildCanvasGraph, previewOf } from '../src/client/graph.ts'
import type { CanvasGraph, CanvasRegistrations } from '../src/client/graph.ts'
import { apply, inject } from '../src/client/index.ts'
import { CLIPS } from './fixtures/conformance-states.client.ts'

const testRef = referenceDescriptors({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref, color: 'var(--dv-node-1)',
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

let runtime: SlotTestRuntime
/** The `shot` node type of `@dv/ui-shot-render`, which only its mounted plugin registers. */
let shot: NodeType

beforeEach(async () => {
  runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.mount({ inject: [...inject], apply })
  await runtime.mount({ inject: [...shotRenderInject], apply: shotRenderApply })
  const registered = runtime.ctx.dvCanvas.nodeTypes.getSnapshot().find(type => type.type === 'shot')
  if (registered === undefined) throw new Error('@dv/ui-shot-render registered no shot type')
  shot = registered
})

afterEach(async () => {
  await runtime.dispose()
})

function allKinds(): CanvasRegistrations {
  return {
    nodeTypes: [testRef.nodeType, assetNodeType, shot],
    recordsInUse: [testRef.referencesInUse, CLIPS], versionKinds: [testRef.versionKind],
  }
}

/**
 * @param state - a project state.
 * @param registrations - the registered descriptors.
 * @param operations - the operation declarations.
 * @returns the canvas graph.
 */
function graphOf(
  state: WireState, registrations: CanvasRegistrations = allKinds(), operations: readonly WireOperation[] = OPERATIONS,
): CanvasGraph {
  return buildCanvasGraph(state, operations, 'zh', registrations)
}

describe('buildCanvasGraph', () => {
  it('draws each node of the node list in creation order with the type of its kind, at its newest version', () => {
    const graph = graphOf(withTestRef(fixtureState()))
    expect(graph.nodes.map(node => [node.id, node.type, node.record.id, node.versions])).toEqual([
      ['e1', 'test_ref', 'e1', ['e1']], ['g1', 'shot', 'g3', ['g1', 'g3']], ['g2', 'shot', 'g2', ['g2']],
    ])
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    expect(byId.get('e1')).toMatchObject({ nodeType: testRef.nodeType, title: 'Hero', assets: ['ref.png'] })
    expect(byId.get('g2')).toMatchObject({ nodeType: shot, title: 'shot.render', assets: ['shot2.mp4', 'shot2-last.png'], meta: '6.0s' })
    expect(byId.get('g1')?.flags).toEqual({ stale: false, rendering: true, failed: false, superseded: false })
    expect(byId.get('g2')?.flags.stale).toBe(true)
    expect(byId.get('g2')?.badges).toEqual(['trim'])
    expect(graph.assetNodes).toMatchObject({
      'ref.png': 'e1', 'shot1.mp4': 'g1', 'shot2.mp4': 'g2', 'export.mp4': 'g2', 'export-last.png': 'g2',
    })
  })

  it('draws edges only from the inputs of each node\'s newest version, none between the versions of a node', () => {
    const graph = graphOf(withTestRef(fixtureState()))
    expect(graph.edges).toEqual([
      { from: 'e1', to: 'g1', role: 'reference' },
      { from: 'e1', to: 'g2', role: 'reference' },
      { from: 'g1', to: 'g2', role: 'first_frame' },
    ])
    expect(graph.links.map(link => [link.source.id, link.target.id])).toEqual([['e1', 'g1'], ['e1', 'g2'], ['g1', 'g2']])
  })

  it('draws a node of a kind without a registered type as a plain card titled by its operation label', () => {
    const operations: WireOperation[] = [...OPERATIONS, {
      name: 'test_ref.create', version: '1', description: '', inputs: {}, params: {}, outputs: [], deterministic: true, resource: 'none',
      label: { zh: '新建参考', en: 'New reference' },
    }]
    const { nodeTypes } = allKinds()
    const withoutRef = { ...allKinds(), nodeTypes: nodeTypes.filter(type => type !== testRef.nodeType) }
    const graph = graphOf(withTestRef(fixtureState()), withoutRef, operations)
    const plain = graph.nodes.find(node => node.id === 'e1')
    expect(plain === undefined ? null : [plain.type, plain.title, boxOf(plain)]).toEqual(['test_ref', '新建参考', { x: 0, y: 0, width: 208, height: 117 }])
    expect(graphOf(fixtureState(), { ...allKinds(), nodeTypes: [] }).nodes.find(node => node.id === 'g2')?.title).toBe('shot.render')
  })

  it('draws no node for a record outside the node list, nor for a node whose newest version is not in the current state', () => {
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'g9', operation: 'shot.render', deterministic: false, params: { prompt: 'alone' } }))
    state.components.canvas.nodes['gone'] = canvasNode('shot', ['undone'])
    state.components.canvas.order.push('gone')
    expect(graphOf(state).nodes.map(node => node.id)).toEqual(['e1', 'g1', 'g2'])
  })

  it('gives a node the outputs of its earlier versions, so an input of an old version\'s output links from it', () => {
    const state = fixtureState()
    state.components.proj.records.push(record({
      id: 'g4', operation: 'shot.render', deterministic: false, params: { prompt: 'after' },
      inputs: [{ role: 'first_frame', ref: { record: 'g1', output: 1 }, resolved_asset: 'shot1-last.png' }],
    }))
    state.components.canvas.nodes['g4'] = canvasNode('shot', ['g4'], 720, 0)
    state.components.canvas.order.push('g4')
    const graph = graphOf(state)
    expect(graph.nodes.find(node => node.id === 'g1')?.assets).toEqual([])
    expect(graph.assetNodes['shot1-last.png']).toBe('g1')
    expect(graph.edges).toContainEqual({ from: 'g1', to: 'g4', role: 'first_frame' })
  })

  it('draws a node whose earlier version is not in the current state at its newest version', () => {
    const state = fixtureState()
    state.components.canvas.nodes['g2'] = canvasNode('shot', ['undone', 'g2'], 480, 200)
    const graph = graphOf(state)
    const g2 = graph.nodes.find(node => node.id === 'g2')
    expect([g2?.record.id, g2?.assets, g2 === undefined ? null : graph.atVersion(g2, 'undone')]).toEqual(['g2', ['shot2.mp4', 'shot2-last.png'], g2])
  })

  it('draws a node at one of its versions with that version\'s entry and flags, and keeps its badges', () => {
    const graph = graphOf(fixtureState())
    const g1 = graph.nodes.find(node => node.id === 'g1')
    if (g1 === undefined) throw new Error('no g1')
    const first = graph.atVersion(g1, 'g1')
    expect([first.id, first.record.id, first.assets, previewOf(first), first.flags.rendering, first.versions])
      .toEqual(['g1', 'g1', ['shot1.mp4', 'shot1-last.png'], 'shot1-last.png', false, ['g1', 'g3']])
    expect([graph.atVersion(g1, 'g3'), graph.atVersion(g1, 'g2')]).toEqual([g1, g1])
    const g2 = graph.nodes.find(node => node.id === 'g2')
    expect(g2 === undefined ? null : graph.atVersion(g2, 'g2').badges).toEqual(['trim'])
  })

  it('links a version input from the node of its item when its kind has a VersionKind, else from the node that shows its asset', () => {
    const state = withTestRef(fixtureState())
    // Version 2 of Hero replaced ref.png with side.png; g1 still reads version 1, and an asset node shows ref.png.
    state.assets.push(asset('side.png', 'image/png', null))
    const versionOne = { role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g3' ? { ...entry, inputs: [versionOne] } : entry)
    state.components.proj.records.push(record({ id: 'e2', operation: 'test_ref.update', based_on: 'e1', params: { test_ref: 'hero' } }))
    state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['side.png'], created_by: 'e2' })
    const canvas = state.components.canvas
    canvas.nodes = { ...canvas.nodes, e1: canvasNode('test_ref', ['e1', 'e2']), u1: canvasNode('asset', ['u1'], 0, 400, { asset: 'ref.png' }) }
    canvas.order.push('u1')
    const graph = graphOf(state)
    expect(graph.nodes.find(node => node.id === 'e1')?.assets).toEqual(['side.png'])
    expect(graph.edges.filter(edge => edge.to === 'g1')).toEqual([{ from: 'e1', to: 'g1', role: 'reference' }])
    expect(graphOf(state, { ...allKinds(), versionKinds: [] }).edges.filter(edge => edge.to === 'g1'))
      .toEqual([{ from: 'u1', to: 'g1', role: 'reference' }])
  })

  it('draws an asset node of a placement with its placed asset as the node of that asset', () => {
    const state = fixtureState()
    state.assets.push(asset('undone.png', 'image/png', 'u9', null, 'asset.import'))
    state.components.proj.records.push(record({ id: 'p1', operation: 'asset.place', inputs: [{ role: 'asset', ref: { asset: 'undone.png' }, resolved_asset: 'undone.png' }] }))
    state.components.canvas.nodes['p1'] = canvasNode('asset', ['p1'], 0, 400, { asset: 'undone.png' })
    state.components.canvas.order.push('p1')
    const graph = graphOf(state)
    expect(graph.nodes.find(node => node.id === 'p1')).toMatchObject({ type: 'asset', title: 'undone.png', assets: ['undone.png'], ref: { kind: 'asset', id: 'undone.png' } })
    expect(graph.assetNodes['undone.png']).toBe('p1')
  })

  it('draws a node whose input resolved to no asset without an input edge', () => {
    const state = fixtureState()
    state.components.proj.records.push(record({
      id: 'g9', operation: 'shot.render', deterministic: false, params: { prompt: 'lost' },
      inputs: [{ role: 'reference', ref: { asset: 'gone.png' }, resolved_asset: null }],
    }))
    state.components.canvas.nodes['g9'] = canvasNode('shot', ['g9'], 720, 0)
    state.components.canvas.order.push('g9')
    const graph = graphOf(state)
    expect(graph.nodes.some(node => node.id === 'g9')).toBe(true)
    expect(graph.edges.filter(edge => edge.to === 'g9')).toEqual([])
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
})

describe('boxOf', () => {
  it('draws a node at its stored box, and at its type\'s default size where the stored size is null', () => {
    const state = fixtureState()
    const g2 = state.components.canvas.nodes['g2']
    if (g2 === undefined) throw new Error('no g2')
    g2.position = { x: 30, y: 40, width: 320, height: null }
    const graph = graphOf(state)
    const [g1, drawn] = ['g1', 'g2'].map(id => graph.nodes.find(node => node.id === id))
    if (g1 === undefined || drawn === undefined) throw new Error('nodes missing')
    expect(boxOf(drawn)).toEqual({ x: 30, y: 40, width: 320, height: drawn.sizing.defaultSize.height })
    expect(boxOf(g1)).toEqual({ x: 480, y: 0, ...g1.sizing.defaultSize })
  })
})
