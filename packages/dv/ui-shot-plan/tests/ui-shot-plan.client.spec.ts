// @vitest-environment jsdom
/**
 * The shot plan plugin under the slot test runtime: the canvas nodes of plans that its node type draws, the records
 * that plans use, the History row of plan records, the plan card, and the registration and removal of each with the
 * plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { RecordId } from '@dv/project/types'
import type { PlanId } from '@dv/shot-plan/types'
import type { DvCanvas } from '@dv/ui-canvas/contract'
import { createDvCanvas } from '@dv/ui-canvas/src/client/dv-canvas.ts'
import type { DvHistory, HistoryRow } from '@dv/ui-history/contract'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { canvasNodes, mountPlanCanvas, planEntries } from './plan-canvas.client.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

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

/**
 * Mount the shot plan plugin beside an empty `dvCanvas`.
 * @returns the runtime, the registries, and the plugin.
 */
async function mountPlugin() {
  const runtime = await SlotTestRuntime.create()
  const canvas = createDvCanvas()
  runtime.ctx.provide('dvCanvas', canvas)
  const plugin = await runtime.mount({ inject: [...inject], apply })
  return { runtime, canvas, plugin }
}

/** @returns the canvas nodes of type `plan` that the registered node types draw for a state. */
function planNodes(canvas: DvCanvas, state: WireState) {
  return canvasNodes(canvas, state).filter(node => node.type === 'plan')
}

describe('plan node type', () => {
  it('draws each plan as one node at its latest version in column 1, with one slot per shot and a body of 46', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, canvas } = await mountPlugin()
    const [node, ...rest] = planNodes(canvas, secondVersion())
    expect(rest).toEqual([])
    expect([node?.nodeType.id, node?.nodeType.column, node?.nodeType.label()]).toEqual(['@dv/ui-shot-plan', 1, '分镜计划'])
    expect(node).toMatchObject({ id: 'plan:p1', records: ['p1'], title: '3 个镜头 · 0:06', assets: [], slots: 3, bodyHeight: 46, data: null })
    // The node's record wrote the shown version; a history focus on the record of v1 opens the node through `records`.
    expect(node?.record?.id).toBe('q2')
    await runtime.dispose()
  })

  it('draws no node for a state without the plan slice or for a plan without versions', async () => {
    const { runtime, canvas } = await mountPlugin()
    const state: WireState = fixtureState()
    const { plan: _plan, ...components } = state.components
    expect(planNodes(canvas, { ...state, components })).toEqual([])
    const withEmptyPlan = fixtureState()
    withEmptyPlan.components.plan.plans['p2' as PlanId] = []
    expect(planNodes(canvas, withEmptyPlan).map(node => node.id)).toEqual(['plan:p1'])
    await runtime.dispose()
  })

  it('draws a node without a record when the project records lack the record that wrote the shown version', async () => {
    const { runtime, canvas } = await mountPlugin()
    const state = secondVersion()
    state.components.proj.records = state.components.proj.records.filter(entry => entry.id !== 'q2')
    expect(planNodes(canvas, state)).toMatchObject([{ id: 'plan:p1', record: null, records: ['p1'], data: null }])
    await runtime.dispose()
  })

  it('titles a version with a shot without duration by its shot count, in the interface language', async () => {
    document.documentElement.lang = 'en'
    const { runtime, canvas } = await mountPlugin()
    const nodes = planNodes(canvas, fixtureState())
    expect(nodes[0]?.nodeType.label()).toBe('Plan')
    expect(nodes).toMatchObject([{ id: 'plan:p1', title: '2 shots', slots: 2, data: null }])
    // Version 1 has no earlier versions.
    expect(nodes[0]?.records).toBeUndefined()
    await runtime.dispose()
  })
})

describe('plan records in use', () => {
  it('reports the records that produced the reference assets of the latest version and its shots', async () => {
    const { runtime, canvas } = await mountPlugin()
    const [uses] = canvas.recordsInUse.getSnapshot()
    expect(uses?.uses(fixtureState())).toEqual([])
    // `hero@1` is a version reference and `missing.png` has no producer, so neither names a record.
    expect(uses?.uses(secondVersion())).toEqual(['g1', 'g2'])
    await runtime.dispose()
  })
})

