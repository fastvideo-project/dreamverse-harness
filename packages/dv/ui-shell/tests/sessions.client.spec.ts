// @vitest-environment jsdom
/**
 * The entry chats that the navigator's 对话 section lists, read from stand-in DSH session and Workspace lists.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WireWorkspaces } from '@dv/ui-kit/types.ts'
import { type SessionListHooks, useEntrySessions } from '../src/client/sessions.ts'
import { setShell } from '../src/client/store.ts'

const LINKS: WireWorkspaces = {
  entry_path: '/dv/entry',
  projects: [{ id: 'p1', title: 'Launch film', created_at: '2026-01-05T12:00:00Z', path: '/dv/p1', workspace_id: 'ws-p1' }],
  bindings: { s2: 'p1' },
}

/** A session list row. */
function summary(id: string, updatedAt: number, blank = false): SessionSummary {
  return { id: id as SessionId, displayTitle: id, running: false, blank, updatedAt, retainedBy: {} }
}

const rows = [
  summary('s1', 1), summary('s2', 5), summary('s3', 3), summary('s4', 4), summary('s5', 6, true), summary('s6', 7),
  { ...summary('s7', 8), origin: 'subagent' as const },
]
const sessions = { ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) }
const workspaces = {
  items: [{ workspaceId: 'ws-p1', path: '/dv/p1', sessionIds: ['s6'] }],
  archivedSessionIds: ['s4'],
}
const hooks: SessionListHooks = {
  useSessions: select => select(sessions as never),
  useWorkspaces: select => select(workspaces as never),
}

afterEach(() => {
  cleanup()
  setShell({ links: null })
})

describe('useEntrySessions', () => {
  it('lists the started top-level chats that no Workspace holds and no binding names, without archived ones, newest first', () => {
    setShell({ links: LINKS })
    const { result } = renderHook(() => useEntrySessions(hooks))
    expect(result.current.map(row => row.id)).toEqual(['s3', 's1'])
    act(() => { setShell({ links: { ...LINKS, bindings: {} } }) })
    expect(result.current.map(row => row.id)).toEqual(['s2', 's3', 's1'])
  })

  it('lists nothing before the links load', () => {
    const { result } = renderHook(() => useEntrySessions(hooks))
    expect(result.current).toEqual([])
  })
})
