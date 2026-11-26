/** An in-process Reactor Clip Generation API for `fetch`: records every request and answers from a script. */
import { vi } from 'vitest'

/** One request that reached the fake API. */
export interface FakeCall {
  method: string
  url: string
  headers: Headers
  body: Uint8Array | null
  json: unknown
  redirect: RequestRedirect | undefined
  signal: AbortSignal | null
}

/** How the fake API answers; every field defaults to a successful two-poll generation. */
export interface FakeScript {
  /** Replies to `GET /generations/gen-1` in order; the last one repeats. */
  statuses?: Array<Response | (() => Response)>
  /** Reply to any request before the default routes; return undefined to fall through. */
  override?: (call: FakeCall) => Response | Promise<Response> | undefined
  /** Bytes of the signed `output.mp4` download. */
  video?: Uint8Array
  /** Origin that stands in for the Reactor API; other hosts reach the real `fetch`. */
  origin?: string
}

export const FILES_ORIGIN = 'https://files.example.test'
export const UPLOAD_ORIGIN = 'https://upload.example.test'
export const SIGNED_URL = `${FILES_ORIGIN}/output.mp4?signature=secret-signature`

/** A successful generation resource whose `files` carry the signed output. */
export function succeeded(extra: Record<string, unknown> = {}): Response {
  return Response.json({
    id: 'gen-1', model: 'reactor/fast-h3', status: 'succeeded', expires_at: '2026-01-01T00:00:00Z', error: null,
    files: [{ name: 'last_frame.png', content_type: 'image/png', url: `${FILES_ORIGIN}/last.png` },
      { name: 'output.mp4', content_type: 'video/mp4', url: SIGNED_URL }], ...extra,
  })
}

/** A non-final generation resource. */
export function pending(status: 'queued' | 'running', headers: Record<string, string> = {}): Response {
  return Response.json({ id: 'gen-1', status, files: null, expires_at: null, error: null }, { headers })
}

/** A failed generation resource. */
export function failed(code: string, message: string): Response {
  return Response.json({ id: 'gen-1', status: 'failed', files: null, expires_at: null, error: { code, message } })
}

/**
 * Install the fake API as the global `fetch`.
 * @param script - how the fake answers.
 * @returns every call in order; restore the real `fetch` with `vi.unstubAllGlobals()`.
 */
export function installFakeReactor(script: FakeScript = {}): FakeCall[] {
  const calls: FakeCall[] = []
  const api = script.origin ?? 'https://api.reactor.inc'
  const real = globalThis.fetch
  let polls = 0
  let files = 0
  const statuses = script.statuses ?? [() => succeeded()]
  vi.stubGlobal('fetch', async (input: URL | string | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (![api, UPLOAD_ORIGIN, FILES_ORIGIN].includes(url.origin)) return real(input, init)
    const body = init.body === undefined || init.body === null ? null
      : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : init.body as Uint8Array
    const call: FakeCall = {
      method: init.method ?? 'GET', url: url.toString(), headers: new Headers(init.headers), body,
      redirect: init.redirect, signal: init.signal ?? null,
      json: typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null,
    }
    calls.push(call)
    init.signal?.throwIfAborted()
    const forced = script.override?.(call)
    if (forced !== undefined) return forced
    const route = `${call.method} ${url.origin}${url.pathname}`
    if (route === `POST ${api}/files`) {
      files++
      return Response.json({ file_id: `file-${files}`, presigned_url: `${UPLOAD_ORIGIN}/put/${files}`, expires_at: 'later' }, { status: 201 })
    }
    if (route.startsWith(`PUT ${UPLOAD_ORIGIN}/put/`)) return new Response(null, { status: 200 })
    if (route === `POST ${api}/generations`) return Response.json({ id: 'gen-1', status: 'queued' }, { status: 202 })
    if (route === `GET ${api}/generations/gen-1`) {
      const next = statuses[Math.min(polls++, statuses.length - 1)]!
      return typeof next === 'function' ? next() : next.clone()
    }
    if (route === 'GET https://files.example.test/output.mp4') return new Response(new Uint8Array(script.video ?? [1, 2, 3]))
    if (route === `DELETE ${api}/sessions/gen-1`) return new Response(null, { status: 200 })
    return Response.json({ error: 'not_found', message: `No fake route for ${route}` }, { status: 404 })
  })
  return calls
}
