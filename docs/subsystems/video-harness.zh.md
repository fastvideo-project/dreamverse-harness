# DreamVerse 各包

[English](video-harness.md) | 中文

DreamVerse 各包是 DeepSeek Harness 内视频制作的项目层。本页定义 `packages/dv/` 下这些包和 [`packages/video-harness/`](../../packages/video-harness/README.zh.md) 包组的词汇和跨包规则：分层及其角色、模型目录、操作记录、[历史规则](#history-rules)、视图和智能体如何写入、在对话中确认、项目状态、智能体读到什么、过期、[新行为的归属位置](#where-new-behavior-goes)，以及代码、记录、工具和界面文案所用名称的[术语表](#glossary)。各包 README 各自说明配置和服务 API。

## 分层和角色

```text
views          @dv/ui-shell @dv/ui-canvas @dv/ui-timeline @dv/ui-asset-pool @dv/ui-composer @dv/ui-history @dv/ui-media (+ libraries @dv/ui-kit @dv/ui-reference-kit @dv/ui-generation)
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
               @dv/shot-plan @dv/shot-render @dv/image-generate
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

每个箭头从一个包指向它所依赖的包，没有反方向的依赖。组件从不写出另一个组件的操作名。工作流通过组件的服务使用组件，例如 `dvShotPlan.shots`、`dvShotRender.estimate` 和 `dvTimeline.layout`；只有 surface 包 `@dv/api` 和 `@dv/chat-references` 以用户身份按名字运行其他包的操作。用 DeepSeek Harness 的术语说，各层的角色如下：

| 层      | 包                                                                                                                            | 角色                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 注册表    | [`@dv/project`](../../packages/dv/project/README.zh.md)                                                                      | `dvProject` 服务：组件向它注册操作和归约函数，就像工具向 `ctx.tools` 注册一样。它是项目文件唯一的写入者，把每个操作变成一个 DSH 工具，并注册 `dv:project` 系统提示词段。                                              |
| 工作流    | `@dv/workflow-story`（库 `@dv/workflow-kit`）                                                                                   | 一个制作流程：预览、批准、版本复用、时间线选择。                                                                                                                                |
| 组件     | `@dv/asset-pool`、`@dv/character`、`@dv/location`、`@dv/style`、`@dv/shot-plan`、`@dv/shot-render`、`@dv/image-generate`、`@dv/audio-generate`、`@dv/timeline`、`@dv/inspector` | 各自拥有一项能力的插件：它的数据（一个状态切片及其归约函数）、它的操作，以及智能体读到的关于它们的文字。外部程序经 [`@dv/ffmpeg`](../../packages/dv/ffmpeg/README.zh.md) 运行。                                     |
| 基础库    | `@dv/generation`、`@dv/reference-kit`                                                                                         | `defineGeneration` 和 `defineReference` 构建生成原语或引用名词的服务。                                                                                                  |
| 模型     | [`@dv/models`](../../packages/dv/models/README.zh.md)、[`@dv/fastvideo`](../../packages/dv/fastvideo/README.zh.md)、[`@dv/uniserve`](../../packages/dv/uniserve/README.zh.md)、[`@dv/sglang-diffusion`](../../packages/dv/sglang-diffusion/README.zh.md)、[`@dv/sglang-omni`](../../packages/dv/sglang-omni/README.zh.md) | 模型目录：`@dv/models` 持有 `dvModels` Service Definition 以及 `PrimitiveTypes` 和 `TaskMap`，`@dv/fastvideo` 这样的提供方插件是 Service Provider，注册自己服务的模型，镜头渲染、图片和音频是 Consumer。 |
| API    | [`@dv/api`](../../packages/dv/api/README.zh.md)                                                                              | DSH `connection` 服务上的 Fetch 路由和 `webServer` 上的事件流；视图读取或修改项目的唯一途径。                                                                                       |
| 对话引用   | [`@dv/chat-references`](../../packages/dv/chat-references/README.zh.md)                                                      | `agent/pre-step` 和 `session/event` 上的监听器，把用户在对话消息中指向的东西变成项目 ID 和素材。                                                                                     |
| 视图     | UI 核心（`@dv/ui-kit`、`@dv/ui-canvas`、`@dv/ui-history`、`@dv/ui-shell`、`@dv/ui-composer`）和 UI 插件 `@dv/ui-<name>`                 | DSH Web 客户端的右侧栏标签类型和中央视图；`@dv/ui-kit` 是它们共用的库。                                                                                                          |
| bundle | [`@dv/bundle`](../../packages/bundle/dv/README.zh.md)                                                                        | profile 层：把每一行组成 `video-harness` 和 `video-harness-headless` 两个 profile，并附带 `video-directing` skill。                                                     |

组件用 `dvProject.registerOperation` 注册操作，用 `dvProject.registerReducer` 注册归约函数。每个操作同时是智能体工具 `dv_<操作名，点换成下划线>`，一次调用成为一条记录。素材库的 `dv_asset_import`、`dv_asset_grab_still` 和 `dv_asset_cut_segment` 添加素材，`dv_asset_place` 和 `dv_asset_unplace` 把素材放到画布上和从画布移除；角色、场景和风格组件的 `dv_character_*`、`dv_location_*` 和 `dv_style_*` 工具创建和更新各自的版本；分镜的 `dv_plan_create` 写入一个新分镜计划的版次 1，该计划得到一个 `PlanId`（`p1`、`p2`、…），`dv_plan_update` 写入 `plan` 参数所指计划的下一个版次；故事工作流的 `dv_story_preview` 报告批准一个版次会渲染什么、花费多少，`dv_story_approve` 批准它；镜头渲染的 `dv_shot_render` 按调用指定的[模型](#model-catalog)渲染镜头的一个版本，`duration_sec` 是该模型范围内的整秒数（默认为模型的最小值）；音频的 `dv_audio_generate` 用调用指定的模型说出一个片段；时间线的 `dv_timeline_*` 工具创建、更新、重命名和删除时间线，并插入、移动、移除、拆分、裁剪和替换片段，不创建文件，它的 `dv_timeline_export` 把一条时间线写成一个视频；检查器的 `dv_inspect_image` 和 `dv_inspect_asset` 读取素材，不写记录。项目组件自己的 `dv_proj_*` 工具创建、打开和重命名项目、读取状态和历史、撤销、接受过期记录，以及等待排定的记录。操作声明资源类别（`none`、`cpu`、`gpu`）和确认策略（`never`、`always`、`over_gpu_budget`；见[在对话中确认](#confirmation-in-the-conversation)）；项目组件的调度器按类别并发上限运行排定的记录。

分镜计划的批准属于工作流插件，例如 [`@dv/workflow-story`](../../packages/dv/workflow-story/README.zh.md) 的 `story.approve`。它以 `system` 发起者为所批准版次中每个不沿用版本的镜头运行一次 `shot.render`，带该镜头的 `modality`、`task`、`provider` 和 `model`；它写下的每条记录都带 `started_by`，指向该批准记录，渲染记录还以镜头从 1 起的位置作为 `slot`。镜头沿用参数和输入都相同、且所在链始于同一工作流对同一计划的批准的最新 done 版本。随后 `dvTimeline.layout` 按镜头顺序把每个镜头的版本排进一条时间线；渲染尚未完成的镜头先显示为占位片段，直到渲染完成。批准在 `report.scheduled` 中列出排定的记录。片段有一个 `ClipId`（`cl1`、`cl2`、…），由插入它的时间线操作分配并存入记录的 `report.clips`；该 ID 在项目内唯一、从不复用，每个片段操作都用 `clip` 参数按它指定片段。

<a id="model-catalog"></a>
## 模型目录

模型目录是 [`@dv/models`](../../packages/dv/models/README.zh.md) 的 `dvModels` 服务，它是一个能力 seam，其 Service Provider 是提供方插件（如 [`@dv/fastvideo`](../../packages/dv/fastvideo/README.zh.md) 和 [`@dv/sglang-omni`](../../packages/dv/sglang-omni/README.zh.md)），其 Consumer 包括 `@dv/shot-render`、[`@dv/image-generate`](../../packages/dv/image-generate/README.zh.md) 和 [`@dv/audio-generate`](../../packages/dv/audio-generate/README.zh.md)。每个镜头、每张图片和每段音频用其 `modality`、`task`、`provider` 和 `model` 所指定的模型目录条目渲染；[`@dv/models` README](../../packages/dv/models/README.zh.md) 定义键、条目、渲染请求、智能体工具，以及添加提供方、模型或服务器的步骤。

`shot.render` 的 precondition 对每个调用方都拒绝：不在模型目录中的模型键、缺少提示词、超出条目事实的参数、多于一个的首帧，以及条目拒绝的渲染请求。每个条目的 `validateGenerationRequest(request)` 负责模型的请求规则，例如输入接受的媒体类型和数量（`fasth3` 在生成任务 `ref2v` 下至少一个参考素材）、模型不接受的首帧，以及无效的 `extra` 值；`shot.render` 组装请求，在写入记录前和真正渲染前各调用一次，自己不检查任何模型规则。分镜计划的每个镜头写明自己的 `modality`、`task`、`provider` 和 `model`；生成任务为 `ref2v` 的镜头使用自己的参考素材，没有时使用计划的参考素材，`continue_previous: true` 让该镜头从上一个镜头的最后一张静帧开始。`plan.create` 和 `plan.update` 拒绝生成任务不是 `ref2v` 却带参考素材的镜头，以及镜头 1 上或生成任务不是 `ref2v` 的镜头上的 `continue_previous`。

## 操作记录

项目的每次变化都是项目 `records.jsonl` 文件中的一条记录，只有 `@dv/project` 读写这个文件。每条记录的 `kind` 都是 `'operation'`：它是一次操作调用。一条记录包含：谁（`actor`：`user`、`agent` 或 `system`）、来源（`surface`：`chat`、`canvas`、`timeline`、`asset_pool`、`history` 或 `api`）、原因（`intent`：智能体的 `reason` 参数，或对人的手势的简短描述）、所属组件（`component`）和操作（`operation`）及其版本、参数、各输入及其解析到的素材（`resolved_asset`）、输出、状态、父记录，以及两个链接：`based_on`（本记录带修改地重复那条记录，例如改了提示词的新版本）和 `supersedes`（本记录替代那些记录的输出）。字段 `session`、`turn` 和 `tool_call` 把记录链接到产生它的对话的 DSH 会话日志：对话 ID、该会话的 DSH 轮次编号和工具调用 ID；对话本身留在会话日志中。记录只追加不改写；状态变化、成本和报告以更新行追加。每条记录的父记录是写入它时项目的当前位置（[历史规则](#history-rules)）。项目组件自己的动作也是记录（`proj.create`、`proj.stale_accept`），而撤销、重做、移到某一步，以及 `dv_proj_state`、`dv_proj_history_list` 和 `inspect.*` 操作这类读取都不写记录。

<a id="history-rules"></a>
## 历史规则

这些规则说明哪些修改是步骤。这些规则也说明撤销、重做和"回到某一步"做什么。这些规则适用于用户、智能体和系统。这个模型和图片编辑软件的历史面板相同。

1. **修改项目内容是一步。**
   - 项目内容是素材、画布上的素材、角色、场景、风格、分镜计划、渲染、时间线和导出。
   - 用户的步骤和智能体的步骤在同一个历史列表中，按时间顺序排列。
   - 修改视图不是一步。视图是平移、缩放、节点位置、选中项、所显示的视图和打开的面板。
   - 修改项目名称不是一步。删除项目不是一步。
2. **撤销、重做和"回到某一步"移动当前位置。**
   - 当前位置是历史列表中的一步。项目显示这一步的状态。
   - 撤销把当前位置往回移一步。Ctrl+Z、撤销按钮和 `dv_proj_undo` 执行撤销。
   - 重做把当前位置往前移一步。Shift+Ctrl+Z、重做按钮和 `dv_proj_redo` 执行重做。
   - "回到某一步"把当前位置移到所选的那一步。历史行 ⋮ 菜单中的 回到这一步 执行这个操作。带 `to` 的 `dv_proj_undo` 也执行这个操作。
   - 这些移动不在历史列表中加一步。
3. **在当前位置之后加一步，会丢弃后面的步骤。**
   - 如果当前位置不是最后一步，历史面板把后面的步骤显示为灰色。
   - 如果这时你或智能体加了一步，历史列表丢弃后面的步骤。
   - 被丢弃的步骤不能找回。
   - 如果被丢弃的步骤没有完成，系统取消它。例如，渲染停止。
4. **导入的素材一直保留；生成的素材跟随当前位置。**
   - 导入的素材是某一步导入的素材。导入的素材留在素材库中，它的那一步被丢弃时也一样。
   - 生成的素材是某一步生成的素材，例如渲染、静帧或导出。只有当它的那一步在当前位置或之前时，素材库才显示这个生成的素材。
   - 所有素材的文件都留在磁盘上。

`@dv/project` 实现这些规则。每个项目有一个 `line.json` 文件，内容是 `{tip, at}`：`tip` 是最后一步，历史列表是 `tip` 的 `parents[0]` 祖先链；`at` 是当前位置。撤销、重做和移到某一步只改变 `at`，不写记录。一次写入把它的记录追加在 `at` 之后，并把 `tip` 和 `at` 都设为这条记录，因此原来在 `at` 之后的步骤离开历史列表；它们的行仍留在 `records.jsonl` 中。运行器取消其中每个尚未结束的步骤，错误为 `error.code: 'discarded'`。`dvProject.undo` 拒绝从第一条记录再往回移（`nothing_to_undo`），也拒绝移到被丢弃的记录（`invalid_params`）；`dvProject.redo` 拒绝从最后一步再往前移（`nothing_to_redo`）。

## 操作如何运行

视图和智能体到达同样的操作。画布、时间线、素材库面板或历史面板上的手势通过 `@dv/api` 的路由运行一个操作，带 `actor: 'user'`，`surface` 设为该视图。智能体调用该操作的 `dv_*` 工具，工具以 `actor: 'agent'`、`surface: 'chat'`、对话、轮次和工具调用 ID 运行它。智能体的调用运行之前，操作的 `prepareToolCall` 可以拒绝或修改它，然后项目组件应用该操作的 `confirm` 策略。每次调用都经过 `dvProject.run` 的运行器。运行器先校验参数；然后在项目锁内把每个输入解析为素材，并调用操作的 `precondition`，它在写入任何记录之前拒绝调用，对每个调用方都生效（`shot.render` 和 `story.approve` 拒绝模型的目录条目所拒绝的渲染请求，例如生成任务 `ref2v` 下没有参考素材的 `fasth3` 渲染）。运行器随后追加 `pending` 记录，并把操作自己的 `supersedes` 指出的记录加入该记录的 `supersedes`。最后运行器在锁外运行所属组件的实现，并追加带输出、成本和报告的最终更新行。输入指向未完成记录的调用，以及批准计划时排定的每次渲染，都在项目组件的调度器中等待，直到其输入完成。

<a id="confirmation-in-the-conversation"></a>
## 在对话中确认

智能体在对话中征得用户同意，问题用粗体显示。`OperationSpec.confirm` 声明智能体的调用何时需要这一同意：

| `confirm`         | 仅工具参数            | 智能体调用被拒绝的条件                                                                          | 操作              |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------ | --------------- |
| `never`           | —                | 从不                                                                                   | 其他所有操作          |
| `always`          | `user_approved`  | 没有带 `user_approved: true`                                                            | `story.approve` |
| `over_gpu_budget` | `user_requested` | 没有带 `user_requested: true`，且本轮次的 GPU 秒数超过 `dvProject` 的 `confirmGpuSecondsThreshold` | `shot.render`   |

本轮次的 GPU 秒数是本轮次已完成记录的成本、未完成记录的 `estimate`，加上本次调用的 GPU 预估。`confirm` 不为 `never` 的操作提供 `confirmSummary(call, state)`，它返回 `{text, gpu_seconds}`：调用将做什么（对 `story.approve`，每个镜头一行，写出其模型键（`modality/task/provider/model`）、时长、是否接上一镜头和提示词）及其 GPU 预估。拒绝是一个工具错误，它带着这段文字，并告诉智能体把它展示给用户、在对话中用粗体提问，在用户同意后带上该参数重新调用。被拒绝的调用不写入任何东西，该参数从不进入记录的参数，人和 system 的调用从不被拒绝。

## 项目状态

归约函数读取记录并计算状态；它不写记录。运行器和记录存储是仅有的写入者。当前状态是把以当前位置结尾的链交给归约函数折叠的结果：项目组件从这条记录沿 `parents[0]` 往回走，再把这些记录按从旧到新的顺序交给每个已注册的归约函数。每个组件的归约函数把自己的记录变成 `ProjectState.components` 中自己的切片（角色 `character`、场景 `location`、风格 `style`、分镜 `plan`、时间线 `timeline`、故事工作流 `story`），项目组件自己的归约函数维护 `proj` 切片：这条链上的记录、过期和被替代的记录，以及创建每个素材的记录。归约函数的 `agentSummary` 把该组件的字段加入 `dv_proj_*` 工具和 `dv:project` 提示词段交给智能体的项目摘要。

视图显示的要么是记录，要么是状态。历史面板列出记录：历史列表中的步骤，最新的在前；被丢弃的记录不显示。画布、时间线编辑器和素材库面板显示状态：当前状态，因此撤销、重做或移到某一步会改变它们画出的内容。素材库面板列出当前状态中的每个素材，以及项目中每个导入的素材，包括被丢弃的步骤导入的素材（[历史规则](#history-rules)第 4 条）。没有视图持有项目状态：每个视图获取当前状态，并在实时事件流的每个事件后重新获取。

## 智能体读到什么

智能体通过三个渠道读取项目，每个渠道归拥有其内容的包所有：

- **工具。** 每个操作的 `description` 说明它的工具怎么用；[`@dv/project`](../../packages/dv/project/README.zh.md) 根据 `OperationSpec` 构建工具。
- **`dv:project` 提示词段。** `@dv/project` 在 DSH `systemPrompt` 服务挂载时注册它。它先写项目组件的规则（每次修改都是一步，撤销和重做移动当前位置，新的修改丢弃后面的步骤，如何称呼记录、素材、版本和片段，在对话中确认，过期记录），再写当前状态的项目摘要。它不包含用户看不到的任何东西：没有视图中的选中项，也没有偏好。
- **对话引用。** [`@dv/chat-references`](../../packages/dv/chat-references/README.zh.md) 在 `agent/pre-step` 把输入框为 `@` 和 `+ → 引用` 写下的 `dv:` 提及展开成一条带具体记录和素材 ID 的上下文消息，以用户身份用 `asset.import` 导入用户在对话中附上的图片，并把这些图片和消息提及的素材放到画布上；会话的下一次工具调用等待导入完成。

skill 承载工作流程和模型专属的规则，各由其主人注册：

| Skill                                                | 主人                                                                              | 注册途径                  | 内容                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `video-directing`                                    | [`@dv/bundle`](../../packages/bundle/dv/README.zh.md)（`skills/video-directing`） | `skill-filesystem` 目录 | 跨组件的做计划流程：故事及其镜头、每个镜头的模型和输入、按该模型和生成任务的提示词 skill 写提示词、重拍和过时镜头                |
| `timeline-editing`                                   | [`@dv/timeline`](../../packages/dv/timeline/README.zh.md)                       | `ctx.skills`          | 编辑时间线和片段                                                                    |
| `character`                                          | [`@dv/character`](../../packages/dv/character/README.zh.md)                     | `ctx.skills`          | 创建和更新角色，以及每个工具的参数                                                           |
| `location`                                           | [`@dv/location`](../../packages/dv/location/README.zh.md)                       | `ctx.skills`          | 创建和更新场景，以及每个工具的参数                                                           |
| `style`                                              | [`@dv/style`](../../packages/dv/style/README.zh.md)                             | `ctx.skills`          | 创建和更新风格，以及每个工具的参数                                                           |
| `story-directing`                                    | [`@dv/workflow-story`](../../packages/dv/workflow-story/README.zh.md)           | `ctx.skills`          | 从已规划的镜头到渲染好的镜头的调用顺序：新建或更新计划、预览、询问用户、批准、等待                                   |
| `video-model-selection`                              | [`@dv/models`](../../packages/dv/models/README.zh.md)                           | `ctx.skills`          | 用 `dv_models_list` 和 `dv_models_get` 为每个镜头选择模型，以及何时询问用户                     |
| `fasth3-reference-prompting`、`fasth3-text-prompting` | 模型的提供方插件（[`@dv/fastvideo`](../../packages/dv/fastvideo/README.zh.md)）           | `ctx.skills`          | 该生成任务下模型的限制和提示词规则                                                           |
| `fish-audio-drama-3-prompting`                        | [`@dv/sglang-omni`](../../packages/dv/sglang-omni/README.zh.md)                             | `ctx.skills`          | `fish-audio-drama-3` 在任务 `t2a` 下的提示词标记：说话人标签、声音事件、片段长度和声音        |

## API 和视图

[`@dv/api`](../../packages/dv/api/README.zh.md) 是项目组件面向浏览器的 HTTP 面：`/api/dv/state` 把项目的当前状态返回为一份 JSON 文档，`/api/dv/operations` 列出已注册的操作，`/api/dv/operation` 以用户身份运行一个操作，其记录带 `surface: 'canvas'`、`'timeline'` 或 `'asset_pool'`，`/api/dv/history` 返回历史的一页，`/api/dv/undo`、`/api/dv/redo` 和 `/api/dv/stale/accept` 暴露撤销、重做和过期操作，其他路由管理项目、素材导入、画布布局（节点位置和视口）和 Workspace 链接，`/dv/events` 推送每一次记录追加、记录更新和当前位置的移动。

界面各包是 web 应用的右侧栏标签类型和中央视图，因此在同一个 profile 里与对话页并存。[`@dv/ui-shell`](../../packages/dv/ui-shell/README.zh.md) 把项目工作区放在中央，把 对话 / Chat 和 轨迹 / Trajectory 标签放在右侧，把 画布 / Canvas 和 时间线 / Timeline 切换按钮放在顶栏，并把 Ctrl+Z 绑定到撤销，把 Shift+Ctrl+Z 绑定到重做。[`@dv/ui-canvas`](../../packages/dv/ui-canvas/README.zh.md) 把当前状态画成按素材流向相连的节点，每个节点都来自 UI 插件通过 `@dv/ui-canvas/contract` 注册的节点类型：画布上的素材（`@dv/ui-asset-pool`），带模型和生成任务的版本（`@dv/ui-shot-render`，用 `@dv/ui-generation` 的 `defineGenerationUi` 声明），处于当前版本的角色、场景和风格（`@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`，用 `@dv/ui-reference-kit` 的 `defineReferenceUi` 声明），以及处于最新版次的每个分镜计划，写出每个镜头的模型和生成任务，设置了的写出 接上一镜头 / Continues the previous shot（`@dv/ui-shot-plan`）；`@dv/ui-workflow-story` 把一次故事批准的版本挂在分镜计划节点下。`@dv/ui-canvas` 标记过期记录，它的编辑器以用户记录渲染新版本或替换参考图。UI 插件还添加节点动作，例如 `@dv/ui-composer` 的 问 agent / Ask the agent（预填对话输入框）和 `@dv/ui-asset-pool` 的 从画布移除 / Remove from canvas。[`@dv/ui-timeline`](../../packages/dv/ui-timeline/README.zh.md) 把每条时间线画成一条轨道，把插入、移动、移除、拆分和裁剪手势变成按 `ClipId` 指定片段的 `timeline.*` 记录，把导出变成一条 `timeline.export` 记录。`@dv/ui-asset-pool` 列出项目的每个素材并导入文件；`@dv/ui-composer` 为对话加上 `@` 和 `+ → 引用` 引用和面向创作者的工具名，`@dv/ui-shot-render` 加上 `dv_shot_render` 的对话卡片。[`@dv/ui-media`](../../packages/dv/ui-media/README.zh.md) 通过它的 `dv.media` 组件工厂、按 `@dv/ui-asset-pool` 注册的图片、视频和音频视图绘制这些视图里的每个素材，并打开素材预览，预览里的按钮 插入片段 和 让智能体使用 分别来自 `@dv/ui-timeline` 和 `@dv/ui-composer`。

## 历史和轨迹

历史是项目历史列表中按顺序排列的步骤，来自每个发起者、视图和对话；轨迹是智能体在一个对话中的步骤。记录通过它的 `session` 和 `tool_call` 字段把两者连起来。[`@dv/ui-history`](../../packages/dv/ui-history/README.zh.md) 是历史面板（标签类型 `dv-history`）。它把历史列表中的每一步各列为一行，最新的在前，显示动作、谁做的（你 / You、智能体 / Agent、自动 / Automatic）、状态，媒体行还有一张缩略图；当前位置标 当前 / Current，它之后的步骤显示为灰色，一条记录启动的记录折叠在它那一行之下，例如批准分镜计划时排定的渲染。UI 插件在 `dvHistory.rows`（`@dv/ui-history/contract`）里注册其操作的行。一行指定记录的主体、它的中间区域目标、它的缩略图素材，以及折叠在它下面的记录的名称。历史通过 `@dv/ui-media` 的 `dv.media` 组件工厂绘制缩略图和选中行的输出。它的顶部放着撤销和重做按钮。每一行的 ⋮ 菜单提供 回到这一步 / Go back to this step，它把当前位置移到那一行（[历史规则](#history-rules)）。选中当前位置或之前某一步的那一行，会以该行的中间区域目标（一个 `dv.center.view` 条目和其中的目标）调用 `@dv/ui-shell` 的 `dvCenter.show`，例如时间线上该记录的片段（`{ view: 'timeline', target: { timeline, clip } }`），否则是画布上该记录的节点（`{ view: 'canvas', target: { record } }`）；行内的 在轨迹中查看 / Show in trajectory 链接发出 `dv:trajectory-focus`，`@dv/ui-shell` 随即在那个对话的那次工具调用处打开 轨迹。在对话中，写入记录的工具的每个已结束行都有 在历史中查看 / Show in history 链接，它发出 `dv:history-focus`，让历史面板选中那次工具调用写入的记录。对话的媒体说明用 `dvHistory.describe` 为记录命名，即历史为它显示的名称。

## 过期

项目组件的归约函数标记过期记录，不重跑任何东西。当一条记录在 `supersedes` 中列出记录 X 时，每条读取了 X 的输出的记录，以及这类记录下游的每条记录，都变为过期；之后读取的输入若其产生者已被替代或已过期，该记录也过期。输入的产生者是创建其素材的记录；对角色、场景或风格的版本，是写入该版本的记录。调用替代哪些记录由所属操作通过 `OperationSpec.supersedes` 决定：`character.update`、`location.update` 和 `style.update` 替代创建上一版本的记录，因此读取了上一版本的每条记录都过期。调用方也可以在 `supersedes` 中指定记录，智能体为替换某个镜头的重拍就这样做。过期记录只在智能体或人决定时重跑；`proj.stale_accept` 清除一条记录的标记，并使其消费者不再因它而过期。

## 确定性复用

当 `deterministic: true` 的操作以与一条更早的 `done` 记录相同的操作和版本、相等的参数和相同的已解析输入素材被调用时，运行器复用那条记录的输出而不运行该操作；本次调用仍被记录，并带 `cost.reused: true`。渲染不是确定性的：再次渲染一个镜头得到一个新版本，即一条 `based_on` 指向更早那次渲染的 `shot.render` 记录，不论每个版本用的是哪个模型和哪个生成任务。

<a id="where-new-behavior-goes"></a>
## 新行为的归属位置

DreamVerse 的新行为挂在某个包已拥有的扩展点上，就像 DeepSeek Harness 的新行为遵循[架构页](../architecture.zh.md)中“新行为的归属位置”一节那样。

### 原则

1. **每样东西只有一个主人。** 每份数据、每项能力、每段给智能体的文字都属于一个插件，由这个插件自己到扩展点上注册。
2. **插件能用一句话说出自己拥有什么。** 只能描述成“把 A 接到 B”的插件什么也不拥有，要拆分给 A 和 B 的主人。
3. **新行为挂在已有的扩展点上**，扩展点从下面的查表中选。
4. **只有可替换的能力才做成能力 seam。** 有两个或更多可互换实现的能力，才做成一个 Service Definition 包加若干 Service Provider 包。
5. **依赖只朝一个方向：** 视图 → `@dv/api` → `@dv/project` ← 组件 ← 工作流；组件 → 基础库和 Service Definition ← Service Provider。没有包反方向依赖，也没有包在代码里写死别的插件的操作名。
6. **给智能体的文字跟着主人走**，按下表放置：

| 文字讲的是                | 放在哪里                                                     |
| -------------------- | -------------------------------------------------------- |
| 一个组件的工具怎么用           | 该操作的 `description`                                       |
| 跨多个组件的做事流程           | `@dv/bundle` 或拥有该流程的工作流中的一个 skill（`story-directing`）     |
| 模型的限制和提示词写法，例如参考素材要求 | 模型的提供方插件为该生成任务注册的提示词 skill                               |
| 如何为镜头选择模型            | `@dv/models` 的 `video-model-selection` skill             |
| 每轮都会变的项目状态           | `@dv/project` 的 `dv:project` 提示词段，经由归约函数的 `agentSummary` |

### 流程

加一样新东西时，按顺序回答这些问题：

1. 它是哪一类：项目数据、操作、可替换能力、模型、给智能体的文字、视图，还是接到智能体循环上的逻辑？
2. 它的主人是谁？没有包拥有它时，新建一个组件，并写下说明它拥有什么的那一句话。
3. 它挂在哪个扩展点上？查下面的查表。
4. 它需要可替换吗？需要就做成能力 seam；不需要，它就是普通插件中的一个注册项。
5. 它带不带给智能体的文字？带的话，按原则中的文字表把文字放到它的主人那里。

最后检查：主人的那一句话仍然成立；代码里没有写死另一个包的插件名；没有依赖违背原则 5 的方向。

### 查表

| 要加的东西       | 做法                                                                                                                                                                                                    | 例子                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 项目数据        | 加进主人组件的归约函数状态，并在 `agentSummary` 中给出摘要                                                                                                                                                                 | 镜头的配乐                      |
| 操作          | 在主人组件中 `registerOperation`；项目组件据此生成工具、API 路由、历史和撤销                                                                                                                                                    | `timeline.clip_split`      |
| 可替换能力       | 一个 Service Definition 包加若干 Service Provider 包；用到它的组件是 Consumer                                                                                                                                        | 模型目录、3D 渲染                 |
| 模型          | 提供方插件的修改；见[添加提供方或模型](../../packages/dv/models/README.zh.md#add-a-provider-or-a-model)                                                                                                                 | `@dv/fastvideo` 的 `fasth3` |
| 生成任务        | 一个 `TaskMap` 条目，由引入该生成任务的插件声明（[模型键](../../packages/dv/models/README.zh.md#model-keys)），再加上它在其原语声明的 `tasks` 记录中的标签；生成任务若有任何原语都没有的输入角色，就有自己的原语包                                                         | 由首帧和尾帧渲染的生成任务              |
| 输出模态        | 一个 `PrimitiveTypes` 行（[模型键](../../packages/dv/models/README.zh.md#model-keys)），并带上在其上运行的生成任务、一个调用 `@dv/generation` 的 `defineGeneration` 的原语包，以及它的调用 `@dv/ui-generation` 的 `defineGenerationUi` 的 UI 包 | 图像生成                       |
| 引用名词        | 两个声明：`@dv/reference-kit` 的 `defineReference` 和 `@dv/ui-reference-kit` 的 `defineReferenceUi`                                                                                                           | `@dv/character`            |
| 制作流程        | 一个工作流包 `@dv/workflow-<key>` 及其 UI 半部                                                                                                                                                                  | `@dv/workflow-story`       |
| 给智能体的文字     | 按原则中的文字表放置                                                                                                                                                                                            | “先出分镜计划再渲染”                |
| 视图          | 一个只通过 `@dv/api` 读写、并通过 `@dv/ui-canvas`、`@dv/ui-history` 和 `@dv/ui-composer` 的注册表绘制的 `@dv/ui-*` 插件                                                                                                     | 画布                         |
| 接到智能体循环上的逻辑 | 由数据的主人在 DSH 事件上注册，例如 `agent/pre-step` 或 `tools/pre-execute`                                                                                                                                           | `dv:` 提及展开                 |

### 例子：不带参考图的渲染

1. 类别：服务某个生成任务的一个模型；生成任务 `t2v` 已在 `@dv/models` 的 `TaskMap` 中存在。
2. 主人：服务该模型的提供方插件；`@dv/fastvideo` 为生成任务 `t2v` 服务 `fasth3`。
3. 扩展点：`@dv/fastvideo` 在其 `SERVED` 表中为 `fasth3` 声明生成任务 `t2v`，并在配置为该生成任务指定服务器时注册条目 `video/t2v/fastvideo/fasth3`；`@dv/shot-render` 无需改动，因为 `dv_shot_render` 接受每个已注册的条目。
4. 可替换：是；另一个提供方插件可以为生成任务 `t2v` 注册另一个模型，智能体用 `dv_models_list`、`dv_models_get` 和 `video-model-selection` skill 在它们之间选择。
5. 文字：`fasth3` 在生成任务 `t2v` 下的提示词规则是该提供方插件的 skill `fasth3-text-prompting`；“每个镜头必须有参考素材”只是 `fasth3` 在生成任务 `ref2v` 下的输入要求，由它的 `schema()` 报告、由它的 `validateGenerationRequest` 执行，写在 skill `fasth3-reference-prompting` 和 `dv_shot_render` 的拒绝文本里。

<a id="glossary"></a>
## 术语表

代码、记录字段、工具描述、文档和界面文案都使用这些名称，每个名称只有一个含义。zh / en 一列是界面显示的文案。

### 概念

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
| history          | 历史 / History          | 项目按顺序排列的步骤：历史列表（[历史规则](#history-rules)）。                                                                                                    |
| step             | 一步 / Step             | 历史列表中的一条记录；撤销把当前位置往回移一步，重做把它往前移一步。                                                                                                          |
| discard          | 丢弃 / Discard          | 新的一步对当前位置之后各步骤的作用：它们永久离开历史列表，未完成的会被取消。                                                                                                      |
| trajectory       | 轨迹 / Trajectory       | 智能体在一个对话中的步骤。                                                                                                                               |
| surface          | 来源 / Surface          | 记录字段，写出调用来自哪里：`chat`、`canvas`、`timeline`、`asset_pool`、`history` 或 `api`。                                                                    |

### ID 和类型

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

### 组件和其他包

| 组件                   | 键          | 包                    | 服务             | 操作                                                                                                                                                                                                                              |
| -------------------- | ---------- | -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project 项目           | `proj`     | `@dv/project`        | `dvProject`    | `proj.create` `proj.stale_accept`；历史工具 `dv_proj_undo` `dv_proj_redo`；读取工具 `dv_proj_open` `dv_proj_state` `dv_proj_history_list` `dv_proj_wait`；重命名工具 `dv_proj_rename`                                                           |
| Asset pool 素材库       | `asset`    | `@dv/asset-pool`     | `dvAssetPool`  | `asset.import` `asset.grab_still` `asset.cut_segment` `asset.place` `asset.unplace`                                                                                                                                             |
| Character 角色         | `character` | `@dv/character`      | `dvCharacter`  | `character.create` `character.update`                                                                                                                                                                                           |
| Location 场景          | `location` | `@dv/location`       | `dvLocation`   | `location.create` `location.update`                                                                                                                                                                                             |
| Style 风格             | `style`    | `@dv/style`          | `dvStyle`      | `style.create` `style.update`                                                                                                                                                                                                   |
| Shot plan 分镜         | `plan`     | `@dv/shot-plan`      | `dvShotPlan`   | `plan.create` `plan.update`                                                                                                                                                                                                     |
| Story workflow 故事工作流 | `story`    | `@dv/workflow-story` | `dvStory`      | `story.approve`；读取 `story.preview`                                                                                                                                                                                              |
| Shot render 镜头渲染     | `shot`     | `@dv/shot-render`    | `dvShotRender` | `shot.render`（模型目录中有 `t2v` 或 `ref2v` 条目时）                                                                                                                                                                                       |
| Image 图片               | `image`    | `@dv/image-generate` | `dvImageGenerate` | `image.generate`（模型目录中有 `t2i` 条目时） |
| Audio 音频             | `audio`    | `@dv/audio-generate` | `dvAudioGenerate` | `audio.generate`（模型目录中有 `t2a` 条目时）                                                                                                                                                                                              |
| Timeline 时间线         | `timeline` | `@dv/timeline`       | `dvTimeline`   | `timeline.create` `timeline.update` `timeline.rename` `timeline.delete` `timeline.clip_insert` `timeline.clip_move` `timeline.clip_remove` `timeline.clip_split` `timeline.clip_trim` `timeline.clip_replace` `timeline.export` |
| Inspector 检查器        | `inspect`  | `@dv/inspector`      | `dvInspector`  | 读取 `inspect.image` `inspect.asset`                                                                                                                                                                                              |

操作名为 `<key>.<verb>` 或 `<key>.<object>_<verb>`，它的智能体工具名是 `dv_` 加上把 `.` 换成 `_` 的操作名（`timeline.clip_move` → `dv_timeline_clip_move`）。模型读到的文字写工具名，从不写操作名。其他包是模型目录 `@dv/models`（`dvModels`）和提供方插件 `@dv/fastvideo`、`@dv/sglang-diffusion` 与 `@dv/sglang-omni`、对话引用 `@dv/chat-references`（`dvChatReferences`）、API 接口（`@dv/api`，`dvApi`）、库 `@dv/generation`、`@dv/reference-kit` 和 `@dv/workflow-kit`、bundle（`@dv/bundle`）和界面（`@dv/ui-shell`、`@dv/ui-canvas`、`@dv/ui-timeline`、`@dv/ui-asset-pool`、`@dv/ui-composer`、`@dv/ui-history`、库 `@dv/ui-kit`，以及 `@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`、`@dv/ui-shot-plan`、`@dv/ui-shot-render` 和 `@dv/ui-workflow-story`）。以产品命名的名称用 `dv`：路由 `/api/dv/…` 和 `/dv/events`、窗口事件 `dv:…`、页面全局变量 `__dv…`、测试 ID `dv-<area>-<thing>`。

### 动词

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

### 界面文案

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
