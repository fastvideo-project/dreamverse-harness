// @vitest-environment jsdom
/**
 * The location noun in the browser, mounted beside the real media, composer and History plugins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId, RecordId } from '@dv/project/types'
import type { LocationId } from '@dv/location/types'
import type { CardHost, EditorHost, NodeView } from '@dv/ui-canvas/contract'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { MentionKind } from '@dv/ui-kit/registries.ts'
import type { Asset, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { buildCanvasGraph } from '../../ui-canvas/src/client/graph.ts'
import { apply as composerApply, inject as composerInject } from '../../ui-composer/src/client/index.ts'
import type { projectMentionSource } from '../../ui-composer/src/client/mention.ts'
import { apply as historyApply, inject as historyInject } from '../../ui-history/src/client/index.ts'
import { actionLabel } from '../../ui-history/src/client/rows.ts'
import { canvasNode, fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

type MentionSource = ReturnType<typeof projectMentionSource>

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
  document.documentElement.lang = ''
})

/**
 * The shared fixture plus the location `l1` named 小巷: version 1 by `n1` with `ref.png`, version 2 by `n2` with
 * `shot1-last.png` and `ref.png`.
 * @returns the state.
 */
function nounState(): WireState {
  const state = fixtureState()
  state.components.proj.records = [
    ...state.components.proj.records,
    record({ id: 'n1', operation: 'location.create', params: { location: 'l1', name: '小巷' } }),
    record({ id: 'n2', operation: 'location.update', based_on: 'n1', params: { location: 'l1' } }),
  ]
  state.components.canvas.nodes['n1'] = canvasNode('location', ['n1', 'n2'], 0, 400)
  state.components.canvas.order.push('n1')
  const id = 'l1' as LocationId
  state.components.location = { [id]: [
    { id, version: 1, name: '小巷', description: 'A short description of the location.', references: ['ref.png' as AssetId], created_by: 'n1' as RecordId },
    { id, version: 2, name: '小巷', description: '', references: ['shot1-last.png' as AssetId, 'ref.png' as AssetId], created_by: 'n2' as RecordId },
  ] }
  return state
}

/**
 * Mount `dvCanvas`, the real media, composer and History plugins, and the location plugin under a frame that declares
 * the canvas's card and editor slots.
 */
async function mountLocation() {
  const runtime = await SlotTestRuntime.create()
  const sources: MentionSource[] = []
  runtime.ctx.provide('dvCanvas', createDvCanvas())
  runtime.ctx.provide('inputTriggers', {
    registerSource: (source: MentionSource) => {
      sources.push(source)
      return () => { sources.splice(sources.indexOf(source), 1) }
    },
  } as never)
  runtime.ctx.provide('sidebarRight', {} as never)
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.declare({ 'dv.canvas.card': { kind: 'keyed', scope: 'root' }, 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } })
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...composerInject], apply: composerApply })
  await runtime.mount({ inject: [...historyInject], apply: historyApply })
  const plugin = await runtime.mount({ inject: [...inject], apply })
  return { runtime, plugin, sources }
}

function nodeOf(runtime: SlotTestRuntime, state: WireState, id: string): NodeView | undefined {
  const canvas = runtime.ctx.dvCanvas
  const graph = buildCanvasGraph(state, [], 'zh', {
    nodeTypes: canvas.nodeTypes.getSnapshot(),
    recordsInUse: canvas.recordsInUse.getSnapshot(), versionKinds: canvas.versionKinds.getSnapshot(),
  })
  const found = graph.nodes.find(node => node.id === id)
  return found === undefined ? undefined : { ...found, unseen: false, rerunning: false }
}

const assetsOf = (state: WireState, node: NodeView): Record<string, Asset> =>
  Object.fromEntries(state.assets.filter(entry => node.assets.includes(entry.id)).map(entry => [entry.id, entry]))

const cardHost = (): CardHost => ({ run: vi.fn<CardHost['run']>(), rerun: vi.fn<CardHost['rerun']>() })

async function candidates(sources: readonly MentionSource[]) {
  return await sources[0]?.candidates({} as never, { query: '', signal: new AbortController().signal } as never) ?? []
}

/**
 * An operation on the wire with the label that `@dv/location` declares.
 * @param name - the operation name.
 * @param zh - the Chinese label.
 * @param en - the English label.
 * @returns the declaration.
 */
const declared = (name: string, zh: string, en: string): WireOperation => ({
  name, version: '1', description: name, label: { zh, en }, inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none',
})

