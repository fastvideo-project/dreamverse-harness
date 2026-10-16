---
description: "DreamVerse 的镜头渲染组件：dvShotRender 服务，@dv/models 模型目录的使用者，含用调用以模型目录键指定的模型渲染一个镜头的一个版本的操作 shot.render、记录版本的 shot 归约函数，以及智能体工具 dv_shot_render。"
kind: "package-reference"
---

# @dv/shot-render

[English](README.md) | 中文

## 概述

使用本包渲染镜头。它是 [`@dv/models`](../models/README.zh.md) 模型目录的使用者：它唯一的操作 `shot.render`（工具 `dv_shot_render`）用必填参数 `modality`、`task`、`provider` 和 `model` 指定的模型目录条目渲染一个镜头的一个版本。任务 `ref2v` 根据提示词、参考素材和可选的首帧渲染；任务 `t2v` 只根据提示词渲染。模型自己的参数放在 `extra` 参数中。模型目录中有模型时，该操作才存在。每个版本的输出都是视频和它的最后静帧；归约函数按镜头归组版本。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project` 和 `@dv/models` 之后挂载插件，并挂载一个向模型目录注册模型的提供方插件，例如 [`@dv/fastvideo`](../fastvideo/README.zh.md)。`shot` 归约函数总会注册；模型目录中至少有一个模型时注册 `shot.render`。

```yaml
- id: dv-shot-render
  name: '@dv/shot-render'
```

本插件没有配置。一次渲染的 GPU 预估 `estimate(params)` 是 `duration_sec`（调用未给出时为 5）乘以指定模型目录条目的 `gpuSecondsPerVideoSecond`，所以同步的预估无需读取后端，就可以用于一轮的 GPU 预算和 `confirmSummary` 的确认文字。键不对应任何模型目录条目时，预估为 0。

| 操作 | 工具 | 输入和参数 | 输出和报告 |
| --- | --- | --- | --- |
| `shot.render` | `dv_shot_render` | 输入 `reference`（模型为该角色声明的任意媒体类型的素材，或角色、场景、风格版本 `<id>@<n>`，按提示词顺序）和 `first_frame`（一张图片），各自只在模型接受时可用；参数 `modality`、`task`、`provider` 和 `model`（必填：一个模型目录条目的键，即 `dv_models_list` 列出的键）、`prompt`（必填）、`duration_sec`、`aspect_ratio`、`resolution`、`seed`、`extra`（模型自己的参数，即 `dv_models_get` 列出的额外参数），以及 `plan`、`plan_version` 和 `shot`（PlanId、已批准的版次和镜头在该版次中的位置，已批准的分镜计划调度渲染时设置）；仅工具参数 `continue_from`（一条渲染记录，其输出 `#1` 成为 `first_frame`） | 输出 `video`、`last_still`；报告 `{seed, model_id, aspect_ratio, resolution, duration_sec, frame_width, frame_height, num_frames, modality, task, provider, model, timings}`，元素展开改变了提示词时还有 `expanded_prompt`；成本 `gpu_seconds` 取自后端的计时 |

该操作使用 GPU，不是确定性的，并声明 `confirm: over_gpu_budget`：会让本轮超过 `dvProject` GPU 预算的智能体调用被拒绝，直到智能体在对话中询问用户并带 `user_requested: true` 再次调用；`confirmSummary` 为拒绝消息给出一行说明（`Render shot with <modality>/<task>/<provider>/<model>, 5 s: "<prompt>"`）和该调用的 GPU 预估。省略的参数取模型的第一个画面比例和分辨率以及最短时长；调用未给出种子时抽取一个。`based_on` 更早渲染记录的调用是该镜头的新版本，不论每个版本用的是哪个模型；`shot` 切片把每个镜头的根记录映射到它的版本（`takes`），并把每个版本映射到它的根（`roots`）。其他调用方使用服务方法 `renderShot(context)`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`renderShot` 用 `dvModels.get` 查找指定键的模型目录条目，用 `facts()` 读取它的模型事实，然后组装渲染请求：提示词、参考输入按输入顺序的素材 ID、唯一首帧的素材 ID、按参数解析的帧尺寸和帧数、种子，以及 `extra` 值。它把每个输入都放进请求，由模型判断：请求发给条目的 `render(request, signal)` 之前，再运行一次条目的 `validateGenerationRequest(request)`，因为前置条件运行时尚未完成的记录的输出此时已是素材。提示词中的每个引用（`@[<label>](dv:asset/<AssetId>)`）都必须指向参考输入中的素材，按角色引用输入（`dv:input/<role>`，例如 `dv:input/first_frame`）的调用必须有该角色的输入；引用其他内容会被拒绝，提示词没有引用的参考素材照常发送。对参考输入中角色、场景或风格版本的引用（`dv:character/<id>`、`dv:location/<id>` 或 `dv:style/<id>`，不带版本）在检查之前展开成它的标签和它的参考素材的引用，例如 `Mia (@[Mia · 1](dv:asset/a1) @[Mia · 2](dv:asset/a2))`；记录的 `prompt` 参数保留原样写的提示词。模型从素材库读取每个素材的字节和媒体类型，模型插件把每个引用换成模型读取的标签。`renderShot` 把流写入临时文件，然后经 `context.importAsset` 导入视频和 PNG 最后静帧。挂载了 `@video-harness/stream` 的可选实时流服务时，视频分块到达时也送到它的 `openSegment`，以计划的 `shot` 序号作为片段索引。

