---
description: "DreamVerse 对 DSH 对话输入框的补充：项目内容的 @ 来源和引用行、单个生成调用的 dv.prompt 输入框及其参数栏注册表、带面向创作者名称和在历史中查看链接的工具行，以及 dv:compose 预填。"
kind: "package-reference"
---

# @dv/ui-composer

[English](README.md) | 中文

## 概述

使用本包让 DSH 对话输入框适配 DreamVerse 项目。输入 `@`，或在输入框的 ＋ 菜单里选 引用，会把插件在 `dvMentions` 中注册的提及类型的条目和所打开项目的素材列为引用标签。`dv.prompt` 组件工厂绘制一个生成调用的输入框：参考、提示词、参数、成本和发送。对话里的 DreamVerse 工具行显示面向创作者的名称，在历史中查看 链接选中调用的记录。画布和素材预览通过 `dv:compose` 预填对话输入框。智能体在对话里征求用户同意。

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

Host 半边不注册任何东西。浏览器半边在 `apply` 顶层提供 `dvMentions`：`kinds`，一个以 `id` 为键的 `@dv/ui-kit/registries.ts` 的 `Registry<MentionKind>`，插件 UI 半边在 `ctx.inject(['dvMentions'], …)` 中填充它。它注册 `@` 来源 `dv-project`；DSH 的 `commandUi` 服务挂载时，通过它注册 ＋ 菜单行 引用，其说明为 项目里的条目或素材，不点名任何引用类型；以及 UI 插槽条目 `conversation.input.left`（ID 为 `dv-composer-compose`，不渲染任何内容，让每个已挂载的会话输入框成为 `dv:compose` 的目标）、`conversation.input.permission`（一个空条目）、`conversation.chat.markdown`（一个 chain 条目，按 `/dv/assets/<id>` 路径匹配链接、图片和表格），并为 `DV_TOOL_LABELS` 里的每个工具注册一个优先级为 0.5 的 `tool.call.toolview` 条目 `ToolLabelRow`，所以插件自己的默认优先级 0 的条目会盖过它。只要 `@dv/ui-canvas` 的画布服务 `dvCanvas` 存在，它就在 `@dv/ui-canvas/contract` 的 `dvCanvas.actions` 注册节点动作 `@dv/ui-composer:ask-agent`（问 agent / Ask the agent，order 为 10，在每个节点上显示）。它注册 `dv.media.preview.action` 插槽的条目 `@dv/ui-composer:use-asset`，即 `@dv/ui-media` 的 `dvMedia.preview` 打开的素材预览里 关闭 / Close 旁边的按钮 让智能体使用 / Ask the agent to use it。它还为 `GET /api/dv/operations` 的每个操作注册一个优先级为 1 的 `ToolLabelRow`，以它的工具名为键，所以优先级更低的条目会盖过它（`dv_shot_render` 由 `@dv/ui-shot-render` 的对话卡片盖过）；插槽声明时它读一次这个列表，每次打开项目时再读一次，列表变化时它移除这些行，再注册读到的列表的行。它为每个有名称的工具和每个操作在 DSH 的 `chat` 字典里加一条 `tool.name.<tool>`，运行中分组的标题读取它。

