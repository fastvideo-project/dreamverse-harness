// @vitest-environment jsdom
/**
 * The shell plugin in a slot test runtime with stand-ins for the DSH layout, right panel and navigation services.
 */
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WireWorkspaces } from '@dv/ui-kit/types.ts'
import { DV_TRAJECTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'

const LINKS: WireWorkspaces = {
  entry_path: '/dv/entry',
  projects: [{ id: 'p1', title: 'Launch film', created_at: '2026-01-05T12:00:00Z', path: '/dv/p1', workspace_id: 'p1' }],
}

const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  window.sessionStorage.clear()
})

/**
 * Mount the shell plugin on fresh modules, with the DSH services it reaches stood in, and render its center, navigator
 * and brand.
 * @returns the runtime, the plugin, the shell store, and the recorded service calls.
 */
async function mountShell() {
  vi.resetModules()
  const json = (body: unknown, status = 200): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status }))
  const serverFetch: typeof fetch = (input) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host').pathname
    if (path === '/api/dv/workspaces') return json(LINKS)
    if (path === '/api/dv/projects/untitled') return json({ path: '/dv/DreamVerse/Untitled project' })
    if (path === '/api/dv/projects/summary') return json([])
    return json({ error: `no route ${path}` }, 404)
  }
  vi.stubGlobal('fetch', serverFetch)
  const { apply, inject } = await import('../src/client/index.ts')
  const { CHAT_ID, TRAJECTORY_ID } = await import('../src/client/tabs.tsx')
  const store = await import('../src/client/store.ts')
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)

  const openTab = vi.fn<(kind: string, options?: unknown) => void>()
  const mounted = createSnapshotStore<SessionId | undefined>(undefined)
  const openSession = vi.fn<(sessionId: SessionId) => void>()
  const setRightbar = vi.fn<(width: number) => void>()
  const archiveSession = vi.fn<(sessionId: SessionId) => Promise<void>>(() => Promise.resolve())
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  runtime.ctx.provide('sidebarRight', {
    openTab, isExpanded: () => false, toggleExpanded: () => {}, mounted, expanded: createSnapshotStore(false),
  } as never)
  runtime.ctx.provide('uiWorkspace', { openSession, archiveSession } as never)
  runtime.ctx.provide('locale', { dicts: new Map(), subscribe: () => () => {} } as never)
  runtime.ctx.provide('layout', {
    panels: { setRightbar }, beginNavigation: () => {}, selectPanel: () => {}, toggleSidebar: () => {},
  } as never)
  runtime.ctx.uiSession.provide({
    hooks: ['conversation'],
    resolve: () => ({ hooks: { conversation: createSnapshotStore<ConversationSnapshot>(EMPTY_CONVERSATION_SNAPSHOT) } }),
  })
  await runtime.sessions.add({ id: 'blank-entry', snapshot: { blank: true }, summary: { blank: true } })
  await runtime.sessions.add({ id: 'blank-p1', snapshot: { blank: true }, summary: { blank: true } })
  await runtime.workspaces.update((draft) => {
    draft.items = [
      { workspaceId: 'ws-entry' as WorkspaceId, path: '/dv/entry', title: 'DreamVerse', sessionIds: [], createdAt: '', updatedAt: '' },
      { workspaceId: 'p1' as WorkspaceId, path: '/dv/p1', title: 'Launch film', sessionIds: [], createdAt: '', updatedAt: '' },
    ]
  })
  await runtime.declare({
    'main.conversation': { kind: 'single', scope: 'session-maybe' },
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  })
  const shell = await runtime.mount({ inject: [...inject], apply })
  await waitFor(() => { expect(store.getShell().links).toEqual(LINKS) })
  return { runtime, shell, store, openTab, mounted, openSession, archiveSession, setRightbar, tabKeys: [CHAT_ID, TRAJECTORY_ID] }
}

