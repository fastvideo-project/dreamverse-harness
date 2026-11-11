/** Tracked native FastVideo jobs; submission happens once and polling never resubmits work. */
import { setTimeout as delay } from 'node:timers/promises'
import type { Response as UndiciResponse } from 'undici'
import { backendErrorText, GenerationSegmentError } from './errors.ts'

type NativeResponse = Response | UndiciResponse
/** The request fields shared by native and injected HTTP transports. */
export interface NativeRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

type NativeRequest = (url: URL, init?: NativeRequestInit) => Promise<NativeResponse>

async function checked(response: NativeResponse): Promise<NativeResponse> {
  if (response.ok) return response
  const text = await backendErrorText(response)
  if (response.status === 400 || response.status === 422) throw new GenerationSegmentError(text)
  throw new Error(`FastVideo job request refused (HTTP ${response.status}): ${text}`)
}

/**
 * Submit one native job, follow its ID, and fetch its completed video.
 * @param base - native server origin.
 * @param body - validated generation request.
 * @param pollMs - delay between job state reads.
 * @param request - authenticated transport owned by the caller.
 * @param signal - operation lifetime; cancellation deletes this job only.
 * @returns the completed content response.
 */
export async function followVideoJob(base: URL, body: Record<string, unknown>, pollMs: number,
  request: NativeRequest, signal?: AbortSignal): Promise<NativeResponse> {
  const created = await checked(await request(new URL('/v1/videos', base), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    ...signal === undefined ? {} : { signal },
  }))
  const value: unknown = await created.json()
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
    throw new Error('FastVideo did not return a generation job ID')
  }
  const route = new URL(`/v1/videos/${encodeURIComponent(value.id)}`, base)
  const options = signal === undefined ? {} : { signal }
  try {
    for (;;) {
      const response = await checked(await request(route, options))
      const state: unknown = await response.json()
      if (typeof state !== 'object' || state === null || !('status' in state)) throw new Error('Invalid FastVideo job state')
      if (state.status === 'completed') return await checked(await request(new URL(route.href + '/content'), options))
      if (state.status === 'failed') {
        const error = 'error' in state ? state.error : null
        const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message.slice(0, 2048) : 'FastVideo generation failed'
        throw new Error(message)
      }
      if (state.status !== 'queued' && state.status !== 'in_progress') throw new Error('Unknown FastVideo job status')
      await delay(pollMs, undefined, options)
    }
  } catch (error) {
    if (signal?.aborted) {
      // The backend owns CUDA cancellation and retains its generation lock until quiescent.
      await request(route, { method: 'DELETE', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
      throw signal.reason
    }
    throw error
  }
}
