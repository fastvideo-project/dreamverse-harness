---
description: "本包是 DreamVerse 的视频模型目录。提供方插件在 dvModels 服务中为每个模型和任务注册一个 ModelEntry。每个提供方插件把 RenderRequest 翻译成其后端的请求。agent 用 dv_models_list 和 dv_models_get 工具读取模型目录。添加提供方、模型或服务器，或了解 agent 如何选择模型时，阅读本页。"
kind: "package-reference"
---

# @dv/models

[English](README.md) | 中文

## 概述

使用本包列出部署可以用来渲染的视频模型。提供方插件（如 [`@dv/fastvideo`](../fastvideo/README.zh.md)）为它提供的每个模型和任务注册一个条目。消费方（如 [`@dv/shot-render`](../shot-render/README.zh.md)）在它自己的任务中解析键所指定的条目，并用一种请求类型渲染。agent（智能体）用两个工具读取条目，并用一个 skill（技能）为每个镜头选择模型。添加提供方时，添加一个提供方插件。添加模型时，修改一个提供方插件。添加服务器时，修改该提供方插件的 `Config` 行。

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

挂载一次本包。再挂载一个或多个向本包注册模型的提供方插件。

### 何时选择本包

在每个渲染视频镜头的组合中挂载本包。[`@dv/shot-render`](../shot-render/README.zh.md) 注入 `dvModels`，所以只有挂载本包后它才会启动。本包本身不渲染。提供方插件（如 [`@dv/fastvideo`](../fastvideo/README.zh.md)）提供每个模型。

### 最小配置

DreamVerse bundle [`@dv/bundle`](../../bundle/dv/README.zh.md) 以行 `dv-models` 挂载本包：

```yaml
- id: dv-models
  name: '@dv/models'
```

本插件没有配置字段。

<a id="model-keys"></a>
### 模型键

提供方是一个视频生成系统，如 FastVideo、fal 或 SGLang。服务器是提供方的一个运行中的后端。每个条目有一个由四个字段组成的键。`formatModelKey(key)` 把键写成一个字符串，如 `video/ref2v/fastvideo/fasth3`。`modelKey(params)` 从调用的 `modality`、`task`、`provider` 和 `model` 参数读取键；不是字符串的字段读作空字符串。`servesTask(entry, tasks)` 判断条目是否服务给定任务之一，并把条目收窄到这些任务；它只读取条目的 `task`。

| 字段 | 含义 | 本包中的值 |
| --- | --- | --- |
| `modality` | 任务产生的输出：该任务所用原语的 `modality`。 | `video` |
| `task` | 生成任务。`TaskMap` 声明每个任务名称，并把它映射到该任务所用的原语。 | `t2v`：只由提示词生成视频。`ref2v`：由参考媒体和提示词生成视频，可选首帧。`i2v`：从一张首帧图像开始生成视频。`l2v`：向一张尾帧图像生成视频。`fl2v`：在首尾两张图像之间生成视频。这些端点任务使用提示词，不接受参考媒体。 `v2v`：由一个参考视频重新生成同一视频，例如把草稿超分到 2K。 |
| `provider` | 提供方的名称。提供方插件设定该名称。 | 每个提供方插件自己设定名称，如 `fastvideo`。 |
| `model` | 提供方为模型取的名称。 | 每个提供方插件自己设定名称，如 `fasth3`。 |

服务两个任务的模型有两个条目，每个任务一个。原语是生成的一种输入和输出签名，如 `video`。`PrimitiveTypes` 为每个原语声明一行：它的 `modality`、构建请求所依据的 `facts`、`request`、`render` 的 `result`，以及只有该原语读取的 `entry` 字段。本包只声明 `video` 行。插件在自己的包中通过 TypeScript 声明合并添加原语行或任务，例如 `declare module '@dv/models' { interface TaskMap { v2v: 'video' } }`。任务名称的值是该任务所用的原语。`TaskOfPrimitive<P>` 是原语 `P` 的一个任务，如 `video` 的 `t2v | ref2v`。两个插件可以用相同的值声明相同的名称。TypeScript 会合并这两个声明。用不同的值声明相同的名称无法编译。

### 模型条目

提供方插件为每个键实现一个 `ModelEntry`。`ModelEntry<T>` 从任务 `T` 所用原语的行中取得 `entry` 字段，以及事实、请求和 `render` 结果的类型。`video` 任务的 `ModelEntry` 有四个键字段和下表中的成员：

