// @vitest-environment jsdom
/**
 * `defineReferenceUi` on the test-only reference noun `test_ref`: the descriptors that `referenceDescriptors` builds,
 * the registrations of the plugin and their removal, and its `dv.canvas.card` and `dv.canvas.editor` entries drawn on
 * nodes of the canvas graph, whose media come from the real `@dv/ui-media` and `@dv/ui-asset-pool` plugins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import type { CardHost, EditorHost, NodeView } from '@dv/ui-canvas/contract'
import type { HistoryRow } from '@dv/ui-history/contract'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { MentionKind } from '@dv/ui-kit/registries.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { buildCanvasGraph } from '../../ui-canvas/src/client/graph.ts'
import { apply as historyApply, inject as historyInject } from '../../ui-history/src/client/index.ts'
import { asset, canvasNode, fixtureState, record, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { defineReferenceUi, referenceDescriptors } from '../src/client/reference-kit.tsx'
import type { ReferenceUiSpec } from '../src/client/reference-kit.tsx'

const SPEC = {
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref, color: 'var(--dv-node-1)',
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 4 },
} satisfies ReferenceUiSpec
const testRef = defineReferenceUi(SPEC)
const descriptors = referenceDescriptors(SPEC)

afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
})

/**
 * The fixture with `test_ref` plus a second version of `hero` by `e2`, the items `alley` without a name by `e3` and
 * `noir` without references by `e4`, each the node of its create record, and `ghost` without versions.
 * @returns the state.
 */
function refState(): WireState {
  const state = withTestRef(fixtureState())
  state.components.proj.records = [
    ...state.components.proj.records, record({ id: 'e2', operation: 'test_ref.update', based_on: 'e1', params: { test_ref: 'hero' } }),
    record({ id: 'e3', operation: 'test_ref.create', params: { test_ref: 'alley', name: '' } }),
    record({ id: 'e4', operation: 'test_ref.create', params: { test_ref: 'noir', name: 'Noir' } }),
  ]
  const canvas = state.components.canvas
  canvas.nodes = { ...canvas.nodes, e1: canvasNode('test_ref', ['e1', 'e2']), e3: canvasNode('test_ref', ['e3']), e4: canvasNode('test_ref', ['e4']) }
  canvas.order.push('e3', 'e4')
  const hero = state.components.test_ref?.['hero'] ?? []
  state.components.test_ref = {
    hero: [...hero, { id: 'hero', version: 2, name: 'Hero', description: '', references: ['shot1-last.png', 'ref.png'], created_by: 'e2' }],
    alley: [{ id: 'alley', version: 1, name: '', description: 'A wet alley behind the station, lit by one lamp.', references: ['alley.png'], created_by: 'e3' }],
    noir: [{ id: 'noir', version: 1, name: 'Noir', description: '', references: [], created_by: 'e4' }],
    ghost: [],
  }
  return state
}

function heroWith(references: string[]): WireState {
  const state = withTestRef(fixtureState())
  const hero = state.components.test_ref?.['hero']?.[0]
  if (hero === undefined) throw new Error('no hero')
  hero.references = references
  return state
}

/**
 * The entry of one node of a state at its newest version.
 * @param state - the state.
 * @param id - the node ID.
 * @returns the entry.
 */
function entryOf(state: WireState, id: string) {
  const node = state.components.canvas.nodes[id]
  const version = state.components.proj.records.find(each => each.id === node?.versions.at(-1))
  if (node === undefined || version === undefined) throw new Error(`no node ${id}`)
  return descriptors.nodeType.entry({ id, node, record: { ...version, operation: version.operation ?? '' }, state, operations: [], language: 'zh' })
}

