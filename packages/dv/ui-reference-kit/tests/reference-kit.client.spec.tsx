// @vitest-environment jsdom
/**
 * `defineReferenceUi` on the test-only reference noun `test_ref`: its canvas node type, version kind, references in use,
 * `@` menu kind and History row, their registration and removal, and the `dv.canvas.editor` entry with its writes and
 * its references drawn through `dv.media` by the asset pool's media views.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Context } from '@deepseek-ai/cordis'
import type { Plugin } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import { defineReferenceUi, ReferenceEditor } from '../src/client/reference-kit.tsx'
import type { ReferenceEditorProps } from '../src/client/reference-kit.tsx'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { DvHistory, HistoryRow } from '@dv/ui-history/contract'
import type {
  ChainAnchor, DvCanvas, DvMentions, EntryEditorHost, MentionKind, NodeEntry, NodeType, TakesInUse, VersionKind,
} from '@dv/ui-kit/registries.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, record, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { ImageView, VideoView } from '../../ui-asset-pool/src/client/media.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'

/** The reference noun `test_ref` with the default editor. */
const testRef = defineReferenceUi({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref,
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 4 },
})

afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
})

/**
 * The fixture with `test_ref` plus a second version of `hero` and the items `alley` without a name, `noir` without
 * references and `ghost` without versions.
 * @returns the state.
 */
