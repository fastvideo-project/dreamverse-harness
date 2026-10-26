/**
 * The `dv:project` system-prompt section: what the agent of a chat session reads about its project at every step.
 * The section holds Project's general rules (the history list, undo and redo, confirmation, stale records, and how to name
 * records, assets, versions of the registered reference kinds and other items), then the project summary of the current
 * state: the same summary that `dv_proj_state` returns, with the fields each component's reducer adds through
 * `Reducer.agentSummary`. It holds nothing that the user cannot see in the views or the conversation.
 *
 * Calls the `dvProject` service's public reads and the project summary of the `proj-tools` module. Called by the
 * service, which registers the section while the DSH `systemPrompt` service is mounted.
 *
 * @module @dv/project/agent-context
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type DvProject from './index.ts'
import { kindListText } from './agent-tools.ts'
import { projectSummary, type ProjToolDeps } from './proj-tools.ts'
import type { SessionId } from './types.ts'

/** The name of the system-prompt section. */
export const PROMPT_SECTION = 'dv:project'

/** How the naming rule names a version: as one of the registered reference kinds; nothing while no kind is registered. */
const versionNaming = (kinds: readonly string[]): string =>
  kinds.length === 0 ? '' : `a ${kindListText(kinds)} version as <id>@<version>, `

/** Project's rules, which apply whether or not a project is bound; the naming rule lists the registered reference kinds. */
const rules = (kinds: readonly string[]): string => [
  'DreamVerse project rules:',
  '- Every call of yours and every edit of the user is a step of the project history at once; the user does not accept changes.',
  '- When the user asks to undo, roll back or go back to an earlier state, call dv_proj_undo: without to it goes back one '
    + 'step; with to = a record ID from dv_proj_history_list the project shows its state just after that step. dv_proj_redo goes '
    + 'forward one step. These moves add no step. A new change after a move discards the steps after the current one for good, '
    + 'so when the user may still want them, ask before you change anything. Never rebuild an earlier state with new edits when '
    + 'the user asked to go back.',
  '- Name things by the IDs in the project summary: a record by its record ID, an output of a record as <record>#<n>, '
    + `${versionNaming(kinds)}an asset by its asset ID, and any other item by the ID that the summary gives it. `
    + 'The user points at things with dv: mentions, which reach you as these IDs. '
    + 'When the user\'s words fit more than one thing and no mention names it, ask which one instead of guessing.',
  '- When a tool refuses a call because it needs the user\'s agreement, show the user what the refusal says the call will do, '
    + 'and ask in the conversation with the question in bold. Call again with user_approved: true only after the user agreed.',
  '- Stale records had an input replaced. Render one again only when the user agrees; call dv_proj_stale_accept when the user keeps it as it is.',
].join('\n')

/**
 * The section text for one chat session.
 * @param project - the service.
 * @param deps - the asset store and the reducers' summaries, for the project summary.
 * @param sessionId - the agent's session ID; undefined on assemblies without an agent.
 * @returns the rules, then the bound project and the summary of its current state.
 */
export function projectContext(project: DvProject, deps: ProjToolDeps, sessionId: string | undefined): string {
  const session = sessionId === undefined ? null : brandString<SessionId>(sessionId)
  const projectId = session === null ? null : project.sessionProject(session)
  const ruleText = rules(project.listReferenceKinds())
  if (projectId === null) return `${ruleText}\n\nNo project is bound to this conversation yet: start the work with dv_proj_create.`
  const summary = projectSummary(project, deps, projectId, project.getState(projectId), null)
  return [
    ruleText, '',
    `This conversation belongs to project ${projectId}: do all work in it and never call dv_proj_create or dv_proj_open.`,
    'Project summary of the current state, as dv_proj_state returns it:',
    JSON.stringify(summary, null, 1),
  ].join('\n')
}
