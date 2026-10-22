# 镜头与时间线

[English](shots-and-timeline.md) | 中文

本页是 DreamVerse 项目中镜头和时间线的参考。它描述分镜计划、渲染及其版本（take）、实时渲染流、时间线和片段、在用的版本、导出，以及检查器。五个服务提供这些内容。[`@dv/shot-plan`](../../../packages/dv/shot-plan/README.zh.md) 提供 `dvShotPlan`，[`@dv/shot-render`](../../../packages/dv/shot-render/README.zh.md) 提供 `dvShotRender`，[`@dv/timeline`](../../../packages/dv/timeline/README.zh.md) 提供 `dvTimeline`，[`@dv/inspector`](../../../packages/dv/inspector/README.zh.md) 提供 `dvInspector`，[`@video-harness/stream`](../../../packages/video-harness/stream/README.zh.md) 提供 `vhStream`。agent（智能体）通过 `dv_*` 工具调用它们的操作，视图通过 `@dv/api` 运行这些操作。故事工作流 `@dv/workflow-story` 调用 `dvShotPlan`、`dvShotRender` 和 `dvTimeline`（[工作流](workflows.zh.md)）。每个包的 README 定义该包自己的契约。

<a id="plans"></a>
## 分镜计划

分镜计划是一段视频在渲染任何内容之前的镜头列表。`plan.create` 写入新分镜计划的版次 1，并给它一个 `PlanId`。`p` 之后的编号比项目历史中最大的分镜计划编号大一。`plan.update` 写入其 `plan` 参数所指分镜计划的下一个版次，包含该版次的每个镜头。`plan` 归约函数在 `plan` 切片中保存每个分镜计划的每个版次。

镜头用键（`modality`、`task`、`provider` 和 `model`）写明渲染它的模型，并保存它的提示词。[`@dv/shot-plan` README](../../../packages/dv/shot-plan/README.zh.md) 列出镜头和分镜计划的其他字段。分镜计划按原样保存每个模型键，从不读取模型目录。批准分镜计划的工作流检查这个键。

在写下记录之前，对每个调用方，`plan.create` 和 `plan.update` 在以下情况拒绝分镜计划：

- 某个镜头带参考素材，而它的生成任务不是 `ref2v`。
- 某个镜头带 `continue_previous`，而它是镜头 1，或它的生成任务不是 `ref2v`。
- 某个提示词引用了首帧（`dv:input/first_frame`），而该镜头不接续上一个镜头。
- 某个参考指向引用类别的未知版本。
- `plan.update` 的 `plan` 参数指向未知的分镜计划。

`dvShotPlan.shots(state, plan, version?)` 为每个工作流以同样的方式解析一个版次的镜头。每个 `ResolvedShot` 带有从 1 开始的 `slot`、分镜计划级别的值、适用于该镜头的参考素材，以及 `continuePrevious`。在浏览器中，`@dv/ui-shot-plan` 的 `plansOf(state)` 读取 `plan` 切片，`@dv/shot-plan` 未加载时返回 `{}`。分镜计划本身不渲染任何内容。工作流插件批准一个版次并渲染它的镜头（[工作流](workflows.zh.md)）。

<a id="renders-and-takes"></a>
## 渲染与版本

