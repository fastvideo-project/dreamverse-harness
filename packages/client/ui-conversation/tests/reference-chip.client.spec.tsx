// @vitest-environment jsdom
/**
 * ReferenceChip visual face: icon selection per appearance, the trigger
 * marker fallback, the thumbnail and its load-failure fallback, the hover
 * preview and its dismissal, label truncation container, and invalid styling.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ReferenceChip } from '../src/client/input/editor/ReferenceChip.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ReferenceChip', () => {
  it('renders the domain icon and the label', () => {
    const { container, getByTitle } = render(
      <ReferenceChip label="Research notes" appearance="session" invalid={false} />,
    )
    expect(getByTitle('Research notes')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toBe('Research notes')
  })

  it('falls back to the trigger marker without an appearance', () => {
    const { container } = render(<ReferenceChip label="commit-helper" invalid={false} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('@commit-helper')
  })

  it('shows the thumbnail in place of the marker, and the marker once the media fails to load', () => {
    const { container } = render(<ReferenceChip label="car.png" thumbnail={{ url: 'blob:car', video: false }} invalid={false} />)
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('blob:car')
    expect(container.textContent).toBe('car.png')
    if (image === null) throw new Error('no thumbnail')
    fireEvent.error(image)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('@car.png')
  })

  it('shows a video thumbnail as a video element', () => {
    const { container } = render(<ReferenceChip label="run.mp4" thumbnail={{ url: '/dv/assets/v1', video: true }} invalid={false} />)
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/dv/assets/v1')
  })

  it('shows the enlarged media after the pointer rests on the chip, and drops it when the pointer moves away', () => {
    vi.useFakeTimers()
    const { container } = render(<ReferenceChip label="car.png" thumbnail={{ url: 'blob:car', video: false }} invalid={false} />)
    const chip = container.firstElementChild
    if (chip === null) throw new Error('no chip')
    fireEvent.pointerEnter(chip)
    act(() => { vi.advanceTimersByTime(300) })
    const preview = document.body.querySelector('[role="tooltip"]')
    expect(preview?.querySelector('img')?.getAttribute('src')).toBe('blob:car')
    expect(preview?.textContent).toBe('car.png')
    fireEvent.pointerMove(document.body)
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('plays a video in the preview and keeps the thumbnail video still', () => {
    vi.useFakeTimers()
    const { container } = render(<ReferenceChip label="run.mp4" thumbnail={{ url: '/dv/assets/v1', video: true }} invalid={false} />)
    const chip = container.firstElementChild
    if (chip === null) throw new Error('no chip')
    fireEvent.pointerEnter(chip)
    act(() => { vi.advanceTimersByTime(300) })
    const preview = document.body.querySelector('[role="tooltip"] video')
    expect([preview?.hasAttribute('autoplay'), preview?.hasAttribute('loop')]).toEqual([true, true])
    expect(container.querySelector('video')?.hasAttribute('autoplay')).toBe(false)
  })

  it('drops an open preview when the chip leaves the page under a resting pointer', () => {
    vi.useFakeTimers()
    const { container, unmount } = render(<ReferenceChip label="car.png" thumbnail={{ url: 'blob:car', video: false }} invalid={false} />)
    const chip = container.firstElementChild
    if (chip === null) throw new Error('no chip')
    fireEvent.pointerEnter(chip)
    act(() => { vi.advanceTimersByTime(300) })
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull()
    unmount()
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('applies the invalid styling bit', () => {
    const { container } = render(<ReferenceChip label="gone" appearance="folder" invalid />)
    const chip = container.firstElementChild
    expect(chip).not.toBeNull()
    expect([...(chip?.classList ?? [])].some(name => name.includes('invalid'))).toBe(true)
  })
})