/** Entry chats beside the blank entry chat: two started, one in `p1`'s Workspace, and one archived. */
const ENTRY_CHATS = [
  { id: 'chat-old', displayTitle: 'Old idea', updatedAt: 10 },
  { id: 'chat-new', displayTitle: 'New idea', updatedAt: 30 },
  { id: 'chat-bound', displayTitle: 'Bound idea', updatedAt: 40 },
  { id: 'chat-gone', displayTitle: 'Deleted idea', updatedAt: 50 },
]

/**
 * Mount the shell with entry chats in the entry Workspace, render the navigator, and let 首页 create `blank-entry`.
 * @param chats - the entry chats besides `blank-entry`.
 * @returns the bench and the rendered navigator.
 */
async function mountWithEntryChats(chats = ENTRY_CHATS) {
  const bench = await mountShell()
  for (const { id, ...summary } of chats) await bench.runtime.sessions.add({ id, summary })
  await bench.runtime.workspaces.update((draft) => {
    draft.items = draft.items.map(item => item.workspaceId === 'p1' ? { ...item, sessionIds: ['chat-bound' as SessionId] } : item)
    draft.archivedSessionIds = ['chat-gone' as SessionId]
  })
  bench.runtime.sessions.stubCreate(() => Promise.resolve('blank-entry' as SessionId))
  const navigator = bench.runtime.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })
  return { bench, navigator }
}

/** The labels of the navigator's 对话 rows, in order. */
function entryRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-dv-entry-chats] [role="button"]')].map(row => row.textContent)
}

/** The navigator's 对话 row labelled `title`. */
function entryRow(container: HTMLElement, title: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>('[data-dv-entry-chats] [role="button"]')].find(item => item.textContent === title)
  if (row === undefined) throw new Error(`no 对话 row ${title}`)
  return row
}

function focusTrajectory(detail: unknown): void {
  act(() => { window.dispatchEvent(new CustomEvent(DV_TRAJECTORY_FOCUS_EVENT, { detail })) })
}

