/** The generation client against a fake FastVideo server that answers `GET /v1/model_info` and `POST /v1/videos/sync`. */
import { once } from 'node:events'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { Agent, fetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'
import DvFastvideoGeneration, {
  backendOrder, deriveModelFacts, GenerationSegmentError, type ModelFactsConfig, type SegmentRequest,
} from '../src/index.ts'

/** A port in the owned test range on which nothing listens. */
const UNREACHABLE_PORT = 18502

const FACTS: ModelFactsConfig = {
  modelId: 'fasth3-nvfp4',
  frameSizes: { '16:9': { '480p': [832, 480], '720p': [1344, 768] }, '9:16': { '480p': [480, 832], '720p': [768, 1344] } },
  numFramesByDurationSec: { 5: 124, 6: 158 },
  maxReferences: 12,
  referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } },
}

const roots: Context[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }))
})

/**
 * Start a fake backend that records each request and answers it with `reply`.
 * @param reply - answers one request by its path.
 * @returns the client of the backend, the backend URL and the recorded requests.
 */
async function backend(reply: (path: string, response: ServerResponse) => void) {
  const requests: Array<{ path: string; body: Record<string, unknown> | null }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.once('end', () => {
      const path = request.url ?? ''
      requests.push({ path, body: chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> })
      reply(path, response)
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { client: client(url), url, requests }
}

/** A client of `baseUrl` with the given facts. */
function client(baseUrl: string, facts: ModelFactsConfig = FACTS, task: string | null = null): DvFastvideoGeneration {
  const root = new Context()
  roots.push(root)
  return new DvFastvideoGeneration(root, { baseUrl, modelFacts: facts, task })
}

/** Answer with an MP4 body and the given headers. */
function sendVideo(response: ServerResponse, headers: Record<string, string> = {}): void {
  response.writeHead(200, { 'content-type': 'video/mp4', ...headers })
  response.end('VIDEO')
}

/** A segment request with the given fields. */
function segment(updates: Partial<SegmentRequest> = {}): SegmentRequest {
  return { prompt: 'A lake', frameWidth: 832, frameHeight: 480, numFrames: 124, references: [], ...updates }
}

describe('model facts', () => {
  it('derives the catalog choices and duration range from the configured maps', async () => {
    const { client: generation, requests } = await backend((_path, response) => {
      response.end(JSON.stringify({ model_path: '/weights', served_model_name: FACTS.modelId, lora: null }))
    })
    expect(await generation.model()).toEqual({
      ...FACTS, aspectRatios: ['16:9', '9:16'], resolutions: ['480p', '720p'], minDurationSec: 5, maxDurationSec: 6,
    })
    await generation.model()
    expect(requests.map(request => request.path)).toEqual(['/v1/model_info'])
  })

  it('refuses a served alias that is missing or differs from modelFacts.modelId, and retries after a failure', async () => {
    let served: unknown = 'another-model'
    const { client: generation, requests } = await backend((_path, response) => {
      response.end(JSON.stringify({ served_model_name: served }))
    })
    await expect(generation.model()).rejects.toThrow('FastVideo serves another-model; modelFacts.modelId is fasth3-nvfp4.')
    served = undefined
    await expect(generation.model()).rejects.toThrow('FastVideo GET /v1/model_info reports no served_model_name; expected fasth3-nvfp4.')
    served = FACTS.modelId
    expect(await generation.model()).toMatchObject({ modelId: FACTS.modelId })
    expect(requests).toHaveLength(3)
  })

  it('names the route and the HTTP status of a failed model_info, and rejects when the backend is unreachable', async () => {
    const { client: generation } = await backend((_path, response) => { response.writeHead(503); response.end('starting') })
    await expect(generation.model()).rejects.toThrow('FastVideo GET /v1/model_info returned HTTP 503: starting')
    await expect(client(`http://127.0.0.1:${UNREACHABLE_PORT}`).model()).rejects.toThrow('fetch failed')
  })

  it('names the route of a model_info answer that is not JSON', async () => {
    const { client: generation } = await backend((_path, response) => { response.end('<html>starting</html>') })
    const error: unknown = await generation.model().catch((cause: unknown) => cause)
    if (!(error instanceof Error)) throw new Error('Expected a model_info error')
    expect(error.message).toMatch(/^FastVideo GET \/v1\/model_info answered no JSON: /)
    expect(error.cause).toBeInstanceOf(SyntaxError)
  })

  it.each([
    ['a gap in the durations', { numFramesByDurationSec: { 5: 124, 7: 190 } }, 'numFramesByDurationSec has a gap; it needs every duration from 5 to 7.'],
    ['no duration', { numFramesByDurationSec: {} }, 'numFramesByDurationSec lists no duration.'],
    ['a fractional duration', { numFramesByDurationSec: { '5.5': 140 } }, 'numFramesByDurationSec has duration "5.5"'],
    ['frame counts that shrink', { numFramesByDurationSec: { 5: 124, 6: 100 } }, 'a frame count that does not grow with the duration'],
    ['no frame size', { frameSizes: {} }, 'frameSizes lists no frame size.'],
    ['aspect ratios with different resolutions', { frameSizes: { '16:9': { '480p': [832, 480] }, '9:16': { '720p': [768, 1344] } } },
      'frameSizes of 9:16 lists 720p; every aspect ratio lists 480p.'],
    ['an aspect ratio without a resolution', { frameSizes: { '16:9': { '480p': [832, 480] }, '9:16': {} } },
      'frameSizes of 9:16 lists no resolution; every aspect ratio lists 480p.'],
    ['a media type limit above maxReferences', { maxReferences: 2 }, 'referenceMediaTypes.image.maxCount 9 exceeds maxReferences 2.'],
  ] as const)('refuses facts with %s when the client is built', (_case, update, message) => {
    expect(() => client('http://127.0.0.1:1', { ...FACTS, ...update } as ModelFactsConfig)).toThrow(message)
  })

  it('accepts aspect ratios that list the same resolutions in another order', () => {
    const frameSizes: ModelFactsConfig['frameSizes'] = {
      '16:9': { '480p': [832, 480], '720p': [1344, 768] }, '9:16': { '720p': [768, 1344], '480p': [480, 832] },
    }
    expect(deriveModelFacts({ ...FACTS, frameSizes })).toMatchObject({ aspectRatios: ['16:9', '9:16'], resolutions: ['480p', '720p'], frameSizes })
  })

  it('refuses a reference media type that FastVideo does not accept at config validation', () => {
    const text: Record<string, { maxCount: number }> = { text: { maxCount: 1 } }
    expect(() => DvFastvideoGeneration.Config({ baseUrl: 'http://127.0.0.1:1', modelFacts: { ...FACTS, referenceMediaTypes: text } })).toThrow()
    expect(DvFastvideoGeneration.Config({ baseUrl: 'http://127.0.0.1:1', modelFacts: FACTS }).modelFacts).toEqual(FACTS)
  })
})

describe('segment generation', () => {
  it('sends an explicitly configured native task with endpoints in caller order', async () => {
    const { url, requests } = await backend((_path, response) => { sendVideo(response) })
    const generation = client(url, FACTS, 'fl2va')
    await generation.generateSegment(segment({ references: [
      { mimeType: 'image/jpeg', bytes: Buffer.from('FIRST') },
      { mimeType: 'image/png', bytes: Buffer.from('LAST') },
    ] }))
    expect(requests[0]?.body).toMatchObject({ task: 'fl2va', image_reference: [
      { image_url: `data:image/jpeg;base64,${Buffer.from('FIRST').toString('base64')}` },
      { image_url: `data:image/png;base64,${Buffer.from('LAST').toString('base64')}` },
    ] })
  })

  it('sends one list per media type in the caller order within each type, and returns the video with its timings', async () => {
    const { client: generation, requests } = await backend((_path, response) => {
      sendVideo(response, { 'x-inference-time-s': '41.5', 'x-stage-durations': '{"denoise": 38.25, "decode": 3, "note": "text"}' })
    })
    const references = [
      { mimeType: 'audio/mpeg', bytes: Buffer.from('song') }, { mimeType: 'image/jpeg', bytes: Buffer.from('face') },
      { mimeType: 'video/mp4', bytes: Buffer.from('walk') }, { mimeType: 'image/png', bytes: Buffer.from('room') },
      { mimeType: 'audio/wav', bytes: Buffer.from('voice') },
    ]
    const result = await generation.generateSegment(segment({ seed: 42, references }))
    const url = (mime: string, text: string) => `data:${mime};base64,${Buffer.from(text).toString('base64')}`
    expect(requests).toEqual([{ path: '/v1/videos/sync', body: {
      model: FACTS.modelId, prompt: 'A lake', width: 832, height: 480, num_frames: 124, seed: 42,
      image_reference: [{ image_url: url('image/jpeg', 'face') }, { image_url: url('image/png', 'room') }],
      video_reference: [{ video_url: url('video/mp4', 'walk') }],
      audio_reference: [{ audio_url: url('audio/mpeg', 'song') }, { audio_url: url('audio/wav', 'voice') }],
    } }])
    expect(result).toEqual({ video: Buffer.from('VIDEO'), mime: 'video/mp4', timings: { inference_s: 41.5, denoise_s: 38.25, decode_s: 3 } })
  })

  it('orders items as images, then videos, then audio, each in caller order', () => {
    const items = [['audio', 'song'], ['image', 'face'], ['video', 'walk'], ['image', 'room'], ['audio', 'voice']] as const
    expect(backendOrder(items, ([type]) => type).map(([, name]) => name)).toEqual(['face', 'room', 'walk', 'song', 'voice'])
  })

  it('omits the seed and the empty reference lists, and returns no timing without timing headers', async () => {
    const { client: generation, requests } = await backend((_path, response) => { sendVideo(response) })
    expect((await generation.generateSegment(segment())).timings).toEqual({})
    expect(requests[0]?.body).toEqual({ model: FACTS.modelId, prompt: 'A lake', width: 832, height: 480, num_frames: 124 })
  })

  it('refuses a reference of another media type without sending a request', async () => {
    const { client: generation, requests } = await backend((_path, response) => { sendVideo(response) })
    const refused = generation.generateSegment(segment({ references: [{ mimeType: 'application/json', bytes: Buffer.from('{}') }] }))
    await expect(refused).rejects.toThrow(new GenerationSegmentError('FastVideo takes no reference of type application/json.'))
    await expect(refused).rejects.toBeInstanceOf(GenerationSegmentError)
    expect(requests).toEqual([])
  })

  it('refuses an answer without a content type', async () => {
    const { client: generation } = await backend((_path, response) => { response.end('queue full') })
    await expect(generation.generateSegment(segment())).rejects.toThrow('FastVideo POST /v1/videos/sync answered no content type, not video: queue full')
  })

  it('keeps the video and its valid timings when x-stage-durations is not JSON', async () => {
    const { client: generation } = await backend((_path, response) => {
      sendVideo(response, { 'x-inference-time-s': '41.5', 'x-stage-durations': '{denoise: 38' })
    })
    expect(await generation.generateSegment(segment())).toEqual({ video: Buffer.from('VIDEO'), mime: 'video/mp4', timings: { inference_s: 41.5 } })
  })

  it('refuses an answer that is not video with its body text', async () => {
    const { client: generation } = await backend((_path, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'queue full' } }))
    })
    await expect(generation.generateSegment(segment())).rejects.toThrow('FastVideo POST /v1/videos/sync answered application/json, not video: queue full')
  })

  it('maps HTTP 400 to GenerationSegmentError', async () => {
    const { client: generation } = await backend((_path, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'num_frames must be 124' } }))
    })
    const error: unknown = await generation.generateSegment(segment()).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(GenerationSegmentError)
    expect(error).toMatchObject({ message: 'num_frames must be 124' })
  })

  it('reports HTTP 422 as a plain Error with its status', async () => {
    const { client: generation } = await backend((_path, response) => {
      response.writeHead(422, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unprocessable' } }))
    })
    const error: unknown = await generation.generateSegment(segment()).catch((cause: unknown) => cause)
    expect(error).not.toBeInstanceOf(GenerationSegmentError)
    expect(error).toMatchObject({ message: 'FastVideo POST /v1/videos/sync returned HTTP 422: unprocessable' })
  })

  it('reports the HTTP status with the body text of a failure whose application/json body is not JSON', async () => {
    const { client: generation } = await backend((_path, response) => {
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end('<html>Bad Gateway</html>')
    })
    await expect(generation.generateSegment(segment())).rejects.toThrow('FastVideo POST /v1/videos/sync returned HTTP 502: <html>Bad Gateway</html>')
  })

  it('reduces a Python traceback to its final exception and truncates oversized errors', async () => {
    const trace = `Traceback (most recent call last):\n${'  internal stack frame\n'.repeat(5000)}RuntimeError: ninja is required`
    const { client: generation } = await backend((_path, response) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: trace } }))
    })
    const failure: unknown = await generation.generateSegment(segment()).catch((cause: unknown) => cause)
    expect(failure).not.toBeInstanceOf(GenerationSegmentError)
    expect(failure).toMatchObject({ message: 'FastVideo POST /v1/videos/sync returned HTTP 500: RuntimeError: ninja is required' })
    const oversized = await backend((_path, response) => { response.writeHead(500); response.end('x'.repeat(20_000)) })
    const error: unknown = await oversized.client.generateSegment(segment()).catch((cause: unknown) => cause)
    if (!(error instanceof Error)) throw new Error('Expected a backend error')
    expect(error.message.length).toBeLessThan(2200)
    expect(error.message).toContain('truncated; see FastVideo server logs')
  })

  it('rejects with the abort reason while waiting for the video and closes the HTTP connection', async () => {
    let begun!: () => void
    let closed!: () => void
    const started = new Promise<void>((resolve) => { begun = resolve })
    const disconnected = new Promise<void>((resolve) => { closed = resolve })
    const { client: generation } = await backend((_path, response) => { response.once('close', closed); begun() })
    const controller = new AbortController()
    const reason = new Error('Cancelled by user')
    const result = expect(generation.generateSegment(segment({ signal: controller.signal }))).rejects.toBe(reason)
    await started
    controller.abort(reason)
    await result
    await disconnected
  })

  it('rejects an already aborted request without sending it', async () => {
    const { client: generation, requests } = await backend((_path, response) => { sendVideo(response) })
    const reason = new Error('Cancelled before start')
    await expect(generation.generateSegment(segment({ signal: AbortSignal.abort(reason) }))).rejects.toBe(reason)
    expect(requests).toEqual([])
  })

  it('waits past the global dispatcher headers timeout for a video whose headers come only when it is generated', async () => {
    const { client: generation, url } = await backend((_path, response) => { setTimeout(() => { sendVideo(response) }, 1500) })
    const previous = getGlobalDispatcher()
    // A 300 ms headers timeout stands in for undici's 300-second default; undici timers have coarse resolution.
    // proxy-exempt: a loopback test dispatcher, installed globally to lower its timeouts.
    const short = new Agent({ headersTimeout: 300, bodyTimeout: 300 })
    setGlobalDispatcher(short)
    try {
      const plain: unknown = await fetch(`${url}/v1/videos/sync`, { method: 'POST', body: '{}' }).catch((cause: unknown) => cause)
      expect(plain).toMatchObject({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } })
      expect((await generation.generateSegment(segment())).video).toEqual(Buffer.from('VIDEO'))
    } finally {
      setGlobalDispatcher(previous)
      await short.close()
    }
  })

  it('keeps the global dispatcher body timeout for a video body that stalls after its headers', async () => {
    const { client: generation } = await backend((_path, response) => {
      response.writeHead(200, { 'content-type': 'video/mp4' })
      response.write('VID')
    })
    const previous = getGlobalDispatcher()
    // proxy-exempt: a loopback test dispatcher, installed globally to lower its body timeout.
    const short = new Agent({ bodyTimeout: 300 })
    setGlobalDispatcher(short)
    try {
      const stalled: unknown = await generation.generateSegment(segment()).catch((cause: unknown) => cause)
      expect(stalled).toMatchObject({ cause: { code: 'UND_ERR_BODY_TIMEOUT' } })
    } finally {
      setGlobalDispatcher(previous)
      await short.close()
    }
  })

  it('sends the render through the installed global dispatcher, such as a proxy that routes it', async () => {
    const { url, requests } = await backend((_path, response) => { sendVideo(response) })
    const previous = getGlobalDispatcher()
    // proxy-exempt: a loopback test dispatcher that, like a proxy, routes every request to the fake backend.
    const agent = new Agent()
    setGlobalDispatcher(agent.compose(dispatch => (options, handler) => dispatch({ ...options, origin: url }, handler)))
    try {
      const routed = client(`http://127.0.0.1:${UNREACHABLE_PORT}`)
      expect((await routed.generateSegment(segment())).video).toEqual(Buffer.from('VIDEO'))
      expect(requests.map(request => request.path)).toEqual(['/v1/videos/sync'])
    } finally {
      setGlobalDispatcher(previous)
      await agent.close()
    }
  })
})

