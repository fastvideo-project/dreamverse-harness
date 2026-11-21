/**
 * OpenRouter's asynchronous video API, its image API and its speech API. It never resubmits a paid request or follows
 * provider-returned URLs.
 */
import { setTimeout as delay } from 'node:timers/promises'
import { imageCatalog, speechCatalog, videoCatalog, videoReferences } from './catalog.ts'
import type { ImageModel, ReferenceMedia, SpeechModel, VideoModel } from './types.ts'

/** One generated image as OpenRouter returns it. */
export interface OpenRouterImage { bytes: Buffer; mime: string }

/** One spoken clip as OpenRouter returns it: MP3 (`audio/mpeg`) or raw PCM (`audio/pcm`). */
export interface OpenRouterSpeech { bytes: Buffer; mime: string }

/** Characters of OpenRouter's error message an HTTP failure quotes. */
const REASON_LIMIT = 300

/**
 * The `error.message` of a failed response's JSON body, single-line, without the API key, cut to `REASON_LIMIT`
 * characters; null when the body is not that JSON.
 */
async function errorReason(response: Response, key: string): Promise<string | null> {
  let body: { error?: { message?: unknown } } | null
  try { body = await response.json() as { error?: { message?: unknown } } | null } catch { return null } // not JSON: no reason to quote
  const message = body?.error?.message
  if (typeof message !== 'string' || message.trim() === '') return null
  const text = message.split(key).join('[key]').replace(/\s+/g, ' ').trim().replace(/\.$/, '')
  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}…` : text
}

/** An OpenRouter request rejected with an HTTP status. */
export class OpenRouterHttpError extends Error {
  /**
   * @param status - the upstream HTTP status.
   * @param message - the sanitized error description.
   */
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export class OpenRouterApi {
  private readonly base: URL
  constructor(baseUrl: string, private readonly resolveKey: () => Promise<string>, private readonly pollMs: number,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch, private readonly catalogTimeoutMs = 10_000) {
    this.base = new URL(baseUrl.replace(/\/?$/, '/'))
    if (!['http:', 'https:'].includes(this.base.protocol) || this.base.username !== '' || this.base.password !== ''
      || this.base.search !== '' || this.base.hash !== '') throw new Error('Invalid OpenRouter API base URL.')
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const key = await this.resolveKey()
    if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('Save a valid OpenRouter API key before generating.')
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${key}`)
    const response = await this.fetcher(new URL(path, this.base), { ...init, headers, redirect: 'error' })
    if (!response.ok) {
      const reason = await errorReason(response, key)
      throw new OpenRouterHttpError(response.status, `OpenRouter API returned HTTP ${response.status}${reason === null ? '' : `: ${reason}`}. `
        + 'Check the key, credit balance, and selected model.')
    }
    return response
  }

  /** The JSON of a catalog route. Metadata lookups are bounded by `catalogTimeoutMs`; generation follows the operation lifetime. */
  private async catalogJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.timeout(this.catalogTimeoutMs)
    return (await this.call(path, { signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]) })).json()
  }

  /**
   * Read current video choices from `videos/models`, with each model's reference media from the models catalog filtered
   * to video output.
   * @param signal - aborts both requests.
   * @returns the usable video models; every model has no reference media when only the models catalog fails.
   * @throws Error when `videos/models` fails or answers an invalid catalog; the signal's reason on abort.
   */
  async catalog(signal?: AbortSignal): Promise<VideoModel[]> {
    const [models, references] = await Promise.all([
      this.catalogJson('videos/models', signal),
      this.catalogJson('models?output_modalities=video', signal).then(videoReferences).catch((error: unknown) => {
        // A failed models catalog removes only task ref2v; the generation choices come from videos/models.
        if (signal?.aborted === true) throw error
        return new Map<string, ReferenceMedia[]>()
      }),
    ])
    return videoCatalog(models, references)
  }

  /**
   * Look up the key with `GET key` and read account credits with `GET credits` when the key is a management key.
   * @param signal - aborts both requests.
   * @returns The key label, the account credit in US dollars, and the key's own remaining spending limit in US dollars.
   * The balance is null for a key that cannot read credits or whose credits request failed; the limit is null when the key
   * has none. The two figures are never combined.
   * @throws OpenRouterHttpError when the key lookup fails; Error when the key metadata is invalid.
   */
  async account(signal: AbortSignal): Promise<{ balanceUsd: number | null; label: string | null; limitRemainingUsd: number | null }> {
    const key: unknown = await this.catalogJson('key', signal)
    if (typeof key !== 'object' || key === null || !('data' in key) || typeof key.data !== 'object' || key.data === null
      || !('is_management_key' in key.data) || typeof key.data.is_management_key !== 'boolean') {
      throw new Error('OpenRouter returned invalid key metadata.')
    }
    const label = 'label' in key.data && typeof key.data.label === 'string' ? key.data.label : null
    const limit = 'limit_remaining' in key.data ? key.data.limit_remaining : null
    if (limit !== null && (typeof limit !== 'number' || !Number.isFinite(limit))) throw new Error('OpenRouter returned invalid key metadata.')
    if (!key.data.is_management_key) return { balanceUsd: null, label, limitRemainingUsd: limit }
    const credits = await this.catalogJson('credits', signal).catch((error: unknown) => {
      if (signal.aborted) throw error
      return null
    }) as { data?: { total_credits?: unknown; total_usage?: unknown } } | null
    const total = credits?.data?.total_credits
    const used = credits?.data?.total_usage
    const balance = typeof total === 'number' && typeof used === 'number' ? total - used : NaN
    return { balanceUsd: Number.isFinite(balance) ? balance : null, label, limitRemainingUsd: limit }
  }

  /** Read current image choices. */
  async imageCatalog(signal?: AbortSignal): Promise<ImageModel[]> {
    return imageCatalog(await this.catalogJson('images/models', signal))
  }

  /** Read current speech choices from the models catalog filtered to speech output. */
  async speechCatalog(signal?: AbortSignal): Promise<SpeechModel[]> {
    return speechCatalog(await this.catalogJson('models?output_modalities=speech', signal))
  }

  /**
   * Speak once with `POST /audio/speech`, submitted once. The answer is the audio itself, typed by its content type.
   * @param body - the request body.
   * @param signal - aborts the request.
   * @returns the audio bytes and media type.
   * @throws Error for an HTTP failure or an answer that is not audio; the signal's reason on abort.
   */
  async speak(body: Record<string, unknown>, signal?: AbortSignal): Promise<OpenRouterSpeech> {
    signal?.throwIfAborted()
    const response = await this.call('audio/speech', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), ...signal === undefined ? {} : { signal } })
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || !mime.startsWith('audio/')) {
      throw new Error('OpenRouter returned no audio; do not automatically resubmit this paid request.')
    }
    return { bytes, mime }
  }

  /**
   * Generate one image with `POST /images`, submitted once. The answer's first `data` row carries the image as raw
   * base64 in `b64_json` and its type in `media_type`.
   * @param body - the request body.
   * @param signal - aborts the request.
   * @returns the image bytes and media type.
   * @throws Error for an HTTP failure or an answer without an image; the signal's reason on abort.
   */
  async generateImage(body: Record<string, unknown>, signal?: AbortSignal): Promise<OpenRouterImage> {
    signal?.throwIfAborted()
    const answer: unknown = await (await this.call('images', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), ...signal === undefined ? {} : { signal } })).json()
    const rows = typeof answer === 'object' && answer !== null && 'data' in answer && Array.isArray(answer.data) ? answer.data : []
    const first: unknown = rows[0]
    const b64 = typeof first === 'object' && first !== null && 'b64_json' in first ? first.b64_json : undefined
    const mime = typeof first === 'object' && first !== null && 'media_type' in first && typeof first.media_type === 'string'
      ? first.media_type : 'image/png'
    const bytes = typeof b64 === 'string' ? Buffer.from(b64, 'base64') : Buffer.alloc(0)
    if (bytes.length === 0 || !mime.startsWith('image/')) {
      throw new Error('OpenRouter returned no image; do not automatically resubmit this paid request.')
    }
    return { bytes, mime }
  }

  /** Submit once and monitor to completion. An abort stops monitoring; OpenRouter documents no cancellation route. */
  async generate(body: Record<string, unknown>, signal?: AbortSignal): Promise<{ video: Buffer; mime: string }> {
    signal?.throwIfAborted()
    try {
      const created: unknown = await (await this.call('videos', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...signal === undefined ? {} : { signal } })).json()
      if (typeof created !== 'object' || created === null || !('id' in created) || typeof created.id !== 'string' || created.id === '') {
        throw new Error('OpenRouter did not return a video job ID; do not automatically resubmit this paid request.')
      }
      const path = `videos/${encodeURIComponent(created.id)}`
      const options = signal === undefined ? {} : { signal }
      for (;;) {
        const state: unknown = await (await this.call(path, options)).json()
        if (typeof state !== 'object' || state === null || !('status' in state)) throw new Error('Invalid OpenRouter video job status.')
        if (state.status === 'completed') {
          const response = await this.call(path + '/content?index=0', options)
          const mime = response.headers.get('content-type') ?? ''
          if (!mime.startsWith('video/')) { await response.body?.cancel(); throw new Error('OpenRouter returned no video content.') }
          return { video: Buffer.from(await response.arrayBuffer()), mime }
        }
        if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'expired') {
          // OpenRouter reports the reason as a top-level `error` string; it can be absent or null.
          const reason = 'error' in state && typeof state.error === 'string' && state.error.trim() !== '' ? state.error.trim().slice(0, 500) : null
          throw new Error(`OpenRouter video generation ${state.status}${reason === null ? '' : `: ${reason}`}. `
            + 'Check the provider job before retrying.')
        }
        if (state.status !== 'pending' && state.status !== 'in_progress') throw new Error('Unknown OpenRouter video job status.')
        await delay(this.pollMs, undefined, options)
      }
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason
      throw error
    }
  }
}