describe('the navigator\'s 对话 section', () => {
  it('lists the started entry chats that no project holds, newest first, and a chat whose project\'s Workspace goes away', async () => {
    const { bench, navigator } = await mountWithEntryChats()
    const { container } = navigator
    await waitFor(() => { expect(entryRows(container)).toEqual(['New idea', 'Old idea']) })
    expect(within(container.querySelector<HTMLElement>('[data-dv-entry-chats]') ?? container).getByText('Chats')).toBeDefined()
    await act(async () => {
      await bench.runtime.workspaces.update((draft) => { draft.items = draft.items.filter(item => item.workspaceId !== 'p1') })
    })
    await waitFor(() => { expect(entryRows(container)).toEqual(['Bound idea', 'New idea', 'Old idea']) })
  })

  it('lists the newest 5 chats and the open one, and 全部对话 / 收起对话 show and hide the rest', async () => {
    const chats = Array.from({ length: 7 }, (_, index) => ({ id: `chat-${String(index)}`, displayTitle: `Idea ${String(index)}`, updatedAt: index + 10 }))
    const { bench, navigator } = await mountWithEntryChats(chats)
    const { container, view } = navigator
    await waitFor(() => { expect(entryRows(container)).toEqual(['Idea 6', 'Idea 5', 'Idea 4', 'Idea 3', 'Idea 2']) })
    act(() => { bench.store.setShell({ sessionId: 'chat-0' }) })
    expect(entryRows(container)).toEqual(['Idea 6', 'Idea 5', 'Idea 4', 'Idea 3', 'Idea 2', 'Idea 0'])
    fireEvent.click(view.getByRole('button', { name: 'All chats' }))
    expect(entryRows(container)).toEqual(['Idea 6', 'Idea 5', 'Idea 4', 'Idea 3', 'Idea 2', 'Idea 1', 'Idea 0'])
    fireEvent.click(view.getByRole('button', { name: 'Fewer chats' }))
    expect(entryRows(container)).toHaveLength(6)
  })

  it('opens a row\'s chat on the entry page, also from an open project', async () => {
    const { bench, navigator } = await mountWithEntryChats()
    act(() => { bench.store.setShell({ projectId: 'p1' }) })
    await waitFor(() => { expect(entryRows(navigator.container)).toContain('Old idea') })
    fireEvent.click(entryRow(navigator.container, 'Old idea'))
    await waitFor(() => { expect(bench.openSession).toHaveBeenLastCalledWith('chat-old') })
    expect(bench.store.getShell().projectId).toBeNull()
  })

  it('highlights the open chat\'s row, and 首页 only while the blank entry chat is open', async () => {
    const { bench, navigator } = await mountWithEntryChats()
    const home = navigator.view.getByRole('button', { name: 'Home' })
    act(() => { bench.store.setShell({ sessionId: 'blank-entry' }) })
    await waitFor(() => { expect(entryRows(navigator.container)).toHaveLength(2) })
    expect(home.hasAttribute('data-active')).toBe(true)
    expect(navigator.container.querySelector('[data-dv-entry-chats] [data-active]')).toBeNull()
    act(() => { bench.store.setShell({ sessionId: 'chat-new' }) })
    expect(entryRow(navigator.container, 'New idea').hasAttribute('data-active')).toBe(true)
    expect(home.hasAttribute('data-active')).toBe(false)
  })

  it('首页 opens this tab\'s blank chat while started entry chats exist', async () => {
    const { bench, navigator } = await mountWithEntryChats()
    act(() => { bench.store.setShell({ sessionId: 'chat-new' }) })
    fireEvent.click(navigator.view.getByRole('button', { name: 'Home' }))
    await waitFor(() => { expect(bench.openSession).toHaveBeenLastCalledWith('blank-entry') })
    expect(bench.openSession).not.toHaveBeenCalledWith('chat-new')
  })

  it('deleting the open entry chat archives it and opens the blank entry chat', async () => {
    const { bench, navigator } = await mountWithEntryChats()
    vi.stubGlobal('confirm', () => true)
    act(() => { bench.store.setShell({ sessionId: 'chat-new' }) })
    await waitFor(() => { expect(entryRows(navigator.container)).toContain('New idea') })
    const row = within(entryRow(navigator.container, 'New idea'))
    fireEvent.click(row.getByRole('button', { name: 'Conversation menu' }))
    fireEvent.click(row.getByRole('menuitem', { name: 'Delete chat' }))
    await waitFor(() => { expect(bench.openSession).toHaveBeenLastCalledWith('blank-entry') })
    expect(bench.archiveSession).toHaveBeenCalledWith('chat-new', { stopActivity: true })
  })

  it('is absent while the entry Workspace holds only blank chats', async () => {
    const { navigator } = await mountWithEntryChats([])
    await waitFor(() => { expect(navigator.view.getByRole('button', { name: 'Home' })).toBeDefined() })
    expect(navigator.container.querySelector('[data-dv-entry-chats]')).toBeNull()
    expect(navigator.view.queryByText('Chats')).toBeNull()
  })
})

