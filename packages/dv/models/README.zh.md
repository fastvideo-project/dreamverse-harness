---
description: "DreamVerse 的模型目录：公司插件把视频模型连同其支持的生成方式注册进 dvModels 服务；本包还提供 dv:models 提示词段落（模型列表）和 dv_models_get 工具。"
kind: "package-reference"
---

# @dv/models

[English](README.md) | 中文

## 概述

使用本包添加、替换或列出渲染镜头的视频模型。`dvModels` 服务就是模型目录：[`@dv/fastvideo`](../fastvideo/README.zh.md) 这样的公司插件为每个模型注册一个条目，[`@dv/shot-render`](../shot-render/README.zh.md) 和 [`@dv/shot-plan`](../shot-plan/README.zh.md) 这样的 consumer 查找调用所指定的模型和生成方式。模型和生成方式是两项独立的选择：`MODES` 对每种生成方式只定义一次（`reference`、`text`），每个模型声明自己支持的生成方式，所以 N 个模型只需 N 个条目。模型目录把 `dv:models` 模型列表和工具 `dv_models_get` 交给智能体。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

先于公司插件和 consumer 挂载本服务。DreamVerse bundle 以行 `dv-models` 挂载它：

```yaml
- id: dv-models
  name: '@dv/models'
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `promptSectionOrder` | `4890` | `dv:models` 提示词段落在各系统提示词段落中的顺序 |

公司插件注入 `dvModels`，并在 `ctx.effect` 内调用 `register(entry)`，所以销毁插件会移除它的模型。consumer 调用其他方法：

| 方法 | 返回值 | 语义 |
| --- | --- | --- |
| `register(entry)` | `() => void` | 添加一个模型；返回的函数移除它。已注册同 `id` 的模型，或条目没有声明生成方式、声明了 `MODES` 之外的生成方式、声明了其生成方式不允许的输入角色时抛出错误 |
| `get(id)` | `ModelEntry \| undefined` | 以 `id` 注册的模型 |
| `list()` | `ModelEntry[]` | 所有已注册模型，按注册顺序 |
| `onChanged(listener)` | `() => void` | 每次注册和移除后调用 `listener`；返回的函数移除该监听器 |
| `checkExtra(entry, mode, extra)` | `string[]` | 渲染的 `extra` 参数的每个问题对应一句话：模型在该生成方式下不接受的名称，或类型错误的值；值都有效时为空 |
| `describe(id)` | `Promise<JsonValue>` | 模型、它的公司、它的简介，以及每种生成方式下接受的输入及其数量、时长范围、宽高比、分辨率和额外参数 schema，均从模型的 `facts(mode)` 读取；`id` 未知或后端出错时抛出错误 |

`ModelEntry` 有以下字段；每个公司插件都按下面的语义实现 `facts` 和 `render`：

| 字段 | 语义 |
| --- | --- |
| `id` | 智能体和用户选择模型时用的名称，如 `fasth3`；在模型目录中唯一 |
| `company` | 提供该模型的一方，如 `local FastVideo`，用于模型列表 |
| `summary` | 把该模型与其他模型区分开的一行文字，用于模型列表 |
| `modes` | 支持的生成方式，至少一种，每种是一个 `ModeDeclaration`：`inputs`（每个接受的输入角色，`reference` 或 `first_frame`，带 `min`，即一次渲染所需的最少数量）、`extra`（模型在该生成方式下自有参数的参数 schema，没有时为空）和 `gpuSecondsPerVideoSecond`（该生成方式下每渲染一秒视频所用的 GPU 秒数，用于 GPU 估算） |
| `facts(mode)` | resolve 为模型在该生成方式下的 `RenderModelFacts`；后端无法连接时 reject |
| `render(mode, request, signal?)` | 先按顺序发送参考图，再发送首帧；恰好产生一个 `last_frame`、一个 `video_start`、若干 `chunk` 事件，然后是 `done`；任何后端失败都会 reject；中止 `signal` 会取消渲染并以其原因 reject |

| 类型 | 字段 |
| --- | --- |
| `ModeId` | `reference` 或 `text` |
| `ModeDefinition` | `description`（一句面向模型的话）和 `inputs`（该生成方式允许的输入角色：`reference` 允许 `reference` 和 `first_frame`，`text` 不允许任何输入） |
| `RenderModelFacts` | `modelId`（后端的模型 ID）、`aspectRatios` 和 `resolutions`（默认值在前）、`frameSizes`（按宽高比再按分辨率给出的 `[width, height]`）、`minDurationSec`、`maxDurationSec`、`numFramesByDurationSec`、`maxReferenceImages`（不接受参考图的生成方式下为 0）、`imageLabels`（`Picture 1`、`Picture 2`、…；不接受图片的生成方式下为空） |
| `RenderRequest` | `prompt`、`references`（按输入顺序的图片字节）、`firstFrame`（图片字节或 null）、`frameWidth`、`frameHeight`、`numFrames`、`seed`、`extra`（模型的自有参数，已按其 schema 检查） |
| `RenderStreamEvent` | `last_frame`（PNG 字节，在视频之前或之后）、`video_start`（视频的媒体类型）、`chunk`（视频字节）、`done`（后端的耗时：以 `_ms` 结尾的键是毫秒，其他键是秒） |

-----

<a id="understand-the-implementation"></a>
## 理解实现

本服务把条目按 `id` 存在一个 map 中，每次注册或移除后调用所有 `onChanged` 监听器。`register` 用 `MODES` 检查每个声明的生成方式：该生成方式必须存在，每个声明的输入角色必须是该生成方式允许的；`min` 数量和 `extra` schema 由模型自己决定。`checkExtra` 先拒绝未知名称，再用 `dsh-tools` 的 `validateArgs` 校验值，并给每条消息加上 `extra` 前缀。`describe` 同时读取所有声明的生成方式的 `facts(mode)`，为每个输入角色报告 `min` 和 `max`（`reference` 为 `maxReferenceImages`，`first_frame` 为 1）。DSH `systemPrompt` 服务挂载期间，本服务注册 `dv:models` 段落，其文本在每次请求时由 `list()` 重建，没有已注册模型时为空；DSH 工具注册表挂载期间，它注册 `dv_models_get`，该工具以缩进的 JSON 返回 `describe(model)`。已注册的模型名称变化时，镜头渲染重新注册 `shot.render`，所以 `dv_shot_render` 的 `model` 参数恰好列出已注册的模型。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `MODES`、`PROMPT_SECTION`、`Config`、`dvModels` 服务及其方法、`dv:models` 段落和 `dv_models_get` |
| [`src/types.ts`](src/types.ts) | `ModeId`、`InputRole`、`ModeDefinition`、`ModeInputs`、`ModeDeclaration`、`RenderModelFacts`、`RenderRequest`、`RenderStreamEvent`、`ModelEntry` |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/fastvideo`](../fastvideo/README.zh.md)：以生成方式 `reference` 和 `text` 注册 `fasth3` 的公司插件。
- [`@dv/shot-render`](../shot-render/README.zh.md)：按每次 `dv_shot_render` 调用的模型和生成方式渲染的 consumer。
- [`@dv/shot-plan`](../shot-plan/README.zh.md)：检查每个计划镜头的模型和生成方式的 consumer。
- [`@dv/bundle`](../../bundle/dv/README.zh.md)：行 `dv-models` 和 `dv-fastvideo`。

