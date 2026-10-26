---
description: "DreamVerse 的分镜组件：dvShotPlan 服务，带 PlanId 和编号版本的分镜计划，操作 plan.create 和 plan.update 及其智能体工具，按模态、任务、提供方和模型写明模型目录中的模型的镜头，以及 plan 状态切片。"
kind: "package-reference"
---

# @dv/shot-plan

[English](README.md) | 中文

## 概述

用这个包在生成任何内容之前规划一段视频。一个分镜计划有一个 `PlanId`（`p1`、`p2`……）和编号的版本，每个镜头以 [`@dv/models`](../models/README.zh.md) 模型目录中的键写明渲染它的视频模型：`modality`、`task`、`provider` 和 `model`。`plan.create` 存储新分镜计划的版本 1，`plan.update` 存储下一个版本。智能体以 `dv_plan_create` 和 `dv_plan_update` 调用它们。工作流插件（例如 [`@dv/workflow-story`](../workflow-story/README.zh.md)）批准一个版本并渲染它的镜头。这两个操作声明界面代替其工具名显示的标签：新建分镜计划 / Create plan 和 修改分镜计划 / Update plan。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project` 之后挂载本插件；素材库存储分镜计划文件。分镜计划的一个版本包含镜头（每个镜头有模型键 `modality`、`task`、`provider`、`model`，以及提示词、时长和输入），以及任务为 `ref2v` 的镜头共用的参考。分镜计划按原样存储每个模型键；批准该分镜计划的工作流对照模型目录检查这个键。归约函数维护 `plan` 切片：每个分镜计划的每个版本。

```yaml
- id: dv-shot-plan
  name: '@dv/shot-plan'
```

本插件没有配置字段。

| 操作 | 工具 | 参数 | 输出和报告 | 确认 |
| --- | --- | --- | --- | --- |
| `plan.create` | `dv_plan_create` | `shots`（每个含 `modality`、`task`、`provider` 和 `model`（`dv_models_list` 列出的一个模型的键）、`prompt`、`duration_sec?`、`references?`（仅任务 `ref2v`）、`continue_previous?`（仅任务 `ref2v`，镜头 1 不可用）、`seed?`）、`title?`、`references?`（任务为 `ref2v` 的镜头共用）、`aspect_ratio?`、`resolution?`、`seed?` | `plan`（`plan.json`）；报告 `{plan, version: 1}`，含分配的 PlanId | `never` |
| `plan.update` | `dv_plan_update` | `plan`（PlanId）和 `plan.create` 的参数：完整的下一个版本 | `plan`（`plan.json`）；报告 `{plan, version}` | `never` |

`PlanId` 是 `p<n>`：`plan.create` 分配的编号比项目历史列表中（包括当前位置之后的步骤）任何分镜记录在 `report.plan` 中存过的最大编号大一，所以历史列表中不会有两个分镜计划共用一个 ID。版本从 1 编号，镜头由它在版本中从 1 开始的位置标识，所以六个镜头之后添加的镜头是镜头 7。参考是已注册引用种类的版本（`<id>@<n>`）或素材 ID。切片 `components.plan` 是 `{plans: Record<PlanId, PlanVersion[]>}`，最早的版本在前；`PlanVersion` 是 `Plan` 的字段加上 `version` 和 `created_by`（`plan.create` 或 `plan.update` 记录）。服务方法 `get(state, plan, version?)` 返回某个项目状态中的一个 `PlanVersion`，`shots(state, plan, version?)` 按所有工作流读取分镜计划的同一方式解析它的镜头。`ResolvedShot` 含镜头从 1 开始的 `slot`、原样的 `shot`、计划的 `aspect_ratio` 和 `resolution`、镜头自己的 `seed`（否则用计划的）、适用的 `references`（镜头自己的，否则用计划的；`ref2v` 以外的任务没有）以及 `continuePrevious`（`slot` 1 之后、任务为 `ref2v` 的镜头上的 `continue_previous`）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`plan.create` 和 `plan.update` 由 runner 校验参数，没有镜头的分镜计划会失败，并通过 `context.importAsset` 把版本导入为 `plan.json`；对任何调用方，在写下记录之前，它们拒绝未知 PlanId 的分镜计划（`plan.update`）、任务不是 `ref2v` 却带参考的镜头，镜头 1 上或任务不是 `ref2v` 的镜头上的 `continue_previous`，以及不接上一镜头的镜头在提示词中引用首帧（`dv:input/first_frame`），用一个错误列出每个镜头及其问题；它们还拒绝指向某个引用类型的未知版本的参考（`dvProject.parseReference`）。它们从不读取模型目录：镜头的模型键按原样存储，批准该分镜计划的工作流的预览会报告模型目录不提供的键。它们的摘要是 `plan <PlanId> v<version> with <n> shots`。两个规格都设置 `omitParamsFromResult`，所以模型可见的工具结果不含参数，因为模型自己的工具调用已经带有这些参数；日志中的结果值保留参数。本组件不指名其他组件的任何操作。

归约函数忽略状态不是 `done` 的记录：一条已完成的 `plan.create` 添加其 `report.plan` 指定的分镜计划的版本 1，一条已完成的 `plan.update` 添加其 `plan` 参数指定的分镜计划的下一个版本。其他记录（例如旧日志中的 `plan.approve` 记录）以及指定未知分镜计划的记录不产生任何效果。智能体摘要把每个分镜计划列一次，形如 `{plan, title, version, shots}`：最新版本及其镜头数。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotPlan`：两个操作、PlanId 分配、`get` 和 `shots` |
| [`src/reducer.ts`](src/reducer.ts) | `plan` 归约函数 |
| [`src/types.ts`](src/types.ts) | `PlanId`、`Plan`、`Shot`、`PlanVersion`、`ResolvedShot`、`PlanState` |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、调度运行、归约函数和智能体工具。
- [`@dv/models`](../models/README.zh.md)：镜头从中选取模型的模型目录，带 `dv_models_list` 和 `dv_models_get`。
- [`@dv/shot-render`](../shot-render/README.zh.md)：批准调度的操作 `shot.render`。
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md)：每个组件遵循的布局。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

