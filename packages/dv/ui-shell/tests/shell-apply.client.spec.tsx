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
import type { WireProject } from '@dv/ui-kit/types.ts'
import { DV_TRAJECTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
import type { ShellActions } from '../src/client/actions.ts'

const PROJECTS: WireProject[] = [{ id: 'p1', title: 'Launch film', created_at: '2026-01-05T12:00:00Z', path: '/dv/p1' }]

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
  const server = { projects: PROJECTS, reads: 0, down: false }
  const serverFetch: typeof fetch = (input) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host').pathname
    if (path === '/api/dv/projects') {
      server.reads += 1
      return server.down ? json({ error: 'restarting' }, 503) : json(server.projects)
    }
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
  await waitFor(() => { expect(store.getShell().projects).toEqual(PROJECTS) })
  return { runtime, shell, store, server, openTab, mounted, openSession, archiveSession, setRightbar, tabKeys: [CHAT_ID, TRAJECTORY_ID] }
}

function focusTrajectory(detail: unknown): void {
  act(() => { window.dispatchEvent(new CustomEvent(DV_TRAJECTORY_FOCUS_EVENT, { detail })) })
}

describe('the project list', () => {
  it('reads the projects again at each Workspace feed change, and not after the plugin is disposed', async () => {
    const bench = await mountShell()
    const navigator = bench.runtime.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })
    const reads = bench.server.reads
    const added: WireProject = { id: 'p2', title: 'Music video', created_at: '2026-02-05T12:00:00Z', path: '/dv/p2' }
    bench.server.projects = [added, ...PROJECTS]
    await act(async () => {
      await bench.runtime.workspaces.update((draft) => {
        draft.items = [...draft.items, { workspaceId: 'p2' as WorkspaceId, path: '/dv/p2', title: 'Music video', sessionIds: [], createdAt: '', updatedAt: '' }]
      })
    })
    await waitFor(() => { expect(navigator.view.getByText('Music video')).toBeDefined() })
    expect(bench.server.reads).toBeGreaterThan(reads)
    expect(navigator.view.queryByText('Chats')).toBeNull()

    await bench.shell.dispose()
    const disposed = bench.server.reads
    await bench.runtime.workspaces.update((draft) => { draft.items = draft.items.filter(item => item.workspaceId !== 'p2') })
    expect(bench.server.reads).toBe(disposed)
  })

  it('reads the projects again after a failed read, with no further Workspace change', async () => {
    const bench = await mountShell()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    bench.server.down = true
    await act(async () => {
      await bench.runtime.workspaces.update((draft) => { draft.archivedSessionIds = ['blank-p1' as SessionId] })
    })
    await waitFor(() => { expect(warn).toHaveBeenCalledWith('ui-shell: project list read failed', expect.any(Error)) })
    const added: WireProject = { id: 'p2', title: 'Music video', created_at: '2026-02-05T12:00:00Z', path: '/dv/p2' }
    bench.server.projects = [added, ...PROJECTS]
    bench.server.down = false
    await waitFor(() => { expect(bench.store.getShell().projects).toEqual([added, ...PROJECTS]) }, { timeout: 4000 })
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

  it('opens a navigator chat of another project with that project, also one older than its latest chat, and a chat of the open project without reopening it', async () => {
    // Record the shell's openProject calls, so the test can tell a project switch from a chat switch in the open project.
    const openProject = vi.fn<ShellActions['openProject']>()
    vi.doMock('../src/client/actions.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/client/actions.ts')>()
      return {
        ...actual,
        createActions: (...args: Parameters<typeof actual.createActions>) => {
          const actions = actual.createActions(...args)
          openProject.mockImplementation((projectId, sessionId) => actions.openProject(projectId, sessionId))
          return { ...actions, openProject }
        },
      }
    })
    try {
      const bench = await mountShell()
      const project: WireProject = { id: 'p2', title: 'Music video', created_at: '2026-02-05T12:00:00Z', path: '/dv/p2' }
      bench.server.projects = [...PROJECTS, project]
      await bench.runtime.sessions.add({ id: 's2', summary: { displayTitle: 'Chorus', updatedAt: 2 } })
      await bench.runtime.sessions.add({ id: 's3', summary: { displayTitle: 'Finale', updatedAt: 3 } })
      await bench.runtime.workspaces.update((draft) => {
        draft.phase = 'ready'
        draft.items = [...draft.items, { workspaceId: 'p2' as WorkspaceId, path: '/dv/p2', title: 'Music video', sessionIds: ['s2' as SessionId, 's3' as SessionId], createdAt: '', updatedAt: '' }]
      })
      act(() => { bench.store.setShell({ projectId: 'p1' }) })
      const navigator = bench.runtime.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })
      await waitFor(() => { expect(navigator.view.getByText('Music video')).toBeDefined() })

      fireEvent.click(navigator.view.getByRole('button', { name: 'Show chats' }))
      fireEvent.click(navigator.view.getByText('Chorus'))
      await waitFor(() => { expect(bench.openSession).toHaveBeenLastCalledWith('s2') })
      expect(openProject).toHaveBeenCalledTimes(1)
      expect(openProject).toHaveBeenCalledWith('p2', 's2')
      expect(bench.store.getShell().projectId).toBe('p2')

      // A chat of the open project switches only the chat: openSession, and no openProject once pending work settles.
      bench.openSession.mockClear()
      openProject.mockClear()
      fireEvent.click(navigator.view.getByText('Finale'))
      await waitFor(() => { expect(bench.openSession).toHaveBeenCalledWith('s3') })
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) })
      expect(openProject).not.toHaveBeenCalled()
      expect(bench.store.getShell().projectId).toBe('p2')
    } finally {
      vi.doUnmock('../src/client/actions.ts')
    }
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

  it('makes the entry chat\'s folder a project before a send goes out, once for concurrent sends, and fails the send when that fails', async () => {
    const bench = await mountShell()
    const folder = '/dv/DreamVerse/Untitled project'
    await bench.runtime.sessions.add({ id: 'entry-chat', summary: { blank: true, cwd: folder } })
    await bench.runtime.sessions.add({ id: 'other-chat', summary: { blank: true, cwd: '/home/me' } })
    bench.runtime.sessions.stubCreate(() => Promise.resolve('entry-chat' as SessionId))
    bench.runtime.ctx.uiWorkspace.startSession()
    await waitFor(() => { expect(bench.openSession).toHaveBeenLastCalledWith('entry-chat') })
    const serverFetch = globalThis.fetch
    const creates: unknown[] = []
    let refuse = true
    vi.stubGlobal('fetch', ((input, init) => {
      if (input !== '/api/dv/projects' || init?.method !== 'POST') return serverFetch(input, init)
      creates.push(JSON.parse(init.body as string))
      const body = refuse ? { error: 'disk full' } : { id: 'p2', title: 'Untitled project', created_at: '', path: folder }
      return Promise.resolve(new Response(JSON.stringify(body), { status: refuse ? 500 : 200 }))
    }) satisfies typeof fetch)
    const send = (sessionId: string): Promise<void> => bench.runtime.ctx.serial('conversation/before-send', sessionId as SessionId)

    await expect(send('entry-chat')).rejects.toThrow('The project could not be created, so the message was not sent: disk full')
    refuse = false
    await Promise.all([send('entry-chat'), send('entry-chat')])
    await send('entry-chat')
    await send('other-chat')
    expect(creates).toEqual([{ folder, session: 'entry-chat' }, { folder, session: 'entry-chat' }])
  })

  it('opens the entry page\'s blank chat for DSH\'s first-use start, in one folder when 首页 runs at the same time, and creates no Workspace while it is loaded', async () => {
    const bench = await mountShell()
    const created: unknown[] = []
    bench.runtime.sessions.stubCreate((options) => {
      created.push(options)
      return Promise.resolve('blank-entry' as SessionId)
    })
    const workspaces = bench.runtime.ctx.workspaces
    const listed = workspaces.list.getSnapshot().items
    const request = { directoryName: 'Default', title: 'Default' }
    const firstUse = workspaces.initializeDefault(request)
    bench.runtime.ctx.uiWorkspace.startSession()
    await expect(firstUse).resolves.toBeUndefined()
    expect(bench.openSession).toHaveBeenLastCalledWith('blank-entry')
    expect(created).toEqual([{ cwd: '/dv/DreamVerse/Untitled project' }])
    expect(workspaces.list.getSnapshot().items).toEqual(listed)
    await bench.shell.dispose()
    await expect(workspaces.initializeDefault(request)).resolves.toBeUndefined()
    expect(created).toHaveLength(1)
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

describe('the navigator', () => {
  /** Mount the shell and give the project p1 one chat session, then render the navigator. */
  async function mountNavigator() {
    const bench = await mountShell()
    await bench.runtime.sessions.add({ id: 'c1', summary: { blank: false, displayTitle: 'Chat one', updatedAt: 1 } })
    await bench.runtime.workspaces.update((draft) => {
      draft.items = draft.items.map(item => item.workspaceId === 'p1' ? { ...item, sessionIds: ['c1' as SessionId] } : item)
    })
    const navigator = bench.runtime.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })
    return { bench, view: navigator.view }
  }

  it('toggles, opens and selects with Enter and Space on the caret, the project title and the chat row, and leaves keys typed inside the row alone', async () => {
    const { bench, view } = await mountNavigator()
    const caret = view.getByRole('button', { name: 'Show chats' })
    fireEvent.keyDown(caret, { key: 'Enter' })
    await waitFor(() => { expect(view.getByRole('button', { name: 'Hide chats' }).getAttribute('aria-expanded')).toBe('true') })
    fireEvent.keyDown(view.getByRole('button', { name: 'Hide chats' }), { key: ' ' })
    await waitFor(() => { expect(view.getByRole('button', { name: 'Show chats' }).getAttribute('aria-expanded')).toBe('false') })
    fireEvent.keyDown(view.getByRole('button', { name: 'Show chats' }), { key: 'a' })
    expect(view.queryByRole('button', { name: 'Hide chats' })).toBeNull()

    const title = view.getByTitle('Launch film')
    fireEvent.keyDown(title, { key: ' ' })
    await waitFor(() => { expect(bench.store.getShell().projectId).toBe('p1') })
    expect(view.getByRole('button', { name: 'Hide chats' })).toBeDefined()

    const row = view.getByTitle('Chat one').parentElement!
    fireEvent.keyDown(within(row).getByRole('button', { name: 'Conversation menu' }), { key: 'Enter' })
    expect(bench.openSession).toHaveBeenCalledTimes(1)
    bench.openSession.mockClear()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(bench.openSession).toHaveBeenLastCalledWith('c1')
  })

  it('lists every project after All projects, and the button then reads Show less', async () => {
    const bench = await mountShell()
    bench.server.projects = Array.from({ length: 13 }, (_, i): WireProject => ({
      id: `p${String(i + 1)}`, title: `Project ${String(i + 1)}`, created_at: `2026-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`, path: `/dv/p${String(i + 1)}`,
    }))
    await act(async () => { await bench.runtime.workspaces.update((draft) => { draft.items = [...draft.items] }) })
    await waitFor(() => { expect(bench.store.getShell().projects).toHaveLength(13) })
    const { view } = bench.runtime.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })
    expect(view.queryByTitle('Project 1')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'All projects' }))
    expect(view.getByTitle('Project 1')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: 'Show less' }))
    expect(view.queryByTitle('Project 1')).toBeNull()
  })

  it('shows the reason a failed action gave, clears it when a later action succeeds, and lets the person dismiss it', async () => {
    const { bench, view } = await mountNavigator()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const serverFetch = globalThis.fetch
    vi.stubGlobal('fetch', ((input, init) => {
      if (input === '/api/dv/projects' && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ error: 'disk full' }), { status: 500 }))
      return serverFetch(input, init)
    }) satisfies typeof fetch)
    fireEvent.click(view.getByRole('button', { name: 'Create project' }))
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't complete that: ")
    expect(alert.textContent).toContain('disk full')
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(view.queryByRole('alert')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'Create project' }))
    await view.findByRole('alert')
    bench.runtime.sessions.stubCreate(() => Promise.resolve('blank-p1' as SessionId))
    fireEvent.click(view.getByRole('button', { name: 'New chat' }))
    await waitFor(() => { expect(view.queryByRole('alert')).toBeNull() })
    expect(bench.store.getShell().projectId).toBe('p1')
  })
})
