/** The feedback route: a checked submission becomes one row at the endpoint, and every refusal leaves the endpoint alone. */
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Feedback from '../src/index.ts'
import type { FeedbackSubmission } from '../src/types.ts'

const ENDPOINT = 'https://script.google.com/macros/s/secret-deployment/exec'

/** A Connection that keeps the registered Fetch routes by path. */
class FakeConnection {
  readonly routes = new Map<string, ConnectionFetchRoute>()
  readonly fetch = {
    register: (route: ConnectionFetchRoute): (() => Promise<void>) => {
      this.routes.set(route.path, route)
      return () => { this.routes.delete(route.path); return Promise.resolve() }
    },
  }
}

// Base64 of the 8 bytes of the PNG signature.
const PNG = { name: 'narrator.png', type: 'image/png', data: 'iVBORw0KGgo=' }

const SUBMISSION: FeedbackSubmission = {
  kind: 'problem', areas: ['quality', 'stability'], description: 'The narrator changes voice from clip to clip.',
  attachments: [PNG], email: 'kyle@example.com',
  project: 'p1', session: 's1', view: 'timeline', locale: 'zh-CN', screen: '3840x2160', user_agent: 'Mozilla/5.0',
  version: '0.2.2', commit: 'abc1234',
}

/** Mount the plugin on a Context with a fake Connection. */
async function mount(config: Partial<Feedback.Config> = {}) {
  const ctx = new Context()
  const connection = new FakeConnection()
  ctx.provide('connection', connection)
  const defaults = { endpoint: ENDPOINT, timeoutMs: 30_000, maxDescriptionChars: 5_000, maxAttachments: 5, maxAttachmentBytes: 1024 }
  const fiber = ctx.plugin(Feedback, { ...defaults, ...config })
  await fiber
  const route = connection.routes.get(Feedback.FEEDBACK_ROUTE)
  if (route === undefined) throw new Error('the feedback route is not registered')
  const post = (body: string): Promise<Response> => route.fetch(new Request(`http://dv.test${Feedback.FEEDBACK_ROUTE}`, { method: 'POST', body }))
  return { ctx, connection, fiber, post }
}

/** Replace `fetch` with an endpoint that answers `reply`, and record what it receives. */
function endpoint(reply: () => Response) {
  const calls: { url: string; init: RequestInit | undefined; body: unknown }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body: unknown = JSON.parse(init?.body as string)
    calls.push({ url, init, body })
    return Promise.resolve(reply())
  })
  return calls
}

afterEach(() => { vi.unstubAllGlobals() })

