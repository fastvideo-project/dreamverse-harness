// @vitest-environment jsdom
/** Plugin-owned cards invoke standard skills; labels and previews do not require shell-specific state. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { Templates, type TemplatesInjected } from '../src/client/Templates.tsx'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => { cleanup(); document.documentElement.lang = '' })

it('offers all nine previews and prefills a skill through the injected use action', async () => {
  const use = vi.fn()
  render(<Templates use={use} />)
  const section = screen.getByRole('region', { name: 'MiniMax video templates' })
  expect(screen.getAllByRole('button')).toHaveLength(9)
  expect([...section.querySelectorAll('img')].every(image => image.getAttribute('src')?.startsWith('/api/minimax/previews/') === true)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'H3 prompt writing' }))
  expect(use).toHaveBeenCalledWith('h3-prompt-writing')
  await expect(section.outerHTML + '\n').toMatchFileSnapshot('./expected/templates.html')
  document.documentElement.lang = 'zh-CN'
  expect(await screen.findByRole('button', { name: 'H3 提示词编写' })).toBeTruthy()
})

it('registers and removes its own template entry, writing only the current conversation draft', async () => {
  const ctx = new Context()
  const input = { setDraft: vi.fn(), focus: vi.fn() }
  const entries: Array<{ id: string; inject: () => TemplatesInjected }> = []
  ctx.provide('slots', {
    inject: (_slot: string, register: () => () => void) => register(),
    register: (options: { id: string; inject: () => TemplatesInjected }) => {
      entries.push(options)
      return () => { entries.splice(entries.indexOf(options), 1) }
    },
  } as never)
  ctx.provide('sessions', { scope: () => ({ get: () => ({ input: { for: () => input } }) }) } as never)
  ctx.provide('sidebarRight', { mounted: { getSnapshot: () => 'current-chat' } } as never)
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  expect(entries.map(entry => entry.id)).toEqual(['minimax-templates', 'minimax-skills'])
  entries[0]?.inject().use('h3-prompt-writing')
  expect(input.setDraft).toHaveBeenCalledWith('/h3-prompt-writing ')
  expect(input.focus).toHaveBeenCalledOnce()
  await fiber.dispose()
  expect(entries).toEqual([])
  await ctx.fiber.dispose()
})
