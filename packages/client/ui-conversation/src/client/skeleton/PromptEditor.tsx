/**
 * The `conversation.prompt` Factory component: one draft editor occurrence over a host model. It opens its own
 * occurrence through the inject face, applies each new content revision, renders the occurrence's `@` menu outlet, and
 * draws every chip through the `conversation.prompt.reference` entry of the chip's source.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { PromptEditorProps, PromptOccurrenceHandle } from '../contract/prompt.ts'
import { DraftEditor } from '../input/editor/DraftEditor.tsx'
import css from './PromptEditor.module.css'

/**
 * Render one prompt occurrence: its editor box with its menu outlet.
 * @param props - the host model, the inject face's opener, and the declared child slots.
 * @returns the occurrence.
 */
export function PromptEditor({ model, open, renderSlot }: PromptEditorProps): ReactNode {
  const latest = useRef(model)
  latest.current = model
  const scrollRef = useRef<HTMLDivElement>(null)
  const [handle, setHandle] = useState<PromptOccurrenceHandle | null>(null)
  useEffect(() => {
    const opened = open(() => latest.current)
    setHandle(opened)
    return () => { opened.dispose() }
  }, [open])
  useEffect(() => { handle?.sync() }, [handle, model.content.revision, model.readOnly])
  return (
    <div className={clsx(css.prompt, model.readOnly && css.readOnly)} data-composer-card="" data-prompt-occurrence="">
      {handle?.menuKey === null || handle === null ? null : renderSlot('conversation.prompt.menu', { menuKey: handle.menuKey })}
      <DraftEditor
        classNames={css} editor={handle?.editor ?? null} scrollRef={scrollRef} editable={!model.readOnly} editorDisabled={false}
        phase={model.readOnly ? 'inert' : 'plain'} placeholderText={model.placeholder} ariaLabel={model.ariaLabel}
        workspaceTrigger={false} workspacePickerOpen={false} onWorkspaceKeyDown={() => {}} hint={null}
        showPlaceholder={false}
        renderFace={(chip, fallback) => renderSlot(
          'conversation.prompt.reference', { ...chip, context: model.faceContext }, { entryKey: chip.source, fallback },
        )}
      />
    </div>
  )
}
