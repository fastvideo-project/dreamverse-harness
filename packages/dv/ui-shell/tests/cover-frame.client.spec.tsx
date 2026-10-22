// @vitest-environment jsdom
/**
 * The project cover frame under the real slot runtime, the real `@dv/ui-media` plugin and the real asset pool plugin:
 * the cover's asset drawn through `dv.media` by the view of the media type that the summary's MIME type names, at the
 * frame's purpose, or an empty frame.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
 * A media view of the type `model`, as a plugin registers one: it prints the asset that it is handed.
 * @param props - the asset.
 * @returns the asset as JSON.
 */
function ModelView({ asset }: PropsRuntime<'dv.media.view'>): ReactNode {
  return <span data-testid="model-view">{JSON.stringify(asset)}</span>
}

/**
 * Draw one cover frame per cover with the media plugin, the asset pool plugin and a `model` view mounted.
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
  await runtime.mount({
    inject: ['slots'],
    apply: (ctx) => { ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key: 'model' }, ModelView))) },
  })
  return runtime.renderRoot()
}

describe('CoverFrame', () => {
  it('draws a video cover and an image cover through dv.media at the frame\'s purpose, and nothing without a cover', async () => {
    const view = await draw([
      [{ asset: 'shot1.mp4', mime: 'video/mp4' }, 'card'],
      [{ asset: 'poster.png', mime: 'image/png' }, 'thumb'],
      [{ asset: 'shot1.mp4', mime: 'video/mp4' }, 'player'],
      [null, 'card'],
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
    ])
    expect(frames.map(frame => frame.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true', 'true'])
  })

  it('hands the view of the summary\'s media type the asset ID and MIME type, and no fact that the summary does not name', async () => {
    const view = await draw([[{ asset: 'm1', mime: 'model/gltf+json' }, 'card']])
    expect(view.getByTestId('model-view').textContent).toBe('{"id":"m1","mime":"model/gltf+json"}')
  })
})
