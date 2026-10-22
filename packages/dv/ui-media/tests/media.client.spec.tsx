// @vitest-environment jsdom
/**
 * The media plugin under the real slot runtime: the `dv.media` Factory draws an asset by the `dv.media.view` entry of
 * its MIME top-level type or by the file card, `dvMedia.preview` opens the preview in the root `shell.overlay` list,
 * one Factory occurrence draws inside a session-scoped parent and inside a root-scoped parent, and the plugin's
 * disposal removes every registration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { MediaOwner, MediaType } from '../src/client/contract/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
  document.documentElement.lang = ''
})

/**
 * @param id - the asset ID, which doubles as its name.
 * @param mime - the MIME type.
 * @param facts - the dimensions, duration and size that differ from a 3-byte asset without them.
 * @returns the asset.
 */
function asset(id: string, mime: string, facts: Partial<Pick<Asset, 'width' | 'height' | 'duration_sec' | 'size_bytes'>> = {}): Asset {
  return { id, mime, name: id, size_bytes: 3, created_by: null, created_at: '2026-10-05T00:00:00Z', width: null, height: null, duration_sec: null, ...facts }
}

/** A test image view that shows which asset and purpose it drew. */
function TestImage({ asset: shown, purpose, poster, onSize }: PropsRuntime<'dv.media.view'>): ReactNode {
  // A test image that loads at 640 × 360 reports that size to a surface that asks for it.
  return <img alt={shown.name} data-purpose={purpose} data-poster={poster} onLoad={() => { onSize?.({ width: 640, height: 360 }) }} />
}

/** The image view of a media plugin, registered once `dv.media` declares its views. */
const imageViewPlugin = {
  inject: ['slots'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key: 'image' }, TestImage)), 'test: image view')
  },
}

/** The assets that the preview action inserted. */
const inserted: string[] = []

/** A preview action that records its asset with the asset's project and closes the preview. */
function InsertAction(props: PropsRuntime<'dv.media.preview.action'>): ReactNode {
  return <button type="button" onClick={() => { inserted.push(`${props.projectId}/${props.asset.id}`); props.close() }}>{`插入 ${props.asset.name}`}</button>
}

/** A plugin that adds 插入 beside 关闭 in the preview. */
const insertActionPlugin = {
  inject: ['slots'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.slots.inject('dv.media.preview.action', () => ctx.slots.register(
      { name: 'dv.media.preview.action', id: 'test.insert' }, InsertAction,
    )), 'test: insert action')
  },
}

/**
 * Mount the media plugin and the test image view under a root frame that draws each occurrence through `dv.media` and
 * renders the shell's overlay list, in the Chinese interface.
 * @param occurrences - the assets and purposes the frame draws.
 * @returns the runtime, the media plugin's handle, and the rendered page.
 */
async function mount(occurrences: readonly MediaOwner[]) {
  document.documentElement.lang = 'zh-CN'
  const runtime = await SlotTestRuntime.create()
  const Frame = ({ renderSlot, renderFactorySlot }: PropsRenderSlots<'shell.overlay'> & PropsRenderFactories): ReactNode => (
    <>
      {occurrences.map(occurrence => (
        <figure key={`${occurrence.asset.id}:${occurrence.purpose}`} data-testid={`${occurrence.asset.id}:${occurrence.purpose}`}>
          {renderFactorySlot('dv.media', occurrence)}
        </figure>
      ))}
      {renderSlot('shell.overlay', {})}
    </>
  )
  await runtime.root.declare({ 'shell.overlay': { kind: 'list', scope: 'root' } }, Frame)
  const media = await runtime.mount({ inject, apply })
  await runtime.mount(imageViewPlugin)
  await runtime.mount(insertActionPlugin)
  const view = runtime.renderRoot()
  return { runtime, media, view }
}

/**
 * Open the preview through `dvMedia`, as a surface does on a click.
 * @param runtime - the runtime whose `dvMedia` opens it.
 * @param shown - the asset.
 */
function preview(runtime: SlotTestRuntime, shown: Asset): void {
  act(() => { runtime.ctx.dvMedia.preview('p1', shown, null) })
}

describe('@dv/ui-media', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('refuses a second media type of one id', async () => {
    const { runtime } = await mount([])
    const image: MediaType = { id: 'image', icon: () => null }
    runtime.ctx.dvMedia.types.register(image)
    expect(() => runtime.ctx.dvMedia.types.register({ ...image }))
      .toThrow('registry key "image" is already registered')
    await runtime.dispose()
  })
})

