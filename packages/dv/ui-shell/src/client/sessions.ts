/**
 * The chat sessions of one project as the navigator and the session switcher list them.
 *
 * @module @dv/ui-shell/sessions
 */
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { WireProject } from '@dv/ui-kit/types.ts'
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
export function useProjectSessions({ useSessions, useWorkspaces }: SessionListHooks, project: WireProject): SessionSummary[] {
  const current = useShell(s => s.sessionId)
  const workspaceSessions = useWorkspaces(s => s.items.find(item => item.workspaceId === project.id)?.sessionIds)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const byId = useSessions(s => s.byId)
  return (workspaceSessions ?? []).filter(id => !archived.includes(id))
    .map(id => byId[id as keyof typeof byId])
    .filter((summary): summary is SessionSummary => summary !== undefined && (!summary.blank || summary.id === current))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
