# DreamVerse architecture

English | [中文](architecture.zh.md)

This page maps the DreamVerse packages: the layer of each package, the role of each layer, and the direction in which the packages depend on each other. The [subsystem pages](subsystems/README.md) are the reference for each part, and the [glossary](glossary.md) defines the names.

## Layers and roles

```text
views          @dv/ui-shell @dv/ui-canvas @dv/ui-timeline @dv/ui-asset-pool @dv/ui-composer @dv/ui-history (+ library @dv/ui-kit)
               @dv/ui-character @dv/ui-location @dv/ui-style @dv/ui-shot-plan @dv/ui-shot-render @dv/ui-workflow-story
  │ HTTP: /api/dv/…, /dv/events
  ▼
API            @dv/api                    routes that read state and run operations as the user; the event stream
  │ dvProject.run, getState, listHistory
  ▼
registry       @dv/project                records, the history list, undo and redo, state, agent tools, the dv:project prompt section
  ▲ registerOperation, registerReducer             ▲ dvProject.run (asset.import, asset.place), current-state reads
  │ from workflows and components                  │
workflows      @dv/workflow-story                  │
               (+ library @dv/workflow-kit)        │
  │ dvShotPlan, dvShotRender, dvTimeline           │
  ▼                                                │
components     @dv/asset-pool @dv/character       chat references   @dv/chat-references   dv: mentions, chat images
               @dv/location @dv/style
               @dv/shot-plan @dv/shot-render
               @dv/timeline @dv/inspector
  │ defineGeneration, defineReference
  ▼
base libraries @dv/generation @dv/reference-kit
  │ ctx.dvModels (Consumer: @dv/shot-render)
  ▼
models         @dv/models                 the model catalog dvModels, dv_models_list, dv_models_get, video-model-selection
  ▲ register one entry per task a model serves
  │
providers      @dv/fastvideo              provider fastvideo: fasth3 for tasks ref2v and t2v, a prompt skill per task

bundle         @dv/bundle                 the cordis.patch.yml rows of every package above, the video-directing skill
```

Each arrow points from a package to the package it depends on, and no dependency points the other way. A component never names another component's operation. A workflow reaches components through their services, such as `dvShotPlan.shots`, `dvShotRender.estimate` and `dvTimeline.layout`, and only the surfaces `@dv/api` and `@dv/chat-references` run the operations of other packages by name, as the user. In DeepSeek Harness terms, the layers have these roles:

| Layer           | Packages                                                                                                                            | Role                                                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| registry        | [`@dv/project`](../../packages/dv/project/README.md)                                                                                | The `dvProject` Service: components register operations and reducers with it, as tools register with `ctx.tools`. It is the only writer of project files, turns every operation into a DSH tool, and registers the `dv:project` system-prompt section. |
| workflows       | `@dv/workflow-story` (library `@dv/workflow-kit`)                                                                                   | A production flow: preview, approval, take reuse, timeline choice.                                                                                                                                                                                     |
| components      | `@dv/asset-pool`, `@dv/character`, `@dv/location`, `@dv/style`, `@dv/shot-plan`, `@dv/shot-render`, `@dv/timeline`, `@dv/inspector` | Plugins that each own one capability: its data (a state slice and its reducer), its operations, and the text the agent reads about them. External programs come through [`@dv/ffmpeg`](../../packages/dv/ffmpeg/README.md).                            |
| base libraries  | `@dv/generation`, `@dv/reference-kit`                                                                                               | `defineGeneration` and `defineReference` build the service of a generation primitive or a reference noun.                                                                                                                                              |
| models          | [`@dv/models`](../../packages/dv/models/README.md), [`@dv/fastvideo`](../../packages/dv/fastvideo/README.md)                        | The model catalog: `@dv/models` holds the `dvModels` Service Definition with `PrimitiveTypes` and `TaskMap`, provider plugins such as `@dv/fastvideo` are Service Providers that register the models they serve, and Shot render is a Consumer.        |
| API             | [`@dv/api`](../../packages/dv/api/README.md)                                                                                        | Fetch routes on the DSH `connection` service and an event stream on `webServer`; the only way a view reads or changes a project.                                                                                                                       |
| chat references | [`@dv/chat-references`](../../packages/dv/chat-references/README.md)                                                                | Listeners on `agent/pre-step` and `session/event` that turn what the user points at in a chat message into project IDs and assets.                                                                                                                     |
| views           | UI core (`@dv/ui-kit`, `@dv/ui-canvas`, `@dv/ui-history`, `@dv/ui-shell`, `@dv/ui-composer`) and the UI plugins `@dv/ui-<name>`     | Right-Sidebar tab types and center views of the DSH Web Client; `@dv/ui-kit` is the library they share.                                                                                                                                                |
| bundle          | [`@dv/bundle`](../../packages/bundle/dv/README.md)                                                                                  | The profile layer that composes every row as the `video-harness` and `video-harness-headless` profiles and ships the `video-directing` skill.                                                                                                          |

Components register their operations with `dvProject.registerOperation` and their reducers with `dvProject.registerReducer`. Each operation is also the agent tool `dv_<operation name with _>`, whose call becomes one record. The asset pool's `dv_asset_import`, `dv_asset_grab_still`, and `dv_asset_cut_segment` add assets, and `dv_asset_place` and `dv_asset_unplace` put assets on the canvas and take them off; the Character, Location and Style components' `dv_character_*`, `dv_location_*` and `dv_style_*` tools create and update their versions; Shot plan's `dv_plan_create` writes version 1 of a new plan, which gets a `PlanId` (`p1`, `p2`, …), `dv_plan_update` writes the next version of the plan its `plan` param names; the story workflow's `dv_story_preview` reports what approving one version renders and costs, and `dv_story_approve` approves it; Shot render's `dv_shot_render` renders one take of a shot with the [model](subsystems/generation.md#model-catalog) the call names, with `duration_sec` a whole number of seconds within that model's range (default: the model's minimum); Timeline's `dv_timeline_*` tools create, update, rename, and delete timelines and insert, move, remove, split, trim, and replace clips without creating files, and its `dv_timeline_export` writes a timeline to one video; and Inspector's `dv_inspect_image` and `dv_inspect_asset` read assets without writing a record. Project's own `dv_proj_*` tools create and open projects, read the state and the history, undo, accept stale records, and wait for scheduled records. An operation declares a resource class (`none`, `cpu`, `gpu`) and a confirmation policy (`never`, `always`, `over_gpu_budget`; see [Confirmation in the conversation](subsystems/project.md#confirmation-in-the-conversation)); Project's scheduler runs scheduled records under one concurrency limit per class.

A plan approval belongs to a workflow plugin, such as `story.approve` of [`@dv/workflow-story`](../../packages/dv/workflow-story/README.md). It runs, as the `system` actor, one `shot.render` call per shot of the approved version that keeps no take, with the shot's `modality`, `task`, `provider`, and `model`; each record it writes carries `started_by` with the approval record and, for a render, the shot's 1-based position as `slot`. A shot keeps the newest done take with the same params and inputs whose chain starts at an approval of the same workflow and plan. Then `dvTimeline.layout` lays every shot's take in shot order on a timeline; a shot whose render is not done yet shows as a placeholder clip until it finishes. The approval lists the scheduled records in its `report.scheduled`. A clip has a `ClipId` (`cl1`, `cl2`, …) that the Timeline operation inserting it assigns and stores in the record's `report.clips`; the ID is unique within the project, is never reused, and names the clip in the `clip` param of every clip operation.
