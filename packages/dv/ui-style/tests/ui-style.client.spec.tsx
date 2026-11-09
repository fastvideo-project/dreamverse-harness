// @vitest-environment jsdom
/**
 * The style noun in the browser, mounted beside the real media, composer and History plugins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId, RecordId } from '@dv/project/types'
import type { StyleId } from '@dv/style/types'
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
 * The shared fixture plus the style `s1` named 胶片: version 1 by `n1` with `ref.png`, version 2 by `n2` with
 * `shot1-last.png` and `ref.png`.
 * @returns the state.
 */
function nounState(): WireState {
  const state = fixtureState()
  state.components.proj.records = [
    ...state.components.proj.records,
    record({ id: 'n1', operation: 'style.create', params: { style: 's1', name: '胶片' } }),
    record({ id: 'n2', operation: 'style.update', based_on: 'n1', params: { style: 's1' } }),
  ]
  state.components.canvas.nodes['n1'] = canvasNode('style', ['n1', 'n2'], 0, 400)
  state.components.canvas.order.push('n1')
  const id = 's1' as StyleId
  state.components.style = { [id]: [
    { id, version: 1, name: '胶片', description: 'A short description of the style.', references: ['ref.png' as AssetId], created_by: 'n1' as RecordId },
    { id, version: 2, name: '胶片', description: '', references: ['shot1-last.png' as AssetId, 'ref.png' as AssetId], created_by: 'n2' as RecordId },
  ] }
  return state
}

/**
 * Mount `dvCanvas`, the real media, composer and History plugins, and the style plugin under a frame that declares
 * the canvas's card and editor slots.
 */
async function mountStyle() {
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
 * An operation on the wire with the label that `@dv/style` declares.
 * @param name - the operation name.
 * @param zh - the Chinese label.
 * @param en - the English label.
 * @returns the declaration.
 */
const declared = (name: string, zh: string, en: string): WireOperation => ({
  name, version: '1', description: name, label: { zh, en }, inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none',
})

describe('the style plugin', () => {
  it('draws the node n1 of the item as a 风格 card titled 胶片 under the picker section 风格, whose editor writes style.update', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountStyle()
    const state = nounState()
    const node = nodeOf(runtime, state, 'n1')
    if (node === undefined) throw new Error('no node n1')
    expect([node.type, node.title, node.assets]).toEqual(['style', '胶片', ['shot1-last.png', 'ref.png']])
    const card = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'style' })
    expect([card.view.getByText('风格'), card.view.getByText('2 张参考图 · 第 2 版')]).toHaveLength(2)
    expect(runtime.ctx.dvCanvas.versionKinds.getSnapshot().map(kind => [kind.kind, kind.label(), kind.node(state, 's1')])).toEqual([['style', '风格', 'n1']])

    const host = {
      run: vi.fn<EditorHost['run']>(), rerun: vi.fn<EditorHost['rerun']>(), pickAssets: vi.fn<EditorHost['pickAssets']>(), preview: vi.fn<EditorHost['preview']>(),
      importFiles: vi.fn<EditorHost['importFiles']>(),
      openNode: vi.fn<EditorHost['openNode']>(), close: vi.fn<EditorHost['close']>(),
    } satisfies EditorHost
    const { view } = runtime.renderSlot('dv.canvas.editor', { node, state, operations: [], host }, { entryKey: 'style' })
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'style.update', params: { style: 's1' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }], intent: '在画布上移除 胶片 的一个参考',
    })
    document.documentElement.lang = 'en'
    expect(runtime.ctx.dvCanvas.versionKinds.getSnapshot().map(kind => kind.label())).toEqual(['Style'])
    await runtime.dispose()
  })

  it('lists 胶片 in the @ section 风格 between the kinds of order 2.5 and 3.5, and a pick inserts dv:style/s1', async () => {
    document.documentElement.lang = 'zh-CN'
    vi.stubGlobal('fetch', scriptedFetch({ state: nounState }).fetch)
    publishCurrentProject('p1')
    const { runtime, sources } = await mountStyle()
    const probe = (order: number): MentionKind => ({
      id: `probe-${String(order)}`, kind: 'probe', order, section: () => `order ${String(order)}`, items: () => [{ uri: `dv:probe/${String(order)}`, label: `probe ${String(order)}` }],
    })
    runtime.ctx.dvMentions.kinds.register(probe(3.5))
    runtime.ctx.dvMentions.kinds.register(probe(2.5))
    const listed = await candidates(sources)
    expect(listed.filter(candidate => candidate.section !== '素材').map(candidate => [candidate.section, candidate.name]))
      .toEqual([['order 2.5', 'probe 2.5'], ['风格', '胶片'], ['order 3.5', 'probe 3.5']])
    const amin = listed.find(candidate => candidate.name === '胶片')
    if (amin === undefined) throw new Error('no candidate 胶片')
    expect(sources[0]?.onPick({ candidate: amin } as never)).toMatchObject({ insert: { ref: '@[胶片](dv:style/s1)', label: '胶片' } })
    await runtime.dispose()
  })

  it('names the History rows 新建风格「胶片」 and 修改风格「胶片」', async () => {
    const { runtime } = await mountStyle()
    const context = {
      operations: [declared('style.create', '新建风格', 'Create style'), declared('style.update', '修改风格', 'Update style')],
      rows: runtime.ctx.dvHistory.rows.getSnapshot(), records: new Map(), state: null,
    }
    const row = (operation: string, params: Record<string, unknown>) => actionLabel(record({ id: 'h', operation, params }), context)
    expect(row('style.create', { style: 's1', name: '胶片' })).toEqual(['新建风格「胶片」', 'Create style “胶片”'])
    expect(row('style.update', { style: 's1', name: '胶片' })).toEqual(['修改风格「胶片」', 'Update style “胶片”'])
    expect(row('style.update', { style: 's1' })).toEqual(['修改风格「s1」', 'Update style “s1”'])
    await runtime.dispose()
  })

  it('removes its node type, version kind, records in use, card, editor, @ kind and History row with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    vi.stubGlobal('fetch', scriptedFetch({ state: nounState }).fetch)
    publishCurrentProject('p1')
    const { runtime, plugin, sources } = await mountStyle()
    const canvas = runtime.ctx.dvCanvas
    const registered = () => [
      canvas.nodeTypes.getSnapshot().map(type => type.id), canvas.versionKinds.getSnapshot().map(kind => kind.kind),
      canvas.recordsInUse.getSnapshot().map(uses => uses.id), runtime.ctx.dvMentions.kinds.getSnapshot().map(kind => kind.id),
      runtime.ctx.dvHistory.rows.getSnapshot().map(row => row.match),
      runtime.slots.entries('dv.canvas.card').map(entry => entry.options.key), runtime.slots.entries('dv.canvas.editor').map(entry => entry.options.key),
    ]
    expect(registered()).toEqual([['@dv/ui-style'], ['style'], ['@dv/ui-style'], ['@dv/ui-style'], ['style.'], ['style'], ['style']])
    const state = nounState()
    const node = nodeOf(runtime, state, 'n1')
    if (node === undefined) throw new Error('no node n1')
    const { container } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'style' })
    expect(container.textContent).toContain('风格')

    await plugin.dispose()
    expect(registered()).toEqual([[], [], [], [], [], [], []])
    expect(container.textContent).toBe('')
    // Without its type, the node draws as a plain card titled by its operation.
    expect(nodeOf(runtime, state, 'n1')?.title).toBe('style.update')
    expect((await candidates(sources)).map(candidate => candidate.name)).not.toContain('胶片')
    await runtime.dispose()
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })
})
