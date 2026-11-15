// @vitest-environment jsdom
/**
 * The DreamVerse center in place of DSH's `main.conversation`, mounted in a slot test runtime. The real `@dv/ui-media`
 * and asset pool plugins mount beside it because their image and video views draw the project covers.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionFixture, SlotView } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { FactoryComponentPropsOf, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WireProject, WireProjectSummary } from '@dv/ui-kit/types.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import type { ShellActions } from '../src/client/actions.ts'

const PROJECTS: WireProject[] = [
  { id: 'p1', title: 'Launch film', created_at: '2026-01-05T12:00:00Z', path: '/dv/p1' },
  { id: 'p2', title: 'Music video', created_at: '2026-02-05T12:00:00Z', path: '/dv/p2' },
  { id: 'p3', title: 'Drama', created_at: '2026-03-05T12:00:00Z', path: '/dv/p3' },
]

const WORKSPACES = [
  { workspaceId: 'ws-plain', path: '/dv/plain', sessionIds: ['s0'] },
  { workspaceId: 'p1', path: '/dv/p1', sessionIds: ['s1', 's4'] },
  { workspaceId: 'p2', path: '/dv/p2', sessionIds: ['s2'] },
  { workspaceId: 'p3', path: '/dv/p3', sessionIds: [] },
]

const SESSIONS: SessionFixture[] = [
  { id: 's0', snapshot: { blank: true }, summary: { blank: true, updatedAt: 1 } },
  { id: 's1', summary: { displayTitle: 'Opening scene', updatedAt: 3 } },
  { id: 's2', summary: { displayTitle: 'Chorus', updatedAt: 2 } },
  { id: 's4', snapshot: { blank: true }, summary: { blank: true, updatedAt: 4 } },
  { id: 's5', summary: { displayTitle: 'Second take', updatedAt: 5 } },
]

interface Server {
  projects: WireProject[]
  summaries: WireProjectSummary[]
}

interface StandInShell {
  shell: ShellActions
  calls: string[]
  failures: Set<string>
  mounted: SnapshotStore<SessionId | undefined>
  expanded: SnapshotStore<boolean>
}

/**
 * Shell actions that record each call as `name(args)`; an action named in `failures` throws or rejects.
 * @param failures - the actions that fail.
 * @returns the actions and their records.
 */
function standInShell(failures: Set<string>): StandInShell {
  const calls: string[] = []
  const record = (name: string, ...args: Array<string | undefined>): void => {
    calls.push(`${name}(${args.filter(arg => arg !== undefined).join(',')})`)
    if (failures.has(name)) throw new Error(`${name} failed`)
  }
  const later = async (name: string, ...args: Array<string | undefined>): Promise<void> => {
    await Promise.resolve()
    record(name, ...args)
  }
  const mounted = createSnapshotStore<SessionId | undefined>(undefined)
  const expanded = createSnapshotStore(false)
  const shell: ShellActions = {
    newProject: () => later('newProject'),
    openProject: (projectId, sessionId) => later('openProject', projectId, sessionId),
    openSession: (sessionId) => { record('openSession', sessionId) },
    newSession: projectId => later('newSession', projectId),
    goHome: () => later('goHome'),
    openPage: (panelId) => { record('openPage', panelId) },
    renameProject: (projectId, title) => later('renameProject', projectId, title),
    deleteProject: projectId => later('deleteProject', projectId),
    renameSession: (sessionId, title) => later('renameSession', sessionId, title),
    deleteSession: sessionId => later('deleteSession', sessionId),
    showPanels: () => { record('showPanels') },
    hidePanels: () => { record('hidePanels') },
    collapseSidebar: () => { record('collapseSidebar') },
    restoreSidebar: () => { record('restoreSidebar') },
    mountedSeat: mounted,
    panelExpanded: expanded,
  }
  return { shell, calls, failures, mounted, expanded }
}

/**
 * A `fetch` that answers the shell's `/api/dv` reads from the server.
 * @param server - the answers.
 * @returns the fetch.
 */
function serverFetch(server: Server): typeof fetch {
  const json = (body: unknown, status = 200): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status }))
  return (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host')
    if (url.pathname === '/api/dv/projects') return json(server.projects)
    if (url.pathname === '/api/dv/projects/summary') return json(server.summaries)
    if (url.pathname === '/api/dv/state') return json({ components: {} })
    return json({ error: `no route ${url.pathname}` }, 404)
  }
}

