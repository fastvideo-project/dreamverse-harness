// @vitest-environment jsdom
/**
 * What the shot render declaration adds to the generation kit, through the real `@dv/ui-shot-render` plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { HistoryRow } from '@dv/ui-history/contract'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { ClaimedNodeView, EditorHost } from '../../ui-canvas/src/client/contract/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { buildCanvasGraph } from '../../ui-canvas/src/client/graph.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { composerStack } from '../../ui-composer/tests/composer-stack.client.ts'
import { fixtureState, MODELS, OPERATIONS, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { shotRenderBar } from '../src/client/param-bar.ts'

let runtime: SlotTestRuntime | undefined
let reference: Disposable | undefined

afterEach(async () => {
  reference?.[Symbol.dispose]()
  reference = undefined
  await runtime?.dispose()
  runtime = undefined
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

/** The slots that the canvas Factory and DSH's tool tree declare for the plugin's entries. */
const CHILDREN = {
  'dv.canvas.card': { kind: 'keyed', scope: 'root' },
  'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' },
  'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
} as const

/**
 * Mount the shot render plugin with the canvas registries, the History registry, and the real media, asset pool and
 * composer plugins, over the scripted `/api/dv` routes.
 */
async function mountShotRender() {
  vi.stubGlobal('fetch', scriptedFetch().fetch)
  runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const canvas = createDvCanvas()
  const rows = createRegistry<HistoryRow>(row => [row.match], row => row.match)
  runtime.ctx.provide('dvCanvas', canvas)
  runtime.ctx.provide('dvHistory', { rows })
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await runtime.declare(CHILDREN)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount(composerStack)
  const plugin = await runtime.mount({ inject, apply })
  return { runtime, plugin, canvas, rows }
}

function takesOf(canvas: ReturnType<typeof createDvCanvas>, state = fixtureState()): Map<string, ClaimedNodeView & { x: number }> {
  const graph = buildCanvasGraph(state, new Set(), OPERATIONS, 'zh', {
    nodeTypes: canvas.nodeTypes.getSnapshot(), chainAnchors: [], recordsInUse: [], versionKinds: [],
  })
  return new Map(graph.nodes.flatMap(node => node.type === 'take' && node.claimed ? [[node.id, { ...node, unseen: false, rerunning: false }] as const] : []))
}

function host(): EditorHost {
  return {
    run: vi.fn(), rerun: vi.fn(() => Promise.resolve()), pickAssets: vi.fn(), preview: vi.fn(), openNode: vi.fn(), setPlaced: vi.fn(),
    importFiles: vi.fn(() => Promise.resolve([])),
    close: vi.fn(),
  }
}

describe('the dv_shot_render chat card', () => {
  it('reads 渲染中… while the call runs, 已渲染 once it settled, and 生成失败 for a failed call', async () => {
    document.documentElement.lang = 'zh-CN'
    const mounted = await mountShotRender()
    const session = await mounted.runtime.sessions.add({ id: 's1' })
    const retained = mounted.runtime.sessions.retain(session)
    reference = retained
    const owner = (phase: 'start' | 'result', block: object) => ({
      callId: 'call-1', toolName: 'dv_shot_render', useDisclosure: () => [false, () => {}], openFile: () => {}, loadImage: () => Promise.resolve(''), phase, block,
    }) as never
    const card = mounted.runtime.renderSlot('tool.call.toolview', owner('start', { argsRaw: '{"model":"fasth3"}' }), {
      entryKey: 'dv_shot_render', session: retained, hookContext: { callId: 'call-1', assistant: undefined },
    })
    expect(card.container.textContent).toContain('渲染中…')
    card.update(owner('result', { call: { argsRaw: '{"model":"fasth3"}' } }))
    expect(card.container.textContent).toContain('已渲染')
    card.update(owner('result', { call: { argsRaw: '{"model":"fasth3"}' }, isError: true }))
    expect(card.container.textContent).toContain('生成失败')
  })

  it('registers at the default priority ahead of an operation row at priority 1, and leaves with the plugin', async () => {
    const { runtime: mounted, plugin, canvas, rows } = await mountShotRender()
    const entries = () => mounted.slots.entries('tool.call.toolview')
    // The operation row that @dv/ui-composer registers for every operation tool.
    await mounted.mount({
      inject: ['slots'],
      apply: (ctx: Context) => { ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'dv_shot_render', priority: 1 }, () => null)) },
    })
    await vi.waitFor(() => { expect(entries()).toHaveLength(2) })
    // The slot sorts a key's entries by ascending priority, and the first one renders.
    expect(entries().map(entry => [entry.options.key, entry.options.priority ?? 0])).toEqual([['dv_shot_render', 0], ['dv_shot_render', 1]])
    const own = () => ({
      types: canvas.nodeTypes.getSnapshot().filter(type => type.id === '@dv/ui-shot-render').map(type => type.type),
      editor: mounted.slots.entries('dv.canvas.editor.claimed').map(entry => entry.options.key).filter(key => key === 'take'),
      history: rows.getSnapshot().map(row => row.match),
      bars: mounted.ctx.dvComposer.paramBars.getSnapshot().map(bar => bar.owner),
    })
    expect(own()).toEqual({ types: ['take'], editor: ['take'], history: ['shot.render'], bars: ['@dv/ui-shot-render'] })

    await plugin.dispose()
    expect(entries().map(entry => entry.options.priority)).toEqual([1])
    expect(own()).toEqual({ types: [], editor: [], history: [], bars: [] })
  })
})