function refState(): WireState {
  const state = withTestRef(fixtureState())
  state.components.proj.records = [...state.components.proj.records, record({ id: 'e2', operation: 'test_ref.update' })]
  const hero = state.components.test_ref?.['hero'] ?? []
  state.components.test_ref = {
    hero: [...hero, { id: 'hero', version: 2, name: 'Hero', description: '', references: ['shot1-last.png', 'ref.png'], created_by: 'e2' }],
    alley: [{ id: 'alley', version: 1, name: '', description: 'A wet alley behind the station, lit by one lamp.', references: ['alley.png'], created_by: 'e3' }],
    noir: [{ id: 'noir', version: 1, name: 'Noir', description: '', references: [], created_by: 'e4' }],
    ghost: [],
  }
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

describe('defineReferenceUi descriptors', () => {
  it('draws one entry <key>:<id> per item at its newest version, under the label in the interface language', () => {
    document.documentElement.lang = 'zh-CN'
    const { nodeType } = testRef
    const entries = nodeType.entries(refState())
    expect(entries.map(entry => [entry.id, entry.title, entry.media, entry.record?.id ?? null, entry.records])).toEqual([
      ['test_ref:hero', 'Hero', ['shot1-last.png', 'ref.png'], 'e2', ['e1']],
      ['test_ref:alley', 'alley', ['alley.png'], null, []],
      ['test_ref:noir', 'Noir', [], null, []],
    ])
    expect([nodeType.id, nodeType.type, nodeType.column, nodeType.color, nodeType.label()])
      .toEqual(['@dv/ui-test-ref', 'test_ref', 0, 'var(--dv-kind-character)', '参考'])
    document.documentElement.lang = 'en'
    expect(nodeType.label()).toBe('Reference')
  })

  it('reads the node, the newest versions, and the name and references of each version', () => {
    const state = refState()
    const { versionKind } = testRef
    expect([versionKind.kind, versionKind.node('hero'), versionKind.label()]).toEqual(['test_ref', 'test_ref:hero', 'Reference'])
    expect(versionKind.latest(state)).toEqual([{ id: 'hero', version: 2 }, { id: 'alley', version: 1 }, { id: 'noir', version: 1 }])
    expect([versionKind.name(state, 'hero', 1), versionKind.assets(state, 'hero', 1)]).toEqual(['Hero', ['ref.png']])
    expect([versionKind.name(state, 'hero', 9), versionKind.assets(state, 'ghost', 1)]).toEqual([null, []])
  })

  it('uses the producers of the references of each newest version', () => {
    expect(testRef.referencesInUse).toMatchObject({ id: '@dv/ui-test-ref' })
    expect(testRef.referencesInUse.uses(refState())).toEqual(['g1', 'u1'])
  })

  it('lists each item at its newest version in the @ menu with its name, description start and first reference', () => {
    document.documentElement.lang = 'zh-CN'
    const { mentionKind } = testRef
    expect([mentionKind.id, mentionKind.kind, mentionKind.order, mentionKind.section()]).toEqual(['@dv/ui-test-ref', 'test_ref', 4, '参考'])
    expect(mentionKind.items(refState())).toEqual([
      { uri: 'dv:test_ref/hero', label: 'Hero', description: '', thumb: 'shot1-last.png' },
      { uri: 'dv:test_ref/alley', label: 'alley', description: 'A wet alley behind the station, lit by o', thumb: 'alley.png' },
      { uri: 'dv:test_ref/noir', label: 'Noir', description: '' },
    ])
    document.documentElement.lang = 'en'
    expect(mentionKind.section()).toBe('References')
  })

  it('draws no entry, @ item or version for a state without the slice of the noun', () => {
    const state = fixtureState()
    expect([testRef.nodeType.entries(state), testRef.mentionKind.items(state), testRef.versionKind.latest(state)]).toEqual([[], [], []])
    expect(testRef.versionKind.name(state, 'hero', 1)).toBeNull()
  })

  it('names the item of a <key>. record by its name, else by the ID param of the noun', () => {
    const subject = (params: Record<string, unknown>) =>
      testRef.historyRow.subject(record({ id: 'b', operation: 'test_ref.create', params }))
    expect(testRef.historyRow.match).toBe('test_ref.')
    expect(subject({ test_ref: 'c1', name: '阿明' })).toEqual(['「阿明」', ' “阿明”'])
    expect(subject({ test_ref: 'l1', name: '' })).toEqual(['「l1」', ' “l1”'])
    expect(subject({ test_ref: 7 })).toEqual(['「7」', ' “7”'])
    expect(subject({})).toBeNull()
  })
})

describe('defineReferenceUi apply', () => {
  it('registers the canvas descriptors once dvCanvas is present, and the plugin disposal removes them', async () => {
    const ctx = new Context()
    const canvas = canvasRegistries()
    const fiber = ctx.plugin({ apply: testRef.apply })
    await fiber.await()
    expect(canvas.nodeTypes.list()).toEqual([])
    ctx.provide('dvCanvas', canvas)
    await vi.waitFor(() => { expect(canvas.nodeTypes.list()).toEqual([testRef.nodeType]) })
    expect(canvas.takesInUse.list()).toEqual([testRef.referencesInUse])
    expect(canvas.versionKinds.list()).toEqual([testRef.versionKind])
    await fiber.dispose()
    expect([canvas.nodeTypes.list(), canvas.takesInUse.list(), canvas.versionKinds.list()]).toEqual([[], [], []])
  })

  it('registers the mention kind and the History row once their services are present, and the plugin disposal removes them', async () => {
    const ctx = new Context()
    const mentions: DvMentions = { kinds: createRegistry<MentionKind>(kind => [kind.id]) }
    const history: DvHistory = { rows: createRegistry<HistoryRow>(row => [row.match]) }
    const fiber = ctx.plugin({ apply: testRef.apply })
    await fiber.await()
    ctx.provide('dvMentions', mentions)
    ctx.provide('dvHistory', history)
    await vi.waitFor(() => { expect([mentions.kinds.list(), history.rows.list()]).toEqual([[testRef.mentionKind], [testRef.historyRow]]) })
    await fiber.dispose()
    expect([mentions.kinds.list(), history.rows.list()]).toEqual([[], []])
  })
})

/**
 * @param state - a project state.
 * @param id - the entry ID.
 * @returns the entry that the node type of `test_ref` draws with that ID.
 */
function entryOf(state: WireState, id: string): NodeEntry {
  const found = testRef.nodeType.entries(state).find(entry => entry.id === id)
  if (found === undefined) throw new Error(`no entry ${id}`)
  return found
}

/** The asset pool's image and video views, registered under `dv.media.view` as the asset pool plugin does. */
const mediaViews: Plugin = {
  inject: ['slots'],
  apply(ctx: Context) {
    for (const [key, view] of Object.entries({ image: ImageView, video: VideoView })) {
      ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key }, view)), `test: ${key} view`)
    }
  },
}

