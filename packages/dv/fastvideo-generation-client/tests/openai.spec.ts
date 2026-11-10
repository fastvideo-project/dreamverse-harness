/** The current FastVideo HTTP API returns a whole MP4; DreamVerse still receives a last frame and render events. */
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, watch } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import DvFastvideoGeneration, { GenerationSegmentError, type ModelFacts, type SegmentOutput, type SegmentRequest } from '../src/index.ts'
import type { OpenAIConfig } from '../src/openai.ts'

const FFMPEG = process.env['DV_FFMPEG'] ?? 'ffmpeg'
const run = promisify(execFile)
const facts: ModelFacts = {
  modelId: 'fasth3-nvfp4', aspectRatios: ['16:9'], resolutions: ['480p'],
  minSegmentDurationSec: 5, maxSegmentDurationSec: 5, maxReferences: 12,
  referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } },
  frameSizes: { '16:9': { '480p': [832, 480] } }, numFramesByDurationSec: { 5: 124 },
}
const roots: Context[] = []
const servers: Server[] = []
const folders: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }))
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })))
})

/** Start a backend that records JSON requests and returns one configured response. */
async function backend(
  reply: (path: string, response: ServerResponse) => void, ffmpegPath = FFMPEG,
  options: Partial<OpenAIConfig> = {}, apiKeyFile?: string,
) {
  const requests: Array<{ path: string; body: Record<string, unknown>; authorization?: string }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.once('end', () => {
      const path = request.url ?? ''
      requests.push({ path, body: chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
        ...request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization } })
      reply(path, response)
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const root = new Context()
  roots.push(root)
  const client = new DvFastvideoGeneration(root, {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    openai: { modelFacts: facts, ffmpegPath, ...options },
    ...apiKeyFile === undefined ? {} : { apiKeyFile },
  })
  return { client, requests }
}

/** Collect the client-visible generation events. */
async function collect(client: DvFastvideoGeneration, updates: Partial<SegmentRequest> = {}): Promise<SegmentOutput[]> {
  const outputs: SegmentOutput[] = []
  for await (const output of client.generateSegment({
    prompt: 'A lake', frameWidth: 832, frameHeight: 480, numFrames: 124, references: [], returnLastFrame: false, ...updates,
  })) outputs.push(output)
  return outputs
}

describe('FastVideo OpenAI transport', () => {
  it('authenticates discovery, lifecycle and every async job request using the worker credential file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dv-worker-credential-'))
    folders.push(dir)
    const token = 'fixture-worker-credential-000000000000000000'
    const credential = join(dir, 'worker.token')
    await writeFile(credential, token, { mode: 0o600 })
    const { client, requests } = await backend((path, response) => {
      response.setHeader('content-type', 'application/json')
      if (path.startsWith('/v1/model_info')) response.end(JSON.stringify({ served_model_name: facts.modelId }))
      else if (path.startsWith('/v1/model_state')) response.end(JSON.stringify({ installed: true, loaded_model: facts.modelId, loading_model: null, busy: false }))
      else if (path === '/v1/videos') response.end(JSON.stringify({ id: 'job-auth' }))
      else if (path === '/v1/videos/job-auth') response.end(JSON.stringify({ status: 'completed' }))
      else if (path.endsWith('/content')) { response.setHeader('content-type', 'video/mp4'); response.end('media') }
      else response.end('{}')
    }, FFMPEG, { managed: true, task: 'ref2va' }, credential)
    await client.model()
    await client.modelStatus()
    await client.loadModel()
    await client.unloadModel()
    await collect(client)
    expect(requests).toHaveLength(7)
    expect(requests.every(request => request.authorization === `Bearer ${token}`)).toBe(true)
    expect(requests.every(request => !JSON.stringify(request.body).includes(token))).toBe(true)
  })

  it('uses native async jobs on a fixed Ray server without model-catalog discovery', async () => {
    const { client, requests } = await backend((path, response) => {
      response.setHeader('content-type', 'application/json')
      if (path === '/v1/videos') response.end(JSON.stringify({ id: 'ray-job' }))
      else if (path === '/v1/videos/ray-job') response.end(JSON.stringify({ status: 'completed' }))
      else { response.setHeader('content-type', 'video/mp4'); response.end('ray-video') }
    }, FFMPEG, { asyncJobs: true })
    await collect(client)
    expect(requests.map(request => request.path)).toEqual(['/v1/videos', '/v1/videos/ray-job', '/v1/videos/ray-job/content'])
  })
  it('submits a managed generation once, polls the same job, and gets its media', async () => {
    let polls = 0
    const { client, requests } = await backend((path, response) => {
      response.setHeader('content-type', 'application/json')
      if (path === '/v1/videos') response.end(JSON.stringify({ id: 'job-1', status: 'queued' }))
      else if (path === '/v1/videos/job-1') response.end(JSON.stringify({ id: 'job-1', status: ++polls === 1 ? 'in_progress' : 'completed' }))
      else if (path === '/v1/videos/job-1/content') {
        response.setHeader('content-type', 'video/mp4')
        response.end('video-bytes')
      } else { response.writeHead(404); response.end() }
    }, FFMPEG, { managed: true, task: 'ref2va', pollIntervalMs: 1 })
    const outputs = await collect(client)
    expect(outputs.find(output => output.kind === 'chunk')).toMatchObject({ bytes: Buffer.from('video-bytes') })
    expect(requests.map(request => request.path)).toEqual(['/v1/videos', '/v1/videos/job-1', '/v1/videos/job-1', '/v1/videos/job-1/content'])
    expect(requests[0]?.body['task']).toBe('ref2va')
  })

  it('reports a failed native job without fetching content or resubmitting', async () => {
    const { client, requests } = await backend((path, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(path === '/v1/videos' ? { id: 'job-2' }
        : { status: 'failed', error: { message: 'Insufficient GPU memory' } }))
    }, FFMPEG, { managed: true })
    await expect(collect(client)).rejects.toThrow('Insufficient GPU memory')
    expect(requests.map(request => request.path)).toEqual(['/v1/videos', '/v1/videos/job-2'])
  })

  it('queries a catalog alias and sends native lifecycle requests without generating', async () => {
    const { client, requests } = await backend((path, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(path.startsWith('/v1/model_info') ? { served_model_name: facts.modelId }
        : { installed: true, loaded_model: facts.modelId, loading_model: null, busy: false }))
    }, FFMPEG, { managed: true, task: 'ref2va' })
    expect(await client.model()).toEqual(facts)
    expect(await client.modelStatus()).toEqual({ installed: true, loaded: true, loading: false, busy: false })
    await client.loadModel()
    await client.unloadModel()
    expect(requests.map(request => request.path)).toEqual([
      '/v1/model_info?model=fasth3-nvfp4&task=ref2va', '/v1/model_state?model=fasth3-nvfp4', '/v1/models/load', '/v1/models/unload',
    ])
    expect(requests[2]?.body).toEqual({ model: facts.modelId, task: 'ref2va' })
  })
  it('checks the served alias before caching explicit deployment facts', async () => {
    const { client, requests } = await backend((_path, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ served_model_name: facts.modelId }))
    })
    expect(await client.model()).toEqual(facts)
    expect(await client.model()).toBe(await client.model())
    expect(requests.map(request => request.path)).toEqual(['/v1/model_info'])
  })

  it('refuses facts for a different served model', async () => {
    const { client } = await backend((_path, response) => { response.end(JSON.stringify({ served_model_name: 'another-model' })) })
    await expect(client.model()).rejects.toThrow('FastVideo serves another-model, expected fasth3-nvfp4')
  })

  it('sends typed references with their MIME types and returns an actual last-frame PNG', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dv-openai-video-'))
    folders.push(dir)
    const path = join(dir, 'video.mp4')
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1:r=8',
      '-pix_fmt', 'yuv420p', path])
    const video = await readFile(path)
    const { client, requests } = await backend((_path, response) => {
      response.writeHead(200, { 'content-type': 'video/mp4', 'x-inference-time-s': '1.25' })
      response.end(video)
    })
    const outputs = await collect(client, { seed: 42, returnLastFrame: true, references: [
      { mediaType: 'image', mimeType: 'image/jpeg', bytes: Buffer.from('picture') },
      { mediaType: 'video', mimeType: 'video/webm', bytes: Buffer.from('clip') },
      { mediaType: 'audio', mimeType: 'audio/mpeg', bytes: Buffer.from('sound') },
    ] })
    expect(requests).toEqual([{ path: '/v1/videos/sync', body: {
      model: facts.modelId, prompt: 'A lake', width: 832, height: 480, num_frames: 124, seed: 42,
      image_reference: [{ image_url: 'data:image/jpeg;base64,cGljdHVyZQ==' }],
      video_reference: [{ video_url: 'data:video/webm;base64,Y2xpcA==' }],
      audio_reference: [{ audio_url: 'data:audio/mpeg;base64,c291bmQ=' }],
    } }])
    expect(outputs.map(output => output.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    const first = outputs[0]
    expect(first?.kind === 'last_frame' && first.png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(outputs[2]).toEqual({ kind: 'chunk', bytes: video })
    expect(outputs[3]).toEqual({ kind: 'done', timings: { inference_s: 1.25 } })
  })

  it.each([400, 422, 500])('reports HTTP %s without producing media', async (status) => {
    const { client } = await backend((_path, response) => { response.writeHead(status); response.end('rejected') })
    await expect(collect(client)).rejects.toThrow(status === 500 ? `HTTP ${status}: rejected` : GenerationSegmentError)
  })

  it('extracts the final server exception and bounds oversized errors before returning them to the agent', async () => {
    const trace = `Traceback (most recent call last):\n${'  internal stack frame\n'.repeat(5000)}RuntimeError: ninja is required`
    const { client } = await backend((_path, response) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: trace } }))
    })
    await expect(collect(client)).rejects.toThrow('HTTP 500: RuntimeError: ninja is required')
    const oversized = await backend((_path, response) => { response.writeHead(500); response.end('x'.repeat(20_000)) })
    const error: unknown = await collect(oversized.client).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error('Expected a backend error')
    expect(error.message.length).toBeLessThan(2200)
    expect(error.message).toContain('truncated; see FastVideo server logs')
  })

  it('rejects non-video successful responses and invalid reference media', async () => {
    const { client, requests } = await backend((_path, response) => { response.end('not video') })
    await expect(collect(client)).rejects.toThrow('non-video response')
    await expect(collect(client, { references: [{ mediaType: 'text', bytes: Buffer.from('text') }] }))
      .rejects.toThrow('Unsupported reference media type text')
    await expect(collect(client, { references: [{ mediaType: 'image', mimeType: 'audio/wav', bytes: Buffer.from('text') }] }))
      .rejects.toThrow('Reference MIME type does not match its media type')
    expect(requests).toHaveLength(1)
  })

  it('propagates an abort while waiting for a generation and closes the HTTP connection', async () => {
    let begun!: () => void
    let closed!: () => void
    const started = new Promise<void>((resolve) => { begun = resolve })
    const disconnected = new Promise<void>((resolve) => { closed = resolve })
    const { client } = await backend((_path, response) => { response.once('close', closed); begun() })
    const controller = new AbortController()
    const reason = new Error('Cancelled by user')
    const result = expect(collect(client, { signal: controller.signal })).rejects.toBe(reason)
    await started
    controller.abort(reason)
    await result
    await disconnected
  })

  it.skipIf(process.platform === 'win32')('waits for cancelled ffmpeg to exit before removing its media directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dv-openai-process-'))
    folders.push(dir)
    const script = join(dir, 'ffmpeg')
    const started = join(dir, 'started')
    const terminated = join(dir, 'terminated')
    const release = join(dir, 'release')
    // The child acknowledges SIGTERM but remains alive until this test releases it.
    await writeFile(script, `#!${process.execPath}
const fs = require('node:fs');
process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(terminated)}, 'ack'));
const watcher = fs.watch(${JSON.stringify(dir)}, () => {
  if (fs.existsSync(${JSON.stringify(release)})) { watcher.close(); process.exit(1); }
});
fs.writeFileSync(${JSON.stringify(started)}, process.argv[process.argv.indexOf('-i') + 1]);
`, { mode: 0o700 })
    const watcher = watch(dir)
    const waitFor = async (path: string) => {
      while (!existsSync(path)) await once(watcher, 'change')
    }
    const { client } = await backend((_path, response) => {
      response.writeHead(200, { 'content-type': 'video/mp4' }); response.end('VIDEO')
    }, script)
    const controller = new AbortController()
    const reason = new Error('Cancel frame extraction')
    let settled = false
    const result = collect(client, { returnLastFrame: true, signal: controller.signal })
      .then(() => { settled = true; return null }, (error: unknown) => { settled = true; return error })
    try {
      await waitFor(started)
      const input = await readFile(started, 'utf8')
      controller.abort(reason)
      await waitFor(terminated)
      expect(settled).toBe(false)
      expect(existsSync(input)).toBe(true)
      await writeFile(release, 'exit')
      expect(await result).toBe(reason)
      expect(existsSync(input)).toBe(false)
    } finally {
      await writeFile(release, 'exit')
      await result
      watcher.close()
    }
  })
})
