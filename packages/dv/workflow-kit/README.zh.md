---
description: "DreamVerse 工作流的镜头遍历：walkShot、planShots、checkShots 和 shotLine 读取分镜计划的一个版本而不写入，scheduleShots 按顺序排期渲染，chainStarter、takeFilter 和 keepTimeline 检查发起一条成片或一次排布的记录；编写或调试渲染某个版本全部镜头的工作流时打开本页。"
kind: "package-reference"
---

# @dv/workflow-kit

[English](README.md) | 中文

## 概述

在渲染一组镜头的工作流里使用本包。`walkShot`、`planShots`、`checkShots` 和 `shotLine` 把分镜计划的一个版本变成渲染步骤、复用的成片、拒绝原因和预览行；它们都不写入任何东西，所以预览、拒绝检查和批准读到相同的步骤。`scheduleShots` 请生成服务为其余每个步骤渲染一次，每次排在前一次之后，并标上 `started_by`。`chainStarter`、`takeFilter` 和 `keepTimeline` 用工作流的 `Owns` 规则检查发起一条成片或一次排布的记录。本包没有组件、服务或操作，不指名任何工作流。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在工作流的操作里导入这些函数，并传入渲染镜头的生成服务，例如 `ctx.dvShotRender`。每个函数只接收它调用的 `GenerationApi` 方法（`@dv/generation`）。`Owns` 是工作流判断发起记录的规则，例如"本计划的一条 `<key>.approve` 记录"。

| 函数 | 行为 |
| --- | --- |
| `walkShot(resolved, overrides?)` | `dvShotPlan.shots` 返回的一个 `ResolvedShot` 对应的 `WalkShot`：参数含模型键、`prompt`，以及已设置的 `duration_sec`、`aspect_ratio`、`resolution`、`seed` 和 `extra`；覆盖值优先 |
| `planShots(render, state, shots, where)` | 按顺序为每个 `WalkShot` 返回一个 `WalkStep`：解析出的 `reference` 输入，以及 `findTake` 在 `where` 接受的记录中找到的成片或 null。接续镜头以前一个镜头复用的成片作为 `first_frame`（输出 1，即最后一帧静帧）匹配；前一个镜头需要渲染时，它从不复用 |
| `checkShots(render, state, steps)` | `check` 对需要渲染的步骤给出的每条原因对应一个 `{ slot, reason }`。复用步骤之后的接续步骤以那条成片的最后一帧静帧检查；渲染步骤之后的接续步骤以链式角色 `first_frame` 检查 |
| `shotLine(step, shot)` | `shot <n>: keeps its take`，或 `shot <n> (<模型键>, <秒数> s, continues from the previous shot): <提示词的前 80 个字符>` |
| `scheduleShots(render, steps, { ...origin, project, approve, intent, lane?, after? })` | 渲染每个 `reuse` 为 null 的步骤，排在前一次已排期渲染之后（第一次排在 `call.after` 之后，否则为 `after: []`），接续时以前一条成片作为 `first_frame`，意图为 `intent(slot)`，并带上 `started_by: { record: approve, slot, lane }`。返回 `takes`（每个步骤一条）和 `scheduled`（按顺序的渲染） |
| `chainOf(state, record)` | 记录自己的 `started_by`，否则为其 `based_on` 根记录的 `started_by`，否则为 null |
| `chainStarter(state, record)` | `chainOf` 指向的记录（取自状态中的日志），或 null |
| `takeFilter(state, owns)` | 一个 `where` 过滤器：记录的链发起记录存在且 `owns` 接受它 |
| `keepTimeline(timeline, state, linked, owns)` | 当 `timeline.lastWrite(state, linked)` 的链发起记录被 `owns` 接受时返回 `linked`，否则返回 null |

-----

<a id="understand-the-implementation"></a>
## 理解实现

`planShots` 在遍历时记住前一个步骤：接续镜头以前一条复用成片作为 `first_frame` 输入调用 `findTake`；前一个镜头需要渲染时跳过查找，因为那条成片还不存在。`checkShots` 遵循同一规则；对还不存在的成片，它把 `first_frame` 作为链式角色传入，所以角色计数和提示词引用能看到它，模型检查则等到执行时进行。它的调用只带项目、参数和输入，这正是 `check` 读取的全部内容，不带来源。`scheduleShots` 按顺序等待每次 `render` 调用，所以 `after` 链和 `first_frame` 输入可以指向前一次渲染的记录。`chainOf` 沿状态中的记录追溯 `based_on`，最多每条记录走一步，所以首尾相连的错误链条也会结束。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `WalkShot`、`WalkStep`、`Owns`、`walkShot`、`planShots`、`checkShots`、`shotLine`、`scheduleShots`、`chainOf`、`chainStarter`、`takeFilter`、`keepTimeline` |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：`run`、`after` 与调度器，记录上的 `started_by` 和 `based_on`。
- [`@dv/generation`](../generation/README.zh.md)：`GenerationApi`，遍历调用的生成服务方法。
- [`@dv/shot-plan`](../shot-plan/README.zh.md)：`dvShotPlan.shots`，解析分镜计划某个版本的镜头。
- [`@dv/timeline`](../timeline/README.zh.md)：`dvTimeline.lastWrite`，设置某条时间线片段的最新记录。

-----

<a id="model-experience"></a>
## 模型体验

### 一次遍历的渲染记录

#### 模型看到什么

本包不直接提供任何内容；`scheduleShots` 请生成服务写入的记录，作为普通记录经 `@dv/project` 的 `dv:project` 提示词段和 `dv_proj_*` 工具到达模型。

#### Token 影响

没有直接的 token；每次排期的渲染为项目历史增加一条记录。

#### KV Cache 影响

无；本包不向模型发送任何内容，也不增加工具或提示词文本。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **视频起始帧** — 接续镜头总是以前一条成片的输出 1（视频渲染的最后一帧静帧）作为角色 `first_frame` 的输入。
