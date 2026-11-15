// @vitest-environment jsdom
/**
 * The plugin's page, navigator entry, and 探索 tab, the skill list read through the chat session, 使用, and removal on
 * dispose.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DV_COMPOSE_EVENT, type DvComposeDetail } from '@dv/ui-kit/compose.ts'
import type { SkillsInjected } from '../src/client/SkillsPage.tsx'
import { SkillsLauncher, SkillsPage, SkillsPanelIcon, SkillsShelf } from '../src/client/SkillsPage.tsx'
import { apply, inject, SKILLS_PANEL_ID } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

interface Recorded {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
  inject?: () => SkillsInjected
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
async function boot(mounted: string | undefined, byId = SESSIONS, failure?: { code: string; message: string }) {
  const ctx = new Context()
  const registered: Recorded[] = []
  const calls: unknown[] = []
  const selected: unknown[] = []
  const inputs: string[] = []
  const input = { setDraft: (draft: string) => { inputs.push(`draft ${draft}`) }, focus: () => { inputs.push('focus') } }
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
  ctx.provide('layout', { selectPanel: (id: unknown) => { selected.push(id) } } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { registered, calls, selected, inputs, fiber }
}

describe('ui-skills apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the page under the skills panel, the navigator entry after Plugins, and the 探索 tab after MCP', async () => {
    const { registered } = await boot('s1')
    expect(registered.map(entry => [entry.name, entry.key ?? entry.id, entry.component])).toEqual([
      ['main', SKILLS_PANEL_ID, SkillsPage],
      ['sidebar.panellist', SKILLS_PANEL_ID, SkillsPanelIcon],
      ['conversation.input.left', 'dv.skills.library', SkillsLauncher],
      ['dv.explore', 'skills', SkillsShelf],
    ])
    expect(registered[1]?.order).toBe(2)
    expect(registered[1]?.label?.()).toMatch(/^(技能|Skills)$/)
    expect(registered[3]?.order).toBe(1)
    expect(registered[3]?.label?.()).toMatch(/^(技能|Skills)$/)
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

  it('closes the page and prefills /name on 使用', async () => {
    const { registered, selected } = await boot('s1')
    const composed: DvComposeDetail[] = []
    const listen = (event: Event): void => { composed.push((event as CustomEvent<DvComposeDetail>).detail) }
    window.addEventListener(DV_COMPOSE_EVENT, listen)
    registered[0]?.inject?.().use('storyboard')
    window.removeEventListener(DV_COMPOSE_EVENT, listen)
    expect(selected).toEqual([null])
    expect(composed).toEqual([{ text: '/storyboard', refs: [] }])
  })

  it('writes /name into the entry page session on 使用 in the 探索 tab, without dv:compose', async () => {
    const { registered, selected, inputs } = await boot('s1')
    const composed: DvComposeDetail[] = []
    const listen = (event: Event): void => { composed.push((event as CustomEvent<DvComposeDetail>).detail) }
    window.addEventListener(DV_COMPOSE_EVENT, listen)
    registered[3]?.inject?.().use('storyboard')
    window.removeEventListener(DV_COMPOSE_EVENT, listen)
    expect(inputs).toEqual(['session s1', 'draft /storyboard ', 'focus'])
    expect(selected).toEqual([])
    expect(composed).toEqual([])
  })

  it('writes no draft on 使用 in the 探索 tab while the right panel shows no session or a session without a scope', async () => {
    for (const mounted of [undefined, 'closed']) {
      const { registered, inputs } = await boot(mounted)
      registered[3]?.inject?.().use('storyboard')
      expect(inputs).toEqual([])
    }
  })

  it('removes the page, the entry, and the tab when the plugin is disposed', async () => {
    const { registered, fiber } = await boot('s1')
    await fiber.dispose()
    expect(registered).toEqual([])
  })
})
