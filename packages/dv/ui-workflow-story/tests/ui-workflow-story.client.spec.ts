/** The chain anchor and the History row of story approvals, and their registration and removal with the plugin. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import type { DvHistory, HistoryRow } from '@dv/ui-history/contract'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, storyApprovalAnchor, storyApprovalRow } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

describe('storyApprovalAnchor', () => {
  it('hangs a story approval off the node of its plan', () => {
    expect(storyApprovalAnchor.starter).toBe('story.approve')
    expect(storyApprovalAnchor.anchor(record({ id: 's1', operation: 'story.approve', params: { plan: 'p2' } }))).toBe('plan:p2')
  })

  it('lists the approved versions of a plan from the story slice, in version order', () => {
    const state = fixtureState()
    expect(storyApprovalAnchor.approvedVersions?.(state, 'plan:p1')).toEqual([])
    state.components['story'] = {
      approvals: { p1: [{ version: 3, record: 's3' }, { version: 1, record: 's1' }, { version: 3, record: 's4' }] },
      timelines: { p1: 't2' },
    }
    expect(storyApprovalAnchor.approvedVersions?.(state, 'plan:p1')).toEqual([1, 3])
    expect(storyApprovalAnchor.approvedVersions?.(state, 'plan:p9')).toEqual([])
    expect(storyApprovalAnchor.approvedVersions?.(state, 'character:p1')).toEqual([])
  })
})

describe('storyApprovalRow', () => {
  it('names the plan and version of a finished approval, and nothing before its report', () => {
    expect(storyApprovalRow.match).toBe('story.approve')
    const done = record({ id: 's1', operation: 'story.approve', params: { plan: 'p1' }, report: { plan: 'p1', version: 2, timeline: 't1', scheduled: [] } })
    expect(storyApprovalRow.subject(done)).toEqual([' p1 v2', ' p1 v2'])
    expect(storyApprovalRow.subject(record({ id: 's2', operation: 'story.approve', params: { plan: 'p1' }, status: 'pending' }))).toBeNull()
  })

  it('labels the renders folded under an approval by their count', () => {
    expect(storyApprovalRow.fold?.(3)).toEqual(['渲染 3 个镜头', 'Render 3 shots'])
  })
})

describe('ui-workflow-story apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers each descriptor once its service is present, and the plugin disposal removes both', async () => {
    const ctx = new Context()
    const canvas = createDvCanvas()
    const history: DvHistory = { rows: createRegistry<HistoryRow>(row => [row.match], row => row.match), describe: () => ['', ''] }
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    ctx.provide('dvHistory', history)
    await vi.waitFor(() => { expect(history.rows.getSnapshot()).toEqual([storyApprovalRow]) })
    expect(canvas.chainAnchors.getSnapshot()).toEqual([])
    ctx.provide('dvCanvas', canvas)
    await vi.waitFor(() => { expect(canvas.chainAnchors.getSnapshot()).toEqual([storyApprovalAnchor]) })
    await fiber.dispose()
    expect(canvas.chainAnchors.getSnapshot()).toEqual([])
    expect(history.rows.getSnapshot()).toEqual([])
  })
})
