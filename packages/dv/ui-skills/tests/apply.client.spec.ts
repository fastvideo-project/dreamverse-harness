// @vitest-environment jsdom
/**
 * The plugin's page, navigator entry, and composer shortcut, the skill list read through the chat session, 使用, and
 * removal on dispose.
 */
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DV_COMPOSE_EVENT, type DvComposeDetail } from '@dv/ui-kit/compose.ts'
import type { SkillsInjected } from '../src/client/SkillsPage.tsx'
import { SkillsLauncher, SkillsPage, SkillsPanelIcon } from '../src/client/SkillsPage.tsx'
import { apply, inject, SKILLS_PANEL_ID } from '../src/client/index.ts'
import { SessionInputShell } from '../../../client/ui-conversation/src/client/input/facade.ts'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { apply as hostApply } from '../src/index.ts'

interface Recorded {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
  inject?: (sessionId?: string) => SkillsInjected
  component: unknown
}

const SKILL = { name: 'storyboard', description: 'Storyboard', modelInvocable: true }

const SESSIONS: Record<string, { id: string; updatedAt: number }> = { s0: { id: 's0', updatedAt: 1 }, s2: { id: 's2', updatedAt: 2 } }

/**
 * Boot the client plugin over a recording `ctx.slots` registry, a scripted `skills` Remote, a recording layout, and a
 * recording session input. The session `closed` has no scope.
 * @param mounted - the session the right panel's seat shows.
 * @param byId - the listed sessions.
 * @param failure - the error the `skills` Remote answers, or undefined for the skill list.
 * @returns the registered entries, the Remote calls, the selected panels, the input calls, and the plugin fiber.
 */
async function boot(
  mounted: string | undefined, byId = SESSIONS, failure?: { code: string; message: string },
  resident?: Pick<SessionInputShell, 'setDraft' | 'focus'>,
) {
  const ctx = new Context()
  const registered: Recorded[] = []
  const calls: unknown[] = []
  const selected: unknown[] = []
  const inputs: string[] = []
  const input = resident ?? { setDraft: (draft: string) => { inputs.push(`draft ${draft}`) }, focus: () => { inputs.push('focus') } }
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const skills = {
    list: vi.fn((request: unknown) => {
      calls.push(request)
      return Promise.resolve(failure === undefined ? { ok: true, value: { skills: [SKILL] } } : { ok: false, error: failure })
    }),
  }
  ctx.provide('slots', slots as never)
  ctx.provide('remote', { skills } as never)
  ctx.provide('remote.skills', skills as never)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ byId }) },
    scope: (sessionId: string) => (sessionId === 'closed' ? undefined : {
      get: (name: string) => (name === 'conversation' ? { input: { for: () => { inputs.push(`session ${sessionId}`); return input } } } : undefined),
    }),
  } as never)
  ctx.provide('sidebarRight', { mounted: { getSnapshot: () => mounted } } as never)
  // Like LayoutController, each selection or new navigation aborts the previous navigation signal.
  let navigation = new AbortController()
  const layout = {
    selectPanel: (id: unknown) => { navigation.abort(); selected.push(id) },
    beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
  }
  ctx.provide('layout', layout as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { registered, calls, selected, inputs, layout, fiber }
}

