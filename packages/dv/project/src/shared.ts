/**
 * Values that every module of the Project service uses: the error classes.
 *
 * @module @dv/project/shared
 */

/** Why a Project call was refused. The record store, the runner and history throw these codes. */
export type ProjectErrorCode =
  | 'unknown_project'
  | 'unknown_record'
  | 'unknown_operation'
  | 'unknown_asset'
  | 'invalid_params'
  | 'invalid_inputs'
  | 'input_not_ready'
  | 'component_exists'
  | 'operation_exists'
  | 'reducer_exists'
  | 'parent_not_head'
  | 'status_backwards'
  | 'record_finished'
  | 'nothing_to_undo'
  | 'nothing_to_redo'

/** A Project call was refused before it changed anything; `code` says why. */
export class ProjectError extends Error {
  /**
   * @param code - why the call was refused.
   * @param message - the explanation, in words a creator can read.
   */
  constructor(readonly code: ProjectErrorCode, message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}
