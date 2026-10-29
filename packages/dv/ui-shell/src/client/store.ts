/**
 * Browser state the DreamVerse shell shares between its center panel and its left navigator: the open project, the
 * center view, the open project's center fields, the request that `dvCenter.show` handed the shown view, the main chat
 * session, and the project ↔ Workspace links read from `/api/dv/workspaces`. Both components live in this one bundle, so
 * a module-level store is enough.
 *
 * The location (project, view, center fields, chat session) is mirrored into the URL hash, for example
 * `#project=<id>&view=<view>&timeline=t2&session=<id>`, so a reload restores it. Every change of the open project is
 * published to the other DreamVerse bundles through `publishCurrentProject`.
 *
 * @module @dv/ui-shell/store
 */
import { useSyncExternalStore } from 'react'
import { DvClient } from '@dv/ui-kit/api.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { WireProjectLink, WireWorkspaces } from '@dv/ui-kit/types.ts'
import type { CenterFields, CenterRequest, CenterTarget } from './contract/index.ts'

/** The client of every `/api/dv` call the shell makes. */
export const shellClient = new DvClient()

/** The project list before the links arrive; one instance so selectors return a stable value. */
export const NO_PROJECTS: WireProjectLink[] = []

/** What the shell components share. */
export interface ShellState {
  /** The main session, as the center panel last saw it. */
  sessionId: string | undefined
  /** The project open in the center, or null on the entry page. The main session follows it. */
  projectId: string | null
  /** The `id` of the `dv.center.view` entry that the center shows while a project is open, such as 'canvas'. */
  view: string
  fields: CenterFields
  /** The request of the latest `dvCenter.show` that its view has not taken, with the view's `id`. */
  request: { view: string; request: CenterRequest } | null
  links: WireWorkspaces | null
}

/** The location fields of the URL hash. */
export interface ShellLocation {
  projectId: string | null
  view: string
  fields: CenterFields
  sessionId: string | undefined
}

const LOCATION_FIELDS = new Set(['project', 'view', 'session'])

/** No center fields; one instance so a project without fields keeps a stable value. */
const NO_FIELDS: CenterFields = {}

/**
 * Parse the URL hash.
 * @param hash - `location.hash`.
 * @returns the location it names; missing fields take the entry-page values.
 */
export function parseLocation(hash: string): ShellLocation {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const fields = [...params].filter(([key]) => !LOCATION_FIELDS.has(key))
  return {
    projectId: params.get('project'),
    view: params.get('view') ?? 'canvas',
    fields: fields.length === 0 ? NO_FIELDS : Object.fromEntries(fields),
    sessionId: params.get('session') ?? undefined,
  }
}

/**
 * Format a location as a URL hash; the entry page has no hash.
 * @param location - the location.
 * @returns `#project=…` with the non-default fields, or the empty string.
 */
export function formatLocation(location: ShellLocation): string {
  const params = new URLSearchParams()
  if (location.projectId !== null) {
    params.set('project', location.projectId)
    if (location.view !== 'canvas') params.set('view', location.view)
    for (const [key, value] of Object.entries(location.fields)) params.set(key, value)
  }
  if (location.sessionId !== undefined) params.set('session', location.sessionId)
  const text = params.toString()
  return text === '' ? '' : `#${text}`
}

/**
 * The location of a shell state, as the URL hash shows it.
 * @param shown - the shell state.
 * @returns the location.
 */
export function locationOf(shown: ShellState): ShellLocation {
  return { projectId: shown.projectId, view: shown.view, fields: shown.fields, sessionId: shown.sessionId }
}

/** The location the page was loaded with, which the center restores once the client lists are ready. */
export const initialLocation: ShellLocation = parseLocation(window.location.hash)

// The main session is unknown until the center panel reports it; the URL's session is a restore target only. The shown
// view mounts from this state before the restore runs, so the URL's center fields are in place right away.
let state: ShellState = {
  projectId: initialLocation.projectId, view: initialLocation.view, fields: initialLocation.fields, request: null,
  sessionId: undefined, links: null,
}
const listeners = new Set<() => void>()
publishCurrentProject(state.projectId)

/** Whether the next main-session change is a user's session choice, which gets its own browser history entry. */
let sessionChoice = false
/** Whether the shell is applying a location from the URL, which must not add browser history entries. */
let applyingUrl = false
/**
 * Whether the shell state is mirrored into the URL. Until the page-load restore runs, the URL keeps what the user
 * opened or typed (a hash edited during startup included), so the restore reads it.
 */
let mirrorUrl = false

