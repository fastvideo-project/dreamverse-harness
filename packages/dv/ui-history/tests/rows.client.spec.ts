/**
 * The History panel's pure readings: action rows and the folds of started records, labels with subjects, thumbnails,
 * relative times, and the focus a selected step gives the center through its registered row or its canvas node.
 */
import { describe, expect, it } from 'vitest'
import type { HistoryRow } from '../src/client/contract/index.ts'
import type { HistoryEntry, ProjectRecord, WireOperation } from '@dv/ui-kit/types.ts'
import { asset, fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import {
  actionLabel, actionRows, centerFocus, relativeTime, thumbnailOf, type LabelContext,
} from '../src/client/rows.ts'

/** An entry of a record, at or before the current position unless `place` says otherwise. */
const entry = (fields: Partial<ProjectRecord> & { id: string }, place: HistoryEntry['place'] = 'before'): HistoryEntry => ({ record: record(fields), place })

/**
 * An operation on the wire with the label that its host package declares.
 * @param name - the operation name.
 * @param zh - the Chinese label.
 * @param en - the English label.
 * @returns the declaration.
 */
const declared = (name: string, zh: string, en: string): WireOperation => ({
  name, version: '1', description: name, label: { zh, en }, inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'never',
})

/** The labelled operations that the label tests name. */
const DECLARED: WireOperation[] = [
  declared('plan.create', '新建分镜计划', 'Create plan'), declared('plan.update', '修改分镜计划', 'Update plan'),
  declared('timeline.create', '新建时间线', 'Create timeline'), declared('timeline.update', '修改时间线', 'Update timeline'),
  declared('character.create', '新建角色', 'Create character'), declared('shot.render', '渲染镜头', 'Render shot'),
]

/**
 * What a label reads, with the operations of {@link DECLARED} on the wire unless given.
 * @param changes - the fields that differ from those operations, no registered rows and no records.
 * @returns the label context.
 */
const labels = (changes: Partial<LabelContext> = {}): LabelContext => ({ operations: DECLARED, rows: [], records: new Map(), ...changes })

describe('actionRows', () => {
  it('folds the loaded records a record started under its row, in log order', () => {
    const rows = actionRows([
      entry({ id: 'tl', actor: 'system', operation: 'timeline.update', started_by: { record: 'ap', slot: null } }),
      entry({ id: 'g2', actor: 'system', operation: 'shot.render', started_by: { record: 'ap', slot: 2 } }),
      entry({ id: 'g1', actor: 'system', operation: 'shot.render', started_by: { record: 'ap', slot: 1 } }),
      entry({ id: 'ap', turn: 't2', operation: 'story.approve', report: { plan: 'p1', version: 2 } }),
      entry({ id: 'h1', operation: 'timeline.clip_move' }),
    ])
    expect(rows.map(row => [row.entry.record.id, row.children.map(child => child.record.id)])).toEqual([
      ['ap', ['g1', 'g2', 'tl']], ['h1', []],
    ])
  })

  it('keeps started records as rows of their own while their starter is not loaded', () => {
    const render = entry({ id: 'g1', actor: 'system', operation: 'shot.render', started_by: { record: 'ap', slot: 1 } })
    expect(actionRows([render]).map(row => row.entry.record.id)).toEqual(['g1'])
  })
})

describe('labels, thumbnails and times', () => {
  it('names no subject of plan, timeline and character actions without a registered row', () => {
    // The UI halves of the shot plan, the timeline and the character noun register the rows that name these subjects.
    expect(actionLabel(record({ id: 'a', operation: 'plan.create', params: { title: '猫' }, report: { plan: 'p1', version: 1 } }), labels()))
      .toEqual(['新建分镜计划', 'Create plan'])
    expect(actionLabel(record({ id: 'c', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } }), labels()))
      .toEqual(['修改分镜计划', 'Update plan'])
    // A workflow's registered row names the subject of its approval; a plan.approve record of an old log has no subject, and
    // no operation on the wire labels it.
    expect(actionLabel(record({ id: 'd', operation: 'plan.approve', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } }), labels()))
      .toEqual(['plan.approve', 'plan.approve'])
    expect(actionLabel(record({ id: 'tc', operation: 'timeline.create', params: { timeline: 't2' } }), labels())).toEqual(['新建时间线', 'Create timeline'])
    expect(actionLabel(record({ id: 'tu', operation: 'timeline.update', params: { timeline: 't2' } }), labels())).toEqual(['修改时间线', 'Update timeline'])
    expect(actionLabel(record({ id: 'g', component: 'character', operation: 'character.create', params: { character: 'c1', name: '阿明' } }), labels()))
      .toEqual(['新建角色', 'Create character'])
  })

  it('names the chain slot and lane of a started record and of its retakes, and nothing for a free record', () => {
    const render = record({ id: 'g1', operation: 'shot.render', params: { shot: 7 }, started_by: { record: 'ap', slot: 1 } })
    const variant = record({ id: 'g2', operation: 'shot.render', started_by: { record: 'ad', slot: 1, lane: '9:16' } })
    const retake = record({ id: 'g3', operation: 'shot.render', params: { shot: 1 }, based_on: 'g2' })
    const records = new Map([render, variant, retake].map(item => [item.id, item]))
    expect(actionLabel(render, labels({ records }))).toEqual(['渲染镜头 1', 'Render shot 1'])
    expect(actionLabel(variant, labels({ records }))).toEqual(['渲染镜头 1 · 9:16', 'Render shot 1 · 9:16'])
    expect(actionLabel(retake, labels({ records }))).toEqual(['渲染镜头 1 · 9:16', 'Render shot 1 · 9:16'])
    expect(actionLabel(record({ id: 'f', operation: 'shot.render', params: { shot: 7 } }), labels())).toEqual(['渲染镜头', 'Render shot'])
    expect(actionLabel(record({ id: 'tl', operation: 'timeline.create', started_by: { record: 'ap', slot: null } }), labels()))
      .toEqual(['新建时间线', 'Create timeline'])
  })

  it('takes the subject from the registered row of the operation, then from the row of its component key', () => {
    const rows: HistoryRow[] = [
      { match: 'timeline.', subject: () => [' 全部', ' all'] },
      { match: 'timeline.create', subject: () => [' t2', ' t2'] },
      { match: 'plan.update', subject: () => null },
    ]
    expect(actionLabel(record({ id: 'tc', operation: 'timeline.create', params: { timeline: 't2' } }), labels({ rows })))
      .toEqual(['新建时间线 t2', 'Create timeline t2'])
    expect(actionLabel(record({ id: 'tu', operation: 'timeline.update' }), labels({ rows }))).toEqual(['修改时间线 全部', 'Update timeline all'])
    expect(actionLabel(record({ id: 'c', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } }), labels({ rows })))
      .toEqual(['修改分镜计划', 'Update plan'])
  })

  it('shows an image first, a take\'s still for its video, a video frame without a still, nothing for other files and unmade inputs, and the first folded thumbnail', () => {
    const assets = new Map([
      asset('take.mp4', 'video/mp4', 'g1'), asset('still.png', 'image/png', 'g1'), asset('clip.mp4', 'video/mp4', 'gone'),
      asset('plan.json', 'application/json', 'p'), asset('ref.png', 'image/png', null), asset('upload.mp4', 'video/mp4', null),
    ].map(item => [item.id, item]))
    const render = record({ id: 'g1', outputs: ['take.mp4', 'still.png'] })
    const records = new Map([[render.id, render]])
    expect(thumbnailOf(render, assets, records)).toBe('still.png')
    const clipRow = record({ id: 'm', inputs: [{ role: 'clip', ref: { record: 'g1', output: 0 }, resolved_asset: 'take.mp4' }] })
    expect(thumbnailOf(clipRow, assets, records)).toBe('still.png')
    expect(thumbnailOf(record({ id: 'v', outputs: ['clip.mp4'] }), assets, records)).toBe('clip.mp4')
    expect(thumbnailOf(record({ id: 'i', outputs: ['upload.mp4'] }), assets, records)).toBe('upload.mp4')
    const unmade = record({ id: 'w', inputs: [{ role: 'clip', ref: { record: 'g9', output: 0 }, resolved_asset: null }] })
    expect(thumbnailOf(unmade, assets, records)).toBeNull()
    expect(thumbnailOf(record({ id: 'p', outputs: ['plan.json'] }), assets, records)).toBeNull()
    expect(thumbnailOf(record({ id: 'u', outputs: ['unknown'] }), assets, records)).toBeNull()
    expect(thumbnailOf(record({ id: 'ap' }), assets, records, [record({ id: 'g2' }), render])).toBe('still.png')
  })

  it('gives a record without an operation no subject from a row of its component key', () => {
    const rows: HistoryRow[] = [{ match: 'proj.', subject: () => [' 项目', ' project'] }]
    expect(actionLabel(record({ id: 'n', operation: null }), labels({ rows }))).toEqual(['', ''])
  })

  it('says how long ago a record was made', () => {
    const now = Date.parse('2026-10-06T12:00:00Z')
    expect(relativeTime('2026-10-06T11:59:30Z', now)).toEqual(['刚刚', 'just now'])
    expect(relativeTime('2026-10-06T11:55:00Z', now)).toEqual(['5 分钟前', '5 min ago'])
    expect(relativeTime('2026-10-06T09:00:00Z', now)).toEqual(['3 小时前', '3 h ago'])
    expect(relativeTime('2026-10-01T12:00:00Z', now)[0]).toMatch(/^10\/1 \d\d:\d\d$/)
  })
})

