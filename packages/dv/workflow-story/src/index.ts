/**
 * The story workflow of DreamVerse as the `dvStory` Cordis service: it turns a version of a shot plan into renders of
 * its shots. It owns two operations:
 * - `story.preview` (tool `dv_story_preview`): a read that reports what approving a plan version renders and why a
 *   render would be refused;
 * - `story.approve` (tool `dv_story_approve`): the user's approval of a plan version, which renders its new or changed
 *   shots and lays every shot's take on the plan's timeline in its own execute.
 *
 * The shots come from `dvShotPlan.shots`, the shot walk of `@dv/workflow-kit` picks the take each shot reuses and
 * schedules the renders, `dvShotRender` checks and renders each shot, and `dvTimeline` lays out the takes.
 * The `story` reducer keeps the approvals of each plan and the timeline of each approved plan.
 *
 * @module @dv/workflow-story
 */
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'
import { ProjectError, type OperationContext, type OperationResult, type OperationSpec, type ProjectState } from '@dv/project'
import type { PlanId, PlanVersion } from '@dv/shot-plan'
import type {} from '@dv/shot-render'
import {
  checkShots, keepTimeline, planShots, scheduleShots, shotLine, takeFilter, walkShot, type Owns, type WalkStep,
} from '@dv/workflow-kit'
import { APPROVE, storyReducer } from './reducer.ts'

export type { StoryState } from './reducer.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The story workflow: previews and approvals of plan versions. */
    dvStory: DvStory
  }
}

/** `dvStory` plugin configuration: the workflow has no deployment-varying values. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

/** The params of a story call: the plan, and the version, the latest when omitted. */
interface StoryParams {
  plan: string
  version?: number
}

/** What approving a plan version renders: one line per shot and the number of shots that render. */
interface StoryPreview {
  version: number
  shots: string[]
  rendered: number
}

/** The story params of a call's params, which the runner validated against the operation's schema. */
function storyParams(params: Record<string, unknown>): StoryParams {
  const { plan, version } = params
  return { plan: String(plan), ...typeof version === 'number' ? { version } : {} }
}

/**
 * The starter records that belong to the story workflow for a plan: its `story.approve` records of that plan. Take
 * reuse and timeline reuse test the starter of a record's chain with it, so a free take, a take of another plan and an
 * ad take are never reused, and a timeline that another record wrote last is never laid out again.
 * @param plan - the PlanId.
 * @returns the test of a starter record.
 */
function ownsPlan(plan: string): Owns {
  return starter => starter.operation === APPROVE && starter.params['plan'] === plan
}

/** The params of a story operation: the plan, and the version that the operation acts on (`action`). */
function storyParamsSchema(action: string): OperationSpec['params'] {
  return {
    plan: { type: 'string', required: true, description: 'The plan ID (p1, p2, …).' },
    version: { type: 'integer', description: `The version to ${action}; defaults to the latest.` },
  }
}

