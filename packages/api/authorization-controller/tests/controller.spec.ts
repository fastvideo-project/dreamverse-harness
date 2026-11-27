/** Authorization Remote exposes only offered flows and relays each attempt's notices and prompts. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationFlow, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it } from 'vitest'
import AuthorizationController from '../src/index.ts'
import type { AuthorizationAttemptFrame, AuthorizationPromptId } from '../src/types.ts'

const CODEX = credentialKey('llm-pi-ai', 'openai-codex')
const CLAUDE = credentialKey('llm-pi-ai', 'anthropic')
const UNREGISTERED = credentialKey('llm-pi-ai', 'github-copilot')

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()!() })

async function fixture(flows: string[] = [CODEX, UNREGISTERED], preferredOptions: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-authorization-controller-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  const controller = new AuthorizationController(ctx, { flows, preferredOptions })
  return { ctx, controller }
}

/** A flow that runs `body`, then commits a grant for its key. */
function flow(
  key: CredentialKey,
  body: (session: AuthorizationSession) => Promise<void> = () => Promise.resolve(),
): AuthorizationFlow {
  return {
    key,
    label: key === CODEX ? 'OpenAI (ChatGPT Plus/Pro)' : 'Anthropic',
    methods: [{ id: 'oauth', label: 'Sign in' }, { id: 'device', label: 'Device code' }],
    async run(session) {
      await body(session)
      await session.commit({ kind: 'grant', payload: { access: 'at' } })
    },
  }
}

/** Read frames until `stop` matches or the stream ends. */
async function readUntil(
  stream: AsyncIterator<AuthorizationAttemptFrame>,
  stop: (frame: AuthorizationAttemptFrame) => boolean,
): Promise<AuthorizationAttemptFrame[]> {
  const frames: AuthorizationAttemptFrame[] = []
  for (;;) {
    const next = await stream.next()
    if (next.done === true) return frames
    frames.push(next.value)
    if (stop(next.value)) return frames
  }
}

function open(controller: AuthorizationController, key: string, signal = new AbortController().signal) {
  return controller.begin({ key }, signal)[Symbol.asyncIterator]()
}

async function remoteError(promise: Promise<unknown>): Promise<RemoteError> {
  const error: unknown = await promise.then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(RemoteError)
  return error as RemoteError
}

