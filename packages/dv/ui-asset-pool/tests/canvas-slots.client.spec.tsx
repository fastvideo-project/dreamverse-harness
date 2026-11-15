// @vitest-environment jsdom
/**
 * The asset pool on the canvas, with the real asset pool and media plugins mounted: the asset node type drawn by the
 * canvas graph builder, the asset card and editor drawing the asset through `dv.media`, the asset pool panel in the
 * canvas's picker, and the removal of each of them with the plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import type { NodeView } from '../../ui-canvas/src/client/contract/index.ts'
import { asset, canvasNode, fixtureState, OPERATIONS, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { canvasNodes, disposeRuntimes, mountAssetPool, recordingHost } from './runtime.client.tsx'

afterEach(async () => {
  cleanup()
  await disposeRuntimes()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

/**
 * The fixture state plus an image that two `asset.import` records imported, a video, an image that no record of the
 * state imported, and the `asset.place` record `p1` that put it and the not yet listed fresh.png on the canvas.
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
    record({ id: 'p1', operation: 'asset.place', surface: 'canvas' }),
  )
  return state
}

/** The asset nodes of the two imports of {@link importedState} that put their output on the canvas. */
const IMPORTS = { u2: canvasNode('asset', ['u2']), u3: canvasNode('asset', ['u3']) }

/**
 * @param assets - the placed assets.
 * @returns the asset nodes that the placement record p1 made, `p1` for the first and `p1.<n>` for the others.
 */
const placed = (...assets: string[]) => Object.fromEntries(assets.map((each, index) =>
  [index === 0 ? 'p1' : `p1.${String(index + 1)}`, canvasNode('asset', ['p1'], 0, 0, { asset: each })]))

function assetNodes(nodes: readonly NodeView[]): Record<string, object> {
  return Object.fromEntries(nodes.filter(node => node.type === 'asset').map(node => [node.id, {
    title: node.title, meta: node.meta, record: node.record?.id ?? null, assets: node.assets, ref: node.ref,
    size: node.sizing?.defaultSize,
  }]))
}

const byId = (assets: readonly Asset[]): Record<string, Asset> => Object.fromEntries(assets.map(each => [each.id, each]))

