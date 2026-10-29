// @vitest-environment jsdom
/**
 * The chat sessions that the navigator lists under a project, read from stand-in DSH session and Workspace lists.
 */
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WireProject } from '@dv/ui-kit/types.ts'
import { type SessionListHooks, useProjectSessions } from '../src/client/sessions.ts'
import { setShell } from '../src/client/store.ts'

const PROJECT: WireProject = { id: 'p1', title: 'Launch film', created_at: '2026-01-05T12:00:00Z', path: '/dv/p1' }

/** A session list row. */
function summary(id: string, updatedAt: number, blank = false): SessionSummary {
  return { id: id as SessionId, displayTitle: id, running: false, blank, updatedAt, retainedBy: {} }
}

const rows = [summary('s1', 1), summary('s2', 5), summary('s3', 3), summary('s4', 4), summary('s5', 6, true), summary('s6', 7)]
const sessions = { ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) }
const workspaces = {
  items: [{ workspaceId: 'p1', path: '/dv/p1', sessionIds: ['s2', 's4', 's5', 's6'] }, { workspaceId: 'w2', path: '/dv/w2', sessionIds: ['s1'] }],
  archivedSessionIds: ['s4'],
}
const hooks: SessionListHooks = {
  useSessions: select => select(sessions as never),
  useWorkspaces: select => select(workspaces as never),
}

afterEach(() => {
  cleanup()
  setShell({ sessionId: undefined })
})

describe('useProjectSessions', () => {
  it('lists the chats of the project\'s Workspace, newest first, without archived ones and blank ones other than the main session', () => {
    const { result, rerender } = renderHook(() => useProjectSessions(hooks, PROJECT))
    expect(result.current.map(row => row.id)).toEqual(['s6', 's2'])
    setShell({ sessionId: 's5' })
    rerender()
    expect(result.current.map(row => row.id)).toEqual(['s6', 's5', 's2'])
  })
})