一个版本是一条 `shot.render` 记录。它用该记录的模型键所指的模型目录条目对一个镜头做一次渲染（[`shot.render`](generation.zh.md#shot-render)）。版本的输出是 `video` 和 `last_still`，后者是视频最后一帧的 PNG 图片。版本的成本是后端报告的 GPU 时间。

渲染不是确定性的，所以每次调用都写入一个新版本。重拍用 `based_on` 指向先前的版本，无论每个版本用的是哪个模型。工作流安排的渲染带有 `started_by`，其中有起始记录和镜头的位置。agent 调用用仅限工具的参数 `continue_from` 从先前某个版本的最后静帧开始（[`shot.render`](generation.zh.md#shot-render)）。工作流渲染带 `continue_previous` 的分镜计划镜头时，把上一个镜头的版本的输出 `#1` 加为 `first_frame` 输入。工作流用 `dvShotRender.findTake` 查找可复用的版本，它比较已声明的参数和输入（[`GenerationApi`](generation.zh.md#define-generation)）。

<a id="live-render-stream"></a>
## 实时渲染流

`@video-harness/stream` 在版本渲染期间把它的视频发给浏览器。`shot.render` 在每次渲染时用 `ctx.get` 查找 `vhStream` 服务。该服务存在时，`shot.render` 在模型产生视频分块时把它们写入 `vhStream.openSegment(project, record, {mime, segmentIdx})`。记录 ID 成为浏览器收到的 `stream_id`，`started_by.slot` 成为 `segment_idx`（没有位置的渲染为 0）。

浏览器打开 DSH Web 服务器的 WebSocket 路由 `/vh/ws`，并发送 `{type: 'subscribe', project_id}`。对项目的每个版本，该路由发送 `media_init`、二进制 fMP4 分块和 `media_segment_complete`。在渲染中途订阅的浏览器先收到该路由已发出的分块，以 `bufferBytes` 为上限。同一个 socket 还发送 `dvProject` 的记录变化（`op`）和当前位置的移动（`line`）。[`@video-harness/stream` README](../../../packages/video-harness/stream/README.zh.md) 定义这些消息和配置。

`@dv/bundle` 不挂载 `@video-harness/stream`。挂载该插件的 profile 获得这条路由。没有该插件时，`shot.render` 以同样的方式渲染和存储版本。

<a id="timelines-and-clips"></a>
## 时间线与片段

时间线是项目的一段剪辑后的视频。它有一个 `TimelineId`（`t1`、`t2`……）、一个名称，以及按播放顺序排列的片段。片段播放一个素材从 `in_sec` 到 `out_sec` 的部分；为 null 的点表示素材的开头或结尾。`ClipId`（`cl1`、`cl2`……）在项目中唯一，且从不再次使用。添加片段的操作分配这些 ID 并把它们存入 `report.clips`，`timeline` 归约函数只从那里读取 ID。

`@dv/timeline` 注册[术语表](../glossary.zh.md)为组件 `timeline` 列出的操作。除 `timeline.export` 外，这些操作都是编辑操作。编辑操作只写自己的记录，从不创建文件。名为 `timeline.clip_<verb>` 的编辑操作修改片段，其他编辑操作修改整条时间线。

每个编辑在 `execute` 中用状态检查调用。调用无法应用时，编辑以原因使记录失败。

`timeline.create` 和 `timeline.update` 在 `pendingInputRoles` 中声明输入角色 `clip`，因此片段输入可以指向尚未完成的渲染的输出。这样的片段是占位片段。它的 `asset` 为 null，它的 `source` 指向渲染输出。渲染完成时片段得到素材；渲染失败时片段仍是占位片段。`ClipStatus` 由来源记录推导，从不存储。它有三个值：

- 片段有素材时为 `ready`。
- 来源记录为 pending 或 running 时为 `rendering`。
- 其他情况为 `failed`。

裁剪和分割拒绝占位片段。移动、移除和替换接受它。

工作流用 `dvTimeline.layout(call)` 排布版本。该方法写入一条对指定时间线的 `timeline.update`，或一条对下一个空闲 `t<n>` 的 `timeline.create`。`dvTimeline.lastWrite(state, timeline)` 返回一条时间线最新的已完成 create 或 update 记录。

<a id="takes-in-use"></a>
## 在用的版本

当项目数据使用某个版本的输出时，画布绘制该版本，即使该版本来自更早的一次工作流运行。UI 插件用 `dvCanvas.takesInUse` 中的 `TakesInUse` 描述符报告其数据使用的版本：

- 对每条时间线的每个片段，`@dv/ui-timeline` 报告该片段等待的渲染。片段不等待任何渲染时，`@dv/ui-timeline` 报告创建该片段素材的记录。它还在每个带入点或出点的片段的素材上加徽标 已裁剪 / Trimmed。
- `@dv/ui-shot-plan` 报告创建每个分镜计划最新版次参考素材的记录。
- `@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style` 报告创建每个条目最新版本参考素材的记录。

撤销或移到更早的一步会改变当前状态，因此也会改变在用的版本。[`@dv/ui-canvas` README](../../../packages/dv/ui-canvas/README.zh.md) 定义画布绘制哪些版本。

<a id="export"></a>
## 导出

`timeline.export` 把一条时间线写成一个 MP4 素材，即记录的 `video` 输出。`timeline` 参数指定时间线；没有该参数时，操作导出第一条时间线。它通过 `dvFfmpeg` 裁剪每个带入点或出点的片段，然后按播放顺序拼接所有片段。该操作在 `cpu` 资源类别中运行，从不请求同意，且不是确定性的，所以每次调用都重新导出。`timeline` 归约函数忽略导出记录，所以导出不改变任何时间线。`timeline.export` 在写下记录之前拒绝带占位片段的时间线。拒绝理由列出片段位置，例如 `Clips 3, 5 of timeline t1 are not ready yet.`。

<a id="inspector"></a>
## 检查器

`@dv/inspector` 让 agent 查看素材而不改变项目。它的两个操作是读取，所以不写记录，该组件也没有归约函数：

- `inspect.image`（工具 `dv_inspect_image`）：harness 的默认模型回答关于一个 PNG、JPEG、WebP 或 GIF 素材的问题。插件只在挂载 `llm`、`agentDefaultModel` 和 `attachments` 期间注册该操作。模型不接受图片，或配置设置 `imageInput: false` 时，插件不调用模型。此时报告字段 `unsupported` 给出原因。
- `inspect.asset`（工具 `dv_inspect_asset`）：ffprobe 通过 `dvFfmpeg` 读取素材的时长、画面尺寸、编码和是否有音频。
