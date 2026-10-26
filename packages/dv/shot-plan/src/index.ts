/**
 * The Shot plan component of DreamVerse as the `dvShotPlan` Cordis service: the plan of a video before anything is
 * rendered. A plan has a `PlanId` (`p1`, `p2`, …) and numbered versions. It owns two operations; a workflow plugin
 * approves plan versions:
 * - `plan.create`: version 1 of a new plan (the shots with their models, prompts and durations, and the references),
 *   stored as a JSON asset so the agent and the user read the same text; the assigned PlanId goes in `report.plan`;
 * - `plan.update`: the next version of the plan its `plan` param names.
 *
 * A shot names its model by the four fields of its key in the model catalog: `modality`, `task`, `provider` and `model`.
 * The plan stores the key as written and never looks it up; the workflow that approves the plan checks it.
 *
 * `dvProject` turns each registered operation into its agent tool (`dv_plan_create`, `dv_plan_update`). The
 * reducer keeps the `plan` slice: every version of every plan.
 *
 * @module @dv/shot-plan
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import {
  citedInput, parsePromptCitations, type OperationResult, type OperationSpec, type ProjectId, type ProjectState,
} from '@dv/project'
import { planOf, planReducer, reportedPlan } from './reducer.ts'
import type { Plan, PlanId, PlanVersion, ResolvedShot, Shot } from './types.ts'

export type { Plan, PlanId, PlanState, PlanVersion, ResolvedShot, Shot } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Shot plan component: plans of shots. */
    dvShotPlan: DvShotPlan
  }
}

/** `dvShotPlan` plugin configuration: the component has no deployment-varying values. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

/** Whether a shot's task takes references; a shot of another task ignores the plan's references. */
function takesReferences(shot: Shot): boolean {
  return shot.task === 'ref2v'
}

/** Whether a shot's task can start from a first frame, which `continue_previous` supplies. */
function takesFirstFrame(shot: Shot): boolean {
  return shot.task === 'ref2v'
}

/** The references a shot carries: its own, else the plan's; none when its task takes no references. */
function shotReferences(shot: Shot, plan: Plan): string[] {
  return takesReferences(shot) ? shot.references ?? plan.references ?? [] : []
}

/** One shot of a plan as the tool params declare it. */
const SHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    modality: { type: 'string', required: true, description: 'The modality of a model that dv_models_list lists.' },
    task: { type: 'string', required: true, description: 'The task of that model, as dv_models_list lists it.' },
    provider: { type: 'string', required: true, description: 'The provider of that model, as dv_models_list lists it.' },
    model: { type: 'string', required: true, description: 'The model name, as dv_models_list lists it.' },
    prompt: { type: 'string', required: true, description: 'The complete prompt of this shot, written for its model and task.' },
    duration_sec: { type: 'integer', description: 'Seconds; defaults to the model minimum.' },
    references: {
      type: 'array', items: { type: 'string' },
      description: 'Task ref2v only: versions (`<id>@<n>`; dv_proj_state lists IDs) or asset IDs this shot uses instead of the plan references.',
    },
    continue_previous: {
      type: 'boolean',
      description: 'Not on shot 1, and only when the model takes a first frame (see dv_models_get): the shot starts from the last '
        + 'frame of the previous shot. Omit it for a shot that does not continue the previous one.',
    },
    seed: { type: 'integer' },
  },
} as const

/** The params of `plan.create`: the fields of a `Plan`. */
const PLAN_PARAMS = {
  title: { type: 'string' },
  references: {
    type: 'array', items: { type: 'string' },
    description: 'Versions (`<id>@<n>`; dv_proj_state lists IDs) or asset IDs every shot of task ref2v references unless it names its own.',
  },
  aspect_ratio: { type: 'string' },
  resolution: { type: 'string' },
  seed: { type: 'integer' },
  shots: { type: 'array', required: true, items: SHOT_SCHEMA },
} as const

/** The number of shots in a plan record's params, for summaries. */
function shotCount(params: Record<string, unknown>): number {
  return Array.isArray(params['shots']) ? params['shots'].length : 0
}

/**
 * The problems of a plan's shots that break the plan format: references in a task other than `ref2v`,
 * `continue_previous` on shot 1 or in a task other than `ref2v`, and a prompt that cites the first frame
 * (`dv:input/first_frame`) of a shot that does not continue the previous shot.
 * @param shots - the shots, in order.
 * @returns one sentence per problem, empty when the shots are valid.
 */
