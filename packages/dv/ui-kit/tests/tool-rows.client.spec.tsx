// @vitest-environment jsdom
/**
 * The shared parts of agent tool rows: the arguments of a call while they stream, whether a settled call wrote a
 * record, the assets of a settled call, and the 在历史中查看 link that asks the History panel for the record.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { argsOf, HistoryLink, outputsOf, wroteRecord } from '../src/client/tool-rows.tsx'
import { DV_HISTORY_FOCUS_EVENT } from '../src/client/workspace-events.ts'
import type { DvWorkspaceEventMap } from '../src/client/workspace-events.ts'

afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
})

describe('argsOf', () => {
  it('reads the arguments object of a call, and no arguments while the JSON streams or is not an object', () => {
    expect(argsOf('{"prompt":"hero walks","seed":7}')).toEqual({ prompt: 'hero walks', seed: 7 })
    expect(argsOf('{"prompt":"hero wa')).toEqual({})
    expect(argsOf('42')).toEqual({})
    expect(argsOf('null')).toEqual({})
  })
})

describe('wroteRecord', () => {
  it('finds a written record only in result metadata that names a non-empty record ID', () => {
    expect(wroteRecord({ meta: { record: 'g1' } })).toBe(true)
    expect(wroteRecord({ meta: { record: '' } })).toBe(false)
    expect(wroteRecord({ meta: { record: 7 } })).toBe(false)
    expect(wroteRecord({ meta: {} })).toBe(false)
    expect(wroteRecord({ meta: null })).toBe(false)
    expect(wroteRecord({ meta: 'g1' })).toBe(false)
    expect(wroteRecord({})).toBe(false)
  })
})

describe('outputsOf', () => {
  it('lists the role, asset ID, URL and MIME type of each output that names an asset ID', () => {
    const block = { meta: { outputs: [{ role: 'video', asset_id: 'shot 1.mp4', mime: 'video/mp4' }, { role: 'last_still', mime: 'image/png' }] } }
    expect(outputsOf(block)).toEqual([{ role: 'video', id: 'shot 1.mp4', url: '/dv/assets/shot%201.mp4', mime: 'video/mp4' }])
  })

  it('lists no assets for a call without an outputs array in its result metadata', () => {
    expect([outputsOf({}), outputsOf({ meta: null }), outputsOf({ meta: 'g1' }), outputsOf({ meta: {} }), outputsOf({ meta: { outputs: 'shot1.mp4' } })])
      .toEqual([[], [], [], [], []])
  })
})

describe('HistoryLink', () => {
  it('asks the History panel for the record of its tool call, labelled in the interface language', () => {
    document.documentElement.lang = 'zh-CN'
    const focused: Array<DvWorkspaceEventMap['dv:history-focus']> = []
    const listener = (event: Event): void => { focused.push((event as CustomEvent<DvWorkspaceEventMap['dv:history-focus']>).detail) }
    window.addEventListener(DV_HISTORY_FOCUS_EVENT, listener)
    const { getByRole } = render(<HistoryLink sessionId="s5" callId="call-1" className="link" />)
    const link = getByRole('button', { name: '在历史中查看' })
    expect(link.className).toBe('link')
    fireEvent.click(link)
    window.removeEventListener(DV_HISTORY_FOCUS_EVENT, listener)
    expect(focused).toEqual([{ session: 's5', toolCall: 'call-1' }])
  })
})