| 成员 | 约定 |
| --- | --- |
| `description` | 模型的长处和短处。agent 和用户比较描述，在相似的模型之间选择。 |
| `hosting` | 必填。运行模型的服务器由托管服务运营时为 `managed`，由用户自己运营时为 `self-hosted`。`dv_models_list` 和 `dv_models_get` 返回该值。 |
| `facts()` | resolve 为后端报告的 `RenderModelFacts`。后端无法连接时 reject。 |
| `schema()` | resolve 为描述模型所接受请求的 JSON：agent 需要的限制（例如时长、宽高比和分辨率）、各输入及其媒体类型和数量，以及 `extra` 中的参数。提供方插件定义该 JSON。模型目录把它原样交给 agent。后端无法连接时 reject。 |
| `validateGenerationRequest(request)` | resolve 为模型无法渲染某个 `RenderRequest` 的每个原因，每个原因一句面向 agent 的话。原因包括无效的 `extra` 值。模型能渲染该请求时 resolve 为空列表。后端无法连接时 reject。 |
| `render(request, signal)` | 渲染一个镜头，返回 `RenderStreamEvent` 值的流。通过 `dvAssetPool` 读取每个输入素材。产生一个 `video_start` 事件、若干 `chunk` 事件，然后是一个 `done` 事件。在 `video_start` 之前或最后一个 `chunk` 之后恰好产生一个 `last_frame` 事件。任何后端失败都会 reject。`signal` 中止时，取消渲染并以中止原因 reject。 |
| `promptSkill` | 可选。该模型在此任务上的提示词 skill：`name`、`description` 和 `content`。描述写明模型和任务，不提及任何工具。条目已注册且 DSH skill 注册表挂载期间，模型目录为 agent 注册该 skill。 |

### 渲染请求与渲染流

`RenderRequest` 是所有提供方共用的唯一请求类型。消费方对每个模型以相同方式构建它。每个提供方插件把它翻译成其后端的请求格式。[`dsh-llm`](../../llm/llm/README.zh.md) 的 `GenerateOptions` 类型对语言模型起相同作用。

| `RenderRequest` 字段 | 含义 |
| --- | --- |
| `prompt` | 文本提示词。 |
| `references` | 参考素材的素材 ID，按输入顺序排列。没有参考素材的任务中该列表为空。 |
| `firstFrame` | 视频起始图像的素材 ID，或 `null`。 |
| `lastFrame` | 视频结束图像的素材 ID，或 `null`。 |
| `frameWidth`、`frameHeight` | 以像素为单位的帧尺寸。消费方从 facts 的 `frameSizes` 中取得它。 |
| `numFrames` | 帧数。消费方从 facts 的 `numFramesByDurationSec` 中取得它。 |
| `seed` | 随机种子。 |
| `extra` | 模型自有参数的值。`schema()` 描述它们，`validateGenerationRequest` 检查它们。 |

`references`、`firstFrame` 和 `lastFrame` 分别承载 `dv_shot_render` 的 `reference`、`first_frame` 和 `last_frame` 输入。提供方通过注册目录条目并验证起始和结束图像来支持 `fl2v`。没有结束帧输入的旧记录解析为 `lastFrame: null`。此任务无需音频，是否生成声音取决于所选模型。

| `RenderModelFacts` 字段 | 含义 |
| --- | --- |
| `modelId` | 后端的模型 ID。渲染的记录报告把它保存为 `model_id`。 |
| `aspectRatios` | 模型渲染的宽高比。默认值在前。 |
| `resolutions` | 模型渲染的分辨率。默认值在前。 |
| `frameSizes` | 以像素为单位的 `[width, height]`，按宽高比再按分辨率给出。 |
| `minDurationSec`、`maxDurationSec` | 最短和最长的镜头，以秒为单位。 |
| `numFramesByDurationSec` | 从最小值到最大值的每个整秒时长的帧数。 |

| `RenderStreamEvent` 类型 | 含义 |
| --- | --- |
| `last_frame` | `png`：视频最后一帧的 PNG 字节。该事件位于 `video_start` 之前或最后一个 `chunk` 之后。 |
| `video_start` | `mime`：视频的媒体类型。 |
| `chunk` | `bytes`：视频字节的下一部分。 |
| `done` | `timings`：后端的耗时。以 `_ms` 结尾的键是毫秒。其他键是秒。如果供应商测量了产出，`durationSec` 表示实际视频时长。 |