| 手势 | 请求或事件 |
| --- | --- |
| 输入 `@`，或在 ＋ 菜单里选 引用 | 对所打开项目的当前状态调用 `GET /api/dv/state`；入口页不列出任何内容 |
| 在历史中查看 | `dv:history-focus` `{session, toolCall}`；历史面板选中该工具调用写下的记录 |
| 发送带 `dv:asset/<id>` 标签或附加图片的消息 | 消息原样发出；Host 上的 `@dv/chat-references` 导入这些图片，并把它们和被提及的素材放到画布上 |
| 画布节点上的 问 agent | `dv:compose`，草稿为 修改 {title}：，带一个引用，指向节点的 `ref`，否则指向其记录，否则指向节点本身，以节点的预览或第一个素材显示；编辑器关闭 |
| 素材预览里的 让智能体使用 | `dv:compose`，草稿为 使用这个素材：，带一个指向该素材的引用；预览关闭 |
| 来自其他视图的 `dv:compose` | 最新挂载的输入框用其文字替换草稿，并为每个引用追加一个标签；不发送任何内容 |
| 打开一个 `dv.prompt` 实例 | `GET /api/dv/models` 和 `GET /api/dv/operations`，在第一次订阅时请求，读取失败后在下一次订阅时再请求；该实例所属项目的 `GET /api/dv/state`，在它的每一阵项目事件后 150 ms 重新获取 |
| 在可编辑的 `dv.prompt` 实例里编辑调用 | 最后一次编辑后 250 ms，带改过的调用和 `surface: 'canvas'` 请求 `POST /api/dv/operation/check`；该路由不写任何内容 |

`@` 列表读项目的当前状态：每个已注册的提及类型的条目，按其 `order` 排列（相同时按注册顺序），归在其 `section()` 之下，条目的 `thumb` 素材显示为该素材的图标，以及所有媒体类型中最新的 40 个素材；素材的图标是 `@dv/ui-media` 的 `dvMedia.types` 中其媒体类型的 `poster` 给出的静帧，没有时是该类型的 `icon` 组件，再没有时是文件字形；选中一项会插入一个标签，其文字为 `@[<label>](dv:<kind>/<id>)`。引用 行在草稿末尾打开同一个列表。每个有名称的工具行和每个操作行显示工具名称（操作行显示 `@dv/ui-kit` 的 `operationLabel`）和状态 进行中…、完成 或 未完成。调用写了记录的每个已结束的行都有 在历史中查看 链接。`dv:compose` 事件还会把 对话 标签提到前面。本包隐藏 DSH 的文件权限标签，并用 DreamVerse 主题变量绘制 对话 标签里的输入框卡片、＋ 按钮和发送按钮。

在已结束的对话 Markdown 里，路径为 `/dv/assets/<id>` 且所打开项目持有该素材的链接变成一张 160 px 宽的 16:9 卡片，通过 `@dv/ui-media` 的 `dv.media` 组件工厂以用途 `thumb` 绘制该素材，下方是说明文字：历史把创建该素材的记录画成媒体（例如版本）时，为 `@dv/ui-history` 的 `dvHistory.describe` 给该记录的名称，否则为素材名称，例如导入文件的文件名。说明跟随 `dvHistory` 及其行，所以已绘制的卡片在一条历史行注册时会重新读取说明。每个表体行都链接这类素材的表格变成三列卡片网格，每张卡片的说明是该行其他单元格用 ` · ` 连接的文字（例如 `1 · 直播间开场「来一把吧」`）。这类素材的 Markdown 图片变成最宽 240 px 的缩略图；素材有尺寸时使用素材自身的宽度和宽高比，否则为 240 px 宽的 16:9。点击卡片或缩略图会通过 `dvMedia.preview` 打开从被点击元素放大出来的素材预览；`dvMedia` 不存在时什么也不打开。媒体类型没有 `dv.media.view` 条目的素材画成 `@dv/ui-media` 的文件卡片。素材和创建它们的记录来自所打开项目的当前状态，每次项目事件后重新获取。其他链接、图片和表格保持 DSH 的渲染。

### `dv.prompt` 输入框

浏览器半边还提供 `dvComposer`，它的类型在只含类型的入口 `@dv/ui-composer/contract`（[`src/client/contract/index.ts`](src/client/contract/index.ts)）中：`paramBars`，一个以 `operation` 为键的 `Registry<ParamBar>`，拥有某个操作的插件的 UI 半边在 `ctx.inject(['dvComposer'], …)` 中填充它，`@dv/ui-shot-render` 就为 `shot.render` 这样做。同一个操作的第二个参数栏会抛错，并给出持有者的 `owner`。`ParamBar` 提供 `chips({schema, params, operation})`，即调用在某个模型的 `schema()` 下的参数标签，每个标签有参数键、名称、显示的值，以及以参数补丁表示的选项；`candidates(schema)`，即该模型的 `@` 过滤条件，含它的 `reference` 输入的媒体类型和数量 `maxReferences`；以及可选的 `copy`，含 `placeholder`、`send` 和 `sending` 文字。

