// @vitest-environment jsdom
/**
 * The asset pool on the canvas, with the real asset pool and media plugins mounted: the asset node type drawn by the
 * canvas graph builder, the asset card and editor drawing the asset through `dv.media`, the 从画布移除 action, the
 * asset pool panel in the canvas's picker, and the removal of each of them with the plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import type { NodeType, NodeView } from '../../ui-canvas/src/client/contract/index.ts'
import { asset, fixtureState, OPERATIONS, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { canvasNodes, disposeRuntimes, mountAssetPool, recordingHost } from './runtime.client.tsx'

afterEach(async () => {
  cleanup()
  await disposeRuntimes()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

const OWNER: NodeType = {
  id: '@dv/test-owner', type: 'owner', label: () => 'owner', color: '', column: 1,
  entries: () => [{ id: 'owner', title: 'owner', record: null, assets: ['ref.png'], bodyHeight: 60 }],
}

/**
 * The fixture state plus an image that two `asset.import` records imported, a video, and an image that no record of the
 * state imported.
 * @returns the state.
 */
function importedState(): ReturnType<typeof fixtureState> {
  const state = fixtureState()
  state.assets.push(
    { ...asset('poster.png', 'image/png', 'u2', null, 'asset.import'), name: '海报' },
    asset('clip.mp4', 'video/mp4', 'u3', 2.5, 'asset.import'),
    asset('undone.png', 'image/png', 'u9', null, 'asset.import'),
  )
  state.components.proj.records.push(
    record({ id: 'u2', operation: 'asset.import', outputs: ['poster.png'], surface: 'asset_pool' }),
    record({ id: 'u3', operation: 'asset.import', outputs: ['clip.mp4'], surface: 'asset_pool' }),
    record({ id: 'u4', operation: 'asset.import', outputs: ['poster.png'], surface: 'chat' }),
  )
  return state
}

function assetNodes(nodes: readonly NodeView[]): Record<string, object> {
  return Object.fromEntries(nodes.filter(node => node.type === 'asset').map(node => [node.id, {
    title: node.title, meta: node.meta, record: node.record?.id ?? null, assets: node.assets, ref: node.ref, bodyHeight: node.bodyHeight,
  }]))
}

const byId = (assets: readonly Asset[]): Record<string, Asset> => Object.fromEntries(assets.map(each => [each.id, each]))

describe('the asset node type', () => {
  it('draws each placed asset as the node of the first asset.import record of the current state that imported it, titled by the asset', async () => {
    const { runtime } = await mountAssetPool(() => null)
    expect(assetNodes(canvasNodes(runtime, importedState(), ['poster.png', 'clip.mp4']))).toEqual({
      u2: { title: '海报', record: 'u2', assets: ['poster.png'], bodyHeight: 117 },
      u3: { title: 'clip.mp4', meta: '2.5s', record: 'u3', assets: ['clip.mp4'], bodyHeight: 117 },
    })
  })

  it('sizes the frame of an asset of known size to its aspect ratio, and gives an asset of unknown size the 16:9 frame', async () => {
    const { runtime } = await mountAssetPool(() => null)
    const state = importedState()
    state.assets = state.assets.map(item => item.id === 'poster.png' ? { ...item, width: 768, height: 1024 } : item)
    const heights = Object.fromEntries(canvasNodes(runtime, state, ['poster.png', 'clip.mp4']).map(node => [node.id, node.bodyHeight]))
    expect(heights).toMatchObject({ u2: 277, u3: 117 })
  })

  it('draws a placed asset that no record of the current state imported as asset:<id>, which names the asset in a prompt', async () => {
    const { runtime } = await mountAssetPool(() => null)
    expect(assetNodes(canvasNodes(runtime, importedState(), ['undone.png']))).toEqual({
      'asset:undone.png': { title: 'undone.png', record: null, assets: ['undone.png'], ref: { kind: 'asset', id: 'undone.png' }, bodyHeight: 117 },
    })
  })

  it('labels the node type 素材, and draws a placed asset that the state does not list yet as asset:<id> titled by the ID', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountAssetPool(() => null)
    expect(runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(type => type.label())).toEqual(['素材'])
    expect(assetNodes(canvasNodes(runtime, importedState(), ['fresh.png']))).toEqual({
      'asset:fresh.png': { title: 'fresh.png', record: null, assets: ['fresh.png'], ref: { kind: 'asset', id: 'fresh.png' }, bodyHeight: 117 },
    })
  })

  it('draws no node for an asset off the canvas list, nor for a placed asset that a node of another type owns', async () => {
    const { runtime } = await mountAssetPool(() => null)
    expect(assetNodes(canvasNodes(runtime, importedState(), []))).toEqual({})
    expect(Object.keys(assetNodes(canvasNodes(runtime, importedState(), ['ref.png'])))).toEqual(['u1'])
    runtime.ctx.dvCanvas.nodeTypes.register(OWNER)
    expect(assetNodes(canvasNodes(runtime, importedState(), ['ref.png']))).toEqual({})
  })
})

