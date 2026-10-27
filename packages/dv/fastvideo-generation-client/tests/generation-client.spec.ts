/** The generation client maps the streaming_v2 HTTP routes and the per-request event streams of a fake backend. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import DvFastvideoGeneration, { GenerationSegmentError, type SegmentOutput, type SegmentRequest } from '../src/index.ts'

/** A port in the owned test range on which nothing listens. */
const UNREACHABLE_PORT = 18502

const CAPABILITIES_BODY = {
  model_id: 'h3-ref2va', min_segment_duration_sec: 5, max_segment_duration_sec: 15,
  max_references: 4, reference_media_types: { image: { max_count: 3 }, video: { max_count: 2 } },
  frame_sizes: { '16:9': { '720p': [1344, 768], '480p': [896, 512] }, '9:16': { '720p': [768, 1344] } },
  num_frames_by_duration_sec: { 5: 124, 6: 158 },
}

interface Reply { status: number; body: unknown }
/** Answers one HTTP request; `request` is the parsed JSON body of a POST. */
type Route = (path: string, request: Record<string, unknown> | null, response: ServerResponse) => void

interface FakeBackend {
  /** The ephemeral port that the fake listens on, so no pooled connection of an earlier test can reach it. */
  port: number
  paths: string[]
  requests: Record<string, unknown>[]
  /** Settles when the client closes the connection of each POST, in arrival order. */
  closed: Promise<void>[]
}

const servers: Server[] = []
const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }))
})

/** Start a fake backend whose requests the route answers. */
async function startFakeBackend(route: Route): Promise<FakeBackend> {
  const fake: FakeBackend = { port: 0, paths: [], requests: [], closed: [] }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? ''
    fake.paths.push(path)
    if (request.method !== 'POST') {
      route(path, null, response)
      return
    }
    fake.closed.push(new Promise((resolve) => { response.once('close', () => { resolve() }) }))
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>
      fake.requests.push(body)
      route(path, body, response)
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  fake.port = (server.address() as AddressInfo).port
  return fake
}

/** Answer with one JSON body and close the connection. */
function sendJson(response: ServerResponse, reply: Reply): void {
  response.writeHead(reply.status, { 'content-type': 'application/json', connection: 'close' })
  response.end(JSON.stringify(reply.body))
}

/** Start an event-stream response and write the given events. */
function sendEvents(response: ServerResponse, events: Array<[string, object]>, end = true): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
  for (const [event, data] of events) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  if (end) response.end()
}

function client(port: number): DvFastvideoGeneration {
  const root = new Context()
  roots.push(root)
  return new DvFastvideoGeneration(root, { baseUrl: `http://127.0.0.1:${port}` })
}

async function collect(outputs: AsyncIterable<SegmentOutput>): Promise<SegmentOutput[]> {
  const received: SegmentOutput[] = []
  for await (const output of outputs) received.push(output)
  return received
}

function segmentRequest(fields: Partial<SegmentRequest> = {}): SegmentRequest {
  return { prompt: 'A lake', frameWidth: 1344, frameHeight: 768, numFrames: 124, references: [], returnLastFrame: false, ...fields }
}

