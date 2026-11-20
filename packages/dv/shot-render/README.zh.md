---
description: "DreamVerse 的镜头渲染组件：dvShotRender 服务，@dv/models 模型目录的使用者，含用调用以模型目录键指定的模型渲染一个镜头的一个版本的操作 shot.render，以及智能体工具 dv_shot_render。"
kind: "package-reference"
---

# @dv/shot-render

[English](README.md) | 中文

## 概述

使用本包渲染镜头。它是 [`@dv/models`](../models/README.zh.md) 模型目录的使用者：它唯一的操作 `shot.render`（工具 `dv_shot_render`）用必填参数 `modality`、`task`、`provider` 和 `model` 指定的模型目录条目渲染一个镜头的一个版本。任务 `ref2v` 根据提示词、参考素材和可选的首帧渲染；任务 `t2v` 只根据提示词渲染。模型自己的参数放在 `extra` 参数中。模型目录服务其任务时，该操作才存在。每个版本的输出都是视频和它的最后静帧。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project` 和 `@dv/models` 之后挂载插件，并挂载一个向模型目录注册模型的提供方插件，例如 [`@dv/fastvideo`](../fastvideo/README.zh.md)。模型目录中至少有一个任务 `t2v`、`ref2v`、`i2v`、`l2v`、`fl2v` 或 `v2v` 的模型时注册 `shot.render`（`dvModels.whileServing`）。该操作带标签 渲染镜头 / Render shot；服务存续期间用 `dvModels.labelTasks` 在模型目录中标注它的任务：`t2v` 文字生成 / From text，`ref2v` 参考图生成 / From references，`fl2v` 首尾帧生成 / From first and last frames。

```yaml
- id: dv-shot-render
  name: '@dv/shot-render'
```

本插件没有配置。

| 操作 | 工具 | 输入和参数 | 输出和报告 |
| --- | --- | --- | --- |
| `shot.render` | `dv_shot_render` | 输入 `reference`（模型为该角色声明的任意媒体类型的素材，或角色、场景、风格版本 `<id>@<n>`，按提示词顺序）、`first_frame`（一张图片）和 `last_frame`（一张图片），各自只在模型接受时可用；参数 `modality`、`task`、`provider` 和 `model`（必填：一个模型目录条目的键，即 `dv_models_list` 列出的键）、`prompt`（必填）、`duration_sec`、`aspect_ratio`、`resolution`、`seed`、`extra`（模型自己的参数，即 `dv_models_get` 列出的额外参数）；仅工具参数 `continue_from`（一条渲染记录，其输出 `#1` 成为 `first_frame`） | 输出 `video`、`last_still`；报告 `{seed, model_id, aspect_ratio, resolution, duration_sec, frame_width, frame_height, num_frames, modality, task, provider, model, timings}`，元素展开改变了提示词时还有 `expanded_prompt` |

该操作使用 GPU，不是确定性的。省略的参数取模型的第一个画面比例和分辨率以及最短时长；调用未给出种子时抽取一个。`based_on` 更早渲染记录的调用是该镜头的新版本，不论每个版本用的是哪个模型。工作流在 `dvShotRender` 上调用 [`@dv/generation`](../generation/README.zh.md) 的 `GenerationApi` 方法：`render`、`check` 和 `parseInputs`。

任务 `i2v` 要求一张 `first_frame`；任务 `l2v` 要求一张 `last_frame`。两者均不接受另一端点或参考媒体。任务 `fl2v` 必须恰有一个 `first_frame` 和一个 `last_frame`，不接受 `reference` 输入。每帧以独立角色存入记录，并在 `RenderRequest` 中分别传递，不受输入顺序影响。提供方校验图像媒体并把角色映射为原生端点条件。`continue_from` 可以提供首帧；尾帧仍需明确给出。 任务 `v2v` 恰好接受一个 `reference` 输入，即要重新生成的较早镜头的视频输出 `<record>#0`（例如把草稿超分到 2K），不接受首尾帧输入。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`@dv/generation` 的 `defineGeneration` 从 `shot.render` 的声明构建该服务。一次渲染用 `dvModels.resolve` 在任务 `t2v`、`ref2v`、`i2v`、`l2v`、`fl2v` 和 `v2v` 中查找指定键的模型目录条目，用 `facts()` 读取它的模型事实，然后组装渲染请求：提示词、参考输入按输入顺序的素材 ID、首尾帧各自的素材 ID、按参数解析的帧尺寸和帧数、种子，以及 `extra` 值。它把每个输入都放进请求，由模型判断：请求发给条目的 `render(request, signal)` 之前，再运行一次条目的 `validateGenerationRequest(request)`，因为前置条件运行时尚未完成的记录的输出此时已是素材。提示词中的每个引用（`@[<label>](dv:asset/<AssetId>)`）都必须指向参考输入中的素材，按角色引用输入（`dv:input/<role>`，例如 `dv:input/first_frame`）的调用必须有该角色的输入；引用其他内容会被拒绝，提示词没有引用的参考素材照常发送。对参考输入中角色、场景或风格版本的引用（`dv:character/<id>`、`dv:location/<id>` 或 `dv:style/<id>`，不带版本）在检查之前展开成它的标签和它的参考素材的引用，例如 `Mia (@[Mia · 1](dv:asset/a1) @[Mia · 2](dv:asset/a2))`；记录的 `prompt` 参数保留原样写的提示词。模型从素材库读取每个素材的字节和媒体类型，模型插件把每个引用换成模型读取的标签。声明的 `toOutputs` 把流写入临时文件，然后经 `context.importAsset` 导入视频和 PNG 最后静帧。挂载了 `@video-harness/stream` 的可选实时流服务时，视频分块到达时也送到它的 `openSegment`，以记录的 `started_by.slot` 作为片段索引，没有时为 0。