describe('the asset node type', () => {
  it('draws the node of an import that put its asset on the canvas as the import\'s output, titled by the asset', async () => {
    const { runtime } = await mountAssetPool(() => null)
    expect(assetNodes(canvasNodes(runtime, importedState(), IMPORTS))).toEqual({
      u2: { title: '海报', record: 'u2', assets: ['poster.png'], size: { width: 208, height: 117 } },
      u3: { title: 'clip.mp4', meta: '2.5s', record: 'u3', assets: ['clip.mp4'], size: { width: 208, height: 117 } },
    })
  })

  it('sizes an asset of known size as a media node at its aspect ratio, and an asset of unknown size at 16:9', async () => {
    const { runtime } = await mountAssetPool(() => null)
    const state = importedState()
    state.assets = state.assets.map(item => item.id === 'poster.png' ? { ...item, width: 768, height: 1024 } : item)
    const sizings = Object.fromEntries(canvasNodes(runtime, state, IMPORTS).map(node => [node.id, node.sizing]))
    expect(sizings).toMatchObject({
      u2: { kind: 'media', defaultSize: { width: 208, height: 277 }, minSize: { width: 104, height: 139 }, aspectRatio: { ratio: 3 / 4, fixedHeight: 0 } },
      u3: { kind: 'media', defaultSize: { width: 208, height: 117 }, minSize: { width: 104, height: 59 }, aspectRatio: { ratio: 16 / 9, fixedHeight: 0 } },
    })
  })

  it('draws the node of a placement as its placed asset, which names the asset in a prompt, titled by the ID while the state does not list it yet', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime } = await mountAssetPool(() => null)
    expect(runtime.ctx.dvCanvas.nodeTypes.getSnapshot().map(type => type.label())).toEqual(['素材'])
    expect(assetNodes(canvasNodes(runtime, importedState(), placed('undone.png', 'fresh.png')))).toEqual({
      p1: { title: 'undone.png', record: 'p1', assets: ['undone.png'], ref: { kind: 'asset', id: 'undone.png' }, size: { width: 208, height: 117 } },
      'p1.2': { title: 'fresh.png', record: 'p1', assets: ['fresh.png'], ref: { kind: 'asset', id: 'fresh.png' }, size: { width: 208, height: 117 } },
    })
  })

  it('draws no asset node for an import or an asset outside the node list, and an untitled node for an import without an output', async () => {
    const { runtime } = await mountAssetPool(() => null)
    expect(assetNodes(canvasNodes(runtime, importedState(), {}))).toEqual({})
    const state = importedState()
    state.components.proj.records.push(record({ id: 'u5', operation: 'asset.import', outputs: [], status: 'failed' }))
    expect(assetNodes(canvasNodes(runtime, state, { u5: canvasNode('asset', ['u5']) }))).toEqual({
      u5: { title: '', record: 'u5', assets: [''], size: { width: 208, height: 117 } },
    })
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
        <div data-testid={`${node.id}:card`}>{renderSlot('dv.canvas.card', { node, state, session: null, selected: false, above: null, assets: byId(state.assets), textScale: 1, host }, { entryKey: node.type })}</div>
        <div data-testid={`${node.id}:editor`}>{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host }, { entryKey: node.type })}</div>
      </section>
    )))
    nodes = canvasNodes(runtime, state, IMPORTS)
    const view = runtime.renderRoot()

    const posterCard = view.getByTestId('u2:card').querySelector('img')
    expect([posterCard?.getAttribute('src'), posterCard?.getAttribute('alt')]).toEqual(['/dv/assets/poster.png', ''])
    // A picture of known size fills the frame bare; an asset of unknown size sits on the card surface.
    const fill = (id: string): string | undefined =>
      view.getByTestId(`${id}:card`).querySelector<HTMLElement>('[data-slot="dv.canvas.card"] > div')?.style.background
    expect([fill('u2'), fill('u3')]).toEqual(['', CARD_SURFACE.background])
    expect(within(view.getByTestId('u2:editor')).getByRole('img', { name: '海报' }).getAttribute('src')).toBe('/dv/assets/poster.png')

    const clipCard = view.getByTestId('u3:card').querySelector('video')
    // The card's video shows its still until the node is selected, and plays with sound then.
    expect([clipCard?.getAttribute('src'), clipCard?.muted, clipCard?.controls]).toEqual(['/dv/assets/clip.mp4#t=0.1', false, false])
    expect(view.getByTestId('u3:card').querySelector('[data-video-card-controls]')).toBeNull()
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
    nodes = canvasNodes(runtime, state, IMPORTS)
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
        <div data-testid="card">{renderSlot('dv.canvas.card', { node, state, session: null, selected: false, above: null, assets: byId(state.assets), textScale: 1, host }, { entryKey: node.type })}</div>
        <div data-testid="editor">{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host }, { entryKey: node.type })}</div>
      </section>
    )))
    nodes = canvasNodes(runtime, state, placed('fresh.png')).filter(node => node.type === 'asset')
    const view = runtime.renderRoot()
    expect(view.getByTestId('card').querySelector('img, video, audio, [data-dv-media]')).toBeNull()
    expect(view.getByTestId('editor').textContent).toBe('')
    expect(view.getByTestId('editor').querySelector('*:not(:empty)')).toBeNull()
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
  it('removes the picker, card and editor entries and the node type with the plugin, and their output', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const state = importedState()
    let nodes: NodeView[] = []
    const host = recordingHost([])
    const { runtime, assetPool } = await mountAssetPool(({ renderSlot }) => (
      <>
        {nodes.map(node => (
          <section key={node.id}>
            <div data-testid="card">{renderSlot('dv.canvas.card', { node, state, session: null, selected: false, above: null, assets: byId(state.assets), textScale: 1, host }, { entryKey: node.type })}</div>
            <div data-testid="editor">{renderSlot('dv.canvas.editor', { node, state, operations: OPERATIONS, host }, { entryKey: node.type })}</div>
          </section>
        ))}
        {renderSlot('dv.canvas.picker', { projectId: 'p1', session: 's5', onOpen: () => {} }, { entryKey: 'assets' })}
      </>
    ))
    nodes = canvasNodes(runtime, state, { u2: IMPORTS.u2 }).filter(node => node.type === 'asset')
    const view = runtime.renderRoot()
    const ledger = (): number[] => (['dv.canvas.picker', 'dv.canvas.card', 'dv.canvas.editor'] as const).map(name => runtime.slots.entries(name).length)
    const canvas = runtime.ctx.dvCanvas
    expect([ledger(), canvas.nodeTypes.getSnapshot().length, canvas.actions.getSnapshot().length]).toEqual([[1, 1, 1], 1, 0])
    expect(view.getByTestId('card').querySelector('img')).not.toBeNull()
    expect(view.getByTestId('editor').querySelector('img')).not.toBeNull()
    await waitFor(() => { expect(view.container.querySelector('[data-asset-id="shot1.mp4"]')).not.toBeNull() })

    await assetPool.dispose()
    expect([ledger(), canvas.nodeTypes.getSnapshot().length, canvas.actions.getSnapshot().length]).toEqual([[0, 0, 0], 0, 0])
    // Without its type, the node of the import draws as a plain card titled by its operation.
    expect(canvasNodes(runtime, state, { u2: IMPORTS.u2 }).find(node => node.id === 'u2')?.title).toBe('asset.import')
    expect(view.getByTestId('card').querySelector('img')).toBeNull()
    expect(view.getByTestId('editor').querySelector('img')).toBeNull()
    expect(view.queryByTestId('dv-asset-pool-panel')).toBeNull()
  })
})