describe('ui-skills apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the page under the skills panel, the navigator entry after Plugins, and the composer shortcut', async () => {
    const { registered } = await boot('s1')
    expect(registered.map(entry => [entry.name, entry.key ?? entry.id, entry.component])).toEqual([
      ['main', SKILLS_PANEL_ID, SkillsPage],
      ['sidebar.panellist', SKILLS_PANEL_ID, SkillsPanelIcon],
      ['conversation.input.left', 'dv.skills.library', SkillsLauncher],
    ])
    expect(registered[1]?.order).toBe(2)
    expect(registered[1]?.label?.()).toMatch(/^(技能|Skills)$/)
  })

  it('lists the skills of the chat session, else of the newest session', async () => {
    const first = await boot('s1')
    await expect(first.registered[0]?.inject?.().list()).resolves.toEqual([SKILL])
    expect(first.calls).toEqual([{ sessionId: 's1' }])
    const second = await boot(undefined)
    await second.registered[0]?.inject?.().list()
    expect(second.calls).toEqual([{ sessionId: 's2' }])
  })

  it('lists no skill before any session exists, and rejects with the code and message of a failed read', async () => {
    const empty = await boot(undefined, {})
    await expect(empty.registered[0]?.inject?.().list()).resolves.toEqual([])
    expect(empty.calls).toEqual([])
    const failing = await boot('s1', SESSIONS, { code: 'NOT_FOUND', message: 'no preset' })
    await expect(failing.registered[0]?.inject?.().list()).rejects.toThrow('NOT_FOUND: no preset')
  })

  it('writes the current session draft before closing without broadcasting to another editor', async () => {
    const { registered, selected, inputs } = await boot('s1')
    const composed: DvComposeDetail[] = []
    const listen = (event: Event): void => { composed.push((event as CustomEvent<DvComposeDetail>).detail) }
    window.addEventListener(DV_COMPOSE_EVENT, listen)
    registered[0]?.inject?.().use('storyboard')
    window.removeEventListener(DV_COMPOSE_EVENT, listen)
    expect(selected).toEqual([null])
    expect(composed).toEqual([])
    expect(inputs).toEqual(['session s1', 'draft /storyboard ', 'focus'])
  })

  it.each([undefined, 'other-session'])('returns the selected skill to the launching composer when the right seat is %s', async (seat) => {
    const { registered, selected, inputs, fiber } = await boot(seat)
    const launcher = registered[2]?.inject?.('prompt-session') as unknown as { open: () => void }
    const view = render(createElement(SkillsLauncher, launcher))
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    view.unmount()
    registered[0]?.inject?.().use('my-trailer')
    expect(selected).toEqual([SKILLS_PANEL_ID, null])
    expect(inputs).toEqual(['session prompt-session', 'draft /my-trailer ', 'focus'])
    // A later visit through the sidebar must not reuse the previous launching session.
    inputs.length = 0
    if (seat !== undefined) {
      registered[0]?.inject?.().use('storyboard')
      expect(inputs).toEqual([`session ${seat}`, 'draft /storyboard ', 'focus'])
    }
    await fiber.dispose()
  })

  it('targets the right seat after a launcher-opened page is left and the page is reopened from the navigator', async () => {
    const { registered, inputs, layout, fiber } = await boot('other-session')
    const launcher = registered[2]?.inject?.('prompt-session') as unknown as { open: () => void }
    const view = render(createElement(SkillsLauncher, launcher))
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    view.unmount()
    layout.selectPanel(SKILLS_PANEL_ID)
    registered[0]?.inject?.().use('my-trailer')
    expect(inputs).toEqual(['session other-session', 'draft /my-trailer ', 'focus'])
    await fiber.dispose()
  })

  it('keeps the uploaded skill invocation visible when the conversation editor mounts after closing Skills', async () => {
    const actx = new Context()
    const input = new SessionInputShell({ actx, defaultSink: vi.fn(), commandAttachments: {
      serialize: async () => [], release: () => {}, unsupportedNotice: () => '',
    } })
    const editor = document.createElement('div')
    document.body.append(editor)
    try {
      const { registered, fiber } = await boot(undefined, SESSIONS, undefined, input)
      const launcher = registered[2]?.inject?.('prompt-session') as unknown as { open: () => void }
      const shortcut = render(createElement(SkillsLauncher, launcher))
      fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
      shortcut.unmount()
      const use = registered[0]?.inject?.().use
      if (use === undefined) throw new Error('Missing skill action')
      const uploaded = { name: 'my-trailer', description: 'My trailer', modelInvocable: true }
      const view = render(createElement(SkillsPage, { list: () => Promise.resolve([]), listMine: () => Promise.resolve([uploaded]), use }))
      fireEvent.click(await screen.findByRole('button', { name: 'Use my-trailer' }))
      view.unmount()
      input.editor.setRootElement(editor)
      await waitFor(() => { expect(editor.textContent).toBe('/my-trailer ') })
      expect(input.state.getSnapshot().draft).toBe('/my-trailer ')
      await fiber.dispose()
    } finally {
      input.editor.setRootElement(null)
      input.dispose()
      editor.remove()
      await actx.fiber.dispose()
    }
  })

  it('uses the existing compose event when no session input is ready yet', async () => {
    const { registered, selected, fiber } = await boot(undefined, {})
    const composed: DvComposeDetail[] = []
    const listen = (event: Event): void => { composed.push((event as CustomEvent<DvComposeDetail>).detail) }
    window.addEventListener(DV_COMPOSE_EVENT, listen)
    try { registered[0]?.inject?.().use('storyboard') }
    finally { window.removeEventListener(DV_COMPOSE_EVENT, listen) }
    expect(selected).toEqual([null])
    expect(composed).toEqual([{ text: '/storyboard', refs: [] }])
    await fiber.dispose()
  })

  it('removes the page, the entry, and the shortcut when the plugin is disposed', async () => {
    const { registered, fiber } = await boot('s1')
    await fiber.dispose()
    expect(registered).toEqual([])
  })
})
