/**
 * Frozen service contract of the slash pipeline. Types only. The
 * InputTriggerService implementation publishes this face as `ctx.inputTriggers`; sources
 * see registerSource alone, the conversation wiring layer resolves its
 * per-session controller through sessionOf.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { InputTriggerSource, TokenSpan } from '../types.ts'
import type { AppliedOutcome, InputTriggerController } from './controller.ts'

/** What a prompt occurrence's controller offers and where it applies picks. */
export interface PromptControllerOptions {
  /** The names of the sources that the occurrence offers now; read each time the menu lists candidates. */
  readonly sources: () => readonly string[]
  /** The JSON handed to each offered source's `candidates` as `context` now; read with the sources. */
  readonly context: () => JsonValue | null
  /** Applies one pick outcome to the occurrence's draft; true when the occurrence applied it. */
  readonly deliver: (outcome: AppliedOutcome, span: TokenSpan) => boolean
}

/** The `ctx.inputTriggers` service face. */
export interface InputTriggerServiceContract {
  /**
   * Register one trigger source; duplicate trigger/name pairs throw.
   * @param src - source that discovers and resolves slash or reference candidates.
   * @returns effect disposer removing this source.
   */
  registerSource(src: InputTriggerSource): () => void
  /**
   * Resolve the lazy controller owned by one session scope.
   * @param actx - session-scoped Client context.
   * @returns controller that dies with that scope.
   */
  sessionOf(actx: ClientContext): InputTriggerController
  /**
   * Open the controller of one prompt occurrence outside any session.
   * @param options - the source names the occurrence offers, the JSON handed to their `candidates` as `context`, and
   *   the callback that applies each pick to the occurrence.
   * @returns the controller, the key that names it to the `conversation.prompt.menu` entry, and its disposer.
   */
  controllerFor(options: PromptControllerOptions): { readonly key: string; readonly controller: InputTriggerController; dispose(): void }
  /**
   * The controller of one open prompt occurrence.
   * @param key - the key that `controllerFor` returned.
   * @returns the controller, or undefined after the occurrence closed.
   */
  occurrence(key: string): InputTriggerController | undefined
}
