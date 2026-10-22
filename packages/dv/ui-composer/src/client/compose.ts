/**
 * The `dv:compose` prefill. The canvas or the asset pool panel dispatches the event on `window`; the most recently mounted chat
 * composer takes it, replaces its draft with the event text, and appends one `@` reference chip per item. An event
 * that arrives while no composer is mounted waits for the next composer that mounts.
 *
 * @module @dv/ui-composer/compose
 */
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { formatCitation } from '@dv/project/grammar'
import type { DvComposeDetail } from '@dv/ui-kit/compose.ts'
import { MENTION_SOURCE } from './mention.ts'

/** A mounted composer: resolves its session's input facade on demand. */
type ComposerTarget = () => SessionInput | undefined

/** The mounted composers, in mount order; a Set keeps insertion order, so the newest is the last. */
const targets = new Set<ComposerTarget>()
let waiting: DvComposeDetail | null = null

/** Fill one composer: the text, then one chip per reference; a refused chip falls back to its plain reference text. */
function prefill(input: SessionInput, detail: DvComposeDetail): void {
  input.setDraft(detail.text === '' ? '' : `${detail.text} `)
  for (const ref of detail.refs) {
    const text = formatCitation(ref.label, ref.kind, ref.id)
    const state = input.state.getSnapshot()
    const end = state.draft.length
    const inserted = input.insertReference(
      { source: MENTION_SOURCE, ref: text, label: ref.label, clipboardText: text },
      { start: end, end, draftRev: state.draftRev },
    )
    if (!inserted) input.setDraft(`${input.state.getSnapshot().draft}${text} `)
  }
  input.focus()
}

/**
 * Hand an event to the newest composer, or keep it until one mounts.
 * @param detail - the event detail.
 */
export function deliverCompose(detail: DvComposeDetail): void {
  const input = [...targets].at(-1)?.()
  if (input === undefined) {
    waiting = detail
    return
  }
  waiting = null
  prefill(input, detail)
}

/**
 * Register a mounted composer; a waiting event goes to it at once.
 * @param target - resolves the composer's input facade.
 * @returns the unregister function.
 */
export function mountComposer(target: ComposerTarget): () => void {
  targets.add(target)
  if (waiting !== null) deliverCompose(waiting)
  return () => { targets.delete(target) }
}
