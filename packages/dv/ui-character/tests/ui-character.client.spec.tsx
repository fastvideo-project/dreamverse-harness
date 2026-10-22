// @vitest-environment jsdom
/**
 * The character noun in the browser: its canvas node type, version kind, `@` menu kind and History row, the
 * registration and removal of every descriptor, and the `dv.canvas.editor` entry with its writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { buildCanvasGraph } from '@dv/ui-canvas/src/client/graph.ts'
import { NodeCard, type CanvasTranslate, type DrawMedia } from '@dv/ui-canvas/src/client/NodeCard.tsx'
import { zh } from '@dv/ui-canvas/src/client/locales.ts'
import type { AssetId, RecordId } from '@dv/project/types'
import type { CharacterId } from '@dv/character/types'
import { projectItems } from '@dv/ui-composer/src/client/mention.ts'
import { actionLabel } from '@dv/ui-history/src/client/rows.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { DvHistory, HistoryRow } from '@dv/ui-history/contract'
import type {
  ChainAnchor, DvCanvas, DvMentions, EntryEditorHost, MentionKind, NodeType, TakesInUse, VersionKind,
} from '@dv/ui-kit/registries.ts'
import type { WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, character } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
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
 * An operation on the wire with the label that `@dv/character` declares.
 * @param name - the operation name.
 * @param zh - the Chinese label.
 * @param en - the English label.
 * @returns the declaration.
 */
const declared = (name: string, zh: string, en: string): WireOperation => ({
  name, version: '1', description: name, label: { zh, en }, inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'never',
})

describe('the character descriptors', () => {
  it('labels the node type and the version kind 角色 / Character, which titles the picker section, and reads every version', () => {
    document.documentElement.lang = 'zh-CN'
    const state = nounState()
    const { nodeType, versionKind } = character
    expect([nodeType.id, nodeType.type, nodeType.column, nodeType.label(), versionKind.kind, versionKind.label()])
      .toEqual(['@dv/ui-character', 'character', 0, '角色', 'character', '角色'])
    expect(nodeType.entries(state).filter(entry => entry.id === 'character:c1').map(entry => [entry.id, entry.title, entry.media, entry.records]))
      .toEqual([['character:c1', '阿明', ['shot1-last.png', 'ref.png'], ['n1']]])
    expect([versionKind.node('c1'), versionKind.name(state, 'c1', 1), versionKind.assets(state, 'c1', 1)]).toEqual(['character:c1', '阿明', ['ref.png']])
    expect(versionKind.latest(state)).toContainEqual({ id: 'c1', version: 2 })
    document.documentElement.lang = 'en'
    expect([nodeType.label(), versionKind.label()]).toEqual(['Character', 'Character'])
    expect(character.referencesInUse.uses(state)).toContain('g1')
  })

  it('lists the newest characters in the @ section 角色 at order 1, and a pick inserts dv:character/<id>', () => {
    document.documentElement.lang = 'zh-CN'
    const { mentionKind } = character
    expect([mentionKind.id, mentionKind.kind, mentionKind.order, mentionKind.section()]).toEqual(['@dv/ui-character', 'character', 1, '角色'])
    const item = projectItems(nounState(), [mentionKind], []).find(entry => entry.uri === 'dv:character/c1')
    expect([item?.label, item?.section, item?.description]).toEqual(['阿明', '角色', ''])
    document.documentElement.lang = 'en'
    expect(mentionKind.section()).toBe('Characters')
  })

  it('names the History rows 新建角色「阿明」 and 修改角色「阿明」', () => {
    const context = {
      operations: [declared('character.create', '新建角色', 'Create character'), declared('character.update', '修改角色', 'Update character')],
      rows: [character.historyRow], records: new Map(),
    }
    expect(character.historyRow.match).toBe('character.')
    const row = (operation: string, params: Record<string, unknown>) => actionLabel(record({ id: 'h', operation, params }), context)
    expect(row('character.create', { character: 'c1', name: '阿明' })).toEqual(['新建角色「阿明」', 'Create character “阿明”'])
    expect(row('character.update', { character: 'c1', name: '阿明' })).toEqual(['修改角色「阿明」', 'Update character “阿明”'])
    expect(row('character.update', { character: 'c1' })).toEqual(['修改角色「c1」', 'Update character “c1”'])
  })

  it('draws the card of character:c1 with the label 角色, the name and the references, as data-node-type character', () => {
    document.documentElement.lang = 'zh-CN'
    const state = nounState()
    const node = buildCanvasGraph(state, undefined, [], 'zh', [], [], [character.nodeType], [character.versionKind]).nodes
      .find(entry => entry.id === 'character:c1')
    if (node === undefined) throw new Error('no node character:c1')
    const t: CanvasTranslate = makeTranslate(zh)
    // The canvas draws each asset through `dv.media`; this drawing names the asset and the purpose that the card asks for.
    const drawMedia: DrawMedia = (assetId, purpose) => <i data-asset={assetId ?? ''} data-purpose={purpose} />
    const { container } = render(
      <NodeCard node={node} x={0} y={0} selected={false} zoom={1} t={t} onPointerDown={() => {}} drawMedia={drawMedia} />,
    )
    const card = container.querySelector('[data-node-type="character"]')
    expect(card?.textContent).toContain('角色')
    expect(card?.textContent).toContain('阿明')
    const media = card?.querySelector('[data-asset]')
    expect([media?.getAttribute('data-asset'), media?.getAttribute('data-purpose')]).toEqual(['shot1-last.png', 'thumb'])
  })
})

describe('ui-character apply', () => {
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
    await vi.waitFor(() => { expect(history.rows.list()).toEqual([character.historyRow]) })
    expect([canvas.nodeTypes.list(), canvas.takesInUse.list(), canvas.versionKinds.list(), mentions.kinds.list()])
      .toEqual([[character.nodeType], [character.referencesInUse], [character.versionKind], [character.mentionKind]])
    await fiber.dispose()
    expect([canvas.nodeTypes.list(), canvas.versionKinds.list(), mentions.kinds.list(), history.rows.list()]).toEqual([[], [], [], []])
  })

  it('renders the editor entry, which writes character.update through the host, and removes it with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } })
    const plugin = await runtime.mount({ apply })
    const state = nounState()
    const node = character.nodeType.entries(state).find(entry => entry.id === 'character:c1')
    if (node === undefined) throw new Error('no entry character:c1')
    const host = { run: vi.fn<EntryEditorHost['run']>(), pickAssets: vi.fn<EntryEditorHost['pickAssets']>(), preview: vi.fn<EntryEditorHost['preview']>() }
    const { view } = runtime.renderSlot('dv.canvas.editor', { node, state, host }, { entryKey: '@dv/ui-character' })
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'character.update', params: { character: 'c1' }, inputs: [{ role: 'reference', ref: 'shot1-last.png' }], intent: '在画布上移除 阿明 的一个参考',
    })
    await plugin.dispose()
    expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(0)
    await runtime.dispose()
  })
})