describe('HTTP routes', () => {
  it('builds model facts from the capabilities and reuses the first successful response', async () => {
    const replies: Reply[] = [{ status: 503, body: { detail: 'warming' } }, { status: 200, body: CAPABILITIES_BODY }]
    const fake = await startFakeBackend((_path, _request, response) => { sendJson(response, replies.shift()!) })
    const generation = client(fake.port)
    await expect(generation.model()).rejects.toThrow(
      'FastVideo generation backend GET /v1/streamv2/capabilities returned HTTP 503: {"detail":"warming"}')
    const facts = await generation.model()
    expect(facts).toEqual({
      modelId: 'h3-ref2va', aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '480p'],
      minSegmentDurationSec: 5, maxSegmentDurationSec: 15, maxReferences: 4,
      referenceMediaTypes: { image: { maxCount: 3 }, video: { maxCount: 2 } },
      frameSizes: { '16:9': { '720p': [1344, 768], '480p': [896, 512] }, '9:16': { '720p': [768, 1344] } },
      numFramesByDurationSec: { 5: 124, 6: 158 },
      lora: { supported: false, runtimeSwitching: false, baseStrength: 0, adapters: [] },
    })
    expect(await generation.model()).toBe(facts)
    expect(fake.paths).toEqual(['/v1/streamv2/capabilities', '/v1/streamv2/capabilities'])
  })

  it('reads the lora block of the capabilities, with the optional adapter fields only when the server sends them', async () => {
    const lora = {
      supported: true, runtime_switching: true, base_strength: 0,
      adapters: [
        { id: 'a/plain', default_strength: 1, min_strength: 0, max_strength: 1.5 },
        {
          id: 'b/full', default_strength: 0.8, min_strength: 0.2, max_strength: 1,
          description: 'A look.', license: 'MIT', source_url: 'https://example.test/b',
        },
      ],
    }
    const body = { ...CAPABILITIES_BODY, lora }
    const fake = await startFakeBackend((_path, _request, response) => { sendJson(response, { status: 200, body }) })
    expect((await client(fake.port).model()).lora).toEqual({
      supported: true, runtimeSwitching: true, baseStrength: 0,
      adapters: [
        { id: 'a/plain', defaultStrength: 1, minStrength: 0, maxStrength: 1.5 },
        {
          id: 'b/full', defaultStrength: 0.8, minStrength: 0.2, maxStrength: 1,
          description: 'A look.', license: 'MIT', sourceUrl: 'https://example.test/b',
        },
      ],
    })
  })

  it('rejects model facts with the fetch error when the backend is unreachable', async () => {
    const failure = await client(UNREACHABLE_PORT).model().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
  })
})

