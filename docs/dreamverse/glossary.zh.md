# DreamVerse 术语表

[English](glossary.md) | 中文

本页定义 DreamVerse 的名称：概念、ID 和类型、组件和其他包、动词，以及界面文案。

代码、记录字段、工具描述、文档和界面文案都使用这些名称，每个名称只有一个含义。zh / en 一列是界面显示的文案。

## 概念

| 术语               | zh / en 文案            | 含义                                                                                                                                          |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| component        | 组件 / Component        | 拥有一项能力的插件：它的实现、数据、操作、归约函数和工具。                                                                                                               |
| operation        | 操作 / Operation        | 组件实现的一个改变项目的动作，或它提供的一次读取。                                                                                                                   |
| record           | 记录 / Record           | 一次操作调用写入的一条日志。                                                                                                                              |
| tool             | 工具 / Tool             | 智能体可以调用的东西；组件工具（智能体工具 / agent tool）包装一个操作。                                                                                                  |
| reducer          | —                     | 组件的一个函数，读取记录并计算出项目状态中它的切片；它不写记录。DSH 中对应的是会话投影（`ctx.sessionProjections`），它折叠的是会话日志。                                                          |
| model            | 模型 / Model            | 一个提供方的一个视频模型，如 `fasth3`；模型目录（`dvModels`）为该模型服务的每个生成任务各存一个条目，按模态、生成任务、提供方和模型作键。                                                              |
| task             | 生成方式 / Mode           | 一次渲染由哪些输入产出什么：`ref2v`（参考图生成 / From references：提示词、参考素材和可选的首帧）或 `t2v`（文字生成 / From text：只有提示词）。`TaskMap` 把每个生成任务映射到它的原语。                      |
| modality         | —                     | 生成任务产出的输出种类，如 `video`：某个 `PrimitiveTypes` 行的 `modality`。                                                                                     |
| provider plugin  | —                     | 以自己的提供方名称把一个提供方的模型注册进模型目录的插件，如提供方为 `fastvideo` 的 `@dv/fastvideo`。                                                                           |
| capability seam  | —                     | 一项可替换的能力，有三种角色：Service Definition（`@dv/models`）、Service Provider（`@dv/fastvideo` 这样的提供方插件）和 Consumer（`@dv/shot-render`）。                    |
| turn             | 轮次 / Turn             | 智能体从一条用户消息到它的回复的一次运行；记录用 DSH 轮次编号指出它。                                                                                                       |
| current state    | 当前 / Current          | 当前位置处的状态；每个视图显示它。                                                                                                                           |
| current position | 当前 / Current          | 历史列表中项目显示其状态的那一步；撤销、重做和 回到这一步 移动它，新的一步接在它之后。                                                                                                |
| history          | 历史 / History          | 项目按顺序排列的步骤：历史列表（[历史规则](subsystems/project.zh.md#history-rules)）。                                                                                                    |
| step             | 一步 / Step             | 历史列表中的一条记录；撤销把当前位置往回移一步，重做把它往前移一步。                                                                                                          |
| discard          | 丢弃 / Discard          | 新的一步对当前位置之后各步骤的作用：它们永久离开历史列表，未完成的会被取消。                                                                                                      |
| trajectory       | 轨迹 / Trajectory       | 智能体在一个对话中的步骤。                                                                                                                               |
| surface          | 来源 / Surface          | 记录字段，写出调用来自哪里：`chat`、`canvas`、`timeline`、`asset_pool`、`history` 或 `api`。                                                                    |

## ID 和类型

| 术语        | 类型                   | ID                                | 所属   | zh / en 文案                                        |
| --------- | -------------------- | --------------------------------- | ---- | ------------------------------------------------- |
| project   | `Project`            | `ProjectId`                       | 项目   | 项目 / Project                                      |
| record    | `ProjectRecord`      | `RecordId`                        | 项目   | 记录 / Record                                       |
| turn      | —                    | `TurnId`                          | 项目   | 轮次 / Turn                                         |
| asset     | `Asset`              | `AssetId`                         | 素材库  | 素材 / Asset                                        |
| still     | `Asset`              | `AssetId`                         | 素材库  | 静帧 / Still                                        |
| character | `Character`          | `CharacterId`，版本 `<id>@<version>` | 角色   | 角色 / Character                                    |
| location  | `Location`           | `LocationId`，版本 `<id>@<version>`  | 场景   | 场景 / Location                                     |
| style     | `Style`              | `StyleId`，版本 `<id>@<version>`     | 风格   | 风格 / Style                                        |
| plan      | `Plan`、`PlanVersion` | `PlanId`（`p1`、`p2`、…），版次 `p1@2`   | 分镜   | 分镜计划 / Plan；分镜计划的版本叫版次                            |
| shot      | `Shot`               | 它在计划中从 1 起的位置                     | 分镜   | 镜头 / Shot                                         |
| take      | `Take`               | `TakeId`                          | 镜头渲染 | 版本 / Take                                         |
| timeline  | `Timeline`           | `TimelineId`（`t1`、`t2`、…）         | 时间线  | 时间线 / Timeline；没有名字的时间线显示为 时间线 {n} / Timeline {n} |
| clip      | `Clip`               | `ClipId`（`cl1`、`cl2`、…）           | 时间线  | 片段 / Clip                                         |

记录类型叫 `ProjectRecord`，因为 `Record` 是 TypeScript 内置类型。智能体把引用写成 `<asset>`、`<record>#<output>` 或 `<id>@<version>`。一个 `Shot` 包含 `modality`、`task`、`provider`、`model`、`prompt`，以及可选的 `duration_sec`、`references`、`seed` 和 `continue_previous`。

## 组件和其他包

| 组件                   | 键          | 包                    | 服务             | 操作                                                                                                                                                                                                                              |
| -------------------- | ---------- | -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project 项目           | `proj`     | `@dv/project`        | `dvProject`    | `proj.create` `proj.stale_accept`；历史工具 `dv_proj_undo` `dv_proj_redo`；读取工具 `dv_proj_open` `dv_proj_state` `dv_proj_history_list` `dv_proj_wait`                                                                                  |
| Asset pool 素材库       | `asset`    | `@dv/asset-pool`     | `dvAssetPool`  | `asset.import` `asset.grab_still` `asset.cut_segment` `asset.place` `asset.unplace`                                                                                                                                             |
| Character 角色         | `character` | `@dv/character`      | `dvCharacter`  | `character.create` `character.update`                                                                                                                                                                                           |
| Location 场景          | `location` | `@dv/location`       | `dvLocation`   | `location.create` `location.update`                                                                                                                                                                                             |
| Style 风格             | `style`    | `@dv/style`          | `dvStyle`      | `style.create` `style.update`                                                                                                                                                                                                   |
| Shot plan 分镜         | `plan`     | `@dv/shot-plan`      | `dvShotPlan`   | `plan.create` `plan.update`                                                                                                                                                                                                     |
| Story workflow 故事工作流 | `story`    | `@dv/workflow-story` | `dvStory`      | `story.approve`；读取 `story.preview`                                                                                                                                                                                              |
| Shot render 镜头渲染     | `shot`     | `@dv/shot-render`    | `dvShotRender` | `shot.render`（模型目录中有 `t2v` 或 `ref2v` 条目时）                                                                                                                                                                                       |
| Timeline 时间线         | `timeline` | `@dv/timeline`       | `dvTimeline`   | `timeline.create` `timeline.update` `timeline.rename` `timeline.delete` `timeline.clip_insert` `timeline.clip_move` `timeline.clip_remove` `timeline.clip_split` `timeline.clip_trim` `timeline.clip_replace` `timeline.export` |
| Inspector 检查器        | `inspect`  | `@dv/inspector`      | `dvInspector`  | 读取 `inspect.image` `inspect.asset`                                                                                                                                                                                              |

操作名为 `<key>.<verb>` 或 `<key>.<object>_<verb>`，它的智能体工具名是 `dv_` 加上把 `.` 换成 `_` 的操作名（`timeline.clip_move` → `dv_timeline_clip_move`）。模型读到的文字写工具名，从不写操作名。其他包是模型目录 `@dv/models`（`dvModels`）和提供方插件 `@dv/fastvideo`、对话引用 `@dv/chat-references`（`dvChatReferences`）、API 接口（`@dv/api`，`dvApi`）、库 `@dv/generation`、`@dv/reference-kit` 和 `@dv/workflow-kit`、bundle（`@dv/bundle`）和界面（`@dv/ui-shell`、`@dv/ui-canvas`、`@dv/ui-timeline`、`@dv/ui-asset-pool`、`@dv/ui-composer`、`@dv/ui-history`、库 `@dv/ui-kit`，以及 `@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`、`@dv/ui-shot-plan`、`@dv/ui-shot-render` 和 `@dv/ui-workflow-story`）。以产品命名的名称用 `dv`：路由 `/api/dv/…` 和 `/dv/events`、窗口事件 `dv:…`、页面全局变量 `__dv…`、测试 ID `dv-<area>-<thing>`。

## 动词

每个动词只有一个含义：

| 动词                                                | 含义                                                  |
| ------------------------------------------------- | --------------------------------------------------- |
| `create` `update` `delete` `rename`               | 项目、角色、场景、风格、分镜计划和时间线。                               |
| `import`                                          | 把文件导入素材库。                                           |
| `grab`                                            | 从视频截取静帧。                                            |
| `cut`                                             | 把视频中两个时间点之间的部分取为一个新视频。                              |
| `render`                                          | 把镜头变成版本。                                            |
| `export`                                          | 把时间线变成一个视频素材。                                       |
| `insert` `move` `remove` `split` `trim` `replace` | 片段。                                                 |
| `approve`                                         | 分镜计划的一个版次。                                          |
| `accept`                                          | 过期记录（`proj.stale_accept`）。                          |
| `undo` `redo`                                     | 把当前位置往回或往前移一步，或移到某一步。                               |
| `inspect`                                         | 对图片或素材的只读分析。                                        |
| `get` `list`                                      | 按 ID 读取一个；读取多个。                                     |

## 界面文案

| zh                               | en                                                             | 用途                                                             |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| 渲染新版本                            | Render new take                                                | 再次渲染一个版本；渲染 是 render 的 zh 动词。                                  |
| 模型和生成方式 / 参考图生成 / 文字生成           | Model and mode / From references / From text                   | 版本或镜头的模型和生成任务（`ref2v`、`t2v`）。                                  |
| 渲染镜头 / 列出模型 / 查看模型               | Render shot / List models / Get model                          | 对话和历史中的工具 `dv_shot_render`、`dv_models_list` 和 `dv_models_get`。 |
| 接上一镜头                            | Continues the previous shot                                    | 带 `continue_previous: true` 的镜头。                               |
| 渲染结果                             | Rendered                                                       | 版本的素材筛选。                                                       |
| 导入                               | Imported                                                       | 导入文件的素材筛选。                                                     |
| 参考图                              | Reference images                                               | 角色、场景、风格或镜头据以渲染的图片。                                            |
| 场景                               | Locations                                                      | `@` 菜单中 角色 / Characters 之后的部分。                                 |
| 风格                               | Styles                                                         | `@` 菜单中 场景 / Locations 之后的部分。                                  |
| 新建时间线 / 修改时间线                    | Create timeline / Update timeline                              | 添加时间线或替换其片段的时间线操作。                                             |
| 插入片段 / 移动片段 / 移除片段 / 拆分片段 / 裁剪片段 | Insert clip / Move clip / Remove clip / Split clip / Trim clip | 片段操作；文案中片段显示为 片段 N / Clip N。                                   |
| 仍然保留                             | Keep anyway                                                    | `proj.stale_accept` 唯一的标签。                                     |
| 分镜计划版次 / v{version}              | Plan versions / v{version}                                     | 画布上分镜计划各版次间的切换。                                                |
| 你 / 智能体 / 自动                     | You / Agent / Automatic                                        | 历史面板中的发起者。                                                     |
| 渲染 {n} 个镜头                       | Render {n} shots                                               | 批准时排定的渲染的折叠开关。                                                 |
| 当前                               | Current                                                        | 历史面板中当前位置的标记。                                                  |
| 撤销 / 重做 / 回到这一步                  | Undo / Redo / Go back to this step                             | 撤销和重做按钮，以及历史行的 ⋮ 菜单项。                                          |
| 在历史中查看 / 在轨迹中查看                  | Show in history / Show in trajectory                           | 对话和历史面板之间的链接。                                                  |