describe('the asset card and editor', () => {
  it('draw the asset through dv.media: its still in the card, and its playable form named by the asset in the editor', async () => {
    const state = importedState()
    state.assets = state.assets.map(item => item.id === 'poster.png' ? { ...item, width: 1920, height: 1080 } : item)
    let nodes: NodeView[] = []
    const host = recordingHost([])
    const { runtime } = await mountAssetPool(({ renderSlot }) => nodes.map(node => (
      <section key={node.id}>
        <div data-testid={`${node.id}:card`}>{renderSlot('dv.canvas.card', { node, assets: byId(state.assets), textScale: 1, host }, { entryKey: node.type })}</div>
        <div data-testid={`${node.id}:editor`}>{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host }, { entryKey: node.type })}</div>
      </section>
    )))
    nodes = canvasNodes(runtime, state, ['poster.png', 'clip.mp4'])
    const view = runtime.renderRoot()

    const posterCard = view.getByTestId('u2:card').querySelector('img')
    expect([posterCard?.getAttribute('src'), posterCard?.getAttribute('alt')]).toEqual(['/dv/assets/poster.png', ''])
    // A picture of known size fills the frame bare; an asset of unknown size sits on the card surface.
    const fill = (id: string): string | undefined =>
      view.getByTestId(`${id}:card`).querySelector<HTMLElement>('[data-slot="dv.canvas.card"] > div')?.style.background
    expect([fill('u2'), fill('u3')]).toEqual(['', CARD_SURFACE.background])
    expect(within(view.getByTestId('u2:editor')).getByRole('img', { name: '海报' }).getAttribute('src')).toBe('/dv/assets/poster.png')

    const clipCard = view.getByTestId('u3:card').querySelector('video')
    expect([clipCard?.getAttribute('src'), clipCard?.muted, clipCard?.controls]).toEqual(['/dv/assets/clip.mp4#t=0.1', true, false])
    const clipEditor = view.getByTestId('u3:editor').querySelector('video')
    expect([clipEditor?.getAttribute('src'), clipEditor?.controls]).toEqual(['/dv/assets/clip.mp4', true])
  })

  it('draw the editor\'s asset in a box of its aspect ratio at most 360 px tall, and 360 px tall for an asset of unknown size', async () => {
    const state = importedState()
    state.assets = state.assets.map(item => item.id === 'poster.png' ? { ...item, width: 1920, height: 1080 } : item)
    let nodes: NodeView[] = []
    const host = recordingHost([])
    const { runtime } = await mountAssetPool(({ renderSlot }) => nodes.map(node => (
      <div key={node.id} data-testid={`${node.id}:editor`}>{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host }, { entryKey: node.type })}</div>
    )))
    nodes = canvasNodes(runtime, state, ['poster.png', 'clip.mp4'])
    const view = runtime.renderRoot()
    const box = (id: string): string[] => {
      const frame = view.getByTestId(`${id}:editor`).querySelector('img, video')?.closest('[style*="360px"]')
      return frame instanceof HTMLElement ? [frame.style.width, frame.style.height, frame.style.aspectRatio, frame.style.maxHeight] : []
    }
    expect([box('u2'), box('u3')]).toEqual([['100%', '', '1920 / 1080', '360px'], ['100%', '360px', '', '']])
  })

  it('draw an empty frame and no editor body for an asset that the state does not list yet', async () => {
    const state = importedState()
    let nodes: NodeView[] = []
    const host = recordingHost([])
    const { runtime } = await mountAssetPool(({ renderSlot }) => nodes.map(node => (
      <section key={node.id}>
        <div data-testid="card">{renderSlot('dv.canvas.card', { node, assets: byId(state.assets), textScale: 1, host }, { entryKey: node.type })}</div>
        <div data-testid="editor">{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host }, { entryKey: node.type })}</div>
      </section>
    )))
    nodes = canvasNodes(runtime, state, ['fresh.png'])
    const view = runtime.renderRoot()
    expect(view.getByTestId('card').querySelector('img, video, audio, [data-dv-media]')).toBeNull()
    expect(view.getByTestId('editor').textContent).toBe('')
    expect(view.getByTestId('editor').querySelector('*:not(:empty)')).toBeNull()
  })
})

