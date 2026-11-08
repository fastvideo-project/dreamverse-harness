// @vitest-environment jsdom
/**
 * `defineGenerationUi` mounted as a plugin: the claimed node type, the card body, the 重试 action, and the removal of
 * every registration when the plugin unloads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { HistoryRow } from '@dv/ui-history/contract'
import { CARD_SURFACE, mediaSizing, WIDE_RATIO } from '@dv/ui-kit/frame.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { NodeType } from '../../ui-canvas/src/client/contract/index.ts'
import { asset, fixtureState, OPERATIONS, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { defineGenerationUi } from '../src/client/generation-kit.tsx'
import { claimedOf, CLIP_EXTEND, mountKit, nodesOf, recordingHost, testTake } from './take-kind.client.ts'

const LABELLED = [{ ...OPERATIONS[0]!, label: { zh: '渲染镜头', en: 'Render shot' } }, CLIP_EXTEND]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

/**
 * The fixture state plus a `clip.extend` take.
 * @returns the state.
 */
function extendedState(): FixtureState {
  const state = fixtureState()
  state.components.proj.records.push(
    record({ id: 'x1', operation: 'clip.extend', deterministic: false, outputs: ['x1.png', 'x1.mp4'] }),
  )
  state.assets.push(asset('x1.png', 'image/png', 'x1'), asset('x1.mp4', 'video/mp4', 'x1', 2.5))
  Object.assign(state.components.proj.created_by, { 'x1.png': 'x1', 'x1.mp4': 'x1' })
  return state
}

describe('the claimed node type of a generation kind', () => {
  it('titles a take by its operation\'s wire label, else by the operation name, and its number in its based_on family', async () => {
    const { runtime, canvas } = await mountKit({})
    const titles = (operations = LABELLED, language: 'zh' | 'en' = 'zh') => {
      const nodes = nodesOf(canvas, extendedState(), operations, language)
      return Object.fromEntries(['g1', 'g2', 'x1'].map(id => [id, nodes.get(id)?.title]))
    }
    expect(titles()).toEqual({
      // g3 is a rerun of g1, so the two are takes 1 and 2 of one group.
      g1: '渲染镜头 · 第 1 次', g2: '渲染镜头', x1: 'clip.extend',
    })
    expect(titles(LABELLED, 'en')).toMatchObject({ g1: 'Render shot · take 1', g2: 'Render shot' })
    expect(titles([], 'en')).toMatchObject({ g2: 'shot.render', x1: 'clip.extend' })
    await runtime.dispose()
  })

  it('shows the duration of the first timed output as meta, the still the spec picks as preview, and the media sizing of the shown asset', async () => {
    const { runtime, canvas } = await mountKit({})
    const state = extendedState()
    state.assets = state.assets.map(entry => entry.id === 'shot1-last.png' ? { ...entry, width: 768, height: 1024 } : entry)
    const nodes = nodesOf(canvas, state, LABELLED, 'en')
    const facts = (id: string) => {
      const node = nodes.get(id)
      return [node?.meta, node?.preview, node?.sizing]
    }
    const wide = { kind: 'media', defaultSize: { width: 208, height: 117 }, minSize: { width: 104, height: 59 }, aspectRatio: { ratio: 16 / 9, fixedHeight: 0 } }
    // A 3:4 preview gets the 208 × 277 frame at 3:4; a shown asset of unknown size and a take without outputs the 16:9 frame.
    expect(facts('g1')).toEqual(['4.0s', 'shot1-last.png', { ...wide, defaultSize: { width: 208, height: 277 }, minSize: { width: 104, height: 139 }, aspectRatio: { ratio: 3 / 4, fixedHeight: 0 } }])
    expect(facts('x1')).toEqual(['2.5s', 'x1.png', wide])
    expect(facts('g3')).toEqual([undefined, undefined, wide])
    await runtime.dispose()
  })

  it('gives the canvas chrome the type label and the status words in the interface language', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, canvas } = await mountKit({})
    const type = canvas.nodeTypes.getSnapshot().find(entry => entry.type === 'test_take')
    expect([type?.label(), type?.column, type?.claimed?.status.running(), type?.claimed?.status.failed()]).toEqual(['测试版本', 2, '生成中…', '没生成'])
    document.documentElement.lang = 'en'
    expect([type?.label(), type?.claimed?.status.running(), type?.claimed?.status.failed()]).toEqual(['Test take', 'Generating…', 'Not generated'])
    await runtime.dispose()
  })
})