describe('the dv.media Factory', () => {
  it('draws an asset by the dv.media.view entry of its MIME top-level type, with the purpose and poster that the surface asks for', async () => {
    const { runtime, view } = await mount([
      { asset: asset('a.png', 'image/png'), purpose: 'card' }, { asset: asset('b.jpg', 'image/jpeg'), purpose: 'thumb' },
      { asset: asset('c.png', 'image/png'), purpose: 'loop', poster: 'c-still.png' },
    ])
    expect(within(view.getByTestId('a.png:card')).getByRole('img', { name: 'a.png' }).getAttribute('data-purpose')).toBe('card')
    expect(within(view.getByTestId('b.jpg:thumb')).getByRole('img', { name: 'b.jpg' }).getAttribute('data-purpose')).toBe('thumb')
    expect(within(view.getByTestId('a.png:card')).getByRole('img', { name: 'a.png' }).hasAttribute('data-poster')).toBe(false)
    expect(within(view.getByTestId('c.png:loop')).getByRole('img', { name: 'c.png' }).getAttribute('data-poster')).toBe('c-still.png')
    await runtime.dispose()
  })

  it('draws the file card with the name and the MIME type for a media type without a view, and the MIME type alone as a thumbnail', async () => {
    const plan = asset('plan.json', 'application/json')
    const { runtime, view } = await mount([{ asset: plan, purpose: 'card' }, { asset: plan, purpose: 'thumb' }])
    const card = view.getByTestId('plan.json:card')
    expect(card.textContent).toBe('plan.jsonapplication/json')
    expect(card.querySelector('img')).toBeNull()
    const thumb = view.getByTestId('plan.json:thumb')
    expect(thumb.textContent).toBe('application/json')
    expect(within(thumb).getByTitle('plan.json')).toBeTruthy()
    await runtime.dispose()
  })

  it('keys the view by the media type of a MIME type in any case, with spaces or with parameters', async () => {
    const { runtime, view } = await mount([
      { asset: asset('d.png', 'Image/PNG'), purpose: 'card' }, { asset: asset('e.jpg', ' image/jpeg; q=0.9'), purpose: 'card' },
    ])
    expect(within(view.getByTestId('d.png:card')).getByRole('img', { name: 'd.png' })).toBeTruthy()
    expect(within(view.getByTestId('e.jpg:card')).getByRole('img', { name: 'e.jpg' })).toBeTruthy()
    await runtime.dispose()
  })

  it('draws the file card with the MIME type alone for an asset whose name the surface does not know', async () => {
    const { runtime, view } = await mount([{ asset: { id: 'd1', mime: 'application/pdf' }, purpose: 'card' }])
    const card = view.getByTestId('d1:card')
    expect(card.textContent).toBe('application/pdf')
    expect(within(card).getByTitle('application/pdf')).toBeTruthy()
    await runtime.dispose()
  })
})

describe('the asset preview', () => {
  it('opens on the shell overlay with the asset at player, its facts, and the preview actions beside 关闭', async () => {
    inserted.length = 0
    const { runtime, view } = await mount([])
    preview(runtime, asset('wide.png', 'image/png', { width: 1920, height: 1080, duration_sec: 4, size_bytes: 2.5 * 1024 * 1024 }))
    const dialog = view.getByRole('dialog', { name: 'wide.png' })
    expect(within(dialog).getByRole('img', { name: 'wide.png' }).getAttribute('data-purpose')).toBe('player')
    expect(within(dialog).getByText('1920×1080 · 4.0 秒 · 2.5 MB')).toBeTruthy()
    // The media box has the asset's aspect ratio before the media loads, so the dialog opens at its final size.
    const ratios = (shown: HTMLElement): string[] => [...shown.querySelectorAll('div')].map(div => div.style.aspectRatio).filter(ratio => ratio !== '')
    expect(ratios(dialog)).toEqual(['1920 / 1080'])
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '插入 wide.png' }))
    expect(inserted).toEqual(['p1/wide.png'])
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    preview(runtime, asset('small.png', 'image/png', { size_bytes: 2048 }))
    const small = view.getByRole('dialog', { name: 'small.png' })
    expect(within(small).getByText('2.0 KB')).toBeTruthy()
    expect(ratios(small)).toEqual([])
    await runtime.dispose()
  })

  it('closes when the open project changes', async () => {
    const { runtime, view } = await mount([])
    act(() => { publishCurrentProject('p1') })
    preview(runtime, asset('wide.png', 'image/png'))
    expect(view.getByRole('dialog', { name: 'wide.png' })).toBeTruthy()
    act(() => { publishCurrentProject('p2') })
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    await runtime.dispose()
  })

  it('moves the focus to 关闭 when it opens, and back to the element that opened it when it closes', async () => {
    const { runtime, view } = await mount([])
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    act(() => { runtime.ctx.dvMedia.preview('p1', asset('wide.png', 'image/png'), opener) })
    expect(document.activeElement).toBe(within(view.getByRole('dialog')).getByRole('button', { name: '关闭' }))
    fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: '关闭' }))
    expect(document.activeElement).toBe(opener)
    // An opener that left the page while the preview was open gets no focus.
    act(() => { runtime.ctx.dvMedia.preview('p1', asset('wide.png', 'image/png'), opener) })
    opener.remove()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(document.body)
    await runtime.dispose()
  })

  it('shows the size of the loaded media for an asset without stored dimensions, for that asset only', async () => {
    const { runtime, view } = await mount([])
    preview(runtime, asset('unsized.png', 'image/png', { size_bytes: 2048 }))
    fireEvent.load(within(view.getByRole('dialog', { name: 'unsized.png' })).getByRole('img', { name: 'unsized.png' }))
    expect(within(view.getByRole('dialog', { name: 'unsized.png' })).getByText('640×360 · 2.0 KB')).toBeTruthy()
    preview(runtime, asset('next.png', 'image/png', { size_bytes: 2048 }))
    expect(within(view.getByRole('dialog', { name: 'next.png' })).getByText('2.0 KB')).toBeTruthy()
    await runtime.dispose()
  })

  it('draws the file card at player for a media type without a view', async () => {
    const { runtime, view } = await mount([])
    preview(runtime, asset('notes.txt', 'text/plain'))
    expect(view.getByRole('dialog', { name: 'notes.txt' }).textContent).toContain('notes.txttext/plain')
    await runtime.dispose()
  })

  it('closes on 关闭, on a click on the backdrop, and on Escape before a listener beneath it sees the key; a click inside and another key keep it', async () => {
    const { runtime, view } = await mount([])
    const shown = asset('a.png', 'image/png')
    preview(runtime, shown)
    fireEvent.click(view.getByRole('button', { name: '关闭' }))
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })

    preview(runtime, shown)
    const dialog = view.getByRole('dialog', { name: 'a.png' })
    fireEvent.click(within(dialog).getByRole('img', { name: 'a.png' }))
    expect(view.getByRole('dialog', { name: 'a.png' })).toBeTruthy()
    const backdrop = dialog.querySelector('[aria-hidden="true"]')
    if (backdrop === null) throw new Error('no backdrop')
    fireEvent.click(backdrop)
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })

    const beneath = vi.fn()
    document.addEventListener('keydown', beneath)
    preview(runtime, shown)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(view.getByRole('dialog', { name: 'a.png' })).toBeTruthy()
    expect(beneath).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    expect(beneath).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(beneath).toHaveBeenCalledTimes(2)
    document.removeEventListener('keydown', beneath)
    await runtime.dispose()
  })
})

