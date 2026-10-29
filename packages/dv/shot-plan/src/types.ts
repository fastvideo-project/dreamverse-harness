/**
 * Types of the Shot plan component: the plan versions that `plan.create` and `plan.update` records store, their shots,
 * and the `plan` state slice. A plan is identified by its `PlanId` (`p1`, `p2`, …), a version by its 1-based number,
 * and a shot by its 1-based position in the version.
 *
 * @module @dv/shot-plan/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RecordId } from '@dv/project/types'

/**
 * The ID of a plan, such as `p2`: unique within the project and never reused; `plan.create` assigns it and stores it in
 * the record's `report.plan`, and `plan.update` names the plan by it in its `plan` param.
 */
export type PlanId = Branded<'DvPlanId'>

/** One shot of a plan, in the snake_case of tool params. */
export interface Shot {
  /** The complete prompt of the shot. */
  prompt: string
  /** Seconds; the render uses the model minimum when absent. */
  duration_sec?: number
  /**
   * Versions of registered reference kinds (`<id>@<n>`) or asset IDs this shot uses instead of the plan's references; only
   * for task `ref2v`.
   */
  references?: string[]
  seed?: number
  /** The model's own parameters for this shot, as `dv_models_get` lists them; the render passes them as its `extra`. */
  extra?: Record<string, unknown>
  /** The modality of the model that renders the shot; with `task`, `provider` and `model`, its key in the model catalog. */
  modality: string
  /** The generation task the model renders the shot in, such as `ref2v`. */
  task: string
  /** The provider that serves the model. */
  provider: string
  /** The provider's name for the model. */
  model: string
  /**
   * The shot starts from the previous shot's last still (its `first_frame` input); task `ref2v` only, never on shot 1.
   */
  continue_previous?: boolean
}

/** The shots and settings of one plan version, which a workflow plugin turns into shot renders. */
export interface Plan {
  title?: string
  /** References every shot of task `ref2v` carries unless it names its own: `<id>@<version>` or asset IDs. */
  references?: string[]
  aspect_ratio?: string
  resolution?: string
  seed?: number
  shots: Shot[]
}

/** One version of a plan: `plan.create` writes version 1, each `plan.update` the next number. */
export interface PlanVersion extends Plan {
  /** 1-based. */
  version: number
  /** The `plan.create` or `plan.update` record that wrote the version. */
  created_by: RecordId
}

/**
 * One shot of a plan version as `dvShotPlan.shots` resolves it, so every workflow reads a plan the same way: the shot
 * with the plan-level values and the references that apply to it.
 */
export interface ResolvedShot {
  /** 1-based position in the version. */
  slot: number
  /** The shot as written in the plan. */
  shot: Shot
  /** The plan's aspect ratio, when the version sets one. */
  aspect_ratio?: string
  /** The plan's resolution, when the version sets one. */
  resolution?: string
  /** The shot's own seed, else the plan's, when either is set. */
  seed?: number
  /** The shot's own `extra`, when it sets one. */
  extra?: Record<string, unknown>
  /** The shot's own references, else the plan's; empty when its task takes no references (only task `ref2v` does). */
  references: string[]
  /** `continue_previous` on a shot after slot 1 whose task takes a first frame (only task `ref2v` does). */
  continuePrevious: boolean
}

/** The `plan` slice: the versions of every plan in the state, oldest first. */
export interface PlanState {
  plans: Record<PlanId, PlanVersion[]>
}

declare module '@dv/project/types' {
  interface ComponentStates {
    /** Plans and their versions (the Shot plan component's reducer). */
    plan: PlanState
  }
}