对任何调用方，在写下任何记录之前，`shot.render` 的 `precondition` 拒绝以下调用：键不对应任何模型目录条目（以 `modality/task/provider/model` 写出该键，并让智能体调用 `dv_models_list`）、缺少提示词或参数超出模型事实、`first_frame` 输入多于一个，或者条目的 `validateGenerationRequest` 拒绝其渲染请求（含 `extra` 值）。前置条件把每个输入解析为素材：素材就是它自己，记录输出是已完成记录的该输出（经 `dvProject.getRecord` 读取），角色、场景或风格版本代表 `dvProject.assetsOf` 为它返回的素材。它组装与 `renderShot` 相同的渲染请求（调用没有给种子时自取一个种子），交给条目的 `validateGenerationRequest`。输入为尚未完成的记录的输出的调用，由 `renderShot` 在渲染之前校验（含 `extra` 值）。拒绝消息以“Model <modality>/<task>/<provider>/<model> cannot render this shot:”开头，列出模型给出的问题，并让智能体修改输入、向用户要镜头需要的素材；分镜计划调度的调用（参数 `plan`）会被告知用 `dv_plan_update` 更新分镜计划。智能体调用之前，`prepareToolCall` 把 `continue_from` 变成 `first_frame` 输入 `{record, output: 1}`，并运行同一个前置条件，由其中对模型 `validateGenerationRequest` 的调用决定模型是否接受该首帧，所以智能体在 Project 请求用户同意之前就被拒绝。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotRender`：`shot.render`、它在模型目录变化时的注册、`renderShot`、前置条件、GPU 预估 |
| [`src/render.ts`](src/render.ts) | `shotGeometry`、`backendSeconds` |
| [`src/reducer.ts`](src/reducer.ts) | `shotReducer`，由已完成的 `shot.render` 记录得出每个镜头的版本 |
| [`src/types.ts`](src/types.ts) | `ShotState`，即 `shot` 切片 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、批准和智能体工具。
- [`@dv/asset-pool`](../asset-pool/README.zh.md)：参考素材和导入的输出。
- [`@dv/models`](../models/README.zh.md)：本包使用的模型目录，含 `dv_models_list` 和 `dv_models_get`。
- [`@dv/fastvideo`](../fastvideo/README.zh.md)：注册模型及其提示词 skill 的提供方插件。
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md)：本包遵循的布局。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

模型目录中有模型时，有一个工具 `dv_shot_render`，格式与 `@dv/project` 给每个操作工具的一样，带提示 "Uses the GPU."，以及 Project 因 `confirm: over_gpu_budget` 加上的参数 `user_requested`。描述说明 `modality`、`task`、`provider` 和 `model` 指定 `dv_models_list` 中的一个模型且必填，任务 `ref2v` 根据参考素材（`c1@1`）渲染，提示词以 `@[<label>](dv:asset/<asset ID>)` 引用它们，其接受的输入、媒体类型和数量由 `dv_models_get` 列出，模型接受首帧时 `continue_from` 从更早镜头的最后静帧开始，模型自己的参数放在 `extra` 中（见 `dv_models_get`）；它还说明两个输出，以及每次调用都是新版本、修改提示词时传 `based_on`。四个键参数是字符串，其说明指向 `dv_models_list`。`reference` 输入的类型是 `any`，`prompt` 参数说明提示词在提到参考输入中的每张参考图片的地方以 `@[<label>](dv:asset/<asset ID>)` 引用它。

#### Token 影响

插件和至少一个模型挂载期间，定义固定约 700 个 token；`@dv/project` 的共享参数最多增加约 200 个 token。

#### KV Cache 影响

定义位于每个智能体请求固定的工具段中。第一个注册的模型或最后一个移除的模型会增加或移除该工具，这会改变工具列表，使从工具段开始的缓存前缀失效；其他注册不改变定义。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块，含记录、状态、摘要 `shot "<prompt>" (<n>s, seed <seed>)`（已批准的分镜计划调度时为 `shot <n> of plan <plan> v<version> "<prompt>" …`）、带 URL 的输出、参数和报告；挂载了附件服务时最后静帧还以图片块到达。模型拒绝其渲染请求的调用在写任何记录之前被拒绝，消息给出模型的问题和要修改什么："Model <modality>/<task>/<provider>/<model> cannot render this shot: <problems> Nothing was rendered; change the inputs (ask the user for an asset the shot needs; they can attach it in the chat), then call again."。键不对应任何模型目录条目时，拒绝消息给出该键并要求调用 `dv_models_list`；模型不接受的 `extra` 值属于模型校验报告的问题；缺少提示词和超出模型事实的参数，都以一句列出允许值的话被拒绝。

#### Token 影响

每次调用约 200 个 token 的文本，另加最后静帧的图片块。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **GPU 预估**：GPU 预估是 `duration_sec × gpuSecondsPerVideoSecond`，即提供方插件给模型目录条目的速率，而非测得的值。