/** The story workflow service: `story.preview`, `story.approve`, the `story` reducer and the plan walk they share. */
export default class DvStory extends Service {
  static inject = ['dvProject', 'dvShotPlan', 'dvShotRender', 'dvTimeline']
  static Config = Config

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'dvStory')
    ctx.effect(() => ctx.dvProject.registerComponent('story'), 'dvStory component')
    ctx.effect(() => ctx.dvProject.registerReducer('story', storyReducer), 'dvStory reducer')
    ctx.effect(() => ctx.dvProject.registerOperation(this.previewOperation()), 'dvStory story.preview')
    ctx.effect(() => ctx.dvProject.registerOperation(this.approveOperation()), 'dvStory story.approve')
    ctx.inject(['skills'], (child) => {
      child.effect(() => child.skills.registerProvider(control => new FileSystemSkillProvider(child, control, {
        providerName: 'workflow-story', includeDefaultRoots: false, customSkillDirs: [fileURLToPath(new URL('../skills', import.meta.url))],
      })), 'dvStory skills')
    })
  }

  /**
   * One version of a plan, read through `dvShotPlan.get`.
   * @param state - the state the plan is read in.
   * @param params - the plan and version.
   * @returns the version.
   * @throws ProjectError `invalid_params` naming an unknown plan or version.
   */
  private version(state: ProjectState, params: StoryParams): PlanVersion {
    try {
      return this.ctx.dvShotPlan.get(state, params.plan, params.version)
    } catch (error) {
      /* v8 ignore next -- `dvShotPlan.get` throws only Error objects. */
      throw new ProjectError('invalid_params', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * The shots of a plan version as the shot walk reads them: each shot's parsed references and the take it reuses.
   * A take is reused only when its chain starter is a `story.approve` record of the plan.
   * @param state - the state the plan and the takes are read in.
   * @param params - the plan and version.
   * @returns the version and the walk steps, in shot order.
   * @throws ProjectError `invalid_params` naming an unknown plan or version; the error of `parseInputs` for a reference
   *   that does not parse.
   */
  private walk(state: ProjectState, params: StoryParams): { version: PlanVersion; steps: WalkStep[] } {
    const version = this.version(state, params)
    const shots = this.ctx.dvShotPlan.shots(state, params.plan, version.version).map(resolved => walkShot(resolved))
    return { version, steps: planShots(this.ctx.dvShotRender, state, shots, takeFilter(state, ownsPlan(params.plan))) }
  }

  /**
   * What approving a plan version renders, without writing: one `shotLine` per shot and the number of shots that
   * render. Synchronous, so a confirm summary can call it.
   * @param state - the state the approval would run on.
   * @param params - the plan and version.
   * @returns the preview.
   * @throws ProjectError `invalid_params` naming an unknown plan or version.
   */
  private previewLines(state: ProjectState, params: StoryParams): StoryPreview {
    const { version, steps } = this.walk(state, params)
    const rendering = steps.filter(step => step.reuse === null)
    const shots = steps.map((step, index) => {
      const shot = version.shots[index]
      /* v8 ignore next -- `planShots` returns one step per shot of the version, in shot order. */
      if (shot === undefined) throw new Error(`Plan '${params.plan}' v${String(version.version)} has no shot ${String(step.slot)}.`)
      return shotLine(step, shot)
    })
    return { version: version.version, shots, rendered: rendering.length }
  }

  /**
   * Every reason an approval of a plan version would be refused, as `Shot <n>: <reason>`: `checkShots` of the shots
   * that render.
   * @param state - the state the approval would run on.
   * @param params - the plan and version.
   * @returns the problems, empty when every render would run.
   * @throws ProjectError `invalid_params` naming an unknown plan or version.
   */
  private async problems(state: ProjectState, params: StoryParams): Promise<string[]> {
    const { steps } = this.walk(state, params)
    const refusals = await checkShots(this.ctx.dvShotRender, state, steps)
    return refusals.map(({ slot, reason }) => `Shot ${String(slot)}: ${reason}`)
  }

  /**
   * Refuse an approval of a plan version for which `problems` lists a reason, with one error that names every refused
   * shot, so the plan can be fixed at once.
   * @param state - the state the approval would run on.
   * @param params - the plan and version.
   * @throws Error with every problem; ProjectError `invalid_params` naming an unknown plan or version.
   */
  private async refuse(state: ProjectState, params: StoryParams): Promise<void> {
    const problems = await this.problems(state, params)
    if (problems.length === 0) return
    throw new Error(`The plan cannot be approved as written. ${problems.join(' ')} Update the plan with dv_plan_update, then call again.`)
  }

  /**
   * The confirm text of `story.approve`: a head line with the plan, version and title, then the preview lines.
   * Synchronous, as `confirmSummary` must be.
   * @param state - the state the approval would run on.
   * @param params - the plan and version.
   * @returns the text.
   * @throws ProjectError `invalid_params` naming an unknown plan or version.
   */
  private confirmText(state: ProjectState, params: StoryParams): { text: string } {
    const { version, shots, rendered } = this.previewLines(state, params)
    const { title } = this.version(state, { plan: params.plan, version })
    const head = `Approve plan ${params.plan} v${String(version)}${title === undefined ? '' : ` "${title}"`}: render ${String(rendered)} of `
      + `${String(shots.length)} shots and lay every shot on the plan's timeline.`
    return { text: [head, ...shots.map(line => `- ${line}`)].join('\n') }
  }

  /**
   * Write the chain of a running `story.approve` call inside its execute: one render per shot of the version that
   * keeps no take, through `scheduleShots`, each with the intent `shot <slot> of plan <p> v<v>`, then one
   * `dvTimeline.layout` of every shot's take in shot order. The `system` actor writes each record in the approving
   * record's surface, session and turn, with `started_by` naming the approving record. The layout replaces the clips of
   * the plan's timeline only while `keepTimeline` finds an approval of the plan as the starter of the record that wrote
   * that timeline last; after another write, such as the user's edit, it creates the next free timeline.
   * @param context - the running `story.approve` call.
   * @returns the report: the plan, the approved version, the timeline, and the records written (renders, then layout).
   * @throws ProjectError `invalid_params` naming an unknown plan or version.
   */
  private async approve(context: OperationContext): Promise<Record<string, unknown>> {
    const approve = context.record
    /* v8 ignore next -- story.approve is not read-only, so it always runs with a record. */
    if (approve === null) throw new Error('story.approve runs only with a record.')
    const { state, project } = context
    const params = storyParams(context.params)
    const { version, steps } = this.walk(state, params)
    const origin = { actor: 'system' as const, surface: approve.surface, session: approve.session, turn: approve.turn, tool_call: null }
    const name = `plan ${params.plan} v${String(version.version)}`
    const intent = (slot: number): string => `shot ${String(slot)} of ${name}`
    const { takes, scheduled } = await scheduleShots(this.ctx.dvShotRender, steps, { ...origin, project, approve: approve.id, intent })
    const linked = state.components.story.timelines[brandString<PlanId>(params.plan)] ?? null
    const layout = await this.ctx.dvTimeline.layout({
      ...origin, intent: `timeline of ${name}`, project, timeline: keepTimeline(this.ctx.dvTimeline, state, linked, ownsPlan(params.plan)),
      clips: takes.map(record => ({ record, output: 0 })), started_by: { record: approve.id, slot: null },
    })
    return { plan: params.plan, version: version.version, timeline: layout.timeline, scheduled: [...scheduled, layout.record] }
  }

  /**
   * The `story.preview` operation.
   * @returns the operation.
   */
  private previewOperation(): OperationSpec {
    return {
      name: 'story.preview',
      component: 'story',
      version: '1',
      label: { zh: '预览分镜计划', en: 'Preview plan' },
      description: 'Preview what approving a plan version renders, without rendering: shots has one line per shot (a new or changed '
        + 'shot renders; an unchanged shot keeps its take), rendered counts the shots that render, '
        + 'and problems lists why a render would be refused. Show the lines to the user. When problems is not empty, '
        + 'update the plan with dv_plan_update and preview again.',
      inputs: {},
      params: storyParamsSchema('preview'),
      outputs: [],
      deterministic: false,
      resource: 'none',
      confirm: 'never',
      readOnly: true,
      summarize: () => 'story preview',
      execute: async (context): Promise<OperationResult> => {
        const params = storyParams(context.params)
        const preview = this.previewLines(context.state, params)
        const problems = await this.problems(context.state, params)
        return { outputs: [], report: { plan: params.plan, ...preview, problems } }
      },
    }
  }

  /**
   * The `story.approve` operation. The agent needs the user's agreement (`confirm: 'always'`), and any caller is refused
   * before a record while `problems` lists a reason.
   * @returns the operation.
   */
  private approveOperation(): OperationSpec {
    return {
      name: APPROVE,
      component: 'story',
      version: '1',
      label: { zh: '批准分镜计划', en: 'Approve plan' },
      description: 'Record the user\'s approval of a plan version and render its new or changed shots in order, each with the shot\'s '
        + 'model; unchanged shots keep their takes, and the plan\'s timeline gets every shot. Call it only after you showed the '
        + 'dv_story_preview lines and the user agreed in the conversation. The renders run in the background; a DreamVerse project '
        + 'update reports each one when it finishes.',
      inputs: {},
      params: storyParamsSchema('approve'),
      outputs: [],
      deterministic: false,
      resource: 'none',
      confirm: 'always',
      confirmSummary: call => this.confirmText(call.state, storyParams(call.request.params)),
      summarize: (record) => {
        const version = record.report?.['version'] ?? record.params['version']
        return `plan ${String(record.params['plan'])}${typeof version === 'number' ? ` v${String(version)}` : ''} approved`
      },
      // The agent is refused before Project asks it for the user's agreement; every other caller is refused by the runner.
      prepareToolCall: call => this.refuse(call.state, storyParams(call.request.params)),
      precondition: (request, state) => this.refuse(state, storyParams(request.params)),
      execute: async (context): Promise<OperationResult> => ({ outputs: [], report: await this.approve(context) }),
    }
  }
}
