// @vitest-environment jsdom
/**
 * The style noun in the browser: its canvas node type, version kind, `@` menu kind and History row, the registration
 * and removal of every descriptor, and the `dv.canvas.editor` entry with its writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId, RecordId } from '@dv/project/types'
import type { StyleId } from '@dv/style/types'
import { projectItems } from '@dv/ui-composer/src/client/mention.ts'
import { actionLabel } from '@dv/ui-history/src/client/rows.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { DvHistory, HistoryRow } from '@dv/ui-history/contract'
import type {
  ChainAnchor, DvCanvas, DvMentions, EntryEditorHost, MentionKind, NodeType, TakesInUse, VersionKind,
} from '@dv/ui-kit/registries.ts'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, style } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
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
    record({ id: 'n2', operation: 'style.update', params: { style: 's1' } }),
  ]
  const id = 's1' as StyleId
  state.components.style = { [id]: [
    { id, version: 1, name: '胶片', description: 'A short description of the style.', references: ['ref.png' as AssetId], created_by: 'n1' as RecordId },
    { id, version: 2, name: '胶片', description: '', references: ['shot1-last.png' as AssetId, 'ref.png' as AssetId], created_by: 'n2' as RecordId },
  ] }
  return state
}

/** @returns empty canvas registries keyed as `DvCanvas` documents. */
function canvasRegistries(): DvCanvas {
  return {
    nodeTypes: createRegistry<NodeType>(type => [type.id]),
    chainAnchors: createRegistry<ChainAnchor>(anchor => [anchor.starter]),
    takesInUse: createRegistry<TakesInUse>(uses => [uses.id]),
    versionKinds: createRegistry<VersionKind>(kind => [kind.kind]),
  }
}

/**
 * An operation on the wire with the label that `@dv/style` declares.
 * @param name - the operation name.
 * @param zh - the Chinese label.
 * @param en - the English label.
 * @returns the declaration.
 */
const declared = (name: string, zh: string, en: string): WireOperation => ({
  name, version: '1', description: name, label: { zh, en }, inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'never',
})

describe('the style descriptors', () => {
  it('labels the node type and the version kind 风格 / Style, which titles the picker section, and reads every version', () => {
    document.documentElement.lang = 'zh-CN'
    const state = nounState()
    const { nodeType, versionKind } = style
    expect([nodeType.id, nodeType.type, nodeType.column, nodeType.label(), versionKind.kind, versionKind.label()])
      .toEqual(['@dv/ui-style', 'style', 0, '风格', 'style', '风格'])
    expect(nodeType.entries(state).filter(entry => entry.id === 'style:s1').map(entry => [entry.id, entry.title, entry.media, entry.records]))
      .toEqual([['style:s1', '胶片', ['shot1-last.png', 'ref.png'], ['n1']]])
    expect([versionKind.node('s1'), versionKind.name(state, 's1', 1), versionKind.assets(state, 's1', 1)]).toEqual(['style:s1', '胶片', ['ref.png']])
    expect(versionKind.latest(state)).toContainEqual({ id: 's1', version: 2 })
    document.documentElement.lang = 'en'
    expect([nodeType.label(), versionKind.label()]).toEqual(['Style', 'Style'])
    expect(style.referencesInUse.uses(state)).toContain('g1')
  })

  it('lists the newest styles in the @ section 风格 at order 3, and a pick inserts dv:style/<id>', () => {
    document.documentElement.lang = 'zh-CN'
    const { mentionKind } = style
    expect([mentionKind.id, mentionKind.kind, mentionKind.order, mentionKind.section()]).toEqual(['@dv/ui-style', 'style', 3, '风格'])
    const item = projectItems(nounState(), [mentionKind], []).find(entry => entry.uri === 'dv:style/s1')
    expect([item?.label, item?.section, item?.description]).toEqual(['胶片', '风格', ''])
    document.documentElement.lang = 'en'
    expect(mentionKind.section()).toBe('Styles')
  })

  it('names the History rows 新建风格「胶片」 and 修改风格「胶片」', () => {
    const context = {
      operations: [declared('style.create', '新建风格', 'Create style'), declared('style.update', '修改风格', 'Update style')],
      rows: [style.historyRow], records: new Map(),
    }
    expect(style.historyRow.match).toBe('style.')
    const row = (operation: string, params: Record<string, unknown>) => actionLabel(record({ id: 'h', operation, params }), context)
    expect(row('style.create', { style: 's1', name: '胶片' })).toEqual(['新建风格「胶片」', 'Create style “胶片”'])
    expect(row('style.update', { style: 's1', name: '胶片' })).toEqual(['修改风格「胶片」', 'Update style “胶片”'])
    expect(row('style.update', { style: 's1' })).toEqual(['修改风格「s1」', 'Update style “s1”'])
  })
})

describe('ui-style apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers every descriptor once its service is present, and the plugin disposal removes them', async () => {
    const ctx = new Context()
    const canvas = canvasRegistries()
    const mentions: DvMentions = { kinds: createRegistry<MentionKind>(kind => [kind.id]) }
    const history: DvHistory = { rows: createRegistry<HistoryRow>(row => [row.match]) }
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    ctx.provide('dvCanvas', canvas)
    ctx.provide('dvMentions', mentions)
    ctx.provide('dvHistory', history)
    await vi.waitFor(() => { expect(history.rows.list()).toEqual([style.historyRow]) })
    expect([canvas.nodeTypes.list(), canvas.takesInUse.list(), canvas.versionKinds.list(), mentions.kinds.list()])
      .toEqual([[style.nodeType], [style.referencesInUse], [style.versionKind], [style.mentionKind]])
    await fiber.dispose()
    expect([canvas.nodeTypes.list(), canvas.versionKinds.list(), mentions.kinds.list(), history.rows.list()]).toEqual([[], [], [], []])
  })

  it('renders the editor entry, which writes style.update through the host, and removes it with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } })
    const plugin = await runtime.mount({ apply })
    const state = nounState()
    const node = style.nodeType.entries(state).find(entry => entry.id === 'style:s1')
    if (node === undefined) throw new Error('no entry style:s1')
    const host = { run: vi.fn<EntryEditorHost['run']>(), pickAssets: vi.fn<EntryEditorHost['pickAssets']>(), preview: vi.fn<EntryEditorHost['preview']>() }
    const { view } = runtime.renderSlot('dv.canvas.editor', { node, state, host }, { entryKey: '@dv/ui-style' })
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'style.update', params: { style: 's1' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }], intent: '在画布上移除 胶片 的一个参考',
    })
    await plugin.dispose()
    expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(0)
    await runtime.dispose()
  })
})
