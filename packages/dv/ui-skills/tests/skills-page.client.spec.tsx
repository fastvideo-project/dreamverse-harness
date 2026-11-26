// @vitest-environment jsdom
/** The Skills page over a scripted list: the cards, 使用, the empty note, and a failed read with 重试. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsPage } from '../src/client/SkillsPage.tsx'

afterEach(() => { cleanup(); document.documentElement.lang = '' })

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
})

describe('My Skills', () => {
  it('uploads into the persistent library, refreshes it and supports search and use', async () => {
    const saved = { name: 'my-trailer', description: 'My trailer procedure', modelInvocable: true }
    const listMine = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([saved])
    const upload = vi.fn().mockResolvedValue(saved)
    const use = vi.fn()
    render(<SkillsPage list={() => Promise.resolve(SKILLS)} listMine={listMine} upload={upload} use={use} />)
    expect(await screen.findByText('Upload your first skill to start your library.')).toBeTruthy()
    const file = new File(['instructions'], 'SKILL.md', { type: 'text/markdown' })
    fireEvent.change(screen.getByLabelText('Upload skill file'), { target: { files: [file] } })
    expect(await screen.findByText('/my-trailer')).toBeTruthy()
    expect(upload).toHaveBeenCalledWith(file)
    expect(screen.getByRole('status').textContent).toBe('Saved /my-trailer')
    await expect((document.querySelector('[data-dv-skills]')?.outerHTML ?? '') + '\n').toMatchFileSnapshot('./expected/my-skills.html')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
    expect(screen.getByText('No matching skills')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'procedure' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use my-trailer' }))
    expect(use).toHaveBeenCalledWith('my-trailer')
    fireEvent.click(screen.getByRole('button', { name: 'Available skills' }))
    expect(await screen.findByText('/storyboard')).toBeTruthy()
    expect(screen.queryByLabelText('Upload skill file')).toBeNull()
  })

  it('follows the page language for the file button and placeholder, and displays the chosen filename', async () => {
    render(<SkillsPage list={() => Promise.resolve([])} listMine={() => Promise.resolve([])}
      upload={vi.fn().mockResolvedValue({ name: 'example', description: 'Example', modelInvocable: true })} use={vi.fn()} />)
    const input = screen.getByLabelText<HTMLInputElement>('Upload skill file')
    expect(input.hidden).toBe(true)
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }))
    expect(click).toHaveBeenCalledOnce()
    expect(screen.getByText('No file selected')).toBeTruthy()
    document.documentElement.lang = 'zh-CN'
    expect(await screen.findByRole('button', { name: '选择文件' })).toBeTruthy()
    expect(screen.getByText('未选择任何文件')).toBeTruthy()
    fireEvent.change(input, { target: { files: [new File(['instructions'], 'example.zip')] } })
    expect(await screen.findByText('example.zip')).toBeTruthy()
    document.documentElement.lang = 'en'
    expect(await screen.findByRole('button', { name: 'Choose file' })).toBeTruthy()
    expect(screen.getByText('example.zip')).toBeTruthy()
  })

  it('keeps saved skills visible after an upload fails and permits retry', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('A saved skill already uses this name'))
    render(<SkillsPage list={() => Promise.resolve([])} listMine={() => Promise.resolve(SKILLS)} upload={upload} use={vi.fn()} />)
    await screen.findByText('/storyboard')
    const input = screen.getByLabelText('Upload skill file')
    fireEvent.change(input, { target: { files: [new File(['duplicate'], 'skill.md')] } })
    expect((await screen.findByRole('alert')).textContent).toContain('already uses this name')
    expect(screen.getByText('/storyboard')).toBeTruthy()
    expect((input as HTMLInputElement).disabled).toBe(false)
  })
})
