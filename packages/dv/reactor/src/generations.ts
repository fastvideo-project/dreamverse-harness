/**
 * Reactor's Clip Generation HTTP API: upload inputs with `POST /files`, submit with `POST /generations`, poll
 * `GET /generations/{id}`, download `output.mp4` from its signed URL, and cancel with `DELETE /sessions/{id}`.
 * It submits each paid generation once and never sends the API key to signed URLs.
 */
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { ClipRequest, Upload } from './client.ts'
import type { GenerationFields } from './profiles.ts'

/** Characters of Reactor's error message that an HTTP failure quotes. */
const REASON_LIMIT = 300
/** Longest wait between polls that a `Retry-After` header can request, in milliseconds. */
const RETRY_AFTER_LIMIT_MS = 60_000
/** Deadline for the cancellation request, which runs after the render's own deadline or abort. */
const CANCEL_TIMEOUT_MS = 10_000
const OUTPUT_NAME = 'output.mp4'

/** Timings of one generation, in seconds, under the keys of the render report. */
export type GenerationTimings = {
  reactor_upload_s: number
  reactor_generation_s: number
  reactor_download_s: number
}

/** The MP4 that a generation produced and the time each stage took. */
export interface GeneratedClip {
  bytes: Buffer
  timings: GenerationTimings
}

/** Settings of one generation. */
export interface GenerationOptions {
  /** HTTPS origin of the Reactor API. */
  apiBaseUrl: string
  apiKey: string
  /** Model name for the `model` field. */
  model: string
  fields: GenerationFields
  request: ClipRequest
  /** Wait between status polls, in milliseconds, when Reactor sends no `Retry-After`. */
  pollMs: number
  /** Deadline for upload, generation and download together. */
  timeoutSeconds: number
}

interface Generation {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  files: Array<{ name: string; url: string }> | null
  error: { code: string; message: string } | null
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

function oneLine(text: string, key: string): string {
  const clean = text.split(key).join('[key]').replace(/\s+/g, ' ').trim().replace(/\.$/, '')
  return clean.length > REASON_LIMIT ? `${clean.slice(0, REASON_LIMIT)}…` : clean
}

/** The `message` of an HTTP error body, single-line and without the key; null when the body is not JSON with one. */
async function errorReason(response: Response, key: string): Promise<string | null> {
  let body: unknown
  try { body = await response.json() } catch (_notJson) { return null } // an HTML or empty error page has no reason to quote
  const message = record(body)?.['message']
  return typeof message === 'string' && message.trim() !== '' ? oneLine(message, key) : null
}

function httpsUrl(value: string, what: string): URL {
  const url = URL.canParse(value) ? new URL(value) : undefined
  if (url?.protocol !== 'https:') throw new Error(`Reactor returned a ${what} that is not an HTTPS URL.`)
  return url
}

function parseGeneration(value: unknown): Generation {
  const body = record(value)
  const status = body?.['status']
  if (status !== 'queued' && status !== 'running' && status !== 'succeeded' && status !== 'failed') {
    throw new Error('Reactor returned an invalid generation status.')
  }
  const rawFiles = body?.['files']
  const files = Array.isArray(rawFiles)
    ? rawFiles.map((file: unknown) => ({ name: record(file)?.['name'], url: record(file)?.['url'] }))
    : null
  if (files?.some(file => typeof file.name !== 'string' || typeof file.url !== 'string') === true) {
    throw new Error('Reactor returned an invalid generation file list.')
  }
  const error = record(body?.['error'])
  return {
    status,
    files: files as Generation['files'],
    error: error === undefined ? null : {
      code: typeof error['code'] === 'string' ? error['code'] : 'unknown',
      message: typeof error['message'] === 'string' ? error['message'] : '',
    },
  }
}

/** Wait before the next poll: `Retry-After` seconds when Reactor sends a positive one, otherwise the configured interval. */
function pollDelay(response: Response, pollMs: number): number {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, RETRY_AFTER_LIMIT_MS) : pollMs
}

class GenerationSession {
  private readonly base: URL
  generationId: string | undefined

