/** OpenRouter asynchronous video API. It never resubmits a job or follows provider-returned URLs. */
import { setTimeout as delay } from 'node:timers/promises'
import { videoCatalog } from './catalog.ts'
import type { VideoModel } from './types.ts'

export class OpenRouterVideos {
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
      throw new Error(`OpenRouter video API returned HTTP ${response.status}. Check the key, credit balance, and selected model.`)
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
