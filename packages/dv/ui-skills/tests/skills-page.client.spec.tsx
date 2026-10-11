// @vitest-environment jsdom
/** The Skills page and the 探索 tab over a scripted list: the cards, 使用, the empty note, and a failed read with 重试. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsPage, SkillsShelf } from '../src/client/SkillsPage.tsx'

afterEach(() => { cleanup() })

const SKILLS: SkillEntry[] = [
  { name: 'trailer', description: 'Trailer', modelInvocable: true },
  { name: 'storyboard', description: 'Storyboard', modelInvocable: true },
]

describe('SkillsPage', () => {
  it('shows one card per skill in name order, and 使用 passes the skill name', async () => {
    const use = vi.fn()
    render(<SkillsPage list={() => Promise.resolve(SKILLS)} use={use} />)
    const commands = await screen.findAllByText(/^\/[a-z-]+$/)
    expect(commands.map(node => node.textContent)).toEqual(['/storyboard', '/trailer'])
    fireEvent.click(screen.getByRole('button', { name: /trailer/ }))
    expect(use).toHaveBeenCalledWith('trailer')
  })

  it('shows the empty note when no skill is available', async () => {
    render(<SkillsPage list={() => Promise.resolve([])} use={vi.fn()} />)
    expect(await screen.findByText(/还没有可用的技能|No skills are available yet/)).toBeTruthy()
  })

  it('shows a failed read and reads again on 重试', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('session/not-found: gone'))
      .mockResolvedValueOnce(SKILLS)
    render(<SkillsPage list={list} use={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('session/not-found: gone')
    fireEvent.click(screen.getByRole('button', { name: /重试|Retry/ }))
    expect(await screen.findByText('/storyboard')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows the same cards in the 探索 tab, and 使用 passes the skill name', async () => {
    const use = vi.fn()
    render(<SkillsShelf list={() => Promise.resolve(SKILLS)} use={use} />)
    const commands = await screen.findAllByText(/^\/[a-z-]+$/)
    expect(commands.map(node => node.textContent)).toEqual(['/storyboard', '/trailer'])
    fireEvent.click(screen.getByRole('button', { name: /storyboard/ }))
    expect(use).toHaveBeenCalledWith('storyboard')
  })
})
