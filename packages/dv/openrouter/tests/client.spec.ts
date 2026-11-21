/** Keyless contract tests for the documented OpenRouter video, image and speech APIs. */
import { describe, expect, it } from 'vitest'
import { imageCatalog, speechCatalog, videoCatalog, videoReferences } from '../src/catalog.ts'
import { OpenRouterApi } from '../src/client.ts'

export const catalog = { data: [{ id: 'fixture/video', name: 'Fixture Video', supported_durations: [4, 6, 8],
  supported_resolutions: ['720p'], supported_aspect_ratios: ['16:9'], supported_frame_images: ['first_frame', 'last_frame'],
  generate_audio: true, seed: true }] }

describe('OpenRouter video API', () => {
  it('uses published discrete durations and never invents frame counts or dimensions', () => {
    expect(videoCatalog(catalog, new Map())).toEqual([{ id: 'fixture/video', name: 'Fixture Video', durations: [4, 6, 8],
      resolutions: ['720p'], aspectRatios: ['16:9'], frames: ['first_frame', 'last_frame'], references: [], audio: true, seed: true }])
    expect(videoCatalog(catalog, new Map([['fixture/video', ['image' as const]]]))[0]?.references).toEqual(['image'])
    expect(videoCatalog({ data: [{ id: 'unknown' }, { ...catalog.data[0], upscale_factor: 2 }] }, new Map())).toEqual([])
    expect(() => videoCatalog([], new Map())).toThrow('invalid video catalog')
  })

  it('reads each model\'s reference media from the image, video and audio input modalities of the models catalog', () => {
    expect(videoReferences({ data: [
      { id: 'seed/omni', architecture: { input_modalities: ['text', 'audio', 'image', 'video'] } },
      { id: 'veo/frames', architecture: { input_modalities: ['text', 'image'] } },
      { id: 'text/only', architecture: { input_modalities: ['text'] } },
      { id: 'no/architecture' },
    ] })).toEqual(new Map([['seed/omni', ['image', 'video', 'audio']], ['veo/frames', ['image']]]))
    expect(() => videoReferences({})).toThrow('invalid video model list')
  })

  it('keeps the video catalog without reference media when only the models catalog fails', async () => {
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.endsWith('/videos/models')) return Response.json(catalog)
      return new Response('{}', { status: 503 })
    })
    expect((await client.catalog()).map(model => model.references)).toEqual([[]])
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

  it('reports the reason OpenRouter gives for a failed, cancelled or expired job', async () => {
    const job = (state: Record<string, unknown>) => new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1,
      async (_input, init) => init?.method === 'POST' ? Response.json({ id: 'job1' }) : Response.json(state))
    await expect(job({ status: 'failed', error: 'Content policy violation' }).generate({}))
      .rejects.toThrow('OpenRouter video generation failed: Content policy violation. Check the provider job before retrying.')
    await expect(job({ status: 'failed', error: null }).generate({})).rejects.toThrow('OpenRouter video generation failed. Check')
    await expect(job({ status: 'expired' }).generate({})).rejects.toThrow('OpenRouter video generation expired. Check')
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

  it('quotes the message OpenRouter gives for a rejected request, without the key', async () => {
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async () =>
      Response.json({ error: { code: 400, message: 'HeyGen Voice only returns pcm.\nKey fixture-key.' } }, { status: 400 }))
    await expect(client.speak({})).rejects.toThrow(
      'OpenRouter API returned HTTP 400: HeyGen Voice only returns pcm. Key [key]. Check the key, credit balance, and selected model.')
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

describe('OpenRouter account lookup', () => {
  const keyBody = (data: unknown) => Response.json({ data })
  const isKeyRequest = (input: Parameters<typeof fetch>[0]): boolean => (input instanceof Request ? input.url : input.toString()).endsWith('/key')

  it('stops a lookup after the configured deadline', async () => {
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, (_input, init) =>
      new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new Error('timed out')) }) }), 20)
    await expect(client.account(new AbortController().signal)).rejects.toThrow('timed out')
  })

  it.each([null, 'x', { is_management_key: 'yes' }, { label: 'x' }])('refuses key metadata %j', async (data) => {
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async () => keyBody(data))
    await expect(client.account(new AbortController().signal)).rejects.toThrow('invalid key metadata')
  })

  it('ignores a label that is not a string and non-finite credits', async () => {
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async input =>
      isKeyRequest(input) ? keyBody({ label: 5, is_management_key: true })
        : keyBody({ total_credits: 'many', total_usage: 1 }))
    expect(await client.account(new AbortController().signal)).toEqual({ balanceUsd: null, label: null, limitRemainingUsd: null })
  })

  it('rethrows the abort reason when the signal aborts during the credits lookup', async () => {
    const controller = new AbortController()
    const reason = new Error('Cancelled')
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async (input) => {
      if (isKeyRequest(input)) return keyBody({ is_management_key: true })
      controller.abort(reason)
      throw reason
    })
    await expect(client.account(controller.signal)).rejects.toBe(reason)
  })
})

export const speechRows = { data: [
  { id: 'fixture/speech', name: 'Fixture Speech', architecture: { input_modalities: ['text'], output_modalities: ['speech'] },
    supported_voices: ['alloy', 'nova', 'alloy'], endpoints: ['/api/v1/audio/speech'] },
  { id: 'heygen/fixture-voice', architecture: { output_modalities: ['speech'] }, supported_voices: null },
  { id: 'fixture/elsewhere', architecture: { output_modalities: ['speech'] }, endpoints: ['/api/v1/chat/completions'] },
  { id: 'fixture/chat', architecture: { output_modalities: ['text'] }, endpoints: ['/api/v1/audio/speech'] },
] }

describe('OpenRouter speech API', () => {
  it('keeps speech models that serve /audio/speech with their distinct voices, and leaves out the rest', () => {
    expect(speechCatalog(speechRows)).toEqual([
      { id: 'fixture/speech', name: 'Fixture Speech', voices: ['alloy', 'nova'] },
      { id: 'heygen/fixture-voice', name: 'heygen/fixture-voice', voices: [] },
    ])
    expect(() => speechCatalog({})).toThrow('invalid speech catalog')
  })

  it('reads the speech catalog through the models route filtered to speech output', async () => {
    const urls: string[] = []
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async (input) => {
      urls.push(input instanceof Request ? input.url : input.toString())
      return Response.json(speechRows)
    })
    expect((await client.speechCatalog()).map(model => model.id)).toEqual(['fixture/speech', 'heygen/fixture-voice'])
    expect(urls).toEqual(['https://openrouter.ai/api/v1/models?output_modalities=speech'])
  })

  it('submits one speech request and returns the audio bytes with their type, refusing an answer that is not audio', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const client = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), body: typeof init?.body === 'string' ? init.body : '' })
      return new Response(Buffer.from('MP3'), { headers: { 'content-type': 'audio/mpeg; charset=binary' } })
    })
    expect(await client.speak({ model: 'fixture/speech', input: 'Hello' })).toEqual({ bytes: Buffer.from('MP3'), mime: 'audio/mpeg' })
    expect(calls).toEqual([{ url: 'https://openrouter.ai/api/v1/audio/speech', body: '{"model":"fixture/speech","input":"Hello"}' }])
    const json = new OpenRouterApi('https://openrouter.ai/api/v1/', async () => 'fixture-key', 1, async () => Response.json({ ok: true }))
    await expect(json.speak({})).rejects.toThrow('OpenRouter returned no audio; do not automatically resubmit')
  })
})
