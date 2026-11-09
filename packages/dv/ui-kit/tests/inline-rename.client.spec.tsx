// @vitest-environment jsdom
/** The inline title field: saving, cancelling, a refused title, and the events it keeps from the elements around it. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { InlineRename } from '../src/client/InlineRename.tsx'
import type { InlineRenameProps } from '../src/client/InlineRename.tsx'

afterEach(() => { cleanup() })

function mount(overrides: Partial<InlineRenameProps> = {}) {
  const props = { value: 'Shot', onSave: vi.fn(), onClose: vi.fn(), label: 'Node name', ...overrides }
  const outer = { pointer: vi.fn(), key: vi.fn(), click: vi.fn() }
  const view = render(
    <div onPointerDown={outer.pointer} onKeyDown={outer.key} onClick={outer.click}><InlineRename {...props} /></div>,
  )
  return { props, outer, view, input: view.getByLabelText('Node name') as HTMLInputElement }
}

describe('InlineRename', () => {
  it('selects the title, saves a changed trimmed title on Enter once, and shows the hint', () => {
    const { props, input, view } = mount({ hint: 'Enter to save · Esc to cancel' })
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4])
    expect(view.getByText('Enter to save · Esc to cancel')).toBeTruthy()
    fireEvent.change(input, { target: { value: '  Harbor at dawn ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith('Harbor at dawn')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('saves an emptied title on blur, and closes without saving an unchanged title', () => {
    const emptied = mount()
    fireEvent.change(emptied.input, { target: { value: ' ' } })
    fireEvent.blur(emptied.input)
    expect(emptied.props.onSave).toHaveBeenCalledWith('')
    cleanup()
    const unchanged = mount()
    fireEvent.keyDown(unchanged.input, { key: 'Enter' })
    expect(unchanged.props.onSave).not.toHaveBeenCalled()
    expect(unchanged.props.onClose).toHaveBeenCalledOnce()
  })

  it('cancels on Escape and keeps the key, the press and the click from the elements around it', () => {
    const { props, outer, input } = mount()
    fireEvent.change(input, { target: { value: 'Other' } })
    fireEvent.pointerDown(input)
    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'F2' })
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalledOnce()
    expect([outer.pointer, outer.key, outer.click].map(handler => handler.mock.calls.length)).toEqual([0, 0, 0])
  })

  it('keeps the field open with a danger border and the message for a refused title, until the title changes', () => {
    const check = (title: string): string | null => title.length > 5 ? 'Too long.' : null
    const { props, input, view } = mount({ check, hint: 'hint' })
    fireEvent.change(input, { target: { value: 'Harbor at dawn' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(view.getByRole('alert').textContent).toBe('Too long.')
    expect(view.queryByText('hint')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.style.borderColor).toBe('var(--dv-danger)')
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Dawn' } })
    expect(view.queryByRole('alert')).toBeNull()
    fireEvent.blur(input)
    expect(props.onSave).toHaveBeenCalledWith('Dawn')
  })

  it('closes on an unchanged title that the check would refuse', () => {
    const { props, input, view } = mount({ value: 'Harbor at dawn', check: () => 'Too long.' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(view.queryByRole('alert')).toBeNull()
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
