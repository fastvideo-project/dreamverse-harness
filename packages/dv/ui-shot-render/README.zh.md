---
description: "DreamVerse 镜头渲染的浏览器半边：画布上 shot.render 的镜头节点及其卡片、编辑器和重试动作，一次 dv_shot_render 调用在对话里的卡片，以及 shot.render 记录的历史行，用 defineGenerationUi 声明，还有节点编辑器输入框中 shot.render 的参数栏。"
kind: "package-reference"
---

# @dv/ui-shot-render

[English](README.md) | 中文

## 概述

使用本包在 DreamVerse 画布和历史面板中显示镜头渲染操作 `shot.render` 的镜头，并把它的智能体工具 `dv_shot_render` 的调用显示为对话卡片。本包是 [`@dv/ui-generation`](../ui-generation/README.zh.md) 的一个 `defineGenerationUi` 声明加一个参数栏：套件提供镜头卡片和编辑器、重试 / Retry 动作、对话卡片和历史行；声明提供标签 镜头 / Shot、状态文字，以及版本的预览静帧；参数栏提供编辑器的标签和文字。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供对话和 UI 插槽）、`@dv/api`（提供 `GET /api/dv/operations` 和 `GET /api/dv/tasks`）以及拥有本包所填界面的 UI 核心的 profile 里挂载插件：`@dv/ui-canvas`（`dvCanvas` 注册表和 `dv.canvas.card`、`dv.canvas.editor` 插槽）、`@dv/ui-history`（`dvHistory`）、`@dv/ui-media`（绘制每个素材的 `dv.media` 组件工厂）和 `@dv/ui-composer`（`dvComposer` 和节点编辑器绘制的 `dv.prompt` 输入框）。每项注册都通过 `ctx.inject` 等待它的服务，所以缺少其中某个包的 profile 只少了那一个界面。先用 `pnpm run build` 构建浏览器 bundle（写出 `lib/client.js`）。

```yaml
- id: dv-ui-shot-render
  name: '@dv/ui-shot-render'
```

Host 半边不注册任何东西。浏览器半边注册下列条目，全部通过 `defineGenerationUi` 注册。镜头节点是 [`@dv/canvas`](../canvas/README.zh.md) 节点列表中 kind 为 `shot` 的节点，由 `@dv/shot-render` 从 `shot.render` 记录产生；每个版本是一条 `shot.render` 记录，它的产出是视频和视频的最后一帧静帧（`video`、`last_still`）。

| 注册 | 值 |
| --- | --- |
| `dvCanvas.nodeTypes` | 节点类型 `shot`（键为 `shot`，即 `@dv/shot-render` 注册的 kind），标签 镜头 / Shot，颜色 `var(--dv-node-3)`。最新版本运行时节点显示 渲染中… / Rendering…；最新版本失败的节点显示 生成失败 / Render failed |
| `dvCanvas.actions` | `@dv/ui-shot-render:shot:retry`，最新版本失败的节点上的 重试 / Retry：用该版本的输入和参数重新运行它的操作，`based_on` 设为该版本，所以新版本加入该节点 |
| `dv.canvas.card` 键 `shot` | 最新版本的最后一帧静帧（它的图片产出），没有时用它的第一个产出，经 `dv.media` 以用途 `card` 画在 16:9 的画框里 |
| `dv.canvas.editor` 键 `shot` | `@dv/ui-generation` 的节点编辑器，显示编辑器版本条选中的版本：经 `dv.media` 以用途 `loop` 播放的视频（静帧作封面）、模型和生成任务，以及该版本调用上 `@dv/ui-composer` 的 `dv.prompt` 输入框，带本包的参数栏 |
| `dvComposer.paramBars` 键 `shot.render` | `src/client/param-bar.ts` 的 `shotRenderBar`，即声明的 `bar`，套件在 `@dv/ui-composer` 已加载时注册它。在所选视频模型的 `schema()` 下，它的标签是基于 `aspect_ratios` 的 画幅 / Aspect ratio、基于 `resolutions` 的 清晰度 / Resolution，以及基于 `duration_sec.values` 中的精确时长选项（未列出时使用从 `min` 到 `max` 的整秒数）的 时长 / Duration，分别写入 `aspect_ratio`、`resolution` 和 `duration_sec`。它的 `@` 过滤条件取 schema 中 `reference` 输入的媒体类型（列出的或作为键的）和它的 `max`。目录不知道的 schema 不给出标签，也不给出过滤条件，所以节点编辑器显示已声明参数的标签，并提供所有媒体类型。它的文字是 描述画面，输入 @ 引用素材 / Describe the shot; type @ to cite an item、渲染新版本 / Render new version，以及该类型的进行中文字 渲染中… / Rendering… |
| `tool.call.toolview` 键 `dv_shot_render` | 对话卡片，使用默认优先级 0。`@dv/ui-composer` 以优先级 1 为每个操作工具注册一行，以优先级 0.5 为 `DV_TOOL_LABELS` 里的每个工具注册一行，所以卡片取代这些行显示 |
| `dvHistory.rows` 匹配 `shot.render` | 历史行：没有主题文字，缩略图是该记录的最后一帧静帧，没有时用它的第一个产出 |