浏览器半边注册根作用域组件工厂 `dv.prompt`，即单个生成调用的输入框；插件用一个空的 `import type {} from '@dv/ui-composer/contract'` 获得它，并用 `renderFactorySlot('dv.prompt', props)` 绘制它。它的属性是 `projectId`、`call`（一个 `PromptCall`：`operation`，`params`，其中 `prompt` 是带引用的提示词，以及 `{role, ref}` 形式的请求输入 `inputs`）、`readOnly`、`host` 和可选的 `onSubmit(call)`，后者接收改过的调用，并决定发送做什么。宿主是一个 `PromptHost`：可选的 `pickAssets(chosen, done)` 打开宿主的素材选择窗口，`preview(asset, opener)` 打开素材的预览，`openNode(nodeId)` 打开画布节点的编辑器。宿主传入另一个 `call` 时，该实例在这个调用上重新开始。[`@dv/ui-generation`](../ui-generation/README.zh.md) 的版本编辑器在版本的调用上绘制它，[`@dv/ui-shot-plan`](../ui-shot-plan/README.zh.md) 的分镜计划编辑器在每个镜头的调用上以只读方式绘制它。

输入框从上到下绘制以下部分：

- 参考栏，每个调用输入一个参考项：通过 `dv.media` 以用途 `thumb` 绘制的预览、名称、它发送的版本（例如 `v2`）、没有标签引用该输入时的 未引用 / uncited、有更新版本时的 用 vN / Use vN，以及移除该输入的 ×。所选模型不接受其媒体类型的参考项变暗，点击参考项打开条目的节点或素材的预览。宿主提供 `pickAssets` 时，添加素材 / Add asset 带着已持有的引用打开它，并把每个新选中的引用追加为一个 `reference` 输入。
- DSH 的 `conversation.prompt` 编辑器，它用标签外观绘制每个标签。
- 参数栏：模型标签，即调用的 `modality` 下 `GET /api/dv/models` 条目的菜单，选中后写入 `modality`、`task`、`provider` 和 `model`；然后是该操作已注册的参数栏在所选模型 schema 下的标签，没有时为操作声明的每个参数（`prompt`、`extra` 和上述四个除外）各一个标签，有选项的参数是菜单，否则是文本框；然后是成本 约 N GPU 秒 / ≈ N GPU s 和发送按钮。

最后一次编辑后 250 ms，输入框把改过的调用发给 `POST /api/dv/operation/check`。成本是回答中的 `gpu_seconds`，回答的问题句子显示在参数栏下方，在某次检查回答没有问题之前，发送保持禁用。发送把改过的调用交给 `onSubmit`。占位文字、发送文字和发送进行中的文字来自参数栏的 `copy`；没有时它们是中性的：描述要生成的内容 / Describe what to generate、生成新版本 / Generate a new version 和 生成中… / Generating…。只有操作声明了 `reference` 输入，并且参数栏为所选模型给出的过滤条件至少写出一种媒体类型时，参考栏的 添加素材 / Add asset 和编辑器的 `@` 才提供引用；没有参数栏或模型目录里没有该模型的条目时，没有过滤条件。只读模式下，输入框只显示参考栏（没有添加、固定版本和 ×）和只读的编辑器；它不绘制参数栏，不发送，也不检查。项目状态加载完成前，编辑器保持只读。