两个工具 `dv_plan_create` 和 `dv_plan_update`，格式与 `@dv/project` 给每个操作工具的格式相同。描述告诉智能体只有另一个故事才新建分镜计划，给每个镜头从 `dv_models_list` 选一个模型、按它写提示词，并用 `dv_plan_update` 在故事的分镜计划上延长、缩短或修改故事（传完整的分镜计划，所有镜头按顺序）；描述说明分镜计划本身不渲染任何内容，不提批准工具。两个工具都带有确定性说明。

#### Token 影响

插件挂载期间，两个定义固定约 1,200 个 token；`@dv/project` 的共享参数给每个定义最多增加约 200 个 token。

#### KV Cache 影响

这些定义位于每个智能体请求固定的工具段中；挂载或移除插件会改变工具列表，使从工具段开始的缓存前缀失效。

### 工具结果

#### 模型看到什么

一次 `dv_plan_create` 调用返回一个文本块，例如 `done <record>: plan p1 v1 with 2 shots`，附带 `plan.json` 输出和报告 `{"plan":"p1","version":1}`；一次 `dv_plan_update` 调用返回 `plan p1 v2 with 2 shots` 和带新版本的报告。两种结果都不重复分镜计划。违反其任务规则的分镜计划在任何记录之前被拒绝，每个问题一句话，例如镜头 1 上的 `continue_previous`。

#### Token 影响

无论分镜计划多长，新建或更新的结果都约为 60 个 token：记录行、`plan.json` 输出行和报告。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。分镜计划只通过模型自己的调用参数到达模型。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **分镜计划只有文本**：分镜计划是一个 JSON 文件；除记录和画布节点外没有分镜计划编辑器或预览。
- **这里不检查模型键**：`plan.create` 和 `plan.update` 接受模型目录不提供的模型键；智能体从批准该分镜计划的工作流的预览得知这一点。
- **只有任务 `ref2v` 接受参考**：镜头只在任务为 `ref2v` 时带上分镜计划的参考，所以在 `@dv/models` 的 `TaskMap` 中新增接受参考的任务时需要修改这里。
