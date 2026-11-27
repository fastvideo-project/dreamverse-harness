/**
 * Host owner of the `authorization` Remote namespace: the human-guided
 * sign-ins of `ctx.authorization` as a browser configuration page runs them.
 * Only flows the deployment lists in `flows` are reachable; every other
 * registered flow stays Host-only.
 * @module @deepseek-ai/dsh-api-authorization-controller
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { z as zod } from 'zod'
import type {
  AuthorizationAttemptFrame, AuthorizationBeginRequest, AuthorizationFlowView, AuthorizationPromptId,
  AuthorizationPromptView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/** Upper bound on one typed prompt answer; a pasted redirect URL is far below it. */
const MAX_ANSWER_LENGTH = 8192

const keySchema = zod.string().min(1).max(256)
const keyRequestSchema = zod.object({ key: keySchema })
const beginSchema = zod.object({ key: keySchema, method: zod.string().min(1).max(64).optional() })
const promptSchema = zod.object({ key: keySchema, id: zod.uuid() })
const answerSchema = promptSchema.extend({ value: zod.string().max(MAX_ANSWER_LENGTH) })

/** Parse the domain constraints that are more specific than generated TypeScript codecs. */
function parseRequest<T>(method: string, schema: zod.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
  }
  return parsed.data
}

/**
 * Copy exactly the fields the wire view declares, dropping the Host-local
 * `signal`.
 * @param prompt - the flow's question.
 * @param preferred - the deployment's preferred option id for this flow's select prompts.
 * @returns the question as the browser renders it.
 */