describe('AuthorizationController', () => {
  it('lists only offered, registered flows with their stored state', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow(flow(CODEX))
    ctx.authorization.registerFlow(flow(CLAUDE))

    expect(await controller.list()).toEqual([{
      key: CODEX,
      label: 'OpenAI (ChatGPT Plus/Pro)',
      methods: [{ id: 'oauth', label: 'Sign in' }, { id: 'device', label: 'Device code' }],
      inFlight: false, signedIn: false,
    }])
    await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve({ kind: 'grant', payload: { access: 'at' } }))
    expect((await controller.list())[0]?.signedIn).toBe(true)
  })

  it('refuses a configured key that is not a credential key at construction', async () => {
    await expect(fixture(['not-a-key'])).rejects.toThrow(/must be "<scope>\/<id>"/)
  })

  it('refuses a preferred option for a key outside flows at construction', async () => {
    await expect(fixture([CODEX], { [CLAUDE]: 'device_code' })).rejects.toThrow(/not in flows/)
  })

  it('marks the preferred option on select prompts that offer it', async () => {
    const { ctx, controller } = await fixture([CODEX], { [CODEX]: 'device_code' })
    ctx.authorization.registerFlow(flow(CODEX, async (session) => {
      await session.prompt({ kind: 'select', message: 'Method', options: [{ id: 'browser', label: 'Browser' }, { id: 'device_code', label: 'Device' }] })
      await session.prompt({ kind: 'select', message: 'Other', options: [{ id: 'a', label: 'A' }] })
    }))
    const stream = open(controller, CODEX)

    const [offered] = await readUntil(stream, frame => frame.type === 'prompt')
    if (offered?.type !== 'prompt') throw new Error('expected a prompt frame')
    expect(offered.prompt).toMatchObject({ kind: 'select', preferred: 'device_code' })
    controller.answer(CODEX, offered.id, 'device_code')
    const [absent] = await readUntil(stream, frame => frame.type === 'prompt')
    if (absent?.type !== 'prompt') throw new Error('expected a prompt frame')
    expect(absent.prompt).not.toHaveProperty('preferred')
    controller.answer(CODEX, absent.id, 'a')
    expect(await readUntil(stream, () => false)).toEqual([{ type: 'settled', status: 'authorized' }])
  })

  it('keeps unlisted and unregistered flows unreachable', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow(flow(CLAUDE))

    expect((await remoteError(open(controller, CLAUDE).next())).code).toBe('authorization/not-offered')
    expect((await remoteError(open(controller, UNREGISTERED).next())).code).toBe('authorization/not-offered')
    expect(() => { controller.cancel(CLAUDE) }).toThrow(/not an offered sign-in/)
    expect((await remoteError(controller.signOut(CLAUDE))).code).toBe('authorization/not-offered')
    expect(() => { controller.answer(CLAUDE, randomUUID() as AuthorizationPromptId, 'x') })
      .toThrow(/not an offered sign-in/)
  })

  it('relays notices and prompts, and settles authorized once the answer commits a record', async () => {
    const { ctx, controller } = await fixture()
    let answered: string | undefined
    ctx.authorization.registerFlow(flow(CODEX, async (session) => {
      session.notify({ message: 'Enter the code', url: 'https://auth.example/device', code: 'ABCD-1234' })
      session.notify({ message: 'Waiting' })
      const method = await session.prompt({
        kind: 'select', message: 'Pick one',
        options: [{ id: 'browser', label: 'Browser' }, { id: 'device', label: 'Device', description: 'headless' }],
      })
      answered = await session.prompt({ kind: 'text', message: `Paste for ${method}`, placeholder: 'http://localhost' })
      await session.prompt({ kind: 'secret', message: 'Secret' })
    }))
    const stream = open(controller, CODEX)

    const first = await readUntil(stream, frame => frame.type === 'prompt')
    expect(first.slice(0, 2)).toEqual([
      { type: 'notice', notice: { message: 'Enter the code', url: 'https://auth.example/device', code: 'ABCD-1234' } },
      { type: 'notice', notice: { message: 'Waiting' } },
    ])
    const select = first[2]
    if (select?.type !== 'prompt') throw new Error('expected a prompt frame')
    expect(select.prompt).toEqual({
      kind: 'select', message: 'Pick one',
      options: [{ id: 'browser', label: 'Browser' }, { id: 'device', label: 'Device', description: 'headless' }],
    })
    expect((await controller.list())[0]?.inFlight).toBe(true)
    controller.answer(CODEX, select.id, 'device')

    const [text] = await readUntil(stream, frame => frame.type === 'prompt')
    if (text?.type !== 'prompt') throw new Error('expected a prompt frame')
    expect(text.prompt).toEqual({ kind: 'text', message: 'Paste for device', placeholder: 'http://localhost' })
    controller.answer(CODEX, text.id, 'pasted')
    const [secret] = await readUntil(stream, frame => frame.type === 'prompt')
    if (secret?.type !== 'prompt') throw new Error('expected a prompt frame')
    expect(secret.prompt).toEqual({ kind: 'secret', message: 'Secret' })
    controller.answer(CODEX, secret.id, 'hidden')

    expect(await readUntil(stream, () => false)).toEqual([{ type: 'settled', status: 'authorized' }])
    expect(answered).toBe('pasted')
    expect((await controller.list())[0]).toMatchObject({ signedIn: true, inFlight: false })
    expect(() => { controller.answer(CODEX, select.id, 'late') }).toThrow(/no open prompt/)
  })

  it('settles cancelled when the browser declines a prompt', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow(flow(CODEX, async (session) => {
      await session.prompt({ kind: 'text', message: 'Code?' })
    }))
    const stream = open(controller, CODEX)
    const [prompt] = await readUntil(stream, frame => frame.type === 'prompt')
    if (prompt?.type !== 'prompt') throw new Error('expected a prompt frame')

    controller.decline(CODEX, prompt.id)

    expect(await readUntil(stream, () => false)).toEqual([{ type: 'settled', status: 'cancelled' }])
    expect((await ctx.credentials.describeRecord(CODEX)).configured).toBe(false)
  })

  it('reports a prompt its own flow withdraws, and skips one withdrawn before it was asked', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow(flow(CODEX, async (session) => {
      const retired = new AbortController()
      retired.abort()
      await session.prompt({ kind: 'text', message: 'Never shown', signal: retired.signal }).catch(() => undefined)
      const race = new AbortController()
      const asked = session.prompt({ kind: 'text', message: 'Paste or wait', signal: race.signal })
      race.abort()
      await asked.catch(() => undefined)
    }))

    const frames = await readUntil(open(controller, CODEX), () => false)

    expect(frames.map(frame => frame.type)).toEqual(['prompt', 'prompt-withdrawn', 'settled'])
    const [asked, withdrawn] = frames
    if (asked?.type !== 'prompt' || withdrawn?.type !== 'prompt-withdrawn') throw new Error('unexpected frames')
    expect(withdrawn.id).toBe(asked.id)
    expect(frames[2]).toEqual({ type: 'settled', status: 'authorized' })
  })

  it('ends the stream with the flow failure and its code', async () => {
    const { ctx, controller } = await fixture()
    const coded = Object.assign(new Error('token exchange failed'), { code: 'EXCHANGE' })
    ctx.authorization.registerFlow(flow(CODEX, () => Promise.reject(coded)))

    const error = await remoteError(readUntil(open(controller, CODEX), () => false))

    expect(error.code).toBe('authorization/failed')
    expect(error.message).toBe('token exchange failed')
    expect(error.details).toEqual({ key: CODEX, code: 'EXCHANGE' })
  })

  it('reports a non-Error rejection without a code', async () => {
    const { ctx, controller } = await fixture()
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the non-Error path is the subject
    ctx.authorization.registerFlow(flow(CODEX, () => Promise.reject('offline')))

    const error = await remoteError(readUntil(open(controller, CODEX), () => false))

    expect(error.message).toBe('offline')
    expect(error.details).toEqual({ key: CODEX })
  })

  it('refuses a second attempt while one runs, and withdraws an attempt whose reader stops', async () => {
    const { ctx, controller } = await fixture()
    let aborted: AbortSignal | undefined
    ctx.authorization.registerFlow(flow(CODEX, async (session) => {
      aborted = session.signal
      await session.prompt({ kind: 'text', message: 'Code?' })
    }))
    const first = open(controller, CODEX)
    await readUntil(first, frame => frame.type === 'prompt')

    const second = await remoteError(open(controller, CODEX).next())
    expect(second.code).toBe('authorization/failed')
    expect(second.details).toEqual({ key: CODEX, code: 'ALREADY_IN_FLIGHT' })

    await first.return?.(undefined)
    expect(aborted?.aborted).toBe(true)
    await expect.poll(async () => (await controller.list())[0]?.inFlight).toBe(false)
  })

  it('withdraws the attempt when the carrier aborts or cancel is called', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow(flow(CODEX, async (session) => {
      await new Promise((resolve) => { session.signal.addEventListener('abort', resolve, { once: true }) })
    }))
    const carrier = new AbortController()
    const viaSignal = readUntil(open(controller, CODEX, carrier.signal), () => false)
    await expect.poll(async () => (await controller.list())[0]?.inFlight).toBe(true)
    carrier.abort()
    expect(await viaSignal).toEqual([{ type: 'settled', status: 'cancelled' }])

    const viaCancel = readUntil(open(controller, CODEX), () => false)
    await expect.poll(async () => (await controller.list())[0]?.inFlight).toBe(true)
    controller.cancel(CODEX)
    expect(await viaCancel).toEqual([{ type: 'settled', status: 'cancelled' }])
  })

  it('runs the method the browser picked, and the first declared method otherwise', async () => {
    const { ctx, controller } = await fixture()
    const methods: string[] = []
    ctx.authorization.registerFlow(flow(CODEX, (session) => { methods.push(session.method); return Promise.resolve() }))

    await readUntil(controller.begin({ key: CODEX, method: 'device' }, new AbortController().signal)[Symbol.asyncIterator](), () => false)
    await readUntil(open(controller, CODEX), () => false)

    expect(methods).toEqual(['device', 'oauth'])
  })

  it('signs out by deleting the stored record', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow(flow(CODEX))
    await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve({ kind: 'grant', payload: { access: 'at' } }))

    await controller.signOut(CODEX)

    expect((await ctx.credentials.describeRecord(CODEX)).configured).toBe(false)
    expect((await controller.list())[0]?.signedIn).toBe(false)
  })

  it('rejects malformed payloads as bad requests', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow(flow(CODEX))

    expect((await remoteError(open(controller, '').next())).code).toBe('gateway/bad-request')
    expect(() => { controller.answer(CODEX, 'not-a-uuid' as AuthorizationPromptId, 'x') }).toThrow(/invalid payload/)
    expect(() => { controller.decline(CODEX, randomUUID() as AuthorizationPromptId) }).toThrow(/no open prompt/)
  })
})