-----

<a id="model-experience"></a>
## 模型体验

### 模型列表提示词段落

#### 模型看到什么

`systemPrompt` 服务挂载且至少注册了一个模型时，系统提示词带有下面的 `dv:models` 段落：先是各生成方式及其 `MODES` 描述，然后每个已注册模型一行表格。`<extra parameters>` 把每个额外参数列为 `<name> (<mode>)`，模型没有额外参数时为 `—`。没有已注册模型时，该段落为空。

##### `dv:models` 段落

```markdown
## Video models
Every dv_shot_render call names a `model` and a `mode` from this list; a call without them is refused. Modes:
- reference: From reference images (character, location and style versions, or imported images) and the prompt; optionally a first frame, such as the last still of the previous shot.
- text: From the prompt alone; no images.
Call dv_models_get with a model for its limits in each of its modes: durations, aspect ratios, resolutions, reference images, and the extra parameters it takes in `extra`.

| model | company | modes | extra parameters | about |
| --- | --- | --- | --- | --- |
| <model> | <company> | <modes> | <extra parameters> | <summary> |
```

#### Token 影响

有已注册模型期间，每次请求中固定文本约 130 个 token，每个已注册模型再加约 35 个 token。

#### KV Cache 影响

该段落位于系统提示词的 `promptSectionOrder`（4890）位置，已注册模型不变时内容不变；注册或移除模型会改变该段落，使缓存前缀从该段落起失效。

### 模型限制工具

#### 模型看到什么

工具 `dv_models_get`，有一个必填参数 `model`，描述为 "Read one video model's limits in each of its modes: the inputs it accepts, durations, aspect ratios, resolutions, and the extra parameters it takes in the `extra` param of dv_shot_render."。一次调用返回一个文本块，内容是 `describe(model)` 的 JSON：`{model, company, about, modes}`，其中每种生成方式包含 `inputs`（每个角色的 `min` 和 `max`）、`duration_sec`（`min` 和 `max`）、`aspect_ratios`、`resolutions` 和 `extra`。未知模型以 `Unknown model "<model>"; models: <registered models>.` 失败，后端无法连接时以后端的错误失败。

#### Token 影响

工具注册表挂载期间，定义约 90 个 token；每个结果按模型的生成方式计，每种约 100 个 token。

#### KV Cache 影响

定义是稳定工具部分中的固定内容；每个结果在其调用之后追加到对话中，所以缓存前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **生成方式集合固定**：本包的 `ModeId` 和 `MODES` 定义所有生成方式；需要其他生成方式的模型（例如由首帧和尾帧渲染的模型）需要新的 `ModeId` 值及其 `MODES` 条目，若有新的输入角色，还需要 `@dv/shot-render` 中 `shot.render` 的对应输入。
- **没有就绪检查**：公司插件一注册，模型就出现在模型列表中，无论其后端能否连接；只有 consumer 读取模型的事实时，例如一次 `dv_models_get` 或 `dv_shot_render` 调用，后端无法连接才会显现。
- **一种生成方式失败会使 `dv_models_get` 失败**：`describe` 读取每种生成方式的事实，所以某种生成方式的后端无法连接时，该模型返回错误，而不是其他生成方式的限制。
