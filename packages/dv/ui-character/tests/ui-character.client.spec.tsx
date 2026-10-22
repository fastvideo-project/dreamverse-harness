// @vitest-environment jsdom
/**
 * The character noun in the browser, mounted beside the real media, composer and History plugins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId, RecordId } from '@dv/project/types'
import type { CharacterId } from '@dv/character/types'
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
import { fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
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
 * The shared fixture plus the character `c1` named 阿明: version 1 by `n1` with `ref.png`, version 2 by `n2` with
 * `shot1-last.png` and `ref.png`.
 * @returns the state.
 */
function nounState(): WireState {
  const state = fixtureState()
  state.components.proj.records = [
    ...state.components.proj.records,
    record({ id: 'n1', operation: 'character.create', params: { character: 'c1', name: '阿明' } }),
    record({ id: 'n2', operation: 'character.update', params: { character: 'c1' } }),
  ]
  const id = 'c1' as CharacterId
  state.components.character = { [id]: [
    { id, version: 1, name: '阿明', description: 'A short description of the character.', references: ['ref.png' as AssetId], created_by: 'n1' as RecordId },
    { id, version: 2, name: '阿明', description: '', references: ['shot1-last.png' as AssetId, 'ref.png' as AssetId], created_by: 'n2' as RecordId },
  ] }
  return state
}

/**
 * Mount `dvCanvas`, the real media, composer and History plugins, and the character plugin under a frame that declares
 * the canvas's card and editor slots.
 */
