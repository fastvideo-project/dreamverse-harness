/**
 * Browser half of the shot plan: the canvas node type of plans with its card and editor, the records that plans use,
 * and the History row of plan records.
 *
 * @module @dv/ui-shot-plan/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PlanState, PlanVersion } from '@dv/shot-plan/types'
import type { NodeEntry, NodeType, RecordsInUse } from '@dv/ui-canvas/contract'
import { DvClient } from '@dv/ui-kit/api.ts'
import { loadedOnce } from '@dv/ui-kit/loaded.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import type { HistoryRow } from '@dv/ui-history/contract'
import { clockText } from '@dv/ui-kit/timeline.ts'
import type { WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import type { WireState } from '@dv/ui-kit/types.ts'
import { PlanCard } from './PlanCard.tsx'
import { PlanEditor, plansOf, totalSec } from './PlanEditor.tsx'
import type { PlanEditorInjected } from './PlanEditor.tsx'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { plan: PlanState } }

const ID = '@dv/ui-shot-plan'
/** The body height of a plan card: the type label and the version. */
const BODY_HEIGHT = 46

/**
 * The plans of a state that have a version.
 * @param state - a project state.
 * @returns one entry per plan: its `PlanId`, its versions (oldest first), and its latest version.
 */
function latestPlans(state: WireState): Array<{ id: string; versions: PlanVersion[]; latest: PlanVersion }> {
  return Object.entries(plansOf(state)).flatMap(([id, versions]) => {
    const latest = versions.at(-1)
    return latest === undefined ? [] : [{ id, versions, latest }]
  })
}

/**
 * The canvas node type of plans: one slice node `plan:<PlanId>` per plan in column 1 that shows its latest version
 * (title `N 个镜头 · <total duration>`) with one slot per shot. The node's record wrote the latest version, and its
 * `records` wrote the earlier versions.
 */
export const planNodeType: NodeType = {
  id: ID,
  type: 'plan',
  label: () => pickText('分镜计划', 'Plan'),
  color: 'var(--dv-node-2)',
  column: 1,
  entries({ state }) {
    const records = new Map(state.components.proj.records.map(record => [record.id, record]))
    return latestPlans(state).map(({ id, versions, latest }): NodeEntry => {
      const count = String(latest.shots.length)
      const total = totalSec(latest)
      const earlier = versions.slice(0, -1).map(version => version.created_by)
      return {
        id: `plan:${id}`,
        record: records.get(latest.created_by) ?? null,
        ...earlier.length === 0 ? {} : { records: earlier },
        title: `${pickText(`${count} 个镜头`, `${count} shots`)}${total === null ? '' : ` · ${clockText(total)}`}`,
        assets: [],
        slots: latest.shots.length,
        bodyHeight: BODY_HEIGHT,
      }
    })
  },
}

/** The records that produced the reference assets of each plan's latest version and of its shots. */
export const planReferencesInUse: RecordsInUse = {
  id: ID,
  uses(state) {
    const createdBy = state.components.proj.created_by
    return latestPlans(state)
      .flatMap(({ latest }) => [...latest.references ?? [], ...latest.shots.flatMap(shot => shot.references ?? [])])
      .flatMap(reference => createdBy[reference] ?? [])
  },
}

/** @returns the text of a record field (a number as its digits), or null for an absent or empty one. */
function field(fields: Record<string, unknown> | undefined, key: string): string | null {
  const value = fields?.[key]
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The History row of every `plan.*` operation. `plan.create` names its title (`《猫》` / ` “猫”`), else its PlanId
 * (` p1`); `plan.update` names its PlanId and the version it wrote (` p1 → v2`), else its PlanId. The PlanId and the
 * version come from the report, else from the params; a plan named by its record ID comes from a project made before
 * plans had IDs and is not shown. Any other plan operation, such as a `plan.approve` record of an old log, has no
 * subject.
 */
export const planHistoryRow: HistoryRow = {
  match: 'plan.',
  subject(record) {
    const named = field(record.report, 'plan') ?? field(record.params, 'plan')
    const plan = named !== null && /^p\d+$/.test(named) ? ` ${named}` : null
    switch (record.operation) {
      case 'plan.create': {
        const title = field(record.params, 'title')
        if (title !== null) return [`《${title}》`, ` “${title}”`]
        return plan === null ? null : [plan, plan]
      }
      case 'plan.update': {
        if (plan === null) return null
        const version = field(record.report, 'version') ?? field(record.params, 'version')
        return version === null ? [plan, plan] : [`${plan} → v${version}`, `${plan} → v${version}`]
      }
      default:
        return null
    }
  },
}

/** Required browser services: none; each registration waits for its own service. */
export const inject: readonly string[] = []

/**
 * Client plugin body. Each registration leaves with its service or with the plugin.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.nodeTypes.register(planNodeType), 'ui-shot-plan: node type')
    scope.effect(() => scope.dvCanvas.recordsInUse.register(planReferencesInUse), 'ui-shot-plan: records in use')
  })
  ctx.inject(['dvCanvas', 'slots'], (scope) => {
    const client = new DvClient()
    const injected: PlanEditorInjected = {
      hooks: {
        chainAnchors: scope.dvCanvas.chainAnchors, versionKinds: scope.dvCanvas.versionKinds,
        taskLabels: loadedOnce<WireTaskLabels>({}, () => client.getTaskLabels()),
      },
    }
    scope.effect(() => scope.slots.inject('dv.canvas.card', () => scope.slots.register({ name: 'dv.canvas.card', key: 'plan' }, PlanCard)), 'ui-shot-plan: plan card')
    scope.effect(() => scope.slots.inject('dv.canvas.editor', () => scope.slots.register(
      { name: 'dv.canvas.editor', key: 'plan', inject: () => injected }, PlanEditor,
    )), 'ui-shot-plan: plan editor')
  })
  ctx.inject(['dvHistory'], (scope) => {
    scope.effect(() => scope.dvHistory.rows.register(planHistoryRow), 'ui-shot-plan: history row')
  })
}