describe('segment generation', () => {
  it('posts one request per segment and yields the event stream in arrival order', async () => {
    const fake = await startFakeBackend((_path, request, response) => {
      const lastFrame = request!['return_last_frame'] === true
        ? [['last_frame', { data: Buffer.from('frame').toString('base64') }] as [string, object]]
        : []
      sendEvents(response, [
        ...lastFrame,
        ['video_start', { mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' }],
        ['video_chunk', { data: Buffer.from([1, 2]).toString('base64') }],
        ['video_chunk', { data: Buffer.from([3]).toString('base64') }],
        ['done', { timings: { generation_ms: 10, e2e_latency_ms: 12.5 } }],
      ])
    })
    const generation = client(fake.port)
    const references = [{ mediaType: 'video', bytes: Buffer.from('dance clip') }, { mediaType: 'image', bytes: Buffer.from([0, 255]) }]
    expect(await collect(generation.generateSegment(segmentRequest({ references, returnLastFrame: true, seed: 7 }))))
      .toEqual([
        { kind: 'last_frame', png: Buffer.from('frame') },
        { kind: 'video_start', mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
        { kind: 'chunk', bytes: Buffer.from([1, 2]) },
        { kind: 'chunk', bytes: Buffer.from([3]) },
        { kind: 'done', timings: { generation_ms: 10, e2e_latency_ms: 12.5 } },
      ])
    expect((await collect(generation.generateSegment(segmentRequest()))).map(output => output.kind))
      .toEqual(['video_start', 'chunk', 'chunk', 'done'])
    expect(fake.paths).toEqual(['/v1/streamv2/generate', '/v1/streamv2/generate'])
    expect(fake.requests).toEqual([
      {
        prompt: 'A lake',
        references: [{ media_type: 'video', data: Buffer.from('dance clip').toString('base64') }, { media_type: 'image', data: 'AP8=' }],
        width: 1344, height: 768, num_frames: 124, seed: 7, return_last_frame: true,
      },
      { prompt: 'A lake', references: [], width: 1344, height: 768, num_frames: 124, return_last_frame: false },
    ])
  })

  it('sends the selected adapter as the lora field, and no field when the segment names none', async () => {
    const fake = await startFakeBackend((_path, _request, response) => { sendEvents(response, [['done', { timings: {} }]]) })
    const generation = client(fake.port)
    await collect(generation.generateSegment(segmentRequest({ lora: { id: 'a/plain', strength: 0.6 } })))
    await collect(generation.generateSegment(segmentRequest({ lora: { id: 'a/plain' } })))
    await collect(generation.generateSegment(segmentRequest()))
    expect(fake.requests.map(request => request['lora'])).toEqual([{ id: 'a/plain', strength: 0.6 }, { id: 'a/plain' }, undefined])
    expect(fake.requests[2]).not.toHaveProperty('lora')
  })

  it('parses events split across reads, carriage returns, comments, and multi-line data', async () => {
    const fake = await startFakeBackend((_path, _request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
      response.write(': keep-alive\r\nevent: video_start\r\nda')
      response.write('ta: {"mime":\r\ndata: "video/mp4"}\r\n\r\nevent: done\ndata: {"timings": {}}\n\n')
      response.end()
    })
    expect(await collect(client(fake.port).generateSegment(segmentRequest()))).toEqual([
      { kind: 'video_start', mime: 'video/mp4' }, { kind: 'done', timings: {} },
    ])
  })

  it('rejects HTTP 400 and error events with the backend error code', async () => {
    const fake = await startFakeBackend((_path, request, response) => {
      if (request!['prompt'] === 'bad body') {
        sendJson(response, { status: 400, body: { code: 'invalid_request', message: 'num_frames is required' } })
      } else {
        const code = request!['prompt'] === 'bad reference' ? 'invalid_request' : 'generation_failed'
        sendEvents(response, [['video_start', { mime: 'video/mp4' }], ['error', { code, message: `${code} message` }]])
      }
    })
    const generation = client(fake.port)
    const results = await Promise.all(['bad body', 'bad reference', 'worker lost'].map(async prompt =>
      await collect(generation.generateSegment(segmentRequest({ prompt }))).catch((error: unknown) => error)))
    expect(results.map(result =>
      result instanceof GenerationSegmentError ? [result.message, result.errorType] : result))
      .toEqual([
        ['num_frames is required', 'invalid_request'],
        ['invalid_request message', 'invalid_request'],
        ['generation_failed message', 'generation_failed'],
      ])
  })

  it('rejects other statuses, unknown events, and streams that end before done with a plain error', async () => {
    const fake = await startFakeBackend((_path, request, response) => {
      if (request!['prompt'] === 'status') sendJson(response, { status: 500, body: { detail: 'boom' } })
      else if (request!['prompt'] === 'unknown') sendEvents(response, [['progress', { step: 1 }]])
      else sendEvents(response, [['video_start', { mime: 'video/mp4' }]])
    })
    const generation = client(fake.port)
    const results = await Promise.all(['status', 'unknown', 'truncated'].map(async prompt =>
      await collect(generation.generateSegment(segmentRequest({ prompt }))).catch((error: unknown) => error)))
    for (const result of results) expect(result).not.toBeInstanceOf(GenerationSegmentError)
    expect(results.map(result => (result as Error).message)).toEqual([
      'FastVideo generation backend POST /v1/streamv2/generate returned HTTP 500: {"detail":"boom"}',
      'Unexpected FastVideo generation event: progress',
      'FastVideo generation stream ended before its done event.',
    ])
  })

  it('cancels the request and rejects with the abort reason without waiting for the backend', async () => {
    const fake = await startFakeBackend((_path, _request, response) => {
      sendEvents(response, [['video_start', { mime: 'video/mp4' }]], false)
    })
    const controller = new AbortController()
    const outputs: SegmentOutput[] = []
    const streaming = (async () => {
      for await (const output of client(fake.port).generateSegment(segmentRequest({ signal: controller.signal }))) {
        outputs.push(output)
        controller.abort(new Error('project closed'))
      }
    })()
    await expect(streaming).rejects.toThrow(/^project closed$/)
    expect(outputs).toEqual([{ kind: 'video_start', mime: 'video/mp4' }])
    await fake.closed[0]
  })

  it('cancels the request when the reader leaves the iteration early', async () => {
    const fake = await startFakeBackend((_path, _request, response) => {
      sendEvents(response, [['video_start', { mime: 'video/mp4' }]], false)
    })
    for await (const output of client(fake.port).generateSegment(segmentRequest())) {
      expect(output).toEqual({ kind: 'video_start', mime: 'video/mp4' })
      break
    }
    await fake.closed[0]
  })

  it('rejects an already aborted request without sending it', async () => {
    const fake = await startFakeBackend((_path, _request, response) => { sendJson(response, { status: 404, body: {} }) })
    const controller = new AbortController()
    controller.abort(new Error('project closed'))
    await expect(collect(client(fake.port).generateSegment(segmentRequest({ signal: controller.signal }))))
      .rejects.toThrow(/^project closed$/)
    expect(fake.paths).toEqual([])
  })
})
