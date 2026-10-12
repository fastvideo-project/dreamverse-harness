---
description: "DreamVerse 的镜头渲染组件：dvShotRender 服务，@dv/models 模型目录的使用者，含用指定模型和生成方式渲染一个镜头的一个版本的操作 shot.render、记录版本的 shot 归约函数，以及智能体工具 dv_shot_render。"
kind: "package-reference"
---

# @dv/shot-render

[English](README.md) | 中文

## 概述

使用本包渲染镜头。它是 [`@dv/models`](../models/README.zh.md) 模型目录的使用者：它唯一的操作 `shot.render`（工具 `dv_shot_render`）用调用指定的视频模型和生成方式渲染一个镜头的一个版本，二者都必填。生成方式 `reference` 根据提示词、参考图和可选的首帧渲染；生成方式 `text` 只根据提示词渲染。模型自己的参数放在 `extra` 参数中。模型目录中有模型时，该操作才存在。每个版本的输出都是视频和它的最后静帧；归约函数按镜头归组版本。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project`、`@dv/asset-pool` 和 `@dv/models` 之后挂载插件，并挂载一个向模型目录注册模型的公司插件，例如 [`@dv/fastvideo`](../fastvideo/README.zh.md)。`shot` 归约函数总会注册；模型目录中至少有一个模型时注册 `shot.render`，已注册的模型名称变化时重新注册，所以它的 `model` 参数恰好列出已注册的模型。

```yaml
- id: dv-shot-render
  name: '@dv/shot-render'
```

本插件没有配置。一次渲染的 GPU 预估 `estimate(params)` 是 `duration_sec`（调用未给出时为 5）乘以指定模型注册时为指定生成方式声明的 `gpuSecondsPerVideoSecond`，所以同步的预估无需读取后端，就可以用于一轮的 GPU 预算和 `confirmSummary` 的确认文字。模型或生成方式不在模型目录中时，预估为 0。

| 操作 | 工具 | 输入和参数 | 输出和报告 |
| --- | --- | --- | --- |
| `shot.render` | `dv_shot_render` | 输入 `reference`（图片，或角色、场景、风格版本 `<id>@<n>`，按提示词顺序）和 `first_frame`（一张图片），各自只在模型于该生成方式下接受时可用；参数 `model` 和 `mode`（必填：一个已注册的模型和它支持的一种生成方式）、`prompt`（必填）、`duration_sec`、`aspect_ratio`、`resolution`、`seed`、`extra`（模型在该生成方式下自己的参数，即 `dv_models_get` 列出的额外参数），以及 `plan`、`plan_version` 和 `shot`（PlanId、已批准的版次和镜头在该版次中的位置，已批准的分镜计划调度渲染时设置）；仅工具参数 `continue_from`（一条渲染记录，其输出 `#1` 成为 `first_frame`） | 输出 `video`、`last_still`；报告 `{seed, model_id, aspect_ratio, resolution, duration_sec, frame_width, frame_height, num_frames, model, mode, image_labels, timings}`，`image_labels` 只在请求带图片时出现；成本 `gpu_seconds` 取自后端的计时 |

该操作使用 GPU，不是确定性的，并声明 `confirm: over_gpu_budget`：会让本轮超过 `dvProject` GPU 预算的智能体调用被拒绝，直到智能体在对话中询问用户并带 `user_requested: true` 再次调用；`confirmSummary` 为拒绝消息给出一行说明（`Render shot with <model> (<mode>), 5 s: "<prompt>"`）和该调用的 GPU 预估。省略的参数取模型在该生成方式下的第一个画面比例和分辨率以及最短时长；调用未给出种子时抽取一个。`based_on` 更早渲染记录的调用是该镜头的新版本，不论每个版本用的是哪个模型和生成方式；`shot` 切片把每个镜头的根记录映射到它的版本（`takes`），并把每个版本映射到它的根（`roots`）。其他调用方使用服务方法 `renderShot(context)`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`renderShot` 在 `dvModels` 中查找指定的模型和它对指定生成方式的声明，用 `facts(mode)` 读取模型在该生成方式下的模型事实，按参数解析帧尺寸和帧数，并拒绝超过模型事实中 `maxReferenceImages` 的参考图。它只为模型在该生成方式下接受的输入角色从素材库读取参考图和首帧的字节，把带 `extra` 值的请求发给模型的 `render(mode, request, signal)`，把流写入临时文件，然后经 `context.importAsset` 导入视频和 PNG 最后静帧。请求带图片时，报告的 `image_labels` 用模型事实的 `imageLabels` 为图片命名：先按顺序是参考图，再是首帧。挂载了 `@video-harness/stream` 的可选实时流服务时，视频分块到达时也送到它的 `openSegment`，以计划的 `shot` 序号作为片段索引。

