// @vitest-environment jsdom
/**
 * The canvas's assets through the `dv.media` Factory of `@dv/ui-media`: the purpose at which each surface asks for its
 * asset, read through stand-in media views that name the occurrence they draw, and the take player drawn by the real
 * video view of `@dv/ui-asset-pool`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import type { ChainAnchor } from '@dv/ui-kit/registries.ts'
import { apply as mediaApply, inject as mediaInject } from '@dv/ui-media/src/client/index.ts'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'
import { asset, fixtureState, record, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { planNodeType } from '../../ui-shot-plan/src/client/index.ts'
import { CanvasView } from '../src/client/CanvasView.tsx'
import { createDvCanvas } from '../src/client/dv-canvas.ts'
import { EDITOR_RECT_KEY } from '../src/client/NodeEditor.tsx'
import type { CanvasTranslate } from '../src/client/NodeCard.tsx'
import { zh } from '../src/client/locales.ts'
import { mountCanvasFrame } from './media-runtime.client.tsx'

/** The reference noun `test_ref` of the fixture, declared as the UI package of a noun declares it. */
const testRef = defineReferenceUi({
  id: '@dv/ui-test-ref', key: 'test_ref', slice: state => state.components.test_ref,
  label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
})

/** The chain anchor of the fixture's approval `a1`: it hangs the takes it started off `plan:p1`. */
const APPROVAL: ChainAnchor = { starter: 'plan.approve', anchor: approval => `plan:${String(approval.params['plan'])}` }

/**
 * A view of a media type as a stand-in media plugin registers it: an empty mark that names the asset, the purpose and
 * the poster of the occurrence it draws.
 * @param props - the occurrence.
 * @returns the mark.
 */
function NamingView({ asset: shown, purpose, poster }: PropsRuntime<'dv.media.view'>): ReactNode {
  return <i data-media={[shown.id, purpose, ...poster === undefined ? [] : [poster]].join(' ')} />
}

/**
 * Mount the media plugin and a stand-in media plugin that draws the image, video and audio types with
 * {@link NamingView}.
 * @param runtime - the runtime.
 */
async function mountNamingViews(runtime: SlotTestRuntime): Promise<void> {
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({
    inject: ['slots'],
    apply: (ctx: Context) => {
      for (const key of ['image', 'video', 'audio']) {
        ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key }, NamingView)), `test: ${key} view`)
      }
    },
  })
}

/**
 * @param element - a drawn surface.
 * @returns the occurrence that each stand-in view inside it names, in document order.
 */
const drawn = (element: Element): Array<string | null> => [...element.querySelectorAll('[data-media]')].map(mark => mark.getAttribute('data-media'))

/** The runtimes that {@link mount} created, disposed after each test. */
const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  cleanup()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  window.localStorage.removeItem(EDITOR_RECT_KEY)
  window.localStorage.removeItem('dv-canvas-seen:p1')
  document.documentElement.lang = ''
})

/**
 * Mount the canvas of p1 beside chat session s5 in a root frame that hands it the `dv.media` renderer and the `dvMedia`
 * preview, over the fixture with the `test_ref` noun, the node type of plans and the chain anchor of the approval.
 * @param edit - changes to the fixture state.
 * @param media - mounts the plugins that provide `dvMedia` and the media views; the real ones by default.
 * @returns the rendered view, a lookup that waits for a node, and an opener of a node's editor.
 */