describe('referenceDescriptors', () => {
  it('draws the node of a <key>.create record as the item its params name at its newest version, under the label in the interface language', () => {
    document.documentElement.lang = 'zh-CN'
    const state = refState()
    const facts = ['e1', 'e3', 'e4'].map((id) => {
      const entry = entryOf(state, id)
      return [entry.title, entry.assets, entry.ref]
    })
    expect(facts).toEqual([
      ['Hero', ['shot1-last.png', 'ref.png'], { kind: 'test_ref', id: 'hero' }],
      ['alley', ['alley.png'], { kind: 'test_ref', id: 'alley' }],
      ['Noir', [], { kind: 'test_ref', id: 'noir' }],
    ])
    const { nodeType } = descriptors
    expect([nodeType.id, nodeType.type, nodeType.color, nodeType.label()]).toEqual(['@dv/ui-test-ref', 'test_ref', 'var(--dv-node-1)', '参考'])
    document.documentElement.lang = 'en'
    expect(nodeType.label()).toBe('Reference')
  })

  it('reads the node of an item\'s newest version, the newest versions, and the name and references of each version', () => {
    const state = refState()
    const { versionKind } = descriptors
    expect([versionKind.kind, versionKind.node(state, 'hero'), versionKind.node(state, 'ghost'), versionKind.label()]).toEqual(['test_ref', 'e1', null, 'Reference'])
    expect(versionKind.latest(state)).toEqual([{ id: 'hero', version: 2 }, { id: 'alley', version: 1 }, { id: 'noir', version: 1 }])
    expect([versionKind.name(state, 'hero', 1), versionKind.assets(state, 'hero', 1)]).toEqual(['Hero', ['ref.png']])
    expect([versionKind.name(state, 'hero', 9), versionKind.assets(state, 'ghost', 1)]).toEqual([null, []])
  })

  it('uses the producers of the references of each newest version', () => {
    expect(descriptors.referencesInUse.id).toBe('@dv/ui-test-ref')
    expect(descriptors.referencesInUse.uses(refState())).toEqual(['g1', 'u1'])
  })

  it('lists each item at its newest version in the @ menu with its name, description start and first reference', () => {
    document.documentElement.lang = 'zh-CN'
    const { mentionKind } = descriptors
    expect([mentionKind.id, mentionKind.kind, mentionKind.order, mentionKind.section()]).toEqual(['@dv/ui-test-ref', 'test_ref', 4, '参考'])
    expect(mentionKind.items(refState())).toEqual([
      { uri: 'dv:test_ref/hero', label: 'Hero', description: '', thumb: 'shot1-last.png' },
      { uri: 'dv:test_ref/alley', label: 'alley', description: 'A wet alley behind the station, lit by o', thumb: 'alley.png' },
      { uri: 'dv:test_ref/noir', label: 'Noir', description: '' },
    ])
    document.documentElement.lang = 'en'
    expect(mentionKind.section()).toBe('References')
  })

  it('titles a node by the name its record gives while the state has no version of the item, and lists no @ item or version', () => {
    const state = withTestRef(fixtureState())
    state.components.test_ref = {}
    const { mentionKind, versionKind } = descriptors
    const entry = entryOf(state, 'e1')
    expect([entry.title, entry.assets, mentionKind.items(state), versionKind.latest(state)]).toEqual(['Hero', [], [], []])
    expect(versionKind.name(state, 'hero', 1)).toBeNull()
  })

  it('names the item of a <key>. record by its name, else by the ID param of the noun', () => {
    const subject = (params: Record<string, unknown>) =>
      descriptors.historyRow.subject(record({ id: 'b', operation: 'test_ref.create', params }))
    expect(descriptors.historyRow.match).toBe('test_ref.')
    expect(subject({ test_ref: 'c1', name: '阿明' })).toEqual(['「阿明」', ' “阿明”'])
    expect(subject({ test_ref: 'l1', name: '' })).toEqual(['「l1」', ' “l1”'])
    expect(subject({ test_ref: 7 })).toEqual(['「7」', ' “7”'])
    expect(subject({})).toBeNull()
  })
})

async function mountKit(): Promise<{ runtime: SlotTestRuntime; plugin: FeatureHandle }> {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('dvCanvas', createDvCanvas())
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.declare({ 'dv.canvas.card': { kind: 'keyed', scope: 'root' }, 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } })
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  const plugin = await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
  return { runtime, plugin }
}

function nodeOf(runtime: SlotTestRuntime, state: WireState, id: string): NodeView {
  const canvas = runtime.ctx.dvCanvas
  const graph = buildCanvasGraph(state, [], 'zh', {
    nodeTypes: canvas.nodeTypes.getSnapshot(),
    recordsInUse: canvas.recordsInUse.getSnapshot(), versionKinds: canvas.versionKinds.getSnapshot(),
  })
  const found = graph.nodes.find(node => node.id === id)
  if (found === undefined) throw new Error(`no node ${id}`)
  return { ...found, unseen: false, rerunning: false }
}

