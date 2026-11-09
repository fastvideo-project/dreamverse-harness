// @vitest-environment jsdom
/** The Feedback row above Settings under the real slot runtime: its dialog, what it sends, and its removal on dispose. */
import { act, cleanup, fireEvent, waitFor, type RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { FeedbackSubmission } from '@dv/feedback/types'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { apply, inject } from '../src/client/index.ts'

const DESCRIPTION = 'Please describe your issue, suggestion, or question'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
  window.location.hash = ''
  document.documentElement.lang = ''
})

/** Mount the plugin under a sidebar foot that draws `sidebar.footer.action` at the given width. */
async function mount(wide: boolean) {
  const runtime = await SlotTestRuntime.create()
  await runtime.root.declare({ 'sidebar.footer.action': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('sidebar.footer.action', { wide })}</>)
  const plugin = await runtime.mount({ inject: [...inject], apply })
  return { runtime, plugin, view: runtime.renderRoot() }
}

/** Replace `fetch` with the feedback route answering `reply`, and record each request body. */
function route(reply: () => Response) {
  const bodies: FeedbackSubmission[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/dv/feedback')
    bodies.push(JSON.parse(init?.body as string) as FeedbackSubmission)
    return Promise.resolve(reply())
  })
  return bodies
}

/**
 * Attach files through the hidden file input, as 上传本地文件 / Upload local files does. As in a browser, the input's
 * file list is live: resetting the input's value empties it.
 */
function attach(view: RenderResult, ...files: File[]): void {
  const input = view.baseElement.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('the dialog has no file input')
  const live = [...files]
  Object.defineProperty(input, 'files', { configurable: true, get: () => live })
  Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: () => { live.length = 0 } })
  fireEvent.change(input)
}

/** Answer every required question in English. */
function fillRequired(view: RenderResult, description: string): void {
  fireEvent.click(view.getByRole('checkbox', { name: 'Speed and stability' }))
  fireEvent.change(view.getByRole('textbox', { name: DESCRIPTION }), { target: { value: description } })
  attach(view, new File(['hello'], 'narrator.png', { type: 'image/png' }))
}

