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
 * The project's chat sessions, newest first: the sessions of its Workspace, without archived sessions and blank sessions
 * other than the main session.
 * @param hooks - the DSH list hooks.
 * @param project - the project.
 * @returns the session summaries.
 */
export function useProjectSessions({ useSessions, useWorkspaces }: SessionListHooks, project: WireProjectLink): SessionSummary[] {
  const current = useShell(s => s.sessionId)
  const workspaceSessions = useWorkspaces(s => s.items.find(item => item.workspaceId === project.workspace_id)?.sessionIds)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const byId = useSessions(s => s.byId)
  return (workspaceSessions ?? []).filter(id => !archived.includes(id))
    .map(id => byId[id as keyof typeof byId])
    .filter((summary): summary is SessionSummary => summary !== undefined && (!summary.blank || summary.id === current))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Whether a session is an entry chat: a top-level chat with a turn that no Workspace lists, so its folder is no project
 * yet.
 * @param summary - the session.
 * @param workspaces - the DSH Workspaces.
 * @returns whether it is an entry chat.
 */
export function isEntryChat(
  summary: SessionSummary | undefined, workspaces: ReadonlyArray<{ sessionIds: readonly string[] }>,
): summary is SessionSummary {
  return summary !== undefined && !summary.blank && summary.origin !== 'subagent'
    && !workspaces.some(item => item.sessionIds.includes(summary.id))
}

/**
 * The entry chats ({@link isEntryChat}), newest first, without archived sessions.
 * @param hooks - the DSH list hooks.
 * @returns the session summaries; empty until the links load.
 */
export function useEntrySessions({ useSessions, useWorkspaces }: SessionListHooks): SessionSummary[] {
  const links = useShell(s => s.links)
  const workspaces = useWorkspaces(s => s.items)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const sessions = useSessions(s => s)
  if (links === null) return []
  return sessions.ids
    .map(id => sessions.byId[id])
    .filter((summary): summary is SessionSummary => isEntryChat(summary, workspaces) && !archived.includes(summary.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
