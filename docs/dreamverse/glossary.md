# DreamVerse glossary

English | [中文](glossary.zh.md)

This page defines the DreamVerse names: concepts, IDs and types, components and packages, verbs, and interface copy.

Code, record fields, tool descriptions, docs, and interface copy use these names, each with one meaning. The zh / en column is the copy the interface shows.

## Concepts

| Term             | zh / en copy          | Meaning                                                                                                                                                                                                                            |
| ---------------- | --------------------- | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| component        | 组件 / Component        | A plugin that owns one capability: its implementation, data, operations, reducer, and tools.                                                                                                                                       |
| reference noun   | —                     | A component whose items each have an ID and versions, each version a list of reference images: character, location and style ([reference nouns](subsystems/reference-nouns.md)).                                                   |
| reference kit    | —                     | The code that implements the reference nouns once: `defineReference` (`@dv/reference-kit`) and `defineReferenceUi` (`@dv/ui-kit`) ([reference nouns](subsystems/reference-nouns.md)).                                              |
| operation        | 操作 / Operation        | An action a component implements that changes a project, or a read it serves.                                                                                                                                                      |
| record           | 记录 / Record           | One log entry written by one operation call.                                                                                                                                                                                       |
| tool             | 工具 / Tool             | Something the agent can call; a component tool (智能体工具 / agent tool) wraps one operation.                                                                                                                                           |
| reducer          | —                     | A component function that reads records and computes its slice of the project state; it does not write records. The DSH counterpart is a session projection (`ctx.sessionProjections`), which folds the session log.               |
| model            | 模型 / Model            | A video model of one provider, such as `fasth3`. The model catalog (`dvModels`) holds one entry for each task that the model serves. The key of an entry is its modality, task, provider, and model.                               |
| task             | 生成方式 / Mode           | What a render produces from which inputs. `ref2v` (参考图生成 / From references) takes a prompt, reference media, and an optional first frame. `t2v` (文字生成 / From text) takes a prompt only. `TaskMap` maps each task to its primitive. |
| modality         | —                     | The kind of output a task produces, such as `video`: the `modality` of a `PrimitiveTypes` row.                                                                                                                                     |
| provider plugin  | —                     | A plugin that registers the models of one provider into the model catalog under its provider name, such as `@dv/fastvideo` with provider `fastvideo`.                                                                              |
| capability seam  | —                     | A swappable capability with three roles: the Service Definition (`@dv/models`), the Service Providers (provider plugins such as `@dv/fastvideo`), and the Consumer (`@dv/shot-render`).                                            |
| turn             | 轮次 / Turn             | One run of the agent from a user message to its reply; a record names it by the DSH turn number.                                                                                                                                   |
| current state    | 当前 / Current          | The state at the current position; every view shows it.                                                                                                                                                                            |
| current position | 当前 / Current          | The step of the history list whose state the project shows; undo, redo, and 回到这一步 move it, and a new step follows it.                                                                                                              |
| history          | 历史 / History          | The project's steps in order: the history list ([history rules](subsystems/project.md#history-rules)).                                                                                                                                                  |
| step             | 一步 / Step             | A record of the history list; undo moves the current position back one step, and redo moves it forward one step.                                                                                                                   |
| discard          | 丢弃 / Discard          | What a new step does to the steps after the current position. These steps leave the history list for good, and Project cancels an unfinished one.                                                                                  |
| trajectory       | 轨迹 / Trajectory       | The agent's steps in one chat session.                                                                                                                                                                                             |
| surface          | 来源 / Surface          | The record field that names where a call came from: `chat`, `canvas`, `timeline`, `asset_pool`, `history`, or `api`.                                                                                                               |

## IDs and types