对任何调用方，在写下任何记录之前，`shot.render` 的 `precondition` 拒绝以下调用：模型未注册（列出已注册的模型）、模型不支持该生成方式（列出它的生成方式）、`extra` 写了模型在该生成方式下不接受的参数或类型错误的值（`dvModels.checkExtra`）、输入含有模型在该生成方式下不接受的角色，或者带的参考图少于模型在该生成方式下的最小数量。一个素材或一条记录输出算一张图片，一个角色、场景或风格版本算 `dvProject.assetsOf` 为它返回的素材数。缺少参考图的拒绝消息给出模型事实中的数量范围，并让智能体向用户要一张参考图；分镜计划调度的调用（参数 `plan`）会被告知用 `dv_plan_update` 更新分镜计划；只要有模型支持生成方式 `text`，拒绝消息还为不需要参考图的镜头列出这些模型。智能体调用之前，`prepareToolCall` 读取模型在该生成方式下的模型事实，把 `continue_from` 变成 `first_frame` 输入 `{record, output: 1}`（模型在该生成方式下不接受首帧时拒绝），并运行同一个前置条件，所以智能体在 Project 请求用户同意之前就被拒绝。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotRender`：`shot.render`、它在模型目录变化时的注册、`renderShot`、前置条件、GPU 预估 |
| [`src/render.ts`](src/render.ts) | `shotGeometry`、`imageLabels`、`backendSeconds` |
| [`src/reducer.ts`](src/reducer.ts) | `shotReducer`，由已完成的 `shot.render` 记录得出每个镜头的版本 |
| [`src/types.ts`](src/types.ts) | `ShotState`，即 `shot` 切片 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、批准和智能体工具。
- [`@dv/asset-pool`](../asset-pool/README.zh.md)：参考图和导入的输出。
- [`@dv/models`](../models/README.zh.md)：本包使用的模型目录，含模型列表和 `dv_models_get`。
- [`@dv/fastvideo`](../fastvideo/README.zh.md)：注册模型及其提示词 skill 的公司插件。
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md)：本包遵循的布局。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

模型目录中有模型时，有一个工具 `dv_shot_render`，格式与 `@dv/project` 给每个操作工具的一样，带提示 "Uses the GPU."，以及 Project 因 `confirm: over_gpu_budget` 加上的参数 `user_requested`。描述说明 `model` 和 `mode` 必填且取自视频模型列表，生成方式 `reference` 根据参考图（`c1@1`）渲染、生成方式 `text` 只根据提示词渲染，模型在该生成方式下接受首帧时 `continue_from` 从更早镜头的最后静帧开始，模型自己的参数放在 `extra` 中（见 `dv_models_get`）；它还说明两个输出，以及每次调用都是新版本、修改提示词时传 `based_on`。`model` 参数是已注册模型的枚举。

#### Token 影响

插件和至少一个模型挂载期间，定义固定约 700 个 token；`@dv/project` 的共享参数最多增加约 200 个 token。

#### KV Cache 影响

定义位于每个智能体请求固定的工具段中。注册或移除一个模型会改变 `model` 枚举，第一个注册的模型或最后一个移除的模型会增加或移除该工具；这些都会改变工具列表，使从工具段开始的缓存前缀失效。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块，含记录、状态、摘要 `shot "<prompt>" (<n>s, seed <seed>)`（已批准的分镜计划调度时为 `shot <n> of plan <plan> v<version> "<prompt>" …`）、带 URL 的输出、参数和报告；挂载了附件服务时最后静帧还以图片块到达。参考图不够的调用在写任何记录之前被拒绝，消息让智能体向用户要一张参考图："Model <model> in mode reference renders a shot from 1 to <n> reference images, and this shot has none. Nothing was rendered. …"。未知的模型、不支持的生成方式、未知或类型错误的 `extra` 参数，以及模型不接受的输入，都以一句列出允许值的话被拒绝。

#### Token 影响

每次调用约 200 个 token 的文本，另加最后静帧的图片块。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **工具定义随模型目录变化**：`dv_shot_render` 的 `model` 枚举列出已注册的模型，所以每次注册或移除模型都会改变工具定义，使从工具段开始的缓存前缀失效。
- **GPU 预估**：GPU 预估是 `duration_sec × gpuSecondsPerVideoSecond`，即公司插件为该模型在该生成方式下配置的速率，而非测得的值。
