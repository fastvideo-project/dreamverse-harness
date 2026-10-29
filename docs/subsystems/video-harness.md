# DreamVerse packages

English | [中文](video-harness.zh.md)

The DreamVerse packages are the project layer for video production inside DeepSeek Harness. This page owns the vocabulary and the cross-package rules of these packages under `packages/dv/` and of the [`packages/video-harness/`](../../packages/video-harness/README.md) group: the layers and their roles, the model catalog, the operation record, the [history rules](#history-rules), how views and the agent write, project state, what the agent reads, staleness, [where new behavior goes](#where-new-behavior-goes), and the [glossary](#glossary) of the names that code, records, tools, and interface copy use. Each package README owns its configuration and service API.

## Layers and roles

```text
views          @dv/ui-shell @dv/ui-canvas @dv/ui-timeline @dv/ui-asset-pool @dv/ui-composer @dv/ui-history @dv/ui-media (+ libraries @dv/ui-kit @dv/ui-reference-kit @dv/ui-generation)
               @dv/ui-character @dv/ui-location @dv/ui-style @dv/ui-shot-render
  │ HTTP: /api/dv/…, /dv/events
  ▼
API            @dv/api                    routes that read state and run operations as the user; the event stream
  │ dvProject.run, getState, listHistory
  ▼
registry       @dv/project                records, the history list, undo and redo, state, agent tools, the dv:project rules section, the project messages
  ▲ registerOperation, registerReducer             ▲ dvProject.run (asset.import, asset.place), current-state reads
  │ from components                                │
workflows      @dv/workflow-story                  │
  │ the tools dv_shot_render, dv_timeline_create   │
  ▼                                                │
components     @dv/asset-pool @dv/character       chat references   @dv/chat-references   dv: mentions, chat images
               @dv/location @dv/style
               @dv/shot-render @dv/image-generate
               @dv/timeline @dv/inspector
               @dv/audio-generate
  │ defineGeneration, defineReference
  ▼
base libraries @dv/generation @dv/reference-kit
  │ ctx.dvModels (Consumers: @dv/shot-render, @dv/image-generate, @dv/audio-generate)
  ▼
models         @dv/models                 the model catalog dvModels, dv_models_list, dv_models_get, video-model-selection
  ▲ register one entry per task a model serves
  │
providers      @dv/fastvideo              provider fastvideo: fasth3 for tasks ref2v and t2v, a prompt skill per task
               @dv/uniserve               provider uniserve: fasth3 for task ref2v, with its own prompt skill
               @dv/sglang-diffusion       provider sglang-diffusion: qwen-image-2.1-turbo for task t2i
               @dv/sglang-omni            provider sglang-omni: fish-audio-drama-3 for task t2a, a prompt skill

bundle         @dv/bundle                 the cordis.patch.yml rows of every package above, the video-directing skill
```

Each arrow points from a package to the package it depends on, and no dependency points the other way. A component never names another component's operation. A workflow reaches components only through their tools, such as `dv_shot_render` and `dv_timeline_create`, and only the surfaces `@dv/api` and `@dv/chat-references` run the operations of other packages by name, as the user. In DeepSeek Harness terms, the layers have these roles:

| Layer           | Packages                                                                                                                                                                                                                                                                                                   | Role                                                                                                                                                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| registry        | [`@dv/project`](../../packages/dv/project/README.md)                                                                                                                                                                                                                                                       | The `dvProject` Service: components register operations and reducers with it, as tools register with `ctx.tools`. It is the only writer of project files, turns every operation into a DSH tool, registers the `dv:project` system-prompt section of rules, and appends the project state and update messages to each chat session. |
| workflows       | `@dv/workflow-story`                                                                                                                                                                                                                                                                                       | Production flows as skills, each an order of calls to the components' tools.                                                                                                                                                                                                                                                        |
| components      | `@dv/asset-pool`, `@dv/character`, `@dv/location`, `@dv/style`, `@dv/shot-render`, `@dv/image-generate`, `@dv/audio-generate`, `@dv/timeline`, `@dv/inspector`                                                                                                                                             | Plugins that each own one capability: its data (a state slice and its reducer), its operations, and the text the agent reads about them. External programs come through [`@dv/ffmpeg`](../../packages/dv/ffmpeg/README.md).                                                                                                         |
| base libraries  | `@dv/generation`, `@dv/reference-kit`                                                                                                                                                                                                                                                                      | `defineGeneration` and `defineReference` build the service of a generation primitive or a reference noun.                                                                                                                                                                                                                           |
| models          | [`@dv/models`](../../packages/dv/models/README.md), [`@dv/fastvideo`](../../packages/dv/fastvideo/README.md), [`@dv/uniserve`](../../packages/dv/uniserve/README.md), [`@dv/sglang-diffusion`](../../packages/dv/sglang-diffusion/README.md), [`@dv/sglang-omni`](../../packages/dv/sglang-omni/README.md) | The model catalog: `@dv/models` holds the `dvModels` Service Definition with `PrimitiveTypes` and `TaskMap`, provider plugins such as `@dv/fastvideo` are Service Providers that register the models they serve, and Shot render, Image and Audio are Consumers.                                                                    |
| API             | [`@dv/api`](../../packages/dv/api/README.md)                                                                                                                                                                                                                                                               | Fetch routes on the DSH `connection` service and an event stream on `webServer`; the only way a view reads or changes a project.                                                                                                                                                                                                    |
| chat references | [`@dv/chat-references`](../../packages/dv/chat-references/README.md)                                                                                                                                                                                                                                       | Listeners on `agent/pre-step` and `session/event` that turn what the user points at in a chat message into project IDs and assets.                                                                                                                                                                                                  |
| views           | UI core (`@dv/ui-kit`, `@dv/ui-canvas`, `@dv/ui-history`, `@dv/ui-shell`, `@dv/ui-composer`) and the UI plugins `@dv/ui-<name>`                                                                                                                                                                            | Right-Sidebar tab types and center views of the DSH Web Client; `@dv/ui-kit` is the library they share.                                                                                                                                                                                                                             |
| bundle          | [`@dv/bundle`](../../packages/bundle/dv/README.md)                                                                                                                                                                                                                                                         | The profile layer that composes every row as the `video-harness` and `video-harness-headless` profiles and ships the `video-directing` skill.                                                                                                                                                                                       |

Components register their operations with `dvProject.registerOperation` and their reducers with `dvProject.registerReducer`. Each operation is also the agent tool `dv_<operation name with _>`, whose call becomes one record. The asset pool's `dv_asset_import`, `dv_asset_grab_still`, and `dv_asset_cut_segment` add assets, and `dv_asset_place` and `dv_asset_unplace` put assets on the canvas and take them off; the Character, Location and Style components' `dv_character_*`, `dv_location_*` and `dv_style_*` tools create and update their versions; Shot render's `dv_shot_render` renders one take of a shot with the [model](#model-catalog) the call names, with `duration_sec` a whole number of seconds within that model's range (default: the model's minimum); Audio's `dv_audio_generate` speaks one clip with the model the call names; Timeline's `dv_timeline_*` tools create, update, rename, and delete timelines and insert, move, remove, split, trim, and replace clips without creating files, and its `dv_timeline_export` writes a timeline to one video; and Inspector's `dv_inspect_image` and `dv_inspect_asset` read assets without writing a record. Project's own `dv_proj_*` tools create, open, and rename projects, read the state and the history, undo, accept stale records, and wait for scheduled records. An operation declares a resource class (`none`, `cpu`, `gpu`); Project's scheduler runs scheduled records under one concurrency limit per class.

A clip has a `ClipId` (`cl1`, `cl2`, …) that the Timeline operation inserting it assigns and stores in the record's `report.clips`; the ID is unique within the project, is never reused, and names the clip in the `clip` param of every clip operation.

<a id="model-catalog"></a>
## Model catalog

The model catalog is the `dvModels` service of [`@dv/models`](../../packages/dv/models/README.md), a capability seam whose Service Providers are provider plugins, such as [`@dv/fastvideo`](../../packages/dv/fastvideo/README.md) and [`@dv/sglang-omni`](../../packages/dv/sglang-omni/README.md), and whose Consumers include `@dv/shot-render`, [`@dv/image-generate`](../../packages/dv/image-generate/README.md), and [`@dv/audio-generate`](../../packages/dv/audio-generate/README.md). Each shot, each image, and each audio clip renders with the catalog entry that its `modality`, `task`, `provider`, and `model` name; the [`@dv/models` README](../../packages/dv/models/README.md) defines the keys, the entries, the render request, the agent tools, and the procedures to add a provider, a model, or a server.

The precondition of `shot.render` refuses, for every caller, a model key that is not in the catalog, a missing prompt, params outside the entry's facts, more than one first frame, and a render request that the entry refuses. Each entry's `validateGenerationRequest(request)` owns the model's request rules, such as the accepted media types and counts of the inputs (at least one reference for `fasth3` in task `ref2v`), a first frame that the model does not take, and invalid `extra` values; `shot.render` builds the request, calls it before the record is written and again right before the render, and checks no model rule itself.

## The operation record

Every change to a project is one record in the project's `records.jsonl` file, which only `@dv/project` reads and writes. Every record has `kind: 'operation'`: it is one call of one operation. A record holds who (`actor`: `user`, `agent`, or `system`), where the call came from (`surface`: `chat`, `canvas`, `timeline`, `asset_pool`, `history`, or `api`), why (`intent`: the agent's `reason` argument or a short description of the human's gesture), the owning `component` and the `operation` with its version, the params, the inputs with the asset each resolved to (`resolved_asset`), the outputs, the status, the parent record, and two links: `based_on` (this record repeats that record with changes, such as a new take with an edited prompt) and `supersedes` (this record replaces those records' outputs). The fields `session`, `turn`, and `tool_call` link a record to the DSH session log of the chat session that made it: the chat session ID, the DSH turn number of that session, and the tool call ID; the conversation itself stays in the session log. Records are appended, never rewritten; a status change, the cost, and the report are appended as an update line. The parent of each record is the project's current position when the record is written ([history rules](#history-rules)). Project's own actions are records too (`proj.create`, `proj.stale_accept`), while undo, redo, a move to a step, and reads such as `dv_proj_state`, `dv_proj_history_list`, and the `inspect.*` operations write no record.

<a id="history-rules"></a>
## History rules

These rules tell which changes are steps. They also tell what undo, redo, and "go back to a step" do. The rules apply to the user, the agent, and the system. The model is the same as the History panel of an image editor.

1. **A change to the project content is a step.**
   - The project content is the assets, the assets on the canvas, the characters, locations and styles, the renders, the timelines, and the exports.
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

The views and the agent reach the same operations. A gesture on the canvas, the timeline, the asset pool panel, or the History panel runs an operation through the routes of `@dv/api` with `actor: 'user'` and `surface` set to that view. The agent calls the operation's `dv_*` tool, which runs it with `actor: 'agent'`, `surface: 'chat'`, the chat session, the turn, and the tool call ID. Before an agent call runs, the operation's `prepareToolCall` may refuse or change it. Every call goes through the runner of `dvProject.run`. The runner validates the params; then, under the project lock, it resolves each input to an asset and calls the operation's `precondition`, which refuses a call for every caller before any record is written (`shot.render` refuses a render request that the model's catalog entry refuses, such as a `fasth3` render for task `ref2v` without a reference). The runner then appends the `pending` record and adds to its `supersedes` the records that the operation's own `supersedes` names. Finally the runner runs the owning component's implementation outside the lock and appends the final update with the outputs, the cost, and the report. A call whose input names an unfinished record waits in Project's scheduler until its inputs are done.

