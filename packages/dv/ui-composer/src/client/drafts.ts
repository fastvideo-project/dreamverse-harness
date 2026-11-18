/**
 * The unsent drafts of the take editor, held in memory per project, draft id, and lent call so that closing an editor
 * keeps what the person typed. A page reload clears them. At most {@link MAX_DRAFTS} drafts are kept; writing one beyond
 * that drops the one written longest ago.
 *
 * @module @dv/ui-composer/drafts
 */
import type { Draft } from './draft.ts'

/** The number of drafts the store keeps. */
export const MAX_DRAFTS = 20

const drafts = new Map<string, Draft>()

/**
 * The store key of a draft.
 * @param projectId - the project the editor belongs to.
 * @param draftId - the `draftId` of the occurrence, such as the record of the take.
 * @param callKey - the lent call as JSON, `Draft.callKey`.
 * @returns the key.
 */
export function draftKey(projectId: string, draftId: string, callKey: string): string {
  return `${projectId}\u0000${draftId}\u0000${callKey}`
}

/**
 * The stored draft of a key.
 * @param key - the key from {@link draftKey}.
 * @returns the draft, or undefined when none is stored.
 */
export function readDraft(key: string): Draft | undefined {
  return drafts.get(key)
}

/**
 * Store a draft as the most recently written one. A stored draft is never in the sending state.
 * @param key - the key from {@link draftKey}.
 * @param draft - the draft to keep.
 */
export function writeDraft(key: string, draft: Draft): void {
  drafts.delete(key)
  drafts.set(key, { ...draft, sending: false })
  for (const oldest of drafts.keys()) {
    if (drafts.size <= MAX_DRAFTS) break
    drafts.delete(oldest)
  }
}

/**
 * Drop the stored draft of a key.
 * @param key - the key from {@link draftKey}.
 */
export function clearDraft(key: string): void {
  drafts.delete(key)
}

/** Drop every stored draft; test support that isolates specs from each other. */
export function resetDrafts(): void {
  drafts.clear()
}