describe('operation labels', () => {
  it('labels an action by the label of its operation on the wire, else by its tool label, and an unknown one by its name', () => {
    const approve: WireOperation = {
      name: 'story.approve', version: '1', description: 'Approve a plan version.', label: { zh: '批准分镜计划', en: 'Approve plan' },
      inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'always',
    }
    const operations = [approve]
    expect(actionLabel(record({ id: 's', operation: 'story.approve', params: { plan: 'p1' } }), labels({ operations }))).toEqual(['批准分镜计划', 'Approve plan'])
    expect(actionLabel(record({ id: 'm', operation: 'asset.import' }), labels({ operations }))).toEqual(['导入素材', 'Import asset'])
    expect(actionLabel(record({ id: 'o', operation: 'other.thing' }), labels({ operations }))).toEqual(['other.thing', 'other.thing'])
  })
})

describe('focus', () => {
  const render = fixtureState().components.proj.records.find(item => item.id === 'g1') as ProjectRecord
  const move = record({ id: 'm', operation: 'timeline.clip_move', params: { clip: 'cl4', to: 1 } })
  const create = record({ id: 'c', operation: 'timeline.create', params: { timeline: 't2' } })

  it('asks the focus of the registered row that matches the operation, an exact name first, with the current records', () => {
    const seen: Array<readonly ProjectRecord[]> = []
    const rows: HistoryRow[] = [
      {
        match: 'timeline.', subject: () => null,
        focus: (item, records) => { seen.push(records); return { view: 'timeline', target: { timeline: 't1', clip: item.id } } },
      },
      { match: 'timeline.create', subject: () => null, focus: () => null },
    ]
    expect(centerFocus({ record: move, place: 'current' }, rows, [create, move]))
      .toEqual({ view: 'timeline', target: { timeline: 't1', clip: 'm' } })
    expect(seen).toEqual([[create, move]])
    expect(centerFocus({ record: create, place: 'before' }, rows, [create])).toBeNull()
  })

  it('focuses the node of a record whose row has no focus, nothing for proj records, and nothing for steps after the current position', () => {
    const rows: HistoryRow[] = [{ match: 'timeline.', subject: () => null }]
    expect(centerFocus({ record: render, place: 'before' }, rows, [])).toEqual({ view: 'canvas', target: { record: 'g1' } })
    expect(centerFocus({ record: move, place: 'before' }, rows, [])).toEqual({ view: 'canvas', target: { record: 'm' } })
    expect(centerFocus({ record: render, place: 'after' }, rows, [])).toBeNull()
    expect(centerFocus(entry({ id: 's', operation: 'proj.stale_accept' }), [], [])).toBeNull()
  })
})
