/**
 * Provider sign-in state for the Models cards: the flows the Host offers over
 * the `authorization` Remote namespace and, per flow, the running attempt's
 * notices and open prompt. A card's flow key is `<settingsNs>/<provider>`,
 * which is the record key `llm-pi-ai` writes while its Loader entry keeps the
 * shipped `llm-pi-ai` id. Tokens never reach this store.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  AuthorizationAttemptFrame, AuthorizationFlowView, AuthorizationNotice, AuthorizationPromptId,
  AuthorizationPromptView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** The generated `authorization` Remote namespace this store calls. */
export type AuthorizationRemote = ClientContext['remote']['authorization']

/** The prompt an attempt is waiting on. */
export interface OpenSignInPrompt {
  readonly id: AuthorizationPromptId
  readonly prompt: AuthorizationPromptView
}

/** One flow's attempt as this browser started it. */
export type SignInAttempt =
  /** Streaming: what the human has been told so far and the question awaiting an answer. */
  | { readonly status: 'running'; readonly notices: readonly AuthorizationNotice[]; readonly prompt?: OpenSignInPrompt }
  /** Ended with the Host's diagnostic; cleared by the next start. */
  | { readonly status: 'failed'; readonly message: string }

/** What the cards render sign-in from. */
export interface SignInState {
  /** `idle` until the first list, so an unopened page fetches nothing. */
  readonly status: 'idle' | 'loading' | 'ready'
  /** Offered, registered flows from the latest successful list. */
  readonly flows: readonly AuthorizationFlowView[]
  /** Attempts this browser started, by flow key. */
  readonly attempts: Readonly<Record<string, SignInAttempt>>
  /** The latest refused list, answer, or sign-out, until the next success. */
  readonly error: string | null
}

/**
 * The flow key a provider card signs in with.
 * @param settingsNs - the card's settings namespace.
 * @param provider - the card's route id.
 * @returns the credential key the Host's flow writes.
 */
export function signInKey(settingsNs: string, provider: string): string {
  return `${settingsNs}/${provider}`
}

/** One store per Models plugin; attempts end with the plugin. */
export class SignInStore {
  /** The snapshot the cards render from. */
  readonly store: SnapshotStore<SignInState> = createSnapshotStore<SignInState>({
    status: 'idle', flows: [], attempts: {}, error: null,
  })

  private readonly running = new Map<string, AbortController>()
  /** Latest list wins; an older answer never overwrites a newer one. */
  private generation = 0

  /** @param remote - the bound `authorization` namespace. */
  constructor(private readonly remote: AuthorizationRemote) {}

  /**
   * Refresh the offered flows and their signed-in state.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.store.getSnapshot().status === 'idle') this.patch({ status: 'loading' })
    const response = await this.remote.list()
    if (generation !== this.generation) return
    this.patch(response.ok
      ? { status: 'ready', flows: response.value, error: null }
      : { status: 'ready', error: response.error.message })
  }

  /**
   * Start an attempt for one flow unless this browser already runs one.
   * @param key - the flow key.
   */
  start(key: string): void {
    if (this.running.has(key)) return
    const controller = new AbortController()
    this.running.set(key, controller)
    this.setAttempt(key, { status: 'running', notices: [] })
    void this.follow(key, controller)
  }

  /**
   * Answer the attempt's open prompt.
   * @param key - the flow key.
   * @param value - the typed text, or the chosen option id.
   * @returns after the Host accepted or refused the answer.
   */
  async answer(key: string, value: string): Promise<void> {
    const open = this.takePrompt(key)
    if (open === undefined) return
    const response = await this.remote.answer(key, open.id, value)
    if (!response.ok) this.patch({ error: response.error.message })
  }

  /**
   * Decline the attempt's open prompt; the attempt settles as cancelled.
   * @param key - the flow key.
   * @returns after the Host accepted or refused the decline.
   */
  async decline(key: string): Promise<void> {
    const open = this.takePrompt(key)
    if (open === undefined) return
    const response = await this.remote.decline(key, open.id)
    if (!response.ok) this.patch({ error: response.error.message })
  }

  /**
   * Withdraw the flow's attempt: this browser's own by closing its stream,
   * else one another browser started.
   * @param key - the flow key.
   * @returns after the withdrawal was sent.
   */
  async cancel(key: string): Promise<void> {
    const own = this.running.get(key)
    if (own !== undefined) {
      own.abort()
      this.running.delete(key)
      this.setAttempt(key, undefined)
      return
    }
    const response = await this.remote.cancel(key)
    if (!response.ok) this.patch({ error: response.error.message })
    await this.load()
  }

  /**
   * Delete the flow's stored credential.
   * @param key - the flow key.
   * @returns after the deletion and the refreshed list.
   */
  async signOut(key: string): Promise<void> {
    const response = await this.remote.signOut(key)
    if (!response.ok) {
      this.patch({ error: response.error.message })
      return
    }
    await this.load()
  }

  /** Withdraw every attempt this browser runs and ignore lists in flight. */
  dispose(): void {
    this.generation++
    for (const controller of this.running.values()) controller.abort()
    this.running.clear()
  }

  /** A withdrawn attempt writes nothing more, so a restart under the same key starts clean. */
  private async follow(key: string, controller: AbortController): Promise<void> {
    let failure: string | undefined
    try {
      for await (const frame of this.remote.begin({ key }, controller.signal)) {
        if (controller.signal.aborted) break
        this.onFrame(key, frame)
      }
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error)
    }
    if (controller.signal.aborted) return
    this.running.delete(key)
    this.setAttempt(key, failure === undefined ? undefined : { status: 'failed', message: failure })
    await this.load()
  }

  private onFrame(key: string, frame: AuthorizationAttemptFrame): void {
    const attempt = this.store.getSnapshot().attempts[key]
    /* v8 ignore next -- frames arrive only while this browser's attempt is running */
    if (attempt?.status !== 'running') return
    switch (frame.type) {
      case 'notice':
        this.setAttempt(key, { ...attempt, notices: [...attempt.notices, frame.notice] })
        return
      case 'prompt':
        this.setAttempt(key, { ...attempt, prompt: { id: frame.id, prompt: frame.prompt } })
        return
      case 'prompt-withdrawn':
        if (attempt.prompt?.id === frame.id) this.setAttempt(key, { status: 'running', notices: attempt.notices })
        return
      case 'settled':
        this.setAttempt(key, undefined)
        return
      /* v8 ignore next 2 -- closed-union backstop after generated Remote validation */
      default:
        assertNever(frame, 'authorization attempt frame')
    }
  }

  /** Remove and return the open prompt, so a second click cannot answer it twice. */
  private takePrompt(key: string): OpenSignInPrompt | undefined {
    const attempt = this.store.getSnapshot().attempts[key]
    if (attempt?.status !== 'running' || attempt.prompt === undefined) return undefined
    this.setAttempt(key, { status: 'running', notices: attempt.notices })
    return attempt.prompt
  }

  private setAttempt(key: string, attempt: SignInAttempt | undefined): void {
    const { [key]: _previous, ...rest } = this.store.getSnapshot().attempts
    this.patch({ attempts: attempt === undefined ? rest : { ...rest, [key]: attempt } })
  }

  private patch(next: Partial<SignInState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...next })
  }
}
