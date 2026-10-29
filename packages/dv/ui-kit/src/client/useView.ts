/**
 * The state one view keeps about the project it shows: which project, the project's current state and the operation
 * declarations, the last failure, and the gestures of the project and undo bar (`ProjectBar`: undo, new project) as API
 * calls on behalf of the chat session the view sits beside.
 *
 * @module @dv/ui-kit/useView
 */
import { useCallback, useEffect, useState } from 'react'
import type { DvClient, ViewSurface } from './api.ts'
import { useCurrentProject } from './current-project.ts'
import type { WireOperation, WireProject, WireState } from './types.ts'
import { useOperations, useProjectState, useProjects } from './useProject.ts'
import type { Loading } from './useProject.ts'
import type { ProjectBarProps } from './ProjectBar.tsx'

/** What a view body reads and calls. */
export interface ViewSession {
  client: DvClient
  surface: ViewSurface
  /** The chat session the view sits beside, recorded as the `session` of the view's writes. */
  session: string | null
  projects: Loading<WireProject[]>
  project: string | null
  /** The project's current state, which the view shows and writes after. */
  state: Loading<WireState>
  operations: Loading<WireOperation[]>
  /** The message of the last failed call, cleared by the next successful one. */
  notice: string | null
  /**
   * Run one write, refetch the state afterwards, and keep the failure message when it throws.
   * @param work - the API call.
   * @returns whether the call succeeded.
   */
  run: (work: () => Promise<unknown>) => Promise<boolean>
  /** The project and undo bar's data and callbacks, without its copy. */
  bar: Omit<ProjectBarProps, 'labels' | 'ask'>
}

/**
 * Keep a view's project, state, and operations, and bind the project and undo bar's gestures to the API. The first project
 * shown is the project the DreamVerse shell has open when the list has it, else the newest.
 * @param client - the API client.
 * @param surface - the view's name in the records it writes.
 * @param session - the chat session the view sits beside, or null.
 * @returns the session.
 */
export function useViewSession(client: DvClient, surface: ViewSurface, session: string | null = null): ViewSession {
  const projects = useProjects(client)
  const open = useCurrentProject()
  const [project, setProject] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const list = projects.value
  const first = list === null ? null : (list.find(row => row.id === open) ?? list[0])?.id ?? null
  useEffect(() => {
    if (project === null && first !== null) setProject(first)
  }, [project, first])
  const state = useProjectState(client, project)
  const operations = useOperations(client)
  const reload = state.reload
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work()
      setNotice(null)
      reload()
      return true
    } catch (failure: unknown) {
      setNotice(failure instanceof Error ? failure.message : String(failure))
      return false
    }
  }, [reload])
  const bar: ViewSession['bar'] = {
    projects: projects.value ?? [],
    project,
    onProject: setProject,
    onUndo: () => { if (project !== null) void run(() => client.undo(project)) },
    onCreate: (title) => {
      void run(async () => { setProject((await client.createProject(title, surface)).id) }).then((ok) => {
        if (ok) projects.reload()
      })
    },
  }
  return { client, surface, session, projects, project, state, operations, notice, run, bar }
}
