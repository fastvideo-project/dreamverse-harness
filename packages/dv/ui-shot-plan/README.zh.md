---
description: "DreamVerse 分镜计划的浏览器半边：以最新版本画出每个分镜计划、带每个镜头一个位置的画面网格的画布节点类型，它的分镜计划卡片，让分镜计划参考素材的产出记录留在画布上的使用中记录，带版本、批准状态和镜头的分镜计划编辑器，以及计划记录的历史行。"
kind: "package-reference"
---

# @dv/ui-shot-plan

[English](README.md) | 中文

## 概述

使用本包在画布上显示 `plan` 切片（`@dv/shot-plan`）中的分镜计划。它在 `@dv/ui-canvas` 的 `dvCanvas` 中注册一个节点类型和一个使用中记录描述符，并在 `dv.canvas.card` 和 `dv.canvas.editor` 中以键 `plan` 注册分镜计划卡片和编辑器。每个分镜计划以最新版本画成一个节点 `plan:<PlanId>`：标题 `3 个镜头 · 0:12` / `3 shots · 0:12`、每个镜头一个位置的画面网格，以及卡片 `分镜计划 · 第 2 版` / `Plan · v2`。产出最新版本参考素材的记录留在画布上。它还在 `@dv/ui-history` 的 `dvHistory` 中注册一个历史行，写出 `plan.create` 或 `plan.update` 记录的计划。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠加了 `dsh-web-app`、`@dv/api`、`@dv/ui-canvas` 和 `@dv/ui-media` 的 profile 中挂载这个插件，`@dv/ui-media` 的 `dv.media` 组件工厂绘制分镜计划编辑器的参考素材。先构建浏览器包：`pnpm run build` 写出 `lib/client.js`。

```yaml
- id: dv-ui-shot-plan
  name: '@dv/ui-shot-plan'
```

| 描述符 | 注册表 | 值 |
| --- | --- | --- |
| `planNodeType` | `dvCanvas.nodeTypes` | `id: '@dv/ui-shot-plan'`、`type: 'plan'`、标签 `分镜计划` / `Plan`、颜色 `var(--dv-node-2)`、第 1 列；每个有版本的分镜计划一个切片条目：ID 为 `plan:<PlanId>`，`record` 是写下最新版本的记录，`records` 是写下较早版本的记录（第 1 版的分镜计划没有），标题是镜头数，每个镜头都有时长时后接 ` · <总时长>`，没有素材，`slots` 是镜头数，`bodyHeight` 为 46 |
| `PlanCard` | `dv.canvas.card` 插槽 | 键 `plan`；卡片正文：类型标签和显示的版本，即节点 `records` 的数量加一，`分镜计划 · 第 2 版` / `Plan · v2`，使用画布的文字缩放 |
| `PlanEditor` | `dv.canvas.editor` 插槽 | 键 `plan`，所有者属性 `{ node, state, operations, host }`（只使用 `node` 和 `state`），以及 inject 的 `hooks`：`chainAnchors` 和 `versionKinds`（`dvCanvas` 注册表）和 `taskLabels`（`GET /api/dv/tasks`，只加载一次）；显示所选版本的 `title`，在分镜计划的各版本之间切换（`第 1 版` / `v1`……；先显示最新版本），并显示所选版本的状态（某个已注册的链锚点把它列为节点的已批准版本时为 `已批准` / `Approved`，在批准前被后来的版本取代时为 `已被第 N 版取代` / `Replaced by vN`，否则为 `待批准` / `Awaiting approval`）、镜头数、总时长、画幅比例和参考素材，然后每个镜头一张卡片：时长、模型和生成任务标签、按输入顺序列出的各种媒体类型的参考素材，每个都经 `dv.media` 以用途 `thumb` 绘制（每张图片编号为 `Picture N`，名字取第一个能给出该版本名字的 `VersionKind`，否则取素材名）、是否接上一镜头，以及提示词，其中每个 `Picture N` 或 `<Picture N>` 标记显示为那张图片；生成任务为 `t2v` 的镜头没有参考 |
| `planReferencesInUse` | `dvCanvas.recordsInUse` | `id: '@dv/ui-shot-plan'`；`uses` 给出每个分镜计划最新版本及其镜头的参考中每个素材的产出记录（`created_by`）；`c1@1` 这样的版本引用不对应记录 |
| `planHistoryRow` | `dvHistory.rows` | `match: 'plan.'`；`plan.create` 的主体是它的标题，写成 `《猫》` / ` “猫”`，没有标题时是它的 PlanId，写成 ` p1`；`plan.update` 的主体是带它写下的版本的 ` p1 → v2`，没有版本时是 ` p1`；PlanId 和版本取自记录的 `report`，没有时取自参数，用记录 ID 命名的分镜计划没有主体；其他 `plan.*` 记录没有主体 |