const assetsOf = (state: WireState, node: NodeView): Record<string, Asset> =>
  Object.fromEntries(state.assets.filter(entry => node.assets.includes(entry.id)).map(entry => [entry.id, entry]))

const cardHost = (): CardHost => ({ run: vi.fn<CardHost['run']>(), rerun: vi.fn<CardHost['rerun']>() })

function hostMock() {
  return {
    run: vi.fn<EditorHost['run']>(), rerun: vi.fn<EditorHost['rerun']>(), pickAssets: vi.fn<EditorHost['pickAssets']>(), preview: vi.fn<EditorHost['preview']>(),
    importFiles: vi.fn<EditorHost['importFiles']>(),
    openNode: vi.fn<EditorHost['openNode']>(), close: vi.fn<EditorHost['close']>(),
  } satisfies EditorHost
}

describe('the plugin of a reference noun', () => {
  it('registers its descriptors and entries while their services and slots exist, and its disposal removes them and its drawn card', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, plugin } = await mountKit()
    runtime.ctx.provide('dvMentions', { kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) })
    await runtime.mount({ inject: [...historyInject], apply: historyApply })
    const canvas = runtime.ctx.dvCanvas
    const registered = () => [
      canvas.nodeTypes.getSnapshot().map(type => type.type), canvas.versionKinds.getSnapshot().map(kind => kind.kind),
      canvas.recordsInUse.getSnapshot().map(uses => uses.id), runtime.ctx.dvMentions.kinds.getSnapshot().map(kind => kind.id),
      runtime.ctx.dvHistory.rows.getSnapshot().map(row => row.match),
      runtime.slots.entries('dv.canvas.card').map(entry => entry.options.key), runtime.slots.entries('dv.canvas.editor').map(entry => entry.options.key),
    ]
    await vi.waitFor(() => {
      expect(registered()).toEqual([
        ['asset', 'test_ref'], ['test_ref'], ['@dv/ui-test-ref'], ['@dv/ui-test-ref'], ['test_ref.'], ['asset', 'test_ref'], ['asset', 'test_ref'],
      ])
    })
    const state = withTestRef(fixtureState())
    const node = nodeOf(runtime, state, 'e1')
    const { container } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'test_ref' })
    expect(container.textContent).toContain('参考')

    await plugin.dispose()
    expect(registered()).toEqual([['asset'], [], [], [], [], ['asset'], ['asset']])
    expect([container.textContent, container.querySelector('img')]).toEqual(['', null])
    await runtime.dispose()
  })

  it('registers no @ menu kind for a noun whose node type the canvas refuses', async () => {
    const { runtime } = await mountKit()
    runtime.ctx.provide('dvMentions', { kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) })
    await vi.waitFor(() => { expect(runtime.ctx.dvMentions.kinds.getSnapshot().map(kind => kind.id)).toEqual(['@dv/ui-test-ref']) })
    // A noun of another package with the key test_ref, which the mounted noun already holds.
    const rival = defineReferenceUi({ ...SPEC, id: '@dv/ui-test-rival' })
    await runtime.mount({ inject: [...rival.inject], apply: rival.apply })
    expect(runtime.ctx.dvMentions.kinds.getSnapshot().map(kind => kind.id)).toEqual(['@dv/ui-test-ref'])
    await runtime.dispose()
  })

  it('registers its History row while @dv/ui-canvas is not loaded', async () => {
    const runtime = await SlotTestRuntime.create()
    const rows = createRegistry<HistoryRow>(row => [row.match], row => row.match)
    runtime.ctx.provide('dvHistory', { rows })
    await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
    expect(rows.getSnapshot().map(row => row.match)).toEqual(['test_ref.'])
    await runtime.dispose()
  })

  it('draws a noun card as its first reference at 4:3 under its label, and three thumbnails and a count of the rest', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountKit()
    const references = ['ref.png', 'r2.png', 'r3.png', 'r4.png', 'r5.png', 'r6.png']
    const state = heroWith(references)
    state.assets.push(...references.slice(1).map(id => asset(id, 'image/png', 'u1')))
    const node = nodeOf(runtime, state, 'e1')
    const { container, view } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'test_ref' })
    // 4:3 of the width above the 52-unit row; the picture box takes that height itself.
    expect(node.sizing).toEqual({ kind: 'window', defaultSize: { width: 208, height: 208 }, minSize: { width: 104, height: 130 } })
    expect((container.firstElementChild?.firstElementChild as HTMLElement).style.height).toBe('')
    expect([...container.querySelectorAll('img')].map(image => image.getAttribute('src')))
      .toEqual(['ref.png', 'ref.png', 'r2.png', 'r3.png'].map(assetUrl))
    expect([view.getByText('参考'), view.getByText('+3')]).toHaveLength(2)
    expect((container.firstElementChild as HTMLElement).style.background).toBe(CARD_SURFACE.background)
    await runtime.dispose()
  })

  it('draws a noun card of an item without references as its label over an empty picture, with no thumbnail row', async () => {
    document.documentElement.lang = 'en'
    const { runtime } = await mountKit()
    const state = heroWith([])
    const node = nodeOf(runtime, state, 'e1')
    const { container } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'test_ref' })
    expect(node.sizing).toEqual({ kind: 'window', defaultSize: { width: 208, height: 156 }, minSize: { width: 104, height: 78 } })
    expect(container.querySelector('img, video, [data-dv-media]')).toBeNull()
    expect(container.textContent).toBe('Reference')
    await runtime.dispose()
  })

  it('draws a noun card of one reference without a thumbnail row, and a video reference as its first frame', async () => {
    document.documentElement.lang = 'en'
    const { runtime } = await mountKit()
    const single = heroWith(['ref.png'])
    const one = nodeOf(runtime, single, 'e1')
    const card = runtime.renderSlot('dv.canvas.card', { node: one, assets: assetsOf(single, one), textScale: 1, host: cardHost() }, { entryKey: 'test_ref' })
    expect([one.sizing?.defaultSize.height, card.container.querySelectorAll('img').length]).toEqual([156, 1])
    const state = heroWith(['shot1.mp4', 'ref.png'])
    const node = nodeOf(runtime, state, 'e1')
    const { container } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'test_ref' })
    expect(container.querySelector('video')?.getAttribute('src')).toBe(`${assetUrl('shot1.mp4')}#t=0.1`)
    await runtime.dispose()
  })

  it('draws no picture for a reference whose asset the state lacks', async () => {
    document.documentElement.lang = 'en'
    const { runtime } = await mountKit()
    const state = heroWith(['ref.png', 'gone.png'])
    const node = nodeOf(runtime, state, 'e1')
    const { container } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'test_ref' })
    expect([...container.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(['ref.png', 'ref.png'].map(assetUrl))
    await runtime.dispose()
  })
})

