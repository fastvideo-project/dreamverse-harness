/**
 * Feedback of DreamVerse. While a Connection service is mounted, the plugin registers `POST /api/dv/feedback`, which
 * checks a submission of the sidebar's Feedback dialog and sends it, with the time it arrived, as one JSON row to the
 * configured endpoint: a Google Apps Script web app that saves the attached files to Drive and appends the row to a
 * sheet. The plugin writes nothing to the project, the session log or GitHub, and the endpoint URL never reaches the
 * browser.
 *
 * @module @dv/feedback
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { FeedbackArea, FeedbackAttachment, FeedbackKind, FeedbackRow, FeedbackSubmission } from './types.ts'

export type { FeedbackArea, FeedbackAttachment, FeedbackKind, FeedbackRow, FeedbackSubmission } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dv-feedback'

/** The Fetch route path, below the Connection's `/api` channel. */
export const FEEDBACK_ROUTE = '/api/dv/feedback'

/** Plugin config: where feedback goes and the bounds of one submission. */
export interface Config {
  /** The HTTPS URL of the web app that stores a row; it answers `{"ok": true}` once the row is stored. */
  endpoint: string
  /** Milliseconds to wait for the endpoint's answer, redirects included. */
  timeoutMs: number
  /** The most characters a description may have. */
  maxDescriptionChars: number
  /** The most files one submission may attach. */
  maxAttachments: number
  /** The most bytes one attached file may have, before base64. */
  maxAttachmentBytes: number
}

/** Runtime schema of {@link Config}. */
export const Config: z<Config> = z.object({
  endpoint: z.string().pattern(/^https:\/\/[^/\s]+\//).required(),
  timeoutMs: z.natural().min(1).default(30_000),
  maxDescriptionChars: z.natural().min(1).default(5_000),
  maxAttachments: z.natural().min(1).default(5),
  maxAttachmentBytes: z.natural().min(1).default(5 * 1024 * 1024),
})

// Complete records of the unions, so that a missing or foreign value is a compile error.
const KINDS = { problem: true, feature: true, question: true, other: true } satisfies Record<FeedbackKind, true>
const AREAS = {
  quality: true, files: true, tools: true, interface: true, stability: true, setup: true, safety: true, other: true,
} satisfies Record<FeedbackArea, true>
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
// One @ with no whitespace on either side: enough to catch a typo without rejecting a valid address.
const EMAIL = /^[^\s@]+@[^\s@]+$/u

/** A submission that the route refuses with status 400; the message names the field. */
class SubmissionError extends Error {}

/**
 * @param fields - the decoded body.
 * @param key - the field.
 * @returns the field's string.
 * @throws SubmissionError when the field is not a string.
 */
function text(fields: Record<string, unknown>, key: string): string {
  const value = fields[key]
  if (typeof value !== 'string') throw new SubmissionError(`${key} must be a string`)
  return value
}

/**
 * @param fields - the decoded body.
 * @param key - the field.
 * @returns the field's string, or null when the field is null.
 * @throws SubmissionError when the field is neither a string nor null.
 */
function textOrNull(fields: Record<string, unknown>, key: string): string | null {
  return fields[key] === null ? null : text(fields, key)
}

/**
 * @param value - one decoded entry of `attachments`.
 * @param maxBytes - the most bytes the file may have.
 * @returns the attachment.
 * @throws SubmissionError when a field is missing or the data is not base64 of at most `maxBytes` bytes.
 */
function attachment(value: unknown, maxBytes: number): FeedbackAttachment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SubmissionError('each attachment must be an object')
  const fields = value as Record<string, unknown>
  const name = text(fields, 'name')
  if (name.trim() === '') throw new SubmissionError('an attachment name must not be empty')
  const data = text(fields, 'data')
  if (!BASE64.test(data)) throw new SubmissionError(`attachment ${name} must be base64`)
  if (Buffer.byteLength(data, 'base64') > maxBytes) throw new SubmissionError(`attachment ${name} must have at most ${String(maxBytes)} bytes`)
  return { name, type: text(fields, 'type'), data }
}

/**
 * Check the JSON body of a request.
 * @param body - the decoded body.
 * @param limits - the most description characters, attachments, and bytes per attachment.
 * @returns the submission.
 * @throws SubmissionError when a field is missing, has the wrong type, or is out of range.
 */