async function mount(edit: (state: FixtureState) => void, media?: (runtime: SlotTestRuntime) => Promise<void>) {
  document.documentElement.lang = 'zh-CN'
  const scripted = scriptedFetch({
    state: () => {
      const state = withTestRef(fixtureState())
      edit(state)
      return state
    },
  })
  const client = new DvClient(scripted.fetch)
  const canvas = createDvCanvas()
  canvas.nodeTypes.register(testRef.nodeType)
  canvas.versionKinds.register(testRef.versionKind)
  canvas.nodeTypes.register(planNodeType)
  canvas.chainAnchors.register(APPROVAL)
  const t: CanvasTranslate = makeTranslate(zh)
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  await mountCanvasFrame(runtime, ({ renderSlot, renderFactorySlot, preview }) => (
    <CanvasView
      projectId="p1" client={client} session="s5" t={t} canvas={canvas} renderSlot={renderSlot} renderFactorySlot={renderFactorySlot}
      preview={preview}
    />
  ), media)
  const view = runtime.renderRoot()
  const node = (id: string): Promise<HTMLElement> => waitFor(() => {
    const element = view.container.querySelector(`[data-node-id="${id}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no node ${id}`)
    return element
  })
  const open = async (id: string): Promise<HTMLElement> => {
    fireEvent.pointerDown(await node(id), { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(view.getByTestId('dv-canvas-view'), { pointerId: 1 })
    return view.findByTestId('dv-canvas-node-editor')
  }
  return { view, node, open }
}

/**
 * The fixture with g1 rendering slot 1 of the approved plan and v2, which made only a video, rendering slot 2; the
 * imported image pool.png on the canvas; and a second item of `test_ref`, Villain, whose reference is villain.png.
 * @param state - the fixture state.
 */
function withSurfaces(state: FixtureState): void {
  const proj = state.components.proj
  proj.records = proj.records.map(entry => entry.id === 'g1' ? { ...entry, started_by: { record: 'a1', slot: 1 } } : entry)
  proj.records.push(
    record({ id: 'v2', operation: 'shot.render', deterministic: false, started_by: { record: 'a1', slot: 2 }, params: { prompt: 'hero turns' }, outputs: ['v2.mp4'] }),
    record({ id: 'u2', operation: 'asset.import', params: { name: 'pool.png' }, outputs: ['pool.png'], surface: 'asset_pool' }),
  )
  state.assets.push(asset('v2.mp4', 'video/mp4', 'v2', 3, 'shot.render'), asset('pool.png', 'image/png', 'u2'), asset('villain.png', 'image/png', null))
  proj.created_by['v2.mp4'] = 'v2'
  proj.created_by['pool.png'] = 'u2'
  state.components.asset.placed = ['pool.png']
  state.components.test_ref = {
    ...state.components.test_ref,
    villain: [{ id: 'villain', version: 1, name: 'Villain', description: '', references: ['villain.png'], created_by: 'e1' }],
  }
}

describe('the canvas through dv.media', () => {
  it('asks for cards at card, entry boxes, slot frames, reference chips and picker tiles at thumb, and the editor player at loop behind the take\'s image', async () => {
    const { view, node, open } = await mount(withSurfaces, mountNamingViews)
    expect(drawn(await node('g1'))).toEqual(['shot1-last.png card'])
    expect(drawn(await node('v2'))).toEqual(['v2.mp4 card'])
    expect(drawn(await node('u2'))).toEqual(['pool.png card'])
    expect(drawn(await node('test_ref:hero'))).toEqual(['ref.png thumb'])
    expect(drawn(await node('plan:p1'))).toEqual(['shot1-last.png thumb', 'v2.mp4 thumb'])

    const take = await open('g1')
    // The player, then the chip of the take's reference hero@1.
    expect(drawn(take)).toEqual(['shot1.mp4 loop shot1-last.png', 'ref.png thumb'])
    fireEvent.click(within(take).getByText(zh['editor.addAsset']))
    expect(drawn(await view.findByTestId('dv-canvas-asset-picker'))).toEqual(['villain.png thumb'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    // A take without an image output plays its video with no poster; an imported asset plays itself.
    expect(drawn(await open('v2'))).toEqual(['v2.mp4 loop'])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(drawn(await open('u2'))).toEqual(['pool.png loop'])
  })

  it('plays a take\'s video in its editor muted, looping and with controls, behind its image output', async () => {
    const { open } = await mount(() => undefined)
    const video = (await open('g1')).querySelector('video')
    expect([video?.getAttribute('src'), video?.getAttribute('poster'), video?.muted, video?.loop, video?.controls])
      .toEqual([assetUrl('shot1.mp4'), assetUrl('shot1-last.png'), true, true, true])
  })
})
