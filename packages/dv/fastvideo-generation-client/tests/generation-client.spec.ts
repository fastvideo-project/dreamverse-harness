/** The generation client maps the video job routes of a fake backend: submit, status polls, and the video download. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import DvFastvideoGeneration, { GenerationSegmentError, type VideoRequest } from '../src/index.ts'

/** A port in the owned test range on which nothing listens. */
const UNREACHABLE_PORT = 18502

interface Reply { status: number; body: unknown }
/** Answers one HTTP request; `request` is the parsed JSON body of a POST. */
type Route = (method: string, path: string, request: Record<string, unknown> | null, response: ServerResponse) => void

interface FakeBackend {
  /** The ephemeral port that the fake listens on, so no pooled connection of an earlier test can reach it. */
  port: number
  /** `METHOD path` of each request in arrival order. */
  calls: string[]
  requests: Record<string, unknown>[]
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
  const fake: FakeBackend = { port: 0, calls: [], requests: [] }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? ''
    const path = request.url ?? ''
    fake.calls.push(`${method} ${path}`)
    if (method !== 'POST') {
      route(method, path, null, response)
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>
      fake.requests.push(body)
      route(method, path, body, response)
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  fake.port = (server.address() as AddressInfo).port
  return fake
}

/** Answer with one body and close the connection; a string body is sent as text. */
function send(response: ServerResponse, reply: Reply): void {
  const text = typeof reply.body === 'string'
  response.writeHead(reply.status, { 'content-type': text ? 'text/plain' : 'application/json', connection: 'close' })
  response.end(text ? reply.body : JSON.stringify(reply.body))
}

/** A backend that accepts every job as `job-1` and answers each status poll with the next of `statuses`. */
function jobRoute(statuses: object[], video = Buffer.from('MP4')): Route {
  return (method, path, _request, response) => {
    if (method === 'POST') send(response, { status: 200, body: { id: 'job-1', status: 'queued' } })
    else if (path.endsWith('/content')) {
      response.writeHead(200, { 'content-type': 'video/mp4', connection: 'close' })
      response.end(video)
    } else send(response, { status: 200, body: { id: 'job-1', ...statuses.shift() } })
  }
}

function client(port: number): DvFastvideoGeneration {
  const root = new Context()
  roots.push(root)
  return new DvFastvideoGeneration(root, { baseUrl: `http://127.0.0.1:${port}` })
}

function videoRequest(fields: Partial<VideoRequest> = {}): VideoRequest {
  return { task: 'ref2va', prompt: 'A lake', frameWidth: 1344, frameHeight: 768, numFrames: 124, images: [], ...fields }
}

describe('video jobs', () => {
  it('submits one job, polls it until it completes, and downloads its video', async () => {
    const fake = await startFakeBackend(jobRoute([{ status: 'in_progress' }, { status: 'completed', inference_time_s: 2.5 }], Buffer.from([1, 2, 3])))
    const images = [{ mime: 'image/png', bytes: Buffer.from([0, 255]) }, { mime: 'image/jpeg', bytes: Buffer.from('jpg') }]
    const output = await client(fake.port).generateVideo(videoRequest({ images, seed: 7 }))
    expect(output.video).toEqual(Buffer.from([1, 2, 3]))
    expect(output.timings).toEqual({ e2e_latency_ms: expect.any(Number) as number, generation_ms: 2500 })
    expect(fake.calls).toEqual(['POST /v1/videos', 'GET /v1/videos/job-1', 'GET /v1/videos/job-1', 'GET /v1/videos/job-1/content'])
    expect(fake.requests).toEqual([{
      task: 'ref2va', prompt: 'A lake', size: '1344x768', num_frames: 124, seed: 7,
      image_reference: [{ image_url: 'data:image/png;base64,AP8=' }, { image_url: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` }],
    }])
  })

  it('sends no seed and no image references when the request has none, and reports no generation time the backend omits', async () => {
    const fake = await startFakeBackend(jobRoute([{ status: 'completed' }]))
    const output = await client(fake.port).generateVideo(videoRequest({ task: 't2va' }))
    expect(Object.keys(output.timings)).toEqual(['e2e_latency_ms'])
    expect(fake.requests).toEqual([{ task: 't2va', prompt: 'A lake', size: '1344x768', num_frames: 124 }])
  })

  it('rejects a refused submission and a failed job with the backend message and error type', async () => {
    const replies: Record<string, Reply> = {
      detail: { status: 400, body: { detail: 'num_frames must be 17n+5' } },
      list: { status: 400, body: { detail: [{ loc: ['size'], msg: 'bad size' }] } },
      text: { status: 400, body: 'not json' },
    }
    const fake = await startFakeBackend((method, path, request, response) => {
      const prompt = typeof request?.['prompt'] === 'string' ? request['prompt'] : ''
      if (method === 'POST' && replies[prompt] !== undefined) send(response, replies[prompt])
      else if (method === 'POST') send(response, { status: 200, body: { id: prompt, status: 'queued' } })
      else if (path.endsWith('/failed')) send(response, { status: 200, body: { id: 'failed', status: 'failed', error: { code: 500, message: 'CUDA out of memory' } } })
      else send(response, { status: 200, body: { id: 'bare', status: 'failed', error: null } })
    })
    const generation = client(fake.port)
    const results = await Promise.all(['detail', 'list', 'text', 'failed', 'bare'].map(async prompt =>
      await generation.generateVideo(videoRequest({ prompt })).catch((error: unknown) => error)))
    expect(results.map(result => result instanceof GenerationSegmentError ? [result.message, result.errorType] : result)).toEqual([
      ['num_frames must be 17n+5', 'invalid_request'],
      ['[{"loc":["size"],"msg":"bad size"}]', 'invalid_request'],
      ['not json', 'invalid_request'],
      ['CUDA out of memory', 'generation_failed'],
      ['The video job failed.', 'generation_failed'],
    ])
  })

  it('rejects any other status with a plain error that names the route', async () => {
    const fake = await startFakeBackend((method, _path, _request, response) => {
      send(response, method === 'POST' ? { status: 200, body: { id: 'job-1', status: 'queued' } } : { status: 404, body: { detail: 'Video not found' } })
    })
    const failure = await client(fake.port).generateVideo(videoRequest()).catch((error: unknown) => error)
    expect(failure).not.toBeInstanceOf(GenerationSegmentError)
    expect((failure as Error).message).toBe('FastVideo generation backend GET /v1/videos/job-1 returned HTTP 404: {"detail":"Video not found"}')
  })

  it('stops polling and rejects with the abort reason', async () => {
    const fake = await startFakeBackend(jobRoute([{ status: 'in_progress' }, { status: 'in_progress' }]))
    const controller = new AbortController()
    const generating = client(fake.port).generateVideo(videoRequest({ signal: controller.signal }))
    while (fake.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort(new Error('project closed'))
    await expect(generating).rejects.toThrow(/^project closed$/)
    expect(fake.calls).toEqual(['POST /v1/videos', 'GET /v1/videos/job-1'])
  })

  it('rejects an already aborted request without sending it', async () => {
    const fake = await startFakeBackend(jobRoute([]))
    const controller = new AbortController()
    controller.abort(new Error('project closed'))
    await expect(client(fake.port).generateVideo(videoRequest({ signal: controller.signal }))).rejects.toThrow(/^project closed$/)
    expect(fake.calls).toEqual([])
  })

  it('rejects with the fetch error when the backend is unreachable', async () => {
    const failure = await client(UNREACHABLE_PORT).generateVideo(videoRequest()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(GenerationSegmentError)
  })
})
