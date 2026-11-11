// @vitest-environment jsdom
/** The failure notice of the shell's actions, rendered by a component that runs the actions a test gives. */
import { act, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useActionNotice, type ActionRunner } from '../src/client/notice.tsx'

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.lang = ''
})

/** An action whose settlement the test drives. */
function held(): { work: () => Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { work: () => promise, resolve, reject }
}

describe('the action notice', () => {
  it('shows only the outcome of the latest action, whatever an earlier action that settles after it answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.documentElement.lang = 'en'
    let run: ActionRunner = () => {}
    function Bench(): ReactNode {
      const notice = useActionNotice()
      run = notice.run
      return <div>{notice.notice}</div>
    }
    const view = render(<Bench />)
    const first = held()
    const second = held()
    act(() => { run(first.work) })
    act(() => { run(second.work) })
    await act(async () => { second.resolve() })
    await act(async () => { first.reject(new Error('openProject failed')) })
    expect(view.queryByRole('alert')).toBeNull()
    const third = held()
    act(() => { run(third.work) })
    await act(async () => { third.reject(new Error('goHome failed')) })
    expect(view.getByRole('alert').textContent).toBe("Couldn't complete that: goHome failed×")
    const fourth = held()
    const fifth = held()
    act(() => { run(fourth.work) })
    act(() => { run(fifth.work) })
    await act(async () => { fifth.reject(new Error('openSession failed')) })
    await act(async () => { fourth.resolve() })
    expect(view.getByRole('alert').textContent).toBe("Couldn't complete that: openSession failed×")
    fireEvent.click(view.getByRole('button', { name: 'Dismiss' }))
    expect(view.queryByRole('alert')).toBeNull()
    view.unmount()
  })
})