describe('a second generation kind', () => {
  const still = defineGenerationUi({
    id: '@dv/ui-test-still', type: 'test_still', operations: ['image.generate'], label: ['静帧', 'Still'], color: '',
    status: { running: ['生成中…', 'Generating…'], failed: ['没生成', 'Not generated'], done: ['已生成', 'Generated'] },
  })
  const IMAGE = { ...OPERATIONS[0]!, name: 'image.generate' }

  it('composes the references of every take', async () => {
    document.documentElement.lang = 'zh-CN'
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const { runtime, canvas } = await mountKit({ 'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' } })
    await runtime.mount({ inject: [...still.inject], apply: still.apply })
    const state = fixtureState()
    state.components.proj.records.push(record({
      id: 'i1', operation: 'image.generate', deterministic: false, params: { task: 't2v', model: 'qwen-image', prompt: 'a cat' },
      inputs: [{ role: 'reference', ref: { asset: 'ref.png' }, resolved_asset: 'ref.png' }],
    }))
    const node = claimedOf(canvas, state, [IMAGE], 'zh').get('i1')!
    expect(node.type).toBe('test_still')
    const editor = runtime.renderSlot('dv.canvas.editor.claimed', { node, state, operations: [IMAGE], host: recordingHost() }, { entryKey: 'test_still' })
    await waitFor(() => { expect(editor.container.querySelector('[data-reference-tile="ref.png"]')?.textContent).toContain('ref.png') })
    await runtime.dispose()
  })
})

describe('the parameter bar of a generation kind', () => {
  it('gives the take editor the words of its spec: the bar\'s send and placeholder, and the running words while a send runs', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    document.documentElement.lang = 'en'
    const kind = defineGenerationUi({
      id: '@dv/ui-test-render', type: 'test_render', operations: ['shot.render'], label: ['测试', 'Test'], color: 'var(--dv-node-3)',
      status: { running: ['测试渲染中…', 'Test rendering…'], failed: ['失败', 'Failed'], done: ['好了', 'Done'] },
      bar: { copy: { send: ['测试渲染', 'Test render'], placeholder: ['描述测试', 'Describe the test'] } },
    })
    const { runtime, canvas } = await mountKit({ 'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' } }, kind)
    const state = fixtureState()
    const node = claimedOf(canvas, state, OPERATIONS, 'en').get('g1')!
    const host = recordingHost(() => new Promise<void>(() => {}))
    const editor = runtime.renderSlot('dv.canvas.editor.claimed', { node, state, operations: OPERATIONS, host }, { entryKey: 'test_render' })
    const send = await waitFor(() => {
      const button = editor.view.getByRole<HTMLButtonElement>('button', { name: 'Test render' })
      if (button.disabled) throw new Error('the call is not checked yet')
      return button
    })
    expect(editor.container.querySelector('[data-composer-input]')?.getAttribute('data-placeholder')).toBe('Describe the test')
    fireEvent.click(send)
    await waitFor(() => { expect(editor.view.getByRole('button', { name: 'Test rendering…' })).toBeTruthy() })
    await runtime.dispose()
  })
})

