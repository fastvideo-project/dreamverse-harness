// @vitest-environment jsdom
/**
 * The asset pool panel: every asset of the project, including the assets of steps an undo went back past; its notices
 * while the state loads, when it fails and when the project has no assets; and the import drop zone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { DvClient } from '@dv/ui-kit/api.ts'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { asset, fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { AssetsPanel } from '../src/client/AssetsPanel.tsx'

afterEach(() => { cleanup() })

interface HeldImport {
  query: string
  answer(status: number, body: unknown): void
}

/**
 * A fetch that answers the fixture's `/api/dv` routes and holds each import.
 * @returns the fetch and the imports it holds, in arrival order.
 */
function importServer(): { fetch: typeof fetch; imports: HeldImport[] } {
  const routes = scriptedFetch().fetch
  const imports: HeldImport[] = []
  const serve: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://host')
    if (url.pathname !== '/api/dv/assets/import') return routes(input, init)
    return new Promise((resolve) => {
      imports.push({ query: url.search, answer: (status, body) => { resolve(new Response(JSON.stringify(body), { status })) } })
    })
  }
  return { fetch: serve, imports }
}

function renderPanel(fetch: typeof globalThis.fetch) {
  const view = render(<AssetsPanel projectId="p1" session="s5" client={new DvClient(fetch)} preview={() => {}} renderFactorySlot={() => null} />)
  return { view, zone: view.getByRole('button', { name: /^Drop images or videos here/ }) }
}

const file = (name: string, type: string): File => new File(['x'], name, { type })

describe('AssetsPanel', () => {
  it('lists every asset of the project from the state alone, with render stills under extracted frames', async () => {
    // An undo went back past g9: the state lists its assets, each with the operation that made it, but not its record.
    const state = fixtureState()
    state.assets.push(asset('wide.mp4', 'video/mp4', 'g9', 5, 'shot.render'), asset('wide-last.png', 'image/png', 'g9', null, 'shot.render'))
    const posts: string[] = []
    const { fetch } = scriptedFetch({ state, post: (path) => { posts.push(path); return { status: 404, body: { error: path } } } })
    const view = render(<AssetsPanel projectId="p1" session="s5" client={new DvClient(fetch)} preview={() => {}} renderFactorySlot={() => null} />)
    const panel = within(view.getByTestId('dv-asset-pool-panel'))
    await waitFor(() => { expect(view.container.querySelector('[data-asset-id="shot1.mp4"]')).not.toBeNull() })
    expect(view.container.querySelector('[data-asset-id="wide.mp4"]')).not.toBeNull()
    expect(panel.getByText('Extracted from generation · 3')).toBeTruthy()
    // The panel reads no history list.
    expect(posts).toEqual([])
  })

  it('shows Loading… until the state loads, and the reason when it fails to load', async () => {
    const failing: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({ error: 'unknown project p1' }), { status: 404 }))
    const { view } = renderPanel(failing)
    expect(view.getByText('Loading…')).toBeTruthy()
    expect(await view.findByText('Failed to load: unknown project p1')).toBeTruthy()
  })

  it('shows the empty-state guidance for a project without assets, and leaves out the sections that have no assets', async () => {
    const empty = fixtureState()
    empty.assets = []
    const { view } = renderPanel(scriptedFetch({ state: empty }).fetch)
    expect(await view.findByText('No images or videos yet. Import files above, or generate them in the chat.')).toBeTruthy()
    cleanup()

    const imagesOnly = fixtureState()
    imagesOnly.assets = imagesOnly.assets.filter(each => each.id === 'ref.png')
    const { view: images } = renderPanel(scriptedFetch({ state: imagesOnly }).fetch)
    expect(await images.findByText('Images · 1')).toBeTruthy()
    expect(images.container.querySelectorAll('h3')).toHaveLength(1)
  })

  it('carries the asset ID in the drag of a thumbnail', async () => {
    const { view } = renderPanel(scriptedFetch().fetch)
    const tile = await waitFor(() => {
      const found = view.container.querySelector('[data-asset-id="ref.png"]')
      if (!(found instanceof HTMLElement)) throw new Error('no ref.png tile')
      return found
    })
    const carried: Record<string, string> = {}
    const dataTransfer = { effectAllowed: 'all', setData: (type: string, value: string) => { carried[type] = value } }
    fireEvent.dragStart(tile, { dataTransfer })
    expect([carried, dataTransfer.effectAllowed]).toEqual([{ [DV_ASSET_DRAG_TYPE]: 'ref.png' }, 'copy'])
  })
})

