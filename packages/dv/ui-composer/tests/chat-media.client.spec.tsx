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
import type { DvHistory } from '@dv/ui-history/contract'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { AudioView, ImageView, VideoView } from '../../ui-asset-pool/src/client/media.tsx'
import { asset, fixtureState, OPERATIONS, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { followChatAssets, NO_CHAT_ASSETS, type ChatAssets } from '../src/client/chat-assets.ts'
import { assetIdOf, registerChatMedia, resolveChatMedia, selectAssetReference, type DescribeRecord } from '../src/client/chat-media.ts'

const link = (href: string): MarkdownElement => ({ kind: 'link', href })
const cell = (text: string, href?: string): MarkdownTableCell => ({ text, links: href === undefined ? [] : [{ href }] })
const table = (...rows: MarkdownTableCell[][]): MarkdownElement => ({ kind: 'table', rows })

/** The fixture project plus an imported audio file and an imported PDF. */
function chatState(): WireState {
  const state = fixtureState()
  state.assets.push(asset('score.wav', 'audio/wav', null), asset('brief.pdf', 'application/pdf', null))
  return state
}

/** The snapshot that {@link followChatAssets} publishes for `state` and `operations` in project p1. */
function heldOf(state: WireState, operations: readonly WireOperation[] = OPERATIONS): ChatAssets {
  const records = new Map(state.components.proj.records.map(entry => [entry.id, entry]))
  return {
    project: 'p1',
    assets: Object.fromEntries(state.assets.map(entry => [entry.id, entry])),
    producers: Object.fromEntries(Object.entries(state.components.proj.created_by).flatMap(([id, by]) => {
      const producer = records.get(by)
      return producer === undefined ? [] : [[id, producer]]
    })),
    operations,
  }
}

/** A record label that names the record and the number of operations it was given, as History's `describe` would. */
const describeRecord: DescribeRecord = (entry, operations) => [`${entry.id} 的标签 ${String(operations.length)}`, `label of ${entry.id}`]

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

  it('captions a link card with History\'s label of the asset\'s producer, else the asset\'s name, for any media type', () => {
    expect(resolveChatMedia({ kind: 'link', asset: 'shot1.mp4' }, held, describeRecord))
      .toEqual({ project: 'p1', kind: 'link', asset: byId('shot1.mp4'), caption: [`g1 的标签 ${String(OPERATIONS.length)}`, 'label of g1'] })
    expect(resolveChatMedia({ kind: 'link', asset: 'score.wav' }, held, describeRecord))
      .toEqual({ project: 'p1', kind: 'link', asset: byId('score.wav'), caption: ['score.wav', 'score.wav'] })
    // Without History the producer has no label.
    expect(resolveChatMedia({ kind: 'link', asset: 'shot1.mp4' }, held, () => null))
      .toEqual({ project: 'p1', kind: 'link', asset: byId('shot1.mp4'), caption: ['shot1.mp4', 'shot1.mp4'] })
  })

  it('keeps the default element while the project does not hold the asset', () => {
    expect(resolveChatMedia({ kind: 'link', asset: 'missing.mp4' }, held, describeRecord)).toBeNull()
    expect(resolveChatMedia({ kind: 'link', asset: 'shot1.mp4' }, NO_CHAT_ASSETS, describeRecord)).toBeNull()
    expect(resolveChatMedia({ kind: 'image', asset: 'missing.png', alt: '' }, held, describeRecord)).toBeNull()
  })

  it('draws an image of any held asset as a thumbnail', () => {
    expect(resolveChatMedia({ kind: 'image', asset: 'shot1.mp4', alt: '镜头' }, held, describeRecord))
      .toEqual({ project: 'p1', kind: 'image', asset: byId('shot1.mp4'), alt: '镜头' })
  })

  it('turns a table whose every body row links a held asset into a grid of the first held asset per row, captioned by the other cells', () => {
    const reference = selectAssetReference(table(
      [cell('1'), cell('直播间开场「来一把吧」'), cell('播放', '/dv/assets/shot1.mp4')],
      [cell('2'), cell(''), { text: '缺失 配乐', links: [{ href: '/dv/assets/missing.mp4' }, { href: '/dv/assets/score.wav' }] }],
    ))
    if (reference === null) throw new Error('the table links no asset')
    expect(resolveChatMedia(reference, held, describeRecord)).toEqual({
      project: 'p1', kind: 'table', cards: [{ asset: byId('shot1.mp4'), caption: '1 · 直播间开场「来一把吧」' }, { asset: byId('score.wav'), caption: '2' }],
    })
    const missing = selectAssetReference(table([cell('1'), cell('播放', '/dv/assets/shot1.mp4')], [cell('2'), cell('缺失', '/dv/assets/missing.mp4')]))
    if (missing === null) throw new Error('the table links no asset')
    expect(resolveChatMedia(missing, held, describeRecord)).toBeNull()
  })
})

