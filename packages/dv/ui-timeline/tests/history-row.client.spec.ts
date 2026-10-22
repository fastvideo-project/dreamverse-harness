/** The History row of timeline records: the timeline of each clip, the focus of a selected record, and its registration. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createRegistry, type DvHistory, type HistoryRow } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord } from '@dv/ui-kit/types.ts'
import { record } from '../../ui-kit/tests/fixture.client.tsx'
import { clipTimelines, timelineHistoryRow } from '../src/client/history-row.ts'
import { apply } from '../src/client/index.ts'

const records = [
  record({ id: 'c', operation: 'timeline.create', params: { assets: ['a.mp4', 'b.mp4'] }, report: { clips: ['cl1', 'cl2'] } }),
  record({ id: 'c2', operation: 'timeline.create', params: { timeline: 't2', assets: ['z.mp4'] }, report: { clips: ['cl3'] } }),
  record({ id: 's', operation: 'timeline.clip_split', params: { clip: 'cl2', at_sec: 1 }, report: { clips: ['cl4'] } }),
  record({ id: 'm', operation: 'timeline.clip_move', params: { clip: 'cl4', to: 1 } }),
  record({ id: 'm2', operation: 'timeline.clip_move', params: { clip: 'cl3', to: 1 } }),
  record({ id: 'e', operation: 'timeline.export', params: { timeline: 't1' }, outputs: ['out.mp4'] }),
]

/** @returns the focus of the timeline row for one of {@link records}. */
const focusOf = (at: number) => timelineHistoryRow.focus?.(records[at] as ProjectRecord, records)

describe('timelineHistoryRow', () => {
  it('assigns each clip to the timeline of the record that added it, a split to the split clip\'s timeline', () => {
    expect(Object.fromEntries(clipTimelines(records))).toEqual({ cl1: 't1', cl2: 't1', cl3: 't2', cl4: 't1' })
  })

  it('leaves unassigned the clips of a record whose timeline is unknown: a split of an unknown clip, an insert without a timeline', () => {
    const orphans = [
      record({ id: 's1', operation: 'timeline.clip_split', params: { clip: 'gone', at_sec: 1 }, report: { clips: ['cl5'] } }),
      record({ id: 's2', operation: 'timeline.clip_split', params: { at_sec: 1 }, report: { clips: ['cl6'] } }),
      record({ id: 'i', operation: 'timeline.clip_insert', params: { asset: 'y.mp4' }, report: { clips: ['cl7'] } }),
    ]
    expect(Object.fromEntries(clipTimelines([...records, ...orphans]))).toEqual({ cl1: 't1', cl2: 't1', cl3: 't2', cl4: 't1' })
  })

  it('matches every timeline operation, adds no subject, and focuses the record\'s timeline and clip', () => {
    expect([timelineHistoryRow.match, timelineHistoryRow.subject(records[0] as ProjectRecord)]).toEqual(['timeline.', null])
    expect(focusOf(3)).toEqual({ event: 'dv:timeline-focus', detail: { timelineId: 't1', clipId: 'cl4' } })
    expect(focusOf(4)).toEqual({ event: 'dv:timeline-focus', detail: { timelineId: 't2', clipId: 'cl3' } })
    expect(focusOf(0)).toEqual({ event: 'dv:timeline-focus', detail: { timelineId: 't1', clipId: 'cl1' } })
    expect(focusOf(5)).toEqual({ event: 'dv:timeline-focus', detail: { timelineId: 't1', clipId: null } })
    const lost = record({ id: 'x', operation: 'timeline.clip_move', params: { clip: 'gone', to: 1 } })
    expect(timelineHistoryRow.focus?.(lost, records)).toBeNull()
    const unnamed = record({ id: 'y', operation: 'timeline.export', params: {} })
    expect(timelineHistoryRow.focus?.(unnamed, records)).toBeNull()
  })

  it('registers once dvHistory is present, and the plugin disposal removes it', async () => {
    const ctx = new Context()
    const history: DvHistory = { rows: createRegistry<HistoryRow>(row => [row.match]) }
    ctx.provide('locale', { bind: vi.fn(() => (key: string) => key), register: vi.fn(() => () => undefined) } as never)
    ctx.provide('slots', { inject: vi.fn(() => () => undefined) } as never)
    ctx.provide('sidebarRightTabs', { register: vi.fn(() => () => undefined) } as never)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(history.rows.list()).toEqual([])
    ctx.provide('dvHistory', history)
    await vi.waitFor(() => { expect(history.rows.list()).toEqual([timelineHistoryRow]) })
    await fiber.dispose()
    expect(history.rows.list()).toEqual([])
  })
})
