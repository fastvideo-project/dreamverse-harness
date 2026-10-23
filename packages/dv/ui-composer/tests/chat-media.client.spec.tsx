// @vitest-environment jsdom
/**
 * The DreamVerse cards of chat Markdown: element selection, the resolution against the open project's assets, the
 * following of the project, and the chain entry under the real slot runtime, which draws each asset through the
 * `dv.media` Factory of `@dv/ui-media` and opens the asset preview.
 */
import { act, cleanup, fireEvent, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownElement, MarkdownTableCell } from '@deepseek-ai/dsh-client-ui-primitives'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { AudioView, ImageView, VideoView } from '../../ui-asset-pool/src/client/media.tsx'
import { asset, fixtureState, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { followChatAssets, NO_CHAT_ASSETS, type ChatAssets } from '../src/client/chat-assets.ts'
import { assetIdOf, registerChatMedia, resolveChatMedia, selectAssetReference } from '../src/client/chat-media.ts'

const link = (href: string): MarkdownElement => ({ kind: 'link', href })
const cell = (text: string, href?: string): MarkdownTableCell => ({ text, links: href === undefined ? [] : [{ href }] })
const table = (...rows: MarkdownTableCell[][]): MarkdownElement => ({ kind: 'table', rows })

/** The fixture project, whose takes g1 and g2 sit at chain slots 1 and 2, plus an imported audio file and a PDF. */
function chatState(): WireState {
  const state = fixtureState()
  state.assets.push(asset('score.wav', 'audio/wav', null), asset('brief.pdf', 'application/pdf', null))
  const slots: Record<string, number> = { g1: 1, g2: 2 }
  state.components.proj.records = state.components.proj.records.map((entry) => {
    const slot = slots[entry.id]
    return slot === undefined ? entry : { ...entry, started_by: { record: 'a1', slot } }
  })
  return state
}

/** The shot number of every output of the takes of {@link chatState}. */
const SHOTS = { 'shot1.mp4': 1, 'shot1-last.png': 1, 'shot2.mp4': 2, 'shot2-last.png': 2 }

/** The snapshot of {@link chatState} in project p1. */
function heldOf(state: WireState): ChatAssets {
  return { project: 'p1', assets: Object.fromEntries(state.assets.map(entry => [entry.id, entry])), shots: SHOTS }
}

/** A browser event stream whose project events the test sends. */
function fakeEvents() {
  const listeners = new Map<string, EventListener>()
  class FakeEventSource {
    constructor(readonly url: string) {}
    addEventListener(type: string, listener: EventListener): void { listeners.set(type, listener) }
    removeEventListener(type: string): void { listeners.delete(type) }
    close(): void {}
  }
  vi.stubGlobal('EventSource', FakeEventSource)
  return { send: () => { listeners.get('record')?.(new MessageEvent('record', { data: 'changed' })) } }
}

beforeEach(() => { document.documentElement.lang = 'zh-CN' })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
  document.documentElement.lang = ''
})

describe('selectAssetReference', () => {
  it('matches asset paths without the project\'s assets and declines other destinations', () => {
    expect(selectAssetReference(link('/dv/assets/missing.mp4'))).toEqual({ kind: 'link', asset: 'missing.mp4' })
    expect(selectAssetReference(link('http://host:8080/dv/assets/v%32.mp4'))).toEqual({ kind: 'link', asset: 'v2.mp4' })
    expect(selectAssetReference(link('/dv/assets/v1.mp4/extra'))).toBeNull()
    expect(selectAssetReference(link('https://example.com/v1.mp4'))).toBeNull()
    expect(selectAssetReference({ kind: 'image', src: '/dv/assets/ref.png', alt: '定妆照' })).toEqual({ kind: 'image', asset: 'ref.png', alt: '定妆照' })
    expect(selectAssetReference({ kind: 'image', src: 'https://example.com/ref.png', alt: '' })).toBeNull()
    expect(selectAssetReference(table([cell('1'), cell('播放', '/dv/assets/a1.wav')]))).toEqual({
      kind: 'table', rows: [{ assets: [{ column: 1, asset: 'a1.wav' }], texts: ['1', '播放'] }],
    })
    expect(selectAssetReference(table([cell('1'), cell('外链', 'https://example.com/v1.mp4')]))).toBeNull()
    expect(selectAssetReference(table())).toBeNull()
  })

  it('names no asset for an unparsable destination or a malformed escape', () => {
    expect(assetIdOf('http://')).toBeUndefined()
    expect(assetIdOf('/dv/assets/%E0%A4%A')).toBeUndefined()
  })
})