describe('the card body of a take', () => {
  it('draws the preview the spec picks, else the first output, and an empty frame for a take without outputs', async () => {
    const { runtime, canvas } = await mountKit({ 'dv.canvas.card': { kind: 'keyed', scope: 'root' } })
    const state = fixtureState()
    state.assets = state.assets.map(entry => entry.id === 'shot1-last.png' ? { ...entry, width: 1920, height: 1080 } : entry)
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g2' ? { ...entry, outputs: ['shot2.mp4'] } : entry)
    const nodes = nodesOf(canvas, state, OPERATIONS, 'en')
    const assets = Object.fromEntries(state.assets.map(entry => [entry.id, entry]))
    const owner = (id: string) => ({ node: nodes.get(id)!, assets, textScale: 1, host: recordingHost() })
    const card = runtime.renderSlot('dv.canvas.card', owner('g1'), { entryKey: 'test_take' })
    const media = () => [card.container.querySelector('img')?.getAttribute('src'), card.container.querySelector('video')?.getAttribute('src')]
    // A picture of known size fills the frame bare; an asset of unknown size and an empty take sit on the card surface.
    const fill = () => (card.container.firstElementChild as HTMLElement).style.background
    expect([media(), fill()]).toEqual([['/dv/assets/shot1-last.png', undefined], ''])
    card.update(owner('g2'))
    expect([media(), fill()]).toEqual([[undefined, '/dv/assets/shot2.mp4#t=0.1'], CARD_SURFACE.background])
    card.update(owner('g3'))
    expect([media(), fill()]).toEqual([[undefined, undefined], CARD_SURFACE.background])
    await runtime.dispose()
  })

  it('sizes a take of unknown aspect at the ratio the kind declares, and draws its body filling the frame', async () => {
    const { runtime, canvas } = await mountKit({ 'dv.canvas.card': { kind: 'keyed', scope: 'root' } })
    const low = defineGenerationUi({
      id: '@dv/ui-test-low', type: 'test_low', operations: ['audio.generate'], label: ['矮', 'Low'], color: '', fallbackRatio: 26 / 9,
      status: { running: ['生成中…', 'Generating…'], failed: ['没生成', 'Not generated'], done: ['已生成', 'Generated'] },
    })
    await runtime.mount({ inject: [...low.inject], apply: low.apply })
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'a9', operation: 'audio.generate', deterministic: false, outputs: [] }))
    const node = nodesOf(canvas, state, OPERATIONS, 'en').get('a9')
    if (node === undefined) throw new Error('no node a9')
    const card = runtime.renderSlot('dv.canvas.card', { node, assets: {}, textScale: 1, host: recordingHost() }, { entryKey: 'test_low' })
    const frame = card.container.firstElementChild
    expect([node.sizing?.defaultSize, node.sizing?.kind === 'media' ? node.sizing.aspectRatio.ratio : null, frame instanceof HTMLElement ? frame.style.height : null])
      .toEqual([{ width: 208, height: 72 }, 26 / 9, '100%'])
    await runtime.dispose()
  })
})

