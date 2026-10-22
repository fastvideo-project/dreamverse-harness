// @vitest-environment jsdom
/**
 * The canvas node type of plans, the takes that plans use and the History row of plan records, and their registration
 * and removal with the plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RecordId } from '@dv/project/types'
import type { PlanId } from '@dv/shot-plan/types'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { ChainAnchor, DvCanvas, DvHistory, HistoryRow, NodeType, TakesInUse, VersionKind } from '@dv/ui-kit/registries.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, planHistoryRow, planNodeType, planReferencesInUse } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => { document.documentElement.lang = '' })

/** @returns empty canvas registries keyed as `DvCanvas` documents. */
function canvasRegistries(): DvCanvas {
  return {
    nodeTypes: createRegistry<NodeType>(kind => [kind.id]),
    chainAnchors: createRegistry<ChainAnchor>(anchor => [anchor.starter]),
    takesInUse: createRegistry<TakesInUse>(uses => [uses.id]),
    versionKinds: createRegistry<VersionKind>(kind => [kind.kind]),
  }
}

/**
 * The shared fixture with plan p1 at version 2, which record q2 wrote over v1 of record p1: references `shot1-last.png`
 * and `hero@1`, and three shots of 1, 2 and 3 seconds, the second of which uses `shot2.mp4` and `missing.png`.
 * @returns the state.
 */
function secondVersion(): WireState {
  const state = fixtureState()
  const [v1] = state.components.plan.plans['p1' as PlanId] ?? []
  const shot = v1?.shots[0]
  if (v1 === undefined || shot === undefined) throw new Error('fixture lacks plan p1')
  const shots = [1, 2, 3].map(duration => ({ ...shot, duration_sec: duration, ...duration === 2 ? { references: ['shot2.mp4', 'missing.png'] } : {} }))
  state.components.plan.plans['p1' as PlanId] = [v1, { ...v1, version: 2, references: ['shot1-last.png', 'hero@1'], shots, created_by: 'q2' as RecordId }]
  state.components.proj.records.push(record({ id: 'q2', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } }))
  return state
}

describe('planNodeType', () => {
  it('draws each plan as one entry at its latest version in column 1, with one slot per shot', () => {
    document.documentElement.lang = 'zh-CN'
    expect([planNodeType.id, planNodeType.type, planNodeType.column, planNodeType.label()]).toEqual(['@dv/ui-shot-plan', 'plan', 1, '分镜计划'])
    const [entry, ...rest] = planNodeType.entries(secondVersion())
    expect(rest).toEqual([])
    expect(entry).toMatchObject({ id: 'plan:p1', records: ['p1'], subtitle: '第 2 版', title: '3 个镜头 · 0:06', media: [], slots: 3 })
    // The entry's record wrote the shown version; a history focus on the record of v1 centers the entry through `records`.
    expect(entry?.record?.id).toBe('q2')
  })

  it('draws no entry for a state without the plan slice or for a plan without versions', () => {
    const state: WireState = fixtureState()
    const { plan: _plan, ...components } = state.components
    expect(planNodeType.entries({ ...state, components })).toEqual([])
    const withEmptyPlan = fixtureState()
    withEmptyPlan.components.plan.plans['p2' as PlanId] = []
    expect(planNodeType.entries(withEmptyPlan).map(entry => entry.id)).toEqual(['plan:p1'])
  })

  it('draws an entry without a record when the project records lack the record that wrote the shown version', () => {
    const state = secondVersion()
    state.components.proj.records = state.components.proj.records.filter(entry => entry.id !== 'q2')
    expect(planNodeType.entries(state)).toMatchObject([{ id: 'plan:p1', record: null, records: ['p1'], subtitle: 'v2' }])
  })

  it('titles a version with a shot without duration by its shot count, in the interface language', () => {
    document.documentElement.lang = 'en'
    expect(planNodeType.label()).toBe('Plan')
    expect(planNodeType.entries(fixtureState())).toMatchObject([{ id: 'plan:p1', records: [], subtitle: 'v1', title: '2 shots', slots: 2 }])
  })
})

describe('planReferencesInUse', () => {
  it('reports the records that produced the reference assets of the latest version and its shots', () => {
    expect(planReferencesInUse.uses(fixtureState())).toEqual([])
    // `hero@1` is a version reference and `missing.png` has no producer, so neither names a record.
    expect(planReferencesInUse.uses(secondVersion())).toEqual(['g1', 'g2'])
  })
})

describe('planHistoryRow', () => {
  it('names the title or the PlanId of a created plan, and the PlanId and version of an updated one', () => {
    const subject = (fields: Parameters<typeof record>[0]) => planHistoryRow.subject(record(fields))
    expect(planHistoryRow.match).toBe('plan.')
    expect(subject({ id: 'a', operation: 'plan.create', params: { title: '猫' }, report: { plan: 'p1', version: 1 } })).toEqual(['《猫》', ' “猫”'])
    expect(subject({ id: 'b', operation: 'plan.create', params: {}, report: { plan: 'p1', version: 1 } })).toEqual([' p1', ' p1'])
    expect(subject({ id: 'g', operation: 'plan.create', params: {} })).toBeNull()
    expect(subject({ id: 'c', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } })).toEqual([' p1 → v2', ' p1 → v2'])
    expect(subject({ id: 'd', operation: 'plan.update', params: { plan: 'p1' } })).toEqual([' p1', ' p1'])
    // A plan named by its record ID (a project made before plans had IDs) and an old plan.approve record get no subject.
    expect(subject({ id: 'e', operation: 'plan.update', params: { plan: 'rec_9' }, report: { plan: 'rec_9', version: 2 } })).toBeNull()
    expect(subject({ id: 'f', operation: 'plan.approve', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } })).toBeNull()
  })
})

describe('ui-shot-plan apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the node type and the takes in use once dvCanvas is present, and the plugin disposal removes both', async () => {
    const ctx = new Context()
    const canvas = canvasRegistries()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(canvas.nodeTypes.list()).toEqual([])
    ctx.provide('dvCanvas', canvas)
    await vi.waitFor(() => { expect(canvas.nodeTypes.list()).toEqual([planNodeType]) })
    expect(canvas.takesInUse.list()).toEqual([planReferencesInUse])
    await fiber.dispose()
    expect(canvas.nodeTypes.list()).toEqual([])
    expect(canvas.takesInUse.list()).toEqual([])
  })

  it('registers the History row once dvHistory is present, and the plugin disposal removes it', async () => {
    const ctx = new Context()
    const history: DvHistory = { rows: createRegistry<HistoryRow>(row => [row.match]) }
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    ctx.provide('dvHistory', history)
    await vi.waitFor(() => { expect(history.rows.list()).toEqual([planHistoryRow]) })
    await fiber.dispose()
    expect(history.rows.list()).toEqual([])
  })
})