describe('ui-feedback', () => {
  it('enables Send only once an area, a description and a file are given, and sends them with where the browser is', async () => {
    document.documentElement.lang = 'en'
    publishCurrentProject('p1')
    window.location.hash = '#project=p1&view=timeline&session=s1'
    const bodies = route(() => Response.json({ ok: true }))
    const { runtime, plugin, view } = await mount(true)
    expect(runtime.slots.entries('sidebar.footer.action').map(entry => entry.options)).toEqual([{ id: 'dv-feedback', order: 0 }])

    fireEvent.click(view.getByRole('button', { name: 'Feedback' }))
    expect(view.getByText('DreamVerse User Feedback')).toBeTruthy()
    const logs = view.getByRole('link', { name: 'conversation logs' })
    expect(logs.getAttribute('href')).toBe('api/session.export?sessionId=s1&includeDescendants=true')
    expect(logs.getAttribute('download')).toBe('dsh-session-s1.zip')
    const send = view.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(view.getByRole('radio', { name: 'Report a problem' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(view.getByRole('radio', { name: 'Suggest a feature' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Safety and privacy' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Response and task quality' }))
    expect(view.getByRole('checkbox', { name: 'Safety and privacy' }).getAttribute('aria-checked')).toBe('true')
    expect(view.getByRole('checkbox', { name: 'Files and generated content' }).getAttribute('aria-checked')).toBe('false')
    expect(send.disabled).toBe(true)
    fireEvent.change(view.getByRole('textbox', { name: DESCRIPTION }), { target: { value: 'Add an audio track to the timeline.' } })
    expect(send.disabled).toBe(true)
    attach(view, new File(['hello'], 'narrator.png', { type: 'image/png' }), new File(['x'], 'dsh.log', { type: '' }))
    expect(view.getByText('narrator.png')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Remove dsh.log' }))
    expect(view.queryByText('dsh.log')).toBeNull()
    fireEvent.change(view.getByRole('textbox', { name: 'Email address (Optional)' }), { target: { value: ' kyle@example.com ' } })
    expect(send.disabled).toBe(false)
    await act(async () => { fireEvent.click(send) })

    await waitFor(() => { expect(view.getByText('Thanks, your feedback was sent.')).toBeTruthy() })
    expect(bodies[0]?.screen).toMatch(/^\d+x\d+$/)
    expect(bodies).toEqual([{
      kind: 'feature', areas: ['quality', 'safety'], description: 'Add an audio track to the timeline.',
      attachments: [{ name: 'narrator.png', type: 'image/png', data: 'aGVsbG8=' }], email: 'kyle@example.com',
      project: 'p1', session: 's1', view: 'timeline', locale: 'en',
      screen: bodies[0]?.screen, user_agent: navigator.userAgent,
      version: process.env.DSH_CLIENT_VERSION ?? null, commit: process.env.DSH_CLIENT_COMMIT_HASH ?? null,
    }])
    expect(view.queryByRole('textbox', { name: DESCRIPTION })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Feedback' }))
    expect((view.getByRole('textbox', { name: DESCRIPTION }) as HTMLTextAreaElement).value).toBe('')
    expect(view.queryByText('narrator.png')).toBeNull()
    expect(view.getByRole('radio', { name: 'Report a problem' }).getAttribute('aria-checked')).toBe('true')

    await plugin.dispose()
    expect(runtime.slots.entries('sidebar.footer.action')).toEqual([])
    await runtime.dispose()
  })

  it('adds a pasted file, and leaves pasted text to the field', async () => {
    document.documentElement.lang = 'en'
    const { runtime, view } = await mount(true)
    fireEvent.click(view.getByRole('button', { name: 'Feedback' }))
    const field = view.getByRole('textbox', { name: DESCRIPTION })
    fireEvent.paste(field, { clipboardData: { files: [], getData: () => 'text' } })
    expect(view.queryByRole('listitem')).toBeNull()
    fireEvent.paste(field, { clipboardData: { files: [new File(['png'], 'pasted.png', { type: 'image/png' })] } })
    expect(view.getByRole('listitem').textContent).toContain('pasted.png')
    await runtime.dispose()
  })

  it('keeps the dialog and the draft open with the host\'s reason when the send fails', async () => {
    document.documentElement.lang = 'en'
    route(() => Response.json({ error: 'the feedback endpoint answered HTTP 500 without {"ok": true}' }, { status: 502 }))
    const { runtime, view } = await mount(true)
    fireEvent.click(view.getByRole('button', { name: 'Feedback' }))
    fillRequired(view, 'Export is silent.')
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Send' })) })

    const alert = await view.findByRole('alert')
    expect(alert.textContent).toBe('Feedback was not sent: the feedback endpoint answered HTTP 500 without {"ok": true}')
    expect((view.getByRole('textbox', { name: DESCRIPTION }) as HTMLTextAreaElement).value).toBe('Export is silent.')
    expect(view.getByText('narrator.png')).toBeTruthy()
    expect(view.queryByText('Thanks, your feedback was sent.')).toBeNull()
    await runtime.dispose()
  })

  it('sends null for the email, project, view and session when they are absent, and shows no log link without a session', async () => {
    document.documentElement.lang = 'en'
    const bodies = route(() => Response.json({ ok: true }))
    const { runtime, view } = await mount(true)
    fireEvent.click(view.getByRole('button', { name: 'Feedback' }))
    expect(view.queryByRole('link', { name: 'conversation logs' })).toBeNull()
    expect(view.getByText(/You can attach screenshots or/).textContent).toContain('conversation logs')
    fillRequired(view, 'Hello.')
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Send' })) })
    await waitFor(() => { expect(bodies).toHaveLength(1) })
    expect(bodies[0]).toMatchObject({ kind: 'problem', areas: ['stability'], email: null, project: null, view: null, session: null })
    await runtime.dispose()
  })

  it('shows only the icon on the rail, and the form\'s Chinese copy', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, view } = await mount(false)
    const button = view.getByRole('button', { name: '反馈' })
    expect(button.textContent).toBe('')
    fireEvent.click(button)
    expect(view.getByText('DreamVerse 用户反馈')).toBeTruthy()
    expect(view.getByRole('radio', { name: '遇到问题' })).toBeTruthy()
    expect(view.getByRole('checkbox', { name: '其他 / 不确定' })).toBeTruthy()
    expect(view.getByRole('textbox', { name: '联系邮箱（选填）' })).toBeTruthy()
    await runtime.dispose()
  })
})