describe('lora selection', () => {
  it('sends the adapter as lora {name, scale}, and leaves scale out without a strength', async () => {
    const { client: generation, requests } = await backend((_path, response) => { sendVideo(response) })
    await generation.generateSegment(segment({ lora: { id: 'org/adapter', strength: 0.7 } }))
    await generation.generateSegment(segment({ lora: { id: 'org/adapter' } }))
    await generation.generateSegment(segment())
    expect(requests.map(request => request.body?.['lora'])).toEqual([{ name: 'org/adapter', scale: 0.7 }, { name: 'org/adapter' }, undefined])
  })

  it('reads the lora block from the one model_info that model() reads', async () => {
    const { client: generation, requests } = await backend((_path, response) => {
      response.end(JSON.stringify({ served_model_name: FACTS.modelId, lora: {
        supported: true, runtime_switching: false, base_strength: 0,
        adapters: [
          { id: 'org/a', default_strength: 1, min_strength: 0, max_strength: 1.5, description: 'Skin' },
          { id: 'org/b', default_strength: 0.9, min_strength: 0, max_strength: 1.2 },
          { id: 7, default_strength: 1, min_strength: 0, max_strength: 1 },
        ],
      } }))
    })
    const facts = await generation.lora()
    expect(await generation.lora()).toBe(facts)
    await generation.model()
    expect(facts).toEqual({ supported: true, adapters: [
      { id: 'org/a', defaultStrength: 1, minStrength: 0, maxStrength: 1.5, description: 'Skin' },
      { id: 'org/b', defaultStrength: 0.9, minStrength: 0, maxStrength: 1.2 },
    ] })
    expect(requests.map(request => request.path)).toEqual(['/v1/model_info'])
  })

  it.each([
    ['no block', undefined],
    ['a null block', null],
    ['an unsupported block', { supported: false, adapters: [] }],
    ['a block without adapters', { supported: true }],
    ['the single startup adapter of a server without per-request LoRA', { name: 'a', path: '/weights/a', scale: 1 }],
  ])('treats %s as no LoRA', async (_name, lora) => {
    const { client: generation } = await backend((_path, response) => {
      response.end(JSON.stringify({ served_model_name: FACTS.modelId, lora }))
    })
    expect(await generation.lora()).toEqual({ supported: false, adapters: [] })
  })

  it('rejects with the model() error and asks again after a failure', async () => {
    let calls = 0
    const { client: generation } = await backend((_path, response) => {
      if (++calls === 1) {
        response.writeHead(503)
        response.end('starting')
        return
      }
      response.end(JSON.stringify({ served_model_name: FACTS.modelId, lora: { supported: true, adapters: [] } }))
    })
    await expect(generation.lora()).rejects.toThrow('FastVideo GET /v1/model_info returned HTTP 503: starting')
    expect(await generation.lora()).toEqual({ supported: true, adapters: [] })
  })
})
