/**
 * OpenRouter's asynchronous video API and its image API. It never resubmits a paid request or follows provider-returned
 * URLs.
 */
import { setTimeout as delay } from 'node:timers/promises'
import { imageCatalog, videoCatalog } from './catalog.ts'
import type { ImageModel, VideoModel } from './types.ts'

/** One generated image as OpenRouter returns it. */
export interface OpenRouterImage { bytes: Buffer; mime: string }

export class OpenRouterApi {
  private readonly base: URL
  constructor(baseUrl: string, private readonly resolveKey: () => Promise<string>, private readonly pollMs: number,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch) {
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
      await response.body?.cancel()
      throw new Error(`OpenRouter API returned HTTP ${response.status}. Check the key, credit balance, and selected model.`)
    }
    return response
  }

  /** Read current choices. Metadata lookups are bounded; generation follows the operation lifetime. */
  async catalog(signal?: AbortSignal): Promise<VideoModel[]> {
    const deadline = AbortSignal.timeout(10_000)
    return videoCatalog(await (await this.call('videos/models', {
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })).json())
  }

  /** Read current image choices, bounded like the video catalog. */
  async imageCatalog(signal?: AbortSignal): Promise<ImageModel[]> {
    const deadline = AbortSignal.timeout(10_000)
    return imageCatalog(await (await this.call('images/models', {
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })).json())
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
        if (state.status === 'failed') throw new Error('OpenRouter video generation failed. Check the provider job before retrying.')
        if (state.status !== 'pending' && state.status !== 'in_progress') throw new Error('Unknown OpenRouter video job status.')
        await delay(this.pollMs, undefined, options)
      }
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason
      throw error
    }
  }
}
