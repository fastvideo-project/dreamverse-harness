---
description: "DreamVerse 的图片组件：在 @dv/models 的模型目录中声明 image 原语和任务 t2i，操作 image.generate（工具 dv_image_generate）用调用按键指定的模型，由提示词生成一张图片。"
kind: "package-reference"
---

# @dv/image-generate

[English](README.md) | 中文

## 概述

使用本包让智能体和工作流由文字生成图片。它在模型目录 `@dv/models` 中声明生成原语 `image` 和任务 `t2i`，并用 `@dv/generation` 的 `defineGeneration` 构建 `dvImageGenerate` 服务。模型目录持有任务 `t2i` 的条目期间，该服务注册操作 `image.generate`，`dvProject` 把它变成智能体工具 `dv_image_generate`。每次调用用调用的模型键指定的条目渲染一张 PNG，这张图片是一条新记录的唯一输出。提供方插件（如 [`@dv/sglang-diffusion`](../sglang-diffusion/README.zh.md)）注册 `t2i` 条目。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project` 和 `@dv/models` 之后挂载插件。插件没有配置字段。只有提供方插件注册了任务 `t2i` 的条目时，该操作才存在。界面显示它的标签 生成图片 / Generate image，任务的标签为 文字生成图片 / Image from text。

```yaml
- id: dv-image-generate
  name: '@dv/image-generate'
```

| 操作 | 工具 | 输入和参数 | 输出和报告 |
| --- | --- | --- | --- |
| `image.generate` | `dv_image_generate` | 没有输入；模型键、`prompt`、`size`（以像素计的 `WIDTHxHEIGHT`，可选）、`seed`（可选）和 `extra` | 输出 `image`（带宽高的 PNG）；报告 `{seed, model_id, size}` |

任务 `t2i` 的条目以下列类型实现 `ModelEntry<'t2i'>`，本包导出这些类型并在 `PrimitiveTypes` 中声明它们：

| 类型 | 字段 |
| --- | --- |
| `ImageModelFacts` | `modelId`：后端的模型 ID |
| `ImageRequest` | `prompt`；`size`：一个 `ImageSize`，调用没有指定尺寸时为 null；`seed`；`extra` |
| `GeneratedImage` | `bytes`、`mime: 'image/png'`、`width`、`height` |
| 条目字段 | `defaultSize`：条目为 `size` 为 null 的请求渲染的尺寸 |

条目的 `render(request)` 返回一个 `GeneratedImage` 的 promise。该服务还为工作流实现 `@dv/generation` 的 `GenerationApi`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

声明的 `toRequest` 去掉提示词首尾空白，拒绝空提示词，并把 `size` 解析为 `ImageSize`；没有 `size` 的调用让请求的 `size` 为 null，由条目决定默认值。调用没有指定种子时，内核抽取种子。声明的 `toOutputs` 经 `importOne` 导入带宽高的 PNG，命名为 `<记录 ID 前 8 个字符>.png`，并在报告中给出 `model_id` 和渲染的 `size`；内核加入 `seed`。记录的摘要是 `image "<prompt>" (<size>, seed <seed>)`，提示词由 `@dv/generation` 的 `quotePrompt(prompt, 60)` 写出。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `PrimitiveTypes` 的 `image` 行、任务 `t2i`、请求和结果类型，以及 `dvImageGenerate` |
| [`tests/image-generate.spec.ts`](tests/image-generate.spec.ts) | 在带一个假 `t2i` 条目的 Loader 组合中测试操作、工具文本、记录和拒绝 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/generation`](../generation/README.zh.md)：`defineGeneration`、共享参数、拒绝和确认文本。
- [`@dv/models`](../models/README.zh.md)：模型目录、键和 `dv_models_get`。
- [`@dv/project`](../project/README.zh.md)：记录和智能体工具。
- [`@dv/sglang-diffusion`](../sglang-diffusion/README.zh.md)：`t2i` 模型 `qwen-image-2.1-turbo` 的提供方插件。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

模型目录持有任务 `t2i` 的条目期间的工具 `dv_image_generate`，描述如下。它的参数是 `@dv/generation` 的共享参数（`modality`、`task`、`provider`、`model`、`prompt`、`seed`、`extra`），`size` 位于 `seed` 之前，其后是 `@dv/project` 的共享参数，没有 `inputs`，因为该操作没有输入角色。

##### Tool description

```markdown
Generate one image from the prompt with a t2i model from dv_models_list; modality, task, provider and model name it and are required. dv_models_get lists the sizes the model takes and its own parameters for extra. The image is the one output, and you see it in the result. Every call is a new take; a changed prompt for the same image passes based_on. Uses the GPU.
```

##### Param size

```markdown
The image size as WIDTHxHEIGHT in pixels, such as 1024x768. It must meet the size rule that dv_models_get gives; every size it lists by aspect ratio meets it. Omitted, the model's default size.
```

#### Token 影响

定义约 450 个 token，注册了 `t2i` 条目期间固定不变。

#### KV Cache 影响

定义位于每次智能体请求中固定的工具部分；注册第一个 `t2i` 条目或移除最后一个，或挂载或移除插件，都会改变工具列表，使缓存前缀从工具部分起失效。

### 工具结果

#### 模型看到什么

一次调用返回下面的文本块；挂载了附件服务时，其后是作为图片块的图片。被拒绝的调用不写记录，并以理由和 `@dv/generation` 的结束句使工具调用失败；本包的理由如下，模型校验报告它自己的问题。在下面的结果中，`"<prompt>"` 是去掉首尾空白后写成 JSON 字符串的提示词，在 60 个字符后截断并加 `…`。渲染失败时，记录和工具调用以提供方的消息失败。

##### Success result

```markdown
done <record>: image "<prompt>" (<width>x<height>, seed <seed>)
- image: <asset ID> (image/png) <asset URL>
params: <params JSON>
report: {"seed":<seed>,"model_id":"<backend model ID>","size":"<width>x<height>"}
```

##### Refusal reasons

```markdown
The prompt is empty; describe the image to generate.
size must be WIDTHxHEIGHT in pixels with positive integers, such as 1024x768; got <value as JSON>.
```

#### Token 影响

每次调用约 120 个 token 的文本，另加按模型对一张该尺寸图片计费的图片。

#### KV Cache 影响

结果在调用之后追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只由文字生成图片**：该操作没有输入角色，所以不编辑图片，也不接受参考图片。
- **每次调用一张图片**：每次调用渲染一张图片并写一条记录；多个版本需要多次调用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
