/**
 * The chat sessions of one project as the navigator and the session switcher list them, and the entry chats that the
 * navigator's 对话 section lists.
 *
 * @module @dv/ui-shell/sessions
 */
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { WireProjectLink } from '@dv/ui-kit/types.ts'
import { useShell } from './store.ts'

/** The DSH session and Workspace list hooks every DSH UI slot entry receives. */
export type SessionListHooks = Pick<GlobalStandardProps, 'useSessions' | 'useWorkspaces'>

/**
 * The project's chat sessions, newest first: the sessions of its Workspace and the sessions bound to it, without
 * archived sessions, sessions bound to another project, and blank sessions other than the main session.
 * @param hooks - the DSH list hooks.
 * @param project - the project.
 * @returns the session summaries.
 */
export function useProjectSessions({ useSessions, useWorkspaces }: SessionListHooks, project: WireProjectLink): SessionSummary[] {
  const current = useShell(s => s.sessionId)
  const bindings = useShell(s => s.links?.bindings)
  const workspaceSessions = useWorkspaces(
    s => s.items.find(item => item.workspaceId === project.workspace_id || item.path === project.path)?.sessionIds,
  )
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const byId = useSessions(s => s.byId)
  // A session belongs to one project: its binding, else the project whose Workspace holds it.
  const ids = [...new Set([
    ...workspaceSessions ?? [],
    ...Object.entries(bindings ?? {}).filter(([, id]) => id === project.id).map(([id]) => id),
  ])].filter(id => !archived.includes(id as never) && (bindings?.[id] ?? project.id) === project.id)
  return ids
    .map(id => byId[id as keyof typeof byId])
    .filter((summary): summary is SessionSummary => summary !== undefined && (!summary.blank || summary.id === current))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * The entry chats, newest first: the sessions of the entry Workspace (the Workspace at `links.entry_path`) that have a
 * turn, without archived sessions and sessions bound to a project, which that project lists. `goHome` opens exactly
 * these sessions when it gets their ID.
 * @param hooks - the DSH list hooks.
 * @returns the session summaries; empty until the links load.
 */
export function useEntrySessions({ useSessions, useWorkspaces }: SessionListHooks): SessionSummary[] {
  const entryPath = useShell(s => s.links?.entry_path)
  const bindings = useShell(s => s.links?.bindings)
  const entrySessions = useWorkspaces(s => s.items.find(item => item.path === entryPath)?.sessionIds)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const byId = useSessions(s => s.byId)
  return (entrySessions ?? [])
    .filter(id => !archived.includes(id) && bindings?.[id] === undefined)
    .map(id => byId[id])
    .filter((summary): summary is SessionSummary => summary !== undefined && !summary.blank)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