function ComposerStandIn({ phase, sessionId, useFactorySlot }: FactoryComponentPropsOf<'conversation.content'>): ReactNode {
  const Views = useFactorySlot('views', () => null)
  const WidthControls = useFactorySlot('widthControls', () => <i data-testid="width-handles" />)
  return (
    <div data-testid="composer" data-phase={phase}>
      {sessionId === undefined ? null : <Views />}
      <WidthControls container={null} phase={phase} />
    </div>
  )
}

function ChatStandIn({ sessionId, view }: PropsRuntime<'conversation.session'> & { view?: string }): ReactNode {
  return <p data-testid="chat">{`${sessionId}:${view ?? 'stored'}`}</p>
}

function CenterViewStandIn({ projectId, session, fields, request }: PropsRuntime<'dv.center.view'>): ReactNode {
  return <p data-testid="center-view">{`${projectId}|${session ?? 'none'}|${JSON.stringify(fields)}|${JSON.stringify(request?.value ?? null)}`}</p>
}

interface MountOptions {
  hash?: string
  main?: string
  sessions?: SessionFixture[]
  activeTargets?: readonly string[]
  listsLoading?: boolean
  entries?: boolean
  failures?: readonly string[]
  projects?: WireProject[]
  summaries?: WireProjectSummary[]
  fakeTimers?: boolean
}

interface Bench {
  runtime: SlotTestRuntime
  store: typeof import('../src/client/store.ts')
  server: Server
  stand: StandInShell
  view: SlotView<'main.conversation'>
  show(sessionId: string | undefined): void
  refreshProjects(): Promise<void>
}

const runtimes: SlotTestRuntime[] = []
const retained: Disposable[] = []