describe('the shot render takes', () => {
  it('compose with the shot\'s words and the video model\'s chips, offering references to a reference model and none to a text model (t2v)', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime: mounted, canvas } = await mountShotRender()
    const state = fixtureState()
    const t2v = { task: 't2v', model: 'fastt2v' }
    state.components.proj.records = state.components.proj.records.map(entry => entry.id === 'g2' ? { ...entry, params: { ...entry.params, ...t2v } } : entry)
    const takes = takesOf(canvas, state)
    const editor = mounted.renderSlot('dv.canvas.editor.claimed', { node: takes.get('g1')!, state, operations: OPERATIONS, host: host() }, { entryKey: 'take' })
    await waitFor(() => { expect(editor.view.getByRole('button', { name: '添加素材' })).toBeTruthy() })
    expect(editor.view.getByRole('button', { name: '渲染新版本' })).toBeTruthy()
    expect(editor.container.querySelector('[data-composer-input]')?.getAttribute('data-placeholder')).toBe('描述画面，输入 @ 引用素材')
    expect([...editor.container.querySelectorAll('[data-param-chip]')].map(chip => chip.getAttribute('data-param-chip')))
      .toEqual(['seed', 'aspect', 'loop', 'extra', 'aspect_ratio', 'resolution', 'duration_sec'])
    editor.update({ node: takes.get('g2')!, state, operations: OPERATIONS, host: host() }, { entryKey: 'take' })
    await waitFor(() => { expect(editor.view.getByTestId('dv-canvas-render-mode').textContent).toBe('fastt2v · 文字生成') })
    expect(editor.view.queryByRole('button', { name: '添加素材' })).toBeNull()
    expect(editor.view.getByRole('button', { name: '渲染新版本' })).toBeTruthy()
  })

  it('draw the still output on the take card in place of the video', async () => {
    const { runtime: mounted, canvas } = await mountShotRender()
    const state = fixtureState()
    const node = takesOf(canvas, state).get('g1')!
    const assets = Object.fromEntries(state.assets.map(entry => [entry.id, entry]))
    const card = mounted.renderSlot('dv.canvas.card', { node, assets, textScale: 1, host: host() }, { entryKey: 'take' })
    expect(card.container.querySelector('img')?.getAttribute('src')).toBe('/dv/assets/shot1-last.png')
    expect(card.container.querySelector('video')).toBeNull()
  })

  it('place a take that continues the previous shot\'s first frame one column right of that shot', async () => {
    const { canvas } = await mountShotRender()
    const takes = takesOf(canvas)
    // g2 reads g1's last still as its first frame; a column is 240 canvas units.
    expect((takes.get('g2')?.x ?? 0) - (takes.get('g1')?.x ?? 0)).toBe(240)
  })
})

describe('the parameter bar of shot.render', () => {
  it('offers the aspect ratios, resolutions and whole seconds that a model schema lists, with the call\'s values', () => {
    const chips = shotRenderBar.chips({ schema: MODELS[0]?.schema, params: { aspect_ratio: '9:16', duration_sec: 3 }, operation: OPERATIONS[0]! })
    expect(chips.map(chip => chip.kind === 'menu' ? [chip.key, chip.value, chip.options.map(option => option.label)] : chip)).toEqual([
      ['aspect_ratio', '9:16', ['16:9', '9:16']], ['resolution', '', ['720p']], ['duration_sec', '3', ['1', '2', '3', '4', '5']],
    ])
    expect(chips[2]?.kind === 'menu' && chips[2].options[1]?.patch).toEqual({ duration_sec: 2 })
  })

  it('gives no chip and no filter for a schema that the catalog does not know, and text fields for lists that a schema lacks', () => {
    const unknown = shotRenderBar.chips({ schema: null, params: {}, operation: OPERATIONS[0]! })
    expect([unknown, shotRenderBar.candidates(null)]).toEqual([[], null])
    const chips = shotRenderBar.chips({ schema: {}, params: {}, operation: OPERATIONS[0]! })
    expect(chips.map(chip => [chip.key, chip.kind])).toEqual([['aspect_ratio', 'text'], ['resolution', 'text'], ['duration_sec', 'menu']])
  })

  it('reads the reference filter from media types listed or keyed, with the count when the schema gives one', () => {
    expect([
      shotRenderBar.candidates(MODELS[0]?.schema),
      shotRenderBar.candidates({ inputs: { reference: { media_types: ['image', 7] } } }),
      shotRenderBar.candidates(MODELS[1]?.schema),
    ]).toEqual([
      { mediaTypes: ['image'], maxReferences: 2 }, { mediaTypes: ['image'], maxReferences: null }, { mediaTypes: [], maxReferences: null },
    ])
  })
})

describe('ui-shot-render apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })
})
