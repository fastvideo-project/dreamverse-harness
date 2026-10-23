/**
 * InputTriggerService (`ctx.inputTriggers`): the root half of the trigger pipeline — the
 * stateless source registry plus the per-session controller map. Every piece
 * of mutable interaction state (hit, menu, fetch) lives on the
 * {@link InputTriggerController}; the service only registers sources, resolves
 * controllers by session scope, and relays roster changes.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InputTriggerSource } from '../types.ts'
import { InputTriggerController, promptHost, sessionHost } from './controller.ts'
import type { InputTriggerServiceContract, PromptControllerOptions } from './contract.ts'

/**
 * All mutable service state in one holder: cordis service methods run behind
 * the caller-ctx tracker, so mutation goes through one property read — never
 * field assignment on `this`.
 */
interface LiveState {
  /** Registration order = menu group order = matchSpace/matchEnter poll order. */
  readonly sources: InputTriggerSource[]
  /** Per-session controllers; entries are deleted by their scope disposer. */
  readonly controllers: WeakMapWithValues<SessionBinding, InputTriggerController>
  readonly occurrences: Map<string, InputTriggerController>
  /** The number of prompt occurrences opened so far; with {@link LiveState.keyPrefix} it mints their keys. */
  opened: number
  /**
   * Distinct for each service instance, so that a service loaded again never mints a key that a mounted occurrence of
   * the service it replaced still holds.
   */
  readonly keyPrefix: string
}

/** The `ctx.inputTriggers` trigger pipeline service (root registry + controller resolution). */
export class InputTriggerService extends Service implements InputTriggerServiceContract {
  static inject = ['sessions']

  private readonly live: LiveState = {
    sources: [], controllers: new WeakMapWithValues(), occurrences: new Map(), opened: 0,
    keyPrefix: Math.random().toString(36).slice(2, 10),
  }

  /**
   * @param ctx - owning root context (the service registers itself as `slash`).
   */
  constructor(ctx: Context) {
    super(ctx, 'inputTriggers')
    ctx.on('locale/change', () => {
      for (const controller of [...this.live.controllers.values, ...this.live.occurrences.values()]) controller.refreshOpenMenu()
    })
    // The prompt controllers go with the service; a mounted occurrence keeps a closed controller until it closes.
    ctx.effect(() => () => {
      for (const controller of this.live.occurrences.values()) controller.dispose()
      this.live.occurrences.clear()
    }, 'slash: prompt controllers')
  }

  /**
   * Register one trigger source. Live session controllers are notified so a
   * source arriving after scope birth still warms and joins the lexicon.
   * @param src - the source; (trigger, name) must be unique — duplicates throw.
   * @returns the disposer (callers wrap registration in ctx.effect). Disposal
   * while a controller shows the source's menu group drops that group.
   */
  registerSource(src: InputTriggerSource): () => void {
    const { live } = this
    if (live.sources.some(s => s.trigger === src.trigger && s.name === src.name)) {
      throw new Error(`slash source "${src.trigger}${src.name}" is already registered`)
    }
    live.sources.push(src)
    for (const controller of [...live.controllers.values, ...live.occurrences.values()]) {
      try {
        controller.sourceAdded(src)
      } catch (error) {
        // Contain faulty source callbacks (warm/subscribeLexicon): the
        // registration must stand with a usable disposer and the remaining
        // controllers must still be notified.
        console.error(`[ui-input-trigger] source "${src.trigger}${src.name}" late-registration setup failed:`, error)
      }
    }
    return () => {
      const at = live.sources.indexOf(src)
      if (at < 0) return
      live.sources.splice(at, 1)
      for (const controller of [...live.controllers.values, ...live.occurrences.values()]) controller.sourceRemoved(src)
    }
  }

  /**
   * Resolve the per-session controller for one session scope (lazy; the
   * scope disposer removes and disposes it). Construction warms the source
   * roster once — sessions are always agent-backed, so scope birth is the
   * single prewarm moment.
   * @param actx - session-scope ctx.
   * @returns the resident controller.
   * @throws when the Context no longer belongs to a retained Session generation.
   */
  sessionOf(actx: ClientContext): InputTriggerController {
    const sessions = this.sessions()
    const session = sessions.sessionOf(actx)
    const binding = session === undefined ? undefined : sessions.binding(session.sessionId)
    if (binding === undefined || binding.session !== session) {
      throw new Error('slash.sessionOf requires a retained Session scope')
    }
    const id = binding.sessionId
    const { live } = this
    const existing = live.controllers.get(binding)
    if (existing !== undefined) return existing
    const controller = new InputTriggerController({
      host: sessionHost(binding.ctx, id),
      roster: {
        sources: trigger => live.sources.filter(s => s.trigger === trigger).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        all: () => live.sources,
      },
    })
    live.controllers.set(binding, controller)
    binding.ctx.effect(() => () => {
      controller.dispose()
      live.controllers.delete(binding)
    }, 'slash: session controller')
    return controller
  }

  controllerFor(options: PromptControllerOptions): { readonly key: string; readonly controller: InputTriggerController; dispose(): void } {
    const { live } = this
    live.opened += 1
    const key = `prompt-${live.keyPrefix}-${String(live.opened)}`
    const offered = (): InputTriggerSource[] => live.sources.filter(s => s.prompt !== undefined && options.sources().includes(s.name))
    const controller = new InputTriggerController({
      host: promptHost(options.context, options.deliver),
      roster: {
        sources: trigger => offered().filter(s => s.trigger === trigger).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        all: offered,
      },
    })
    live.occurrences.set(key, controller)
    return {
      key, controller,
      dispose: () => {
        controller.dispose()
        live.occurrences.delete(key)
      },
    }
  }

  occurrence(key: string): InputTriggerController | undefined {
    return this.live.occurrences.get(key)
  }

  private sessions(): ISessions {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('ui-input-trigger: sessions service unavailable')
    return sessions
  }
}