function shotProblems(shots: readonly Shot[]): string[] {
  return shots.flatMap((shot, index) => {
    const n = String(index + 1)
    const problems: string[] = []
    if (!takesReferences(shot) && (shot.references?.length ?? 0) > 0) {
      problems.push(`Shot ${n} uses task ${shot.task}, which takes no references; remove its references or use task ref2v.`)
    }
    if (shot.continue_previous === true && !takesFirstFrame(shot)) {
      problems.push(`Shot ${n} uses task ${shot.task}, which takes no first frame; remove its continue_previous or use task ref2v.`)
    } else if (shot.continue_previous === true && index === 0) {
      problems.push('Shot 1 has no previous shot to continue; remove its continue_previous.')
    }
    const citesFirstFrame = parsePromptCitations(shot.prompt).some(citation => citedInput(citation.uri) === 'first_frame')
    if (citesFirstFrame && (shot.continue_previous !== true || index === 0)) {
      problems.push(`Shot ${n} cites the first frame but does not continue the previous shot; `
        + 'set continue_previous or remove the citation.')
    }
    return problems
  })
}

/**
 * One version of a plan in a state.
 * @param state - a project state.
 * @param plan - the PlanId.
 * @param version - the version number; the latest version when omitted.
 * @returns the version.
 * @throws Error naming the unknown plan or version.
 */
function versionIn(state: ProjectState, plan: string, version?: number): PlanVersion {
  const versions = state.components.plan.plans[brandString<PlanId>(plan)]
  if (versions === undefined) throw new Error(`Unknown plan '${plan}'; pass the plan ID (p1, p2, …) that dv_plan_create reported.`)
  const found = version === undefined ? versions.at(-1) : versions[version - 1]
  if (found === undefined) throw new Error(`Plan '${plan}' has no version ${String(version)}; it has ${versions.length}.`)
  return found
}

/** The Shot plan service: the two operations, the reducer, and the methods that read plans. */
export default class DvShotPlan extends Service {
  static inject = ['dvProject']
  static Config = Config

