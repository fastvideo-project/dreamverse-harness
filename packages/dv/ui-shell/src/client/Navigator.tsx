/**
 * The DreamVerse left navigator, shadowing the DSH sidebar's Workspace browser: 新建项目, 首页, the DSH sidebar pages
 * (插件, MCP, …), and the project → session tree. Each project lists the chat sessions of its Workspace, with a row
 * menu to rename or delete the project or a session.
 *
 * @module @dv/ui-shell/Navigator
 */
import type { KeyboardEvent, ReactNode } from 'react'
import { Fragment, useState } from 'react'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { InlineRename } from '@dv/ui-kit/InlineRename.tsx'
import { pickText, useText } from '@dv/ui-kit/locale.ts'
import type { ShellInjected } from './Center.tsx'
import { ChevronDownIcon, ChevronRightIcon, HomeIcon, PlugIcon, PluginsIcon, PlusIcon, SkillsIcon } from './icons.tsx'
import { DREAMVERSE_WORDMARK } from './logo.ts'
import { type ActionRunner, useActionNotice } from './notice.tsx'
import { RowMenu } from './RowMenu.tsx'
import type { WireProject } from '@dv/ui-kit/types.ts'
import { usePanelEntries } from './panels.ts'
import { useProjectSessions } from './sessions.ts'
import { NO_PROJECTS, useShell } from './store.ts'
import css from './shell.module.css'

/** Props of the navigator entry. */
export type NavigatorProps = PropsRuntime<'sidebar.workspaces'> & ShellInjected

/** Icons of the DSH sidebar pages the shell knows; any other page shows the Plugins icon. */
const PAGE_ICONS: Readonly<Record<string, () => ReactNode>> = { plugins: PluginsIcon, mcp: PlugIcon, skills: SkillsIcon }

/** How many projects the tree lists before 项目 expands it to all. */
const SHOWN_PROJECTS = 12

/**
 * The key handler of a focusable row: Enter or Space runs the action, as a click does. A key pressed in an element
 * inside the row, such as its rename field, is left to that element.
 * @param action - what the click does.
 * @returns the `onKeyDown` handler.
 */
function onActivate(action: () => void): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    action()
  }
}

/**
 * The navigator.
 * @param props - the DSH UI slot props.
 * @returns the navigator, or nothing in the collapsed rail.
 */
export function Navigator(props: NavigatorProps): ReactNode {
  const { wide, shell, usePanelInfo } = props
  const t = useText()
  const projectId = useShell(s => s.projectId)
  const pages = usePanelEntries()
  const activePage = usePanelInfo(info => info.activePanelId)
  const projects = useShell(s => s.projects ?? NO_PROJECTS)
  const [showAll, setShowAll] = useState(false)
  const loaded = useShell(s => s.projects !== null)
  const { run, notice } = useActionNotice()
  if (!wide) return null
  const sorted = [...projects].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const shown = showAll ? sorted : sorted.slice(0, SHOWN_PROJECTS)
  // The open project always has a row, also when more than SHOWN_PROJECTS newer projects push it out of the list.
  const openRow = sorted.find(p => p.id === projectId)
  if (openRow !== undefined && !shown.includes(openRow)) shown.push(openRow)
  const nav = (label: string, active: boolean, onClick: () => void, icon?: ReactNode): ReactNode => (
    <button
      type="button" className={css.navItem} data-active={active ? '' : undefined} aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >{icon}{label}</button>
  )
  return (
    <div className={css.nav} data-dv-navigator="">
      {notice}
      <button type="button" className={css.navSecondary} onClick={() => { run(() => shell.newProject()) }}>
        <PlusIcon />{t('新建项目', 'Create project')}
      </button>
      {nav(t('首页', 'Home'), projectId === null && activePage === null, () => { run(() => shell.goHome()) }, <HomeIcon />)}
      {pages.map((page) => {
        const PageIcon = PAGE_ICONS[page.id] ?? PluginsIcon
        return <Fragment key={page.id}>{nav(page.label, activePage === page.id, () => { shell.openPage(page.id) }, <PageIcon />)}</Fragment>
      })}
      {sorted.length > SHOWN_PROJECTS && nav(showAll ? t('收起项目', 'Fewer projects') : t('全部项目', 'All projects'), false, () => { setShowAll(value => !value) })}
      <div className={css.section}>{t('项目', 'Projects')}</div>
      {loaded && sorted.length === 0 && (
        <div className={css.navHint}>{t('还没有项目。点击「新建项目」，或在首页描述你想做的视频。', 'No projects yet. Click Create project, or describe the video you want on Home.')}</div>
      )}
      {shown.map(project => (
        <ProjectTree
          key={project.id}
          {...props}
          project={project}
          open={project.id === projectId}
          run={run}
        />
      ))}
    </div>
  )
}