afterEach(async () => {
  for (const reference of retained.splice(0)) reference[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  window.history.replaceState(null, '', '/')
})

/**
 * Load fresh shell modules for a page opened at `options.hash`, and render the center with its stand-ins.
 * @param options - how the page opens.
 * @returns the bench.
 */
async function mountCenter(options: MountOptions = {}): Promise<Bench> {
  window.history.replaceState(null, '', `/${options.hash ?? ''}`)
  vi.resetModules()
  const server: Server = {
    projects: options.projects ?? PROJECTS,
    summaries: options.summaries ?? [],
  }
  vi.stubGlobal('fetch', serverFetch(server))
  const store = await import('../src/client/store.ts')
  const { CenterPanel } = await import('../src/client/Center.tsx')
  const { followSlotTabs } = await import('../src/client/slot-tabs.ts')
  const { ActionFailureToast } = await import('../src/client/notice.tsx')
  const stand = standInShell(new Set(options.failures ?? []))
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)

  const active = new Set(options.activeTargets ?? [])
  runtime.ctx.uiSession.provide({
    hooks: ['conversation'],
    resolve: binding => ({
      hooks: {
        conversation: createSnapshotStore<ConversationSnapshot>(active.has(binding.sessionId)
          ? { ...EMPTY_CONVERSATION_SNAPSHOT, activeTargets: new Set(['chat']) }
          : EMPTY_CONVERSATION_SNAPSHOT),
      },
    }),
  })
  for (const fixture of [...SESSIONS, ...options.sessions ?? []]) await runtime.sessions.add(fixture)
  await runtime.workspaces.update((draft) => {
    draft.phase = options.listsLoading === true ? 'pending' : 'ready'
    draft.items = WORKSPACES.map(item => ({
      workspaceId: item.workspaceId as WorkspaceId, path: item.path, title: item.path, sessionIds: item.sessionIds as SessionId[],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }))
  })
  if (options.listsLoading === true) runtime.sessions.list.update((draft) => { draft.phase = 'pending' })

  await runtime.declare({ 'main.conversation': { kind: 'single', scope: 'session-maybe' }, 'shell.overlay': { kind: 'list', scope: 'root' } })
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount({
    inject: ['slots'],
    /** Register the stand-in composer, chat body and center, and the center view and explore entries. */
    apply(ctx: Context) {
      ctx.effect(() => ctx.slots.registerFactory({
        name: 'conversation.content',
        scope: 'session-maybe',
        children: {
          'conversation.session': { kind: 'single', scope: 'session' },
          'conversation.composer': { kind: 'chain', scope: 'session' },
          'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
          'conversation.input.dock': { kind: 'list', scope: 'session' },
          'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
          'conversation.hero.workspace': { kind: 'single', scope: 'root' },
          'conversation.hero.agentPreset': { kind: 'single', scope: 'session-maybe' },
        },
        inject: () => ({ selectWorkspace: () => Promise.resolve(), hooks: { composerBlock: createSnapshotStore(undefined) } }),
        locale: 'conversation',
        slots: { views: { scope: 'session' }, widthControls: { scope: 'root' } },
      }, ComposerStandIn), 'test: composer')
      ctx.effect(() => ctx.slots.inject('conversation.session', () => ctx.slots.register(
        { name: 'conversation.session' }, ChatStandIn,
      )), 'test: chat')
      ctx.effect(() => ctx.slots.register({
        name: 'main.conversation', priority: -1, inject: () => ({ shell: stand.shell }),
        children: { 'dv.explore': { kind: 'list', scope: 'root' }, 'dv.center.view': { kind: 'list', scope: 'root' } },
      }, CenterPanel), 'test: center')
      ctx.effect(() => ctx.slots.register({ name: 'shell.overlay', id: 'dv.shell.failure' }, ActionFailureToast), 'test: failure toast')
      if (options.entries !== false) {
        ctx.effect(() => ctx.slots.inject('dv.center.view', function* () {
          yield ctx.slots.register({ name: 'dv.center.view', id: 'canvas', order: 0, label: () => 'Canvas' }, CenterViewStandIn)
          yield ctx.slots.register({ name: 'dv.center.view', id: 'timeline', order: 1, label: () => 'Timeline' }, CenterViewStandIn)
        }), 'test: center views')
        ctx.effect(() => ctx.slots.inject('dv.explore', function* () {
          yield ctx.slots.register({ name: 'dv.explore', id: 'mcp', order: 0, label: () => 'MCP tools' }, () => <p>mcp body</p>)
          yield ctx.slots.register({ name: 'dv.explore', id: 'skills', order: 1, label: () => 'Skills' }, () => <p>skills body</p>)
        }), 'test: explore tabs')
      }
      followSlotTabs(ctx, 'dv.explore')
      followSlotTabs(ctx, 'dv.center.view')
    },
  })

  const reference = (sessionId: string | undefined) => {
    if (sessionId === undefined) return undefined
    const held = runtime.sessions.retain(sessionId as SessionId)
    retained.push(held)
    return held
  }
  if (options.fakeTimers === true) vi.useFakeTimers()
  const view = runtime.renderSlot('main.conversation', {}, { session: reference(options.main) })
  runtime.renderSlot('shell.overlay', {})
  return {
    runtime,
    store,
    server,
    stand,
    view,
    show(sessionId) { view.update({}, { session: reference(sessionId) }) },
    async refreshProjects() { await act(async () => { await store.refreshProjects() }) },
  }
}

/**
 * Move a session into a Workspace, as the host does when it attaches a chat to a project's Workspace.
 * @param bench - the bench.
 * @param sessionId - the session.
 * @param workspaceId - the Workspace that holds the session afterwards.
 */
