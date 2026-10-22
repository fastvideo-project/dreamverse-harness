---
description: "DreamVerse 故事工作流的浏览器半边：`story.approve` 的画布链锚点，把一次批准的记录挂在它的计划节点下，并从 story 切片读出已批准的计划版本；以及历史行，写出一次批准的计划和版本，并为折叠在它下面的渲染写出标签。"
kind: "package-reference"
---

# @dv/ui-workflow-story

[English](README.md) | 中文

## 概述

使用本包在画布和历史面板中显示故事工作流（`@dv/workflow-story`）的记录。它在 `@dv/ui-canvas` 的 `dvCanvas` 中注册一个链锚点，在 `@dv/ui-history` 的 `dvHistory` 中注册一个历史行。锚点把一条 `story.approve` 记录启动的渲染和时间线记录挂在它的计划节点 `plan:<PlanId>` 下，并把一个计划的已批准版本交给计划编辑器。历史行把一次批准写成 `批准分镜计划 p1 v2` / `Approve plan p1 v2`，并把折叠在它下面的记录的展开按钮标为 `渲染 3 个镜头` / `Render 3 shots`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`、`@dv/api`、`@dv/ui-canvas` 和 `@dv/ui-history` 的 profile 里挂载插件，先用 `pnpm run build` 构建浏览器 bundle（写出 `lib/client.js`）。

```yaml
- id: dv-ui-workflow-story
  name: '@dv/ui-workflow-story'
```

| 描述符 | 注册表 | 值 |
| --- | --- | --- |
| `storyApprovalAnchor` | `dvCanvas.chainAnchors` | `starter: 'story.approve'`；`anchor` 给出 `plan:` 加记录的 `plan` 参数；`approvedVersions(state, 'plan:<p>')` 给出 `story` 切片中计划 `<p>` 各次批准的版本，按版本排序且不重复，其他节点给出 `[]` |
| `storyApprovalRow` | `dvHistory.rows` | `match: 'story.approve'`；主语 ` <plan> v<version>` 取自记录的 `report`，记录还没有 report 时没有主语；`fold(n)` 给出 `渲染 n 个镜头` / `Render n shots`，即这次批准启动的记录的展开按钮的标签，n 是历史面板画成媒体的折叠记录（镜头渲染）的数量 |

Host 半边不注册任何东西。浏览器半边在 `ctx.inject(['dvCanvas'], …)` 内注册锚点，在 `ctx.inject(['dvHistory'], …)` 内注册历史行，所以没有这两个服务时也能加载，每个描述符随它的服务或随插件一起移除。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`@dv/ui-kit` 的客户端状态类型把 `story` 切片的类型定为 `unknown`。`approvedVersions` 用 `isStorySlice` 收窄它：切片含一个 `approvals` 对象时通过，与 `@dv/workflow-story` 的 `story` reducer 写入的一致：按计划，最早的在前，每项 `{version, record}`。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 不做事的 Host Loader 入口 |
| [`src/client/index.ts`](src/client/index.ts) | `storyApprovalAnchor`、`storyApprovalRow` 及其注册 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/workflow-story`](../workflow-story/README.zh.md)：`story.approve` 和 `story` 切片。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md)：画布如何给有锚点的链分组，如何显示计划的批准状态，以及 `@dv/ui-canvas/contract` 的 `ChainAnchor` 描述符类型。
- [`@dv/ui-history`](../ui-history/README.zh.md)：历史行如何得到主语，以及 `@dv/ui-history/contract` 的 `HistoryRow` 描述符类型。

-----

<a id="model-experience"></a>
## 模型体验

无，作为故事工作流的浏览器端描述对象；它们显示该工作流的记录，不写任何记录。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **story 切片没有类型** — 客户端状态类型把 `story` 切片定为 `unknown`，`isStorySlice` 只检查切片里有一个 `approvals` 对象；本包不读取 `@dv/workflow-story` 的客户端类型。
