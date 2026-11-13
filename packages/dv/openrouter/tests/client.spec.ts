/** Keyless contract tests for the documented OpenRouter video and image APIs. */
import { describe, expect, it } from 'vitest'
import { imageCatalog, videoCatalog } from '../src/catalog.ts'
import { OpenRouterApi } from '../src/client.ts'

export const catalog = { data: [{ id: 'fixture/video', name: 'Fixture Video', supported_durations: [4, 6, 8],
  supported_resolutions: ['720p'], supported_aspect_ratios: ['16:9'], supported_frame_images: ['first_frame', 'last_frame'],
  generate_audio: true, seed: true }] }

describe('OpenRouter video API', () => {
  it('uses published discrete durations and never invents frame counts or dimensions', () => {
    expect(videoCatalog(catalog)).toEqual([{ id: 'fixture/video', name: 'Fixture Video', durations: [4, 6, 8],
      resolutions: ['720p'], aspectRatios: ['16:9'], frames: ['first_frame', 'last_frame'], audio: true, seed: true }])
    expect(videoCatalog({ data: [{ id: 'unknown' }, { ...catalog.data[0], upscale_factor: 2 }] })).toEqual([])
    expect(() => videoCatalog([])).toThrow('invalid video catalog')
  })

  it('submits once and uses canonical authenticated content routes, ignoring response-provided URLs', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers }> = []
    const states = ['pending', 'in_progress', 'completed']
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async (input, init) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers) })
      if (init?.method === 'POST') return Response.json({ id: 'job/1', polling_url: 'https://untrusted.invalid/poll' }, { status: 202 })
      if (url.includes('/content')) return new Response('VIDEO', { headers: { 'content-type': 'video/mp4' } })
      return Response.json({ status: states.shift(), unsigned_urls: ['https://untrusted.invalid/video'] })
    })
    expect((await client.generate({ model: 'fixture/video', prompt: 'A lake' })).video.toString()).toBe('VIDEO')
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
    expect(calls.at(-1)?.url).toBe('https://openrouter.ai/api/v1/videos/job%2F1/content?index=0')
    expect(calls.every(call => call.url.startsWith('https://openrouter.ai/api/v1/'))).toBe(true)
    expect(calls.every(call => call.headers.get('authorization') === 'Bearer fixture-key')).toBe(true)
  })

  it('stops local monitoring with its abort reason and never invents a provider DELETE endpoint', async () => {
    const controller = new AbortController()
    const reason = new Error('Stop monitoring')
    const methods: string[] = []
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async (_input, init) => {
      methods.push(init?.method ?? 'GET')
      if (init?.method === 'POST') return Response.json({ id: 'owned' })
      controller.abort(reason)
      return Response.json({ status: 'pending' })
    })
    await expect(client.generate({}, controller.signal)).rejects.toBe(reason)
    expect(methods).toEqual(['POST', 'GET'])
  })

  it('does not retry an ambiguous paid submission or expose a key in an HTTP failure', async () => {
    let calls = 0
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async () => {
      calls++; return Response.json({ error: 'fixture-key' }, { status: 401 })
    })
    await expect(client.generate({})).rejects.toThrow('OpenRouter API returned HTTP 401.')
    expect(calls).toBe(1)
    const malformed = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1,
      async () => Response.json({ polling_url: 'https://untrusted.invalid' }))
    await expect(malformed.generate({})).rejects.toThrow('do not automatically resubmit')
  })
})

export const imageRows = { data: [
  { id: 'fixture/image', name: 'Fixture Image', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
    supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] }, resolution: { type: 'enum', values: ['1K', '2K'] },
      output_format: { type: 'enum', values: ['png', 'jpeg'] }, n: { type: 'range', min: 1, max: 4 }, seed: { type: 'boolean' },
      input_references: { type: 'range', min: 0, max: 8 } } },
  { id: 'fixture/vector', name: 'Vector', architecture: { output_modalities: ['image'] },
    supported_parameters: { output_format: { type: 'enum', values: ['svg'] } } },
  { id: 'fixture/chat', name: 'Chat', architecture: { output_modalities: ['text'] }, supported_parameters: {} },
  { id: 'fixture/plain', architecture: { output_modalities: ['image', 'text'] }, supported_parameters: {} },
] }

describe('OpenRouter image API', () => {
  it('keeps raster image models with their enum choices and seed support, and leaves out vector and text models', () => {
    expect(imageCatalog(imageRows)).toEqual([
      { id: 'fixture/image', name: 'Fixture Image', parameters: { aspect_ratio: ['1:1', '16:9'], resolution: ['1K', '2K'] },
        outputFormats: ['png', 'jpeg'], seed: true },
      { id: 'fixture/plain', name: 'fixture/plain', parameters: {}, outputFormats: [], seed: false },
    ])
    expect(() => imageCatalog({})).toThrow('invalid image catalog')
  })

  it('submits one image request and reads the base64 image and its type, refusing an answer without one', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), body: typeof init?.body === 'string' ? init.body : '' })
      return Response.json({ data: [{ b64_json: Buffer.from('JPEG').toString('base64'), media_type: 'image/jpeg' }] })
    })
    expect(await client.generateImage({ model: 'fixture/image', prompt: 'A lake' })).toEqual({ bytes: Buffer.from('JPEG'), mime: 'image/jpeg' })
    expect(calls).toEqual([{ url: 'https://openrouter.ai/api/v1/images', body: '{"model":"fixture/image","prompt":"A lake"}' }])
    const empty = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async () => Response.json({ data: [] }))
    await expect(empty.generateImage({})).rejects.toThrow('OpenRouter returned no image; do not automatically resubmit')
  })
})