describe('plan History row', () => {
  it('names the title or the PlanId of a created plan, and the PlanId and version of an updated one', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.ctx.provide('dvHistory', { rows: createRegistry<HistoryRow>(row => [row.match], row => row.match), describe: () => ['', ''] } satisfies DvHistory)
    await runtime.mount({ inject: [...inject], apply })
    const [row] = runtime.ctx.dvHistory.rows.getSnapshot()
    if (row === undefined) throw new Error('no History row registered')
    const subject = (fields: Parameters<typeof record>[0]) => row.subject(record(fields))
    expect(row.match).toBe('plan.')
    expect(subject({ id: 'a', operation: 'plan.create', params: { title: '猫' }, report: { plan: 'p1', version: 1 } })).toEqual(['《猫》', ' “猫”'])
    expect(subject({ id: 'b', operation: 'plan.create', params: {}, report: { plan: 'p1', version: 1 } })).toEqual([' p1', ' p1'])
    expect(subject({ id: 'g', operation: 'plan.create', params: {} })).toBeNull()
    expect(subject({ id: 'c', operation: 'plan.update', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } })).toEqual([' p1 → v2', ' p1 → v2'])
    expect(subject({ id: 'd', operation: 'plan.update', params: { plan: 'p1' } })).toEqual([' p1', ' p1'])
    // A plan named by its record ID (a project made before plans had IDs) and an old plan.approve record get no subject.
    expect(subject({ id: 'e', operation: 'plan.update', params: { plan: 'rec_9' }, report: { plan: 'rec_9', version: 2 } })).toBeNull()
    expect(subject({ id: 'f', operation: 'plan.approve', params: { plan: 'p1' }, report: { plan: 'p1', version: 2 } })).toBeNull()
    await runtime.dispose()
  })
})

describe('plan card', () => {
  it('shows the type label and the version on show, in the interface language', async () => {
    document.documentElement.lang = 'zh-CN'
    const zh = await mountPlanCanvas(secondVersion())
    expect(zh.card.textContent).toBe('分镜计划 · 第 2 版')
    await zh.runtime.dispose()
    document.documentElement.lang = 'en'
    const en = await mountPlanCanvas(secondVersion())
    expect(en.card.textContent).toBe('Plan · v2')
    await en.runtime.dispose()
  })
})

describe('ui-shot-plan apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the node type, the records in use, the card and the editor, and the plugin disposal removes each', async () => {
    document.documentElement.lang = 'zh-CN'
    const { runtime, canvas, plugin, card, editor } = await mountPlanCanvas(fixtureState())
    const plan = (): string[] => canvas.nodeTypes.getSnapshot().filter(type => type.id === '@dv/ui-shot-plan').map(type => type.type)
    expect(plan()).toEqual(['plan'])
    expect(canvas.recordsInUse.getSnapshot().map(uses => uses.id)).toEqual(['@dv/ui-shot-plan'])
    expect(card.textContent).toBe('分镜计划 · 第 1 版')
    expect(within(editor).getByTestId('dv-canvas-plan-status').textContent).toBe('待批准')
    await plugin.dispose()
    expect(plan()).toEqual([])
    expect(canvas.recordsInUse.getSnapshot()).toEqual([])
    expect(planEntries(runtime)).toEqual({ card: 0, editor: 0 })
    await waitFor(() => { expect(card.textContent).toBe('') })
    expect(within(editor).queryByTestId('dv-canvas-plan-status')).toBeNull()
    await runtime.dispose()
  })

  it('registers the History row once dvHistory is present, and the plugin disposal removes it', async () => {
    const runtime = await SlotTestRuntime.create()
    const history: DvHistory = { rows: createRegistry<HistoryRow>(row => [row.match], row => row.match), describe: () => ['', ''] }
    const plugin = await runtime.mount({ inject: [...inject], apply })
    expect(history.rows.getSnapshot()).toEqual([])
    runtime.ctx.provide('dvHistory', history)
    await waitFor(() => { expect(history.rows.getSnapshot().map(row => row.match)).toEqual(['plan.']) })
    await plugin.dispose()
    expect(history.rows.getSnapshot()).toEqual([])
    await runtime.dispose()
  })
})