describe('resolveChatMedia', () => {
  const state = chatState()
  const held = heldOf(state)
  const byId = (id: string) => state.assets.find(entry => entry.id === id)

  it('gives a link card the take\'s shot number, and no shot number to an asset of no take, for any media type', () => {
    expect(resolveChatMedia({ kind: 'link', asset: 'shot1.mp4' }, held)).toEqual({ project: 'p1', kind: 'link', asset: byId('shot1.mp4'), shot: 1 })
    expect(resolveChatMedia({ kind: 'link', asset: 'score.wav' }, held)).toEqual({ project: 'p1', kind: 'link', asset: byId('score.wav'), shot: null })
  })

  it('keeps the default element while the project does not hold the asset', () => {
    expect(resolveChatMedia({ kind: 'link', asset: 'missing.mp4' }, held)).toBeNull()
    expect(resolveChatMedia({ kind: 'link', asset: 'shot1.mp4' }, NO_CHAT_ASSETS)).toBeNull()
    expect(resolveChatMedia({ kind: 'image', asset: 'missing.png', alt: '' }, held)).toBeNull()
  })

  it('draws an image of any held asset as a thumbnail', () => {
    expect(resolveChatMedia({ kind: 'image', asset: 'shot1.mp4', alt: '镜头' }, held)).toEqual({ project: 'p1', kind: 'image', asset: byId('shot1.mp4'), alt: '镜头' })
  })

  it('turns a table whose every body row links a held asset into a grid of the first held asset per row, captioned by the other cells', () => {
    const reference = selectAssetReference(table(
      [cell('1'), cell('直播间开场「来一把吧」'), cell('播放', '/dv/assets/shot1.mp4')],
      [cell('2'), cell(''), { text: '缺失 配乐', links: [{ href: '/dv/assets/missing.mp4' }, { href: '/dv/assets/score.wav' }] }],
    ))
    if (reference === null) throw new Error('the table links no asset')
    expect(resolveChatMedia(reference, held)).toEqual({
      project: 'p1', kind: 'table', cards: [{ asset: byId('shot1.mp4'), caption: '1 · 直播间开场「来一把吧」' }, { asset: byId('score.wav'), caption: '2' }],
    })
    const missing = selectAssetReference(table([cell('1'), cell('播放', '/dv/assets/shot1.mp4')], [cell('2'), cell('缺失', '/dv/assets/missing.mp4')]))
    if (missing === null) throw new Error('the table links no asset')
    expect(resolveChatMedia(missing, held)).toBeNull()
  })
})

describe('followChatAssets', () => {
  it('reads the current state, follows project events and project changes, and stops', async () => {
    const events = fakeEvents()
    const states: Record<string, WireState> = { p1: chatState() }
    const { fetch } = scriptedFetch({ state: () => states['p1'] ?? fixtureState() })
    const fetchImpl = vi.fn(fetch)
    const seen: ChatAssets[] = []
    publishCurrentProject('p1')
    const stop = followChatAssets(new DvClient(fetchImpl), (next) => { seen.push(next) })
    await vi.waitFor(() => { expect(seen).toHaveLength(1) })
    expect(seen[0]).toEqual(heldOf(chatState()))

    // A burst of events causes one refetch; an unchanged refetch publishes nothing; a new asset publishes again.
    const calls = fetchImpl.mock.calls.length
    events.send()
    events.send()
    await vi.waitFor(() => { expect(fetchImpl.mock.calls.length).toBe(calls + 1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toHaveLength(1)
    const grown = chatState()
    grown.assets.push(asset('more.png', 'image/png', null))
    states['p1'] = grown
    events.send()
    await vi.waitFor(() => { expect(seen).toHaveLength(2) })
    expect(Object.keys(seen[1]?.assets ?? {})).toContain('more.png')

    publishCurrentProject(null)
    expect(seen.at(-1)).toBe(NO_CHAT_ASSETS)
    stop()
    publishCurrentProject('p1')
    expect(seen).toHaveLength(3)
  })

  it('drops the fetch of a project closed meanwhile and keeps the last snapshot when a fetch fails', async () => {
    fakeEvents()
    const seen: ChatAssets[] = []
    publishCurrentProject('p1')
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host')
      if (url.searchParams.get('project') === 'gone') return Promise.resolve(new Response('{}', { status: 404 }))
      return scriptedFetch().fetch(input)
    })
    const stop = followChatAssets(new DvClient(fetchImpl), (next) => { seen.push(next) })
    publishCurrentProject('gone')
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledTimes(2) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toEqual([])
    stop()
  })

  it('gives each output of a take the chain slot of its render record, and no slot to other records\' outputs', async () => {
    const events = fakeEvents()
    /** A state of four records: two takes at slots 3 and `fourth`, a take without a slot, and a trim at slot 5. */
    const takes = (fourth: number): WireState => {
      const state = fixtureState()
      state.assets = [
        asset('v1.mp4', 'video/mp4', 't1'), asset('s1.png', 'image/png', 't1'), asset('v2.mp4', 'video/mp4', 't2'),
        asset('v3.mp4', 'video/mp4', 'k1'), asset('v4.mp4', 'video/mp4', 't4'),
      ]
      state.components.proj.records = [
        record({ id: 't1', operation: 'shot.render', deterministic: false, outputs: ['v1.mp4', 's1.png'], started_by: { record: 'a1', slot: 3 } }),
        record({ id: 't2', operation: 'shot.render', deterministic: false, outputs: ['v2.mp4'] }),
        record({ id: 'k1', operation: 'timeline.trim', outputs: ['v3.mp4'], started_by: { record: 'a1', slot: 5 } }),
        record({ id: 't4', operation: 'shot.render', deterministic: false, outputs: ['v4.mp4'], started_by: { record: 'a1', slot: fourth } }),
      ]
      return state
    }
    let state = takes(4)
    const seen: ChatAssets[] = []
    publishCurrentProject('p1')
    const stop = followChatAssets(new DvClient(scriptedFetch({ state: () => state }).fetch), (next) => { seen.push(next) })
    await vi.waitFor(() => { expect(seen).toHaveLength(1) })
    expect(seen[0]?.shots).toEqual({ 'v1.mp4': 3, 's1.png': 3, 'v4.mp4': 4 })

    // A changed shot number publishes the snapshot again.
    state = takes(6)
    events.send()
    await vi.waitFor(() => { expect(seen).toHaveLength(2) })
    expect(seen[1]?.shots['v4.mp4']).toBe(6)
    stop()
  })
})

const viewsPlugin = {
  inject: ['slots'],
  apply(ctx: SlotTestRuntime['ctx']) {
    for (const [key, view] of Object.entries({ image: ImageView, video: VideoView, audio: AudioView })) {
      ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key }, view)), `test: ${key} view`)
    }
  },
}

