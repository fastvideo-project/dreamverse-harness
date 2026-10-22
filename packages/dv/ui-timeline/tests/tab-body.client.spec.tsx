// @vitest-environment jsdom
/**
 * The timeline plugin's right-Sidebar tab body under the real slot runtime, drawn in a chat session as the right Sidebar
 * draws it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { TimelineId } from '@dv/timeline/types'
import { fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import { TIMELINE_ID } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'

const SLOTS = {
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
} as const

type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

const runtimes: SlotTestRuntime[] = []
const sessions: Disposable[] = []

afterEach(async () => {
  cleanup()
  for (const session of sessions.splice(0)) session[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
})

/** Mount the timeline plugin and draw its tab body in chat session s5 in Chinese, with `fetch` answering `/api/dv`. */
async function mount(fetch: typeof globalThis.fetch) {
  vi.stubGlobal('fetch', fetch)
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  const reference: { current: SessionReference | undefined } = { current: undefined }
  await runtime.root.declare(SLOTS, ({ renderSlot, SessionProvider }: FrameProps) => (
    reference.current === undefined
      ? null
      : (
        <SessionProvider session={reference.current}>
          <div data-testid="tab">{renderSlot('sidebar.right.pane.tab', {}, { entryKey: TIMELINE_ID, hookContext: {} as never })}</div>
        </SessionProvider>
      )
  ))
  await runtime.mount({ inject: [...inject], apply })
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
  const view = runtime.renderRoot()
  return within(view.getByTestId('tab'))
}

async function mountScripted(routes: ScriptedRoutes = {}) {
  const { fetch, writes } = scriptedFetch(routes)
  return { tab: await mount(fetch), writes }
}

describe('timeline tab body', () => {
  it('reads the newest project, then shows its timeline editor under the project bar, where a picked tab is selected', async () => {
    const state = fixtureState()
    state.components.timeline.timelines.push({ id: 't2' as TimelineId, name: '片尾', clips: [] })
    const { tab } = await mountScripted({ state })
    expect(tab.getByText('正在读取…')).toBeTruthy()
    const editor = await tab.findByTestId('dv-timeline-editor')
    expect(tab.getByTestId('dv-timeline-body').firstElementChild?.textContent).toContain('项目')
    const tabs = (): Array<string | null> => within(editor).getAllByRole('tab').map(entry => entry.getAttribute('aria-selected'))
    await waitFor(() => { expect(tabs()).toEqual(['true', 'false']) })
    fireEvent.click(within(editor).getByRole('tab', { name: '片尾' }))
    expect(tabs()).toEqual(['false', 'true'])
  })

  it('tells that there is no project yet', async () => {
    const { tab } = await mountScripted({ projects: [] })
    await waitFor(() => { expect(tab.getByText('还没有项目。在对话里让智能体新建一个项目。')).toBeTruthy() })
  })

  it('shows a failed state read as an alert', async () => {
    const { fetch } = scriptedFetch()
    const tab = await mount((input, init) => input === '/api/dv/state?project=p1'
      ? Promise.resolve(new Response(JSON.stringify({ error: 'no state' }), { status: 500 }))
      : fetch(input, init))
    await waitFor(() => { expect(tab.getByRole('alert').textContent).toBe('失败：no state') })
  })

  it('shows a failed write as a notice above the editor', async () => {
    const { tab, writes } = await mountScripted({ post: () => ({ status: 500, body: { error: 'busy' } }) })
    const editor = await tab.findByTestId('dv-timeline-editor')
    fireEvent.click(within(editor).getByText('＋ 新建'))
    await waitFor(() => { expect(tab.getByRole('alert').textContent).toBe('失败：busy') })
    expect(writes.map(write => write.path)).toEqual(['/api/dv/operation'])
  })
})
