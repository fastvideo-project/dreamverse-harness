// @vitest-environment jsdom
/** The Skills page over scripted lists: its two sections, the cards, 使用, the empty notes, and a failed read with 重试. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

  it('shows the empty note when no built-in skill is available, and no Your skills section without a library', async () => {
    render(<SkillsPage list={() => Promise.resolve([])} use={vi.fn()} />)
    expect(await screen.findByText(/还没有可用的内置技能|No built-in skills are available yet/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: /我的技能|Your skills/ })).toBeNull()
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

describe('Your skills', () => {
  it('uploads into the persistent library, refreshes it and supports search and use', async () => {
    const saved = { name: 'my-trailer', description: 'My trailer procedure', modelInvocable: true }
    const listMine = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([saved])
    const upload = vi.fn().mockResolvedValue(saved)
    const use = vi.fn()
    render(<SkillsPage list={() => Promise.resolve(SKILLS)} listMine={listMine} upload={upload} use={use} />)
    expect(await screen.findByText('Create or upload your first skill to start your library.')).toBeTruthy()
    const file = new File(['instructions'], 'SKILL.md', { type: 'text/markdown' })
    fireEvent.change(screen.getByLabelText('Upload skill file'), { target: { files: [file] } })
    expect(await screen.findByText('/my-trailer')).toBeTruthy()
    expect(upload).toHaveBeenCalledWith(file)
    expect(screen.getByRole('status').textContent).toBe('Saved /my-trailer')
    await expect((document.querySelector('[data-dv-skills]')?.outerHTML ?? '') + '\n').toMatchFileSnapshot('./expected/my-skills.html')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
    expect(screen.getAllByText('No matching skills')).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'procedure' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use my-trailer' }))
    expect(use).toHaveBeenCalledWith('my-trailer')
  })

  it('shows Your skills and Built-in skills together, and a saved skill only once, under Your skills', async () => {
    document.documentElement.lang = 'en'
    const saved = { name: 'trailer', description: 'My trailer', modelInvocable: true }
    render(<SkillsPage list={() => Promise.resolve(SKILLS)} listMine={() => Promise.resolve([saved])} upload={vi.fn()} use={vi.fn()} />)
    const mine = within(await screen.findByRole('region', { name: 'Your skills' }))
    const builtIn = within(screen.getByRole('region', { name: 'Built-in skills' }))
    expect(await mine.findByText('/trailer')).toBeTruthy()
    expect(await builtIn.findByText('/storyboard')).toBeTruthy()
    expect(builtIn.queryByText('/trailer')).toBeNull()
    expect(mine.getByLabelText('Upload skill file', { selector: 'input' })).toBeTruthy()
  })

  it('keeps Your skills when the built-in list fails, and reads the built-in list again on Retry', async () => {
    document.documentElement.lang = 'en'
    const list = vi.fn().mockRejectedValueOnce(new Error('session/not-found: gone')).mockResolvedValueOnce(SKILLS)
    render(<SkillsPage list={list} listMine={() => Promise.resolve([{ name: 'mine', description: 'Mine', modelInvocable: true }])} use={vi.fn()} />)
    const builtIn = within(await screen.findByRole('region', { name: 'Built-in skills' }))
    expect((await builtIn.findByRole('alert')).textContent).toContain('session/not-found: gone')
    expect(within(screen.getByRole('region', { name: 'Your skills' })).getByText('/mine')).toBeTruthy()
    fireEvent.click(builtIn.getByRole('button', { name: 'Retry' }))
    expect(await builtIn.findByText('/storyboard')).toBeTruthy()
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

describe('the skill editor', () => {
  const SAVED = { name: 'opening-shot', description: 'Plan an opening shot', modelInvocable: true }

  it('writes a new skill from New skill with its name, description and instructions, then lists it', async () => {
    document.documentElement.lang = 'en'
    const listMine = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([SAVED])
    const create = vi.fn().mockResolvedValue(SAVED)
    render(<SkillsPage list={() => Promise.resolve([])}
      listMine={listMine} create={create} read={vi.fn()} update={vi.fn()} use={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    const dialog = within(screen.getByRole('dialog', { name: 'New skill' }))
    const save = dialog.getByRole('button', { name: 'Save' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(dialog.getByPlaceholderText('my-video-skill'), { target: { value: 'opening-shot' } })
    fireEvent.change(dialog.getByPlaceholderText('When to use this skill'), { target: { value: 'Plan an opening shot' } })
    fireEvent.change(dialog.getByPlaceholderText('The steps the agent should follow'), { target: { value: 'Ask for the mood.' } })
    fireEvent.click(save)
    expect(create).toHaveBeenCalledWith({ name: 'opening-shot', description: 'Plan an opening shot', instructions: 'Ask for the mood.' })
    expect(await within(screen.getByRole('region', { name: 'Your skills' })).findByText('/opening-shot')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a saved skill in the same dialog with its fields and a fixed name, and saves the edit', async () => {
    document.documentElement.lang = 'en'
    const read = vi.fn().mockResolvedValue({ name: 'opening-shot', description: 'Plan an opening shot', instructions: 'Ask for the mood.',
      path: '/home/a/.dsh/dreamverse-skills/opening-shot/SKILL.md' })
    const update = vi.fn().mockResolvedValue({ ...SAVED, description: 'Plan a calm opening' })
    const use = vi.fn()
    render(<SkillsPage list={() => Promise.resolve([])}
      listMine={() => Promise.resolve([SAVED])} create={vi.fn()} read={read} update={update} use={use} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit opening-shot' }))
    const dialog = within(screen.getByRole('dialog', { name: 'opening-shot' }))
    const name = dialog.getByPlaceholderText<HTMLInputElement>('my-video-skill')
    await vi.waitFor(() => { expect(dialog.getByPlaceholderText<HTMLTextAreaElement>('The steps the agent should follow').value).toBe('Ask for the mood.') })
    expect([name.value, name.disabled]).toEqual(['opening-shot', true])
    expect(dialog.getByText('/home/a/.dsh/dreamverse-skills/opening-shot/SKILL.md')).toBeTruthy()
    fireEvent.change(dialog.getByPlaceholderText('When to use this skill'), { target: { value: 'Plan a calm opening' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    expect(update).toHaveBeenCalledWith({ name: 'opening-shot', description: 'Plan a calm opening', instructions: 'Ask for the mood.' })
    await vi.waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'Use opening-shot' }))
    expect(use).toHaveBeenCalledWith('opening-shot')
  })

  it('shows a refused save in the dialog and keeps the fields', async () => {
    document.documentElement.lang = 'en'
    const create = vi.fn().mockRejectedValue(new Error('A saved skill already uses this name'))
    render(<SkillsPage list={() => Promise.resolve([])}
      listMine={() => Promise.resolve([])} create={create} read={vi.fn()} update={vi.fn()} use={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    const dialog = within(screen.getByRole('dialog', { name: 'New skill' }))
    fireEvent.change(dialog.getByPlaceholderText('my-video-skill'), { target: { value: 'taken' } })
    fireEvent.change(dialog.getByPlaceholderText('When to use this skill'), { target: { value: 'Taken' } })
    fireEvent.change(dialog.getByPlaceholderText('The steps the agent should follow'), { target: { value: 'Steps.' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    expect((await dialog.findByRole('alert')).textContent).toBe('A saved skill already uses this name')
    expect(dialog.getByPlaceholderText<HTMLInputElement>('my-video-skill').value).toBe('taken')
  })

  it('deletes a saved skill only after the confirmation, and keeps it when the confirmation is cancelled', async () => {
    document.documentElement.lang = 'en'
    const read = vi.fn().mockResolvedValue({ name: 'opening-shot', description: 'Plan an opening shot', instructions: 'Ask.',
      path: '/library/opening-shot/SKILL.md' })
    const remove = vi.fn().mockResolvedValue(undefined)
    const listMine = vi.fn().mockResolvedValueOnce([SAVED]).mockResolvedValue([])
    render(<SkillsPage list={() => Promise.resolve([])}
      listMine={listMine} create={vi.fn()} read={read} update={vi.fn()} remove={remove} use={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit opening-shot' }))
    const panel = within(screen.getByRole('dialog', { name: 'opening-shot' }))
    await panel.findByText('/library/opening-shot/SKILL.md')
    const buttons = panel.getAllByRole('button').map(button => button.textContent)
    expect(buttons.slice(-3)).toEqual(['Cancel', 'Delete', 'Save'])
    fireEvent.click(panel.getByRole('button', { name: 'Delete' }))
    const confirm = within(screen.getByRole('dialog', { name: 'Delete opening-shot?' }))
    expect(confirm.getByText('Removes library/opening-shot and every file in it.')).toBeTruthy()
    fireEvent.click(confirm.getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Delete opening-shot?' })).toBeNull()
    fireEvent.click(panel.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete opening-shot?' })).getByRole('button', { name: 'Delete' }))
    expect(remove).toHaveBeenCalledWith('opening-shot')
    await vi.waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(await screen.findByText('Create or upload your first skill to start your library.')).toBeTruthy()
  })

  it('offers no Delete for a new skill', async () => {
    document.documentElement.lang = 'en'
    render(<SkillsPage list={() => Promise.resolve([])}
      listMine={() => Promise.resolve([])} create={vi.fn()} read={vi.fn()} update={vi.fn()} remove={vi.fn()} use={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    expect(within(screen.getByRole('dialog', { name: 'New skill' })).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('shows no saved location when the server sends no path', async () => {
    document.documentElement.lang = 'en'
    const read = vi.fn().mockResolvedValue({ name: 'opening-shot', description: 'Plan an opening shot', instructions: 'Ask.' })
    render(<SkillsPage list={() => Promise.resolve([])}
      listMine={() => Promise.resolve([SAVED])} create={vi.fn()} read={read} update={vi.fn()} remove={vi.fn()} use={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit opening-shot' }))
    const panel = within(screen.getByRole('dialog', { name: 'opening-shot' }))
    await vi.waitFor(() => { expect(panel.getByPlaceholderText<HTMLTextAreaElement>('The steps the agent should follow').value).toBe('Ask.') })
    expect(panel.queryByText('Saved at')).toBeNull()
    expect(panel.queryByText(/undefined/u)).toBeNull()
  })

  it('opens a built-in skill read-only, with its file or the plugin note, and no Save or Delete', async () => {
    document.documentElement.lang = 'en'
    const readBuiltIn = vi.fn((name: string) => Promise.resolve(name === 'storyboard'
      ? { name: 'storyboard', description: 'Storyboard', instructions: 'Write the beats.', path: '/bundle/skills/storyboard/SKILL.md' }
      : { name: 'trailer', description: 'Trailer', instructions: 'Cut a trailer.', path: '' }))
    render(<SkillsPage list={() => Promise.resolve(SKILLS)} readBuiltIn={readBuiltIn} use={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'View storyboard' }))
    const panel = within(screen.getByRole('dialog', { name: 'storyboard' }))
    const instructions = panel.getByPlaceholderText<HTMLTextAreaElement>('The steps the agent should follow')
    await vi.waitFor(() => { expect(instructions.value).toBe('Write the beats.') })
    expect(instructions.readOnly).toBe(true)
    expect(panel.getByPlaceholderText<HTMLInputElement>('When to use this skill').readOnly).toBe(true)
    expect(panel.getByText('/bundle/skills/storyboard/SKILL.md')).toBeTruthy()
    expect(panel.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(panel.queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(panel.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement)
    await vi.waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'View trailer' }))
    const plugin = within(screen.getByRole('dialog', { name: 'trailer' }))
    expect(await plugin.findByText('Provided by a plugin at run time, with no file on disk.')).toBeTruthy()
  })

  it('shows the list description at once, before the read of the skill settles', async () => {
    document.documentElement.lang = 'en'
    type Text = { name: string; description: string; instructions: string; path: string }
    let settle: (value: Text) => void = () => {}
    const read = vi.fn((_name: string) => new Promise<Text>((resolve) => { settle = resolve }))
    render(<SkillsPage list={() => Promise.resolve([])}
      listMine={() => Promise.resolve([SAVED])} create={vi.fn()} read={read} update={vi.fn()} remove={vi.fn()} use={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit opening-shot' }))
    const panel = within(screen.getByRole('dialog', { name: 'opening-shot' }))
    expect(panel.getByPlaceholderText<HTMLInputElement>('When to use this skill').value).toBe('Plan an opening shot')
    expect(panel.queryByText('Loading skill…')).toBeNull()
    settle({ name: 'opening-shot', description: 'Plan an opening shot', instructions: 'Ask for the mood.', path: '/l/opening-shot/SKILL.md' })
    await vi.waitFor(() => { expect(panel.getByPlaceholderText<HTMLTextAreaElement>('The steps the agent should follow').value).toBe('Ask for the mood.') })
    expect(read).toHaveBeenCalledTimes(1)
  })
})
