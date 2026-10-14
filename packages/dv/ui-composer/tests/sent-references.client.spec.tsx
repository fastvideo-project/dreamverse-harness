// @vitest-environment jsdom
/** The sent chips of `dv:asset` and `dv:attachment` references: address choice, asset lookup, and the drawn media. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { MessageAttachmentSource } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AssetEntry, AssetKinds } from '../src/client/asset-kinds.ts'
import { resolveSentMedia, selectSentReference, SentReferenceEntry } from '../src/client/sent-references.tsx'

afterEach(cleanup)

const KINDS: AssetKinds = new Map<string, AssetEntry>([
  ['old', { kind: 'image', shot: null, name: 'cat.png' }],
  ['v1', { kind: 'video', shot: 1, name: 'take.mp4' }],
  ['new', { kind: 'image', shot: null, name: 'cat.png' }],
])

const useAssetKinds = <S,>(select: (kinds: AssetKinds) => S): S => select(KINDS)
const noImage: MessageImageLoader = () => Promise.reject(new Error('no image'))
const durable = { attachmentId: 'img-1', mediaType: 'image/png' } as Parameters<MessageImageLoader>[0]

describe('sent references', () => {
  it('selects asset and attachment addresses and keeps every other address as DSH draws it', () => {
    expect(selectSentReference({ label: 'x', uri: 'dv:asset/a%2B1' })).toEqual({ kind: 'asset', asset: 'a+1' })
    expect(selectSentReference({ label: 'cat.png', uri: 'dv:attachment/2' })).toEqual({ kind: 'attachment', position: 2, name: 'cat.png' })
    expect(selectSentReference({ label: 'cat.png', uri: 'dv:attachment/0' })).toBeNull()
    expect(selectSentReference({ label: 'Hero', uri: 'dv:character/hero' })).toBeNull()
    expect(selectSentReference({ label: 'x', uri: 'dv:asset/%E0' })).toBeNull()
  })

  it('finds an asset by ID, and an attachment as the newest asset of its file name', () => {
    expect(resolveSentMedia({ kind: 'asset', asset: 'v1' }, KINDS)).toEqual({ url: '/dv/assets/v1', video: true })
    expect(resolveSentMedia({ kind: 'attachment', position: 1, name: 'cat.png' }, KINDS)).toEqual({ url: '/dv/assets/new', video: false })
    expect(resolveSentMedia({ kind: 'attachment', position: 1, name: 'dog.png' }, KINDS)).toBeNull()
  })

  it('draws the media in front of the label, and the default chip while the index lacks the asset', () => {
    const entry = (name: string, attachments: readonly MessageAttachmentSource[]) => (
      <SentReferenceEntry
        matched={{ kind: 'attachment', position: 1, name }} reference={{ label: name, uri: 'dv:attachment/1' }}
        fallback={<b>plain</b>} attachments={attachments} loadImage={noImage} useAssetKinds={useAssetKinds}
      />
    )
    const file = { type: 'file', file: { name: 'cat.png' } } as MessageAttachmentSource
    const { container } = render(entry('cat.png', [file]))
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/dv/assets/new')
    expect(container.textContent).toBe('cat.png')
    cleanup()
    expect(render(entry('dog.png', [])).container.innerHTML).toBe('<b>plain</b>')
  })

  it('draws an image attachment without an asset: the echo preview, an empty box while loading, then the image', async () => {
    const entry = (attachment: MessageAttachmentSource, loadImage: MessageImageLoader) => (
      <SentReferenceEntry
        matched={{ kind: 'attachment', position: 1, name: 'dog.png' }} reference={{ label: 'dog.png', uri: 'dv:attachment/1' }}
        fallback={<b>plain</b>} attachments={[attachment]} loadImage={loadImage} useAssetKinds={useAssetKinds}
      />
    )
    const echo = render(entry({ type: 'image', image: { preview: { url: 'blob:dog' } } }, noImage))
    expect(echo.container.querySelector('img')?.getAttribute('src')).toBe('blob:dog')
    cleanup()
    const loaded = render(entry({ type: 'image', image: { attachment: durable } }, () => Promise.resolve('/api/image/dog')))
    expect(loaded.container.querySelector('[data-dv-sent-reference]')?.textContent).toBe('dog.png')
    expect(loaded.container.querySelector('img')).toBeNull()
    await waitFor(() => { expect(loaded.container.querySelector('img')?.getAttribute('src')).toBe('/api/image/dog') })
    cleanup()
    const failed = render(entry({ type: 'image', image: { attachment: durable } }, noImage))
    await waitFor(() => { expect(failed.container.innerHTML).toBe('<b>plain</b>') })
  })
})