| Term      | Type                  | ID                                        | Owner       | zh / en copy                                                        |
| --------- | --------------------- | ----------------------------------------- | ----------- | ------------------------------------------------------------------- |
| project   | `ProjectInfo`         | `ProjectId`                               | Project     | 项目 / Project                                                        |
| record    | `ProjectRecord`       | `RecordId`                                | Project     | 记录 / Record                                                         |
| turn      | —                     | `TurnId`                                  | Project     | 轮次 / Turn                                                           |
| asset     | `Asset`               | `AssetId`                                 | Asset pool  | 素材 / Asset                                                          |
| still     | `Asset`               | `AssetId`                                 | Asset pool  | 静帧 / Still                                                          |
| character | `Character`           | `CharacterId`, versions `<id>@<version>`  | Character   | 角色 / Character                                                      |
| location  | `Location`            | `LocationId`, versions `<id>@<version>`   | Location    | 场景 / Location                                                       |
| style     | `Style`               | `StyleId`, versions `<id>@<version>`      | Style       | 风格 / Style                                                          |
| plan      | `Plan`, `PlanVersion` | `PlanId` (`p1`, `p2`, …), versions `p1@2` | Shot plan   | 分镜计划 / Plan; a plan's version is 版次                                 |
| shot      | `Shot`                | its 1-based position in the plan          | Shot plan   | 镜头 / Shot                                                           |
| take      | `ProjectRecord`       | `RecordId` of a `shot.render` record      | Shot render | 版本 / Take                                                           |
| timeline  | `Timeline`            | `TimelineId` (`t1`, `t2`, …)              | Timeline    | 时间线 / Timeline; an unnamed timeline shows as 时间线 {n} / Timeline {n} |
| clip      | `Clip`                | `ClipId` (`cl1`, `cl2`, …)                | Timeline    | 片段 / Clip                                                           |

`ProjectRecord` names the record type because `Record` is a TypeScript built-in. `ProjectInfo` holds the contents of a project's `project.json`, and a take is the record of one `shot.render` call. The agent writes a reference as `<asset>`, `<record>#<output>`, or `<id>@<version>`. A `Shot` holds `modality`, `task`, `provider`, `model`, `prompt`, and optionally `duration_sec`, `references`, `seed`, and `continue_previous`.

<a id="components-and-packages"></a>
## Components and packages

| Component            | Key        | Package              | Service        | Operations                                                                                                                                                                                                                      |
| -------------------- | ---------- | -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project 项目           | `proj`     | `@dv/project`        | `dvProject`    | `proj.create` `proj.stale_accept`; the history tools `dv_proj_undo` `dv_proj_redo`; the read tools `dv_proj_open` `dv_proj_state` `dv_proj_history_list` `dv_proj_wait`                                                         |
| Asset pool 素材库       | `asset`    | `@dv/asset-pool`     | `dvAssetPool`  | `asset.import` `asset.grab_still` `asset.cut_segment` `asset.place` `asset.unplace`                                                                                                                                             |
| Character 角色         | `character` | `@dv/character`      | `dvCharacter`  | `character.create` `character.update`                                                                                                                                                                                           |
| Location 场景          | `location` | `@dv/location`       | `dvLocation`   | `location.create` `location.update`                                                                                                                                                                                             |
| Style 风格             | `style`    | `@dv/style`          | `dvStyle`      | `style.create` `style.update`                                                                                                                                                                                                   |
| Shot plan 分镜         | `plan`     | `@dv/shot-plan`      | `dvShotPlan`   | `plan.create` `plan.update`                                                                                                                                                                                                     |
| Story workflow 故事工作流 | `story`    | `@dv/workflow-story` | `dvStory`      | `story.approve`; the read `story.preview`                                                                                                                                                                                       |
| Shot render 镜头渲染     | `shot`     | `@dv/shot-render`    | `dvShotRender` | `shot.render` (while the model catalog holds a `t2v` or `ref2v` entry)                                                                                                                                                          |
| Timeline 时间线         | `timeline` | `@dv/timeline`       | `dvTimeline`   | `timeline.create` `timeline.update` `timeline.rename` `timeline.delete` `timeline.clip_insert` `timeline.clip_move` `timeline.clip_remove` `timeline.clip_split` `timeline.clip_trim` `timeline.clip_replace` `timeline.export` |
| Inspector 检查器        | `inspect`  | `@dv/inspector`      | `dvInspector`  | reads `inspect.image` `inspect.asset`                                                                                                                                                                                           |

