/**
 * The account-status route that providers with a credential share: `GET /api/dv/<provider>/account` checks the saved
 * key and `POST` checks a candidate key without saving it. Both answer an {@link AccountStatus} with
 * `Cache-Control: no-store`. The helper also builds the catalog-route failure answers, so a client tells "key rejected"
 * from "could not connect" for any provider.
 *
 * @module @dv/models
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { AccountDetails, AccountStatus } from './types.ts'

/** The most characters of a candidate key that the `POST` body may carry. */
export const MAX_ACCOUNT_KEY_LENGTH = 512

/** The most characters of a `POST` body that the route reads. */
const MAX_BODY_LENGTH = 4096

/** Printable ASCII without spaces: what an HTTP bearer credential may contain. */
const KEY_PATTERN = new RegExp(`^[\\x21-\\x7e]{1,${MAX_ACCOUNT_KEY_LENGTH}}$`, 'u')

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Thrown by an account check when the host cannot run renders; the route answers `needs-setup` with the message. */
export class AccountNeedsSetupError extends Error {}

/** How a provider plugs its account check into {@link registerAccountRoute}. */
export interface AccountRouteOptions {
  /** The route segment in `/api/dv/<provider>/account`, such as `reactor`. */
  provider: string
  /** Names the route in the effect description, such as `Reactor account status`. */
  description: string
  /**
   * Reads the saved key. Returns undefined when none is saved; a throw answers `unavailable`.
   * @returns the saved key, or undefined.
   */
  savedKey: () => Promise<string | undefined>
  /**
   * Check one key against the provider. The key is never logged or echoed by the route; the check must not put it in
   * argv, environment variables or log lines.
   * @param key - the saved or candidate key.
   * @param signal - aborts the check at the request or the deadline.
   * @returns the account figures once the provider accepts the key.
   * @throws AccountNeedsSetupError when the host cannot run renders; an error for which `isRejected` is true when the
   * provider refuses the key; any other error answers `unavailable`.
   */
  check: (key: string, signal: AbortSignal) => Promise<AccountDetails>
  /**
   * Whether an error from `check` means the provider refused the key.
   * @param error - the rejection of `check`.
   * @returns true for a refusal, such as HTTP 401 or 403.
   */
  isRejected: (error: unknown) => boolean
  /** Deadline for one check, from the provider's validated configuration, in seconds. */
  timeoutSeconds: number
}

/**
 * Read the candidate key of a `POST` body.
 * @param request - the request.
 * @returns the key, or undefined when the body is not exactly `{ "key": <printable ASCII string, 1 to 512 characters> }`.
 */
async function candidateKey(request: Request): Promise<string | undefined> {
  const text = await request.text()
  if (text.length > MAX_BODY_LENGTH) return undefined
  let body: unknown
  try { body = JSON.parse(text) } catch (_notJson) { return undefined }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const fields = Object.entries(body)
  const [first] = fields
  return fields.length === 1 && first?.[0] === 'key' && typeof first[1] === 'string' && KEY_PATTERN.test(first[1]) ? first[1] : undefined
}

/**
 * Run a check and map its result or rejection to an {@link AccountStatus}. A label that contains the key is dropped.
 * @param key - the key to check.
 * @param options - the provider's check and its rejection test.
 * @param signal - the signal for the check.
 * @returns the status.
 */
async function status(key: string, options: AccountRouteOptions, signal: AbortSignal): Promise<AccountStatus> {
  try {
    const details = await options.check(key, signal)
    return { status: 'connected', ...details, label: details.label?.includes(key) === true ? null : details.label }
  } catch (error) {
    if (error instanceof AccountNeedsSetupError) return { status: 'needs-setup', message: error.message }
    return { status: options.isRejected(error) ? 'rejected' : 'unavailable' }
  }
}

/**
 * Register `GET` and `POST /api/dv/<provider>/account` on `connection.fetch` as an effect of the calling plugin. `GET`
 * checks the saved key, or answers `missing` without calling the provider. `POST` takes `{ "key": "<candidate>" }`,
 * checks that key without saving it, and answers 400 with `{ "error": ... }` for any other body. Neither route logs
 * or echoes a key.
 * @param ctx - the provider's context; the route registers while the `connection` service is present.
 * @param options - the provider's key lookup, check and deadline.
 */
export function registerAccountRoute(ctx: Context, options: AccountRouteOptions): void {
  ctx.inject(['connection'], scope => scope.effect(() => scope.connection.fetch.register({
    path: `/api/dv/${options.provider}/account`, methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const check = async (key: string): Promise<Response> => Response.json(
        await status(key, options, AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutSeconds * 1000)])),
        { headers: NO_STORE })
      if (request.method === 'POST') {
        const key = await candidateKey(request)
        if (key === undefined) {
          return Response.json({ error: `Send a JSON object with one "key" field: a key of 1 to ${MAX_ACCOUNT_KEY_LENGTH} printable characters.` },
            { status: 400, headers: NO_STORE })
        }
        return check(key)
      }
      let saved: string | undefined
      try { saved = await options.savedKey() } catch (_unreadable) {
        return Response.json({ status: 'unavailable' } satisfies AccountStatus, { headers: NO_STORE })
      }
      return saved === undefined ? Response.json({ status: 'missing' } satisfies AccountStatus, { headers: NO_STORE }) : check(saved)
    },
  }), options.description))
}

/**
 * The catalog-route answer when no key is saved.
 * @param label - the provider's display name, such as `Reactor`.
 * @returns HTTP 503 with `{ "error": ... }`.
 */
export function catalogMissingKey(label: string): Response {
  return Response.json({ error: `Set the ${label} API key on the host.` }, { status: 503 })
}

/**
 * The catalog-route answer when the catalog request failed.
 * @param label - the provider's display name, such as `Reactor`.
 * @param rejected - whether the provider refused the key (HTTP 401 or 403 upstream).
 * @returns HTTP 401 for a refused key, otherwise 502, with `{ "error": ... }`.
 */
export function catalogFailure(label: string, rejected: boolean): Response {
  return rejected
    ? Response.json({ error: `${label} rejected the API key.` }, { status: 401 })
    : Response.json({ error: `Could not load ${label} models. Check the API key and connection.` }, { status: 502 })
}