| 对话卡片部分 | 值 |
| --- | --- |
| 标题 | `@dv/ui-kit` 的 `operationLabel('shot.render', …)`：操作在 `GET /api/dv/operations` 里的标签（渲染镜头 / Render shot），没有时用 `shot.render` |
| 模型行（`data-testid="dv-composer-render-model"`） | 调用的 `model`，和按 `GET /api/dv/tasks` 里的标签显示的 `task`（没有标签时显示任务名），用 ` · ` 连接（例如任务 `ref2v` 显示 `fasth3 · 参考图生成` / `fasth3 · From references`） |
| 提示词 | 调用的 `prompt` |
| 状态 | 调用结束前为 渲染中… / Rendering…，之后为 已渲染 / Rendered；失败的调用为 生成失败 / Render failed |
| 媒体 | 结果展示元数据里的第一个产出，即视频，经 `dv.media` 以用途 `loop` 绘制：静音、循环、带控件，以图片产出为封面 |
| 在历史中查看 / Show in history（`data-testid="dv-composer-open-history"`） | 出现在已结束的调用上；派发 `dv:history-focus` `{session, toolCall}`，历史面板选中这次调用写出的记录 |

参数还在流式到达时，卡片显示已有的部分。两个列表加载完成前，或读取失败时，标题按上表回退，模型行显示任务名。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/client/index.ts` 导出一次 `defineGenerationUi` 调用的 `inject` 和 `apply`，该调用的 `bar` 就是参数栏。文本模型（例如任务 `t2v` 的 `fasth3`）的 schema 没有 `reference` 输入，所以参数栏的过滤条件不写出任何媒体类型，节点编辑器不提供参考。声明的 `preview` 选出图片产出，套件把它用作卡片的媒体、编辑器和对话卡片的封面，以及历史缩略图。套件在对话卡片或节点编辑器第一次订阅时读取 `GET /api/dv/operations` 和 `GET /api/dv/tasks`，读取失败后在下一次订阅时再读取（`@dv/ui-kit` 的 `loadedOnce`）；解析后的参数、产出和历史链接来自 `@dv/ui-kit/tool-rows.tsx`。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 不做任何事的 Host Loader 入口 |
| [`src/client/index.ts`](src/client/index.ts) | `shot` 节点的 `defineGenerationUi` 声明，含参数栏 |
| [`src/client/param-bar.ts`](src/client/param-bar.ts) | `shot.render` 的参数栏 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/shot-render`](../shot-render/README.zh.md)：`shot.render` 操作和它的智能体工具。
- [`@dv/ui-generation`](../ui-generation/README.zh.md)：`defineGenerationUi`、节点卡片和编辑器，以及对话卡片。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md)：`shot` 节点类型所填的画布节点契约。
- [`@dv/ui-composer`](../ui-composer/README.zh.md)：对话里的工具行和工具名，以及绘制参数栏的 `dv.prompt` 输入框。

-----

<a id="model-experience"></a>
## 模型体验

无，作为浏览器端的画布节点和工具卡片；它显示 `dv_shot_render` 的调用和结果，它的 重试 / Retry 和 渲染新版本 / Render new version 以用户的画布写入写出 `shot.render` 记录，这些记录只通过 [`@dv/project`](../project/README.zh.md) 到达模型。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **输入框的测试 ID** — 对话卡片的模型行保留来自 `@dv/ui-composer` 的测试 ID `dv-composer-render-model`；历史链接是 `@dv/ui-kit` 共用的 `HistoryLink`，e2e 故事 `history.e2e.ts` 在工具行上按它的测试 ID `dv-composer-open-history` 选取。