`renderTimings(headers)` 从 FastVideo 或 UniServe 应答的头部读取 `done` 的耗时：`inference_s` 来自 `x-inference-time-s`，`x-stage-durations` 的 JSON 对象中每个阶段对应一个 `<stage>_s`。缺少的头部、不是 JSON 的 `x-stage-durations` 和不是有限数的值不添加耗时，所以提供方仍然产出已完成的视频。

### `dvModels` 服务

提供方插件调用 `register`。消费方调用其他方法。

| 方法 | 返回值 | 语义 |
| --- | --- | --- |
| `register(entry)` | `() => void` | 添加一个条目。返回的函数移除该条目。第二次调用该函数不做任何事。已存在同键条目时抛出错误。在 `ctx.effect` 内调用 `register`，这样销毁提供方插件会移除它的条目。DSH skill 注册表挂载期间，条目的 `promptSkill` 是一个运行时 skill，直到条目被移除。 |
| `get(key)` | `ModelEntry \| undefined` | 具有该键的条目，或 `undefined`。 |
| `resolve(tasks, params)` | `ModelEntry<T>` | `modelKey(params)` 读出的键所对应的条目，且其任务在 `tasks` 中。没有属于 `tasks` 之一的条目具有该键时，抛出 `Unknown model "<key>"; call dv_models_list for the models.`。 |
| `whileServing(tasks, start)` | `() => void` | 目录获得第一个属于 `tasks` 之一的条目时调用 `start`，失去最后一个这样的条目时调用 `start` 返回的处置函数。返回的函数停止监听并调用该处置函数。把它传给 `ctx.effect`，如 `@dv/shot-render` 对其操作的做法。 |
| `labelTasks(labels)` | `() => void` | 按任务名添加 `labels` 中每个任务的中文和英文标签 `{zh, en}`。原语声明为它列出的任务添加标签。返回的函数移除这些标签。第二次调用该函数不做任何事。某个任务已有标签时抛出错误，此时不添加任何标签。 |
| `taskLabels()` | `Record<string, {zh, en}>` | `labelTasks` 添加且尚未移除的每个标签，按任务名。[`@dv/api`](../api/README.zh.md) 在 `GET /api/dv/tasks` 提供它。 |
| `list(filter?)` | `ModelEntry[]` | 与 `modality`、`task` 和 `provider` 中每个给定字段都匹配的条目，按注册顺序。未给出的字段匹配所有条目。 |
| `onChanged(listener)` | `() => void` | 每次注册和每次移除后调用 `listener`。返回的函数移除该监听器。 |
| `catalog()` | `Promise<Record<string, JsonValue>[]>` | 每个条目，与 `dv_models_get` 返回的相同，按注册顺序：键、描述和 `schema()`。`schema()` 拒绝、或在 `Config` 字段 `catalogSchemaTimeoutMs`（默认 5000 ms）内没有回答的条目的 schema 为 null。[`@dv/api`](../api/README.zh.md) 在 `GET /api/dv/models` 提供它，因此浏览器和 agent 读取同一个目录。 |

本服务还为 agent 注册工具 `dv_models_list` 和 `dv_models_get`、skill `video-model-selection`，以及每个条目的提示词 skill。它不向系统提示词添加任何内容。

当 `dvProject` 存在时，`dv_models_select` 通过项目操作 `models.select`（版本 2）保存当前对话某一模态（`modality`，例如 `video`、`image` 或 `audio`）的默认模型。`models.select`、`models.load` 和 `models.unload` 在撤销历史之外（`OperationSpec.outsideHistory`）：历史面板不列出它们，撤销和重做从不改变这个选择，撤销之后的调用保留重做可恢复的步骤及其渲染。provider 和 model 都为空字符串时，该模态选择 Auto；为没有已配置模型的模态做选择会被拒绝。此后该模态的 agent 生成必须使用该 provider/model，直到用户或 agent 更改选择（`assertModelSelection`，每个 `@dv/generation` 操作都会调用），但视频 `v2v` 生成除外，它可用任意模型重新生成已有片段；其他模态的生成和用户调用不受检查，已有生成保留其记录中的模型和任务。输入框在操作员 LLM 选择器旁显示这些默认值，因此用户无需每次生成都重新选择。可选的 `models` 状态按写入顺序从项目中每条成功的 `models.select` 记录按对话和模态重建选择，与当前位置无关，因此选择在重启后保留；版本 1 的记录没有 `modality`，视为视频选择，旧项目从 Auto 开始。项目摘要给每个 agent 其所在对话的选择，每个模态一个 `<modality>_model` 字段：`{provider, model}`；Auto 时 `video_model` 为 null，其他模态的字段不出现；其他对话的选择不列出。`models.select` 记录在项目更新中写作 "<modality> model <model>, for the conversation that chose it only"，因此其他对话的 agent 不会把该选择当作自己的选择。

