/**
 * The `dv:project` system-prompt section: Project's general rules (the conversation's project, background records and
 * how their finishes arrive, the history list, undo and redo, confirmation, stale records, and how to name records,
 * assets, versions of the registered reference kinds and other items). The text depends only on the registered reference
 * kinds, which change only together with the
 * operation tool definitions, so it is the same at every step of a session; the project's state reaches the agent
 * through the project messages of the `project-updates` module. It holds nothing that the user cannot see in the views
 * or the conversation.
 *
 * Calls the `dvProject` service's `listReferenceKinds`. Called by the service, which registers the section while the
 * DSH `systemPrompt` service is mounted.
 *
 * @module @dv/project/agent-context
 */
import type DvProject from './index.ts'
import { kindListText } from './agent-tools.ts'

/** The name of the system-prompt section. */
export const PROMPT_SECTION = 'dv:project'

/** How the naming rule names a version: as one of the registered reference kinds; nothing while no kind is registered. */
const versionNaming = (kinds: readonly string[]): string =>
  kinds.length === 0 ? '' : `a ${kindListText(kinds)} version as <id>@<version>, `

/**
 * The section text: the same for every session and every step while the registered reference kinds stay the same.
 * @param project - the service.
 * @returns the rules; the naming rule lists the registered reference kinds.
 */
export function projectContext(project: Pick<DvProject, 'listReferenceKinds'>): string {
  const kinds = project.listReferenceKinds()
  return [
    'DreamVerse project rules:',
    '- A conversation without a project starts the work with dv_proj_create. Once the DreamVerse project state message, '
      + 'dv_proj_create or dv_proj_open names this conversation\'s project, do all work in it and never call dv_proj_create '
      + 'or dv_proj_open again. Changes of the project that your own tool results did not show reach you as DreamVerse '
      + 'project updates; dv_proj_state reads the whole project at any time.',
    '- Calls whose result says pending, and the records a result lists under scheduled, run in the background; nothing waits '
      + 'for them. Keep working or end your turn. When they finish, a DreamVerse project update lists each one, also after your '
      + 'turn ended; then check the result and tell the user: the link of a done render, the error of a failed one.',
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
}