describe('the 重试 action of a generation kind', () => {
  const IMAGE: NodeType = {
    id: '@dv/ui-test-image', type: 'image', label: () => 'image', color: '', column: 2,
    claimed: { operations: ['image.generate'], status: { running: () => '', failed: () => '' }, entry: () => ({ title: 'image', sizing: mediaSizing(undefined, WIDE_RATIO, 0) }) },
  }

  it('shows only on a failed claimed take of its own operations and reruns the record\'s operation, inputs and params based on it', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, canvas } = await mountKit({})
    canvas.nodeTypes.register(IMAGE)
    const state = fixtureState()
    const failed = { status: 'failed' as const, error: { code: 'operation_failed', message: 'GPU out of memory' } }
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g2' ? { ...entry, ...failed } : entry)
    state.components.proj.records.push(record({ id: 'i1', operation: 'image.generate', deterministic: false, ...failed }))
    // A slice node of another type that shows the failed record g2 without claiming it.
    canvas.nodeTypes.register({
      id: '@dv/ui-test-slice', type: 'slice', label: () => 'slice', color: '', column: 0,
      entries: () => [{ id: 'slice:g2', title: 'slice', record: state.components.proj.records.find(entry => entry.id === 'g2') ?? null, assets: [], sizing: { kind: 'window', defaultSize: { width: 208, height: 60 }, minSize: { width: 104, height: 60 } } }],
    })
    const nodes = nodesOf(canvas, state, OPERATIONS, 'zh')
    const retry = canvas.actions.getSnapshot().find(action => action.id === '@dv/ui-test-take:test_take:retry')
    const assets = new Map(state.assets.map(entry => [entry.id, entry]))
    const shows = (id: string) => {
      const node = nodes.get(id)
      return node === undefined ? null : retry?.shows(node, assets)
    }
    expect([retry?.label(), shows('g2'), shows('g1'), shows('i1'), shows('slice:g2')]).toEqual(['重试', true, false, false, false])

    const host = recordingHost()
    retry?.run(nodes.get('g2')!, host)
    expect(host.rerun).toHaveBeenCalledWith({
      operation: 'shot.render',
      inputs: [{ role: 'reference', ref: 'hero@1' }, { role: 'first_frame', ref: 'g1#1' }],
      params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero turns' },
      intent: '在画布上重试 shot.render', based_on: 'g2',
    })
    await runtime.dispose()
  })
})

describe('the 重试 action of each kind of one package', () => {
  it('registers a 重试 for each kind, which shows on the failed takes of that kind', async () => {
    const { runtime, canvas } = await mountKit({})
    const kind = (type: string, operation: string) => defineGenerationUi({
      id: '@dv/ui-test-pair', type, operations: [operation], label: [type, type], color: '',
      status: { running: ['生成中…', 'Generating…'], failed: ['没生成', 'Not generated'], done: ['已生成', 'Generated'] },
    })
    for (const each of [kind('test_image', 'image.generate'), kind('test_video', 'video.generate')]) {
      await runtime.mount({ inject: [...each.inject], apply: each.apply })
    }
    const state = fixtureState()
    const failed = { status: 'failed' as const, deterministic: false }
    state.components.proj.records.push(record({ id: 'i1', operation: 'image.generate', ...failed }), record({ id: 'v1', operation: 'video.generate', ...failed }))
    const nodes = nodesOf(canvas, state, OPERATIONS, 'en')
    const assets = new Map(state.assets.map(entry => [entry.id, entry]))
    const retries = (id: string) => canvas.actions.getSnapshot()
      .filter(action => action.shows(nodes.get(id)!, assets)).map(action => action.label())
    expect([retries('i1'), retries('v1')]).toEqual([['Retry'], ['Retry']])
    await runtime.dispose()
  })
})

