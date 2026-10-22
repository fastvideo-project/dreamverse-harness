// @vitest-environment jsdom
/**
 * The location noun in the browser: its canvas node type, version kind, `@` menu kind and History row, the registration
 * and removal of every descriptor, and the `dv.canvas.editor` entry with its writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId, RecordId } from '@dv/project/types'
import type { LocationId } from '@dv/location/types'
import { projectItems } from '@dv/ui-composer/src/client/mention.ts'
import { actionLabel } from '@dv/ui-history/src/client/rows.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { DvHistory, HistoryRow } from '@dv/ui-history/contract'
import type {
  ChainAnchor, DvCanvas, DvMentions, EntryEditorHost, MentionKind, NodeType, TakesInUse, VersionKind,
} from '@dv/ui-kit/registries.ts'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, location } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
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
    record({ id: 'n2', operation: 'location.update', params: { location: 'l1' } }),
  ]
  const id = 'l1' as LocationId
  state.components.location = { [id]: [
    { id, version: 1, name: '小巷', description: 'A short description of the location.', references: ['ref.png' as AssetId], created_by: 'n1' as RecordId },
    { id, version: 2, name: '小巷', description: '', references: ['shot1-last.png' as AssetId, 'ref.png' as AssetId], created_by: 'n2' as RecordId },
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
 * An operation on the wire with the label that `@dv/location` declares.
 * @param name - the operation name.
 * @param zh - the Chinese label.
 * @param en - the English label.
 * @returns the declaration.
 */
const declared = (name: string, zh: string, en: string): WireOperation => ({
  name, version: '1', description: name, label: { zh, en }, inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'never',
})

describe('the location descriptors', () => {
  it('labels the node type and the version kind 场景 / Location, which titles the picker section, and reads every version', () => {
    document.documentElement.lang = 'zh-CN'
    const state = nounState()
    const { nodeType, versionKind } = location
    expect([nodeType.id, nodeType.type, nodeType.column, nodeType.label(), versionKind.kind, versionKind.label()])
      .toEqual(['@dv/ui-location', 'location', 0, '场景', 'location', '场景'])
    expect(nodeType.entries(state).filter(entry => entry.id === 'location:l1').map(entry => [entry.id, entry.title, entry.media, entry.records]))
      .toEqual([['location:l1', '小巷', ['shot1-last.png', 'ref.png'], ['n1']]])
    expect([versionKind.node('l1'), versionKind.name(state, 'l1', 1), versionKind.assets(state, 'l1', 1)]).toEqual(['location:l1', '小巷', ['ref.png']])
    expect(versionKind.latest(state)).toContainEqual({ id: 'l1', version: 2 })
    document.documentElement.lang = 'en'
    expect([nodeType.label(), versionKind.label()]).toEqual(['Location', 'Location'])
    expect(location.referencesInUse.uses(state)).toContain('g1')
  })

  it('lists the newest locations in the @ section 场景 at order 2, and a pick inserts dv:location/<id>', () => {
    document.documentElement.lang = 'zh-CN'
    const { mentionKind } = location
    expect([mentionKind.id, mentionKind.kind, mentionKind.order, mentionKind.section()]).toEqual(['@dv/ui-location', 'location', 2, '场景'])
    const item = projectItems(nounState(), [mentionKind], []).find(entry => entry.uri === 'dv:location/l1')
    expect([item?.label, item?.section, item?.description]).toEqual(['小巷', '场景', ''])
    document.documentElement.lang = 'en'
    expect(mentionKind.section()).toBe('Locations')
  })

  it('names the History rows 新建场景「小巷」 and 修改场景「小巷」', () => {
    const context = {
      operations: [declared('location.create', '新建场景', 'Create location'), declared('location.update', '修改场景', 'Update location')],
      rows: [location.historyRow], records: new Map(),
    }
    expect(location.historyRow.match).toBe('location.')
    const row = (operation: string, params: Record<string, unknown>) => actionLabel(record({ id: 'h', operation, params }), context)
    expect(row('location.create', { location: 'l1', name: '小巷' })).toEqual(['新建场景「小巷」', 'Create location “小巷”'])
    expect(row('location.update', { location: 'l1', name: '小巷' })).toEqual(['修改场景「小巷」', 'Update location “小巷”'])
    expect(row('location.update', { location: 'l1' })).toEqual(['修改场景「l1」', 'Update location “l1”'])
  })
})

describe('ui-location apply', () => {
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
    await vi.waitFor(() => { expect(history.rows.list()).toEqual([location.historyRow]) })
    expect([canvas.nodeTypes.list(), canvas.takesInUse.list(), canvas.versionKinds.list(), mentions.kinds.list()])
      .toEqual([[location.nodeType], [location.referencesInUse], [location.versionKind], [location.mentionKind]])
    await fiber.dispose()
    expect([canvas.nodeTypes.list(), canvas.versionKinds.list(), mentions.kinds.list(), history.rows.list()]).toEqual([[], [], [], []])
  })

  it('renders the editor entry, which writes location.update through the host, and removes it with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } })
    const plugin = await runtime.mount({ apply })
    const state = nounState()
    const node = location.nodeType.entries(state).find(entry => entry.id === 'location:l1')
    if (node === undefined) throw new Error('no entry location:l1')
    const host = { run: vi.fn<EntryEditorHost['run']>(), pickAssets: vi.fn<EntryEditorHost['pickAssets']>(), preview: vi.fn<EntryEditorHost['preview']>() }
    const { view } = runtime.renderSlot('dv.canvas.editor', { node, state, host }, { entryKey: '@dv/ui-location' })
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'location.update', params: { location: 'l1' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }], intent: '在画布上移除 小巷 的一个参考',
    })
    await plugin.dispose()
    expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(0)
    await runtime.dispose()
  })
})