async function mountCharacter() {
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
  const graph = buildCanvasGraph(state, new Set(), [], 'zh', {
    nodeTypes: canvas.nodeTypes.getSnapshot(), chainAnchors: canvas.chainAnchors.getSnapshot(),
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
 * An operation on the wire with the label that `@dv/character` declares.
 * @param name - the operation name.
 * @param zh - the Chinese label.
 * @param en - the English label.
 * @returns the declaration.
 */
const declared = (name: string, zh: string, en: string): WireOperation => ({
  name, version: '1', description: name, label: { zh, en }, inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'never',
})

describe('the character plugin', () => {
  it('draws character:c1 as a 角色 card titled 阿明 under the picker section 角色, whose editor writes character.update', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountCharacter()
    const state = nounState()
    const node = nodeOf(runtime, state, 'character:c1')
    if (node === undefined) throw new Error('no node character:c1')
    expect([node.type, node.title, node.assets]).toEqual(['character', '阿明', ['shot1-last.png', 'ref.png']])
    const card = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'character' })
    expect([card.view.getByText('角色'), card.view.getByText('+1')]).toHaveLength(2)
    expect(runtime.ctx.dvCanvas.versionKinds.getSnapshot().map(kind => [kind.kind, kind.label(), kind.node('c1')])).toEqual([['character', '角色', 'character:c1']])

    const host = {
      run: vi.fn<EditorHost['run']>(), rerun: vi.fn<EditorHost['rerun']>(), pickAssets: vi.fn<EditorHost['pickAssets']>(), preview: vi.fn<EditorHost['preview']>(),
      openNode: vi.fn<EditorHost['openNode']>(), setPlaced: vi.fn<EditorHost['setPlaced']>(), close: vi.fn<EditorHost['close']>(),
    } satisfies EditorHost
    const { view } = runtime.renderSlot('dv.canvas.editor', { node, state, operations: [], host }, { entryKey: 'character' })
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'character.update', params: { character: 'c1' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }], intent: '在画布上移除 阿明 的一个参考',
    })
    document.documentElement.lang = 'en'
    expect(runtime.ctx.dvCanvas.versionKinds.getSnapshot().map(kind => kind.label())).toEqual(['Character'])
    await runtime.dispose()
  })

  it('lists 阿明 in the @ section 角色 between the kinds of order 0.5 and 1.5, and a pick inserts dv:character/c1', async () => {
    document.documentElement.lang = 'zh-CN'
    vi.stubGlobal('fetch', scriptedFetch({ state: nounState }).fetch)
    publishCurrentProject('p1')
    const { runtime, sources } = await mountCharacter()
    const probe = (order: number): MentionKind => ({
      id: `probe-${String(order)}`, kind: 'probe', order, section: () => `order ${String(order)}`, items: () => [{ uri: `dv:probe/${String(order)}`, label: `probe ${String(order)}` }],
    })
    runtime.ctx.dvMentions.kinds.register(probe(1.5))
    runtime.ctx.dvMentions.kinds.register(probe(0.5))
    const listed = await candidates(sources)
    expect(listed.filter(candidate => candidate.section !== '素材').map(candidate => [candidate.section, candidate.name]))
      .toEqual([['order 0.5', 'probe 0.5'], ['角色', '阿明'], ['order 1.5', 'probe 1.5']])
    const amin = listed.find(candidate => candidate.name === '阿明')
    if (amin === undefined) throw new Error('no candidate 阿明')
    expect(sources[0]?.onPick({ candidate: amin } as never)).toMatchObject({ insert: { ref: '@[阿明](dv:character/c1)', label: '阿明' } })
    await runtime.dispose()
  })

  it('names the History rows 新建角色「阿明」 and 修改角色「阿明」', async () => {
    const { runtime } = await mountCharacter()
    const context = {
      operations: [declared('character.create', '新建角色', 'Create character'), declared('character.update', '修改角色', 'Update character')],
      rows: runtime.ctx.dvHistory.rows.getSnapshot(), records: new Map(),
    }
    const row = (operation: string, params: Record<string, unknown>) => actionLabel(record({ id: 'h', operation, params }), context)
    expect(row('character.create', { character: 'c1', name: '阿明' })).toEqual(['新建角色「阿明」', 'Create character “阿明”'])
    expect(row('character.update', { character: 'c1', name: '阿明' })).toEqual(['修改角色「阿明」', 'Update character “阿明”'])
    expect(row('character.update', { character: 'c1' })).toEqual(['修改角色「c1」', 'Update character “c1”'])
    await runtime.dispose()
  })

  it('removes its node type, version kind, records in use, card, editor, @ kind and History row with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    vi.stubGlobal('fetch', scriptedFetch({ state: nounState }).fetch)
    publishCurrentProject('p1')
    const { runtime, plugin, sources } = await mountCharacter()
    const canvas = runtime.ctx.dvCanvas
    const registered = () => [
      canvas.nodeTypes.getSnapshot().map(type => type.id), canvas.versionKinds.getSnapshot().map(kind => kind.kind),
      canvas.recordsInUse.getSnapshot().map(uses => uses.id), runtime.ctx.dvMentions.kinds.getSnapshot().map(kind => kind.id),
      runtime.ctx.dvHistory.rows.getSnapshot().map(row => row.match),
      runtime.slots.entries('dv.canvas.card').map(entry => entry.options.key), runtime.slots.entries('dv.canvas.editor').map(entry => entry.options.key),
    ]
    expect(registered()).toEqual([['@dv/ui-character'], ['character'], ['@dv/ui-character'], ['@dv/ui-character'], ['character.'], ['character'], ['character']])
    const state = nounState()
    const node = nodeOf(runtime, state, 'character:c1')
    if (node === undefined) throw new Error('no node character:c1')
    const { container } = runtime.renderSlot('dv.canvas.card', { node, assets: assetsOf(state, node), textScale: 1, host: cardHost() }, { entryKey: 'character' })
    expect(container.textContent).toContain('角色')

    await plugin.dispose()
    expect(registered()).toEqual([[], [], [], [], [], [], []])
    expect(container.textContent).toBe('')
    expect(nodeOf(runtime, state, 'character:c1')).toBeUndefined()
    expect((await candidates(sources)).map(candidate => candidate.name)).not.toContain('阿明')
    await runtime.dispose()
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })
})