条目可以提供 `runtime.status`、`runtime.load` 和 `runtime.unload`。对应的操作工具为 `dv_models_status`、`dv_models_load` 和 `dv_models_unload`，参数为条目的四个键字段。这些工具管理已安装权重的 GPU 驻留，不下载权重。托管 FastVideo 后端在生成时加载所请求的配置，将模型切换与生成串行执行，并且仅保留文件和加载设置匹配的共享组件。未提供生命周期控制的 provider 保持原有生成行为，并在显式调用生命周期工具时报告该功能不可用。

### 提供方插件负责的部分

提供方插件把一个提供方连接到模型目录。[`@dv/fastvideo`](../fastvideo/README.zh.md) 是应遵循的示例。提供方插件负责以下部分：

- 提供方名称和后端的协议。
- 其 `Config` 中的部署值，如每个模型和任务的服务器 URL。
- 它注册的每个条目的所有成员。
- 把 `RenderRequest` 翻译成后端请求。插件从 `dvAssetPool` 读取每个素材的字节和媒体类型。插件以后端的格式发送它们。
- 每个条目可选的 `promptSkill`。模型目录注册它，提供方插件不注册任何 skill。

本包负责键、条目约定、请求和流类型、`dvModels` 服务、两个工具和选择 skill。它不包含任何特定模型的数据。

<a id="add-a-provider-or-a-model"></a>
### 添加提供方或模型

以下修改都不改动 `@dv/models`：

| 修改 | 改动 |
| --- | --- |
| 添加提供方 | 添加一个提供方插件包。 |
| 添加模型 | 修改一个提供方插件。 |
| 添加服务器 | 在组合中修改该提供方插件的 `Config` 行。 |

**没有兼容代码。**`@dv/models` 只有一种键格式和一种条目类型。它不包含面向其他目录格式的别名、适配器或回退代码。

[提供方贡献指南](../../../docs/cookbook/adding-a-dreamverse-provider.zh.md)是贡献者的操作流程。仓库 skill [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md) 给出智能体的操作步骤和检查。

<a id="share-model-registration-code"></a>
### 共用的模型注册代码

把配置的别名映射为条目的提供方插件使用这些导出，而不是自己写注册循环。在 `apply` 中调用它们；这些注册是调用方插件的 effect，所以卸载插件会释放全部条目。

| 导出 | 用途 |
| --- | --- |
| `assertModelAlias(alias, message)` | 当别名不是 1 到 120 个小写字母、数字和连字符，或不是以字母或数字开头时，抛出 `message`（`MODEL_ALIAS_PATTERN`）。对 `models` 配置的每个键调用它，使错误的别名让加载失败。 |
| `ModelGroup` | 一个已配置模型的条目：`id`（如别名）、条目必须重建时会变化的 `stamp` 字符串，以及构建条目的 `entries()`。 |
| `syncModelEntries(ctx, { label, conflict, groups })` | 用于只从配置解析模型的提供方。它在调用时注册 `groups()`，并在每次 `loader/volatile-update` 后再次注册。`stamp` 未变的组保留其条目，已变化或已移除的组被释放。它返回一个运行一次同步的函数。`groups()` 抛出，或某个键已被其他插件注册时，已注册的条目保持不变：第一次调用让插件加载失败，之后的调用在事件发射器中拒绝。 |
| `syncModelEntriesAsync(ctx, { label, conflict, stamp, resolve, settled })` | 用于读取远程目录来解析模型的提供方。`resolve(signal)` 返回各组，以及对每个其目录中没有的已配置模型的一句说明。这些模型被跳过，其余照常注册，下一次同步会重试。被更新的同步取代的同步会丢弃其结果。当前同步失败会释放全部条目。volatile 更新从不拒绝，失败会传给 `settled`。卸载会中止 `signal` 并等待正在运行的同步。它返回 `{ sync }`，用于 `apply` 中的第一次同步和发现路由。 |
| `createModelEntryRegistry(dvModels, conflict)` | 两种同步之下的注册表，供需要自己接线的提供方使用。`replace(groups)` 和 `clear()` 不注册 effect，所以由调用方释放。 |