describe('one dv.media Factory under parents of both scopes', () => {
  it('draws an asset in a session-scoped chat entry and on the root frame through the one root Factory', async () => {
    document.documentElement.lang = 'zh-CN'
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } } })
    await runtime.mount({ inject, apply })
    await runtime.mount(imageViewPlugin)
    // A chat tool view, which renders under a chat session, draws its output through the Factory.
    const chatView = {
      inject: ['slots'],
      apply(ctx: Context) {
        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
          { name: 'tool.call.toolview', key: 'test_tool' },
          ({ renderFactorySlot }: PropsRenderFactories) => renderFactorySlot('dv.media', { asset: asset('chat.png', 'image/png'), purpose: 'card' }),
        )), 'test: chat view')
      },
    }
    await runtime.mount(chatView)
    using reference = runtime.sessions.retain(await runtime.sessions.add({ id: 's1' }))
    const chat = runtime.renderSlot('tool.call.toolview', {
      useDisclosure: () => ({ expanded: false, setExpanded: () => undefined, toggle: () => undefined }), callId: 'call-1', toolName: 'test_tool',
      openFile: () => undefined, loadImage: () => Promise.resolve(''), phase: 'result', block: {} as never,
    }, { session: reference, entryKey: 'test_tool', hookContext: { callId: 'call-1', assistant: undefined } })
    expect(runtime.slots.snapshot('factory:dv.media')).toHaveLength(1)
    expect(chat.container.querySelector('img')?.getAttribute('alt')).toBe('chat.png')
    expect(chat.container.querySelector('img')?.getAttribute('data-purpose')).toBe('card')
    await runtime.dispose()
  })
})

describe('ui-media disposal', () => {
  it('removes the dv.media Factory, dvMedia and the preview entry, and the open preview and the drawn media leave the page', async () => {
    const { runtime, media, view } = await mount([{ asset: asset('a.png', 'image/png'), purpose: 'card' }])
    preview(runtime, asset('b.png', 'image/png'))
    expect(view.getByRole('dialog', { name: 'b.png' })).toBeTruthy()
    expect(runtime.slots.entries('shell.overlay')).toHaveLength(1)
    expect(runtime.slots.snapshot('factory:dv.media')).toHaveLength(1)
    await media.dispose()
    expect(runtime.ctx.get('dvMedia')).toBeUndefined()
    expect(runtime.slots.entries('shell.overlay')).toHaveLength(0)
    expect(runtime.slots.snapshot('factory:dv.media')).toHaveLength(0)
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.queryByRole('img')).toBeNull()
    await runtime.dispose()
  })
})