describe('the import drop zone', () => {
  it('imports the dropped images and videos into the asset pool beside the chat session, and names each refused file', async () => {
    const server = importServer()
    const { view, zone } = renderPanel(server.fetch)
    const dropped = [file('a.png', 'image/png'), file('b.mp4', 'video/mp4'), file('notes.txt', 'text/plain')]
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: dropped } })
    expect(view.getByText('“notes.txt” is not an image or a video, so it was not imported.')).toBeTruthy()
    expect(server.imports.map(held => new URLSearchParams(held.query).toString())).toEqual([
      'project=p1&name=a.png&mime=image%2Fpng&surface=asset_pool&session=s5',
      'project=p1&name=b.mp4&mime=video%2Fmp4&surface=asset_pool&session=s5',
    ])
    expect(zone.textContent).toMatch(/^Importing \(2\)…/)
  })

  it('counts the imports in flight, names a failed import, and clears the failure once an import succeeds', async () => {
    const server = importServer()
    const { view, zone } = renderPanel(server.fetch)
    const transfer = (...files: File[]) => ({ dataTransfer: { types: ['Files'], files } })
    fireEvent.drop(zone, transfer(file('a.png', 'image/png'), file('b.mp4', 'video/mp4')))
    server.imports[0]?.answer(200, { asset: 'a.png', record: record({ id: 'i1', operation: 'asset.import' }) })
    await waitFor(() => { expect(zone.textContent).toMatch(/^Importing \(1\)…/) })
    server.imports[1]?.answer(507, { error: 'disk full' })
    expect(await view.findByText('Failed to import “b.mp4”: DvApiError: disk full')).toBeTruthy()
    expect(zone.textContent).toMatch(/^Drop images or videos here to import, or click to choose files/)

    fireEvent.drop(zone, transfer(file('c.png', 'image/png')))
    server.imports[2]?.answer(200, { asset: 'c.png', record: record({ id: 'i2', operation: 'asset.import' }) })
    await waitFor(() => { expect(view.queryByText(/^Failed to import/)).toBeNull() })
  })

  it('takes a file drag and leaves an asset drag from the grid to the surfaces beneath', () => {
    const server = importServer()
    const { zone } = renderPanel(server.fetch)
    // fireEvent returns false once the zone calls preventDefault, which accepts the drop.
    expect(fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } })).toBe(false)
    expect(zone.hasAttribute('data-over')).toBe(true)
    fireEvent.dragLeave(zone)
    expect(zone.hasAttribute('data-over')).toBe(false)

    const assetDrag = { types: [DV_ASSET_DRAG_TYPE, 'Files'], files: [file('a.png', 'image/png')] }
    expect(fireEvent.dragOver(zone, { dataTransfer: assetDrag })).toBe(true)
    expect(zone.hasAttribute('data-over')).toBe(false)
    expect(fireEvent.drop(zone, { dataTransfer: assetDrag })).toBe(true)
    expect(server.imports).toEqual([])
  })

  it('opens the file chooser on a click and on Enter, and imports the chosen files', () => {
    const server = importServer()
    const { view, zone } = renderPanel(server.fetch)
    const chooser = view.container.querySelector('input[type="file"]')
    if (!(chooser instanceof HTMLInputElement)) throw new Error('no file chooser')
    const opened = vi.fn()
    chooser.addEventListener('click', opened)
    fireEvent.click(zone)
    fireEvent.keyDown(zone, { key: ' ' })
    fireEvent.keyDown(zone, { key: 'Enter' })
    expect(opened).toHaveBeenCalledTimes(2)

    fireEvent.change(chooser, { target: { files: [file('chosen.png', 'image/png')] } })
    expect(server.imports.map(held => new URLSearchParams(held.query).get('name'))).toEqual(['chosen.png'])
  })
})
