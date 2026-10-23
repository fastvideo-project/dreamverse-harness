/**
 * Decorator render loop: portals every decorator node's React face into its
 * host element (what @lexical/react's composer does internally, scoped to
 * this composer's needs). Chip DOM identity rides the NodeKey — text edits
 * around a chip never remount its portal.
 */
import * as React from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import type { LexicalEditor, NodeKey } from 'lexical'
import { $getNodeByKey } from 'lexical'
import { $isReferenceChipNode } from './chip-node.tsx'

/** The fields of one reference chip that a face draws. */
export interface ChipFace {
  readonly source: string
  readonly reference: string
  readonly label: string
  readonly invalid: boolean
}

/** Portal-loop props. */
export interface DecoratorPortalsProps {
  /** The bound editor; null (no-session) renders nothing. */
  readonly editor: LexicalEditor | null
  /**
   * Draws each reference chip in place of its own face, given the chip and that face as the fallback; absent keeps
   * every chip's own face.
   */
  readonly renderFace?: ((chip: ChipFace, fallback: ReactNode) => ReactNode) | undefined
}

function chipAt(editor: LexicalEditor, key: NodeKey): ChipFace | null {
  return editor.getEditorState().read(() => {
    const node = $getNodeByKey(key)
    return $isReferenceChipNode(node)
      ? { source: node.getSource(), reference: node.getReference(), label: node.getLabel(), invalid: node.isInvalid() }
      : null
  })
}

/**
 * Render every decorator's React face into its editor host element.
 * @param props - the editor to observe, and the face that draws each reference chip.
 * @returns the live portal set.
 */
export function DecoratorPortals({ editor, renderFace }: DecoratorPortalsProps): ReactNode {
  const [decorators, setDecorators] = React.useState<Record<NodeKey, React.JSX.Element>>(
    () => editor === null ? {} : editor.getDecorators<React.JSX.Element>(),
  )
  React.useLayoutEffect(() => {
    if (editor === null) return
    setDecorators(editor.getDecorators<React.JSX.Element>())
    return editor.registerDecoratorListener<React.JSX.Element>((next) => { setDecorators(next) })
  }, [editor])
  if (editor === null) return null
  return (
    <>
      {Object.entries(decorators).map(([key, jsx]) => {
        const el = editor.getElementByKey(key)
        if (el === null) return null
        const chip = renderFace === undefined ? null : chipAt(editor, key)
        return createPortal(chip === null || renderFace === undefined ? jsx : renderFace(chip, jsx), el, key)
      })}
    </>
  )
}
