// @vitest-environment jsdom
/**
 * The asset pool's media and tab registrations, with the real asset pool and media plugins mounted: the image, video and
 * audio views drawn through the `dv.media` Factory at each purpose, the media types in `dvMedia.types`, the asset pool
 * tab opening the `dvMedia` preview, and the removal of each of them with the plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { IconMicrophoneOutlineRegular, IconPaperclipOutlineRegular, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import type { MediaPurpose } from '../../ui-media/src/client/contract/index.ts'
import { asset, fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { ASSET_POOL_ID } from '../src/client/definition.ts'
import { disposeRuntimes, mountAssetPool } from './runtime.client.tsx'
import type { FrameProps } from './runtime.client.tsx'

const sessions: Disposable[] = []

afterEach(async () => {
  cleanup()
  for (const session of sessions.splice(0)) session[Symbol.dispose]()
  await disposeRuntimes()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
})

const POSTER: Asset = { ...asset('poster.png', 'image/png', null), name: '海报' }
const CLIP: Asset = { ...asset('clip.mp4', 'video/mp4', null, 2.5), name: '片段' }
const THEME: Asset = { ...asset('theme.wav', 'audio/wav', null, 30), name: '主题曲' }
const PURPOSES: readonly MediaPurpose[] = ['thumb', 'card', 'player', 'loop']

const reported: string[] = []

const occurrences = (assets: readonly Asset[]) => ({ renderFactorySlot }: FrameProps) => assets.flatMap(each => PURPOSES.map(purpose => (
  <div key={`${each.id}:${purpose}`} data-testid={`${each.id}:${purpose}`}>
    {renderFactorySlot('dv.media', {
      asset: each, purpose, ...purpose === 'loop' ? { poster: 'poster.png' } : {},
      onSize: (size) => { reported.push(`${each.id}:${purpose} ${String(size.width)}×${String(size.height)}`) },
    })}
  </div>
)))

const tabBody = (reference: { current: SessionReference | undefined }) => ({ renderSlot, SessionProvider }: FrameProps) => (
  reference.current === undefined
    ? null
    : (
      <SessionProvider session={reference.current}>
        <div data-testid="tab">{renderSlot('sidebar.right.pane.tab', {}, { entryKey: ASSET_POOL_ID, hookContext: {} as never })}</div>
      </SessionProvider>
    )
)

async function openSession(runtime: SlotTestRuntime, reference: { current: SessionReference | undefined }): Promise<void> {
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
}

function stubDecoder(): void {
  class StubAudioContext {
    decodeAudioData(): Promise<unknown> {
      const samples = new Float32Array(100).fill(0.5)
      return Promise.resolve({ numberOfChannels: 1, length: 100, sampleRate: 100, getChannelData: () => samples })
    }
  }
  vi.stubGlobal('OfflineAudioContext', StubAudioContext)
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) })))
}

describe('the media views', () => {
  it('draws an image cover-fitted as a still at thumb and card, and contained and named by the asset at player and loop, where it reports its loaded size', async () => {
    reported.length = 0
    const { runtime } = await mountAssetPool(occurrences([POSTER]))
    const view = runtime.renderRoot()
    const image = (purpose: MediaPurpose) => {
      const element = view.getByTestId(`poster.png:${purpose}`).querySelector('img')
      return [element?.getAttribute('src'), element?.getAttribute('alt'), element?.style.objectFit]
    }
    expect(PURPOSES.map(image)).toEqual([
      ['/dv/assets/poster.png', '', 'cover'], ['/dv/assets/poster.png', '', 'cover'], ['/dv/assets/poster.png', '海报', 'contain'],
      ['/dv/assets/poster.png', '海报', 'contain'],
    ])
    const still = view.getByTestId('poster.png:thumb').querySelector('img')
    expect([still?.getAttribute('loading'), still?.getAttribute('decoding')]).toEqual(['lazy', 'async'])
    const player = view.getByTestId('poster.png:player').querySelector('img')
    if (player === null) throw new Error('no player image')
    Object.defineProperties(player, { naturalWidth: { value: 1920 }, naturalHeight: { value: 1080 } })
    fireEvent.load(player)
    expect(reported).toEqual(['poster.png:player 1920×1080'])
  })

  it('draws a video as its muted first frame at thumb and card, with controls and sound at player, and muted and looping behind its poster at loop', async () => {
    reported.length = 0
    const { runtime } = await mountAssetPool(occurrences([CLIP]))
    const view = runtime.renderRoot()
    const video = (purpose: MediaPurpose) => {
      const element = view.getByTestId(`clip.mp4:${purpose}`).querySelector('video')
      return [element?.getAttribute('src'), element?.muted, element?.controls, element?.loop, element?.getAttribute('poster')]
    }
    expect(PURPOSES.map(video)).toEqual([
      ['/dv/assets/clip.mp4#t=0.1', true, false, false, null], ['/dv/assets/clip.mp4#t=0.1', true, false, false, null],
      ['/dv/assets/clip.mp4', false, true, false, null], ['/dv/assets/clip.mp4', true, true, true, '/dv/assets/poster.png'],
    ])
    const still = view.getByTestId('clip.mp4:thumb').querySelector('video')
    expect([still?.hasAttribute('playsinline'), still?.getAttribute('aria-hidden'), view.getByTestId('clip.mp4:thumb').querySelector('svg')])
      .toEqual([true, 'true', null])
    const looping = view.getByTestId('clip.mp4:loop').querySelector('video')
    if (looping === null) throw new Error('no looping video')
    expect([looping.style.width, looping.style.height, looping.style.maxHeight, looping.style.objectFit]).toEqual(['100%', '100%', '', 'contain'])
    Object.defineProperties(looping, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } })
    fireEvent.loadedMetadata(looping)
    expect(reported).toEqual(['clip.mp4:loop 1280×720'])
  })

  it('draws audio as a note at thumb, its waveform with a play button at card, and an audio player at player', async () => {
    stubDecoder()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const { runtime } = await mountAssetPool(occurrences([THEME]))
    const view = runtime.renderRoot()
    const thumb = view.getByTestId('theme.wav:thumb')
    expect([thumb.textContent, thumb.querySelector('[aria-label]'), thumb.querySelector('[aria-hidden="true"]')?.textContent, thumb.querySelector('audio')]).toEqual(['♪', null, '♪', null])
    const card = view.getByTestId('theme.wav:card')
    await waitFor(() => { expect(within(card).getByTestId('dv-audio-waveform').querySelector('path')?.getAttribute('d')).toMatch(/^M0 /) })
    expect([card.querySelector('audio')?.getAttribute('src'), card.querySelector('audio')?.controls]).toEqual(['/dv/assets/theme.wav', false])
    fireEvent.click(within(card).getByRole('button', { name: 'Play' }))
    expect(play).toHaveBeenCalledTimes(1)
    const player = view.getByTestId('theme.wav:player').querySelector('audio')
    expect([player?.getAttribute('src'), player?.controls]).toEqual(['/dv/assets/theme.wav', true])
    expect(view.getByTestId('theme.wav:loop').querySelector('audio')?.controls).toBe(true)
    vi.unstubAllGlobals()
    play.mockRestore()
  })

  it('draws the file card in place of an image, a video or an audio player that the browser cannot decode', async () => {
    const heic: Asset = { ...asset('photo.heic', 'image/heic', null), name: '照片' }
    const hevc: Asset = { ...asset('take.mov', 'video/quicktime', null, 3), name: '镜头' }
    const { runtime } = await mountAssetPool(occurrences([heic, hevc, THEME]))
    const view = runtime.renderRoot()
    const failing = [['photo.heic:thumb', 'img'], ['photo.heic:player', 'img'], ['take.mov:card', 'video'], ['take.mov:loop', 'video'], ['theme.wav:player', 'audio']]
    for (const [box = '', tag = ''] of failing) {
      const element = view.getByTestId(box).querySelector(tag)
      if (element === null) throw new Error(`no ${tag} in ${box}`)
      fireEvent.error(element)
    }
    expect(failing.map(([box = '']) => view.getByTestId(box).textContent)).toEqual([
      'image/heic', '照片image/heic', '镜头video/quicktime', '镜头video/quicktime', '主题曲audio/wav',
    ])
    expect(view.getByTestId('photo.heic:card').querySelector('img')).not.toBeNull()
  })
})

describe('the audio card', () => {
  it('draws no waveform for an audio asset of no duration', async () => {
    stubDecoder()
    const { runtime } = await mountAssetPool(occurrences([{ ...THEME, id: 'silent.wav', duration_sec: 0 }, { ...THEME, id: 'after.wav' }]))
    const view = runtime.renderRoot()
    // Decodes run one at a time in order, so the waveform of after.wav shows only after the decode of silent.wav ends.
    await waitFor(() => { expect(within(view.getByTestId('after.wav:card')).getByTestId('dv-audio-waveform')).toBeTruthy() })
    expect(view.getByTestId('silent.wav:card').querySelector('svg')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('spans its waveform over the decoded audio when the asset has no stored duration', async () => {
    stubDecoder()
    const { runtime } = await mountAssetPool(occurrences([{ ...THEME, duration_sec: null }]))
    const card = runtime.renderRoot().getByTestId('theme.wav:card')
    const bars = await waitFor(() => {
      const d = within(card).getByTestId('dv-audio-waveform').querySelector('path')?.getAttribute('d') ?? ''
      expect(d).not.toBe('')
      return d.split('M').slice(1)
    })
    // Every bar lies inside the one decoded second, at its full peak: 36 units, centered in the 40-unit height.
    expect([bars.length, bars.every(bar => bar.endsWith(' 2h3v36h-3z'))]).toEqual([48, true])
  })

  it('plays and pauses the audio, follows its play, pause and end, survives a refused play, and keeps its pointer down off the surface beneath', async () => {
    stubDecoder()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.reject(new Error('NotAllowedError')))
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { runtime } = await mountAssetPool(occurrences([THEME]))
    const card = runtime.renderRoot().getByTestId('theme.wav:card')
    const audio = card.querySelector('audio')
    if (audio === null) throw new Error('no audio')
    const button = (): HTMLElement => within(card).getByRole('button')
    const shown = () => [button().getAttribute('aria-label'), button().getAttribute('aria-pressed'), button().textContent]

    fireEvent.click(button())
    await Promise.resolve()
    expect([play.mock.calls.length, shown()]).toEqual([1, ['Play', 'false', '▶']])

    fireEvent.play(audio)
    expect(shown()).toEqual(['Pause', 'true', '❚❚'])
    Object.defineProperty(audio, 'paused', { value: false, configurable: true })
    fireEvent.click(button())
    expect(pause).toHaveBeenCalledTimes(1)
    fireEvent.pause(audio)
    expect(shown()).toEqual(['Play', 'false', '▶'])
    fireEvent.play(audio)
    fireEvent.ended(audio)
    expect(shown()).toEqual(['Play', 'false', '▶'])
    fireEvent.play(audio)
    fireEvent.error(audio)
    expect(shown()).toEqual(['Play', 'false', '▶'])

    // A surface beneath, such as the canvas, listens above the React root.
    const beneath = vi.fn()
    document.addEventListener('pointerdown', beneath)
    fireEvent.pointerDown(button())
    fireEvent.pointerDown(card)
    expect(beneath).toHaveBeenCalledTimes(1)
    document.removeEventListener('pointerdown', beneath)
    play.mockRestore()
    pause.mockRestore()
  })
})

describe('a video card that plays', () => {
  const playing = (assets: ReadonlyArray<[Asset, boolean]>) => ({ renderFactorySlot }: FrameProps) => assets.map(([each, play]) => (
    <div key={`${each.id}:${String(play)}`} data-testid={`${each.id}:${String(play)}`}>{renderFactorySlot('dv.media', { asset: each, purpose: 'card', play })}</div>
  ))

  it('plays with sound while play is true, with a play button, a progress bar and the time, and shows the still without controls while it is false', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.reject(new Error('NotAllowedError')))
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { runtime } = await mountAssetPool(playing([[CLIP, false], [CLIP, true]]))
    const view = runtime.renderRoot()
    const still = view.getByTestId('clip.mp4:false')
    expect([still.querySelector('[data-video-card-controls]'), still.querySelector('video')?.muted]).toEqual([null, false])
    const card = view.getByTestId('clip.mp4:true')
    const video = card.querySelector('video') as HTMLVideoElement
    expect([video.getAttribute('src'), play.mock.calls.length, pause.mock.calls.length]).toEqual(['/dv/assets/clip.mp4#t=0.1', 1, 1])
    const button = (): HTMLElement => within(card).getByRole('button')
    const time = (): string | null | undefined => card.querySelector('[data-video-card-controls] > span:last-child')?.textContent
    expect([button().getAttribute('aria-label'), time()]).toEqual(['Play', '0:00 / 0:03'])
    fireEvent.play(video)
    expect(button().getAttribute('aria-label')).toBe('Pause')
    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    fireEvent.click(button())
    expect(pause).toHaveBeenCalledTimes(2)
    fireEvent.pause(video)
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    fireEvent.click(button())
    await Promise.resolve()
    expect(play).toHaveBeenCalledTimes(2)
    fireEvent.play(video)
    fireEvent.ended(video)
    expect(button().getAttribute('aria-label')).toBe('Play')
    // The time follows the video; a press on the progress bar moves the video there and stays off the surface beneath.
    Object.defineProperty(video, 'currentTime', { value: 1, configurable: true, writable: true })
    Object.defineProperty(video, 'duration', { value: 4, configurable: true })
    fireEvent.timeUpdate(video)
    expect(time()).toBe('0:01 / 0:04')
    const bar = card.querySelector('[data-video-card-progress]') as HTMLElement
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 14, right: 100, bottom: 14, x: 0, y: 0, toJSON: () => ({}) })
    const beneath = vi.fn()
    document.addEventListener('pointerdown', beneath)
    fireEvent.pointerDown(bar, { clientX: 75 })
    fireEvent.pointerDown(button())
    document.removeEventListener('pointerdown', beneath)
    expect([video.currentTime, time(), bar.getAttribute('aria-valuenow'), beneath.mock.calls.length]).toEqual([3, '0:03 / 0:04', '3', 0])
    // While the browser reports no length, the card keeps the length it shows.
    Object.defineProperty(video, 'duration', { value: Number.NaN, configurable: true })
    fireEvent.loadedMetadata(video)
    expect(time()).toBe('0:03 / 0:04')
    play.mockRestore()
    pause.mockRestore()
  })

  it('draws an empty progress bar for a video of unknown length', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const { runtime } = await mountAssetPool(playing([[{ ...CLIP, duration_sec: null }, true]]))
    const bar = runtime.renderRoot().getByTestId('clip.mp4:true').querySelector('[data-video-card-progress]') as HTMLElement
    expect((bar.lastElementChild as HTMLElement).style.width).toBe('0%')
    vi.restoreAllMocks()
  })
})

describe('the media types', () => {
  it('registers image, video and audio into dvMedia.types with their icons and their views under the same keys, an image its own poster and a video its producer\'s image output', async () => {
    const { runtime } = await mountAssetPool(() => null)
    const state = fixtureState()
    const take = state.assets.find(each => each.id === 'shot1.mp4')
    if (take === undefined) throw new Error('fixture lacks shot1.mp4')
    const sample: Readonly<Record<string, Asset>> = { image: POSTER, video: take, audio: THEME }
    expect(runtime.ctx.dvMedia.types.getSnapshot().map(type => ({
      fields: Object.keys(type).sort(), owner: type.owner, icon: type.icon, poster: type.poster?.(sample[type.id] ?? POSTER, state) ?? null,
    }))).toEqual([
      { fields: ['icon', 'id', 'owner', 'poster'], owner: '@dv/ui-asset-pool', icon: IconPaperclipOutlineRegular, poster: 'poster.png' },
      { fields: ['icon', 'id', 'owner', 'poster'], owner: '@dv/ui-asset-pool', icon: IconPlayOutlineRegular, poster: 'shot1-last.png' },
      { fields: ['icon', 'id', 'owner'], owner: '@dv/ui-asset-pool', icon: IconMicrophoneOutlineRegular, poster: null },
    ])
    expect(runtime.slots.entries('dv.media.view').map(entry => entry.options.key)).toEqual(runtime.ctx.dvMedia.types.getSnapshot().map(type => type.id))
    expect(runtime.ctx.dvMedia.types.getSnapshot().find(type => type.id === 'video')?.poster?.(CLIP, state)).toBeNull()
  })
})

describe('the asset pool tab', () => {
  it('opens the dvMedia preview of a clicked tile, named by the asset and playing it, and Escape closes it', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const reference: { current: SessionReference | undefined } = { current: undefined }
    const { runtime } = await mountAssetPool(tabBody(reference))
    await openSession(runtime, reference)
    const view = runtime.renderRoot()
    act(() => { publishCurrentProject('p1') })
    const tile = await waitFor(() => {
      const found = view.getByTestId('tab').querySelector('[data-asset-id="shot1.mp4"]')
      if (!(found instanceof HTMLElement)) throw new Error('no shot1.mp4 tile')
      return found
    })
    fireEvent.click(tile)
    const dialog = view.getByRole('dialog', { name: 'shot1.mp4' })
    const player = dialog.querySelector('video')
    expect([player?.getAttribute('src'), player?.controls]).toEqual(['/dv/assets/shot1.mp4', true])
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
  })

  it('draws each tile through dv.media in a box of the asset\'s aspect ratio, and a tile whose image does not decode as the file card', async () => {
    const state = fixtureState()
    state.assets.push(
      { ...asset('portrait.png', 'image/png', null), width: 900, height: 1600 },
      { ...asset('wide.png', 'image/png', null), width: 1600, height: 900 },
      asset('broken.heic', 'image/heic', null),
    )
    vi.stubGlobal('fetch', scriptedFetch({ state }).fetch)
    const reference: { current: SessionReference | undefined } = { current: undefined }
    const { runtime } = await mountAssetPool(tabBody(reference))
    await openSession(runtime, reference)
    const view = runtime.renderRoot()
    act(() => { publishCurrentProject('p1') })
    const tile = (id: string): HTMLElement => {
      const found = view.getByTestId('tab').querySelector(`[data-asset-id="${id}"]`)
      if (!(found instanceof HTMLElement)) throw new Error(`no ${id} tile`)
      return found
    }
    await waitFor(() => { tile('broken.heic') })
    const box = (id: string): [string, string] => {
      const media = tile(id).firstElementChild
      return media instanceof HTMLElement ? [media.style.aspectRatio, media.style.width] : ['', '']
    }
    const broken = tile('broken.heic').querySelector('img')
    if (broken === null) throw new Error('no image in the broken.heic tile')
    fireEvent.error(broken)
    expect([tile('broken.heic').querySelector('img'), tile('broken.heic').textContent]).toEqual([null, 'image/heic'])
    expect([box('portrait.png'), box('wide.png')]).toEqual([['900 / 1600', '56.25%'], ['1600 / 900', '100%']])
    expect(tile('wide.png').querySelector('img')?.style.objectFit).toBe('cover')
  })
})

describe('disposal of the media and tab registrations', () => {
  it('removes the tab type, the tab body, the media types and the three views with the plugin, and their output', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    const reference: { current: SessionReference | undefined } = { current: undefined }
    const drawMedia = occurrences([POSTER, CLIP, THEME])
    const drawTab = tabBody(reference)
    const { runtime, assetPool } = await mountAssetPool(props => <>{drawMedia(props)}{drawTab(props)}</>)
    await openSession(runtime, reference)
    const view = runtime.renderRoot()
    act(() => { publishCurrentProject('p1') })
    const registered = () => ({
      tabTypes: runtime.ctx.sidebarRightTabs.entries().map(type => type.id),
      tabBodies: runtime.slots.entries('sidebar.right.pane.tab').length,
      mediaTypes: runtime.ctx.dvMedia.types.getSnapshot().map(type => type.id),
      views: runtime.slots.entries('dv.media.view').length,
    })
    const drawn = () => ['poster.png', 'clip.mp4', 'theme.wav'].map(id => view.getByTestId(`${id}:card`).querySelector('img, video, audio')?.tagName ?? null)
    expect(registered()).toEqual({ tabTypes: ['@dv/ui-asset-pool'], tabBodies: 1, mediaTypes: ['image', 'video', 'audio'], views: 3 })
    expect(drawn()).toEqual(['IMG', 'VIDEO', 'AUDIO'])
    await waitFor(() => { expect(within(view.getByTestId('tab')).getByTestId('dv-asset-pool-panel')).toBeTruthy() })

    await assetPool.dispose()
    expect(registered()).toEqual({ tabTypes: [], tabBodies: 0, mediaTypes: [], views: 0 })
    expect(drawn()).toEqual([null, null, null])
    expect(view.container.querySelectorAll('[data-dv-media="file"]')).toHaveLength(12)
    expect(within(view.getByTestId('tab')).queryByTestId('dv-asset-pool-panel')).toBeNull()
  })
})
