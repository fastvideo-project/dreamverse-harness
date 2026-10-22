// @vitest-environment jsdom
/**
 * The project cover frame under the real slot runtime, the real `@dv/ui-media` plugin and the real asset pool plugin:
 * the cover's asset drawn through `dv.media` by its media type's view at the frame's purpose, or an empty frame.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { WireProjectCover } from '@dv/ui-kit/types.ts'
import type { MediaPurpose } from '@dv/ui-media/contract'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { CoverFrame } from '../src/client/cover.tsx'

const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  cleanup()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
})

/**
 * Draw one cover frame per cover with the media plugin and the asset pool plugin mounted.
 * @param covers - each cover and the purpose its frame draws it at; frame `index` has the class `cover-<index>`.
 * @returns the rendered page.
 */
async function draw(covers: ReadonlyArray<[WireProjectCover | null, MediaPurpose]>) {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.root.declare({}, ({ renderFactorySlot }: PropsRenderFactories) => (
    <>
      {covers.map(([cover, purpose], index) => (
        <CoverFrame key={String(index)} cover={cover} purpose={purpose} className={`cover-${String(index)}`} renderFactorySlot={renderFactorySlot} />
      ))}
    </>
  ))
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  return runtime.renderRoot()
}

describe('CoverFrame', () => {
  it('draws a video cover, else an image cover, through dv.media at the frame\'s purpose, and nothing without a cover', async () => {
    const view = await draw([
      [{ video: 'shot1.mp4', image: 'still1.png' }, 'card'],
      [{ video: null, image: 'poster.png' }, 'thumb'],
      [{ video: 'shot1.mp4', image: null }, 'player'],
      [null, 'card'],
      [{ video: null, image: null }, 'card'],
    ])
    const frames = [...view.container.querySelectorAll('[class^="cover-"]')]
    const media = frames.map(frame => [...frame.querySelectorAll('img, video')].map((element) => {
      const flags = element instanceof HTMLVideoElement ? [element.muted && 'muted', element.controls && 'controls'] : []
      return [element.tagName.toLowerCase(), element.getAttribute('src'), ...flags.filter(flag => flag !== false)].join(' ')
    }))
    // A card or thumbnail shows a still: the video's first frame, muted and without controls, or the image.
    expect(media).toEqual([
      ['video /dv/assets/shot1.mp4#t=0.1 muted'],
      ['img /dv/assets/poster.png'],
      ['video /dv/assets/shot1.mp4 controls'],
      [],
      [],
    ])
    expect(frames.map(frame => frame.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true', 'true', 'true'])
  })
})
