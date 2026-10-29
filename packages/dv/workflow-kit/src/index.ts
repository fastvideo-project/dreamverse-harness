/**
 * The shot walk of DreamVerse workflows: a library that turns the shots of a version into reused takes and scheduled
 * renders, so every workflow that renders a list of shots walks them the same way. It has no component, no service and
 * no operation, and it names no workflow. A workflow calls it from its own operations, passes the generation service
 * that renders the shots, and tells by an `Owns` test which starter records (its approvals) are its own.
 * - `walkShot` maps a resolved plan shot to render params. `planShots` parses each shot's references and picks the take
 *   it reuses, `checkShots` collects the refusals of the shots that render, and `shotLine` writes one preview line.
 *   None of them writes, so a preview, a refusal check and an approval share them.
 * - `scheduleShots` schedules one render per shot that reuses no take, each after the render scheduled before it.
 * - `chainOf` and `chainStarter` read the record that started a record. `takeFilter` and `keepTimeline` test that
 *   starter with the workflow's `Owns`, so take reuse and timeline reuse never read a workflow slice.
 *
 * @module @dv/workflow-kit
 */
import type { GenerationApi, GenerationCall } from '@dv/generation'
import { formatModelKey, modelKey } from '@dv/models'
import type { ProjectId, ProjectRecord, ProjectState, RecordId, RecordOrigin, RunRequest, StartedBy } from '@dv/project'
import type { ResolvedShot, Shot } from '@dv/shot-plan'
import type DvTimeline from '@dv/timeline'
import type { TimelineId } from '@dv/timeline'

/** One shot to walk. */
export interface WalkShot {
  /** The shot's position; its render carries it as `started_by.slot`. */
  slot: number
  /** The render params. */
  params: Record<string, unknown>
  /** Reference texts, parsed as input role `reference`. */
  references: string[]
  /** Whether the shot starts from the last still of the previous shot's take. */
  continuePrevious: boolean
}

/** One shot after `planShots`: its parsed inputs and the take it reuses. */
export interface WalkStep {
  slot: number
  params: Record<string, unknown>
  /** Parsed references; `scheduleShots` adds `first_frame`. */
  inputs: RunRequest['inputs']
  continuePrevious: boolean
  /** The take it reuses, or null when it renders. */
  reuse: RecordId | null
}

/** Whether a starter record (an approval) belongs to the caller, such as "a story.approve of plan p1". */
export type Owns = (starter: ProjectRecord) => boolean

/** How many characters of a shot's prompt a preview line shows. */
const PROMPT_PREVIEW = 80

/** The input that starts a shot from the last still (output 1) of a take. */
function firstFrameOf(take: RecordId): RunRequest['inputs'][number] {
  return { role: 'first_frame', ref: { record: take, output: 1 } }
}

/**
 * The chain of a record: its own `started_by`, else the `started_by` of its `based_on` root (the oldest record of its
 * `based_on` line in the state), else null. So a retake of a workflow's take stays in that workflow's chain.
 * @param state - the state that holds the record's `based_on` line.
 * @param record - the record.
 * @returns the starting record, slot and lane, or null for a record that no record started.
 */
export function chainOf(state: ProjectState, record: ProjectRecord): StartedBy | null {
  if (record.started_by !== undefined) return record.started_by
  const records = state.components.proj.records
  let root = record
  // One step per record at most, so a based_on line that loops still ends.
  for (let step = 0; step < records.length; step++) {
    const base = root.based_on
    const found = base === null ? undefined : records.find(candidate => candidate.id === base)
    if (found === undefined) break
    root = found
  }
  return root.started_by ?? null
}

/**
 * The starter record of a record's chain: the record that `chainOf` names, looked up in the state's log.
 * @param state - the state whose log holds the records.
 * @param record - the record.
 * @returns the starter, or null when the record has no chain or the log does not hold its starter.
 */
export function chainStarter(state: ProjectState, record: ProjectRecord): ProjectRecord | null {
  const chain = chainOf(state, record)
  return chain === null ? null : state.components.proj.records.find(candidate => candidate.id === chain.record) ?? null
}

