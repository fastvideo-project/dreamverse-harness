/**
 * Browser half of the story workflow: the canvas chain anchor and the History row of `story.approve` records. The anchor
 * hangs the records that a story approval started off the node of its plan and reads the approved versions of a plan
 * from the `story` slice; the row names the plan and version of an approval and the renders folded under it.
 *
 * @module @dv/ui-workflow-story/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChainAnchor } from '@dv/ui-canvas/contract'
import type { HistoryRow } from '@dv/ui-history/contract'

/** The operation of `@dv/workflow-story` whose records approve a plan version and start its renders and layout. */
const APPROVE = 'story.approve'

/** The node ID prefix of a plan on the canvas. */
const PLAN_NODE = 'plan:'

/** The part of the `story` slice of `@dv/workflow-story` that the anchor reads: the approvals of each plan, oldest first. */
interface StoryApprovals {
  approvals: Record<string, ReadonlyArray<{ version: number }>>
}

/**
 * @param slice - the `story` entry of the wire state's components.
 * @returns whether the slice holds an `approvals` object.
 */
function isStorySlice(slice: unknown): slice is StoryApprovals {
  return typeof slice === 'object' && slice !== null && 'approvals' in slice && typeof slice.approvals === 'object'
    && slice.approvals !== null
}

/**
 * The chain anchor of story approvals: a `story.approve` record hangs the records it started off the node of its plan,
 * and the approved versions of a plan are the versions of its approvals in the `story` slice, in version order.
 */
export const storyApprovalAnchor: ChainAnchor = {
  starter: APPROVE,
  anchor: record => PLAN_NODE + String(record.params['plan']),
  approvedVersions(state, anchorId) {
    const slice = state.components['story']
    if (!anchorId.startsWith(PLAN_NODE) || !isStorySlice(slice)) return []
    const versions = (slice.approvals[anchorId.slice(PLAN_NODE.length)] ?? []).map(approval => approval.version)
    return [...new Set(versions)].sort((a, b) => a - b)
  },
}

/**
 * The History row of story approvals: the subject ` <plan> v<version>` from the report of a finished approval, and the
 * fold text 渲染 n 个镜头 / Render n shots over the shot renders the approval started.
 */
export const storyApprovalRow: HistoryRow = {
  match: APPROVE,
  fold: count => [`渲染 ${String(count)} 个镜头`, `Render ${String(count)} shots`],
  subject(record) {
    const plan = record.report?.['plan']
    const version = record.report?.['version']
    if (typeof plan !== 'string' || typeof version !== 'number') return null
    const subject = ` ${plan} v${String(version)}`
    return [subject, subject]
  },
}

/**
 * Client plugin body: while `dvCanvas` is present, register the chain anchor; while `dvHistory` is present, register the
 * History row. Each registration leaves with its service or with the plugin.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.chainAnchors.register(storyApprovalAnchor), 'ui-workflow-story: chain anchor')
  })
  ctx.inject(['dvHistory'], (scope) => {
    scope.effect(() => scope.dvHistory.rows.register(storyApprovalRow), 'ui-workflow-story: history row')
  })
}
