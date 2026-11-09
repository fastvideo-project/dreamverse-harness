/**
 * Wire types of DreamVerse feedback: the body that the sidebar's Feedback dialog sends to `POST /api/dv/feedback`, and
 * the row that the host sends on to the feedback sheet. Types only.
 *
 * @module @dv/feedback/types
 */

/** What a person shares: a problem, a feature suggestion, a question, or anything else. */
export type FeedbackKind = 'problem' | 'feature' | 'question' | 'other'

/** A part of DreamVerse that feedback relates to. */
export type FeedbackArea = 'quality' | 'files' | 'tools' | 'interface' | 'stability' | 'setup' | 'safety' | 'other'

/** One file the person attached, such as a screenshot or a session log. */
export interface FeedbackAttachment {
  /** The file name; not empty. */
  name: string
  /** The MIME type the browser reported; empty when the browser reported none. */
  type: string
  /** The file's bytes in standard base64. */
  data: string
}

/** The JSON body of `POST /api/dv/feedback`: what the person filled in and where the browser was when they sent it. */
export interface FeedbackSubmission {
  /** What the person shares. */
  kind: FeedbackKind
  /** The parts of DreamVerse it relates to: at least one, each at most once. */
  areas: FeedbackArea[]
  /** The person's text; not empty after trimming. */
  description: string
  /** The screenshots or logs the person attached; at least one. */
  attachments: FeedbackAttachment[]
  /** The email address the person left for a follow-up, or null when they left none. */
  email: string | null
  /** The project open in the shell, or null on the entry page. */
  project: string | null
  /** The chat session of the open project or entry page, or null while none is known. */
  session: string | null
  /** The view of the open project, such as `canvas` or `timeline`, or null on the entry page. */
  view: string | null
  /** The interface language, as `<html lang>` names it. */
  locale: string
  /** The physical screen resolution, such as `3840x2160`. */
  screen: string
  /** The browser's user agent. */
  user_agent: string
  /** The repository version of the client build, or null when the build embeds none. */
  version: string | null
  /** The git commit of the client build, or null when the build embeds none. */
  commit: string | null
}

/** The JSON row that the host sends to the feedback sheet: a submission and the ISO time at which the host received it. */
export interface FeedbackRow extends FeedbackSubmission {
  /** When the host received the submission, as an ISO 8601 UTC time. */
  time: string
}