/**
 * A `where` filter for `findTake`: it accepts a record whose chain starter is in the log and belongs to the caller.
 * A free take and a take of another workflow or plan are never candidates.
 * @param state - the state whose log holds the starters.
 * @param owns - the caller's test of a starter.
 * @returns the filter.
 */
export function takeFilter(state: ProjectState, owns: Owns): (record: ProjectRecord) => boolean {
  return (record) => {
    const starter = chainStarter(state, record)
    return starter !== null && owns(starter)
  }
}

/**
 * The timeline a workflow lays its takes on again: the linked timeline while the newest record that set its clips
 * (`dvTimeline.lastWrite`) has a chain starter that the caller owns. After another write, such as the user's own edit,
 * the timeline is no longer the caller's, and the caller creates a new one.
 * @param timeline - the timeline service.
 * @param state - the state the layout would run on.
 * @param linked - the timeline that the caller linked to the plan, or null.
 * @param owns - the caller's test of a starter.
 * @returns the linked timeline, or null when the caller lays out a new timeline.
 */
export function keepTimeline(timeline: Pick<DvTimeline, 'lastWrite'>, state: ProjectState,
  linked: TimelineId | null, owns: Owns): TimelineId | null {
  if (linked === null) return null
  const last = timeline.lastWrite(state, linked)
  const starter = last === null ? null : chainStarter(state, last)
  return starter !== null && owns(starter) ? linked : null
}

/**
 * Map one resolved shot to its render params: the model key, the prompt, and the duration, aspect ratio, resolution,
 * seed and `extra` that apply to it. The overrides win, such as the aspect ratio of an ad variant.
 * @param resolved - the shot as `dvShotPlan.shots` resolves it.
 * @param overrides - params that replace the resolved values.
 * @returns the shot to walk, with the slot, the references and the continuation of the resolved shot.
 */
export function walkShot(resolved: ResolvedShot, overrides: Record<string, unknown> = {}): WalkShot {
  const { shot, aspect_ratio: aspectRatio, resolution, seed, extra } = resolved
  const optional = { duration_sec: shot.duration_sec, aspect_ratio: aspectRatio, resolution, seed, extra }
  const params = {
    modality: shot.modality, task: shot.task, provider: shot.provider, model: shot.model, prompt: shot.prompt,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)), ...overrides,
  }
  return { slot: resolved.slot, params, references: resolved.references, continuePrevious: resolved.continuePrevious }
}

/**
 * Parse the inputs of each shot and pick the take it reuses. A shot reuses the take that `render.findTake` finds for
 * its params and reference inputs among the records that `where` accepts. A continuing shot matches only with the
 * previous shot's reused take as its `first_frame`, so a continuing shot after a rendered shot never reuses. A
 * continuing first shot has no previous take and matches plainly, as `scheduleShots` renders it without one.
 * @param render - the generation service of the shots.
 * @param state - the state the walk reads.
 * @param shots - the shots, in order.
 * @param where - the records that may be reused, such as `takeFilter(state, owns)`.
 * @returns one step per shot, in order.
 * @throws the error of `render.parseInputs` for a reference it cannot parse.
 */
export function planShots(render: Pick<GenerationApi, 'findTake' | 'parseInputs'>, state: ProjectState,
  shots: readonly WalkShot[], where: (record: ProjectRecord) => boolean): WalkStep[] {
  const steps: WalkStep[] = []
  for (const shot of shots) {
    const inputs = shot.references.length === 0 ? [] : render.parseInputs({ reference: shot.references }, state)
    const previous = steps.at(-1)
    // The take a continuing shot starts from: null after a rendered shot, whose take does not exist yet.
    const start = shot.continuePrevious && previous !== undefined ? previous.reuse : undefined
    const matched = start === undefined || start === null ? inputs : [...inputs, firstFrameOf(start)]
    const reuse = start === null ? null : render.findTake(state, { params: shot.params, inputs: matched }, where)
    steps.push({ slot: shot.slot, params: shot.params, inputs, continuePrevious: shot.continuePrevious, reuse })
  }
  return steps
}

