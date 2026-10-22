---
description: "DreamVerse 对 DSH 对话输入框的补充：项目内容的 @ 来源和引用行、带面向创作者名称和在历史中查看链接的工具行，以及 dv:compose 预填。"
kind: "package-reference"
---

# @dv/ui-composer

[English](README.md) | 中文

## 概述

使用本包让 DSH 对话输入框适配 DreamVerse 项目。输入 `@`，或在输入框的 ＋ 菜单里选 引用，会把插件 UI 半边在 `dvMentions` 中注册的提及类型的条目（`@dv/ui-timeline` 的片段，以及 `@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style` 的角色、场景和风格）和所打开项目的素材列为引用标签。对话里的 DreamVerse 工具行显示面向创作者的名称，在历史中查看 链接选中调用的记录。画布和素材预览通过 `dv:compose` 预填输入框。智能体在对话里征求用户同意。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供对话、输入触发器、UI 插槽和右侧栏）、`@dv/api`（提供状态和操作路由）和 `@dv/chat-references`（展开已发送消息里的 `dv:` 提及）的 profile 里挂载插件。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-composer
  name: '@dv/ui-composer'
```

Host 半边不注册任何东西。浏览器半边在 `apply` 顶层提供 `dvMentions`：`kinds`，一个以 `id` 为键的 `@dv/ui-kit/registries.ts` 的 `Registry<MentionKind>`，插件 UI 半边在 `ctx.inject(['dvMentions'], …)` 中填充它。它注册 `@` 来源 `dv-project`；DSH 的 `commandUi` 服务挂载时，通过它注册 ＋ 菜单行 引用，其说明为 项目里的条目或素材，不点名任何引用类型；以及 UI 插槽条目 `conversation.input.left`（ID 为 `dv-composer-compose`，不渲染任何内容，让每个已挂载的会话输入框成为 `dv:compose` 的目标）、`conversation.input.permission`（一个空条目）、`conversation.chat.markdown`（一个 chain 条目，按 `/dv/assets/<id>` 路径匹配链接、图片和表格），并为 `DV_TOOL_LABELS` 里的每个工具注册一个优先级为 0.5 的 `tool.call.toolview` 条目 `ToolLabelRow`，所以插件自己的默认优先级 0 的条目会盖过它。它注册 `dv.media.preview.action` 插槽的条目 `dv.composer.use-asset`，即 `@dv/ui-media` 的 `dvMedia.preview` 打开的素材预览里 关闭 / Close 旁边的按钮 让智能体使用 / Ask the agent to use it。它还为 `GET /api/dv/operations` 的每个操作注册一个优先级为 1 的 `ToolLabelRow`，以它的工具名为键，所以优先级更低的条目会盖过它（`dv_shot_render` 由 `@dv/ui-shot-render` 的渲染卡片盖过）；插槽声明时它读一次这个列表，每次打开项目时再读一次，列表变化时它移除这些行，再注册读到的列表的行。它为每个有名称的工具和每个操作在 DSH 的 `chat` 字典里加一条 `tool.name.<tool>`，运行中分组的标题读取它。

| 手势 | 请求或事件 |
| --- | --- |
| 输入 `@`，或在 ＋ 菜单里选 引用 | 对所打开项目的当前状态调用 `GET /api/dv/state`；入口页不列出任何内容 |
| 在历史中查看 | `dv:history-focus` `{session, toolCall}`；历史面板选中该工具调用写下的记录 |
| 发送带 `dv:asset/<id>` 标签或附加图片的消息 | 消息原样发出；Host 上的 `@dv/chat-references` 导入这些图片，并把它们和被提及的素材放到画布上 |
| 素材预览里的 让智能体使用 | `dv:compose`，草稿为 使用这个素材：，带一个指向该素材的引用；预览关闭 |
| 来自其他视图的 `dv:compose` | 最新挂载的输入框用其文字替换草稿，并为每个引用追加一个标签；不发送任何内容 |

`@` 列表读项目的当前状态：每个已注册的提及类型的条目，按其 `order` 排列（相同时按注册顺序），归在其 `section()` 之下，条目的 `thumb` 素材显示为该素材的图标，以及所有媒体类型中最新的 40 个素材；素材的图标是 `@dv/ui-media` 的 `dvMedia.types` 中其媒体类型的 `poster` 给出的静帧，没有时是该类型的 `icon` 组件，再没有时是文件字形；选中一项会插入一个标签，其文字为 `@[<label>](dv:<kind>/<id>)`。引用 行在草稿末尾打开同一个列表。每个有名称的工具行和每个操作行显示工具名称（操作行显示 `@dv/ui-kit` 的 `operationLabel`）和状态 进行中…、完成 或 未完成。调用写了记录的每个已结束的行都有 在历史中查看 链接。`dv:compose` 事件还会把 对话 标签提到前面。本包隐藏 DSH 的文件权限标签，并用 DreamVerse 主题变量绘制 对话 标签里的输入框卡片、＋ 按钮和发送按钮。

在已结束的对话 Markdown 里，路径为 `/dv/assets/<id>` 且所打开项目持有该素材的链接变成一张 160 px 宽的 16:9 卡片，通过 `@dv/ui-media` 的 `dv.media` 组件工厂以用途 `thumb` 绘制该素材，下方是说明文字：镜头 N，N 是输出包含该素材的生成记录（非确定性、有图片、视频或音频输出的记录）的链中位置（`@dv/ui-kit` 的 `chainOf`：记录 `started_by` 中的位置，没有时用它 `based_on` 根记录的）；没有时为素材名称。每个表体行都链接这类素材的表格变成三列卡片网格，每张卡片的说明是该行其他单元格用 ` · ` 连接的文字（例如 `1 · 直播间开场「来一把吧」`）。这类素材的 Markdown 图片变成最宽 240 px 的缩略图；素材有尺寸时使用素材自身的宽度和宽高比，否则为 240 px 宽的 16:9。点击卡片或缩略图会通过 `dvMedia.preview` 打开从被点击元素放大出来的素材预览；`dvMedia` 不存在时什么也不打开。媒体类型没有 `dv.media.view` 条目的素材画成 `@dv/ui-media` 的文件卡片。素材和镜头号来自所打开项目的当前状态，每次项目事件后重新获取。其他链接、图片和表格保持 DSH 的渲染。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

没有输入框挂载时到达的 `dv:compose` 事件会等到下一个挂载的输入框；输入框拒绝的标签退回为其纯文本引用。工具行从调用结果的展示元数据得知调用是否写了记录：操作工具和写记录的 `dv_proj_*` 工具在 `record` 中写明所写的记录，只读操作（如 `inspect.image`）写 `record: ''`，只读的 `dv_proj_*` 工具（`dv_proj_open`、`dv_proj_state`、`dv_proj_history_list`、`dv_proj_wait`）和失败的调用没有元数据。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 半边，不注册任何东西 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | `dvMentions` 和注册：`@` 来源、＋ 菜单行、UI 插槽条目、工具名称和 `dv:compose` 监听 |
| [`src/client/mention.ts`](src/client/mention.ts) | `@` 来源、其项目内容和引用文字 |
| [`src/client/chat-assets.ts`](src/client/chat-assets.ts) | 所打开项目的素材，以及每个版本输出的镜头号，每次项目事件后重新获取 |
| [`src/client/chat-media.ts`](src/client/chat-media.ts) | `conversation.chat.markdown` 条目，以及它对链接、图片和表格的选择 |
| [`src/client/ChatMedia.tsx`](src/client/ChatMedia.tsx) | 通过 `dv.media` 绘制的素材卡片、卡片网格和图片缩略图 |
| [`src/client/actions.tsx`](src/client/actions.tsx) | 素材预览里的 让智能体使用 |
| [`src/client/compose.ts`](src/client/compose.ts) | 把 `dv:compose` 交给最新挂载的输入框 |
| [`src/client/views.tsx`](src/client/views.tsx) | 工具行 |
| [`src/client/views.module.css`](src/client/views.module.css) | 工具行、其历史链接和 让智能体使用 按钮的样式 |
| [`src/client/composer.css`](src/client/composer.css) | 对话 标签里输入框卡片、＋ 按钮和发送按钮的样式 |
| [`src/client/tool-labels.ts`](src/client/tool-labels.ts) | 操作工具的行，以及加到 DSH `chat` 字典里的工具名称 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/chat-references`](../chat-references/README.zh.md) — 把已发送消息里的 `dv:` 提及展开成一条带记录和素材 ID 的上下文消息。
- [`@dv/project`](../project/README.zh.md) — `dv:project` 提示词段落，它让智能体在对话里征求用户同意，并把问题加粗。
- [`@dv/ui-history`](../ui-history/README.zh.md) — 响应 `dv:history-focus` 的历史面板。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型、compose 事件和工具名称。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 绘制对话卡片的 `dv.media` 组件工厂、绘制 `@` 菜单图标的媒体类型，以及素材预览。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/chat-references`：它把已发送消息里的 `dv:` 提及变成一条 `dv-mentions` 上下文消息。

#### KV Cache 影响

本包本身无影响；`dv-mentions` 上下文消息跟在它所展开的用户消息之后，其影响见 `@dv/chat-references` 的 README。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **`@` 列表读当前状态** — `@` 列表和 引用 行读项目的当前状态，所以被撤销移出状态的片段、角色、场景或风格不会列出；素材仍会列出，因为状态列出了历史中的每个素材。
- **卡片等待项目状态** — 所打开项目的状态加载完成前，以及当前状态未列出的素材（当前位置之后的步骤渲染的镜头），其链接和图片保持 DSH 的渲染。
