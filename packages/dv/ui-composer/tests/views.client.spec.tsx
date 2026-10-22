// @vitest-environment jsdom
/**
 * The composer's chat row of an agent tool call: its running, failed, and done status, and the 在历史中查看 link of a
 * settled call that wrote a record.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { ToolLabelRow } from '../src/client/views.tsx'

beforeEach(() => { document.documentElement.lang = 'zh-CN' })
afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
})

describe('ToolLabelRow', () => {
  it('shows a running, a failed, and a done tool row, and the 在历史中查看 link only for a settled call that wrote a record', () => {
    const label: readonly [string, string] = ['生成镜头', 'Render shot']
    const row = { label, toolName: 'dv_shot_render', sessionId: 's1', callId: 'call-1' }
    const running = render(<ToolLabelRow {...row} phase="start" block={{ meta: { record: 'r1' } }} />).container
    expect(running.textContent).toContain('进行中…')
    expect(running.querySelector('[data-failed]')).toBeNull()
    expect(within(running).queryByRole('button', { name: '在历史中查看' })).toBeNull()
    const failed = render(<ToolLabelRow {...row} phase="result" block={{ isError: true }} />).container
    expect(failed.textContent).toContain('未完成')
    expect(failed.querySelector('[data-tool] > span:nth-of-type(2)')?.getAttribute('data-failed')).toBe('')
    expect(within(failed).queryByRole('button', { name: '在历史中查看' })).toBeNull()
    const done = render(<ToolLabelRow {...row} phase="result" block={{ meta: { record: 'r1' } }} />).container
    expect(done.querySelector('[data-tool] > span:nth-of-type(2)')?.textContent).toBe('完成')
    expect(done.querySelector('[data-failed]')).toBeNull()
    expect(within(done).getAllByRole('button', { name: '在历史中查看' })).toHaveLength(1)
  })
})