describe('defineGenerationUi apply', () => {
  it('registers no card, editor or 重试 for a kind whose node type the canvas refuses, and still its chat cards and History rows', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const { runtime, canvas, rows } = await mountKit({
      'dv.canvas.card': { kind: 'keyed', scope: 'root' },
      'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
    })
    // The mounted test kind already holds the type key test_take.
    const rival = defineGenerationUi({
      id: '@dv/ui-test-rival', type: 'test_take', operations: ['image.generate'], label: ['对手', 'Rival'], color: '',
      status: { running: ['生成中…', 'Generating…'], failed: ['没生成', 'Not generated'], done: ['已生成', 'Generated'] },
    })
    await runtime.mount({ inject: [...rival.inject], apply: rival.apply })
    const keys = (name: 'dv.canvas.card' | 'dv.canvas.editor.claimed' | 'tool.call.toolview') =>
      runtime.slots.entries(name).map(entry => entry.options.key).filter(key => key !== 'asset')
    expect({
      types: canvas.nodeTypes.getSnapshot().map(type => type.type), actions: canvas.actions.getSnapshot().map(action => action.id),
      card: keys('dv.canvas.card'), editor: keys('dv.canvas.editor.claimed'), chat: keys('tool.call.toolview'),
      history: rows.getSnapshot().map(row => row.match),
    }).toEqual({
      types: ['asset', 'test_take'], actions: ['@dv/ui-asset-pool:unplace', '@dv/ui-test-take:test_take:retry'],
      card: ['test_take'], editor: ['test_take'], chat: ['dv_shot_render', 'dv_clip_extend', 'dv_image_generate'],
      history: ['shot.render', 'clip.extend', 'image.generate'],
    })
    await runtime.dispose()
  })

  it('registers the chat card of each operation and the History rows while @dv/ui-canvas is not loaded', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const runtime = await SlotTestRuntime.create()
    const rows = createRegistry<HistoryRow>(row => [row.match], row => row.match)
    runtime.ctx.provide('dvHistory', { rows })
    await runtime.declare({ 'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } } })
    await runtime.mount({ inject: [...testTake.inject], apply: testTake.apply })
    expect({
      chat: runtime.slots.entries('tool.call.toolview').map(entry => entry.options.key), history: rows.getSnapshot().map(row => row.match),
    }).toEqual({ chat: ['dv_shot_render', 'dv_clip_extend'], history: ['shot.render', 'clip.extend'] })
    await runtime.dispose()
  })


  it('removes the node type, the 重试 action, the card, the editor, the chat card of each operation and the History rows on unload', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const { runtime, kit, canvas, rows } = await mountKit({
      'dv.canvas.card': { kind: 'keyed', scope: 'root' },
      'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
    })
    const keyed = (name: 'dv.canvas.card' | 'dv.canvas.editor.claimed' | 'tool.call.toolview') =>
      runtime.slots.entries(name).map(entry => entry.options.key).filter(key => key !== 'asset')
    const registered = () => ({
      types: canvas.nodeTypes.getSnapshot().filter(type => type.id === '@dv/ui-test-take').map(type => type.type),
      actions: canvas.actions.getSnapshot().map(action => action.id).filter(id => id.startsWith('@dv/ui-test-take:')),
      card: keyed('dv.canvas.card'), editor: keyed('dv.canvas.editor.claimed'), chat: keyed('tool.call.toolview'),
      history: rows.getSnapshot().map(row => [row.match, row.subject(record({ id: 'r', operation: row.match }))]),
      bars: runtime.ctx.dvComposer.paramBars.getSnapshot().map(bar => [bar.operation, bar.owner]),
    })
    expect(registered()).toEqual({
      types: ['test_take'], actions: ['@dv/ui-test-take:test_take:retry'], card: ['test_take'], editor: ['test_take'],
      chat: ['dv_shot_render', 'dv_clip_extend'], history: [['shot.render', null], ['clip.extend', null]],
      bars: [['shot.render', '@dv/ui-test-take'], ['clip.extend', '@dv/ui-test-take']],
    })
    const state = fixtureState()
    const media = rows.getSnapshot()[0]?.media
    expect([
      media?.thumbnail(record({ id: 'r1', operation: 'shot.render', outputs: ['shot1.mp4', 'shot1-last.png'] }), state),
      media?.thumbnail(record({ id: 'r2', operation: 'shot.render', outputs: ['shot1.mp4'] }), state),
      media?.thumbnail(record({ id: 'r3', operation: 'shot.render', outputs: [] }), state),
    ]).toEqual(['shot1-last.png', 'shot1.mp4', null])
    const node = claimedOf(canvas, state, OPERATIONS, 'en').get('g1')!
    const editor = runtime.renderSlot('dv.canvas.editor.claimed', { node, state, operations: OPERATIONS, host: recordingHost() }, { entryKey: 'test_take' })
    expect(editor.view.getByRole('button', { name: 'Generate a new version' })).toBeTruthy()

    await kit.dispose()
    expect(registered()).toEqual({ types: [], actions: [], card: [], editor: [], chat: [], history: [], bars: [] })
    expect(editor.container.textContent).toBe('')
    await runtime.dispose()
  })
})