describe('dv-feedback', () => {
  it('sends a submission with its arrival time as one JSON row and answers ok', async () => {
    const calls = endpoint(() => Response.json({ ok: true }))
    const { ctx, post } = await mount()
    const response = await post(JSON.stringify(SUBMISSION))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(ENDPOINT)
    expect(calls[0]?.init?.method).toBe('POST')
    const { time, ...row } = calls[0]?.body as { time: string }
    expect(time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(row).toEqual(SUBMISSION)
    await ctx.root.fiber.dispose()
  })

  it('accepts no email, null context fields, and an attachment without a MIME type', async () => {
    const calls = endpoint(() => Response.json({ ok: true }))
    const { ctx, post } = await mount()
    const bare = {
      ...SUBMISSION, attachments: [{ name: 'dsh.log', type: '', data: '' }], email: null,
      project: null, session: null, view: null, version: null, commit: null,
    }
    expect((await post(JSON.stringify(bare))).status).toBe(200)
    expect(calls[0]?.body).toMatchObject(bare)
    await ctx.root.fiber.dispose()
  })

  it.each([
    ['a body that is not JSON', '{', 'the body must be JSON'],
    ['a body that is not an object', '[]', 'the body must be a JSON object'],
    ['an unknown kind', JSON.stringify({ ...SUBMISSION, kind: 'praise' }), 'kind must be one of problem, feature, question, other'],
    ['an unknown area', JSON.stringify({ ...SUBMISSION, areas: ['billing'] }), 'areas must be a non-empty list of'],
    ['no area', JSON.stringify({ ...SUBMISSION, areas: [] }), 'areas must be a non-empty list of'],
    ['an area named twice', JSON.stringify({ ...SUBMISSION, areas: ['files', 'files'] }), 'areas must name each area at most once'],
    ['no attachment', JSON.stringify({ ...SUBMISSION, description: 'Hi.', attachments: [] }), 'attachments must be a non-empty list'],
    ['too many attachments', JSON.stringify({ ...SUBMISSION, description: 'Hi.', attachments: [PNG, PNG, PNG] }), 'attachments must have at most 2 files'],
    ['an attachment without a name', JSON.stringify({ ...SUBMISSION, description: 'Hi.', attachments: [{ ...PNG, name: ' ' }] }), 'an attachment name must not be empty'],
    ['an attachment that is not base64', JSON.stringify({ ...SUBMISSION, description: 'Hi.', attachments: [{ ...PNG, data: 'not base64!' }] }), 'attachment narrator.png must be base64'],
    ['an attachment over the byte limit', JSON.stringify({ ...SUBMISSION, description: 'Hi.', attachments: [{ ...PNG, data: 'AAAAAAAAAAAA' }] }), 'attachment narrator.png must have at most 8 bytes'],
    ['an email without @', JSON.stringify({ ...SUBMISSION, description: 'Hi.', email: 'kyle.example.com' }), 'email must be an address'],
    ['a blank description', JSON.stringify({ ...SUBMISSION, description: '  \n ' }), 'description must not be empty'],
    ['a description over the limit', JSON.stringify({ ...SUBMISSION, description: '镜'.repeat(11) }), 'description must have at most 10 characters'],
    ['a missing context field', JSON.stringify({ ...SUBMISSION, description: 'Too slow.', screen: undefined }), 'screen must be a string'],
  ])('refuses %s with 400 and sends nothing', async (_case, body, message) => {
    const calls = endpoint(() => Response.json({ ok: true }))
    const { ctx, post } = await mount({ maxDescriptionChars: 10, maxAttachments: 2, maxAttachmentBytes: 8 })
    const response = await post(body)
    expect(response.status).toBe(400)
    expect((await response.json() as { error: string }).error).toContain(message)
    expect(calls).toEqual([])
    await ctx.root.fiber.dispose()
  })

  it('counts description characters, not UTF-16 units', async () => {
    endpoint(() => Response.json({ ok: true }))
    const { ctx, post } = await mount({ maxDescriptionChars: 2 })
    expect((await post(JSON.stringify({ ...SUBMISSION, description: '🎬🎥' }))).status).toBe(200)
    await ctx.root.fiber.dispose()
  })

  it.each([
    ['an error status', () => new Response('quota', { status: 500 }), 'HTTP 500'],
    ['an HTML page with status 200, as a failing Apps Script answers', () => new Response('<html>TypeError</html>', { status: 200 }), 'HTTP 200'],
    ['JSON without ok', () => Response.json({ ok: false }), 'HTTP 200'],
  ])('answers 502 without naming the endpoint when the endpoint answers %s', async (_case, reply, message) => {
    endpoint(reply)
    const { ctx, post } = await mount()
    const response = await post(JSON.stringify(SUBMISSION))
    expect(response.status).toBe(502)
    const text = await response.text()
    expect(text).toContain(message)
    expect(text).not.toContain('secret-deployment')
    await ctx.root.fiber.dispose()
  })

  it('answers 502 when the endpoint cannot be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))
    const { ctx, post } = await mount()
    const response = await post(JSON.stringify(SUBMISSION))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'fetch failed' })
    await ctx.root.fiber.dispose()
  })

  it('removes the route when the plugin unloads', async () => {
    const { ctx, connection, fiber } = await mount()
    await fiber.dispose()
    expect(connection.routes.has(Feedback.FEEDBACK_ROUTE)).toBe(false)
    await ctx.root.fiber.dispose()
  })

  it('refuses a config without an HTTPS endpoint', () => {
    // The Loader passes the YAML config untyped; JSON.parse stands in for it.
    const raw = (text: string): Feedback.Config => JSON.parse(text) as Feedback.Config
    expect(() => Feedback.Config(raw('{"endpoint": "http://script.google.com/exec"}'))).toThrow()
    expect(() => Feedback.Config(raw('{}'))).toThrow()
  })
})