[`@dv/reactor`](../reactor/README.zh.md) 使用 `syncModelEntries`，[`@dv/openrouter`](../openrouter/README.zh.md) 使用 `syncModelEntriesAsync`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本服务把条目按格式化后的键存在一个 `Map` 中。`register` 拒绝 map 中已有的键。每次注册和每次移除都在 map 改变后调用所有 `onChanged` 监听器。`register` 返回的函数只在 map 仍持有同一个条目时移除该条目。`labelTasks` 把标签按任务名存在第二个 `Map` 中，并拒绝这个 map 中已有的任务。标签的变化不调用任何 `onChanged` 监听器。

DSH 工具注册表（`tools`）挂载期间，本服务以 effect 注册 `dv_models_list` 和 `dv_models_get`。`dv_models_list` 用其参数筛选条目，返回每个条目的键和描述；条目有提示词 skill 时，还返回 `prompt_skill`，即该 skill 的名称。`dv_models_get` 用全部四个键字段查找条目，返回它的键、描述和 `schema()` 的 JSON。它不读取 `facts()`。`@dv/shot-render` 读取 facts 构建请求。

DSH skill 注册表（`skills`）挂载期间，本服务从 `skills/video-model-selection.md` 注册运行时 skill `video-model-selection`。agent 可以加载该 skill。用户不能从输入框调用它。在同一个注册表中，本服务按同样的调用规则注册每个条目的 `promptSkill`。条目或注册表到达时它注册该 skill，条目或注册表离开时它移除该 skill。多个条目共用同一 skill 名称时共用一次注册，该注册保留到这些条目中的最后一个离开为止。