describe('the location plugin', () => {
  it('draws the node n1 of the item as a 场景 card titled 小巷 under the picker section 场景, whose editor writes location.update', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountLocation()
    const state = nounState()
    const node = nodeOf(runtime, state, 'n1')
    if (node === undefined) throw new Error('no node n1')
    expect([node.type, node.title, node.assets]).toEqual(['location', '小巷', ['shot1-last.png', 'ref.png']])
    const card = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'location' })
    expect([card.view.getByText('场景'), card.view.getByText('2 张参考图 · 第 2 版')]).toHaveLength(2)
    expect(runtime.ctx.dvCanvas.versionKinds.getSnapshot().map(kind => [kind.kind, kind.label(), kind.node(state, 'l1')])).toEqual([['location', '场景', 'n1']])

    const host = {
      run: vi.fn<EditorHost['run']>(), rerun: vi.fn<EditorHost['rerun']>(), pickAssets: vi.fn<EditorHost['pickAssets']>(), preview: vi.fn<EditorHost['preview']>(),
      importFiles: vi.fn<EditorHost['importFiles']>(),
      openNode: vi.fn<EditorHost['openNode']>(), close: vi.fn<EditorHost['close']>(),
    } satisfies EditorHost
    const { view } = runtime.renderSlot('dv.canvas.editor', { node, state, operations: [], host }, { entryKey: 'location' })
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'location.update', params: { location: 'l1' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }], intent: '在画布上移除 小巷 的一个参考',
    })
    document.documentElement.lang = 'en'
    expect(runtime.ctx.dvCanvas.versionKinds.getSnapshot().map(kind => kind.label())).toEqual(['Location'])
    await runtime.dispose()
  })

  it('lists 小巷 in the @ section 场景 between the kinds of order 1.5 and 2.5, and a pick inserts dv:location/l1', async () => {
    document.documentElement.lang = 'zh-CN'
    vi.stubGlobal('fetch', scriptedFetch({ state: nounState }).fetch)
    publishCurrentProject('p1')
    const { runtime, sources } = await mountLocation()
    const probe = (order: number): MentionKind => ({
      id: `probe-${String(order)}`, kind: 'probe', order, section: () => `order ${String(order)}`, items: () => [{ uri: `dv:probe/${String(order)}`, label: `probe ${String(order)}` }],
    })
    runtime.ctx.dvMentions.kinds.register(probe(2.5))
    runtime.ctx.dvMentions.kinds.register(probe(1.5))
    const listed = await candidates(sources)
    expect(listed.filter(candidate => candidate.section !== '素材').map(candidate => [candidate.section, candidate.name]))
      .toEqual([['order 1.5', 'probe 1.5'], ['场景', '小巷'], ['order 2.5', 'probe 2.5']])
    const amin = listed.find(candidate => candidate.name === '小巷')
    if (amin === undefined) throw new Error('no candidate 小巷')
    expect(sources[0]?.onPick({ candidate: amin } as never)).toMatchObject({ insert: { ref: '@[小巷](dv:location/l1)', label: '小巷' } })
    await runtime.dispose()
  })

  it('names the History rows 新建场景「小巷」 and 修改场景「小巷」', async () => {
    const { runtime } = await mountLocation()
    const context = {
      operations: [declared('location.create', '新建场景', 'Create location'), declared('location.update', '修改场景', 'Update location')],
      rows: runtime.ctx.dvHistory.rows.getSnapshot(), records: new Map(), state: null,
    }
    const row = (operation: string, params: Record<string, unknown>) => actionLabel(record({ id: 'h', operation, params }), context)
    expect(row('location.create', { location: 'l1', name: '小巷' })).toEqual(['新建场景「小巷」', 'Create location “小巷”'])
    expect(row('location.update', { location: 'l1', name: '小巷' })).toEqual(['修改场景「小巷」', 'Update location “小巷”'])
    expect(row('location.update', { location: 'l1' })).toEqual(['修改场景「l1」', 'Update location “l1”'])
    await runtime.dispose()
  })

  it('removes its node type, version kind, records in use, card, editor, @ kind and History row with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    vi.stubGlobal('fetch', scriptedFetch({ state: nounState }).fetch)
    publishCurrentProject('p1')
    const { runtime, plugin, sources } = await mountLocation()
    const canvas = runtime.ctx.dvCanvas
    const registered = () => [
      canvas.nodeTypes.getSnapshot().map(type => type.id), canvas.versionKinds.getSnapshot().map(kind => kind.kind),
      canvas.recordsInUse.getSnapshot().map(uses => uses.id), runtime.ctx.dvMentions.kinds.getSnapshot().map(kind => kind.id),
      runtime.ctx.dvHistory.rows.getSnapshot().map(row => row.match),
      runtime.slots.entries('dv.canvas.card').map(entry => entry.options.key), runtime.slots.entries('dv.canvas.editor').map(entry => entry.options.key),
    ]
    expect(registered()).toEqual([['@dv/ui-location'], ['location'], ['@dv/ui-location'], ['@dv/ui-location'], ['location.'], ['location'], ['location']])
    const state = nounState()
    const node = nodeOf(runtime, state, 'n1')
    if (node === undefined) throw new Error('no node n1')
    const { container } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'location' })
    expect(container.textContent).toContain('场景')

    await plugin.dispose()
    expect(registered()).toEqual([[], [], [], [], [], [], []])
    expect(container.textContent).toBe('')
    // Without its type, the node draws as a plain card titled by its operation.
    expect(nodeOf(runtime, state, 'n1')?.title).toBe('location.update')
    expect((await candidates(sources)).map(candidate => candidate.name)).not.toContain('小巷')
    await runtime.dispose()
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })
})
