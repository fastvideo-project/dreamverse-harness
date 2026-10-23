/**
 * The `conversation.prompt` Component Factory: the composer's draft editor as an occurrence that any parent renders
 * without a Session, with its chip-face slot and its `@` menu outlet.
 */
import type { LexicalEditor } from 'lexical'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { Occurrence } from './draft-editor.ts'

/** One chip of a prompt's content, in clipboard-text coordinates; the occurrence assigns its identity. */
export type PromptChip = Omit<Occurrence, 'occurrenceId'>

/** The content of one occurrence: clipboard text and the chips in it. */
export interface PromptContent {
  /**
   * A new revision replaces the editor content as {@link PromptContent.history} says; the occurrence opens with its first
   * revision as the initial content, outside the undo history.
   */
  readonly revision: number
  /**
   * How a new revision enters the undo history: `step` replaces the content as one undoable edit, and `reset` starts the
   * history over on the content, as a new occurrence would.
   */
  readonly history: 'step' | 'reset'
  readonly text: string
  readonly chips: readonly PromptChip[]
}

/** What the host of one `conversation.prompt` occurrence gives it: JSON values and callbacks. */
export interface PromptHostModel {
  readonly content: PromptContent
  readonly readOnly: boolean
  /** The trigger sources this occurrence offers now, by name; read each time its menu lists candidates. */
  readonly sources: readonly string[]
  /** Handed to each offered source's `candidates` as `context`. */
  readonly sourceContext: JsonValue | null
  /** Handed to every chip face as {@link ReferenceFaceOwner.context}. */
  readonly faceContext: JsonValue | null
  /** Called after each change of the clipboard text or the chips. */
  onChange(text: string, chips: readonly Occurrence[]): void
  /** Called on Enter while the menu is closed; absent in read mode. */
  onSubmit?(): void
  /**
   * Called when the user activates a chip; true when the host opened what the chip names. Outside a Session no trigger
   * source previews a chip, so the host does.
   */
  openReference?(source: string, reference: string): boolean
  readonly placeholder: string
  readonly ariaLabel: string
}

/** Owner props of one chip face: the chip as the editor holds it and the occurrence's face context. */
export interface ReferenceFaceOwner {
  /** The trigger source that inserted the chip; the face slot's entry key. */
  readonly source: string
  /** The chip's source-owned reference; named so because the renderer spreads owner props and React keeps `ref`. */
  readonly reference: string
  readonly label: string
  readonly invalid: boolean
  readonly context: JsonValue | null
}

/** Owner props of the `@` menu outlet of one occurrence. */
export interface PromptMenuOwner {
  /** The key of the occurrence's trigger controller; named so because React keeps `key`. */
  readonly menuKey: string
}

/** The editor and the trigger controller of one open occurrence. */
export interface PromptOccurrenceHandle {
  readonly editor: LexicalEditor
  /** The menu key; null without a trigger plugin. */
  readonly menuKey: string | null
  /** Apply the host's current content revision and read-only flag. */
  sync(): void
  dispose(): void
}

/** The apply-world face of the Factory: it opens one occurrence over a model the component keeps current. */
export interface PromptInjected {
  /**
   * @param model - reads the host's current model.
   * @returns the occurrence; the component disposes it on unmount.
   */
  readonly open: (model: () => PromptHostModel) => PromptOccurrenceHandle
}

/** Full props of the Factory component. */
export type PromptEditorProps = FactoryComponentPropsOf<'conversation.prompt'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The face of one chip in the chat composer bar, which declares it, keyed by the chip's source; the fallback is the
     * glyph chip. One slot has one declaring owner, so a plugin registers its face here and in the prompt's slot.
     */
    'conversation.input.reference': { kind: 'keyed'; scope: 'session-maybe'; owner: ReferenceFaceOwner }
    /** The face of one chip of a prompt occurrence, keyed by the chip's source; the fallback is the glyph chip. */
    'conversation.prompt.reference': { kind: 'keyed'; scope: 'session-maybe'; owner: ReferenceFaceOwner }
    /** The `@` menu of one prompt occurrence; `ui-input-trigger` draws it. */
    'conversation.prompt.menu': { kind: 'single'; scope: 'session-maybe'; owner: PromptMenuOwner }
  }
  interface SlotFactoryMap {
    /** The draft editor as one occurrence over a host model, outside any Session. */
    'conversation.prompt': {
      scope: 'session-maybe'
      props: { model: PromptHostModel }
      children: {
        'conversation.prompt.reference': { kind: 'keyed'; scope: 'session-maybe' }
        'conversation.prompt.menu': { kind: 'single'; scope: 'session-maybe' }
      }
      inject: PromptInjected
    }
  }
}
