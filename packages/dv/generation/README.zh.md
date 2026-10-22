---
description: "本包是 DreamVerse 的生成辅助库：defineGeneration 把一个生成原语的声明变成一个服务，该服务拥有一个组件键和一个操作，每次模型调用写一条记录；添加原语或从工作流调用原语时，阅读本页。"
kind: "package-reference"
---

# @dv/generation

[English](README.md) | 中文

## 概述

使用本包以一份简短声明添加一个生成原语，例如图像生成。`defineGeneration(spec)` 返回一个 Cordis 服务类。该服务注册声明的组件键和任务标签，并在模型目录提供其某个任务期间注册一个操作。该操作的每次调用是一次模型调用和一条记录，其参数含模型键、提示词、种子和 `extra`。每次 agent 调用都受 GPU 门控。该服务还为工作流实现 `GenerationApi`。本辅助库不点名任何原语。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

原语包在 `@dv/models` 的 `PrimitiveTypes` 中声明自己的行，在 `TaskMap` 中声明自己的任务，然后默认导出 `defineGeneration({...})`。其 bundle 行在 `@dv/project` 和 `@dv/models` 之后挂载该服务，该服务注入这两者。

| `GenerationSpec` 字段                        | 含义                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `service`、`component`、`operation`          | 服务名、组件键，以及操作名 `<component>.<verb>`                                            |
| `primitive`、`tasks`、`label`、`description` | 原语、该原语的每个任务及其中英文标签、操作标签，以及工具描述                               |
| `params`、`inputs`、`outputs`                | 共享参数以外的参数、输入角色，以及输出；声明可以重述 `prompt` 以描述它                     |
| `seed`、`toolParams`、`prepareToolCall`      | 对没有种子的模型设为 `false`；仅工具参数，以及检查前对 agent 调用的修改                    |
| `toRequest`、`toOutputs`                     | 由事实、参数和 `RequestInput` 构建模型请求，有种子的声明还由种子构建；把模型结果导入为输出 |
| `estimate`、`confirmText`、`summarize`       | 必需的、由条目得出的 GPU 估算，确认文本，以及一行记录摘要                                  |

| `GenerationApi` 方法           | 行为                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `render(call)`                 | 带着调用的 `started_by` 通过 `dvProject.run` 运行该操作；带 `after` 的调用被排期                      |
| `check(call, state, chained?)` | 调用能运行时为 `[]`，否则为第一个拒绝理由，或合为一条理由的模型问题；`chained` 角色算作输入；从不写入 |
| `estimate(call)`               | 声明的估算；仅当键不指向声明的任务的任何条目时为 `0`                                                  |
| `findTake(state, call, where)` | 该操作中 `where` 接受的、声明参数与输入都相等的最新完成记录                                           |
| `parseInputs(raw, state)`      | 针对该操作的 `dvProject.parseInputs`                                                                  |

`importOne(run, file)` 把运行中调用的一个输出导入为资产，名为 `<记录 ID 的前 8 个字符>.<mime 子类型>`，例如 `a1b2c3d4.png`。调用没有记录时它抛出错误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

该服务在存续期间注册组件，然后用 `dvModels.labelTasks` 注册任务标签；为同一任务再加标签的第二个声明无法启动。该操作把模型键和 `prompt` 放在声明的参数之前，把 `seed`（除非 `seed` 为 `false`）和 `extra` 放在其后。它不是确定性的，使用 GPU，版本为 `1`，以 `over_gpu_budget` 确认。前置条件以 `check` 的理由拒绝调用，agent 工具在确认前也运行它；它不传任何链式角色，所以渲染从不接受链式角色。`check` 只读取调用的项目、参数和输入。它用 `dvModels.resolve` 解析条目，把每个输入解析为其资产，把每个链式角色加为 `{ role, ref: null, resolved_asset: null }`，并构建请求。当每个输入都有资产时，它加入 `validateGenerationRequest` 的问题；否则 `execute` 在模型运行前检查完整请求。`execute` 使用 `seed` 参数或抽取一个种子（`seed` 为 `false` 时没有种子），再次构建并验证请求，渲染，并把结果交给 `toOutputs`。它把 `seed` 加入报告，并在 `toOutputs` 未返回成本时把声明的估算记为成本。`findTake` 以 JSON 比较声明的参数（操作 `params` 的键）和输入，所以键的顺序无关，并按顺序比较每个角色的输入。内核也会存下未声明的参数，例如多余的 `seed`；它不改变 `findTake` 的结果。

| 文件                           | 内容                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [`src/index.ts`](src/index.ts) | `defineGeneration`、`importOne`、`GenerationSpec`、`GenerationApi`、`GenerationCall`、`RequestInput` |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：`PrimitiveTypes`、`TaskMap`、`resolve`、`whileServing` 和 `labelTasks`。
- [`@dv/project`](../project/README.zh.md)：`OperationSpec`、`run`，以及每个操作的 agent 工具。

-----

<a id="model-experience"></a>
## 模型体验

### 每个生成工具的共享参数与拒绝文本

#### 模型看到什么

内核把每个生成操作变成 agent 工具 `dv_<component>_<verb>`。其参数以 `modality`、`task`、`provider`、`model` 和 `prompt` 开头，以 `seed` 和 `extra` 结尾，描述如下；`seed: false` 的声明没有 `seed`。工具接受 `user_requested`，当本轮超过 GPU 预算时，不带它的调用被拒绝，文本为 `<label.en> with <provider>/<model>: "<prompt, first 80 characters>"`，除非声明给出自己的文本；拒绝消息的下一行给出估计值。被拒绝的调用使工具调用失败，并给出理由和句子 `Nothing was generated; change the inputs or params, then call again.` 条目的 `facts()` 或 `validateGenerationRequest` 拒绝时，理由写作 `Model <modality>/<task>/<provider>/<model> is unavailable: <message>`，句子为 `Nothing was generated; no change to the call helps while the model is unavailable.` 模型问题写作 `Model <modality>/<task>/<provider>/<model> cannot generate this: <problems>`。结果报告带有 `seed`。

##### 共享参数描述

```markdown
- modality: The modality of a model that dv_models_list lists.
- task: The task of that model, as dv_models_list lists it.
- provider: The provider of that model, as dv_models_list lists it.
- model: The model name, as dv_models_list lists it.
- prompt: The complete prompt; follow the prompt skill that dv_models_list names for the model, if any.
- seed: Fixed seed; omitted, a random seed is drawn and recorded.
- extra: The model's own parameters, as dv_models_get lists them; omit it when the model has none.
```

#### Token 影响

在工具注册表挂载、且有模型提供其某个任务期间，每个生成工具定义中约 200 个 token（七个参数的字符数除以四），另加内核添加的 `user_requested` 参数约 50 个 token。

#### KV Cache 影响

文本固定。工具在其任务的第一个条目注册时出现，在最后一个条目移除时离开；这会改变工具列表，并使工具段及之后的缓存前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **待完成输入和链式输入的检查较晚**：当输入是一条尚未完成的记录的输出，或角色是链式的时，模型只在 `execute` 中检查请求，所以它的拒绝使记录失败，而不是拒绝调用。
- **固定的操作版本**：每个生成操作的版本都是 `1`；声明无法标记其参数的变化。