/**
 * Mount the chain entry under a session frame that renders one chat paragraph per Markdown element and the shell's
 * overlay list, beside the media plugin and the media views unless `withMedia` is false.
 * @param elements - the Markdown elements and the link texts of their default rendering.
 * @param state - the open project's state.
 * @param withMedia - whether `@dv/ui-media` and the media views are mounted.
 * @returns the runtime, the chain entry's plugin, and the rendered page.
 */
async function mountChat(elements: ReadonlyArray<[MarkdownElement, string]>, state: WireState, withMedia = true) {
  fakeEvents()
  vi.stubGlobal('fetch', scriptedFetch({ state }).fetch)
  const runtime = await SlotTestRuntime.create()
  const session = await runtime.sessions.add({ id: 's1' })
  const reference = runtime.sessions.retain(session)
  await runtime.root.declare({
    'conversation.chat.markdown': { kind: 'chain', scope: 'session' }, 'shell.overlay': { kind: 'list', scope: 'root' },
  }, props => (
    <>
      <props.SessionProvider session={reference}>
        {elements.map(([element, text], index) => {
          const fallback = <a href="#">{text}</a>
          return <p key={index} data-testid={`p${String(index)}`}>{props.renderSlotChain('conversation.chat.markdown', { element, fallback }, { fallback, inline: true })}</p>
        })}
      </props.SessionProvider>
      {props.renderSlot('shell.overlay', {})}
    </>
  ))
  if (withMedia) {
    await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
    await runtime.mount(viewsPlugin)
  }
  const plugin = await runtime.mount({ inject: ['slots'], apply: registerChatMedia })
  const view = runtime.renderRoot()
  return { runtime, plugin, view }
}