async function attach(bench: Bench, sessionId: string, workspaceId: string): Promise<void> {
  await act(async () => {
    await bench.runtime.workspaces.update((draft) => {
      draft.items = draft.items.map((item) => {
        const others = item.sessionIds.filter(id => id !== sessionId)
        return { ...item, sessionIds: item.workspaceId === workspaceId ? [...others, sessionId as SessionId] : others }
      })
    })
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

/**
 * Dispatch the Back / Forward event for a URL hash, as the browser does after it moved the URL.
 * @param hash - the hash the browser moved to.
 */
function navigateTo(hash: string): void {
  act(() => {
    window.history.replaceState(null, '', `/${hash}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

describe('the entry page', () => {
  it('shows why a recent project did not open in the overlay toast, outside the grid, and drops it once another project opens', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bench = await mountCenter({ main: 's0', failures: ['openProject'], summaries: [{ project: 'p3', cover: null, edited_at: daysAgo(0) }] })
    await bench.refreshProjects()
    const recent = within(bench.view.view.getByRole('region', { name: 'Recent projects' }))
    fireEvent.click(await recent.findByRole('button', { name: /^Drama/u }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe("Couldn't complete that: openProject failed") })
    expect(bench.view.container.querySelector('[role="alert"]')).toBeNull()
    bench.stand.failures.delete('openProject')
    fireEvent.click(recent.getByRole('button', { name: /^Drama/u }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('greets a blank chat with the headline, the template chips, the recent projects and the explore tabs', async () => {
    const bench = await mountCenter({
      main: 's0',
      summaries: [
        { project: 'p3', cover: { asset: 'take3.mp4', mime: 'video/mp4' }, edited_at: daysAgo(0) },
        { project: 'p2', cover: { asset: 'poster2.png', mime: 'image/png' }, edited_at: daysAgo(1) },
        { project: 'p1', cover: null, edited_at: null },
      ],
    })
    await bench.refreshProjects()
    const page = bench.view.view
    expect(page.getByRole('heading', { level: 1 }).textContent).toBe('What are we making today?')
    expect(page.getByTestId('composer').getAttribute('data-phase')).toBe('active')
    expect(page.getByTestId('chat').textContent).toBe('s0:chat')
    expect(page.queryByTestId('width-handles')).toBeNull()
    expect(bench.stand.calls).toContain('restoreSidebar()')

    const templates = within(page.getByRole('region', { name: 'Start from a template' }))
    expect(templates.getAllByRole('button')).toHaveLength(9)
    expect(templates.getAllByRole('button', { pressed: false })).toHaveLength(9)
    fireEvent.click(templates.getByRole('button', { name: '3D animated short' }))
    expect(templates.getByRole('button', { name: '3D animated short', pressed: true })).toBeDefined()
    expect(page.queryByRole('combobox', { name: 'Video type' })).toBeNull()
    expect(page.queryByText('Coming soon')).toBeNull()

    const recent = within(page.getByRole('region', { name: 'Recent projects' }))
    const cards = (): string[] => recent.getAllByRole('button').map(button => button.textContent ?? '')
      .filter(text => text !== 'All projects' && text !== 'Show less')
    await waitFor(() => { expect(cards()[1]).toBe('Music videoYesterday') })
    expect(cards()[0]).toMatch(/^DramaToday \d\d:\d\d$/u)
    const drama = recent.getByRole('button', { name: /^Drama/u })
    const video = drama.querySelector('video')
    expect([video?.getAttribute('src'), video?.muted]).toEqual(['/dv/assets/take3.mp4#t=0.1', true])
    expect(drama.querySelector('img')).toBeNull()
    expect(drama.querySelector('span[title]')?.getAttribute('title')).toBe('Drama')
    const musicVideo = recent.getByRole('button', { name: /^Music video/u })
    expect(musicVideo.querySelector('img')?.getAttribute('src')).toBe('/dv/assets/poster2.png')
    expect(musicVideo.querySelector('video')).toBeNull()
    fireEvent.click(recent.getByRole('button', { name: 'All projects' }))
    expect(cards()).toHaveLength(3)
    expect(cards()[2]).toBe('Launch filmJan 5')
    expect(recent.getByRole('button', { name: /^Launch film/u }).querySelector('img, video')).toBeNull()
    fireEvent.click(recent.getByRole('button', { name: 'Show less' }))
    expect(cards()).toHaveLength(2)
    fireEvent.click(recent.getAllByRole('button')[1] as HTMLElement)
    await waitFor(() => { expect(bench.stand.calls).toContain('openProject(p3)') })

    const explore = within(page.getByRole('region', { name: 'Explore' }))
    expect(explore.getAllByRole('tab').map(tab => [tab.textContent, tab.getAttribute('aria-selected')]))
      .toEqual([['MCP tools', 'true'], ['Skills', 'false']])
    expect(explore.getByRole('tabpanel').textContent).toBe('mcp body')
    fireEvent.click(explore.getByRole('tab', { name: 'Skills' }))
    expect(explore.getByRole('tabpanel').textContent).toBe('skills body')
    fireEvent.click(explore.getByRole('button', { name: 'Show less' }))
    expect(explore.queryByRole('tablist')).toBeNull()
    fireEvent.click(explore.getByRole('button', { name: 'Show more' }))
    expect(explore.getByRole('tabpanel').textContent).toBe('skills body')
  })

  it('keeps the greeting until the chat runs, has a turn, or has an active target, and then shows the chat alone', async () => {
    const bench = await mountCenter({
      sessions: [
        { id: 'waiting', snapshot: { blank: false, awaitingFirstTurn: true } },
        { id: 'running', snapshot: { blank: true, running: true } },
        { id: 'targeted', snapshot: { blank: true } },
      ],
      activeTargets: ['targeted'],
    })
    const greeted = (): boolean => bench.view.view.queryByRole('heading', { level: 1 }) !== null
    const seen: Array<[string, boolean]> = [['none', greeted()]]
    for (const sessionId of ['s0', 'waiting', 'running', 's1', 'targeted']) {
      bench.show(sessionId)
      seen.push([sessionId, greeted()])
    }
    expect(seen).toEqual([['none', true], ['s0', true], ['waiting', true], ['running', false], ['s1', false], ['targeted', false]])
    expect(bench.view.view.queryByText('Coming soon')).toBeNull()
    expect(bench.view.container.querySelector('[data-dv-entry]')?.hasAttribute('data-blank')).toBe(false)
  })

  it('shows a settling composer while a started chat opens, and the greeting while a blank one opens', async () => {
    const bench = await mountCenter({
      main: 'opening',
      sessions: [
        { id: 'opening', snapshot: { openState: 'loading', blank: true } },
        { id: 'opening-blank', snapshot: { openState: 'loading', blank: true }, summary: { blank: true } },
      ],
    })
    expect(bench.view.view.getByTestId('composer').getAttribute('data-phase')).toBe('settling')
    expect(bench.view.view.queryByRole('heading', { level: 1 })).toBeNull()
    bench.show('opening-blank')
    expect(bench.view.view.getByTestId('composer').getAttribute('data-phase')).toBe('active')
    expect(bench.view.view.queryByRole('heading', { level: 1 })).not.toBeNull()
  })

  it('has no recent projects or explore section without projects and entries', async () => {
    const bench = await mountCenter({ main: 's0', entries: false, projects: [] })
    expect(bench.view.view.queryByRole('region', { name: 'Recent projects' })).toBeNull()
    expect(bench.view.view.queryByRole('region', { name: 'Explore' })).toBeNull()
    await bench.refreshProjects()
    expect(bench.view.view.queryByRole('region', { name: 'Recent projects' })).toBeNull()
    expect(bench.view.view.queryByRole('region', { name: 'Explore' })).toBeNull()
    expect(bench.view.view.getByRole('heading', { level: 1 })).toBeDefined()
  })

  it('collapses the right panel once the main session\'s seat mounts, and logs a seat that unbound meanwhile', async () => {
    const bench = await mountCenter({ main: 's0', failures: ['hidePanels'] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => { bench.stand.mounted.set('s9' as SessionId) })
    expect(bench.stand.calls).not.toContain('hidePanels()')
    act(() => { bench.stand.mounted.set('s0' as SessionId) })
    expect(bench.stand.calls).toContain('hidePanels()')
    expect(warn).toHaveBeenCalledWith('ui-shell: collapse right panel failed', expect.any(Error))
  })
})

describe('the URL restore', () => {
  it('opens the URL\'s project with its session once the lists are ready', async () => {
    const bench = await mountCenter({ hash: '#project=p1&view=timeline&timeline=t2&session=s1', main: 's1' })
    expect(bench.view.view.getByTestId('center-view').textContent).toBe('p1|none|{"timeline":"t2"}|null')
    expect(bench.stand.calls.filter(call => call.startsWith('openProject'))).toEqual([])
    await bench.refreshProjects()
    await waitFor(() => { expect(bench.stand.calls).toContain('openProject(p1,s1)') })
    expect(bench.view.view.getByTestId('center-view').textContent).toBe('p1|s1|{"timeline":"t2"}|null')
    expect(window.location.hash).toBe('#project=p1&view=timeline&timeline=t2&session=s1')
  })

  it('shows the entry page for a project the list does not have, and logs a failed navigation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bench = await mountCenter({ hash: '#project=gone&session=s0', main: 's0', failures: ['goHome'] })
    expect(bench.view.view.getByTitle('Switch chat or project').textContent).toContain('gone')
    await bench.refreshProjects()
    await waitFor(() => { expect(warn).toHaveBeenCalledWith('ui-shell: navigation failed', expect.any(Error)) })
    expect(bench.stand.calls).toContain('goHome()')
  })

  it('waits for the DSH session and Workspace lists', async () => {
    const bench = await mountCenter({ main: 's0', listsLoading: true })
    await bench.refreshProjects()
    await bench.runtime.workspaces.update((draft) => { draft.phase = 'ready' })
    expect(bench.stand.calls.filter(call => call.startsWith('goHome'))).toEqual([])
    act(() => { bench.runtime.sessions.list.update((draft) => { draft.phase = 'ready' }) })
    await waitFor(() => { expect(bench.stand.calls).toContain('goHome()') })
  })

  it('waits for DSH\'s startup session, and proceeds without one after the wait', async () => {
    const bench = await mountCenter({ fakeTimers: true })
    await bench.refreshProjects()
    await advance(3_999)
    expect(bench.stand.calls.filter(call => call.startsWith('goHome'))).toEqual([])
    await advance(1)
    expect(bench.stand.calls).toContain('goHome()')
  })
})

describe('Back, Forward, and an edited hash', () => {
  it('move the page to the location the URL names once the restore ran', async () => {
    const bench = await mountCenter({ hash: '#project=p1', main: 's1' })
    navigateTo('#project=p3')
    expect(bench.stand.calls.filter(call => call.startsWith('openProject'))).toEqual([])
    await bench.refreshProjects()
    await waitFor(() => { expect(bench.stand.calls).toContain('openProject(p3)') })
    const opened = (): string[] => bench.stand.calls.filter(call => call.startsWith('openProject') || call.startsWith('goHome'))

    navigateTo(bench.store.formatLocation(bench.store.locationOf(bench.store.getShell())))
    navigateTo('#project=p1&view=timeline&session=s1')
    expect(bench.view.view.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe('true')
    navigateTo('#project=p3')
    navigateTo('#project=p1&session=s4')
    navigateTo('#project=unknown')
    await waitFor(() => { expect(opened()).toEqual(['openProject(p3)', 'openProject(p3)', 'openProject(p1,s4)', 'goHome()']) })
  })
})

describe('the main session\'s project', () => {
  it('takes the center along when the host attaches the entry chat to a project\'s Workspace after the restore', async () => {
    const bench = await mountCenter({ main: 's0' })
    await bench.refreshProjects()
    await waitFor(() => { expect(bench.stand.calls).toContain('goHome()') })
    expect(bench.view.container.querySelector('[data-dv-entry]')).not.toBeNull()
    await attach(bench, 's0', 'p2')
    expect(bench.store.getShell().projectId).toBe('p2')
    expect(bench.view.view.getByTitle('Switch chat or project').textContent).toContain('Music video')
  })

  it('leaves the URL\'s project open when the main session\'s project resolves late or is the open project', async () => {
    const bench = await mountCenter({ hash: '#project=p1', main: 'elsewhere', sessions: [{ id: 'elsewhere' }] })
    await bench.refreshProjects()
    await waitFor(() => { expect(bench.stand.calls).toContain('openProject(p1)') })
    await attach(bench, 'elsewhere', 'p2')
    expect(bench.store.getShell().projectId).toBe('p1')
    await attach(bench, 'elsewhere', 'p1')
    expect(bench.store.getShell().projectId).toBe('p1')
  })
})

describe('the workspace', () => {
  it('shows the project and chat in the switcher, the view toggle, and the selected view of the project\'s session', async () => {
    const bench = await mountCenter({
      hash: '#project=p1&view=storyboard', main: 's1',
      summaries: [{ project: 'p1', cover: { asset: 'poster.png', mime: 'image/png' }, edited_at: null }],
    })
    await bench.refreshProjects()
    const page = bench.view.view
    expect(bench.stand.calls).toContain('collapseSidebar()')
    const switcher = page.getByTitle('Switch chat or project')
    expect(switcher.textContent).toBe('Launch film/Opening scene')
    await waitFor(() => { expect(switcher.querySelector('img')?.getAttribute('src')).toBe('/dv/assets/poster.png') })
    expect(page.getAllByRole('tab').map(tab => [tab.textContent, tab.getAttribute('aria-selected')]))
      .toEqual([['Canvas', 'true'], ['Timeline', 'false']])
    expect(page.getByTestId('center-view').textContent).toBe('p1|s1|{}|null')
    fireEvent.click(page.getByRole('tab', { name: 'Timeline' }))
    expect(bench.store.getShell().view).toBe('timeline')
    expect(page.getByRole('tab', { name: 'Timeline' }).getAttribute('data-active')).toBe('')
    act(() => { bench.store.showInCenter({ view: 'timeline', target: { timeline: 't3' } }) })
    expect(page.getByTestId('center-view').textContent).toBe('p1|s1|{}|{"timeline":"t3"}')
  })

  it('records no session for its views while the main session is another project\'s, and opens no panels for it', async () => {
    const bench = await mountCenter({ hash: '#project=p1', main: 's0' })
    await bench.refreshProjects()
    const page = bench.view.view
    expect(page.getByTitle('Switch chat or project').textContent).toBe('Launch film/New chat')
    expect(page.getByTestId('center-view').textContent).toBe('p1|none|{}|null')
    act(() => { bench.stand.mounted.set('s0' as SessionId) })
    fireEvent.click(page.getByRole('button', { name: 'Open the right panel' }))
    expect(bench.stand.calls).not.toContain('showPanels()')
  })

  it('shows no view while no plugin registers one', async () => {
    const bench = await mountCenter({ hash: '#project=p1', entries: false })
    expect(bench.view.view.queryAllByRole('tab')).toEqual([])
    expect(bench.view.view.queryByTestId('center-view')).toBeNull()
  })

  it('opens the panels once when the session\'s seat mounts, and offers the open button only while the panel is hidden', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bench = await mountCenter({ hash: '#project=p1', main: 's1' })
    await bench.refreshProjects()
    const panels = (): number => bench.stand.calls.filter(call => call === 'showPanels()').length
    act(() => { bench.stand.mounted.set('s1' as SessionId) })
    expect(panels()).toBe(1)
    act(() => { bench.stand.mounted.set(undefined) })
    act(() => { bench.stand.mounted.set('s1' as SessionId) })
    expect(panels()).toBe(1)

    const open = bench.view.view.getByRole('button', { name: 'Open the right panel' })
    fireEvent.click(open)
    expect(panels()).toBe(2)
    bench.stand.failures.add('showPanels')
    fireEvent.click(open)
    expect(warn).toHaveBeenCalledWith('ui-shell: open panels failed', expect.any(Error))
    act(() => { bench.stand.expanded.set(true) })
    expect(bench.view.view.queryByRole('button', { name: 'Open the right panel' })).toBeNull()
  })

  it('retries opening the panels on a timer and when the seat binds again, and gives up after 20 attempts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bench = await mountCenter({ hash: '#project=p1', main: 's1', failures: ['showPanels'], fakeTimers: true })
    await bench.refreshProjects()
    const panels = (): number => bench.stand.calls.filter(call => call === 'showPanels()').length
    act(() => { bench.stand.mounted.set('s1' as SessionId) })
    expect(panels()).toBe(1)
    await advance(250)
    expect(panels()).toBe(2)
    bench.stand.failures.delete('showPanels')
    act(() => {
      bench.stand.mounted.set(undefined)
      bench.stand.mounted.set('s1' as SessionId)
    })
    expect(panels()).toBe(3)
    await advance(1_000)
    expect(panels()).toBe(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('stops retrying once a timed attempt succeeds, and logs the failure after 20 failed attempts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bench = await mountCenter({
      hash: '#project=p1', main: 's1', failures: ['showPanels'], fakeTimers: true, sessions: [{ id: 's6' }],
    })
    await bench.refreshProjects()
    const panels = (): number => bench.stand.calls.filter(call => call === 'showPanels()').length
    act(() => { bench.stand.mounted.set('s1' as SessionId) })
    await advance(250)
    bench.stand.failures.delete('showPanels')
    await advance(250)
    expect(panels()).toBe(3)
    await advance(1_000)
    expect(panels()).toBe(3)

    bench.stand.failures.add('showPanels')
    await attach(bench, 's6', 'p1')
    bench.show('s6')
    act(() => { bench.stand.mounted.set('s6' as SessionId) })
    await advance(19 * 250)
    expect(panels()).toBe(23)
    expect(warn).toHaveBeenCalledWith('ui-shell: open chat tab failed', expect.any(Error))
    await advance(1_000)
    expect(panels()).toBe(23)
  })
})

describe('the session switcher', () => {
  it('goes home, creates a project, switches among the project\'s chats or starts one, and opens another project', async () => {
    const bench = await mountCenter({ hash: '#project=p1', main: 's4' })
    await attach(bench, 's5', 'p1')
    await bench.refreshProjects()
    const page = bench.view.view
    const switcher = page.getByTitle('Switch chat or project')
    expect(switcher.textContent).toBe('Launch film/New chat')
    const choose = async (name: string | RegExp, call: string): Promise<void> => {
      fireEvent.click(switcher)
      expect(switcher.getAttribute('aria-expanded')).toBe('true')
      fireEvent.click(page.getByRole(typeof name === 'string' ? 'menuitem' : 'menuitemradio', { name }))
      expect(page.queryByRole('menu')).toBeNull()
      await waitFor(() => { expect(bench.stand.calls.at(-1)).toBe(call) })
    }

    fireEvent.click(switcher)
    const menu = within(page.getByRole('menu'))
    expect(menu.getByText('Launch film · Chats')).toBeDefined()
    expect(menu.getAllByRole('menuitemradio').map(row => [row.textContent, row.getAttribute('aria-checked')]))
      .toEqual([['Second take', 'false'], ['New chat', 'true'], ['Opening scene', 'false']])
    expect(menu.getAllByRole('menuitem').map(item => item.textContent))
      .toEqual(['Home', 'Create project', 'New chat', 'Drama', 'Music video'])
    fireEvent.click(menu.getByRole('menuitemradio', { name: 'New chat' }))
    expect(page.queryByRole('menu')).toBeNull()
    expect(bench.stand.calls.filter(call => call.startsWith('openSession'))).toEqual([])

    await choose(/Opening scene/u, 'openSession(s1)')
    await choose('Home', 'goHome()')
    await choose('Create project', 'newProject()')
    await choose('New chat', 'newSession(p1)')
    await choose('Drama', 'openProject(p3)')
  })

  it('closes on a click outside it and on Escape, which returns the focus to the button', async () => {
    const bench = await mountCenter({ hash: '#project=p1', main: 's1', projects: PROJECTS.slice(0, 1) })
    await bench.refreshProjects()
    const page = bench.view.view
    const switcher = page.getByTitle('Switch chat or project')
    fireEvent.click(switcher)
    expect(page.queryByText('Other projects')).toBeNull()
    fireEvent.mouseDown(page.getByRole('menu'))
    expect(page.queryByRole('menu')).not.toBeNull()
    fireEvent.mouseDown(document.body)
    expect(page.queryByRole('menu')).toBeNull()

    fireEvent.click(switcher)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(page.queryByRole('menu')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(page.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(switcher)
  })

  it('logs a failed navigation and leaves the page as it was', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bench = await mountCenter({ hash: '#project=p1', main: 's1', failures: ['goHome'] })
    fireEvent.click(bench.view.view.getByTitle('Switch chat or project'))
    fireEvent.click(bench.view.view.getByRole('menuitem', { name: 'Home' }))
    await waitFor(() => { expect(warn).toHaveBeenCalledWith('ui-shell: navigation failed', expect.any(Error)) })
    expect(bench.store.getShell().projectId).toBe('p1')
    expect(screen.getByRole('alert').textContent).toBe("Couldn't complete that: goHome failed")
  })

  it('shows the reason in the overlay toast, which outlives the workspace that reported it, until a later action succeeds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bench = await mountCenter({ hash: '#project=p1', main: 's1', failures: ['goHome'] })
    const page = bench.view.view
    const choose = (name: string): void => {
      fireEvent.click(page.getByTitle('Switch chat or project'))
      fireEvent.click(page.getByRole('menuitem', { name }))
    }
    choose('Home')
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('goHome failed') })
    expect(bench.view.container.querySelector('[role="alert"]')).toBeNull()
    act(() => { bench.store.setShell({ projectId: null }) })
    expect(page.queryByTitle('Switch chat or project')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('goHome failed')
    act(() => { bench.store.setShell({ projectId: 'p1' }) })
    bench.stand.failures.delete('goHome')
    choose('Home')
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })
})
