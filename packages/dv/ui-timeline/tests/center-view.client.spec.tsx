// @vitest-environment jsdom
/**
 * The timeline as a view of the workspace center and 插入片段 in the asset preview, under the real slot runtime with the
 * real `@dv/ui-media` plugin. The root frame stands in for the shell: it shows the view that `dvCenter.show` names with
 * the request it carries, and keeps the center fields that the view notes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId } from '@dv/project/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import type { CenterTarget } from '@dv/ui-shell/contract'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { asset, fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState, ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { standInCenter } from './center.client.tsx'

beforeEach(() => { document.documentElement.lang = 'zh-CN' })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
  document.documentElement.lang = ''
})

/** Mount ui-media and ui-timeline under a frame that draws what a recording `dvCenter` shows, for p1 and session s5. */
async function mount(routes: ScriptedRoutes = {}) {
  const { fetch, writes } = scriptedFetch(routes)
  vi.stubGlobal('fetch', fetch)
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  const center = standInCenter()
  let shownView = 'canvas'
  const targets: CenterTarget[] = []
  runtime.ctx.provide('dvCenter', {
    show(target: CenterTarget) {
      targets.push(target)
      shownView = target.view
      center.show(target.target)
    },
  })
  const Frame = ({ renderSlot }: PropsRenderSlots<'dv.center.view' | 'shell.overlay'>): ReactNode => {
    const { fields, request } = useSyncExternalStore(listener => center.subscribe(listener), () => center.getSnapshot())
    return (
      <>
        <div data-testid="center">
          {renderSlot('dv.center.view', { projectId: 'p1', session: 's5', request, fields, note: center.note }, { only: shownView })}
        </div>
        {renderSlot('shell.overlay', {})}
      </>
    )
  }
  await runtime.root.declare({ 'dv.center.view': { kind: 'list', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' } }, Frame)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  const plugin = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  const operations = (): unknown[] => writes.filter(write => write.path === '/api/dv/operation').map(write => write.body)
  const show = (target: CenterTarget): void => { act(() => { runtime.ctx.dvCenter.show(target) }) }
  const preview = (item: Asset, projectId = 'p1'): HTMLElement | null => {
    act(() => { runtime.ctx.dvMedia.preview(projectId, item, null) })
    return within(view.getByRole('dialog')).queryByRole('button', { name: /插入片段|Insert clip/ })
  }
  const insert = (item: Asset): void => {
    const button = preview(item)
    if (button === null) throw new Error(`no 插入片段 for ${item.id}`)
    fireEvent.click(button)
  }
  return { runtime, plugin, view, targets, center, operations, show, preview, insert }
}

const CLIP = asset('shot1.mp4', 'video/mp4', 'g1', 4)
const STILL = asset('shot1-last.png', 'image/png', 'g1')

function twoTimelines(): FixtureState {
  const state = fixtureState()
  state.assets.push(asset('imported.mp4', 'video/mp4', null, 3))
  state.components.timeline.timelines.push({ id: 't2' as TimelineId, name: '片尾', sounds: [], sound_track_names: [], clips: [{ id: 'cl3' as ClipId, asset: 'imported.mp4' as AssetId, source: null, in_sec: null, out_sec: null }] })
  return state
}

describe('timeline center view', () => {
  it('edits the project that the center passes on the timeline of its request, and notes a picked timeline as a center field', async () => {
    const { view, show, center, runtime } = await mount()
    show({ view: 'timeline', target: { timeline: 't1', clip: 'cl2' } })
    const editor = await view.findByTestId('dv-timeline-editor')
    await waitFor(() => { expect(editor.querySelector('[data-clip="cl2"]')?.getAttribute('aria-pressed')).toBe('true') })
    fireEvent.click(within(editor).getByRole('button', { name: /新建|New/ }))
    expect(center.getSnapshot().fields).toEqual({ timeline: 't2' })
    await runtime.dispose()
  })
})

describe('插入片段 in the asset preview', () => {
  it('shows for a video while a project is open, shows the timeline view, closes the preview, and the view inserts the clip', async () => {
    const { runtime, view, targets, operations, preview, insert } = await mount()
    expect(preview(CLIP)).toBeNull()
    act(() => { publishCurrentProject('p1') })
    expect(preview(STILL)).toBeNull()
    insert(CLIP)
    expect(targets).toEqual([{ view: 'timeline', target: { insert: 'shot1.mp4' } }])
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    await waitFor(() => {
      expect(operations()).toEqual([expect.objectContaining({
        project: 'p1', session: 's5', surface: 'timeline', operation: 'timeline.clip_insert', params: { timeline: 't1', at: 3, asset: 'shot1.mp4' },
      })])
    })
    await runtime.dispose()
  })

  it('inserts at the end of the timeline the user picked, and shows the timeline view on that timeline', async () => {
    const { runtime, view, show, targets, operations, insert } = await mount({ state: twoTimelines })
    act(() => { publishCurrentProject('p1') })
    show({ view: 'timeline', target: {} })
    fireEvent.click(await view.findByRole('tab', { name: '片尾' }))
    insert(CLIP)
    expect(targets.at(-1)).toEqual({ view: 'timeline', target: { insert: 'shot1.mp4' } })
    await waitFor(() => {
      expect(operations()).toEqual([{
        project: 'p1', operation: 'timeline.clip_insert', params: { timeline: 't2', at: 2, asset: 'shot1.mp4' }, intent: '在位置 2 插入片段',
        surface: 'timeline', session: 's5',
      }])
    })
    await runtime.dispose()
  })

  it('draws 插入片段 with the button class of 关闭, so it hovers and shows its focus ring as 关闭 does', async () => {
    const { runtime, view, preview } = await mount()
    act(() => { publishCurrentProject('p1') })
    const button = preview(CLIP)
    const close = within(view.getByRole('dialog')).getByRole('button', { name: '关闭' })
    expect([button?.className, button?.getAttribute('style')]).toEqual([close.className, null])
    await runtime.dispose()
  })

  it('hides 插入片段 for an asset of a project that is not open', async () => {
    const { runtime, preview } = await mount()
    act(() => { publishCurrentProject('p1') })
    expect(preview(CLIP, 'p2')).toBeNull()
    expect(preview(CLIP, 'p1')).not.toBeNull()
    await runtime.dispose()
  })

  it('creates t1 holding the clip in a project without timelines', async () => {
    const state = fixtureState()
    state.components.timeline.timelines = []
    const { runtime, operations, insert } = await mount({ state: () => state })
    act(() => { publishCurrentProject('p1') })
    insert(asset('shot2.mp4', 'video/mp4', 'g2', 6))
    await waitFor(() => {
      expect(operations()).toEqual([{
        project: 'p1', operation: 'timeline.create', params: { timeline: 't1', assets: ['shot2.mp4'] }, intent: '新建时间线', surface: 'timeline', session: 's5',
      }])
    })
    await runtime.dispose()
  })

  it('leaves the preview and the center with the plugin', async () => {
    const { runtime, plugin, view, show, preview } = await mount()
    act(() => { publishCurrentProject('p1') })
    show({ view: 'timeline', target: { timeline: 't1' } })
    await view.findByTestId('dv-timeline-editor')
    expect(preview(CLIP)).not.toBeNull()
    await plugin.dispose()
    expect(runtime.slots.entries('dv.center.view')).toHaveLength(0)
    expect(runtime.slots.entries('dv.media.preview.action')).toHaveLength(0)
    await waitFor(() => { expect(view.getByTestId('center').textContent).toBe('') })
    expect(within(view.getByRole('dialog')).queryByRole('button', { name: /插入片段|Insert clip/ })).toBeNull()
    await runtime.dispose()
  })
})