function promptView(prompt: AuthorizationPrompt, preferred: string | undefined): AuthorizationPromptView {
  switch (prompt.kind) {
    case 'select':
      return {
        kind: 'select',
        message: prompt.message,
        options: prompt.options.map(option => ({
          id: option.id,
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })),
        ...preferred !== undefined && prompt.options.some(option => option.id === preferred) ? { preferred } : {},
      }
    case 'text':
    case 'secret':
      return {
        kind: prompt.kind,
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    /* v8 ignore next 2 -- closed-union backstop; flows are typed same-process callers. */
    default:
      return assertNever(prompt, 'authorization prompt kind')
  }
}

/** One prompt waiting for the browser's answer. */
interface OpenPrompt {
  answer(value: string): void
  decline(): void
}

/** Authorization Controller deployment policy. */
export interface Config {
  /**
   * Credential keys (`<scope>/<id>`) whose flows the browser may list and run.
   * A registered flow absent here is unreachable over Remote.
   */
  flows: string[]
  /**
   * Per offered key, the select-prompt option the browser presents first, such
   * as a device-code method for a Host the browser cannot reach on loopback.
   */
  preferredOptions: Record<string, string>
}

/** Host service backing the generated `ctx.remote.authorization` namespace. */
export class AuthorizationController extends TypertRemoteService {
  static inject = ['authorization', 'credentials']

  static Config: z<Config> = z.object({
    flows: z.array(z.string()).required()
      .description('Credential keys (`<scope>/<id>`) whose sign-in flows the browser may list and run.'),
    preferredOptions: z.dict(z.string()).default({})
      .description('Per offered key, the select-prompt option id the browser presents first.'),
  })

  private readonly offered: readonly CredentialKey[]
  private readonly preferred: ReadonlyMap<CredentialKey, string>
  /** Open prompts of each running attempt, keyed by the attempt's credential key. */
  private readonly prompts = new Map<CredentialKey, Map<AuthorizationPromptId, OpenPrompt>>()

  /**
   * @param ctx - Host context carrying `ctx.authorization` and `ctx.credentials`.
   * @param config - the offered flow keys and their preferred options.
   * @throws TypeError when a configured key is not `<scope>/<id>`, or a preferred option names a key outside `flows`.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
    this.offered = [...new Set(config.flows.map(parseCredentialKey))]
    this.preferred = new Map(Object.entries(config.preferredOptions).map(([key, option]) => {
      const offered = this.offered.find(candidate => candidate === key)
      if (offered === undefined) {
        throw new TypeError(`authorization-controller: preferredOptions names "${key}", which is not in flows`)
      }
      return [offered, option]
    }))
  }

  /**
   * List the offered flows that are registered now, in configuration order.
   * A configured key whose owning plugin has not registered its flow is absent
   * until it does.
   * @returns one view per offered, registered flow.
   */
  @Remote
  async list(): Promise<AuthorizationFlowView[]> {
    const views: AuthorizationFlowView[] = []
    for (const key of this.offered) {
      const entry = this.ctx.authorization.describe(key)
      if (entry === undefined) continue
      const stored = await this.ctx.credentials.describeRecord(key)
      views.push({
        key,
        label: entry.label,
        methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
        inFlight: entry.inFlight,
        signedIn: stored.configured,
      })
    }
    return views
  }

  /**
   * Run one attempt and stream what the human must see and answer. Closing
   * the stream withdraws the attempt.
   * @param request - the offered key and the optional method id.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns notices, prompts, prompt withdrawals, then one `settled` frame.
   * @throws RemoteError `authorization/not-offered` for a key outside `flows` or without a
   *   registered flow; `authorization/failed` when an attempt is already running or the
   *   attempt fails (the stream then ends with that error).
   */
  @Remote({ mode: 'stream' })
  async *begin(request: AuthorizationBeginRequest, signal: AbortSignal): AsyncIterable<AuthorizationAttemptFrame> {
    const parsed = parseRequest('authorization.begin', beginSchema, request)
    const key = this.offeredKey(parsed.key)
    if (this.prompts.has(key) || this.ctx.authorization.describe(key)?.inFlight === true) {
      throw new RemoteError(
        'authorization/failed', `an authorization attempt for "${key}" is already running`,
        { key, code: 'ALREADY_IN_FLIGHT' })
    }
    const prompts = new Map<AuthorizationPromptId, OpenPrompt>()
    this.prompts.set(key, prompts)
    const queued: AuthorizationAttemptFrame[] = []
    let ended: { error: RemoteError } | 'settled' | undefined
    let wake: (() => void) | undefined
    const push = (frame: AuthorizationAttemptFrame): void => { queued.push(frame); wake?.() }
    const release = (): void => {
      for (const open of prompts.values()) open.decline()
      this.prompts.delete(key)
    }
    const interaction: AuthorizationInteraction = {
      notify: (notice) => {
        push({
          type: 'notice',
          notice: {
            message: notice.message,
            ...notice.url === undefined ? {} : { url: notice.url },
            ...notice.code === undefined ? {} : { code: notice.code },
          },
        })
      },
      prompt: prompt => new Promise<string>((resolve, reject) => {
        const id = randomUUID() as AuthorizationPromptId
        // Not a decline: a prompt its own flow retires is not the human saying no.
        const withdrawn = (): Error => new Error('authorization prompt withdrawn by its flow')
        if (prompt.signal?.aborted === true) {
          reject(withdrawn())
          return
        }
        const withdraw = (): void => {
          prompts.delete(id)
          push({ type: 'prompt-withdrawn', id })
          reject(withdrawn())
        }
        prompt.signal?.addEventListener('abort', withdraw, { once: true })
        // Settling removes the prompt and its abort listener together, so each prompt settles once.
        const settle = (): void => {
          prompt.signal?.removeEventListener('abort', withdraw)
          prompts.delete(id)
        }
        prompts.set(id, {
          answer: (value) => { settle(); resolve(value) },
          decline: () => { settle(); reject(new AuthorizationDeclinedError()) },
        })
        push({ type: 'prompt', id, prompt: promptView(prompt, this.preferred.get(key)) })
      }),
    }
    void this.ctx.authorization.begin({
      key, interaction, signal, ...parsed.method === undefined ? {} : { method: parsed.method },
    }).then(
      ({ status }) => { release(); push({ type: 'settled', status }); ended = 'settled'; wake?.() },
      (error: unknown) => { release(); ended = { error: failure(key, error) }; wake?.() },
    )
    try {
      for (;;) {
        const frame = queued.shift()
        if (frame !== undefined) {
          yield frame
          continue
        }
        if (ended === 'settled') return
        if (ended !== undefined) throw ended.error
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      // A consumer that stops reading early withdraws the attempt it started.
      if (ended === undefined) this.ctx.authorization.cancel(key)
    }
  }

  /**
   * Answer one open prompt of the key's running attempt.
   * @param key - the attempt's credential key.
   * @param id - the prompt id from the attempt stream.
   * @param value - the typed text, or the chosen option's id.
   * @throws RemoteError `authorization/no-prompt` when no open prompt has that id.
   */
  @Remote
  answer(key: string, id: AuthorizationPromptId, value: string): void {
    const parsed = parseRequest('authorization.answer', answerSchema, { key, id, value })
    this.openPrompt(parsed.key, parsed.id).answer(parsed.value)
  }

  /**
   * Decline one open prompt; the attempt settles as `cancelled`.
   * @param key - the attempt's credential key.
   * @param id - the prompt id from the attempt stream.
   * @throws RemoteError `authorization/no-prompt` when no open prompt has that id.
   */
  @Remote
  decline(key: string, id: AuthorizationPromptId): void {
    const parsed = parseRequest('authorization.decline', promptSchema, { key, id })
    this.openPrompt(parsed.key, parsed.id).decline()
  }

  /**
   * Withdraw the key's running attempt, if any.
   * @param key - credential key of an offered flow.
   * @throws RemoteError `authorization/not-offered` for a key outside `flows`.
   */
  @Remote
  cancel(key: string): void {
    const parsed = parseRequest('authorization.cancel', keyRequestSchema, { key })
    this.ctx.authorization.cancel(this.configuredKey(parsed.key))
  }

  /**
   * Withdraw any running attempt and delete the key's stored credential.
   * @param key - credential key of an offered flow.
   * @throws RemoteError `authorization/not-offered` for a key outside `flows`.
   */
  @Remote
  async signOut(key: string): Promise<void> {
    const parsed = parseRequest('authorization.signOut', keyRequestSchema, { key })
    const configured = this.configuredKey(parsed.key)
    this.ctx.authorization.cancel(configured)
    await this.ctx.credentials.deleteRecord(configured)
  }

  /** A configured key, whether or not its flow is registered. */
  private configuredKey(key: string): CredentialKey {
    const found = this.offered.find(candidate => candidate === key)
    if (found === undefined) {
      throw new RemoteError('authorization/not-offered', `"${key}" is not an offered sign-in`, { key })
    }
    return found
  }

  /** A configured key whose flow is registered now. */
  private offeredKey(key: string): CredentialKey {
    const configured = this.configuredKey(key)
    if (this.ctx.authorization.describe(configured) === undefined) {
      throw new RemoteError('authorization/not-offered', `no sign-in flow is registered for "${key}"`, { key })
    }
    return configured
  }

  /** The open prompt a browser call names. */
  private openPrompt(key: string, id: string): OpenPrompt {
    const open = this.prompts.get(this.configuredKey(key))?.get(id as AuthorizationPromptId)
    if (open === undefined) {
      throw new RemoteError('authorization/no-prompt', `no open prompt "${id}" for "${key}"`, { key, id })
    }
    return open
  }
}

/**
 * The Remote error one failed attempt ends its stream with.
 * @param key - the attempt's credential key.
 * @param error - what `ctx.authorization.begin()` rejected with.
 * @returns the error carrying the flow's message and, when present, its code.
 */
function failure(key: CredentialKey, error: unknown): RemoteError {
  const code = (error as { code?: unknown } | null)?.code
  return new RemoteError(
    'authorization/failed',
    error instanceof Error ? error.message : String(error),
    { key, ...typeof code === 'string' ? { code } : {} },
    { cause: error },
  )
}

export default AuthorizationController
