/**
 * Navigation the DreamVerse shell performs through DSH services. The shell's open project decides the center, and the
 * DSH main session follows it: opening a project moves the main session to that project's latest chat session, or to a
 * blank session in the project's Workspace when it has none, so the right panel (对话 / 素材库 / 历史) always belongs to
 * the project in the center. The actions also create, rename, and delete projects and chat sessions, and fold DSH's
 * left sidebar and right panel.
 *
 * @module @dv/ui-shell/actions
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { pickText } from '@dv/ui-kit/locale.ts'
import { createSidebarFold } from './sidebar.ts'
import { getShell, markSessionChoice, refreshProjects, setShell, shellClient } from './store.ts'

/** The right-panel kind of the asset pool tab that `@dv/ui-asset-pool` registers. */
export const ASSET_POOL_KIND = 'dv-asset-pool'

/** The right-panel kind of the History tab that `@dv/ui-history` registers. */
export const HISTORY_KIND = 'dv-history'

/** Milliseconds to wait for the DSH session and Workspace lists before choosing a session from them anyway. */
const LIST_READY_TIMEOUT_MS = 5000

/** The `sessionStorage` key prefix of the blank session this tab created in a Workspace. */
const TAB_BLANK_KEY = 'dv-shell.tab-blank'

/** The {@link TAB_BLANK_KEY} suffix of this tab's blank entry chat, whose folder belongs to no Workspace yet. */
const UNTITLED_KEY = 'untitled'

/** The actions the shell components receive through their DSH UI slot registrations. */
export interface ShellActions {
  /** Create a project (the host registers its Workspace), then open a chat session in it. */
  newProject(minimaxSkill?: string | null): Promise<void>
  /**
   * Open a project and move the main session into it: `sessionId` when it belongs to the project, else the main session
   * when it is a non-blank session of the project, else the project's latest non-blank chat session, else a blank one.
   */
  openProject(projectId: string, sessionId?: string): Promise<void>
  /** Open one chat session of the open project. */
  openSession(sessionId: string): void
  /** Start a chat session in the project's Workspace. */
  newSession(projectId: string): Promise<void>
  /**
   * Show the entry page: this browser tab's blank entry chat while it is still blank and in no Workspace, else a new
   * chat in a fresh folder of the DreamVerse folder.
   */
  goHome(): Promise<void>
  /** Open a DSH sidebar page (Plugins, MCP, or another `sidebar.panellist` entry) in the main column. */
  openPage(panelId: string): void
  /** Store a unique project title; the host sets it as the project's Workspace title. */
  renameProject(projectId: string, title: string): Promise<void>
  /** Remove a project (the host unregisters its Workspace and keeps its folder), and leave it when it is open. */
  deleteProject(projectId: string): Promise<void>
  /** Rename a chat session. */
  renameSession(sessionId: string, title: string): Promise<void>
  /**
   * Archive a chat session and, when it was open, move to the open project's latest other session, or to this browser
   * tab's blank entry chat when no project is open.
   */
  deleteSession(sessionId: string): Promise<void>
  /** Expand the right panel and open 对话, 素材库, and 历史, with 对话 in front. Throws while no session seat is mounted. */
  showPanels(): void
  /** Collapse the right panel of the mounted session. */
  hidePanels(): void
  /**
   * Collapse DSH's left sidebar when it is expanded, remembering that the shell collapsed it. Takes effect at once for
   * a following collapse or restore, before DSH's frame renders the fold.
   */
  collapseSidebar(): void
  /** Expand DSH's left sidebar when the shell collapsed it and the user has not folded or unfolded it from DSH's rail since. */
  restoreSidebar(): void
  /** The session whose right-panel seat is mounted, observed by the center. */
  mountedSeat: { getSnapshot(this: void): SessionId | undefined; subscribe(this: void, fn: () => void): () => void }
  /** Whether the right panel is expanded, observed by the center to show its open button only while it is hidden. */
  panelExpanded: { getSnapshot(this: void): boolean; subscribe(this: void, fn: () => void): () => void }
}

/**
 * Wait until a DSH list has loaded once, or until the timeout passes.
 * @param source - the list store.
 * @returns a promise that settles when the list is ready or the wait timed out.
 */
function whenReady(source: { getSnapshot(): { phase: string }; subscribe(listener: () => void): () => void }): Promise<void> {
  return new Promise((resolve) => {
    if (source.getSnapshot().phase === 'ready') { resolve(); return }
    let stop = (): void => {}
    const done = (): void => { clearTimeout(timer); stop(); resolve() }
    const timer = setTimeout(done, LIST_READY_TIMEOUT_MS)
    stop = source.subscribe(() => { if (source.getSnapshot().phase === 'ready') done() })
  })
}

/**
 * Build the shell actions over the client services.
 * @param ctx - the client root context with `workspaces`, `sessions`, `uiWorkspace`, and `sidebarRight`.
 * @returns the actions.
 */