/**
 * A runtime that declares `dv.canvas.editor` and holds the `@dv/ui-media` plugin, the media views, and a reference noun.
 * @param noun - the reference noun's plugin body.
 * @returns the runtime and the noun plugin's handle.
 */
async function editorRuntime(noun: (ctx: Context) => void): Promise<{ runtime: SlotTestRuntime; plugin: FeatureHandle }> {
  const runtime = await SlotTestRuntime.create()
  await runtime.declare({ 'dv.canvas.editor': { kind: 'keyed', scope: 'root' } })
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount(mediaViews)
  return { runtime, plugin: await runtime.mount({ apply: noun }) }
}

/** @returns a canvas host whose methods record their calls. */
function hostMock() {
  return { run: vi.fn<EntryEditorHost['run']>(), pickAssets: vi.fn<EntryEditorHost['pickAssets']>(), preview: vi.fn<EntryEditorHost['preview']>() }
}

describe('the editor entry of a reference noun', () => {
  it('shows the newest references and the description, writes <key>.update through the host, and leaves with the plugin', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, plugin } = await editorRuntime(testRef.apply)
    expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(1)
    const state = withTestRef(fixtureState())
    const host = hostMock()
    const slot = runtime.renderSlot('dv.canvas.editor', { node: entryOf(state, 'test_ref:hero'), state, host }, { entryKey: testRef.spec.id })
    const { container, view } = slot

    // The only reference cannot be removed: an update without references keeps the current ones.
    expect(view.getByRole('button', { name: '移除 ref.png' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByText('A tired detective.')).toBeTruthy()
    const opener = view.getByRole('button', { name: '查看 ref.png' })
    // The image view draws the reference image as a card.
    expect(opener.querySelector('img')?.getAttribute('src')).toBe('/dv/assets/ref.png')
    fireEvent.click(opener)
    expect(host.preview).toHaveBeenCalledWith('ref.png', opener)

    // 添加素材 opens the canvas picker with the held references; the picked assets append to them.
    fireEvent.click(view.getByText('＋ 添加素材'))
    expect(host.pickAssets).toHaveBeenCalledWith(['ref.png'], expect.any(Function))
    host.pickAssets.mock.calls[0]?.[1](['ref.png', 'shot1.mp4'])
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'test_ref.update', params: { test_ref: 'hero' },
      inputs: [{ role: 'reference', ref: 'ref.png' }, { role: 'reference', ref: 'shot1.mp4' }], intent: '在画布上给 Hero 添加参考',
    })

    // With two references, either one can be removed.
    state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['ref.png', 'shot1.mp4'], created_by: 'e1' })
    slot.update({ node: entryOf(state, 'test_ref:hero'), state, host }, { entryKey: testRef.spec.id })
    expect(view.queryByText('A tired detective.')).toBeNull()
    // The video view draws the video reference by its first frame.
    expect(view.getByRole('button', { name: '查看 shot1.mp4' }).querySelector('video')?.getAttribute('src')).toBe('/dv/assets/shot1.mp4#t=0.1')
    fireEvent.click(view.getByRole('button', { name: '移除 ref.png' }))
    expect(host.run).toHaveBeenLastCalledWith({
      operation: 'test_ref.update', params: { test_ref: 'hero' }, inputs: [{ role: 'reference', ref: 'shot1.mp4' }],
      intent: '在画布上移除 Hero 的一个参考',
    })

    // An entry of no item of the noun draws nothing.
    slot.update({ node: { id: 'test_ref:gone', record: null, title: 'gone', media: [] }, state, host }, { entryKey: testRef.spec.id })
    expect(container.textContent).toBe('')

    await plugin.dispose()
    expect(runtime.slots.entries('dv.canvas.editor')).toHaveLength(0)
    await runtime.dispose()
  })

  it('draws each reference in a box of the asset\'s aspect ratio, and a square for an asset of unknown dimensions', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await editorRuntime(testRef.apply)
    const state = withTestRef(fixtureState())
    state.assets = state.assets.map(item => item.id === 'ref.png' ? { ...item, width: 1920, height: 1080 } : item)
    state.components.test_ref?.['hero']?.push({ id: 'hero', version: 2, name: 'Hero', description: '', references: ['ref.png', 'shot1.mp4'], created_by: 'e1' })
    const { view } = runtime.renderSlot('dv.canvas.editor', { node: entryOf(state, 'test_ref:hero'), state, host: hostMock() }, { entryKey: testRef.spec.id })
    const box = (name: string): string => {
      const found = view.getByRole('button', { name }).firstElementChild
      return found instanceof HTMLElement ? found.style.aspectRatio : ''
    }
    expect([box('查看 ref.png'), box('查看 shot1.mp4')]).toEqual(['1920 / 1080', '1 / 1'])
    await runtime.dispose()
  })

  it('renders the declared editor body, whose children row writes <key>.update with its params and no inputs', async () => {
    document.documentElement.lang = 'en'
    /**
     * An editor body with one extra row: a button that writes the trait `brave`.
     * @param props - the editor props.
     * @returns the element.
     */
    const TraitsEditor = (props: ReferenceEditorProps): ReactNode => (
      <ReferenceEditor {...props}>
        {entry => <button type="button" onClick={() => { entry.update({ traits: ['brave'] }, `Make ${entry.latest.name} brave`) }}>{`traits of ${entry.id}`}</button>}
      </ReferenceEditor>
    )
    const traits = defineReferenceUi({ ...testRef.spec, editor: TraitsEditor })
    const { runtime } = await editorRuntime(traits.apply)
    const state = withTestRef(fixtureState())
    const host = hostMock()
    const { view } = runtime.renderSlot('dv.canvas.editor', { node: entryOf(state, 'test_ref:hero'), state, host }, { entryKey: traits.spec.id })
    expect(view.getByRole('button', { name: 'View ref.png' })).toBeTruthy()
    fireEvent.click(view.getByText('traits of hero'))
    expect(host.run).toHaveBeenCalledWith({ operation: 'test_ref.update', params: { test_ref: 'hero', traits: ['brave'] }, intent: 'Make Hero brave' })
    await runtime.dispose()
  })

  it('names an unnamed item by its ID, opens no preview of a reference outside the project assets, and skips held picks', async () => {
    document.documentElement.lang = 'en'
    const { runtime } = await editorRuntime(testRef.apply)
    const state = refState()
    const host = hostMock()
    const { container, view } = runtime.renderSlot('dv.canvas.editor', { node: entryOf(state, 'test_ref:alley'), state, host }, { entryKey: testRef.spec.id })

    // `alley.png` is no asset of the project: its button shows no media and opens no preview.
    const opener = view.getByRole('button', { name: 'View alley.png' })
    expect(container.querySelector('img, video, [data-dv-media]')).toBeNull()
    fireEvent.click(opener)
    expect(host.preview).not.toHaveBeenCalled()

    fireEvent.click(view.getByText('+ Add asset'))
    const addPicked = host.pickAssets.mock.calls[0]?.[1]
    addPicked?.(['alley.png'])
    expect(host.run).not.toHaveBeenCalled()
    addPicked?.(['alley.png', 'ref.png'])
    expect(host.run).toHaveBeenCalledWith({
      operation: 'test_ref.update', params: { test_ref: 'alley' },
      inputs: [{ role: 'reference', ref: 'alley.png' }, { role: 'reference', ref: 'ref.png' }], intent: 'Add references to alley from the canvas',
    })
    await runtime.dispose()
  })

  it('draws nothing for an entry whose node ID belongs to another noun', async () => {
    const { runtime } = await editorRuntime(testRef.apply)
    const state = refState()
    const node = { ...entryOf(state, 'test_ref:hero'), id: 'character:hero' }
    const { container } = runtime.renderSlot('dv.canvas.editor', { node, state, host: hostMock() }, { entryKey: testRef.spec.id })
    expect(container.textContent).toBe('')
    await runtime.dispose()
  })
})
