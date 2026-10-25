/**
 * Creator-facing names of the agent tools: the name of an operation from its declaration on the wire, and the names of
 * the project, asset and model catalog tools, whose packages declare no label. The chat (`@dv/ui-composer`) and the
 * History panel (`@dv/ui-history`) show them in place of wire tool names. Also the name of a generation task from the
 * model catalog's labels (`GET /api/dv/tasks`), which the canvas editors and the chat's render card show.
 *
 * @module @dv/ui-kit/tool-labels
 */
import type { WireOperation } from './types.ts'

/** Wire tool name → [Chinese, English] name, for the `dv_proj_*`, `dv_asset_*` and `dv_models_*` tools only. */
export const DV_TOOL_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  dv_proj_create: ['新建项目', 'Create project'],
  dv_proj_open: ['打开项目', 'Open project'],
  dv_proj_rename: ['重命名项目', 'Rename project'],
  dv_proj_state: ['查看项目', 'Get project state'],
  dv_proj_undo: ['撤销', 'Undo'],
  dv_proj_redo: ['重做', 'Redo'],
  dv_proj_stale_accept: ['仍然保留', 'Keep anyway'],
  dv_proj_history_list: ['查看历史', 'List history'],
  dv_proj_wait: ['等待记录完成', 'Wait for records'],
  dv_asset_import: ['导入素材', 'Import asset'],
  dv_asset_place: ['放到画布', 'Put on canvas'],
  dv_asset_unplace: ['从画布移除', 'Remove from canvas'],
  dv_models_list: ['列出模型', 'List models'],
  dv_models_get: ['查看模型', 'Get model'],
  dv_asset_grab_still: ['截取静帧', 'Grab still'],
}

/**
 * The agent tool name of an operation, as the kernel names it: `dv_` and the operation name with `.` replaced by `_`.
 * @param operation - the operation name, such as `timeline.clip_move`.
 * @returns the tool name, such as `dv_timeline_clip_move`.
 */
export function toolNameOf(operation: string): string {
  return `dv_${operation.replaceAll('.', '_')}`
}

/**
 * The creator-facing name of an operation: its `label` in `/api/dv/operations`, else the `DV_TOOL_LABELS` entry of its
 * tool, else the operation name.
 * @param operation - the operation name, or null when a record names none.
 * @param operations - the operation declarations of `/api/dv/operations`.
 * @returns the Chinese and English name; two empty texts for null.
 */
export function operationLabel(operation: string | null, operations: readonly WireOperation[]): readonly [zh: string, en: string] {
  if (operation === null) return ['', '']
  const label = operations.find(declared => declared.name === operation)?.label
  if (label !== undefined) return [label.zh, label.en]
  return DV_TOOL_LABELS[toolNameOf(operation)] ?? [operation, operation]
}

/** The label of each generation task that the model catalog serves at `GET /api/dv/tasks`, by task name. */
export type WireTaskLabels = Readonly<Record<string, { zh: string; en: string }>>

/**
 * The creator-facing name of a generation task: its label in the model catalog, else the task name.
 * @param task - the task name, such as `ref2v`.
 * @param labels - the task labels of `GET /api/dv/tasks`.
 * @returns the Chinese and English name.
 */
export function taskLabel(task: string, labels: WireTaskLabels): readonly [zh: string, en: string] {
  const label = labels[task]
  return label === undefined ? [task, task] : [label.zh, label.en]
}