Host 半边不注册任何东西。浏览器半边的 `inject` 为空：它在 `ctx.inject(['dvCanvas'], …)` 里注册两个描述符，在画布声明 `dv.canvas.card` 和 `dv.canvas.editor`（它的 `dv.canvas` 组件工厂的子插槽，画布标签主体和画布中央视图都渲染这个组件工厂）后在 `ctx.inject(['dvCanvas', 'slots'], …)` 里注册卡片和编辑器条目，在 `ctx.inject(['dvHistory'], …)` 里注册历史行，所以缺少这些服务时也能加载，每项注册随服务或插件一起离开。文字跟随 `<html lang>` 的界面语言（`@dv/ui-kit/locale.ts` 的 `pickText` 和 `useText`）；语言改变时画布重新读取条目。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/client/index.ts` 把客户端门面 `@dv/shot-plan/types` 的 `PlanState` 合并进 `@dv/ui-kit` 的客户端 `ComponentStates`，所以这个包按类型读取 `plan` 切片。画布按位置用锚定在条目上的版本的预览填充画面网格，在中央区域聚焦 `records` 中的记录时打开条目，并在自己的编辑器标题栏下显示编辑器条目。分镜计划编辑器从链锚点读取已批准版本，从版本类别读取版本引用的名字，从 `GET /api/dv/tasks` 读取生成任务标签，都通过它的 inject `hooks`；`src/client/picture.ts` 中的 `isPicture` 判断视频模型把哪些参考素材编号为 `Picture N`，即图片。`src/client/PlanEditor.tsx` 中的 `plansOf(state)` 读取 `plan` 切片，`@dv/shot-plan` 未加载时给出 `{}`；画布条目和分镜计划编辑器都通过它读取。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 不做任何事的 Host Loader 入口 |
| [`src/client/index.ts`](src/client/index.ts) | `planNodeType`、`planReferencesInUse`、`planHistoryRow` 和各项注册 |
| [`src/client/PlanEditor.tsx`](src/client/PlanEditor.tsx) | `PlanEditor`、`shotReferences` 和 `totalSec` |
| [`src/client/PlanCard.tsx`](src/client/PlanCard.tsx) | `PlanCard` |
| [`src/client/picture.ts`](src/client/picture.ts) | `isPicture(asset)`：一个镜头的哪些参考素材被视频模型按输入顺序编号为 `Picture 1`、`Picture 2`……，即其中的图片 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/shot-plan`](../shot-plan/README.zh.md)：`plan.create`、`plan.update` 和 `plan` 切片。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md)：画布节点契约（`NodeType`、`NodeEntry`、`RecordsInUse`、`ChainAnchor`）以及画布如何填充画面网格。
- [`@dv/ui-history`](../ui-history/README.zh.md)：历史行如何得到主语，以及 `@dv/ui-history/contract` 的 `HistoryRow` 描述符类型。
- [`@dv/ui-media`](../ui-media/README.zh.md)：绘制参考素材的 `dv.media` 组件工厂。

-----

<a id="model-experience"></a>
## 模型体验

无，作为浏览器端的计划节点和计划编辑器；它们只显示计划，不写任何记录。

#### KV Cache 影响

无；这个包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **分镜计划标题只在编辑器正文里** — 条目的标题是镜头数和总时长，所以分镜计划自己的 `title` 出现在分镜计划编辑器的版本行里，但不出现在任何卡片和编辑器标题栏中。