对任何调用方，在写下任何记录之前，`shot.render` 的 `precondition` 拒绝以下调用：键不对应任何模型目录条目（以 `modality/task/provider/model` 写出该键，并让智能体调用 `dv_models_list`）、缺少提示词或参数超出模型事实、任一帧角色的输入多于一个，或者条目的 `validateGenerationRequest` 拒绝其渲染请求（含 `extra` 值）。前置条件把每个输入解析为素材：素材就是它自己，记录输出是已完成记录的该输出（经 `dvProject.getRecord` 读取），角色、场景或风格版本代表 `dvProject.assetsOf` 为它返回的素材。它组装与渲染相同的渲染请求（调用没有给种子时自取一个种子），交给条目的 `validateGenerationRequest`。输入为尚未完成的记录的输出的调用，在渲染之前再校验一次（含 `extra` 值）。拒绝消息给出原因，并以“Nothing was generated; change the inputs or params, then call again.”结尾；条目的 `facts()` 或 `validateGenerationRequest` 拒绝时，原因写作“Model <modality>/<task>/<provider>/<model> is unavailable: <message>”，拒绝消息以“Nothing was generated; no change to the call helps while the model is unavailable.”结尾；模型给出的问题写作“Model <modality>/<task>/<provider>/<model> cannot generate this: <problems>”。智能体调用之前，`prepareToolCall` 把 `continue_from` 变成 `first_frame` 输入 `{record, output: 1}`，并运行同一个前置条件，由其中对模型 `validateGenerationRequest` 的调用决定模型是否接受该首帧。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotRender`：`shot.render` 的声明（渲染请求、存储的输出和摘要） |
| [`src/render.ts`](src/render.ts) | `shotGeometry` |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作和智能体工具。
- [`@dv/asset-pool`](../asset-pool/README.zh.md)：参考素材和导入的输出。
- [`@dv/models`](../models/README.zh.md)：本包使用的模型目录，含 `dv_models_list` 和 `dv_models_get`。
- [`@dv/generation`](../generation/README.zh.md)：构建该服务、它的检查和它的 `GenerationApi` 的辅助库。
- [`@dv/fastvideo`](../fastvideo/README.zh.md)：注册模型及其提示词 skill 的提供方插件。
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md)：本包遵循的布局。

-----

云端 API 可公布离散时长而不公布帧数或精确像素尺寸。镜头渲染校验其时长选项并传递秒数、画幅和清晰度；未知几何不会出现在请求、素材提示或报告中。原生按帧请求保留现有字段。

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

模型目录中有任务 `t2v`、`ref2v`、`i2v`、`l2v`、`fl2v` 或 `v2v` 的模型时，有一个工具 `dv_shot_render`，格式与 `@dv/project` 给每个操作工具的一样，带提示 "Uses the GPU."。描述说明 `modality`、`task`、`provider` 和 `model` 指定 `dv_models_list` 中的一个模型且必填，任务 `ref2v` 根据参考素材（`c1@1`）渲染，提示词以 `@[<label>](dv:asset/<asset ID>)` 引用它们，其接受的输入、媒体类型和数量由 `dv_models_get` 列出，模型接受首帧时 `continue_from` 从更早镜头的最后静帧开始，模型自己的参数放在 `extra` 中（见 `dv_models_get`）；它还说明目录条目报告 `hosting: managed` 的模型在提供方的服务器上运行、不使用本地 GPU，以及两个输出，以及每次调用都是新版本、修改提示词时传 `based_on`。四个键参数是字符串，其说明指向 `dv_models_list`。`duration_sec` 接受数值，默认使用模型支持的最短时长。`reference` 输入的类型是 `any`，`prompt` 参数要求遵循 `dv_models_list` 为该模型列出的提示词 skill（如果有）。

#### Token 影响

插件和至少一个任务 `t2v`、`ref2v`、`i2v`、`l2v`、`fl2v` 或 `v2v` 的模型挂载期间，定义固定约 630 个 token；`@dv/project` 的共享参数最多增加约 200 个 token。

#### KV Cache 影响

定义位于每个智能体请求固定的工具段中。第一个注册的模型或最后一个移除的模型会增加或移除该工具，这会改变工具列表，使从工具段开始的缓存前缀失效；其他注册不改变定义。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块，含记录、状态、摘要 `shot "<prompt>" (<n>s, seed <seed>)`（某条记录在位置 `<n>` 启动它时为 `shot <n> "<prompt>" …`）、带 URL 的输出、参数和报告；挂载了附件服务时最后静帧还以图片块到达。模型拒绝其渲染请求的调用在写任何记录之前被拒绝，消息给出模型的问题和要修改什么："Model <modality>/<task>/<provider>/<model> cannot generate this: <problems> Nothing was generated; change the inputs or params, then call again."。键不对应任何模型目录条目时，拒绝消息给出该键并要求调用 `dv_models_list`；模型不接受的 `extra` 值属于模型校验报告的问题；缺少提示词和超出模型事实的参数，都以一句列出允许值的话被拒绝。每条拒绝消息都以句子“Nothing was generated; change the inputs or params, then call again.”结尾，模型不可用时的拒绝消息除外，它以“Nothing was generated; no change to the call helps while the model is unavailable.”结尾。

#### Token 影响

每次调用约 200 个 token 的文本，另加最后静帧的图片块。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **视频不直接给模型看**：见 [`@dv/inspector` 的限制](../inspector/README.zh.md#known-limitations-and-deferred-work)。