/**
 * One project with a row menu to rename or delete it, its chat sessions, and a ＋ that starts a chat session in it.
 * @param props - the DSH UI slot props, the project, whether it is the open one, and the runner of its actions.
 * @returns the rows.
 */
function ProjectTree(props: NavigatorProps & { project: WireProject; open: boolean; run: ActionRunner }): ReactNode {
  const { project, open, shell, run } = props
  const t = useText()
  const [expanded, setExpanded] = useState(open)
  const [renaming, setRenaming] = useState<string | null>(null)
  const current = useShell(s => s.sessionId)
  const sessions = useProjectSessions(props, project)
  const isOpen = expanded || open
  const toggle = (): void => {
    setExpanded(!isOpen)
  }
  const openProject = (): void => { run(() => shell.openProject(project.id)) }
  const deleteProject = (): void => {
    if (!window.confirm(pickText(`删除项目“${project.title}”？项目会移到回收目录，可由管理员恢复。`, `Delete project "${project.title}"? It moves to the trash directory, where an administrator can restore it.`))) return
    run(() => shell.deleteProject(project.id))
  }
  return (
    <>
      <div className={css.treeRow} data-active={open ? '' : undefined}>
        <span
          role="button" tabIndex={0} className={css.treeCaret} aria-expanded={isOpen}
          aria-label={isOpen ? t('收起会话', 'Hide chats') : t('展开会话', 'Show chats')}
          onClick={toggle} onKeyDown={onActivate(toggle)}
        >{isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}</span>
        {renaming === project.id
          ? (
            <InlineRename
              className={css.renameInput} value={project.title} onClose={() => { setRenaming(null) }}
              onSave={(title) => { if (title !== '') run(() => shell.renameProject(project.id, title)) }}
            />
          )
          : (
            <span
              className={css.treeLabel} role="button" tabIndex={0} title={project.title}
              onClick={openProject} onKeyDown={onActivate(openProject)}
            >{project.title}</span>
          )}
        <RowMenu
          label={t('项目菜单', 'Project menu')}
          items={[
            { label: t('重命名', 'Rename'), run: () => { setRenaming(project.id) } },
            { label: t('删除项目', 'Delete project'), danger: true, run: deleteProject },
          ]}
        />
        <button
          type="button" className={css.treeAdd} title={t('新对话', 'New chat')} aria-label={t('新对话', 'New chat')}
          onClick={() => { run(() => shell.newSession(project.id)) }}
        >
          <PlusIcon />
        </button>
      </div>
      {isOpen && sessions.map(summary => (
        <SessionRow
          key={summary.id} summary={summary} active={summary.id === current} shell={shell} run={run}
          open={() => { shell.openSession(summary.id) }}
        />
      ))}
    </>
  )
}

/**
 * One chat session row: its title, or 新对话 while it is blank, and a row menu to rename or delete it.
 * @param props - the session, whether it is the main session, the action that opens it, the shell actions, and the
 *   runner of the asynchronous ones.
 * @returns the row.
 */
function SessionRow({ summary, active, open, shell, run }: {
  summary: SessionSummary
  active: boolean
  open: () => void
  run: ActionRunner
} & ShellInjected): ReactNode {
  const t = useText()
  const [renaming, setRenaming] = useState(false)
  return (
    <div
      role="button" tabIndex={0} className={`${css.treeRow} ${css.treeChild}`}
      data-active={active ? '' : undefined} onClick={open} onKeyDown={onActivate(open)}
    >
      {renaming
        ? (
          <InlineRename
            className={css.renameInput} value={summary.displayTitle} onClose={() => { setRenaming(false) }}
            onSave={(title) => { if (title !== '') run(() => shell.renameSession(summary.id, title)) }}
          />
        )
        : <span className={css.treeLabel} title={summary.displayTitle}>{summary.blank ? t('新对话', 'New chat') : summary.displayTitle}</span>}
      <RowMenu
        label={t('对话菜单', 'Conversation menu')}
        items={[
          { label: t('重命名', 'Rename'), run: () => { setRenaming(true) } },
          {
            label: t('删除对话', 'Delete chat'), danger: true,
            run: () => {
              if (!window.confirm(pickText(`删除对话“${summary.displayTitle}”？`, `Delete chat "${summary.displayTitle}"?`))) return
              run(() => shell.deleteSession(summary.id))
            },
          },
        ]}
      />
    </div>
  )
}

/** The brand in the sidebar header: the DreamVerse wordmark (speed lines, then DREAMVERSE with a film camera in the D). */
export function BrandName(): ReactNode {
  return (
    <svg className={css.brand} viewBox="0 8 544 48" role="img" aria-label="DreamVerse">
      <path fill="#356CFF" d={DREAMVERSE_WORDMARK.blue} />
      <path fill="#FDC717" d={DREAMVERSE_WORDMARK.yellow} />
    </svg>
  )
}