标签引用一个素材（`dv:asset/<id>`）或一个元素，例如角色（`dv:<kind>/<id>`）。`reference` 输入代表某个素材时满足该素材的标签，是某个元素的版本 `<id>@<n>` 时满足该元素的标签。输入框让输入与标签保持一致：没有输入满足的新标签追加它需要的输入，即该素材或该元素的最新版本（R1）；移除一个参考项会把只由该输入满足的每个标签变成它的名称，作为编辑器的一步撤销（R2）；删除某个输入的最后一个标签会移除该输入，除非另一个输入也满足被删除的标签，没有标签引用过的输入保留（R3′）；没有输入满足的标签以失败样式绘制（R4）。用 vN / Use vN 把输入改写为该版本，该元素的每个标签都跟着改变。编辑器的历史是唯一的撤销：撤销带回被删除的标签时，也把该编辑移除的输入带回原来的位置；不改变提示词的参考栏编辑，例如从选择窗口添加或固定版本，不在这个历史中。[`src/client/DvPrompt.tsx`](src/client/DvPrompt.tsx) 和 [`src/client/reference-model.ts`](src/client/reference-model.ts) 的模块注释拥有这些规则。

标签外观是键为 `dv-project` 的 `conversation.prompt.reference` 条目和 `conversation.input.reference` 条目，所以它在每个提示词编辑器里和聊天输入框里绘制 `dv-project` 来源的每个标签：通过 `dv.media` 以用途 `thumb` 绘制的预览、名称，以及在 `dv.prompt` 实例中调用发送的版本，都从实时的项目状态读取。没有调用上下文的标签读取所打开的项目，并绘制其元素的最新版本。在 `dv.prompt` 实例中点击标签会打开条目的节点或素材的预览。`@` 来源 `dv-project` 还为会话之外的实例提供 `prompt` 面，它列出同样的条目，并去掉素材的媒体类型不被该实例的模型接受的条目。

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
| [`src/client/mention.ts`](src/client/mention.ts) | 带 `prompt` 面的 `@` 来源、其项目内容和引用文字 |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | 只含类型的入口 `@dv/ui-composer/contract`：调用、宿主、参数栏、`dvComposer` 和 `dv.prompt` 组件工厂 |
| [`src/client/prompt.ts`](src/client/prompt.ts) | `dvComposer`、`dv.prompt` 和标签外观的注册及其注入，以及每个项目的实时状态 |
| [`src/client/DvPrompt.tsx`](src/client/DvPrompt.tsx) | 输入框：参考栏、编辑器、参数栏、检查和发送 |
| [`src/client/reference-model.ts`](src/client/reference-model.ts) | 调用的文档、满足引用的输入、编辑 R1 到 R3′ 和版本固定，以及标签和参考项的视图 |
| [`src/client/ReferenceFace.tsx`](src/client/ReferenceFace.tsx) | 标签外观 |
| [`src/client/chat-assets.ts`](src/client/chat-assets.ts) | 所打开项目的素材、创建每个素材的记录和操作声明，每次项目事件后重新获取 |
| [`src/client/chat-media.ts`](src/client/chat-media.ts) | `conversation.chat.markdown` 条目，以及它对链接、图片和表格的选择 |
| [`src/client/ChatMedia.tsx`](src/client/ChatMedia.tsx) | 通过 `dv.media` 绘制的素材卡片、卡片网格和图片缩略图 |
| [`src/client/actions.tsx`](src/client/actions.tsx) | 画布节点上的 问 agent 和素材预览里的 让智能体使用 |
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
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) — 画布及其节点动作。
- [`@dv/ui-generation`](../ui-generation/README.zh.md) — 版本编辑器，它在版本的调用上绘制 `dv.prompt`。
- [`@dv/ui-history`](../ui-history/README.zh.md) — 响应 `dv:history-focus` 的历史面板，以及对话卡片的记录名称。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型、compose 事件和工具名称。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 绘制对话卡片的 `dv.media` 组件工厂、绘制 `@` 菜单图标的媒体类型，以及素材预览。
- [`@dv/ui-shot-render`](../ui-shot-render/README.zh.md) — `shot.render` 的参数栏。

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
