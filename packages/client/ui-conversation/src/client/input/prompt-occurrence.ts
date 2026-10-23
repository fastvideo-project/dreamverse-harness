/**
 * One `conversation.prompt` occurrence: a draft editor runtime over a host model, outside any Session. It seeds and
 * replaces the content by revision, reports each change to the host, and drives an `@` menu through its own trigger
 * controller, which hands each pick to this occurrence alone.
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { InputTriggerController, PickOutcome } from '../contract/input.ts'
import type { Occurrence, TokenSpan } from '../contract/draft-editor.ts'
import type { PromptHostModel, PromptOccurrenceHandle } from '../contract/prompt.ts'
import { registerComposerKeymap } from './editor/keymap.ts'
import { DraftEditorRuntime } from './editor/runtime.ts'

/** The part of `ctx.inputTriggers` an occurrence uses, resolved without importing its implementation. */
export interface PromptTriggerFace {
  controllerFor(options: {
    readonly sources: () => readonly string[]
    readonly context: () => JsonValue | null
    readonly deliver: (outcome: Exclude<PickOutcome, 'handled' | undefined>, span: TokenSpan) => boolean
  }): { readonly key: string; readonly controller: InputTriggerController; dispose(): void }
}

/** Whether two chip lists hold the same chips at the same offsets. */
function sameChips(a: readonly Occurrence[], b: readonly Occurrence[]): boolean {
  return a.length === b.length && a.every((chip, index) => {
    const other = b[index]
    return other !== undefined && chip.ref === other.ref && chip.offset === other.offset && chip.source === other.source
  })
}

/** The open editor, menu controller and listeners of one occurrence. */
export class PromptOccurrence implements PromptOccurrenceHandle {
  private readonly runtime: DraftEditorRuntime
  private readonly trigger: ReturnType<PromptTriggerFace['controllerFor']> | null
  private readonly release: () => void
  private applied: number
  private draftRev = 0
  private lastDetect = ''
  /** The content last reported to the host; null while the constructor seeds the content the host already holds. */
  private reported: { text: string; chips: readonly Occurrence[] } | null = null

  /**
   * @param model - reads the host's current model.
   * @param triggers - the trigger service, absent when no trigger plugin is loaded.
   */
  constructor(private readonly model: () => PromptHostModel, triggers: PromptTriggerFace | undefined) {
    const first = model()
    // The host's sources and their context can change after the occurrence opens, so the controller reads them live.
    this.trigger = triggers === undefined
      ? null
      : triggers.controllerFor({
        sources: () => this.model().sources,
        context: () => this.model().sourceContext,
        deliver: (outcome, span) => this.deliver(outcome, span),
      })
    const controller = this.trigger?.controller
    this.runtime = new DraftEditorRuntime({
      onUpdate: () => { this.onUpdate() },
      openReference: (source, reference) => this.model().openReference?.(source ?? '', reference.ref) ?? false,
      activeClaimToken: () => null,
      lexicon: () => controller?.lexicon.getSnapshot() ?? new Map(),
      resolveLexicon: () => controller?.lexicon,
    })
    const editor = this.runtime.editor
    const offs = [
      this.runtime.register(),
      registerComposerKeymap(editor, {
        arbitrate: (key, composing) => controller?.arbitrate(key, composing) ?? 'pass',
        space: () => controller?.onSpace() ?? false,
        dismissPopup: () => {},
        canSubmit: () => !this.model().readOnly,
        submit: () => { this.model().onSubmit?.() },
        // A prompt occurrence takes no files; its host adds references through its own tray.
        intakeFiles: () => {},
        pasteText: (text) => { this.runtime.paste(text) },
      }),
    ]
    this.release = () => {
      for (const off of offs) off()
      this.trigger?.dispose()
    }
    editor.setEditable(!first.readOnly)
    this.runtime.restoreDraft(first.content.text, first.content.chips)
    this.runtime.clearHistory()
    this.applied = first.content.revision
    this.reported = { text: this.runtime.projection.clipboardText, chips: this.runtime.projection.occurrences }
  }

  /** The occurrence's Lexical editor, bound by the Factory component's contenteditable. */
  get editor(): PromptOccurrenceHandle['editor'] {
    return this.runtime.editor
  }

  /** The key of the trigger controller, or null without one. */
  get menuKey(): string | null {
    return this.trigger?.key ?? null
  }

  /** Apply a new content revision as its history mode says, and follow the read-only flag. */
  sync(): void {
    const model = this.model()
    this.runtime.editor.setEditable(!model.readOnly)
    const { content } = model
    if (content.revision === this.applied) return
    this.applied = content.revision
    switch (content.history) {
      case 'step':
        this.runtime.replaceDraft(content.text, content.chips)
        return
      case 'merge':
        this.runtime.mergeDraft(content.text, content.chips)
        return
      case 'reset':
        this.runtime.restoreDraft(content.text, content.chips)
        this.runtime.clearHistory()
    }
  }

  /** Close the menu controller and every listener. */
  dispose(): void {
    this.release()
  }

  /**
   * Apply one pick at its span when the draft has not changed since the hit: a reference becomes a chip and a text
   * replaces the token. An occurrence takes no command claim.
   */
  private deliver(outcome: Exclude<PickOutcome, 'handled' | undefined>, span: TokenSpan): boolean {
    if (span.draftRev !== this.draftRev || 'claim' in outcome) return false
    if ('text' in outcome) return this.runtime.replaceText(span, outcome.text)
    const tail = this.runtime.projection.detectText.slice(span.end, span.end + 1)
    return this.runtime.insertReference(span, outcome.insert, tail)
  }

  /** Track the trigger and report a changed text or chip list to the host. */
  private onUpdate(): void {
    this.runtime.refreshProjection()
    const projection = this.runtime.projection
    if (projection.detectText !== this.lastDetect) {
      this.draftRev += 1
      this.lastDetect = projection.detectText
    }
    const model = this.model()
    if (projection.caret !== null) {
      this.trigger?.controller.track(projection.detectText, projection.caret, { tier: model.readOnly ? 'frozen' : 'plain' }, this.draftRev)
    }
    if (this.reported === null) return
    if (projection.clipboardText === this.reported.text && sameChips(projection.occurrences, this.reported.chips)) return
    this.reported = { text: projection.clipboardText, chips: projection.occurrences }
    model.onChange(projection.clipboardText, projection.occurrences)
  }
}