/** Start mirroring the shell state into the URL; the page-load restore calls this before it applies the URL. */
export function startUrlMirror(): void {
  mirrorUrl = true
}

/** Mark the next main-session change as the user's choice, so browser Back returns to the previous session. */
export function markSessionChoice(): void {
  sessionChoice = true
}

/**
 * Run navigation that applies a location the URL already names (reload, Back, Forward, an edited hash), so the hash
 * writes it causes replace the current history entry.
 * @param apply - the navigation; its synchronous part runs inside the scope.
 */
export function applyingLocation(apply: () => void): void {
  applyingUrl = true
  try {
    apply()
  } finally {
    applyingUrl = false
  }
}

/**
 * Merge fields into the shared state, mirror the location into the URL hash, publish a changed open project, and
 * notify subscribers when something changed. A change of project or center view, and a session the user chose, add a
 * browser history entry; other changes (a session the shell opened for a project, a center field) replace the current
 * entry. Another project starts with no center fields and no request, and another view drops the request.
 * @param patch - the fields to set.
 */
export function setShell(patch: Partial<ShellState>): void {
  const next = { ...state, ...patch }
  if (next.projectId !== state.projectId && patch.fields === undefined) next.fields = NO_FIELDS
  if ((next.projectId !== state.projectId || next.view !== state.view) && patch.request === undefined) next.request = null
  if ((Object.keys(next) as Array<keyof ShellState>).every(key => Object.is(next[key], state[key]))) return
  const previous = state
  state = next
  const hash = formatLocation(locationOf(next))
  if (mirrorUrl && (hash !== formatLocation(locationOf(previous)) || hash !== window.location.hash)) {
    const moved = next.projectId !== previous.projectId || next.view !== previous.view
      || (sessionChoice && next.sessionId !== previous.sessionId)
    const url = `${window.location.pathname}${window.location.search}${hash}`
    if (moved && !applyingUrl && hash !== window.location.hash) window.history.pushState(null, '', url)
    else window.history.replaceState(window.history.state, '', url)
  }
  if (next.sessionId !== previous.sessionId) sessionChoice = false
  if (next.projectId !== previous.projectId) publishCurrentProject(next.projectId)
  for (const listener of listeners) listener()
}

/**
 * Show a view in the open project's center and hand it a request: `dvCenter.show`.
 * @param target - the view `id` and the request's value.
 */
export function showInCenter(target: CenterTarget): void {
  const request: CenterRequest = {
    value: target.target,
    take: () => { if (state.request?.request === request) setShell({ request: null }) },
  }
  setShell({ view: target.view, request: { view: target.view, request } })
}

/**
 * Set center fields of a project: a view's `note`. A note for a project that is no longer open, such as the answer of
 * a write that the closed project's view started, changes nothing.
 * @param projectId - the project of the view that notes.
 * @param fields - the fields to set; null removes a field.
 */
export function noteInCenter(projectId: string, fields: Readonly<Record<string, string | null>>): void {
  if (projectId !== state.projectId) return
  const merged = Object.entries({ ...state.fields, ...fields }).filter((field): field is [string, string] => field[1] !== null)
  setShell({ fields: Object.fromEntries(merged) })
}

/**
 * Show the view and the center fields that a URL names, as Back, Forward and the page-load restore apply them.
 * @param location - the location the URL names.
 */
export function showLocation(location: Pick<ShellLocation, 'view' | 'fields'>): void {
  setShell({ view: location.view, fields: location.fields })
}

/** @returns the current shared state. */
export function getShell(): ShellState {
  return state
}

/**
 * Select a value of the shared state and re-render when it changes.
 * @param select - the selector.
 * @returns the selected value.
 */
export function useShell<T>(select: (value: ShellState) => T): T {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => select(state),
  )
}

/**
 * Fetch `/api/dv/workspaces` into the shared state.
 * @returns the links.
 */
export async function refreshLinks(): Promise<WireWorkspaces> {
  const links = await shellClient.listWorkspaces()
  setShell({ links })
  return links
}

/**
 * The project a session works on: the project whose Workspace holds it.
 * @param links - the links.
 * @param sessionId - the session.
 * @param workspace - the session's Workspace, when known.
 * @returns the project ID, or null.
 */
export function projectOfSession(
  links: WireWorkspaces | null,
  sessionId: string | undefined,
  workspace: { workspaceId: string } | undefined,
): string | null {
  if (links === null || sessionId === undefined || workspace === undefined) return null
  return links.projects.find(p => p.workspace_id === workspace.workspaceId)?.id ?? null
}
