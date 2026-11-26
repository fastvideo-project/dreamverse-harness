/** Check the Clip Generation client against the fake Reactor API: uploads, submission, polling, download, errors and cancellation. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ClipRequest, Upload } from '../src/client.ts'
import { generateClip, type GenerationOptions } from '../src/generations.ts'
import { failed, installFakeReactor, pending, SIGNED_URL, succeeded, UPLOAD_ORIGIN, type FakeCall } from './fake-reactor-api.ts'

const KEY = 'rk_secret_key'
let dir = ''

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dv-reactor-generations-')) })
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

function upload(name: string, mime: string, text = name): Upload {
  const path = join(dir, name)
  writeFileSync(path, text)
  return { name, path, mime }
}

function clip(over: Partial<ClipRequest> = {}): ClipRequest {
  return { apiBaseUrl: 'https://api.reactor.inc', model: 'reactor/fast-h3', workflow: { kind: 'generation' }, aspect: '16:9',
    resolution: '768p', seconds: 8, prompt: 'A lake', seed: 7, images: [], audio: [], videos: [], ...over }
}

function options(over: Partial<GenerationOptions> = {}, request: Partial<ClipRequest> = {}): GenerationOptions {
  return { apiBaseUrl: 'https://api.reactor.inc', apiKey: KEY, model: 'reactor/fast-h3', fields: {}, request: clip(request),
    pollMs: 1, timeoutSeconds: 30, ...over }
}

const signal = (): AbortSignal => new AbortController().signal
const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  const error = await promise.then(() => undefined, (reason: unknown) => reason)
  if (!(error instanceof Error)) throw new Error('Expected a rejection')
  return error
}
const where = (calls: FakeCall[], method: string, path: string): FakeCall[] =>
  calls.filter(call => call.method === method && new URL(call.url).pathname === path)

it('uploads every input, submits once, polls to success and downloads the signed MP4 without credentials', async () => {
  const calls = installFakeReactor({ video: new Uint8Array([9, 8, 7]), statuses: [pending('queued'), pending('running'), () => succeeded()] })
  const result = await generateClip(options({ model: 'reactor/pika-h3-flex', fields: { first: 'first_frame_image', last: 'last_frame_image', resolution: true } }, {
    images: [upload('a.png', 'image/png')], audio: [upload('b.wav', 'audio/wav')], videos: [upload('c.mp4', 'video/mp4')],
    firstFrame: upload('first.png', 'image/png'), lastFrame: upload('last.png', 'image/png'),
  }), signal())
  expect([...result.bytes]).toEqual([9, 8, 7])
  expect(Object.keys(result.timings).sort()).toEqual(['reactor_download_s', 'reactor_generation_s', 'reactor_upload_s'])
  expect(where(calls, 'POST', '/files').map(call => call.json)).toEqual([
    { name: 'a.png', size: 5, mime_type: 'image/png' }, { name: 'b.wav', size: 5, mime_type: 'audio/wav' },
    { name: 'c.mp4', size: 5, mime_type: 'video/mp4' }, { name: 'first.png', size: 9, mime_type: 'image/png' },
    { name: 'last.png', size: 8, mime_type: 'image/png' },
  ])
  const puts = calls.filter(call => call.method === 'PUT')
  expect(puts.map(call => call.url)).toEqual([1, 2, 3, 4, 5].map(index => `${UPLOAD_ORIGIN}/put/${index}`))
  expect(puts.map(call => call.headers.get('content-type'))).toEqual(['image/png', 'audio/wav', 'video/mp4', 'image/png', 'image/png'])
  const submissions = where(calls, 'POST', '/generations')
  expect(submissions).toHaveLength(1)
  expect(submissions[0]?.json).toEqual({ model: 'reactor/pika-h3-flex', input: {
    prompt: 'A lake', seconds: 8, aspect: '16:9', resolution: '768p', seed: 7, reference_images: ['file-1'],
    reference_audios: ['file-2'], reference_videos: ['file-3'], first_frame_image: 'file-4', last_frame_image: 'file-5',
  } })
  expect(where(calls, 'GET', '/generations/gen-1')).toHaveLength(3)
  for (const call of calls) {
    const own = new URL(call.url).origin === 'https://api.reactor.inc'
    expect(call.headers.get('authorization')).toBe(own ? `Bearer ${KEY}` : null)
    if (own) expect(call.redirect).toBe('error')
  }
  expect(calls.at(-1)?.url).toBe(SIGNED_URL)
})

it('sends only the fields the profile and request carry', async () => {
  const calls = installFakeReactor()
  const { seed: _seed, ...noSeed } = clip()
  await generateClip(options({ request: { ...noSeed, firstFrame: upload('first.png', 'image/png') } }), signal())
  expect(where(calls, 'POST', '/generations')[0]?.json).toEqual({
    model: 'reactor/fast-h3', input: { prompt: 'A lake', seconds: 8, aspect: '16:9' },
  })
  expect(where(calls, 'POST', '/files')).toHaveLength(0)
})

it('refuses to start when the caller already aborted', async () => {
  const calls = installFakeReactor()
  const reason = new Error('Stop')
  await expect(generateClip(options(), AbortSignal.abort(reason))).rejects.toBe(reason)
  expect(calls).toEqual([])
})

it.each([
  ['upload', 'POST', '/files'], ['submission', 'POST', '/generations'], ['status poll', 'GET', '/generations/gen-1'],
])('tells the user to fix the key when Reactor answers 401 to the %s', async (_label, method, path) => {
  const calls = installFakeReactor({ override: call => call.method === method && new URL(call.url).pathname === path
    ? Response.json({ error: 'unauthorized', message: `bad ${KEY}` }, { status: 401 }) : undefined })
  const error = await rejection(generateClip(options({}, { images: [upload('a.png', 'image/png')] }), signal()))
  expect(error.message).toBe('Reactor rejected the API key. Set a valid Reactor key on the DreamVerse host.')
  expect(error.message).not.toContain(KEY)
  expect(where(calls, 'POST', '/generations').length).toBeLessThanOrEqual(1)
})

it.each([
  [400, { error: 'invalid_input', message: `seconds must be 5 to 15 for ${KEY}\nplease.` }, 'HTTP 400: seconds must be 5 to 15 for [key] please'],
  [402, { error: 'x', message: 'Add credits' }, 'HTTP 402: Add credits'],
  [429, { error: 'no_capacity', message: 'Busy' }, 'HTTP 429: Busy. Retry after 10 seconds.'],
  [503, { message: 'x'.repeat(400) }, `HTTP 503: ${'x'.repeat(300)}…`],
])('quotes the reason of an HTTP %s refusal of the submission once', async (status, body, text) => {
  const calls = installFakeReactor({ override: call => call.method === 'POST' && call.url.endsWith('/generations')
    ? Response.json(body, { status, headers: { 'retry-after': '10' } }) : undefined })
  const error = await rejection(generateClip(options(), signal()))
  expect(error.message).toContain(text.replace(' Retry after 10 seconds.', ''))
  if (status === 429) expect(error.message).toContain('Retry after 10 seconds.')
  expect(where(calls, 'POST', '/generations')).toHaveLength(1)
})

it.each([
  ['a body that is not JSON', new Response('<html>', { status: 500 })],
  ['a JSON body without a message', Response.json({ error: 'boom' }, { status: 500 })],
  ['a JSON body that is not an object', Response.json([1], { status: 500 })],
  ['a blank message', Response.json({ message: '  ' }, { status: 500 })],
])('reports only the status for %s', async (_label, reply) => {
  installFakeReactor({ override: call => call.url.endsWith('/generations') ? reply : undefined })
  expect((await rejection(generateClip(options(), signal()))).message)
    .toBe('Reactor generation request returned HTTP 500. Check the key, billing, and model access.')
})

it.each([
  ['the submission is not JSON', (call: FakeCall) => call.method === 'POST' && call.url.endsWith('/generations') ? new Response('nope') : undefined,
    'Reactor returned invalid JSON for the generation request.'],
  ['the submission has no ID', (call: FakeCall) => call.method === 'POST' && call.url.endsWith('/generations') ? Response.json({ id: '' }) : undefined,
    'Reactor did not return a generation ID; do not automatically resubmit this paid request.'],
  ['the submission is not an object', (call: FakeCall) => call.method === 'POST' && call.url.endsWith('/generations') ? Response.json(null) : undefined,
    'Reactor did not return a generation ID'],
  ['the status is not JSON', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1') ? new Response('nope') : undefined,
    'Reactor returned invalid JSON for the generation status.'],
  ['the status is unknown', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1') ? Response.json({ status: 'paused' }) : undefined,
    'Reactor returned an invalid generation status.'],
  ['the status is not an object', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1') ? Response.json('x') : undefined,
    'Reactor returned an invalid generation status.'],
  ['a file entry is malformed', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1')
    ? Response.json({ status: 'succeeded', files: [{ name: 'output.mp4' }] }) : undefined, 'Reactor returned an invalid generation file list.'],
  ['a file entry is not an object', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1')
    ? Response.json({ status: 'succeeded', files: ['output.mp4'] }) : undefined, 'Reactor returned an invalid generation file list.'],
  ['the generation succeeded without files', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1')
    ? Response.json({ status: 'succeeded', files: null }) : undefined, 'Reactor generation gen-1 finished without output.mp4.'],
  ['the generation has no MP4', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1')
    ? Response.json({ status: 'succeeded', files: [{ name: 'last_frame.png', url: 'https://f.test/x' }] }) : undefined,
  'Reactor generation gen-1 finished without output.mp4.'],
  ['the generation expired', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1')
    ? Response.json({ error: 'generation_expired' }, { status: 410 }) : undefined, 'Reactor already deleted the generation result.'],
  ['the status poll fails', (call: FakeCall) => call.method === 'GET' && call.url.endsWith('/generations/gen-1')
    ? Response.json({ message: 'down' }, { status: 500 }) : undefined, 'Reactor generation status returned HTTP 500: down.'],
])('fails when %s', async (_label, override, message) => {
  installFakeReactor({ override })
  expect((await rejection(generateClip(options(), signal()))).message).toContain(message)
})

it('reports a failed generation with its code and message', async () => {
  installFakeReactor({ statuses: [failed('moderated', `Rejected for ${KEY}`)] })
  expect((await rejection(generateClip(options(), signal()))).message).toBe('Reactor generation gen-1 failed with moderated: Rejected for [key].')
})

it('reports a failed generation without an error object', async () => {
  installFakeReactor({ statuses: [Response.json({ status: 'failed', files: null, error: { code: 7, message: 7 } })] })
  expect((await rejection(generateClip(options(), signal()))).message).toBe('Reactor generation gen-1 failed with unknown.')
  installFakeReactor({ statuses: [Response.json({ status: 'failed' })] })
  expect((await rejection(generateClip(options(), signal()))).message).toBe('Reactor generation gen-1 failed with unknown.')
})

it.each([429, 503])('waits and polls again after HTTP %s', async (status) => {
  const calls = installFakeReactor({ statuses: [new Response(null, { status, headers: { 'retry-after': '0.001' } }), new Response(null, { status }), () => succeeded()] })
  await generateClip(options(), signal())
  expect(where(calls, 'GET', '/generations/gen-1')).toHaveLength(3)
})

it('honors a Retry-After from a pending status', async () => {
  const calls = installFakeReactor({ statuses: [pending('running', { 'retry-after': '0.001' }), () => succeeded()] })
  await generateClip(options({ pollMs: 60_000 }), signal())
  expect(where(calls, 'GET', '/generations/gen-1')).toHaveLength(2)
})

it.each([
  ['an upload that is not JSON', (call: FakeCall) => call.url.endsWith('/files') ? new Response('x') : undefined, 'invalid JSON for a file upload'],
  ['an upload without a file ID', (call: FakeCall) => call.url.endsWith('/files') ? Response.json({ presigned_url: `${UPLOAD_ORIGIN}/p` }) : undefined, 'invalid file upload'],
  ['an upload without a URL', (call: FakeCall) => call.url.endsWith('/files') ? Response.json({ file_id: 'f' }) : undefined, 'invalid file upload'],
  ['an upload that is not an object', (call: FakeCall) => call.url.endsWith('/files') ? Response.json(3) : undefined, 'invalid file upload'],
  ['an upload URL that is not HTTPS', (call: FakeCall) => call.url.endsWith('/files') ? Response.json({ file_id: 'f', presigned_url: 'http://upload.example.test/p' }) : undefined,
    'upload URL that is not an HTTPS URL'],
  ['an upload URL that is not a URL', (call: FakeCall) => call.url.endsWith('/files') ? Response.json({ file_id: 'f', presigned_url: 'nope' }) : undefined,
    'upload URL that is not an HTTPS URL'],
  ['storage that rejects the bytes', (call: FakeCall) => call.method === 'PUT' ? new Response('no', { status: 403 }) : undefined,
    'Reactor storage rejected the upload of a.png with HTTP 403.'],
])('fails on %s', async (_label, override, message) => {
  const calls = installFakeReactor({ override })
  const error = await rejection(generateClip(options({}, { images: [upload('a.png', 'image/png')] }), signal()))
  expect(error.message).toContain(message)
  expect(where(calls, 'POST', '/generations')).toHaveLength(0)
})

it('retries the download once with a fresh URL, then fails', async () => {
  const bad = (call: FakeCall): Response | undefined => call.url.startsWith('https://files.example.test/output.mp4') ? new Response('expired', { status: 403 }) : undefined
  const calls = installFakeReactor({ override: bad })
  expect((await rejection(generateClip(options(), signal()))).message).toBe('Reactor generation gen-1 returned no downloadable output.mp4.')
  expect(calls.filter(call => call.url === SIGNED_URL)).toHaveLength(2)
  let first = true
  const once = installFakeReactor({ override: (call) => {
    if (!call.url.startsWith(SIGNED_URL.split('?')[0]!)) return undefined
    const expired = first
    first = false
    return expired ? new Response('expired', { status: 403 }) : undefined
  } })
  expect((await generateClip(options(), signal())).bytes.length).toBe(3)
  expect(once.filter(call => call.url === SIGNED_URL)).toHaveLength(2)
})

it.each([
  ['empty', () => new Response(new Uint8Array())],
])('fails when the downloaded MP4 is %s', async (_label, reply) => {
  installFakeReactor({ override: call => call.url === SIGNED_URL ? reply() : undefined })
  expect((await rejection(generateClip(options(), signal()))).message).toContain('returned no downloadable output.mp4')
})

it('refuses a clip URL that is not HTTPS', async () => {
  const calls = installFakeReactor({ statuses: [Response.json({ status: 'succeeded', files: [{ name: 'output.mp4', url: 'http://files.example.test/o.mp4' }] })] })
  expect((await rejection(generateClip(options(), signal()))).message).toBe('Reactor returned a clip URL that is not an HTTPS URL.')
  expect(calls.some(call => call.url.startsWith('http://files'))).toBe(false)
})

it('cancels the Reactor generation when the caller aborts while polling', async () => {
  const calls = installFakeReactor({ statuses: [pending('running')] })
  const controller = new AbortController()
  const reason = new Error('Cancelled by operator')
  const outcome = generateClip(options({ pollMs: 60_000 }), controller.signal)
  await vi.waitFor(() => { expect(where(calls, 'GET', '/generations/gen-1')).toHaveLength(1) })
  controller.abort(reason)
  await expect(outcome).rejects.toBe(reason)
  const [cancel] = where(calls, 'DELETE', '/sessions/gen-1')
  expect(cancel?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
  expect(cancel?.json).toEqual({ reason: 'Cancelled by the DreamVerse host.' })
})

it('does not fail the abort when the cancellation request fails', async () => {
  const calls = installFakeReactor({ statuses: [pending('running')], override: call => call.method === 'DELETE' ? Response.error() : undefined })
  const controller = new AbortController()
  const outcome = generateClip(options({ pollMs: 60_000 }), controller.signal)
  await vi.waitFor(() => { expect(where(calls, 'GET', '/generations/gen-1')).toHaveLength(1) })
  const reason = new Error('Cancelled')
  controller.abort(reason)
  await expect(outcome).rejects.toBe(reason)
})

it('does not send a cancellation when the abort comes before Reactor accepted the generation', async () => {
  const calls = installFakeReactor({ override: call => call.url.endsWith('/generations') && call.method === 'POST'
    ? new Promise<Response>((_resolve, reject) => { call.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }) }) : undefined })
  const controller = new AbortController()
  const outcome = generateClip(options(), controller.signal)
  await vi.waitFor(() => { expect(where(calls, 'POST', '/generations')).toHaveLength(1) })
  const reason = new Error('Cancelled')
  controller.abort(reason)
  await expect(outcome).rejects.toBe(reason)
  expect(where(calls, 'DELETE', '/sessions/gen-1')).toHaveLength(0)
})

it('stops at the deadline, cancels the accepted generation, and names it', async () => {
  const calls = installFakeReactor({ statuses: [pending('running')] })
  const error = await rejection(generateClip(options({ timeoutSeconds: 1, pollMs: 20 }), signal()))
  expect(error.message).toBe('Reactor generation timed out after 1 seconds (generation gen-1); Reactor was asked to cancel it.')
  expect(where(calls, 'DELETE', '/sessions/gen-1')[0]?.json).toEqual({ reason: 'Exceeded the DreamVerse deadline.' })
})

it('times out before acceptance without a cancellation', async () => {
  const calls = installFakeReactor({ override: call => call.url.endsWith('/generations') && call.method === 'POST'
    ? new Promise<Response>((_resolve, reject) => { call.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }) }) : undefined })
  const error = await rejection(generateClip(options({ timeoutSeconds: 1 }), signal()))
  expect(error.message).toBe('Reactor generation timed out after 1 seconds.')
  expect(where(calls, 'DELETE', '/sessions/gen-1')).toHaveLength(0)
})