describe('registerChatMedia under the slot runtime', () => {
  it('draws every asset reference through dv.media: the audio view, the file card for a PDF, and a shot card that opens the preview', async () => {
    const elements: Array<[MarkdownElement, string]> = [
      [link('/dv/assets/shot1.mp4'), '点此播放'], [link('/dv/assets/score.wav'), '配乐'], [link('/dv/assets/brief.pdf'), '简报'],
      [{ kind: 'image', src: '/dv/assets/ref.png', alt: '定妆照' }, '图'], [link('/dv/assets/missing.mp4'), '缺失'],
      [table([cell('1'), cell('开场'), cell('播放', '/dv/assets/shot1.mp4')], [cell('2'), cell('特写'), cell('播放', '/dv/assets/shot2.mp4')]), '表'],
    ]
    const { runtime, plugin, view } = await mountChat(elements, chatState())
    const preview = vi.spyOn(runtime.ctx.dvMedia, 'preview')
    // Before the project opens, every reference keeps the default element.
    expect(view.getByRole('link', { name: '点此播放' })).toBeTruthy()

    act(() => { publishCurrentProject('p1') })
    // The take video is captioned with its shot number and draws the video view's first frame.
    const card = await view.findByRole('button', { name: '查看: 镜头 1' })
    expect(within(view.getByTestId('p0')).getByTitle('镜头 1').textContent).toBe('镜头 1')
    expect(view.getByTestId('p0').querySelector('video')?.getAttribute('src')).toBe(`${assetUrl('shot1.mp4')}#t=0.1`)
    // A video card carries the play badge over its frame; the audio card below has none.
    expect(card.querySelector('svg path')).not.toBeNull()
    // The audio link draws the audio view at 'thumb'; the imported file is captioned by its name.
    const audio = within(view.getByTestId('p1'))
    expect(audio.getByRole('button', { name: '查看: score.wav' }).textContent).toBe('♪')
    expect(audio.getByRole('button', { name: '查看: score.wav' }).querySelector('svg')).toBeNull()
    expect(audio.getByRole('button', { name: '查看: score.wav' })).toBeTruthy()
    // A PDF has no media view, so dv.media draws the file card.
    expect(view.getByTestId('p2').querySelector('[data-dv-media="file"]')?.textContent).toBe('application/pdf')
    // An image element of an asset without a stored size draws a 240 px wide 16:9 thumbnail named by its alt text.
    const thumb = within(view.getByTestId('p3')).getByRole('button', { name: '查看大图: 定妆照' })
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe(assetUrl('ref.png'))
    expect([thumb.style.width, thumb.style.aspectRatio]).toEqual(['240px', '16 / 9'])
    // An asset the project does not hold keeps DSH's link.
    expect(view.getByRole('link', { name: '缺失' })).toBeTruthy()
    // The table becomes a grid of two cards captioned by the other cells.
    expect([...view.getByTestId('p5').querySelectorAll('[data-dv-chat-card]')].map(node => node.getAttribute('data-dv-chat-card')))
      .toEqual(['shot1.mp4', 'shot2.mp4'])
    expect(view.getByRole('button', { name: '查看: 2 · 特写' })).toBeTruthy()

    fireEvent.click(card)
    expect(preview).toHaveBeenCalledExactlyOnceWith('p1', chatState().assets.find(entry => entry.id === 'shot1.mp4'), card)
    expect(view.getByRole('dialog', { name: 'shot1.mp4' }).querySelector('video')?.hasAttribute('controls')).toBe(true)

    await plugin.dispose()
    expect(runtime.slots.entries('conversation.chat.markdown')).toHaveLength(0)
    await runtime.dispose()
  })

  it('sizes a thumbnail by its asset up to 240 px, names a caption-less card View, and captions a take Shot N, in English', async () => {
    document.documentElement.lang = 'en'
    const state = chatState()
    state.assets.push({ ...asset('wide.png', 'image/png', null), width: 400, height: 100 }, { ...asset('small.png', 'image/png', null), width: 120, height: 90 })
    const elements: Array<[MarkdownElement, string]> = [
      [link('/dv/assets/shot2.mp4'), 'play'], [{ kind: 'image', src: '/dv/assets/wide.png', alt: '' }, 'wide'],
      [{ kind: 'image', src: '/dv/assets/small.png', alt: '' }, 'small'], [table([cell('play', '/dv/assets/score.wav')]), 'table'],
    ]
    const { runtime, view } = await mountChat(elements, state)
    act(() => { publishCurrentProject('p1') })
    expect(await view.findByRole('button', { name: 'View: Shot 2' })).toBeTruthy()
    const wide = within(view.getByTestId('p1')).getByRole('button', { name: 'View large image' })
    expect([wide.style.width, wide.style.aspectRatio, wide.style.maxWidth]).toEqual(['400px', '400 / 100', 'min(240px, 100%)'])
    const small = within(view.getByTestId('p2')).getByRole('button', { name: 'View large image' })
    expect([small.style.width, small.style.aspectRatio]).toEqual(['120px', '120 / 90'])
    expect(within(view.getByTestId('p3')).getByRole('button', { name: 'View' }).nextSibling).toBeNull()

    fireEvent.click(wide)
    expect(view.getByRole('dialog', { name: 'wide.png' }).querySelector('img')?.getAttribute('src')).toBe(assetUrl('wide.png'))
    await runtime.dispose()
  })

  it('draws an empty card that opens nothing while @dv/ui-media is absent', async () => {
    const { runtime, view } = await mountChat([[link('/dv/assets/shot1.mp4'), '点此播放']], chatState(), false)
    act(() => { publishCurrentProject('p1') })
    const card = await view.findByRole('button', { name: '查看: 镜头 1' })
    expect(card.childElementCount).toBe(0)
    fireEvent.click(card)
    expect(view.queryByRole('dialog')).toBeNull()
    await runtime.dispose()
  })
})
