# Project

English | [中文](project.zh.md)

This page is the reference for `@dv/project`, the registry of the DreamVerse packages: the operation record, the history rules, how an operation runs, confirmation in the conversation, project state, staleness, and deterministic reuse.

## The operation record

Every change to a project is one record in the project's `records.jsonl` file, which only `@dv/project` reads and writes. Every record has `kind: 'operation'`: it is one call of one operation. A record holds who (`actor`: `user`, `agent`, or `system`), where the call came from (`surface`: `chat`, `canvas`, `timeline`, `asset_pool`, `history`, or `api`), why (`intent`: the agent's `reason` argument or a short description of the human's gesture), the owning `component` and the `operation` with its version, the params, the inputs with the asset each resolved to (`resolved_asset`), the outputs, the status, the parent record, and two links: `based_on` (this record repeats that record with changes, such as a new take with an edited prompt) and `supersedes` (this record replaces those records' outputs). The fields `session`, `turn`, and `tool_call` link a record to the DSH session log of the chat session that made it: the chat session ID, the DSH turn number of that session, and the tool call ID; the conversation itself stays in the session log. Records are appended, never rewritten; a status change, the cost, and the report are appended as an update line. The parent of each record is the project's current position when the record is written ([history rules](#history-rules)). Project's own actions are records too (`proj.create`, `proj.stale_accept`), while undo, redo, a move to a step, and reads such as `dv_proj_state`, `dv_proj_history_list`, and the `inspect.*` operations write no record.

<a id="history-rules"></a>
## History rules

These rules tell which changes are steps. They also tell what undo, redo, and "go back to a step" do. The rules apply to the user, the agent, and the system. The model is the same as the History panel of an image editor.

1. **A change to the project content is a step.**
   - The project content is the assets, the assets on the canvas, the characters, locations and styles, the plans, the renders, the timelines, and the exports.
   - The steps of the user and the steps of the agent are in one history list, in the sequence of time.
   - A change to the view is not a step. The view is the pan, the zoom, the node positions, the selection, the shown view, and the open panels.
   - A change to the project name is not a step. The deletion of a project is not a step.
2. **Undo, redo, and "go back to a step" move the current position.**
   - The current position is one step of the history list. The project shows its state at that step.
   - Undo moves the current position back one step. Ctrl+Z, the undo button, and `dv_proj_undo` do an undo.
   - Redo moves the current position forward one step. Shift+Ctrl+Z, the redo button, and `dv_proj_redo` do a redo.
   - "Go back to a step" moves the current position to the step that you select. 回到这一步 in the ⋮ menu of a History row does this. `dv_proj_undo` with `to` also does this.
   - These moves do not add a step to the history list.
3. **A new step after the current position discards the later steps.**
   - If the current position is not the last step, the History panel shows the later steps in gray.
   - If you or the agent make a new step at that time, the history list discards the later steps.
   - You cannot get a discarded step back.
   - If a discarded step is not complete, the system cancels it. For example, a render stops.
4. **An imported asset stays; a generated asset follows the current position.**
   - An imported asset is an asset that a step imports. An imported asset stays in the asset pool, also when its step is discarded.
   - A generated asset is an asset that a step makes, for example a render, a still, or an export. A generated asset shows in the asset pool only when its step is at or before the current position.
   - The files of all assets stay on the disk.

`@dv/project` implements these rules. Each project has a `line.json` file with `{tip, at}`: `tip` is the last step, and the history list is the `parents[0]` ancestry of `tip`; `at` is the current position. Undo, redo, and a move to a step change `at` and write no record. A write appends its record after `at` and sets both `tip` and `at` to it, so the steps that were after `at` leave the history list; their lines stay in `records.jsonl`. The runner cancels each of those steps that has not finished, with `error.code: 'discarded'`. `dvProject.undo` refuses a move back from the first record (`nothing_to_undo`) and a move to a discarded record (`invalid_params`); `dvProject.redo` refuses a move from the last step (`nothing_to_redo`).

## How an operation runs