/**
 * Check every step that renders with `render.check`, so a workflow can refuse a plan before it writes. A continuing
 * step after a reused step is checked with that take's last still as `first_frame`. After a step that renders, it is
 * checked with the role `first_frame` chained, because its producer is scheduled before it. Every other step is checked
 * plainly.
 * @param render - the generation service of the shots.
 * @param state - the state the renders would run on.
 * @param steps - the steps of `planShots`, in order.
 * @returns one entry per reason, in step order; empty when every render would run.
 */
export async function checkShots(render: Pick<GenerationApi, 'check'>, state: ProjectState,
  steps: readonly WalkStep[]): Promise<Array<{ slot: number; reason: string }>> {
  const problems: Array<{ slot: number; reason: string }> = []
  for (const [index, step] of steps.entries()) {
    if (step.reuse !== null) continue
    const previous = steps[index - 1]
    // The previous take: a record ID when it is reused, null when it renders, undefined when the step does not continue.
    const kept = step.continuePrevious && previous !== undefined ? previous.reuse : undefined
    const inputs = kept === undefined || kept === null ? step.inputs : [...step.inputs, firstFrameOf(kept)]
    const call: Pick<GenerationCall, 'project' | 'params' | 'inputs'> = { project: state.project.id, params: step.params, inputs }
    const reasons = await render.check(call, state, kept === null ? ['first_frame'] : [])
    problems.push(...reasons.map(reason => ({ slot: step.slot, reason })))
  }
  return problems
}

/**
 * The preview line of one step: `shot <slot>: keeps its take` for a reused take, else the shot's model key, its
 * duration, whether it continues the previous shot, and the start of its prompt.
 * @param step - the step of `planShots`.
 * @param shot - the shot as the plan writes it.
 * @returns the line.
 */
export function shotLine(step: WalkStep, shot: Shot): string {
  if (step.reuse !== null) return `shot ${String(step.slot)}: keeps its take`
  const duration = shot.duration_sec === undefined ? '' : `, ${String(shot.duration_sec)} s`
  const continues = step.continuePrevious ? ', continues from the previous shot' : ''
  const prompt = shot.prompt.length > PROMPT_PREVIEW ? `${shot.prompt.slice(0, PROMPT_PREVIEW)}…` : shot.prompt
  return `shot ${String(step.slot)} (${formatModelKey(modelKey({ ...shot }))}${duration}${continues}): ${prompt}`
}

/**
 * Schedule one render per step that reuses no take, in step order. Each render runs after the render scheduled before
 * it; the first runs after `call.after`, else after no record, so every render is scheduled. A continuing step starts
 * from the last still of the previous step's take. Each render copies the call's origin and project, takes the intent
 * `call.intent(slot)`, and carries `started_by` with `call.approve`, the step's slot and `call.lane`.
 * @param render - the generation service of the shots.
 * @param steps - the steps of `planShots`, in order.
 * @param call - the origin of the renders, the project, the record that starts them, the intent of each slot, the lane
 *   of a parallel sequence (such as an ad variant), and the records the first render waits for.
 * @returns the take of each step in order, and the scheduled renders in order.
 */
export async function scheduleShots(render: Pick<GenerationApi, 'render'>, steps: readonly WalkStep[],
  call: Omit<RecordOrigin, 'intent'> & {
    project: ProjectId
    approve: RecordId
    intent(slot: number): string
    lane?: string
    after?: RecordId[]
  }): Promise<{ takes: RecordId[]; scheduled: RecordId[] }> {
  const { actor, surface, session, turn, tool_call: toolCall, project, lane } = call
  const takes: RecordId[] = []
  const scheduled: RecordId[] = []
  for (const step of steps) {
    if (step.reuse !== null) {
      takes.push(step.reuse)
      continue
    }
    const previousTake = takes.at(-1)
    const inputs = step.continuePrevious && previousTake !== undefined ? [...step.inputs, firstFrameOf(previousTake)] : step.inputs
    const previousRender = scheduled.at(-1)
    const take = await render.render({
      actor, surface, session, turn, tool_call: toolCall, project, intent: call.intent(step.slot), params: step.params, inputs,
      after: previousRender === undefined ? call.after ?? [] : [previousRender],
      started_by: { record: call.approve, slot: step.slot, ...lane === undefined ? {} : { lane } },
    })
    takes.push(take)
    scheduled.push(take)
  }
  return { takes, scheduled }
}