[Operations](subsystems/project.md#operations) on the Project page gives the form of an operation name and of its agent tool name. Text the model reads names tools, never operations. The [DreamVerse package table](../../packages/dv/README.md#packages) lists the other packages and their layers. Product names use `dv`: routes `/api/dv/…` and `/dv/events`, window events `dv:…`, page globals `__dv…`, and test IDs `dv-<area>-<thing>`.

## Verbs

Each verb has one meaning:

| Verb                                              | Meaning                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `create`                                          | Projects, characters, locations, styles, plans, and timelines.          |
| `update`                                          | Characters, locations, styles, plans, and timelines.                    |
| `delete` `rename`                                 | Timelines.                                                              |
| `import`                                          | Bring a file into the asset pool.                                       |
| `grab`                                            | Take a still from a video.                                              |
| `cut`                                             | Take the part of a video between two times as a new video.              |
| `render`                                          | Turn a shot into a take.                                                |
| `export`                                          | Turn a timeline into one video asset.                                   |
| `insert` `move` `remove` `split` `trim` `replace` | Clips.                                                                  |
| `approve`                                         | A plan version.                                                         |
| `accept`                                          | A stale record (`proj.stale_accept`).                                   |
| `undo` `redo`                                     | Move the current position back or forward one step, or to a step.       |
| `inspect`                                         | Read-only analysis of an image or an asset.                             |
| `get` `list`                                      | Read one by ID; read many.                                              |

## Interface copy

| zh                               | en                                                             | Use                                                                                    |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 渲染新版本                            | Render new take                                                | Rendering a take again; 渲染 is the zh verb for render.                                  |
| 模型和生成方式 / 参考图生成 / 文字生成           | Model and mode / From references / From text                   | A take's or a shot's model and task (`ref2v`, `t2v`).                                  |
| 渲染镜头 / 列出模型 / 查看模型               | Render shot / List models / Get model                          | The tools `dv_shot_render`, `dv_models_list`, and `dv_models_get` in chat and History. |
| 接上一镜头                            | Continues the previous shot                                    | A shot with `continue_previous: true`.                                                 |
| 渲染结果                             | Rendered                                                       | The asset filter for takes.                                                            |
| 导入                               | Imported                                                       | The asset filter for imported files.                                                   |
| 参考图                              | Reference images                                               | The images a character, location, style, or shot renders from.                         |
| 场景                               | Locations                                                      | The `@` menu section after 角色 / Characters.                                            |
| 风格                               | Styles                                                         | The `@` menu section after 场景 / Locations.                                             |
| 新建时间线 / 修改时间线                    | Create timeline / Update timeline                              | The Timeline operations that add a timeline or replace its clips.                      |
| 插入片段 / 移动片段 / 移除片段 / 拆分片段 / 裁剪片段 | Insert clip / Move clip / Remove clip / Split clip / Trim clip | The clip operations; a clip shows as 片段 N / Clip N in copy.                            |
| 仍然保留                             | Keep anyway                                                    | The one label of `proj.stale_accept`.                                                  |
| 分镜计划版次 / v{version}              | Plan versions / v{version}                                     | The canvas switch between a plan's versions.                                           |
| 你 / 智能体 / 自动                     | You / Agent / Automatic                                        | Who acted, in the History panel.                                                       |
| 渲染 {n} 个镜头                       | Render {n} shots                                               | The fold of the renders an approval scheduled.                                         |
| 当前                               | Current                                                        | The History panel mark of the current position.                                        |
| 撤销 / 重做 / 回到这一步                  | Undo / Redo / Go back to this step                             | The undo and redo buttons, and the ⋮ menu item of a History row.                       |
| 在历史中查看 / 在轨迹中查看                  | Show in history / Show in trajectory                           | The links between the chat and the History panel.                                      |