describe('the shell plugin', () => {
  it('replaces DSH\'s center, navigator and brand, registers the right-panel tab bodies, and sets the panel width', async () => {
    const bench = await mountShell()
    const center = bench.runtime.renderSlot('main.conversation', {})
    expect(center.container.querySelector('[data-dv-entry]')).not.toBeNull()
    const navigator = bench.runtime.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })
    expect(navigator.view.getByRole('button', { name: 'Create project' })).toBeDefined()
    const brand = bench.runtime.renderSlot('sidebar.brand.name', {})
    expect(brand.view.getByRole('img', { name: 'DreamVerse' })).toBeDefined()
    const tabBodies = bench.runtime.slots.entries('sidebar.right.pane.tab').map(entry => entry.options.key)
    expect(tabBodies).toEqual(expect.arrayContaining(bench.tabKeys))
    expect(bench.setRightbar).toHaveBeenCalledWith(448)

    await bench.shell.dispose()
    expect(bench.runtime.slots.entries('main.conversation')).toEqual([])
    expect(bench.runtime.slots.entries('sidebar.right.pane.tab')).toEqual([])
  })

  it('starts DSH\'s New Session in the open project, as the entry page\'s blank chat in a fresh folder without one, and logs a failed start', async () => {
    const bench = await mountShell()
    const created: unknown[] = []
    let next = 'blank-entry'
    bench.runtime.sessions.stubCreate((options) => {
      created.push(options)
      return Promise.resolve(next as SessionId)
    })
    const startSession = (): void => { bench.runtime.ctx.uiWorkspace.startSession() }

    startSession()
    await waitFor(() => { expect(bench.openSession).toHaveBeenLastCalledWith('blank-entry') })
    act(() => { bench.store.setShell({ projectId: 'p1' }) })
    next = 'blank-p1'
    startSession()
    await waitFor(() => { expect(bench.openSession).toHaveBeenLastCalledWith('blank-p1') })
    expect(created).toEqual([{ cwd: '/dv/DreamVerse/Untitled project' }, { workspaceId: 'p1' }])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    bench.runtime.sessions.stubCreate(() => Promise.reject(new Error('create refused')))
    window.sessionStorage.clear()
    startSession()
    await waitFor(() => { expect(warn).toHaveBeenCalledWith('ui-shell: new session failed', expect.any(Error)) })

    await bench.shell.dispose()
    expect('startSession' in bench.runtime.ctx.uiWorkspace).toBe(false)
  })

  it('prepares the entry Workspace for DSH\'s first-use initialization while it is loaded', async () => {
    const bench = await mountShell()
    const workspaces = bench.runtime.ctx.workspaces
    const request = { directoryName: 'Default', title: 'Default' }
    await expect(workspaces.initializeDefault(request)).resolves.toMatchObject({ workspaceId: 'ws-entry' })
    await bench.shell.dispose()
    await expect(workspaces.initializeDefault(request)).resolves.toBeUndefined()
  })

  it('opens 轨迹 at the event\'s tool call once the event\'s session is mounted, moving the main session there first', async () => {
    const bench = await mountShell()
    const opened = (): unknown[] => bench.openTab.mock.calls.filter(([kind]) => kind === 'dv-trajectory').map(([, options]) => options)
    focusTrajectory(null)
    focusTrajectory({ session: 's1', toolCall: 7 })
    expect(opened()).toEqual([])

    act(() => { bench.mounted.set('s1' as SessionId) })
    focusTrajectory({ session: 's1', toolCall: 'c1' })
    expect(opened()).toEqual([{ params: { callId: 'c1' } }])

    focusTrajectory({ session: 's2', toolCall: 'c2' })
    expect(bench.openSession).toHaveBeenLastCalledWith('s2')
    act(() => { bench.mounted.set('s3' as SessionId) })
    expect(opened()).toHaveLength(1)
    act(() => { bench.mounted.set('s2' as SessionId) })
    expect(opened()).toEqual([{ params: { callId: 'c1' } }, { params: { callId: 'c2' } }])

    focusTrajectory({ session: 's3', toolCall: 'c3' })
    focusTrajectory({ session: 's4', toolCall: 'c4' })
    act(() => { bench.mounted.set('s3' as SessionId) })
    act(() => { bench.mounted.set('s4' as SessionId) })
    expect(opened().slice(2)).toEqual([{ params: { callId: 'c4' } }])

    focusTrajectory({ session: 's5', toolCall: 'c5' })
    await bench.shell.dispose()
    act(() => { bench.mounted.set('s5' as SessionId) })
    focusTrajectory({ session: 's5', toolCall: 'c6' })
    expect(opened()).toHaveLength(3)
  })
})
