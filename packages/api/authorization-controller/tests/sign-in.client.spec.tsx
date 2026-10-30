// @vitest-environment jsdom
/** Provider sign-in: the store over a scripted `authorization` namespace, and the card block it renders. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AuthorizationAttemptFrame, AuthorizationFlowView, AuthorizationPromptId, CredentialKey,
} from '../src/types.ts'
import { signInKey, SignInStore } from '../src/client/sign-in.ts'
import type { AuthorizationRemote } from '../src/client/sign-in.ts'
import { CodexSignInSection, SignInArea, SignInPanel } from '../src/client/CodexSignIn.tsx'
import type { SignInPanelProps } from '../src/client/CodexSignIn.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]
const KEY = 'llm-pi-ai/openai-codex'
const PROMPT = 'p1' as AuthorizationPromptId

/** One scripted attempt stream: the test pushes frames, then ends or fails it. */
class Attempt implements RemoteStreamHandle<AuthorizationAttemptFrame, never> {
  private readonly queue: AuthorizationAttemptFrame[] = []
  private wake: (() => void) | undefined
  private outcome: { error?: unknown } | undefined

  constructor(private readonly signal: AbortSignal | undefined) {
    signal?.addEventListener('abort', () => { this.wake?.() })
  }

  push(frame: AuthorizationAttemptFrame): void {
    this.queue.push(frame)
    this.wake?.()
  }

  finish(error?: unknown): void {
    this.outcome = error === undefined ? {} : { error }
    this.wake?.()
  }

  send(): void {}
  end(): void {}
  dispose(): void {}

  async *[Symbol.asyncIterator](): AsyncIterator<AuthorizationAttemptFrame> {
    for (;;) {
      const frame = this.queue.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      if (this.signal?.aborted === true) return
      if (this.outcome !== undefined) {
        if ('error' in this.outcome) throw this.outcome.error
        return
      }
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }
}

function flow(overrides: Partial<AuthorizationFlowView> = {}): AuthorizationFlowView {
  return {
    key: KEY as CredentialKey, label: 'ChatGPT', methods: [], inFlight: false, signedIn: false, ...overrides,
  }
}

const done: RemoteResult<void> = { ok: true, value: undefined }
const refused: RemoteResult<void> = {
  ok: false, error: new RemoteError('authorization/no-prompt', 'no such prompt', { key: KEY, id: PROMPT }),
}
const unavailable = (message: string): RemoteResult<AuthorizationFlowView[]> =>
  ({ ok: false, error: new RemoteError('gateway/internal', message, {}) })

function scripted() {
  const attempts: Attempt[] = []
  const remote = {
    list: vi.fn((): Promise<RemoteResult<AuthorizationFlowView[]>> => Promise.resolve({ ok: true, value: [flow()] })),
    begin: vi.fn((_request: { key: string; method?: string }, signal?: AbortSignal) => {
      const attempt = new Attempt(signal)
      attempts.push(attempt)
      return attempt
    }),
    answer: vi.fn((_key: string, _id: AuthorizationPromptId, _value: string) => Promise.resolve(done)),
    decline: vi.fn((_key: string, _id: AuthorizationPromptId) => Promise.resolve(done)),
    cancel: vi.fn((_key: string) => Promise.resolve(done)),
    signOut: vi.fn((_key: string) => Promise.resolve(done)),
  } satisfies AuthorizationRemote
  const store = new SignInStore(remote)
  return { remote, store, attempts, latest: (): Attempt => attempts.at(-1)! }
}

const snapshot = (store: SignInStore) => store.store.getSnapshot()

describe('SignInStore', () => {
  it('names a card flow by settings namespace and route id', () => {
    expect(signInKey('llm-pi-ai', 'openai-codex')).toBe(KEY)
  })

  it('lists flows, keeps the latest answer, and records a refused list', async () => {
    const { remote, store } = scripted()
    expect(snapshot(store).status).toBe('idle')
    remote.list.mockResolvedValueOnce({ ok: true, value: [] })
    const first = store.load()
    expect(snapshot(store).status).toBe('loading')
    remote.list.mockResolvedValueOnce({ ok: true, value: [flow({ signedIn: true })] })
    const second = store.load()
    await Promise.all([first, second])
    expect(snapshot(store)).toMatchObject({ status: 'ready', flows: [{ signedIn: true }], error: null })
    remote.list.mockResolvedValueOnce(unavailable('offline'))
    await store.load()
    expect(snapshot(store)).toMatchObject({ status: 'ready', flows: [{ signedIn: true }], error: 'offline' })
  })

  it('follows notices and prompts, answers once, and relists when the attempt settles', async () => {
    const { remote, store, latest } = scripted()
    store.start(KEY)
    store.start(KEY)
    expect(remote.begin).toHaveBeenCalledTimes(1)
    expect(remote.begin.mock.calls[0]![0]).toEqual({ key: KEY })
    expect(snapshot(store).attempts[KEY]).toEqual({ status: 'running', notices: [] })
    latest().push({ type: 'notice', notice: { message: 'Open the page', url: 'https://auth.example/device', code: 'AB-12' } })
    latest().push({ type: 'prompt', id: PROMPT, prompt: { kind: 'text', message: 'Code?' } })
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toMatchObject({ prompt: { id: PROMPT } }) })
    await Promise.all([store.answer(KEY, 'one'), store.answer(KEY, 'two')])
    expect(remote.answer).toHaveBeenCalledTimes(1)
    expect(remote.answer).toHaveBeenCalledWith(KEY, PROMPT, 'one')
    expect(snapshot(store).attempts[KEY]).toEqual({
      status: 'running', notices: [{ message: 'Open the page', url: 'https://auth.example/device', code: 'AB-12' }],
    })
    latest().push({ type: 'settled', status: 'authorized' })
    latest().finish()
    await waitFor(() => { expect(remote.list).toHaveBeenCalledTimes(1) })
    expect(snapshot(store).attempts).toEqual({})
  })