export function parseSubmission(
  body: unknown, limits: Pick<Config, 'maxDescriptionChars' | 'maxAttachments' | 'maxAttachmentBytes'>,
): FeedbackSubmission {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new SubmissionError('the body must be a JSON object')
  const fields = body as Record<string, unknown>
  const kind = text(fields, 'kind')
  if (!Object.hasOwn(KINDS, kind)) throw new SubmissionError(`kind must be one of ${Object.keys(KINDS).join(', ')}`)
  const areas = fields['areas']
  if (!Array.isArray(areas) || areas.length === 0 || !areas.every(area => typeof area === 'string' && Object.hasOwn(AREAS, area))) {
    throw new SubmissionError(`areas must be a non-empty list of ${Object.keys(AREAS).join(', ')}`)
  }
  if (new Set(areas).size !== areas.length) throw new SubmissionError('areas must name each area at most once')
  const description = text(fields, 'description')
  if (description.trim() === '') throw new SubmissionError('description must not be empty')
  if (Array.from(description).length > limits.maxDescriptionChars) {
    throw new SubmissionError(`description must have at most ${String(limits.maxDescriptionChars)} characters`)
  }
  const files = fields['attachments']
  if (!Array.isArray(files) || files.length === 0) throw new SubmissionError('attachments must be a non-empty list')
  if (files.length > limits.maxAttachments) throw new SubmissionError(`attachments must have at most ${String(limits.maxAttachments)} files`)
  const email = textOrNull(fields, 'email')
  if (email !== null && !EMAIL.test(email)) throw new SubmissionError('email must be an address such as name@example.com')
  return {
    kind: kind as FeedbackKind, areas: areas as FeedbackArea[], description,
    attachments: files.map(file => attachment(file, limits.maxAttachmentBytes)), email,
    project: textOrNull(fields, 'project'), session: textOrNull(fields, 'session'), view: textOrNull(fields, 'view'),
    locale: text(fields, 'locale'), screen: text(fields, 'screen'), user_agent: text(fields, 'user_agent'),
    version: textOrNull(fields, 'version'), commit: textOrNull(fields, 'commit'),
  }
}

/**
 * Send a row to the endpoint. Apps Script answers a POST with a redirect to the script's output, which `fetch` follows.
 * @param config - the endpoint and its timeout.
 * @param row - the row.
 * @throws Error when the endpoint does not answer `{"ok": true}` with a success status within the timeout.
 */
export async function sendRow(config: Config, row: FeedbackRow): Promise<void> {
  const response = await fetch(config.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row), redirect: 'follow',
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  // An Apps Script that throws answers an HTML error page with status 200, so only the JSON acknowledgement counts.
  const reply: unknown = await response.json().catch(() => null)
  const ok = typeof reply === 'object' && reply !== null && (reply as Record<string, unknown>)['ok'] === true
  if (!response.ok || !ok) throw new Error(`the feedback endpoint answered HTTP ${String(response.status)} without {"ok": true}`)
}

/**
 * @param status - the HTTP status.
 * @param body - the JSON body.
 * @returns the response.
 */
function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * The route: 200 `{"ok": true}` once the endpoint stored the row, 400 `{"error"}` for a malformed submission, and 502
 * `{"error"}` when the endpoint failed. No answer names the endpoint.
 * @param config - the plugin config.
 * @returns the Fetch route.
 */
export function feedbackRoute(config: Config): ConnectionFetchRoute {
  return {
    path: FEEDBACK_ROUTE, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let submission: FeedbackSubmission
      try {
        submission = parseSubmission(await request.json(), config)
      } catch (error) {
        if (error instanceof SubmissionError) return json(400, { error: error.message })
        if (error instanceof SyntaxError) return json(400, { error: 'the body must be JSON' })
        throw error
      }
      try {
        await sendRow(config, { ...submission, time: new Date().toISOString() })
      } catch (error) {
        return json(502, { error: error instanceof Error ? error.message : String(error) })
      }
      return json(200, { ok: true })
    },
  }
}

/**
 * Register the route while a Connection service is mounted.
 * @param ctx - plugin context.
 * @param config - the plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['connection'], (connected) => {
    connected.effect(() => {
      const dispose = connected.connection.fetch.register(feedbackRoute(config))
      return () => { void dispose() }
    }, `dv-feedback ${FEEDBACK_ROUTE}`)
  })
}