describe('the editor of a reference noun', () => {
  it('shows the newest references and the description, writes <key>.update through the host, and leaves with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, plugin } = await mountKit()
    const state = withTestRef(fixtureState())
    const host = hostMock()
    const slot = runtime.renderSlot('dv.canvas.editor', { node: nodeOf(runtime, state, 'e1'), state, operations: [], host }, { entryKey: 'test_ref' })
    const { container, view } = slot

    expect(view.getByRole('button', { name: '移除 ref.png' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByText('A tired detective.')).toBeTruthy()
    const opener = view.getByRole('button', { name: '查看 ref.png' })
    expect(opener.querySelector('img')?.getAttribute('src')).toBe(assetUrl('ref.png'))
    fireEvent.click(opener)
    expect(host.preview).toHaveBeenCalledWith('ref.png', opener)

    fireEvent.click(view.getByText('＋ 添加素材'))
    expect(host.pickAssets).toHaveBeenCalledWith(['ref.png'], { versions: false }, expect.any(Function))
    host.pickAssets.mock.calls[0]?.[2](['ref.png', 'shot1.mp4'])
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'test_ref.update', params: { test_ref: 'hero' },
      inputs: [{ role: 'reference', ref: 'ref.png' }, { role: 'reference', ref: 'shot1.mp4' }], intent: '在画布上给 Hero 添加参考',
    })

    state.components.proj.records.push(record({ id: 'e2', operation: 'test_ref.update', based_on: 'e1', params: { test_ref: 'hero' } }))
    state.components.canvas.nodes['e1'] = canvasNode('test_ref', ['e1', 'e2'])
    state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['ref.png', 'shot1.mp4'], created_by: 'e2' })
    slot.update({ node: nodeOf(runtime, state, 'e1'), state, operations: [], host }, { entryKey: 'test_ref' })
    expect(view.queryByText('A tired detective.')).toBeNull()
    expect(view.getByRole('button', { name: '查看 shot1.mp4' }).querySelector('video')?.getAttribute('src')).toBe(`${assetUrl('shot1.mp4')}#t=0.1`)
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'test_ref.update', params: { test_ref: 'hero' }, inputs: [{ role: 'reference', ref: 'shot1.mp4' }],
      intent: '在画布上移除 Hero 的一个参考',
    })

    const shown = nodeOf(runtime, state, 'e1')
    slot.update({ node: { ...shown, record: { ...shown.record, params: { test_ref: 'gone' } } }, state, operations: [], host }, { entryKey: 'test_ref' })
    expect(container.textContent).toBe('')

    slot.update({ node: nodeOf(runtime, state, 'e1'), state, operations: [], host }, { entryKey: 'test_ref' })
    await plugin.dispose()
    expect(runtime.slots.entries('dv.canvas.editor').map(entry => entry.options.key)).toEqual(['asset'])
    expect(container.textContent).toBe('')
    await runtime.dispose()
  })

  it('draws each reference in a box of the asset\'s aspect ratio, and a square for an asset of unknown dimensions', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountKit()
    const state = withTestRef(fixtureState())
    state.assets = state.assets.map(item => item.id === 'ref.png' ? { ...item, width: 1920, height: 1080 } : item)
    const hero = state.components.test_ref?.['hero']?.[0]
    if (hero !== undefined) hero.references = ['ref.png', 'shot1.mp4']
    const { view } = runtime.renderSlot('dv.canvas.editor', { node: nodeOf(runtime, state, 'e1'), state, operations: [], host: hostMock() }, { entryKey: 'test_ref' })
    const box = (name: string): string => {
      const found = view.getByRole('button', { name }).firstElementChild
      return found instanceof HTMLElement ? found.style.aspectRatio : ''
    }
    expect([box('查看 ref.png'), box('查看 shot1.mp4')]).toEqual(['1920 / 1080', '1 / 1'])
    await runtime.dispose()
  })

  it('names an unnamed item by its ID, opens no preview of a reference outside the project assets, and skips held picks', async () => {
    document.documentElement.lang = 'en'
    const { runtime } = await mountKit()
    const state = refState()
    const host = hostMock()
    const { container, view } = runtime.renderSlot('dv.canvas.editor', { node: nodeOf(runtime, state, 'e3'), state, operations: [], host }, { entryKey: 'test_ref' })

    const opener = view.getByRole('button', { name: 'View alley.png' })
    expect(container.querySelector('img, video')).toBeNull()
    fireEvent.click(opener)
    expect(host.preview).not.toHaveBeenCalled()

    fireEvent.click(view.getByText('+ Add asset'))
    const addPicked = host.pickAssets.mock.calls[0]?.[2]
    addPicked?.(['alley.png'])
    expect(host.run).not.toHaveBeenCalled()
    addPicked?.(['alley.png', 'ref.png'])
    expect(host.run).toHaveBeenCalledWith({
      operation: 'test_ref.update', params: { test_ref: 'alley' },
      inputs: [{ role: 'reference', ref: 'alley.png' }, { role: 'reference', ref: 'ref.png' }], intent: 'Add references to alley from the canvas',
    })
    await runtime.dispose()
  })

  it('draws nothing for a node whose record names no item of the noun', async () => {
    const { runtime } = await mountKit()
    const state = refState()
    const shown = nodeOf(runtime, state, 'e1')
    const node = { ...shown, record: { ...shown.record, params: { character: 'hero' } } }
    const { container } = runtime.renderSlot('dv.canvas.editor', { node, state, operations: [], host: hostMock() }, { entryKey: 'test_ref' })
    expect(container.textContent).toBe('')
    await runtime.dispose()
  })
})