  it('drops a withdrawn prompt and ignores a withdrawal of another one', async () => {
    const { store, latest } = scripted()
    store.start(KEY)
    latest().push({ type: 'prompt', id: PROMPT, prompt: { kind: 'secret', message: 'Paste' } })
    latest().push({ type: 'prompt-withdrawn', id: 'other' as AuthorizationPromptId })
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toMatchObject({ prompt: { id: PROMPT } }) })
    latest().push({ type: 'prompt-withdrawn', id: PROMPT })
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toEqual({ status: 'running', notices: [] }) })
  })

  it('records the refusal of an answer or a decline', async () => {
    const { remote, store, latest } = scripted()
    remote.answer.mockResolvedValueOnce(refused)
    remote.decline.mockResolvedValueOnce(refused)
    store.start(KEY)
    latest().push({ type: 'prompt', id: PROMPT, prompt: { kind: 'text', message: 'Code?' } })
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toHaveProperty('prompt') })
    await store.answer(KEY, 'x')
    expect(snapshot(store).error).toBe('no such prompt')
    latest().push({ type: 'prompt', id: PROMPT, prompt: { kind: 'text', message: 'Code?' } })
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toHaveProperty('prompt') })
    await store.decline(KEY)
    expect(remote.decline).toHaveBeenCalledWith(KEY, PROMPT)
    expect(snapshot(store).error).toBe('no such prompt')
    latest().push({ type: 'prompt', id: PROMPT, prompt: { kind: 'text', message: 'Code?' } })
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toHaveProperty('prompt') })
    await store.decline(KEY)
    expect(remote.decline).toHaveBeenCalledTimes(2)
  })

  it('sends nothing without an open prompt', async () => {
    const { remote, store } = scripted()
    await store.decline(KEY)
    await store.answer(KEY, 'x')
    store.start(KEY)
    await store.decline(KEY)
    await store.answer(KEY, 'x')
    expect(remote.decline).not.toHaveBeenCalled()
    expect(remote.answer).not.toHaveBeenCalled()
  })

  it('reports a failed attempt with its message and starts clean on retry', async () => {
    const { remote, store, latest } = scripted()
    store.start(KEY)
    latest().finish(new RemoteError('authorization/failed', 'Login timed out', { key: KEY }))
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toEqual({ status: 'failed', message: 'Login timed out' }) })
    await waitFor(() => { expect(remote.list).toHaveBeenCalledTimes(1) })
    store.start(KEY)
    expect(snapshot(store).attempts[KEY]).toEqual({ status: 'running', notices: [] })
    latest().finish('carrier lost')
    await waitFor(() => { expect(snapshot(store).attempts[KEY]).toEqual({ status: 'failed', message: 'carrier lost' }) })
  })

  it('cancels its own attempt by closing the stream; the withdrawn stream writes nothing more', async () => {
    const { remote, store, attempts } = scripted()
    store.start(KEY)
    attempts[0]!.push({ type: 'notice', notice: { message: 'late' } })
    await store.cancel(KEY)
    expect(snapshot(store).attempts).toEqual({})
    store.start(KEY)
    expect(attempts).toHaveLength(2)
    attempts[0]!.finish(new Error('late'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(snapshot(store).attempts[KEY]).toEqual({ status: 'running', notices: [] })
    expect(remote.cancel).not.toHaveBeenCalled()
    expect(remote.list).not.toHaveBeenCalled()
  })

  it('cancels another window\'s attempt through the Host and relists', async () => {
    const { remote, store } = scripted()
    await store.cancel(KEY)
    expect(remote.cancel).toHaveBeenCalledWith(KEY)
    expect(remote.list).toHaveBeenCalledTimes(1)
    remote.cancel.mockResolvedValueOnce(refused)
    remote.list.mockResolvedValueOnce(unavailable('still refused'))
    await store.cancel(KEY)
    expect(snapshot(store).error).toBe('still refused')
    remote.cancel.mockResolvedValueOnce(refused)
    await store.cancel(KEY)
    expect(snapshot(store).error).toBeNull()
  })

  it('signs out and relists, or records the refusal', async () => {
    const { remote, store } = scripted()
    await store.signOut(KEY)
    expect(remote.signOut).toHaveBeenCalledWith(KEY)
    expect(remote.list).toHaveBeenCalledTimes(1)
    remote.signOut.mockResolvedValueOnce(refused)
    await store.signOut(KEY)
    expect(snapshot(store).error).toBe('no such prompt')
    expect(remote.list).toHaveBeenCalledTimes(1)
  })

  it('withdraws every attempt and ignores lists in flight on dispose', async () => {
    const { remote, store, latest } = scripted()
    store.start(KEY)
    const load = store.load()
    store.dispose()
    await load
    latest().finish(new Error('closed'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(snapshot(store)).toMatchObject({ status: 'loading', flows: [] })
    expect(snapshot(store).attempts[KEY]).toEqual({ status: 'running', notices: [] })
    expect(remote.list).toHaveBeenCalledTimes(1)
  })
})

describe('SignInArea', () => {
  it('lists flows once mounted and renders only the matching card', async () => {
    const { remote, store } = scripted()
    const useSignIn = bindSnapshotSelector(store.store)
    const { container } = render(<>
      <SignInArea store={store} useSignIn={useSignIn} settingsNs="llm-pi-ai" provider="openai-codex" t={t} />
      <SignInArea store={store} useSignIn={useSignIn} settingsNs="llm-pi-ai" provider="openai" t={t} />
    </>)
    expect(await screen.findByText('ChatGPT · Not signed in')).toBeTruthy()
    expect(remote.list).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('section')).toHaveLength(1)
  })

  it('renders the live store through a sign-in', async () => {
    const { store, latest, remote } = scripted()
    const useSignIn = bindSnapshotSelector(store.store)
    render(<SignInArea store={store} useSignIn={useSignIn} settingsNs="llm-pi-ai" provider="openai-codex" t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
    act(() => { latest().push({ type: 'notice', notice: { message: 'Enter the code', code: 'ZZ-99' } }) })
    expect(await screen.findByText('ZZ-99')).toBeTruthy()
    remote.list.mockResolvedValueOnce({ ok: true, value: [flow({ signedIn: true })] })
    act(() => {
      latest().push({ type: 'settled', status: 'authorized' })
      latest().finish()
    })
    expect(await screen.findByText('ChatGPT · Signed in')).toBeTruthy()
  })
})

describe('SignInPanel', () => {
  function panel(props: Partial<SignInPanelProps> = {}) {
    const { store } = scripted()
    const actions = {
      start: vi.spyOn(store, 'start').mockImplementation(() => {}),
      cancel: vi.spyOn(store, 'cancel').mockResolvedValue(),
      signOut: vi.spyOn(store, 'signOut').mockResolvedValue(),
      answer: vi.spyOn(store, 'answer').mockResolvedValue(),
      decline: vi.spyOn(store, 'decline').mockResolvedValue(),
    }
    const base: SignInPanelProps = { flow: flow(), attempt: undefined, error: null, store, t, ...props }
    const view = render(<SignInPanel {...base} />)
    const rerender = (next: Partial<SignInPanelProps>): void => { view.rerender(<SignInPanel {...base} {...next} />) }
    return { rerender, ...actions }
  }

  it('offers sign-in when signed out and sign-out when signed in', () => {
    const { start, signOut, rerender } = panel()
    expect(screen.getByRole('region', { name: 'Sign in to ChatGPT' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(start).toHaveBeenCalledWith(KEY)
    rerender({ flow: flow({ signedIn: true }) })
    expect(screen.getByText('ChatGPT · Signed in')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    expect(signOut).toHaveBeenCalledWith(KEY)
  })

  it('shows a failure with a retry and a refused call', () => {
    panel({ attempt: { status: 'failed', message: 'Login timed out' }, error: 'offline' })
    expect(screen.getByRole('button', { name: en.signInRetry })).toBeTruthy()
    expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual([
      `${en.signInFailed}: Login timed out`, 'offline',
    ])
  })

  it('lets another window\'s attempt be cancelled', () => {
    const { cancel } = panel({ flow: flow({ inFlight: true }) })
    expect(screen.getByText(en.signInElsewhere)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signInCancel }))
    expect(cancel).toHaveBeenCalledWith(KEY)
  })

  it('shows the starting state, then the page link and code', () => {
    const { cancel, rerender } = panel({ attempt: { status: 'running', notices: [] } })
    expect(screen.getByText(en.signInStarting)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signInCancel }))
    expect(cancel).toHaveBeenCalledWith(KEY)
    rerender({
      attempt: {
        status: 'running',
        notices: [{ message: 'Open the page', url: 'https://auth.example/device', code: 'AB-12' }, { message: 'Waiting' }],
      },
    })
    expect(screen.queryByText(en.signInStarting)).toBeNull()
    const link = screen.getByRole('link', { name: 'https://auth.example/device' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('AB-12').tagName).toBe('CODE')
    expect(screen.getByText('Waiting')).toBeTruthy()
  })

  it('puts the preferred option first as the recommended choice', () => {
    const { answer, rerender } = panel({
      attempt: {
        status: 'running',
        notices: [],
        prompt: {
          id: PROMPT,
          prompt: {
            kind: 'select',
            message: 'How?',
            preferred: 'device_code',
            options: [
              { id: 'browser', label: 'Browser login' },
              { id: 'device_code', label: 'Device code login', description: 'Works anywhere' },
            ],
          },
        },
      },
    })
    expect(screen.queryByText(en.signInStarting)).toBeNull()
    const choices = screen.getByRole('group', { name: 'How?' }).querySelectorAll('button')
    expect([...choices].map(button => button.textContent)).toEqual([
      `Device code login (${en.signInRecommended})`, 'Browser login',
    ])
    expect(choices[0]!.getAttribute('title')).toBe('Works anywhere')
    fireEvent.click(choices[1]!)
    expect(answer).toHaveBeenCalledWith(KEY, 'browser')
    rerender({
      attempt: {
        status: 'running',
        notices: [],
        prompt: { id: PROMPT, prompt: { kind: 'select', message: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } },
      },
    })
    expect([...screen.getByRole('group', { name: 'Which?' }).querySelectorAll('button')].map(button => button.textContent))
      .toEqual(['A', 'B'])
  })

  it('submits or declines a typed answer, masking a secret', () => {
    const { answer, decline, rerender } = panel({
      attempt: { status: 'running', notices: [], prompt: { id: PROMPT, prompt: { kind: 'text', message: 'Paste the URL', placeholder: 'https://' } } },
    })
    const input = screen.getByLabelText('Paste the URL')
    expect(input.getAttribute('type')).toBe('text')
    expect(input.getAttribute('placeholder')).toBe('https://')
    fireEvent.change(input, { target: { value: 'https://cb' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))
    expect(answer).toHaveBeenCalledWith(KEY, 'https://cb')
    fireEvent.click(screen.getByRole('button', { name: en.signInDecline }))
    expect(decline).toHaveBeenCalledWith(KEY)
    rerender({ attempt: { status: 'running', notices: [], prompt: { id: PROMPT, prompt: { kind: 'secret', message: 'Token' } } } })
    expect(screen.getByLabelText('Token').getAttribute('type')).toBe('password')
  })
})

describe('CodexSignInSection', () => {
  it('renders nothing until the slot runtime injects the store', () => {
    const { container } = render(<CodexSignInSection />)
    expect(container.childNodes.length).toBe(0)
  })

  it('renders the Codex flow and the page introduction', async () => {
    const { store } = scripted()
    const useSignIn = bindSnapshotSelector(store.store)
    render(<CodexSignInSection store={store} useSignIn={useSignIn} t={t} />)
    expect(screen.getByText(en.intro)).toBeTruthy()
    expect(await screen.findByText('ChatGPT · Not signed in')).toBeTruthy()
  })
})
