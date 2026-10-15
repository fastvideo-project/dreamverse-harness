/**
 * Types of the Shot plan component: the plan versions that `plan.create` and `plan.update` records store, their shots,
 * and the `plan` state slice. A plan is identified by its `PlanId` (`p1`, `p2`, …), a version by its 1-based number,
 * and a shot by its 1-based position in the version.
 *
 * @module @dv/shot-plan/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ModalityId, TaskId } from '@dv/models'
import type { RecordId } from '@dv/project'

/**
 * The ID of a plan, such as `p2`: unique within the project and never reused; `plan.create` assigns it and stores it in
 * the record's `report.plan`, and `plan.update` and `plan.approve` name the plan by it in their `plan` param.
 */
export type PlanId = Branded<'DvPlanId'>

/** One shot of a plan, in the snake_case of tool params. */
export interface Shot {
  /** The complete prompt of the shot; in task `ref2v` it cites the shot's reference assets (`@[<label>](dv:asset/<AssetId>)`). */
  prompt: string
  /** Seconds; the render uses the model minimum when absent. */
  duration_sec?: number
  seed?: number
  /** The modality of the model that renders the shot; with `task`, `provider` and `model`, its key in the model catalog. */
  modality: ModalityId
  /** The generation task the model renders the shot in, such as `ref2v`. */
  task: TaskId
  /** The provider that serves the model. */
  provider: string
  /** The provider's name for the model. */
  model: string
  /**
   * The shot starts from the previous shot's last still (its `first_frame` input); task `ref2v` only, never on shot 1.
   */
  continue_previous?: boolean
}

/** The shots and settings of one plan version, which `plan.approve` turns into shot renders. */
export interface Plan {
  title?: string
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
  /** The latest finished `plan.approve` record of the version, or null while it waits for approval. */
  approved_by: RecordId | null
}

/** The `plan` slice: the versions of every plan in the state, oldest first. */
export interface PlanState {
  plans: Record<PlanId, PlanVersion[]>
}

declare module '@dv/project' {
  interface ComponentStates {
    /** Plans and their approvals (the Shot plan component's reducer). */
    plan: PlanState
  }
}