[`@dv/shot-render`](../shot-render/README.zh.md) 用 `whileServing(['t2v', 'ref2v'], ...)` 注册 `shot.render`，并用 `resolve(['t2v', 'ref2v'], params)` 获取 `dv_shot_render` 调用所指定的条目。它用条目的 facts 构建 `RenderRequest`。它用 `validateGenerationRequest` 检查请求，然后渲染该请求。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `Config`、`formatModelKey`、`modelKey`、`servesTask`、`renderTimings`、`DvModels` 服务和两个工具 |
| [`src/types.ts`](src/types.ts) | `PrimitiveTypes`、`PrimitiveId`、`TaskMap`、`ModalityId`、`TaskOfPrimitive`、`ModelKey`、`RenderModelFacts`、`RenderRequest`、`RenderStreamEvent`、`ModelEntry`、`ModelFilter` |
| [`skills/video-model-selection.md`](skills/video-model-selection.md) | 模型选择 skill |
| [`tests/models.spec.ts`](tests/models.spec.ts) | Loader 组合中的模型目录、工具、skill 和系统提示词 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/fastvideo`](../fastvideo/README.zh.md)：用作示例的提供方插件。
- [提供方贡献指南](../../../docs/cookbook/adding-a-dreamverse-provider.zh.md)：谁可以添加提供方、应复用哪些包，以及如何维护。
- [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md)：添加提供方、模型或服务器的操作步骤。
- [`@dv/shot-render`](../shot-render/README.zh.md)：用条目渲染镜头的消费方。
- [`@dv/bundle`](../../bundle/dv/README.zh.md)：行 `dv-models` 和 `dv-fastvideo`。

-----

按时长生成的云端提供方在 API 未公布时可省略 `frameSizes` 和 `numFramesByDurationSec`。它们提供精确 `durationsSec`；消费者传递 `durationSec`、`resolution` 和 `aspectRatio`，而不臆造帧数。原生提供方继续提供像素几何和帧数。

<a id="model-experience"></a>
## 模型体验

### `dv_models_list` 工具定义与结果

#### 模型看到什么

DSH 工具注册表挂载期间，agent 看到工具 `dv_models_list`，带下面的描述。该工具有三个可选字符串参数：`modality`、`task` 和 `provider`。生成的工具目录不列出 DreamVerse 工具，所以本节引用工具描述和参数描述。一次调用返回一个文本块，内容是缩进的 JSON：一个数组，每个匹配条目一项，包含 `modality`、`task`、`provider`、`model`、托管方式 `hosting` 和 `description`；条目声明相关信息时，还包含显示名称 `display_name`、工作器选择能力 `worker_selection` 和提示词 skill 名称 `prompt_skill`。本包不向系统提示词添加任何内容。agent 只通过这两个工具和 `video-model-selection` skill 读取模型目录。

##### dv_models_list 描述

```markdown
List the models you can generate with, each with its key (modality, task, provider, model), its description, its hosting, and its display name, worker selection and prompt skill when available.
```

##### dv_models_list 参数描述

```markdown
- modality: Only models of this modality.
- task: Only models for this task.
- provider: Only models of this provider.
```

#### Token 影响

工具注册表挂载期间，每次请求中定义约 95 个 token。每个条目的结果约 30 个 token，再加上该条目描述的 token。

#### KV Cache 影响

定义是稳定工具部分中的固定文本。注册或移除条目不会改变定义。挂载或移除本包会改变工具列表，使缓存前缀从工具部分起失效。每个结果在其调用之后进入对话。结果之前的缓存前缀不变。

### `dv_models_get` 工具定义与结果

#### 模型看到什么

DSH 工具注册表挂载期间，agent 看到工具 `dv_models_get`，带下面的描述。该工具有四个必填字符串参数：`modality`、`task`、`provider` 和 `model`。一次调用返回一个文本块，内容是缩进的 JSON：四个键字段、`description` 和提供方的 `schema` JSON，其中包含模型的限制。键不对应任何条目时，调用以 `No model has the key <modality>/<task>/<provider>/<model>; call dv_models_list for the models you can use.` 失败。后端无法连接时，调用以后端的错误失败。

##### dv_models_get 描述

```markdown
Read one model by its key from dv_models_list: its description and its schema (its limits, such as durations, aspect ratios and resolutions; the inputs it accepts with their media types and counts; and the parameters it takes in `extra`).
```

##### dv_models_get 参数描述

```markdown
- modality: The modality of the model, as dv_models_list lists it.
- task: The task of the model, as dv_models_list lists it.
- provider: The provider of the model, as dv_models_list lists it.
- model: The model name, as dv_models_list lists it.
```

#### Token 影响

工具注册表挂载期间，每次请求中定义约 170 个 token。结果大小取决于模型的描述和 schema。`fasth3` 在任务 `ref2v` 下的结果约 300 个 token。

#### KV Cache 影响

定义是稳定工具部分中的固定文本。注册或移除条目不会改变定义。挂载或移除本包会改变工具列表，使缓存前缀从工具部分起失效。每个结果在其调用之后进入对话。结果之前的缓存前缀不变。

### `video-model-selection` skill

#### 模型看到什么

DSH skill 注册表挂载期间，`dsh-tool-skill` 渲染的 skill 目录列出下面的 skill 目录行。agent 以 `video-model-selection` 调用 `skill` 工具时，工具结果携带 `skills/video-model-selection.md`。该文件是针对每个镜头的九步流程。agent 用 `dv_models_list` 和 `dv_models_get` 获取镜头任务的候选。agent 移除无法渲染镜头的时长、宽高比、分辨率、参考素材或首帧的每个候选。用户不能用 `/video-model-selection` 调用该 skill。

##### Skill 目录行

```markdown
- `video-model-selection`: How to choose the video model for each shot: the task of the shot, the candidate models and their limits, and when to ask the user.
```

#### Token 影响

skill 注册表挂载期间，目录中约 40 个 token。agent 每次加载该 skill 约 400 个 token。

#### KV Cache 影响

挂载或移除本包会改变 skill 列表。随后 `dsh-tool-skill` 追加一份替换目录。已加载的 skill 正文在其调用之后作为工具结果出现。目录和 skill 正文之前的缓存前缀不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制适用于模型目录、两个工具和选择 skill。

- **只有选择 skill 解释任务**——两个工具的文本不列出任何任务，也不提及任何媒体类型。`video-model-selection` 的第 1 步只解释 `t2v` 和 `ref2v`。插件可以通过声明合并添加任务。该任务会出现在 `dv_models_list` 结果中。本包不告诉 agent 何时选择该任务。
- **没有就绪检查**——提供方插件注册条目后，该条目就出现在 `dv_models_list` 中。此时该条目的后端可能无法连接。只有 `dv_models_get` 或一次渲染读取该条目时，后端失败才会显现。
- **键字段可以包含 `/`**——`register` 按 `formatModelKey` 的格式比较键。`register` 不拒绝字段中的 `/`。提供方 `a/b` 加模型 `c` 与提供方 `a` 加模型 `b/c` 的格式化键相同，所以第二次注册失败。提供方插件必须使用不含 `/` 的名称。
- **`schema()` 没有固定的 JSON 格式**——每个提供方插件定义自己的 JSON。`@dv/models` 不检查该 JSON。只有 agent 读取它；没有消费方代码解析它。每个条目的 `validateGenerationRequest` 成员是对输入和 `extra` 值唯一强制执行的检查。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
