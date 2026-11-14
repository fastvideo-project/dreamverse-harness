// @vitest-environment jsdom
/** Project workflow selection, modal cancellation and creation failures. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { MiniMaxChoice, NewProjectDialog } from '../src/client/MiniMaxChoice.tsx'
import { getShell, setShell } from '../src/client/store.ts'

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
})
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
afterEach(() => {
  cleanup()
  setShell({ minimaxSkill: null, createProjectOpen: false })
  document.documentElement.lang = ''
})

describe('project MiniMax choice', () => {
  it('defaults off, offers eight video styles and prompt writing, and supports Chinese labels', async () => {
    document.documentElement.lang = 'zh-CN'
    render(<MiniMaxChoice />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: '视频类型' })
    expect(select.value).toBe('')
    expect(screen.getAllByRole('option')).toHaveLength(10)
    await expect(select.outerHTML + '\n').toMatchFileSnapshot('./expected/minimax-choice.html')
    fireEvent.change(select, { target: { value: '3d-animation-short-generator' } })
    expect(getShell().minimaxSkill).toBe('3d-animation-short-generator')
    fireEvent.change(select, { target: { value: '' } })
    expect(getShell().minimaxSkill).toBeNull()
  })

  it('creates with the selected skill and cancels without creating', async () => {
    const create = vi.fn<(...args: [string | null | undefined]) => Promise<void>>().mockResolvedValue()
    setShell({ createProjectOpen: true })
    render(<NewProjectDialog shell={{ newProject: create }} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'handdrawn-live-video-generator' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => { expect(create).toHaveBeenCalledWith('handdrawn-live-video-generator') })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(getShell().createProjectOpen).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps the choice and shows a creation failure for retry', async () => {
    const create = vi.fn<(...args: [string | null | undefined]) => Promise<void>>().mockRejectedValue(new Error('Server unavailable'))
    setShell({ createProjectOpen: true, minimaxSkill: 'h3-prompt-writing' })
    render(<NewProjectDialog shell={{ newProject: create }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Server unavailable')
    expect(getShell().minimaxSkill).toBe('h3-prompt-writing')
    act(() => { fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })) })
    expect(getShell().createProjectOpen).toBe(false)
  })
})