## Project state

A reducer reads records and computes state; it writes no record. The runner and the record store are the only writers. The current state is the result of folding the chain that ends at the current position through the reducers: Project walks back from that record by `parents[0]` and passes the records, oldest first, through every registered reducer. Each component's reducer turns its records into its slice of `ProjectState.components` (Character `character`, Location `location`, Style `style`, Timeline `timeline`), and Project's own reducer keeps the `proj` slice: the records of that chain, the stale and superseded records, and the record that created each asset. A reducer's `agentSummary` adds that component's fields to the project summary that the `dv_proj_*` tools and the `dv:project` prompt section give the agent.

The views show either records or state. The History panel lists records: the steps of the history list, newest first; discarded records do not show. The canvas, the timeline editor, and the asset pool panel show state: the current state, so an undo, a redo, or a move to a step changes what they draw. The asset pool panel lists every asset of the current state and every imported asset of the project, discarded steps included ([history rules](#history-rules), rule 4). No view holds project state: each fetches the current state and fetches it again on every event of the live stream.

## What the agent reads

The agent reads a project through three channels, each owned by the package that owns its content:

- **Tools.** Each operation's `description` says how to use its tool; [`@dv/project`](../../packages/dv/project/README.md) builds the tool from the `OperationSpec`.
- **The `dv:project` prompt section.** `@dv/project` registers it while the DSH `systemPrompt` service is mounted. It holds only Project's rules (the conversation's project, every change is a step, undo and redo move the current position, a new change discards the later steps, how to name records, assets, versions, and clips, stale records), so its text is the same at every step. It holds nothing the user cannot see: no selection in a view and no preference.
- **The project state and update messages.** `@dv/project` appends them to each bound chat session at `agent/pre-step`: the project summary of the current state once, then one message per step that lists only the changes the agent's own tool results did not show (records of the user, another chat or the scheduler, finishes, and one line when undo, redo or a move changed the current position). Every model request therefore extends the previous one, and the session log holds each message with the records it showed.
- **Chat references.** [`@dv/chat-references`](../../packages/dv/chat-references/README.md) expands the `dv:` mentions that the composer writes for `@` and `+ → 引用` into one context message with concrete record and asset IDs at `agent/pre-step`, imports the images a user attaches in the chat with `asset.import` as the user, and puts those images and the assets a message mentions on the canvas; the session's next tool call waits for the import.

Skills hold procedures and model-specific rules, each registered by its owner:

| Skill                                                 | Owner                                                                                       | Registered through               | Content                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `video-directing`                                     | [`@dv/bundle`](../../packages/bundle/dv/README.md) (`skills/video-directing`)               | the `skill-filesystem` directory | The planning procedure across components: the story and its shots, a model and inputs per shot, prompts written with the prompt skill of that model and task, retakes and stale shots                                        |
| `timeline-editing`                                    | [`@dv/timeline`](../../packages/dv/timeline/README.md)                                      | `ctx.skills`                     | Editing timelines and clips                                                                                                                                                                                                  |
| `character`                                           | [`@dv/character`](../../packages/dv/character/README.md)                                    | `ctx.skills`                     | Creating and updating characters, with the arguments of each tool                                                                                                                                                            |
| `location`                                            | [`@dv/location`](../../packages/dv/location/README.md)                                      | `ctx.skills`                     | Creating and updating locations, with the arguments of each tool                                                                                                                                                             |
| `style`                                               | [`@dv/style`](../../packages/dv/style/README.md)                                            | `ctx.skills`                     | Creating and updating styles, with the arguments of each tool                                                                                                                                                                |
| Each workflow skill, such as `story-directing`        | [`@dv/workflow-story`](../../packages/dv/workflow-story/README.md) (`skills/<name>`)        | a `FileSystemSkillProvider`      | A production flow, such as the order of calls from a story to a timeline: write the planning stages as text nodes, ask the user, render each shot with `dv_shot_render`, wait, create the timeline with `dv_timeline_create` |
| `video-model-selection`                               | [`@dv/models`](../../packages/dv/models/README.md)                                          | `ctx.skills`                     | Choosing the model of each shot with `dv_models_list` and `dv_models_get`, and when to ask the user                                                                                                                          |
| `fasth3-reference-prompting`, `fasth3-text-prompting` | the provider plugin of the model ([`@dv/fastvideo`](../../packages/dv/fastvideo/README.md)) | `ctx.skills`                     | The model's limits and prompt rules for that task                                                                                                                                                                            |
| `fish-audio-drama-3-prompting`                        | [`@dv/sglang-omni`](../../packages/dv/sglang-omni/README.md)                                | `ctx.skills`                     | The prompt markup of `fish-audio-drama-3` for task `t2a`: speaker tags, sound events, clip length, and voices                                                                                                                |

## The API and the views

[`@dv/api`](../../packages/dv/api/README.md) is the HTTP face of Project for the browser: `/api/dv/state` returns the project's current state as one JSON document, `/api/dv/operations` lists the registered operations, `/api/dv/operation` runs an operation as the user with `surface: 'canvas'`, `'timeline'`, or `'asset_pool'`, `/api/dv/history` returns one page of the history, `/api/dv/undo`, `/api/dv/redo`, and `/api/dv/stale/accept` expose undo, redo, and the stale operation, other routes manage projects, asset imports, canvas layouts (node positions and the viewport), and Workspace links, and `/dv/events` streams every record append, record update, and move of the current position.

The interface packages are right-Sidebar tab types and center views of the web application, so they sit beside the chat page in one profile. [`@dv/ui-shell`](../../packages/dv/ui-shell/README.md) puts the project workspace in the center, the 对话 / Chat and 轨迹 / Trajectory tabs on the right, and the 画布 / Canvas and 时间线 / Timeline toggle in the top bar, and binds Ctrl+Z to undo and Shift+Ctrl+Z to redo. [`@dv/ui-canvas`](../../packages/dv/ui-canvas/README.md) draws the current state as nodes linked by asset flow, and every node comes from a node type that a UI plugin registers through `@dv/ui-canvas/contract`: the assets on the canvas (`@dv/ui-asset-pool`), takes with their model and task (`@dv/ui-shot-render`, declared with `defineGenerationUi` of `@dv/ui-generation`), and characters, locations and styles at their current version (`@dv/ui-character`, `@dv/ui-location`, `@dv/ui-style`, declared with `defineReferenceUi` of `@dv/ui-reference-kit`). `@dv/ui-canvas` marks stale records, and its editor renders a new take or replaces a reference image as a user record. UI plugins also add node actions, such as 问 agent / Ask the agent of `@dv/ui-composer`, which prefills the chat composer, and 从画布移除 / Remove from canvas of `@dv/ui-asset-pool`. [`@dv/ui-timeline`](../../packages/dv/ui-timeline/README.md) draws each timeline as one track and turns insert, move, remove, split, and trim gestures into `timeline.*` records that name clips by `ClipId`, and its export into a `timeline.export` record. `@dv/ui-asset-pool` lists every asset of the project and imports files, `@dv/ui-composer` adds the `@` and `+ → 引用` references and the creator-facing tool names to the chat, and `@dv/ui-shot-render` adds the chat card of `dv_shot_render`. [`@dv/ui-media`](../../packages/dv/ui-media/README.md) draws every asset of these views through its `dv.media` Factory, by the image, video, and audio views that `@dv/ui-asset-pool` registers, and opens the asset preview, whose buttons 插入片段 / Insert clip and 让智能体使用 / Ask the agent to use it come from `@dv/ui-timeline` and `@dv/ui-composer`.

## History and the trajectory

The history is the steps of the project's history list in order, from every actor, view, and chat session; the trajectory is the agent's steps in one chat session. A record links the two through its `session` and `tool_call` fields. [`@dv/ui-history`](../../packages/dv/ui-history/README.md) is the History panel (tab type `dv-history`). It lists the steps of the history list, newest first, as one row each, with the action, who did it (你 / You, 智能体 / Agent, 自动 / Automatic), the status, and, on a media row, a thumbnail; the current position carries 当前 / Current, the steps after it are gray, and the records that a record started fold under its row. UI plugins register the rows of their operations in `dvHistory.rows` (`@dv/ui-history/contract`). A row names the record's subject, its center target, its thumbnail asset, and the label of the records folded under it. History draws the thumbnail and the selected row's output through the `dv.media` Factory of `@dv/ui-media`. Its header holds the undo and redo buttons. Each row's ⋮ menu offers 回到这一步 / Go back to this step, which moves the current position to that row ([history rules](#history-rules)). Selecting a row of a step at or before the current position calls `dvCenter.show` of `@dv/ui-shell` with the row's center target, a `dv.center.view` entry and a target in it, such as the record's clip on the timeline (`{ view: 'timeline', target: { timeline, clip } }`), else the record's node on the canvas (`{ view: 'canvas', target: { record } }`); the row's 在轨迹中查看 / Show in trajectory link sends `dv:trajectory-focus`, and `@dv/ui-shell` opens 轨迹 on that chat session at that tool call. In the chat, every settled row of a tool that writes a record has an 在历史中查看 / Show in history link, which sends `dv:history-focus` so the History panel selects the record that tool call wrote. The chat's media captions name a record by `dvHistory.describe`, the label that History shows for it.

## Staleness

Project's reducer marks records stale; it reruns nothing. When a record lists a record X in `supersedes`, every record that read an output of X, and every record downstream of such a record, becomes stale; a later record that reads an input whose producer is superseded or stale is stale too. The producer of an input is the record that created its asset or, for a character, location, or style version, the record that wrote that version. The owning operation decides what a call supersedes through `OperationSpec.supersedes`: `character.update`, `location.update`, and `style.update` supersede the record that created the previous version, so every record that read the previous version is stale. A caller can also name records in `supersedes`, as the agent does for a retake that replaces a shot. A stale record is rerun only when the agent or the human decides; `proj.stale_accept` clears the mark of one record and keeps its consumers from becoming stale through it.

## Deterministic reuse

When an operation with `deterministic: true` is called with the same operation and version, equal params, and the same resolved input assets as an earlier `done` record, the runner reuses that record's outputs instead of running the operation; the call is still recorded, with `cost.reused: true`. Renders are not deterministic: rendering a shot again gives a new take, a `shot.render` record whose `based_on` names the earlier render, whichever model and task each take used.

<a id="where-new-behavior-goes"></a>
## Where new behavior goes

New DreamVerse behavior attaches to an extension point that a package already owns, as DeepSeek Harness behavior does in the "Where new behavior goes" section of the [architecture page](../architecture.md).

### Principles

1. **Everything has one owner.** Each piece of data, each capability, and each text the agent reads belongs to one plugin, which registers it at an extension point itself.
2. **A plugin says in one sentence what it owns.** A plugin that can only be described as "connects A to B" owns nothing and is split among the owners of A and B.
3. **New behavior attaches to an existing extension point**, chosen from the lookup table below.
4. **Only a swappable capability becomes a capability seam.** A capability with two or more interchangeable implementations gets a Service Definition package and Service Provider packages.
5. **Dependencies point one way:** views → `@dv/api` → `@dv/project` ← components ← workflows; components → base libraries and Service Definition ← Service Provider. No package depends against this direction or names another plugin's operation in code.
6. **Text for the agent goes with its owner**, by this table:

| The text is about                                                                | It goes in                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| How to use one component's tool                                                  | That operation's `description`                                                               |
| A procedure across several components                                            | A skill in `@dv/bundle` or in the workflow that owns the procedure (`story-directing`)       |
| A model's limits and how to write its prompts, such as the reference requirement | The prompt skill that the model's provider plugin registers for the task                     |
| How to choose the model of a shot                                                | The `video-model-selection` skill of `@dv/models`                                            |
| The project state, which changes every turn                                      | The project state and update messages of `@dv/project`, through the reducers' `agentSummary` |

### Procedure

When you add something, answer these questions in order:

1. What kind of thing is it: project data, an operation, a swappable capability, a model, text for the agent, a view, or logic attached to the agent loop?
2. Who owns it? When no package owns it, create a component and write the one sentence that says what it owns.
3. Which extension point does it attach to? Use the lookup table.
4. Must it be swappable? If so, make it a capability seam; if not, it is one registration in an ordinary plugin.
5. Does it carry text for the agent? If so, put the text with its owner by the table in the principles.

Then check that the owner's one sentence still holds, that no plugin name of another package is written into code, and that no dependency points against the direction of principle 5.

### Lookup table

| To add                           | Do this                                                                                                                                                                                                                                                                          | Example                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Project data                     | Add it to the owning component's reducer state and summarize it in `agentSummary`                                                                                                                                                                                                | The music of a shot                               |
| An operation                     | `registerOperation` in the owning component; Project derives the tool, the API route, the history, and undo                                                                                                                                                                      | `timeline.clip_split`                             |
| A swappable capability           | A Service Definition package and Service Provider packages; the component that uses it is the Consumer                                                                                                                                                                           | The model catalog, 3D rendering                   |
| A model                          | A provider plugin change; see [Add a provider or a model](../../packages/dv/models/README.md#add-a-provider-or-a-model)                                                                                                                                                          | `fasth3` of `@dv/fastvideo`                       |
| A generation task                | A `TaskMap` entry that the plugin introducing the task declares ([model keys](../../packages/dv/models/README.md#model-keys)), plus its label in the `tasks` record of its primitive's declaration; a task with input roles that no primitive has gets its own primitive package | A task that renders from a first and a last frame |
| An output modality               | A `PrimitiveTypes` row ([model keys](../../packages/dv/models/README.md#model-keys)), with the tasks that run on it, a primitive package that calls `defineGeneration` of `@dv/generation`, and its UI package that calls `defineGenerationUi` of `@dv/ui-generation`            | Image generation                                  |
| A reference noun                 | Two declarations: `defineReference` of `@dv/reference-kit` and `defineReferenceUi` of `@dv/ui-reference-kit`                                                                                                                                                                     | `@dv/character`                                   |
| A production flow                | One `SKILL.md` in `packages/dv/workflow-story/skills/<name>/` that orders the calls of the components' tools                                                                                                                                                                     | A product ad                                      |
| Text for the agent               | Place it by the text table in the principles                                                                                                                                                                                                                                     | "Show the storyboard before rendering"            |
| A view                           | A `@dv/ui-*` plugin that reads and writes only through `@dv/api` and draws through the registries of `@dv/ui-canvas`, `@dv/ui-history` and `@dv/ui-composer`                                                                                                                     | The canvas                                        |
| Logic attached to the agent loop | The owner of the data registers on a DSH event, such as `agent/pre-step` or `tools/pre-execute`                                                                                                                                                                                  | `dv:` mention expansion                           |

### Example: rendering without reference images

1. Kind: a model for a generation task; the task `t2v` already exists in `TaskMap` of `@dv/models`.
2. Owner: the provider plugin that serves the model; `@dv/fastvideo` serves `fasth3` for task `t2v`.
3. Extension points: `@dv/fastvideo` declares task `t2v` for `fasth3` in its `SERVED` table and registers the entry `video/t2v/fastvideo/fasth3` when its config gives the task a server; `@dv/shot-render` needs no change, because `dv_shot_render` takes every registered entry.
4. Swappable: yes; another provider plugin can register another model for task `t2v`, and the agent chooses between them with `dv_models_list`, `dv_models_get`, and the `video-model-selection` skill.
5. Text: the prompt rules of `fasth3` for task `t2v` are the skill `fasth3-text-prompting` of the provider plugin; "every shot needs a reference" is an input requirement of `fasth3` for task `ref2v` only, which its `schema()` reports and its `validateGenerationRequest` enforces, stated in the skill `fasth3-reference-prompting` and in the refusal of `dv_shot_render`.

<a id="glossary"></a>
## Glossary

Code, record fields, tool descriptions, docs, and interface copy use these names, each with one meaning. The zh / en column is the copy the interface shows.

### Concepts

| Term             | zh / en copy          | Meaning                                                                                                                                                                                                                   |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| component        | 组件 / Component        | A plugin that owns one capability: its implementation, data, operations, reducer, and tools.                                                                                                                              |
| operation        | 操作 / Operation        | An action a component implements that changes a project, or a read it serves.                                                                                                                                             |
| record           | 记录 / Record           | One log entry written by one operation call.                                                                                                                                                                              |
| tool             | 工具 / Tool             | Something the agent can call; a component tool (智能体工具 / agent tool) wraps one operation.                                                                                                                                  |
| reducer          | —                     | A component function that reads records and computes its slice of the project state; it does not write records. The DSH counterpart is a session projection (`ctx.sessionProjections`), which folds the session log.      |
| model            | 模型 / Model            | A video model of one provider, such as `fasth3`; the model catalog (`dvModels`) holds one entry for each task the model serves, keyed by modality, task, provider, and model.                                             |
| task             | 生成方式 / Mode           | What a render produces from which inputs: `ref2v` (参考图生成 / From references: a prompt, reference media, and an optional first frame) or `t2v` (文字生成 / From text: a prompt only). `TaskMap` maps each task to its primitive. |
| modality         | —                     | The kind of output a task produces, such as `video`: the `modality` of a `PrimitiveTypes` row.                                                                                                                            |
| provider plugin  | —                     | A plugin that registers the models of one provider into the model catalog under its provider name, such as `@dv/fastvideo` with provider `fastvideo`.                                                                     |
| capability seam  | —                     | A swappable capability with three roles: the Service Definition (`@dv/models`), the Service Providers (provider plugins such as `@dv/fastvideo`), and the Consumer (`@dv/shot-render`).                                   |
| turn             | 轮次 / Turn             | One run of the agent from a user message to its reply; a record names it by the DSH turn number.                                                                                                                          |
| current state    | 当前 / Current          | The state at the current position; every view shows it.                                                                                                                                                                   |
| current position | 当前 / Current          | The step of the history list whose state the project shows; undo, redo, and 回到这一步 move it, and a new step follows it.                                                                                                     |
| history          | 历史 / History          | The project's steps in order: the history list ([history rules](#history-rules)).                                                                                                                                         |
| step             | 一步 / Step             | A record of the history list; undo moves the current position back one step, and redo moves it forward one step.                                                                                                          |
| discard          | 丢弃 / Discard          | What a new step does to the steps after the current position: they leave the history list for good, and an unfinished one is cancelled.                                                                                   |
| trajectory       | 轨迹 / Trajectory       | The agent's steps in one chat session.                                                                                                                                                                                    |
| surface          | 来源 / Surface          | The record field that names where a call came from: `chat`, `canvas`, `timeline`, `asset_pool`, `history`, or `api`.                                                                                                      |

### IDs and types

| Term      | Type                  | ID                                        | Owner       | zh / en copy                                                        |
| --------- | --------------------- | ----------------------------------------- | ----------- | ------------------------------------------------------------------- |
| project   | `Project`             | `ProjectId`                               | Project     | 项目 / Project                                                        |
| record    | `ProjectRecord`       | `RecordId`                                | Project     | 记录 / Record                                                         |
| turn      | —                     | `TurnId`                                  | Project     | 轮次 / Turn                                                           |
| asset     | `Asset`               | `AssetId`                                 | Asset pool  | 素材 / Asset                                                          |
| still     | `Asset`               | `AssetId`                                 | Asset pool  | 静帧 / Still                                                          |
| character | `Character`           | `CharacterId`, versions `<id>@<version>`  | Character   | 角色 / Character                                                      |
| location  | `Location`            | `LocationId`, versions `<id>@<version>`   | Location    | 场景 / Location                                                       |
| style     | `Style`               | `StyleId`, versions `<id>@<version>`      | Style       | 风格 / Style                                                          |
| shot      | —                     | —                                         | Shot render | 镜头 / Shot; what one `shot.render` call turns into a take            |
| take      | `Take`                | `TakeId`                                  | Shot render | 版本 / Take                                                           |
| timeline  | `Timeline`            | `TimelineId` (`t1`, `t2`, …)              | Timeline    | 时间线 / Timeline; an unnamed timeline shows as 时间线 {n} / Timeline {n} |
| clip      | `Clip`                | `ClipId` (`cl1`, `cl2`, …)                | Timeline    | 片段 / Clip                                                           |

`ProjectRecord` names the record type because `Record` is a TypeScript built-in. The agent writes a reference as `<asset>`, `<record>#<output>`, or `<id>@<version>`.

### Components and packages

| Component            | Key        | Package              | Service        | Operations                                                                                                                                                                                                                      |
| -------------------- | ---------- | -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project 项目           | `proj`     | `@dv/project`        | `dvProject`    | `proj.create` `proj.stale_accept`; the history tools `dv_proj_undo` `dv_proj_redo`; the read tools `dv_proj_state` `dv_proj_history_list` `dv_proj_wait`; the rename tool `dv_proj_rename`                                      |
| Asset pool 素材库       | `asset`    | `@dv/asset-pool`     | `dvAssetPool`  | `asset.import` `asset.grab_still` `asset.cut_segment` `asset.place` `asset.unplace`                                                                                                                                             |
| Character 角色         | `character` | `@dv/character`      | `dvCharacter`  | `character.create` `character.update`                                                                                                                                                                                           |
| Location 场景          | `location` | `@dv/location`       | `dvLocation`   | `location.create` `location.update`                                                                                                                                                                                             |
| Style 风格             | `style`    | `@dv/style`          | `dvStyle`      | `style.create` `style.update`                                                                                                                                                                                                   |
| Shot render 镜头渲染     | `shot`     | `@dv/shot-render`    | `dvShotRender` | `shot.render` (while the model catalog holds a `t2v` or `ref2v` entry)                                                                                                                                                          |
| Image 图片               | `image`    | `@dv/image-generate` | `dvImageGenerate` | `image.generate` (while the model catalog holds a `t2i` entry) |
| Audio 音频             | `audio`    | `@dv/audio-generate` | `dvAudioGenerate` | `audio.generate` (while the model catalog holds a `t2a` entry)                                                                                                                                                                 |
| Timeline 时间线         | `timeline` | `@dv/timeline`       | `dvTimeline`   | `timeline.create` `timeline.update` `timeline.rename` `timeline.delete` `timeline.clip_insert` `timeline.clip_move` `timeline.clip_remove` `timeline.clip_split` `timeline.clip_trim` `timeline.clip_replace` `timeline.export` |
| Inspector 检查器        | `inspect`  | `@dv/inspector`      | `dvInspector`  | reads `inspect.image` `inspect.asset`                                                                                                                                                                                           |

An operation is named `<key>.<verb>` or `<key>.<object>_<verb>`, and its agent tool is `dv_` plus the operation name with `.` replaced by `_` (`timeline.clip_move` → `dv_timeline_clip_move`). Text the model reads names tools, never operations. The other packages are the model catalog `@dv/models` (`dvModels`) and the provider plugins `@dv/fastvideo`, `@dv/sglang-diffusion` and `@dv/sglang-omni`, the chat references `@dv/chat-references` (`dvChatReferences`), the API 接口 (`@dv/api`, `dvApi`), the libraries `@dv/generation` and `@dv/reference-kit`, the workflow skills `@dv/workflow-story`, the bundle (`@dv/bundle`), and the interface (`@dv/ui-shell`, `@dv/ui-canvas`, `@dv/ui-timeline`, `@dv/ui-asset-pool`, `@dv/ui-composer`, `@dv/ui-history`, the library `@dv/ui-kit`, and `@dv/ui-character`, `@dv/ui-location`, `@dv/ui-style` and `@dv/ui-shot-render`). Product names use `dv`: routes `/api/dv/…` and `/dv/events`, window events `dv:…`, page globals `__dv…`, and test IDs `dv-<area>-<thing>`.

### Verbs

Each verb has one meaning:

| Verb                                              | Meaning                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `create` `update` `delete` `rename`               | Projects, characters, locations, styles, and timelines.                 |
| `import`                                          | Bring a file into the asset pool.                                       |
| `grab`                                            | Take a still from a video.                                              |
| `cut`                                             | Take the part of a video between two times as a new video.              |
| `render`                                          | Turn a shot into a take.                                                |
| `export`                                          | Turn a timeline into one video asset.                                   |
| `insert` `move` `remove` `split` `trim` `replace` | Clips.                                                                  |
| `accept`                                          | A stale record (`proj.stale_accept`).                                   |
| `undo` `redo`                                     | Move the current position back or forward one step, or to a step.       |
| `inspect`                                         | Read-only analysis of an image or an asset.                             |
| `get` `list`                                      | Read one by ID; read many.                                              |

### Interface copy

| zh                               | en                                                             | Use                                                                                    |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 渲染新版本                            | Render new take                                                | Rendering a take again; 渲染 is the zh verb for render.                                  |
| 模型和生成方式 / 参考图生成 / 文字生成           | Model and mode / From references / From text                   | A take's or a shot's model and task (`ref2v`, `t2v`).                                  |
| 渲染镜头 / 列出模型 / 查看模型               | Render shot / List models / Get model                          | The tools `dv_shot_render`, `dv_models_list`, and `dv_models_get` in chat and History. |
| 渲染结果                             | Rendered                                                       | The asset filter for takes.                                                            |
| 导入                               | Imported                                                       | The asset filter for imported files.                                                   |
| 参考图                              | Reference images                                               | The images a character, location, style, or shot renders from.                         |
| 场景                               | Locations                                                      | The `@` menu section after 角色 / Characters.                                            |
| 风格                               | Styles                                                         | The `@` menu section after 场景 / Locations.                                             |
| 新建时间线 / 修改时间线                    | Create timeline / Update timeline                              | The Timeline operations that add a timeline or replace its clips.                      |
| 插入片段 / 移动片段 / 移除片段 / 拆分片段 / 裁剪片段 | Insert clip / Move clip / Remove clip / Split clip / Trim clip | The clip operations; a clip shows as 片段 N / Clip N in copy.                            |
| 仍然保留                             | Keep anyway                                                    | The one label of `proj.stale_accept`.                                                  |
| 你 / 智能体 / 自动                     | You / Agent / Automatic                                        | Who acted, in the History panel.                                                       |
| 当前                               | Current                                                        | The History panel mark of the current position.                                        |
| 撤销 / 重做 / 回到这一步                  | Undo / Redo / Go back to this step                             | The undo and redo buttons, and the ⋮ menu item of a History row.                       |
| 在历史中查看 / 在轨迹中查看                  | Show in history / Show in trajectory                           | The links between the chat and the History panel.                                      |