  /** The highest plan number this service assigned per project, for calls whose records have not finished yet. */
  private readonly assigned = new Map<ProjectId, number>()

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'dvShotPlan')
    ctx.effect(() => ctx.dvProject.registerComponent('plan'), 'dvShotPlan component')
    ctx.effect(() => ctx.dvProject.registerReducer('plan', planReducer), 'dvShotPlan reducer')
    for (const spec of this.operations()) {
      ctx.effect(() => ctx.dvProject.registerOperation(spec), `dvShotPlan ${spec.name}`)
    }
  }

  /**
   * Read one version of a plan.
   * @param state - the state the plan is read in.
   * @param plan - the PlanId.
   * @param version - the version number; the latest version when omitted.
   * @returns the version.
   * @throws Error naming the unknown plan or version.
   */
  get(state: ProjectState, plan: PlanId | string, version?: number): PlanVersion {
    return versionIn(state, plan, version)
  }

  /**
   * Resolve the shots of one plan version, the way every workflow reads a plan: each shot with its 1-based slot, the
   * plan's `aspect_ratio` and `resolution`, its own `seed` else the plan's, its own references else the plan's (none for a
   * task other than `ref2v`), and whether it continues the previous shot (`continue_previous`, task `ref2v`, not slot 1).
   * @param state - the state the plan is read in.
   * @param plan - the PlanId.
   * @param version - the version number; the latest version when omitted.
   * @returns one entry per shot, in shot order.
   * @throws Error naming the unknown plan or version.
   */
  shots(state: ProjectState, plan: PlanId | string, version?: number): ResolvedShot[] {
    const found = versionIn(state, plan, version)
    return found.shots.map((shot, index) => {
      const seed = shot.seed ?? found.seed
      return {
        slot: index + 1, shot,
        ...found.aspect_ratio === undefined ? {} : { aspect_ratio: found.aspect_ratio },
        ...found.resolution === undefined ? {} : { resolution: found.resolution },
        ...seed === undefined ? {} : { seed },
        references: shotReferences(shot, found),
        continuePrevious: shot.continue_previous === true && takesFirstFrame(shot) && index > 0,
      }
    })
  }

  /**
   * Assign a new PlanId in a project. The number after `p` is one more than the highest number that any Shot plan
   * record of the project stored in `report.plan`, anywhere in its history, and than any number this service assigned to a call
   * still running, so no two plans of a project share an ID.
   * @param project - the project.
   * @returns the PlanId.
   */
  private assignPlanId(project: ProjectId): PlanId {
    let highest = this.assigned.get(project) ?? 0
    for (const entry of this.ctx.dvProject.listHistory({ project, component: 'plan' })) {
      highest = Math.max(highest, Number(/^p(\d+)$/.exec(reportedPlan(entry.record) ?? '')?.[1] ?? 0))
    }
    this.assigned.set(project, highest + 1)
    return brandString<PlanId>(`p${String(highest + 1)}`)
  }

  /**
   * Refuse a `plan.create` or `plan.update` call before its record when a shot names references in a task other than
   * `ref2v`, or `continue_previous` on shot 1 or in a task other than `ref2v` (see `shotProblems`), or when a shot's
   * references (its own, else the plan's) name an unknown version of a reference kind.
   * @param plan - the plan of the call's params.
   * @param state - the project's current state, which the call writes after.
   * @throws Error with one sentence per problem, or the error of the unknown reference.
   */
  private checkPlan(plan: Plan, state: ProjectState): void {
    const problems = shotProblems(plan.shots)
    if (problems.length > 0) throw new Error(`The plan cannot be rendered as written. ${problems.join(' ')}`)
    for (const shot of plan.shots) {
      for (const reference of shotReferences(shot, plan)) this.ctx.dvProject.parseReference(reference, state)
    }
  }

  /** The two plan operations. */
  private operations(): OperationSpec[] {
    const create: OperationSpec = {
      name: 'plan.create',
      component: 'plan',
      version: '1',
      label: { zh: '新建分镜计划', en: 'Create plan' },
      description: 'Propose a new plan for a separate story: for each shot its model from dv_models_list, its prompt written for it, its '
        + 'duration, and its inputs (references; continue_previous to start from the previous shot\'s last frame). The report names '
        + 'the new plan ID (p1, p2, …). To extend, shorten or change an existing plan, call dv_plan_update '
        + 'instead. A plan renders nothing by itself.',
      inputs: {},
      params: PLAN_PARAMS,
      outputs: [{ role: 'plan', type: 'json' }],
      deterministic: true,
      resource: 'none',
      confirm: 'never',
      summarize: record => `plan ${String(record.report?.['plan'])} v${String(record.report?.['version'])} with ${shotCount(record.params)} shots`,
      omitParamsFromResult: true,
      precondition: (request, state) => {
        this.checkPlan(planOf(request.params), state)
        return Promise.resolve()
      },
      execute: (context): Promise<OperationResult> => {
        const plan = planOf(context.params)
        if (plan.shots.length === 0) throw new Error('plan.create needs at least one shot.')
        const id = this.assignPlanId(context.project)
        const asset = context.importAsset(Buffer.from(JSON.stringify(plan, null, 2)), { mime: 'application/json', name: 'plan.json' })
        return Promise.resolve({ outputs: [asset], report: { plan: id, version: 1 } })
      },
    }
    return [
      create,
      {
        ...create,
        name: 'plan.update',
        label: { zh: '修改分镜计划', en: 'Update plan' },
        description: 'Write the next version of an existing plan: pass its plan ID and the complete plan (every shot, in order; '
          + 'a shot added after six shots is shot 7). Use it to extend, shorten or change the story. The report names the plan '
          + 'ID and the new version. A version renders nothing by itself.',
        params: { plan: { type: 'string', required: true, description: 'The plan ID (p1, p2, …).' }, ...PLAN_PARAMS },
        precondition: (request, state) => {
          versionIn(state, String(request.params['plan']))
          this.checkPlan(planOf(request.params), state)
          return Promise.resolve()
        },
        execute: (context): Promise<OperationResult> => {
          const plan = String(context.params['plan'])
          const latest = versionIn(context.state, plan)
          const version = planOf(context.params)
          if (version.shots.length === 0) throw new Error('plan.update needs at least one shot.')
          const number = latest.version + 1
          const asset = context.importAsset(Buffer.from(JSON.stringify(version, null, 2)), { mime: 'application/json', name: 'plan.json' })
          return Promise.resolve({ outputs: [asset], report: { plan, version: number } })
        },
      },
    ]
  }
}
