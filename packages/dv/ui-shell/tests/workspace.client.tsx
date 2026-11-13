/**
 * The DreamVerse workspace with the real shell, ui-timeline and ui-canvas plugins over a scripted `/api/dv` server.
 * Projects p1 and p2 each hold timelines t1 and t2; the center renders in p1's chat session s1, and the timeline tab
 * body, which shows the newest project p2, renders beside it in the same session. The page language is Chinese.
 */
import { act, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SlotView } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { TimelineId } from '@dv/timeline/types'
import type { CenterTarget } from '@dv/ui-shell/contract'
import type { WireProject } from '@dv/ui-kit/types.ts'
import { fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'

const PROJECTS: WireProject[] = [
  { id: 'p2', title: 'Music video', created_at: '2026-02-05T12:00:00Z', path: '/dv/p2' },
  { id: 'p1', title: 'Launch film', created_at: '2026-01-05T12:00:00Z', path: '/dv/p1' },
]

/** A mounted workspace and what the tests drive and read. */
export interface Workspace {
  runtime: SlotTestRuntime
  center: SlotView<'main.conversation'>
  /** The timeline tab body. */
  tab: SlotView<'sidebar.right.pane.tab'>
  /** The query fields of the summary requests, in order. */
  summaries: Array<Record<string, string>>
  /** Call `dvCenter.show`, as History does for a selected record. */
  show(target: CenterTarget): void
  hash(): string
}

const runtimes: SlotTestRuntime[] = []
const retained: Disposable[] = []

/** Release what {@link mountWorkspace} created and reset the page. */
export async function releaseWorkspaces(): Promise<void> {
  for (const reference of retained.splice(0)) reference[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
  vi.resetModules()
  window.history.replaceState(null, '', '/')
  window.sessionStorage.clear()
  window.localStorage.clear()
  document.documentElement.lang = ''
}

/**
 * Load fresh plugin modules for a page opened at `hash`, mount the shell, timeline, canvas and shot render plugins, and
 * render the center and the timeline tab body in session s1.
 * @param hash - the URL hash the page loads with.
 * @returns the workspace.
 */
export async function mountWorkspace(hash: string): Promise<Workspace> {
  window.history.replaceState(null, '', `/${hash}`)
  document.documentElement.lang = 'zh-CN'
  vi.resetModules()
  const state = fixtureState()
  state.components.timeline.timelines.push({ id: 't2' as TimelineId, name: '片尾', clips: [], sounds: [], sound_track_names: [], video_muted: false, muted_sound_tracks: [] })
  const { fetch } = scriptedFetch({ state, projects: PROJECTS })
  const summaries: Array<Record<string, string>> = []
  const json = (body: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', ((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host')
    if (url.pathname === '/api/dv/projects/summary') {
      summaries.push(Object.fromEntries(url.searchParams))
      return json([])
    }
    return fetch(input, init)
  }) satisfies typeof globalThis.fetch)
  // The canvas holds its agent stream open; jsdom has no EventSource, and no test here sends on that stream.
  vi.stubGlobal('EventSource', class extends EventTarget { close(): void {} })
  const shell = await import('../src/client/index.ts')
  const timeline = await import('../../ui-timeline/src/client/index.ts')
  const canvas = await import('../../ui-canvas/src/client/index.ts')
  const shotRender = await import('../../ui-shot-render/src/client/index.ts')
  const { TIMELINE_ID } = await import('../../ui-timeline/src/client/definition.ts')

  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  runtime.ctx.provide('sidebarRight', {
    openTab: () => {}, isExpanded: () => true, toggleExpanded: () => {},
    mounted: createSnapshotStore<SessionId | undefined>(undefined), expanded: createSnapshotStore(true),
  } as never)
  runtime.ctx.provide('uiWorkspace', { openSession: () => {} } as never)
  runtime.ctx.provide('layout', {
    panels: { setRightbar: () => {} }, beginNavigation: () => {}, selectPanel: () => {}, toggleSidebar: () => {},
  } as never)
  runtime.ctx.uiSession.provide({
    hooks: ['conversation'],
    resolve: () => ({ hooks: { conversation: createSnapshotStore<ConversationSnapshot>(EMPTY_CONVERSATION_SNAPSHOT) } }),
  })
  await runtime.sessions.add({ id: 's1', summary: { displayTitle: 'Opening scene', updatedAt: 3 } })
  await runtime.sessions.add({ id: 's2', summary: { displayTitle: 'Chorus', updatedAt: 2 } })
  await runtime.workspaces.update((draft) => {
    draft.phase = 'ready'
    draft.items = [
      { workspaceId: 'ws-entry' as WorkspaceId, path: '/dv/entry', title: 'DreamVerse', sessionIds: [], createdAt: '', updatedAt: '' },
      { workspaceId: 'p1' as WorkspaceId, path: '/dv/p1', title: 'Launch film', sessionIds: ['s1' as SessionId], createdAt: '', updatedAt: '' },
      { workspaceId: 'p2' as WorkspaceId, path: '/dv/p2', title: 'Music video', sessionIds: ['s2' as SessionId], createdAt: '', updatedAt: '' },
    ]
  })
  await runtime.declare({
    'main.conversation': { kind: 'single', scope: 'session-maybe' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  })
  await runtime.mount({ inject: [...shell.inject], apply: shell.apply })
  await runtime.mount({ inject: [...timeline.inject], apply: timeline.apply })
  await runtime.mount({ inject: [...canvas.inject], apply: canvas.apply })
  await runtime.mount({ inject: [...shotRender.inject], apply: shotRender.apply })
  const session = runtime.sessions.retain('s1' as SessionId)
  retained.push(session)
  const center = runtime.renderSlot('main.conversation', {}, { session })
  const tab = runtime.renderSlot('sidebar.right.pane.tab', {}, { session, entryKey: TIMELINE_ID, hookContext: {} })
  return {
    runtime, center, tab, summaries,
    show(target) { act(() => { runtime.ctx.dvCenter.show(target) }) },
    hash: () => decodeURIComponent(window.location.hash),
  }
}

/**
 * The timeline editor inside a part of the page, once it shows a project's timelines.
 * @param part - the center or the tab body.
 * @returns the editor.
 */
export function timelineEditor(part: SlotView<'main.conversation' | 'sidebar.right.pane.tab'>): Promise<HTMLElement> {
  return waitFor(() => part.view.getByTestId('dv-timeline-editor'))
}

/**
 * @param editor - a timeline editor.
 * @returns the names of its timeline tabs, the selected one marked with `*`.
 */
export function timelineTabs(editor: HTMLElement): string[] {
  return within(editor).getAllByRole('tab').map(tab => `${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}${tab.textContent ?? ''}`)
}
