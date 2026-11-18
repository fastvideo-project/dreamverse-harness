/** Managed native jobs retain the merged sync client's MIME and content contract. No GPU is involved. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import DvFastvideoGeneration, { GenerationSegmentError, type Config, type SegmentRequest } from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

const facts = {
  modelId: 'pika', frameSizes: { '16:9': { '480p': [832, 480] as [number, number] } },
  numFramesByDurationSec: { 5: 124 }, maxReferences: 2, referenceMediaTypes: { image: { maxCount: 2 } },
}
const segment: SegmentRequest = { prompt: 'A lake', references: [], frameWidth: 832, frameHeight: 480, numFrames: 124 }
function json(value: unknown, status = 200): Response { return Response.json(value, { status }) }
function client(fetcher: typeof globalThis.fetch, config: Partial<Config> = {}): DvFastvideoGeneration {
  const root = new Context()
  roots.push(root)
  return new DvFastvideoGeneration(root, { baseUrl: 'http://worker.invalid', modelFacts: facts,
    managed: true, task: 'ref2va', pollIntervalMs: 1, ...config }, fetcher)
}

describe('native catalog and job controls', () => {
  it('submits once, polls its ID and reads canonical content rather than a response-provided URL', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const states = ['queued', 'in_progress', 'completed']
    const generation = client(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body == null ? null : JSON.parse(String(init.body)) })
      if (method === 'POST') return json({ id: 'job/1', url: 'https://untrusted.invalid' }, 202)
      if (url.endsWith('/content')) return new Response('VIDEO', { headers: { 'content-type': 'video/mp4', 'X-Inference-Time': '3' } })
      return json({ status: states.shift(), url: 'https://untrusted.invalid' })
    })
    const video = await generation.generateSegment(segment)
    expect(video.video.toString()).toBe('VIDEO')
    expect(video.mime).toBe('video/mp4')
    expect(calls.filter(call => call.method === 'POST')).toEqual([{
      url: 'http://worker.invalid/v1/videos', method: 'POST',
      body: { model: 'pika', task: 'ref2va', prompt: 'A lake', width: 832, height: 480, num_frames: 124 },
    }])
    expect(calls.slice(1).map(call => call.url)).toEqual([
      ...Array<string>(3).fill('http://worker.invalid/v1/videos/job%2F1'),
      'http://worker.invalid/v1/videos/job%2F1/content',
    ])
  })

  it('deletes only its native job on abort and preserves the operation reason', async () => {
    const controller = new AbortController()
    const reason = new Error('Stop this render')
    const methods: string[] = []
    const generation = client(async (_input, init) => {
      const method = init?.method ?? 'GET'
      methods.push(method)
      if (method === 'POST') return json({ id: 'owned-job' }, 202)
      if (method === 'DELETE') return json({ deleted: true })
      controller.abort(reason)
      return json({ status: 'in_progress' })
    })
    await expect(generation.generateSegment({ ...segment, signal: controller.signal })).rejects.toBe(reason)
    expect(methods).toEqual(['POST', 'GET', 'DELETE'])
  })

  it('reports a failed job without resubmitting it', async () => {
    let submissions = 0
    const generation = client(async (_input, init) => {
      if (init?.method === 'POST') { submissions++; return json({ id: 'failed' }, 202) }
      return json({ status: 'failed', error: { message: 'Insufficient memory' } })
    })
    await expect(generation.generateSegment(segment)).rejects.toThrow('Insufficient memory')
    expect(submissions).toBe(1)
  })

  it('preserves a completed job if cancellation interrupts its content download', async () => {
    const controller = new AbortController()
    const reason = new Error('Stop downloading')
    const methods: string[] = []
    const generation = client(async (input, init) => {
      methods.push(init?.method ?? 'GET')
      if (init?.method === 'POST') return json({ id: 'completed-job' }, 202)
      if (String(input).endsWith('/content')) {
        controller.abort(reason)
        throw reason
      }
      return json({ status: 'completed' })
    })
    await expect(generation.generateSegment({ ...segment, signal: controller.signal })).rejects.toBe(reason)
    expect(methods).toEqual(['POST', 'GET', 'GET'])
  })

  it('retains typed input failures for native HTTP 422', async () => {
    const generation = client(async () => json({ error: { message: 'Bad frame count' } }, 422))
    await expect(generation.generateSegment(segment)).rejects.toBeInstanceOf(GenerationSegmentError)
  })

  it('checks a selected alias and controls residency without submitting a generation', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const generation = client(async (input, init) => {
      const url = String(input)
      calls.push({ url, body: init?.body == null ? null : JSON.parse(String(init.body)) })
      if (url.includes('model_info')) return json({ served_model_name: 'pika' })
      return json({ installed: true, loaded_model: 'pika', loaded_task: 't2va', busy: false, managed: true })
    })
    await generation.model()
    expect(await generation.modelStatus()).toMatchObject({ installed: true, loaded: false, busy: false })
    await generation.loadModel()
    await generation.unloadModel()
    expect(calls[0]?.url).toBe('http://worker.invalid/v1/model_info?model=pika&task=ref2va')
    expect(calls.filter(call => call.body !== null)).toEqual([
      { url: 'http://worker.invalid/v1/models/load', body: { model: 'pika', task: 'ref2va' } },
      { url: 'http://worker.invalid/v1/models/unload', body: { model: 'pika', task: 'ref2va' } },
    ])
  })

  it('refuses loading another model on a fixed distributed endpoint', async () => {
    const generation = client(async () => json({ installed: false, loaded_model: 'omni', busy: false, managed: false }))
    await expect(generation.loadModel()).rejects.toThrow('fixed distributed endpoint')
  })

  it('discovers a managed alias’s output metadata without changing its reference capabilities', async () => {
    const generation = client(async () => json({ served_model_name: 'pika', video_output_capabilities: {
      schema_version: 1, fps: 24, duration_seconds: { min: 5, max: 6 },
      num_frames_by_duration_seconds: { 5: 124, 6: 158 },
      recommended_frame_sizes: { '16:9': { '480p': [832, 480], '768p': [1344, 768] } },
    } }), { discoverOutputCapabilities: true })
    const discovered = await generation.model()
    expect(discovered).toMatchObject({ minDurationSec: 5, maxDurationSec: 6,
      resolutions: ['480p', '768p'], maxReferences: 2, referenceMediaTypes: facts.referenceMediaTypes })
    expect(discovered.numFramesByDurationSec).toEqual({ 5: 124, 6: 158 })
    expect(await generation.model()).toBe(discovered)
  })

  it('keeps configured output choices when metadata discovery was not enabled', async () => {
    const generation = client(async () => json({ served_model_name: 'pika', video_output_capabilities: { schema_version: 2 } }))
    expect(await generation.model()).toMatchObject({ modelId: 'pika', minDurationSec: 5, maxDurationSec: 5, resolutions: ['480p'] })
  })

  it('keeps configured output choices when enabled discovery reads no metadata', async () => {
    const generation = client(async () => json({ served_model_name: 'pika' }), { discoverOutputCapabilities: true })
    expect(await generation.model()).toMatchObject({ modelId: 'pika', minDurationSec: 5, maxDurationSec: 5, resolutions: ['480p'] })
  })

  it('keeps configured output choices when enabled discovery reads null metadata', async () => {
    const generation = client(async () => json({ served_model_name: 'pika', video_output_capabilities: null }), { discoverOutputCapabilities: true })
    expect(await generation.model()).toMatchObject({ modelId: 'pika', minDurationSec: 5, maxDurationSec: 5, resolutions: ['480p'] })
  })

  it('rejects malformed output metadata without caching it, so the next model() call fetches again', async () => {
    let fetches = 0
    const generation = client(async () => {
      fetches++
      return json({ served_model_name: 'pika', video_output_capabilities: { schema_version: 2 } })
    }, { discoverOutputCapabilities: true })
    await expect(generation.model()).rejects.toThrow('invalid video output capabilities')
    await expect(generation.model()).rejects.toThrow('invalid video output capabilities')
    expect(fetches).toBe(2)
  })
})
