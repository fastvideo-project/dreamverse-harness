/**
 * What the Feedback dialog sends: the person's draft and where the browser is, as the body of `POST /api/dv/feedback`.
 *
 * @module @dv/ui-feedback/client/submission
 */
import type { FeedbackArea, FeedbackAttachment, FeedbackKind, FeedbackSubmission } from '@dv/feedback/types'
import { DvApiError } from '@dv/ui-kit/api.ts'
import { getCurrentProject } from '@dv/ui-kit/current-project.ts'

/** The route that `@dv/feedback` serves. */
export const FEEDBACK_ROUTE = '/api/dv/feedback'

/** What the person filled in. */
export interface FeedbackDraft {
  /** What they share. */
  kind: FeedbackKind
  /** The parts of DreamVerse it relates to, in the order the dialog lists them. */
  areas: FeedbackArea[]
  /** Their text. */
  description: string
  /** The screenshots or logs they attached, in the order they added them. */
  files: File[]
  /** The email address they left, possibly blank. */
  email: string
}

/**
 * Read a file as standard base64.
 * @param file - the file.
 * @returns the attachment with the file's name, MIME type and bytes.
 */
function readAttachment(file: File): Promise<FeedbackAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // A data URL is `data:<type>;base64,<data>`; the bytes follow the first comma.
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve({ name: file.name, type: file.type, data: url.slice(url.indexOf(',') + 1) })
    }
    reader.onerror = () => { reject(reader.error ?? new Error(`could not read ${file.name}`)) }
    reader.readAsDataURL(file)
  })
}

/**
 * The body of a submission: the draft with its files read, the open project, the view and chat session that
 * `@dv/ui-shell` writes into the URL hash (`#project=<id>&view=<view>&session=<id>`), and the build and browser. The
 * query string, which can carry the access token, is never read.
 * @param draft - what the person filled in.
 * @returns the body.
 */
export async function submissionOf(draft: FeedbackDraft): Promise<FeedbackSubmission> {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const ratio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const email = draft.email.trim()
  return {
    kind: draft.kind, areas: draft.areas, description: draft.description,
    attachments: await Promise.all(draft.files.map(readAttachment)),
    email: email === '' ? null : email,
    project: getCurrentProject(),
    session: hash.get('session'),
    view: hash.get('view'),
    locale: document.documentElement.lang,
    screen: `${String(Math.round(window.screen.width * ratio))}x${String(Math.round(window.screen.height * ratio))}`,
    user_agent: navigator.userAgent,
    version: process.env.DSH_CLIENT_VERSION ?? null,
    commit: process.env.DSH_CLIENT_COMMIT_HASH ?? null,
  }
}

/**
 * Send a submission.
 * @param submission - the body.
 * @returns once the host reports that the feedback sheet stored the row.
 * @throws DvApiError with the host's explanation when the route answers an error status.
 */
export async function sendFeedback(submission: FeedbackSubmission): Promise<void> {
  const response = await fetch(FEEDBACK_ROUTE, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission),
  })
  if (response.ok) return
  const body: unknown = await response.json().catch(() => null)
  const error = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['error'] : undefined
  throw new DvApiError(response.status, typeof error === 'string' ? error : `HTTP ${String(response.status)}`)
}