describe('从画布移除', () => {
  it('shows on asset nodes only, and closes the editor and takes the asset off the canvas list through the host', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountAssetPool(() => null)
    runtime.ctx.dvCanvas.nodeTypes.register(OWNER)
    const nodes = canvasNodes(runtime, importedState(), ['poster.png'])
    const poster = nodes.find(node => node.id === 'u2')
    const owner = nodes.find(node => node.id === 'owner')
    if (poster === undefined || owner === undefined) throw new Error('no poster or owner node')
    const assets = new Map(importedState().assets.map(each => [each.id, each]))
    const [action, ...others] = runtime.ctx.dvCanvas.actions.getSnapshot()
    if (action === undefined) throw new Error('no action')
    expect([others.length, action.label(), action.shows(poster, assets), action.shows(owner, assets)]).toEqual([0, '从画布移除', true, false])

    const calls: string[] = []
    action.run(poster, recordingHost(calls))
    expect(calls).toEqual(['close', 'setPlaced poster.png false'])
  })
})

describe('the canvas picker entry', () => {
  it('shows the asset pool panel at key assets, whose tile click picks the asset instead of opening its preview', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const onOpen = vi.fn<(picked: Asset) => void>()
    const { runtime } = await mountAssetPool(({ renderSlot }) => renderSlot('dv.canvas.picker', { projectId: 'p1', session: 's5', onOpen }, { entryKey: 'assets' }))
    const view = runtime.renderRoot()
    const tile = await waitFor(() => {
      const found = view.container.querySelector('[data-asset-id="shot1.mp4"]')
      if (!(found instanceof HTMLElement)) throw new Error('no shot1.mp4 tile')
      return found
    })
    fireEvent.click(tile)
    expect(onOpen.mock.calls.map(([picked]) => picked.id)).toEqual(['shot1.mp4'])
    expect(view.queryByRole('dialog')).toBeNull()
  })
})

describe('disposal of the canvas registrations', () => {
  it('removes the picker, card and editor entries, the node type and the action with the plugin, and their output', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const state = importedState()
    let nodes: NodeView[] = []
    const host = recordingHost([])
    const { runtime, assetPool } = await mountAssetPool(({ renderSlot }) => (
      <>
        {nodes.map(node => (
          <section key={node.id}>
            <div data-testid="card">{renderSlot('dv.canvas.card', { node, assets: byId(state.assets), textScale: 1, host }, { entryKey: node.type })}</div>
            <div data-testid="editor">{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host }, { entryKey: node.type })}</div>
          </section>
        ))}
        {renderSlot('dv.canvas.picker', { projectId: 'p1', session: 's5', onOpen: () => {} }, { entryKey: 'assets' })}
      </>
    ))
    nodes = canvasNodes(runtime, state, ['poster.png'])
    const view = runtime.renderRoot()
    const ledger = (): number[] => (['dv.canvas.picker', 'dv.canvas.card', 'dv.canvas.editor'] as const).map(name => runtime.slots.entries(name).length)
    const canvas = runtime.ctx.dvCanvas
    expect([ledger(), canvas.nodeTypes.getSnapshot().length, canvas.actions.getSnapshot().length]).toEqual([[1, 1, 1], 1, 1])
    expect(view.getByTestId('card').querySelector('img')).not.toBeNull()
    expect(view.getByTestId('editor').querySelector('img')).not.toBeNull()
    await waitFor(() => { expect(view.container.querySelector('[data-asset-id="shot1.mp4"]')).not.toBeNull() })

    await assetPool.dispose()
    expect([ledger(), canvas.nodeTypes.getSnapshot().length, canvas.actions.getSnapshot().length]).toEqual([[0, 0, 0], 0, 0])
    expect(assetNodes(canvasNodes(runtime, state, ['poster.png']))).toEqual({})
    expect(view.getByTestId('card').querySelector('img')).toBeNull()
    expect(view.getByTestId('editor').querySelector('img')).toBeNull()
    expect(view.queryByTestId('dv-asset-pool-panel')).toBeNull()
  })
})