describe('followChatAssets', () => {
  it('reads the current state and the operations, follows project events and project changes, and stops', async () => {
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
    await vi.waitFor(() => { expect(fetchImpl.mock.calls.length).toBe(calls + 2) })
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
    await vi.waitFor(() => { expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(4) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toEqual([])
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
 * Mount the media plugin, the media views, `dvHistory` and the chain entry under a session frame that renders one chat
 * paragraph per Markdown element and the shell's overlay list, in the Chinese interface.
 * @param elements - the Markdown elements and the link texts of their default rendering.
 * @param state - the open project's state.
 * @param withHistory - whether `dvHistory` is provided.
 * @returns the runtime, the chain entry's plugin, the rendered page, and the records that `describe` received.
 */
async function mountChat(elements: ReadonlyArray<[MarkdownElement, string]>, state: WireState, withHistory = true) {
  fakeEvents()
  vi.stubGlobal('fetch', scriptedFetch({ state }).fetch)
  const runtime = await SlotTestRuntime.create()
  const described: ProjectRecord[] = []
  const history: DvHistory = {
    rows: createRegistry(row => [row.match], row => row.match),
    describe: (entry, operations) => {
      described.push(entry)
      return describeRecord(entry, operations) ?? ['', '']
    },
  }
  if (withHistory) runtime.ctx.provide('dvHistory', history)
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
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount(viewsPlugin)
  const plugin = await runtime.mount({ inject: ['slots'], apply: registerChatMedia })
  const view = runtime.renderRoot()
  return { runtime, plugin, view, described }
}

describe('registerChatMedia under the slot runtime', () => {
  it('draws every asset reference through dv.media: the audio view, the file card for a PDF, and a captioned card that opens the preview', async () => {
    const elements: Array<[MarkdownElement, string]> = [
      [link('/dv/assets/shot1.mp4'), '点此播放'], [link('/dv/assets/score.wav'), '配乐'], [link('/dv/assets/brief.pdf'), '简报'],
      [{ kind: 'image', src: '/dv/assets/ref.png', alt: '定妆照' }, '图'], [link('/dv/assets/missing.mp4'), '缺失'],
      [table([cell('1'), cell('开场'), cell('播放', '/dv/assets/shot1.mp4')], [cell('2'), cell('特写'), cell('播放', '/dv/assets/shot2.mp4')]), '表'],
    ]
    const state = chatState()
    // The audio file's producer is a record that the current state no longer holds.
    state.components.proj.created_by['score.wav'] = 'gone'
    const { runtime, plugin, view, described } = await mountChat(elements, state)
    // Before the project opens, every reference keeps the default element.
    expect(view.getByRole('link', { name: '点此播放' })).toBeTruthy()

    act(() => { publishCurrentProject('p1') })
    // The take video is captioned with History's label of its producer, the render record g1.
    const label = `g1 的标签 ${String(OPERATIONS.length)}`
    const card = await view.findByRole('button', { name: `查看: ${label}` })
    expect(within(view.getByTestId('p0')).getByTitle(label).textContent).toBe(label)
    expect(described.map(entry => entry.id)).toContain('g1')
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
    // An image element draws a thumbnail named by its alt text.
    const thumb = within(view.getByTestId('p3')).getByRole('button', { name: '查看大图: 定妆照' })
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe(assetUrl('ref.png'))
    // An asset the project does not hold keeps DSH's link.
    expect(view.getByRole('link', { name: '缺失' })).toBeTruthy()
    // The table becomes a grid of two cards captioned by the other cells.
    expect([...view.getByTestId('p5').querySelectorAll('[data-dv-chat-card]')].map(node => node.getAttribute('data-dv-chat-card')))
      .toEqual(['shot1.mp4', 'shot2.mp4'])
    expect(view.getByRole('button', { name: '查看: 2 · 特写' })).toBeTruthy()

    const preview = vi.spyOn(runtime.ctx.dvMedia, 'preview')
    fireEvent.click(card)
    expect(preview).toHaveBeenCalledExactlyOnceWith('p1', chatState().assets.find(entry => entry.id === 'shot1.mp4'), card)
    expect(view.getByRole('dialog', { name: 'shot1.mp4' }).querySelector('video')?.hasAttribute('controls')).toBe(true)

    await plugin.dispose()
    expect(runtime.slots.entries('conversation.chat.markdown')).toHaveLength(0)
    await runtime.dispose()
  })

  it('captions a take by its asset name without History, sizes a thumbnail by its asset, and names a caption-less card 查看', async () => {
    const state = chatState()
    state.assets.push({ ...asset('wide.png', 'image/png', null), width: 400, height: 100 })
    const elements: Array<[MarkdownElement, string]> = [
      [link('/dv/assets/shot1.mp4'), '点此播放'], [{ kind: 'image', src: '/dv/assets/wide.png', alt: '' }, '图'],
      [table([cell('播放', '/dv/assets/score.wav')]), '表'],
    ]
    const { runtime, view } = await mountChat(elements, state, false)
    act(() => { publishCurrentProject('p1') })
    expect(await view.findByRole('button', { name: '查看: shot1.mp4' })).toBeTruthy()
    const thumb = within(view.getByTestId('p1')).getByRole('button', { name: '查看大图' })
    expect(thumb.style.aspectRatio).toBe('400 / 100')
    expect(within(view.getByTestId('p2')).getByRole('button', { name: '查看' }).nextSibling).toBeNull()

    fireEvent.click(thumb)
    expect(view.getByRole('dialog', { name: 'wide.png' }).querySelector('img')?.getAttribute('src')).toBe(assetUrl('wide.png'))
    await runtime.dispose()
  })
})
