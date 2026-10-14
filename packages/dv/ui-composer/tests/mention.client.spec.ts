// @vitest-environment jsdom
/** The `@` source's chip serialization when a message is sent: an asset chip places the asset on the canvas. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerAttachment, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { projectMentionSource, referenceText, uploadItems } from '../src/client/mention.ts'

afterEach(() => { vi.unstubAllGlobals(); publishCurrentProject(null) })

describe('projectMentionSource codec', () => {
  it('sends the chip text unchanged and writes nothing; the host puts mentioned assets on the canvas', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (input: string) => {
      calls.push(input)
      return Promise.resolve(new Response('{}'))
    })
    publishCurrentProject('p1')
    const { codec } = projectMentionSource(() => [])
    if (codec === undefined) throw new Error('the source has no codec')
    const asset = referenceText('hero.png', 'dv:asset/a%2B1')
    const character = referenceText('Hero', 'dv:character/hero')
    expect(await codec.serialize(asset, new AbortController().signal, [])).toBe(asset)
    expect(await codec.serialize(character, new AbortController().signal, [])).toBe(character)
    expect(calls).toEqual([])
  })

  it('sends a draft upload chip as its position among the attachments the message carries, or as its label once removed', async () => {
    const { codec } = projectMentionSource(() => [])
    if (codec === undefined) throw new Error('the source has no codec')
    const first = 'd1' as DraftAttachmentId
    const second = 'd2' as DraftAttachmentId
    const chip = referenceText('car.png', 'dv:upload/d2')
    expect(await codec.serialize(chip, new AbortController().signal, [first, second])).toBe(referenceText('car.png', 'dv:attachment/2'))
    expect(await codec.serialize(chip, new AbortController().signal, [first])).toBe('car.png')
  })
})

describe('uploadItems', () => {
  it('lists the draft attachments with the image preview as the chip thumbnail', () => {
    const image: ComposerAttachment = { kind: 'image', id: 'd1' as DraftAttachmentId, file: new File(['x'], 'car.png', { type: 'image/png' }), previewUrl: 'blob:car' }
    const video: ComposerAttachment = { kind: 'file', id: 'd2' as DraftAttachmentId, file: new File(['x'], 'run.mp4', { type: 'video/mp4' }) }
    expect(uploadItems([image, video]).map(({ uri, label, thumbnail }) => ({ uri, label, thumbnail }))).toEqual([
      { uri: 'dv:upload/d1', label: 'car.png', thumbnail: { url: 'blob:car', video: false } },
      { uri: 'dv:upload/d2', label: 'run.mp4', thumbnail: undefined },
    ])
  })
})
