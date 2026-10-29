---
description: "DreamVerse 历史面板：项目历史列表中的步骤，每个操作一行，最新的在前，标出当前位置，之后的步骤变灰，带批准折叠、产出预览、撤销和重做、行上的 回到这一步，并能在画布或时间线上定位记录。"
kind: "package-reference"
---

# @dv/ui-history

[English](README.md) | 中文

## 概述

使用本包让 web 应用在对话旁边多一个历史面板。面板与图像编辑器的历史记录面板相同（[历史规则](../../../docs/subsystems/video-harness.zh.md#history-rules)）：它是一张列表，列出所打开项目来自所有发起者、来源和对话的步骤，最新的在前。当前位置的那一步带 当前，之后的步骤（重做能带回的步骤）变灰。每行显示谁做的、何时、状态和缩略图；选中一行会播放它的产出，若该步骤在当前位置或之前，还会在画布或时间线上定位它。顶部放着撤销和重做按钮，每一行的 ⋮ 菜单提供 回到这一步 / Go back to this step。这些移动不写记录；移动之后的新步骤会丢弃变灰的步骤。右侧栏的 `dv-history` 标签类型显示 shell 所打开项目的面板。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供右侧栏和客户端模块加载器）和 `@dv/api`（提供面板调用的路由）的 profile 里挂载插件。也要挂载 `@dv/ui-media`：它的 `dv.media` 组件工厂绘制缩略图和播放器。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

面板请求项目历史列表中的步骤，最新的在前。每行显示带主体的操作名称（`@dv/ui-kit` 的 `operationLabel`：操作在 `/api/dv/operations` 里的 `label`，没有时用它的工具名称，再没有时用操作名）（渲染镜头 1、新建角色「名字」）、谁做的（你、智能体、自动）、多久以前、状态，以及只有媒体行（已注册的 `HistoryRow` 带 `media` 的记录）才有的一张缩略图：该行的 `media.thumbnail(record, state)` 指定的素材，通过 `dv.media` 组件工厂以用途 `thumb` 绘制，例如版本的预览产出，没有时用它的第一个产出（`@dv/ui-generation` 的 `defineGenerationUi`），没有素材时用空方块，让媒体行保持对齐；其他行只显示文字。选中的行在下方通过 `dv.media` 以用途 `loop` 绘制它的第一个产出，所以视频静音循环播放，导入、静帧、剪切和导出也一样。智能体行的第二行显示记录自身的 `intent`，即智能体为这次调用给出的理由。主体来自为该操作注册的 `HistoryRow`（先按完整操作名匹配，再按 `'<key>.'` 匹配），例如 `@dv/ui-character` 的 `character.` 行；没有时，带链位置的记录写出这个位置，链带有 lane 时再加 ` · <lane>`（`@dv/ui-kit` 的 `chainOf`：记录自身的 `started_by`，没有时用它 `based_on` 根记录的 `started_by`，所以画布上的重新生成保留它的镜头号）。`started_by.record` 是某一行记录的已加载记录，按日志顺序折叠在那一行下面，由一个开关展开。开关显示启动它的那一行的 `fold(count)`，参数是折叠的媒体行数，例如 渲染 n 个镜头 / Render n shots；没有时显示第一条折叠记录的名称；还有媒体行未完成时再加上已完成的媒体行数。当前位置的一行带 当前，它之后的行变灰：文字变淡，缩略图变成黑白。其他每一行末尾有一个 ⋮ 按钮（更多操作），它的菜单提供 回到这一步（`/api/dv/undo` 带 `to` = 该步骤），把当前位置移到那一步，可在当前一步之前或之后。

```yaml
- id: dv-ui-history
  name: '@dv/ui-history'
```

Host 半边不注册任何东西。浏览器半边提供客户端服务 `dvHistory`（`@dv/ui-history/contract` 的 `DvHistory`），注册 `dv-history` 标签类型（侧栏指南页以"历史"提供的页面）和以自身 id `@dv/ui-history` 为键的标签主体，并在收到 `dv:history-focus` 窗口事件时打开该标签。插件的 UI 半边在 `ctx.inject(['dvHistory'], …)` 里用 `ctx.dvHistory.rows.register({ match, subject, focus, media, fold })` 为它的操作的记录命名，并保留返回的注销函数；`match` 是一个操作名或 `'<key>.'`，第二个 `match` 相同的行会抛错。可选的 `focus(record, records)` 接收当前状态的记录，返回选中该记录时中间区域移到哪里，即 `@dv/ui-shell/contract` 的 `CenterTarget`（`view` 是一个 `dv.center.view` 条目的 `id`，`target` 是该视图读取的 JSON 目标），或 null；没有 `focus` 时，目标是记录的画布节点（`{ view: 'canvas', target: { record } }`），但 `proj` 记录不移动中间区域。可选的 `media` 标出媒体行，它的 `thumbnail(record, state)` 返回该行缩略图的素材 ID 或 null，可选的 `fold(count)` 返回折叠在该行下面的记录的名称。`ctx.dvHistory.describe(record, { operations, records })` 返回历史为媒体行记录显示的名称（为重新生成的链读取当前状态的记录），即它的操作名称和它那一行的主体，对其他记录返回 null；对话（`@dv/ui-composer`）的媒体说明读取它，没有时用素材名称。

| 手势 | 请求或事件 |
| --- | --- |
| 打开面板、点"加载更多"翻页 | `POST /api/dv/history`；每页 50 条，下一页用 `before` |
| 选中当前状态中匹配的 `HistoryRow` 带 `focus` 的行，例如时间线记录或时间线导出的行（`@dv/ui-timeline` 的 `timeline.` 行） | 以 `focus` 返回的目标调用 `ctx.dvCenter.show`，例如 `{ view: 'timeline', target: { timeline, clip } }`；shell 显示时间线，编辑器选中该片段 |
| 选中当前状态中除 `proj` 行以外的其他行，例如渲染、角色、分镜计划或素材的行 | `ctx.dvCenter.show({ view: 'canvas', target: { record } })`；shell 显示画布，画布打开记录的节点 |
| 选中的智能体行里的"在轨迹中查看" | `dv:trajectory-focus` `{session, toolCall}`；shell 在该对话上打开 轨迹 |
| 顶部的撤销（提示 撤销（Ctrl+Z / ⌘Z）） | `POST /api/dv/undo`；被拒绝时显示服务端的消息 |
| 顶部的重做（提示 重做（Shift+Ctrl+Z / ⇧⌘Z）），当前位置是最后一步时不可用 | `POST /api/dv/redo` |
| 行 ⋮ 菜单里的 回到这一步 | `POST /api/dv/undo` `{to}` |

`dv:history-focus` 事件 `{session, toolCall}` 找到该工具调用写下的记录，翻页直到它的行已加载，然后选中它。只有在当前位置或之前的步骤会移动中间区域；变灰的步骤只被选中。只有 `@dv/ui-shell` 提供 `dvCenter` 时，选中才会移动中间区域。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`HistoryPanel` 用 `useProjectState` 读取项目的当前状态，以得到当前状态的记录和各行的缩略图，用 `useOperations` 读取操作声明，并通过 `POST /api/dv/history` 列出历史。它通过属性 `rows` 接收已注册的行，并接收必需属性 `renderFactorySlot`，即挂载它的插槽条目的组件工厂渲染函数，用来绘制缩略图和播放器；标签主体传入它的 inject `hooks` 来源中的行和自己的渲染函数。`actionRows` 把每条被启动的记录折叠到启动它的记录那一行下面，`actionLabel` 为每条记录命名，`centerFocus` 决定选中的行把中间区域移到哪里：变灰的步骤不移动，否则用匹配的已注册行的 `focus`，否则 `proj` 记录不移动，否则移到记录的画布节点。已注册的行带 `thumbnail` 的记录是媒体行。媒体行有缩略图列，选中时播放它的第一个产出，并计入启动它的那一行的折叠。每个条目的 `place` 决定 当前 标记、变灰的行，以及哪些行提供 回到这一步。在 `/dv/events` 上，`update` 事件替换已加载行中的记录，`record` 或 `line` 事件以 200 ms 防抖重新拉取已加载的窗口。

| 文件 | 内容 |
| --- | --- |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | `@dv/ui-history/contract`：`HistoryRow`、`DvHistory`、文字对 `Text` 和 `dvHistory` 服务类型 |
| [`src/client/index.ts`](src/client/index.ts) | `dvHistory` 服务、注册，以及收到 `dv:history-focus` 时打开标签 |
| [`src/client/definition.ts`](src/client/definition.ts) | 标签类型 |
| [`src/client/HistoryPanel.tsx`](src/client/HistoryPanel.tsx) | 面板、带撤销和重做按钮的顶部、带 ⋮ 菜单的行、预览和标签主体 |
| [`src/client/HistoryPanel.module.css`](src/client/HistoryPanel.module.css) | 面板的样式 |
| [`src/client/rows.ts`](src/client/rows.ts) | 操作行和被启动记录的折叠、匹配的已注册行、带主体的名称、相对时间和中间区域目标 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [历史规则](../../../docs/subsystems/video-harness.zh.md#history-rules) — 哪些修改是步骤，以及撤销、重做和 回到这一步 做什么。
- [`@dv/api`](../api/README.zh.md) — 历史路由以及撤销和重做路由。
- [`@dv/project`](../project/README.zh.md) — 历史查询、撤销和重做。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — `dvCenter` 和 `CenterTarget`，把工作区中间区域移到选中的记录。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型、窗口事件和工具名称。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 绘制缩略图和播放器的 `dv.media` 组件工厂。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；历史面板的移动改变当前状态，当前状态只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；面板不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **重新拉取整个窗口** — 每个 `record` 或 `line` 事件都重新拉取已加载的窗口（最多 200 条）；翻到很早的长历史重新加载慢。
