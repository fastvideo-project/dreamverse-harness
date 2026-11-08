/**
 * Inline title editing: a text field that replaces a title while it is renamed, used by the DreamVerse shell for
 * projects and chat sessions and by the canvas for node names.
 *
 * @module @dv/ui-kit/InlineRename
 */
import type { CSSProperties, ReactNode } from 'react'
import { useRef, useState } from 'react'

/** Props of {@link InlineRename}. */
export interface InlineRenameProps {
  /** The title on show, which the field starts with and selects. */
  value: string
  /** Save a changed title, trimmed; it can be empty. */
  onSave: (title: string) => void
  onClose: () => void
  /** The message that keeps the field open for a trimmed title, such as one that is too long; null accepts it. */
  check?: (title: string) => string | null
  /** The field's accessible name. */
  label?: string
  /** The line under the field while it shows no message, such as how to save and cancel. */
  hint?: string
  className?: string | undefined
  style?: CSSProperties
}

/** The line under the field, which sits over the content below it so the field keeps the title's height. */
const below: CSSProperties = {
  position: 'absolute', left: 0, top: '100%', marginTop: 4, padding: '2px 6px', zIndex: 1, whiteSpace: 'nowrap',
  borderRadius: 'var(--dv-radius-sm)', background: 'var(--dv-surface-1)', boxShadow: 'var(--dv-shadow-1)',
  fontSize: 12, lineHeight: '16px', fontWeight: 400,
}

/**
 * A text field that replaces a title while it is renamed: Enter or leaving the field saves a changed title, and Escape
 * cancels. A title that `check` refuses keeps the field open with a danger border and the message under it. The field
 * keeps its key and pointer events from the elements around it, so Escape closes no dialog and a press starts no drag.
 * @param props - the current title, the save and close callbacks, the check, and the field's label, hint and style.
 * @returns the field.
 */
export function InlineRename({ value, onSave, onClose, check, label, hint, className, style }: InlineRenameProps): ReactNode {
  const [text, setText] = useState(value)
  const [message, setMessage] = useState<string | null>(null)
  const settled = useRef(false)
  const finish = (save: boolean): void => {
    if (settled.current) return
    const title = text.trim()
    const refused = save ? check?.(title) ?? null : null
    setMessage(refused)
    if (refused !== null) return
    settled.current = true
    if (save && title !== value) onSave(title)
    onClose()
  }
  const note = message ?? hint
  return (
    <span style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
      <input
        className={className}
        style={{ flex: 1, minWidth: 0, userSelect: 'text', ...style, ...message === null ? {} : { borderColor: 'var(--dv-danger)' } }}
        value={text}
        aria-label={label}
        aria-invalid={message !== null}
        // The field opens in response to the user's rename request, so it takes focus.
        autoFocus
        onFocus={(event) => { event.currentTarget.select() }}
        onChange={(event) => { setText(event.currentTarget.value); setMessage(null) }}
        onClick={(event) => { event.stopPropagation() }}
        onPointerDown={(event) => { event.stopPropagation() }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') finish(true)
          else if (event.key === 'Escape') finish(false)
        }}
        onBlur={() => { finish(true) }}
      />
      {note === undefined
        ? null
        : <span role={message === null ? undefined : 'alert'} style={{ ...below, color: message === null ? 'var(--dv-text-2)' : 'var(--dv-danger)' }}>{note}</span>}
    </span>
  )
}