  constructor(readonly options: GenerationOptions, private readonly signal: AbortSignal) {
    this.base = new URL(options.apiBaseUrl)
  }

  /** An authenticated request that refuses redirects, so the key never reaches another origin. */
  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const { apiKey } = this.options
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${apiKey}`)
    const response = await fetch(new URL(path, this.base), { ...init, headers, redirect: 'error', signal: this.signal })
    if (response.status === 401) {
      await response.body?.cancel()
      throw new Error('Reactor rejected the API key. Set a valid Reactor key on the DreamVerse host.')
    }
    return response
  }

  private async checked(response: Response, action: string): Promise<Response> {
    if (response.ok) return response
    const reason = await errorReason(response, this.options.apiKey)
    const wait = response.headers.get('retry-after')
    throw new Error(`Reactor ${action} returned HTTP ${response.status}${reason === null ? '' : `: ${reason}`}.`
      + `${wait === null ? '' : ` Retry after ${wait} seconds.`} Check the key, billing, and model access.`)
  }

  private async json(response: Response, what: string): Promise<unknown> {
    try { return await response.json() } catch (_invalid) { throw new Error(`Reactor returned invalid JSON for ${what}.`) }
  }

  /** Upload one asset with `POST /files` and a `PUT` to the signed upload URL, and return its file ID. */
  async upload(asset: Upload): Promise<string> {
    const bytes = await readFile(asset.path, { signal: this.signal })
    const created = record(await this.json(await this.checked(await this.call('/files', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: asset.name, size: bytes.length, mime_type: asset.mime }),
    }), 'file upload'), 'a file upload'))
    const fileId = created?.['file_id']
    const target = created?.['presigned_url']
    if (typeof fileId !== 'string' || fileId === '' || typeof target !== 'string') {
      throw new Error('Reactor returned an invalid file upload.')
    }
    const put = await fetch(httpsUrl(target, 'upload URL'), {
      method: 'PUT', headers: { 'content-type': asset.mime }, body: bytes, redirect: 'error', signal: this.signal,
    })
    if (!put.ok) {
      await put.body?.cancel()
      throw new Error(`Reactor storage rejected the upload of ${asset.name} with HTTP ${put.status}.`)
    }
    return fileId
  }

  /** Submit the generation once and remember its ID. */
  async submit(input: Record<string, unknown>): Promise<string> {
    const created = record(await this.json(await this.checked(await this.call('/generations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.options.model, input }),
    }), 'generation request'), 'the generation request'))
    const id = created?.['id']
    if (typeof id !== 'string' || id === '') {
      throw new Error('Reactor did not return a generation ID; do not automatically resubmit this paid request.')
    }
    this.generationId = id
    return id
  }

  /** The generation resource, or the wait before asking again when Reactor is busy (HTTP 429 or 503). */
  async status(id: string): Promise<Generation | { retryMs: number }> {
    const response = await this.call(`/generations/${encodeURIComponent(id)}`)
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel()
      return { retryMs: pollDelay(response, this.options.pollMs) }
    }
    if (response.status === 410) {
      await response.body?.cancel()
      throw new Error('Reactor already deleted the generation result.')
    }
    const generation = parseGeneration(await this.json(await this.checked(response, 'generation status'), 'the generation status'))
    return generation.status === 'queued' || generation.status === 'running'
      ? { retryMs: pollDelay(response, this.options.pollMs) } : generation
  }

  /** Download one signed URL without credentials; it may redirect to storage because it carries no key. */
  async download(url: string): Promise<Buffer | null> {
    const response = await fetch(httpsUrl(url, 'clip URL'), { signal: this.signal })
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    return Buffer.from(await response.arrayBuffer())
  }

  /** Ask Reactor to cancel the generation; a failed request does not replace the error that stopped the render. */
  async cancel(reason: string): Promise<void> {
    if (this.generationId === undefined) return
    try {
      const response = await fetch(new URL(`/sessions/${encodeURIComponent(this.generationId)}`, this.base), {
        method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      await response.body?.cancel()
    } catch (_unreachable) {
      // The render already failed or was cancelled; Reactor ends the generation by itself when this request cannot reach it.
    }
  }
}

function inputOf(options: GenerationOptions, ids: Record<'images' | 'audio' | 'videos', string[]>, frames: Record<string, string>): Record<string, unknown> {
  const { request, fields } = options
  return {
    prompt: request.prompt, seconds: request.seconds, aspect: request.aspect,
    ...fields.resolution === true ? { resolution: request.resolution } : {},
    ...request.seed === undefined ? {} : { seed: request.seed },
    ...ids.images.length > 0 ? { reference_images: ids.images } : {},
    ...ids.audio.length > 0 ? { reference_audios: ids.audio } : {},
    ...ids.videos.length > 0 ? { reference_videos: ids.videos } : {},
    ...frames,
  }
}

/** Poll until the generation ends and return its `output.mp4` URL. */
async function awaitOutput(session: GenerationSession, id: string, signal: AbortSignal): Promise<string> {
  for (;;) {
    const state = await session.status(id)
    if ('retryMs' in state) {
      await delay(state.retryMs, undefined, { signal })
      continue
    }
    if (state.status === 'failed') {
      const { code, message } = state.error ?? { code: 'unknown', message: '' }
      throw new Error(`Reactor generation ${id} failed with ${code}${message === '' ? '' : `: ${oneLine(message, session.options.apiKey)}`}.`)
    }
    const url = state.files?.find(file => file.name === OUTPUT_NAME)?.url
    if (url === undefined) throw new Error(`Reactor generation ${id} finished without ${OUTPUT_NAME}.`)
    return url
  }
}

/**
 * Generate one clip through Reactor's Clip Generation API.
 * @param options - the endpoint, key, model field names, request and deadlines.
 * @param signal - cancels the generation. Reactor receives a cancellation request when it already accepted the submission.
 * @returns the MP4 bytes and the time spent uploading, generating and downloading.
 * @throws Error for an HTTP failure, a failed or expired generation, a response that is not valid, or the deadline; the
 *   signal's reason when the caller cancels.
 */
export async function generateClip(options: GenerationOptions, signal: AbortSignal): Promise<GeneratedClip> {
  signal.throwIfAborted()
  const { request, fields } = options
  const combined = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutSeconds * 1000)])
  const session = new GenerationSession(options, combined)
  const elapsed = (since: number): number => Math.round((performance.now() - since)) / 1000
  try {
    let mark = performance.now()
    const idsOf = (uploads: Upload[]): Promise<string[]> => Promise.all(uploads.map(asset => session.upload(asset)))
    const [images, audio, videos] = [await idsOf(request.images), await idsOf(request.audio), await idsOf(request.videos)]
    const frames: Record<string, string> = {}
    for (const [asset, field] of [[request.firstFrame, fields.first], [request.lastFrame, fields.last]] as const) {
      if (asset !== undefined && field !== undefined) frames[field] = await session.upload(asset)
    }
    const upload = elapsed(mark)
    mark = performance.now()
    const id = await session.submit(inputOf(options, { images, audio, videos }, frames))
    const url = await awaitOutput(session, id, combined)
    const generation = elapsed(mark)
    mark = performance.now()
    let bytes = await session.download(url)
    if (bytes === null) {
      // The signed URL may have expired; poll the same generation for a fresh one and try once more.
      bytes = await session.download(await awaitOutput(session, id, combined))
    }
    if (bytes === null || bytes.length === 0) throw new Error(`Reactor generation ${id} returned no downloadable ${OUTPUT_NAME}.`)
    return { bytes, timings: { reactor_upload_s: upload, reactor_generation_s: generation, reactor_download_s: elapsed(mark) } }
  } catch (error) {
    if (combined.aborted) {
      await session.cancel(signal.aborted ? 'Cancelled by the DreamVerse host.' : 'Exceeded the DreamVerse deadline.')
      if (signal.aborted) throw signal.reason
      throw new Error(`Reactor generation timed out after ${options.timeoutSeconds} seconds${session.generationId === undefined ? '' : ` (generation ${session.generationId}); Reactor was asked to cancel it`}.`)
    }
    throw error
  }
}