export function createActions(ctx: ClientContext): ShellActions {
  /**
   * The project's chat sessions that are not archived, newest first: the sessions of its Workspace.
   * @param workspaceId - the project's Workspace.
   * @returns each session with whether it is blank.
   */
  const projectSessions = async (workspaceId: WorkspaceId): Promise<Array<{ id: string; updatedAt: number; blank: boolean }>> => {
    await Promise.all([whenReady(ctx.sessions.list), whenReady(ctx.workspaces.list)])
    const workspace = ctx.workspaces.list.getSnapshot()
    const sessions = ctx.sessions.list.getSnapshot()
    const archived = new Set<string>(workspace.archivedSessionIds)
    return (workspace.items.find(item => item.workspaceId === workspaceId)?.sessionIds ?? [])
      .flatMap((id) => {
        const summary = sessions.byId[id]
        return summary === undefined || archived.has(id) ? [] : [{ id, updatedAt: summary.updatedAt, blank: summary.blank }]
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Blank sessions this browser tab created, by Workspace or {@link UNTITLED_KEY}, kept in `sessionStorage` so a reload
   * reuses them.
   */
  const tabBlanks = {
    get(workspaceId: string): SessionId | undefined {
      try {
        return (window.sessionStorage.getItem(`${TAB_BLANK_KEY}:${workspaceId}`) ?? undefined) as SessionId | undefined
      } catch (_error: unknown) {
        // Storage is blocked; the tab creates another blank session.
        return undefined
      }
    },
    set(workspaceId: string, sessionId: SessionId): void {
      try {
        window.sessionStorage.setItem(`${TAB_BLANK_KEY}:${workspaceId}`, sessionId)
      } catch (_error: unknown) {
        // Storage is blocked; the blank session stays usable for this page load only.
      }
    },
  }

  /**
   * Open a blank chat session in a Workspace that belongs to this browser tab: the blank session this tab created
   * there earlier while it is still blank, else a new one. DSH's own
   * `openWorkspace` reuses any blank session of the Workspace, so two tabs would share one and see each other's chat.
   * @param workspaceId - the Workspace.
   * @param stillWanted - whether the navigation that asked for the session is still current.
   */
  const openBlank = async (workspaceId: WorkspaceId, stillWanted: () => boolean): Promise<void> => {
    const sessions = ctx.sessions.list.getSnapshot()
    const sessionIds = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)?.sessionIds ?? []
    const blankHere = (id: string | undefined): id is SessionId =>
      id !== undefined && sessions.byId[id as SessionId]?.blank === true && sessionIds.includes(id as SessionId)
    const reused = tabBlanks.get(workspaceId)
    const sessionId = blankHere(reused) ? reused : await ctx.sessions.create({ workspaceId })
    tabBlanks.set(workspaceId, sessionId)
    if (!stillWanted() || getShell().sessionId === sessionId) return
    showSession(sessionId)
  }

  /**
   * Move the DSH main session. DSH's startup restore of its last session runs as a pending layout navigation and
   * would replace a session the shell opened before it finished; starting a navigation first cancels it.
   * @param sessionId - the session.
   */
  const showSession = (sessionId: SessionId): void => {
    ctx.get('layout')?.beginNavigation()
    ctx.uiWorkspace.openSession(sessionId)
  }

  // A DSH sidebar page (Plugins, MCP) replaces the shell's center while it is selected; every shell navigation closes it,
  // also when the navigation keeps the main session (首页 from a page opened on the entry page).
  const leavePage = (): void => {
    ctx.get('layout')?.selectPanel(null)
  }

  const openSession = (sessionId: string): void => {
    leavePage()
    markSessionChoice()
    showSession(sessionId as SessionId)
  }

  // Concurrent 首页 calls (DSH's first-use start and the URL restore) share one entry chat, so they make one folder.
  let entryChat: Promise<void> | undefined
  const goHome = async (): Promise<void> => {
    leavePage()
    setShell({ projectId: null })
    entryChat ??= openEntryChat().finally(() => { entryChat = undefined })
    await entryChat
  }

  /** Show this tab's blank entry chat, made in a fresh folder of the DreamVerse folder when it has none. */
  const openEntryChat = async (): Promise<void> => {
    await Promise.all([whenReady(ctx.sessions.list), whenReady(ctx.workspaces.list)])
    if (getShell().projectId !== null) return
    const sessions = ctx.sessions.list.getSnapshot()
    const workspaces = ctx.workspaces.list.getSnapshot().items
    const reused = tabBlanks.get(UNTITLED_KEY)
    const reusable = reused !== undefined && sessions.byId[reused]?.blank === true
      && !workspaces.some(item => item.sessionIds.includes(reused))
    let entry = reusable ? reused : undefined
    if (entry === undefined) {
      const { path } = await shellClient.untitledFolder(pickText('未命名项目', 'Untitled project'))
      entry = await ctx.sessions.create({ cwd: path })
      tabBlanks.set(UNTITLED_KEY, entry)
    }
    if (getShell().projectId === null && entry !== getShell().sessionId) showSession(entry)
  }

  // This tab's entry chat makes its folder a project before its first message reaches the host, so the first prompt and
  // the first tool call already see the project. A send during the creation waits for it; a failed creation fails the
  // send, and the next send tries again.
  const chatProjects = new Map<SessionId, Promise<void>>()
  ctx.on('conversation/before-send', (sessionId) => {
    const folder = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    const attached = ctx.workspaces.list.getSnapshot().items.some(item => item.sessionIds.includes(sessionId))
    if (sessionId !== tabBlanks.get(UNTITLED_KEY) || folder === undefined || attached) return Promise.resolve()
    const creating = chatProjects.get(sessionId) ?? shellClient.createChatProject(folder, sessionId, getShell().minimaxSkill ?? null).then(
      () => { setShell({ minimaxSkill: null }) },
      (error: unknown) => {
        chatProjects.delete(sessionId)
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(pickText(`项目创建失败，消息未发送：${reason}`, `The project could not be created, so the message was not sent: ${reason}`))
      },
    )
    chatProjects.set(sessionId, creating)
    return creating
  })

  const openProject = async (projectId: string, sessionId?: string): Promise<void> => {
    leavePage()
    setShell({ projectId })
    const workspaceId = projectId as WorkspaceId
    const sessions = await projectSessions(workspaceId)
    // A later navigation superseded this one while the lists loaded.
    if (getShell().projectId !== projectId) return
    const current = getShell().sessionId
    const currentRow = sessions.find(row => row.id === current)
    const wanted = sessionId === undefined ? undefined : sessions.find(row => row.id === sessionId)
    const latest = wanted ?? (currentRow?.blank === false ? currentRow : undefined) ?? sessions.find(row => !row.blank) ?? currentRow
    if (latest !== undefined) {
      if (latest.id !== current) showSession(latest.id as SessionId)
      return
    }
    await openBlank(workspaceId, () => getShell().projectId === projectId)
  }

  // The left sidebar fold: the open workspace collapses it, and 首页 expands it again.
  const sidebar = createSidebarFold(() => {
    const layout = ctx.get('layout')
    layout?.toggleSidebar()
    return layout !== undefined
  })
  ctx.effect(() => () => { sidebar.dispose() }, 'ui-shell: left sidebar fold observer')

  const showPanels = (): void => {
    // 对话 opens first so it leads the tab strip, then 素材库 and 历史; reopening 对话 brings it to the front. 轨迹 opens
    // only from the right-panel guide.
    ctx.sidebarRight.openTab('dv-chat')
    ctx.sidebarRight.openTab(ASSET_POOL_KIND)
    ctx.sidebarRight.openTab(HISTORY_KIND)
    ctx.sidebarRight.openTab('dv-chat')
  }

  return {
    async newProject(minimaxSkill) {
      if (minimaxSkill === undefined) {
        setShell({ createProjectOpen: true, minimaxSkill: null })
        return
      }
      leavePage()
      const created = await shellClient.createProject(pickText('未命名项目', 'Untitled project'), 'canvas', minimaxSkill)
      await refreshProjects()
      setShell({ projectId: created.id, view: 'canvas', createProjectOpen: false, minimaxSkill: null })
      await openBlank(created.id as WorkspaceId, () => getShell().projectId === created.id)
    },
    openProject,
    openSession,
    async newSession(projectId) {
      leavePage()
      setShell({ projectId })
      markSessionChoice()
      await openBlank(projectId as WorkspaceId, () => getShell().projectId === projectId)
    },
    goHome,
    openPage(panelId) {
      ctx.get('layout')?.selectPanel(panelId as MainPanelId)
    },
    async renameProject(projectId, title) {
      await shellClient.renameProject(projectId, title)
      await refreshProjects()
    },
    async deleteProject(projectId) {
      await shellClient.deleteProject(projectId)
      await refreshProjects()
      if (getShell().projectId === projectId) await goHome()
    },
    async renameSession(sessionId, title) {
      const result = await ctx.sessions.using(
        sessionId as SessionId,
        { source: 'workspaceOperation' },
        reference => reference.binding.session.rename(title),
      )
      if (!result.ok) throw new Error(result.error.message)
    },
    async deleteSession(sessionId) {
      const projectId = getShell().projectId
      const open = getShell().sessionId === sessionId
      await ctx.uiWorkspace.archiveSession(sessionId as SessionId, { stopActivity: true })
      if (open) await (projectId === null ? goHome() : openProject(projectId))
    },
    showPanels,
    hidePanels() {
      if (ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
    },
    collapseSidebar: () => { sidebar.collapse() },
    restoreSidebar: () => { sidebar.restore() },
    mountedSeat: ctx.sidebarRight.mounted,
    panelExpanded: ctx.sidebarRight.expanded,
  }
}