The views and the agent reach the same operations. A gesture on the canvas, the timeline, the asset pool panel, or the History panel runs an operation through the routes of `@dv/api` with `actor: 'user'` and `surface` set to that view. The agent calls the operation's `dv_*` tool, which runs it with `actor: 'agent'`, `surface: 'chat'`, the chat session, the turn, and the tool call ID. Before an agent call runs, the operation's `prepareToolCall` may refuse or change it, and Project applies the operation's `confirm` policy. Every call goes through the runner of `dvProject.run`. The runner validates the params; then, under the project lock, it resolves each input to an asset and calls the operation's `precondition`, which refuses a call for every caller before any record is written (`shot.render` and `story.approve` refuse a render request that the model's catalog entry refuses, such as a `fasth3` render for task `ref2v` without a reference). The runner then appends the `pending` record and adds to its `supersedes` the records that the operation's own `supersedes` names. Finally the runner runs the owning component's implementation outside the lock and appends the final update with the outputs, the cost, and the report. A call whose input names an unfinished record, and each render that a plan approval schedules, waits in Project's scheduler until its inputs are done.

<a id="confirmation-in-the-conversation"></a>
## Confirmation in the conversation

The agent asks the user for agreement in the conversation, and the question is in bold. `OperationSpec.confirm` declares when an agent call needs that agreement:

| `confirm`         | Tool-only argument | An agent call is refused when                                                                               | Operations            |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------- |
| `never`           | —                  | never                                                                                                       | every other operation |
| `always`          | `user_approved`    | it lacks `user_approved: true`                                                                              | `story.approve`       |
| `over_gpu_budget` | `user_requested`   | it lacks `user_requested: true` and the turn's GPU seconds pass `confirmGpuSecondsThreshold` of `dvProject` | `shot.render`         |

The turn's GPU seconds are the cost of the turn's finished records, the `estimate` of its unfinished records, and the GPU estimate of this call. An operation with `confirm` other than `never` provides `confirmSummary(call, state)`, which returns `{text, gpu_seconds}`: what the call will do (for `story.approve`, one line per shot with its model key (`modality/task/provider/model`), duration, whether it continues the previous shot, and its prompt) and its GPU estimate. The refusal is a tool error that carries this text and tells the agent to show it, ask the user in the conversation with the question in bold, and call again with the argument after the user agreed. Nothing is written for a refused call, the argument never reaches the record's params, and calls by the human or the system are never refused.

## Project state

A reducer reads records and computes state; it writes no record. The runner and the record store are the only writers. The current state is the result of folding the chain that ends at the current position through the reducers: Project walks back from that record by `parents[0]` and passes the records, oldest first, through every registered reducer. Each component's reducer turns its records into its slice of `ProjectState.components` (Character `character`, Location `location`, Style `style`, Shot plan `plan`, Timeline `timeline`, Story workflow `story`), and Project's own reducer keeps the `proj` slice: the records of that chain, the stale and superseded records, and the record that created each asset. A reducer's `agentSummary` adds that component's fields to the project summary that the `dv_proj_*` tools and the `dv:project` prompt section give the agent.

The views show either records or state. The History panel lists records: the steps of the history list, newest first; discarded records do not show. The canvas, the timeline editor, and the asset pool panel show state: the current state, so an undo, a redo, or a move to a step changes what they draw. The asset pool panel lists every asset of the current state and every imported asset of the project, discarded steps included ([history rules](#history-rules), rule 4). No view holds project state: each fetches the current state and fetches it again on every event of the live stream.

## Staleness

Project's reducer marks records stale; it reruns nothing. When a record lists a record X in `supersedes`, every record that read an output of X, and every record downstream of such a record, becomes stale; a later record that reads an input whose producer is superseded or stale is stale too. The producer of an input is the record that created its asset or, for a character, location, or style version, the record that wrote that version. The owning operation decides what a call supersedes through `OperationSpec.supersedes`: `character.update`, `location.update`, and `style.update` supersede the record that created the previous version, so every record that read the previous version is stale. A caller can also name records in `supersedes`, as the agent does for a retake that replaces a shot. A stale record is rerun only when the agent or the human decides; `proj.stale_accept` clears the mark of one record and keeps its consumers from becoming stale through it.

## Deterministic reuse

When an operation with `deterministic: true` is called with the same operation and version, equal params, and the same resolved input assets as an earlier `done` record, the runner reuses that record's outputs instead of running the operation; the call is still recorded, with `cost.reused: true`. Renders are not deterministic: rendering a shot again gives a new take, a `shot.render` record whose `based_on` names the earlier render, whichever model and task each take used.
