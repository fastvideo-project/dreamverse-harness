# DreamVerse 架构

[English](architecture.md) | 中文

本页给出 DreamVerse 各包的分布图：每个包所在的层、每一层的角色，以及包之间依赖的方向。[子系统页面](subsystems/README.zh.md)是各部分的参考，[术语表](glossary.zh.md)定义各个名称。

## 分层和角色

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

每个箭头从一个包指向它所依赖的包，没有反方向的依赖。组件从不写出另一个组件的操作名。工作流通过组件的服务使用组件，例如 `dvShotPlan.shots`、`dvShotRender.estimate` 和 `dvTimeline.layout`；只有 surface 包 `@dv/api` 和 `@dv/chat-references` 以用户身份按名字运行其他包的操作。用 DeepSeek Harness 的术语说，各层的角色如下：

| 层      | 包                                                                                                                            | 角色                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 注册表    | [`@dv/project`](../../packages/dv/project/README.zh.md)                                                                      | `dvProject` 服务：组件向它注册操作和归约函数，就像工具向 `ctx.tools` 注册一样。它是项目文件唯一的写入者，把每个操作变成一个 DSH 工具，并注册 `dv:project` 系统提示词段。                                              |
| 工作流    | `@dv/workflow-story`（库 `@dv/workflow-kit`）                                                                                   | 一个制作流程：预览、批准、版本复用、时间线选择。                                                                                                                                |
| 组件     | `@dv/asset-pool`、`@dv/character`、`@dv/location`、`@dv/style`、`@dv/shot-plan`、`@dv/shot-render`、`@dv/timeline`、`@dv/inspector` | 各自拥有一项能力的插件：它的数据（一个状态切片及其归约函数）、它的操作，以及智能体读到的关于它们的文字。外部程序经 [`@dv/ffmpeg`](../../packages/dv/ffmpeg/README.zh.md) 运行。                                     |
| 基础库    | `@dv/generation`、`@dv/reference-kit`                                                                                         | `defineGeneration` 和 `defineReference` 构建生成原语或引用名词的服务。                                                                                                  |
| 模型     | [`@dv/models`](../../packages/dv/models/README.zh.md)、[`@dv/fastvideo`](../../packages/dv/fastvideo/README.zh.md)            | 模型目录：`@dv/models` 持有 `dvModels` Service Definition 以及 `PrimitiveTypes` 和 `TaskMap`，`@dv/fastvideo` 这样的提供方插件是 Service Provider，注册自己服务的模型，镜头渲染是 Consumer。 |
| API    | [`@dv/api`](../../packages/dv/api/README.zh.md)                                                                              | DSH `connection` 服务上的 Fetch 路由和 `webServer` 上的事件流；视图读取或修改项目的唯一途径。                                                                                       |
| 对话引用   | [`@dv/chat-references`](../../packages/dv/chat-references/README.zh.md)                                                      | `agent/pre-step` 和 `session/event` 上的监听器，把用户在对话消息中指向的东西变成项目 ID 和素材。                                                                                     |
| 视图     | UI 核心（`@dv/ui-kit`、`@dv/ui-canvas`、`@dv/ui-history`、`@dv/ui-shell`、`@dv/ui-composer`）和 UI 插件 `@dv/ui-<name>`                 | DSH Web 客户端的右侧栏标签类型和中央视图；`@dv/ui-kit` 是它们共用的库。                                                                                                          |
| bundle | [`@dv/bundle`](../../packages/bundle/dv/README.zh.md)                                                                        | profile 层：把每一行组成 `video-harness` 和 `video-harness-headless` 两个 profile，并附带 `video-directing` skill。                                                     |

组件用 `dvProject.registerOperation` 注册操作，用 `dvProject.registerReducer` 注册归约函数。每个操作同时是智能体工具 `dv_<操作名，点换成下划线>`，一次调用成为一条记录。素材库的 `dv_asset_import`、`dv_asset_grab_still` 和 `dv_asset_cut_segment` 添加素材，`dv_asset_place` 和 `dv_asset_unplace` 把素材放到画布上和从画布移除；角色、场景和风格组件的 `dv_character_*`、`dv_location_*` 和 `dv_style_*` 工具创建和更新各自的版本；分镜的 `dv_plan_create` 写入一个新分镜计划的版次 1，该计划得到一个 `PlanId`（`p1`、`p2`、…），`dv_plan_update` 写入 `plan` 参数所指计划的下一个版次；故事工作流的 `dv_story_preview` 报告批准一个版次会渲染什么、花费多少，`dv_story_approve` 批准它；镜头渲染的 `dv_shot_render` 按调用指定的[模型](subsystems/generation.zh.md#model-catalog)渲染镜头的一个版本，`duration_sec` 是该模型范围内的整秒数（默认为模型的最小值）；时间线的 `dv_timeline_*` 工具创建、更新、重命名和删除时间线，并插入、移动、移除、拆分、裁剪和替换片段，不创建文件，它的 `dv_timeline_export` 把一条时间线写成一个视频；检查器的 `dv_inspect_image` 和 `dv_inspect_asset` 读取素材，不写记录。项目组件自己的 `dv_proj_*` 工具创建和打开项目、读取状态和历史、撤销、接受过期记录，以及等待排定的记录。操作声明资源类别（`none`、`cpu`、`gpu`）和确认策略（`never`、`always`、`over_gpu_budget`；见[在对话中确认](subsystems/project.zh.md#confirmation-in-the-conversation)）；项目组件的调度器按类别并发上限运行排定的记录。

分镜计划的批准属于工作流插件，例如 [`@dv/workflow-story`](../../packages/dv/workflow-story/README.zh.md) 的 `story.approve`。它以 `system` 发起者为所批准版次中每个不沿用版本的镜头运行一次 `shot.render`，带该镜头的 `modality`、`task`、`provider` 和 `model`；它写下的每条记录都带 `started_by`，指向该批准记录，渲染记录还以镜头从 1 起的位置作为 `slot`。镜头沿用参数和输入都相同、且所在链始于同一工作流对同一计划的批准的最新 done 版本。随后 `dvTimeline.layout` 按镜头顺序把每个镜头的版本排进一条时间线；渲染尚未完成的镜头先显示为占位片段，直到渲染完成。批准在 `report.scheduled` 中列出排定的记录。片段有一个 `ClipId`（`cl1`、`cl2`、…），由插入它的时间线操作分配并存入记录的 `report.clips`；该 ID 在项目内唯一、从不复用，每个片段操作都用 `clip` 参数按它指定片段。
