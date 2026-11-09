---
description: "DreamVerse Blender 组件的浏览器端：右侧栏的 Blender 标签页，说明如何用 DreamVerse 插件连接用户的 Blender，连接后实时显示它的视口；把 blender.render 和 blender.animation_render 的记录作为画布上的版本；以及画布上的 Blender 视口节点，打开它的编辑器可以旋转、平移和缩放 Blender 的视图。"
kind: "package-reference"
---

# @fastvideo/dreamverse-ui-blender

[English](README.md) | 中文

## 概要

使用本包在 DreamVerse 中显示用户的 Blender。它注册右侧栏的 `dv-blender` 标签页类型。没有连接 Blender 时，标签页显示三个连接步骤：下载插件、安装插件、粘贴连接串。连接后，标签页实时显示它的视口，带有与视口节点编辑器相同的视口控件，以及 Blender 的版本和文件。它还画出类型为 `blender` 的画布节点，即 `blender.render` 和 `blender.animation_render` 的版本，以及类型为 `blender-viewport` 的 Blender 视口节点；这两种类型由桥接端注册到画布节点列表。它读取的路由属于 [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `@fastvideo/dreamverse-blender-bridge` 一起挂载本插件；[`@fastvideo/dreamverse-blender`](../blender/README.zh.md) 会插入这两个插件。

```yaml
- id: dv-ui-blender
  name: '@fastvideo/dreamverse-ui-blender'
```

插件没有配置。右侧栏的引导以 Blender、"连接 Blender，查看它的实时视口" 提供该标签页。连接串是页面自己的源地址、`#` 和配对码；经由 SSH 隧道时，页面的源地址就是隧道的本地地址，同一台电脑上的 Blender 可以连到这里。标签页的按钮可以复制连接串，也可以更换配对码，更换会断开已连接的 Blender。已连接 Blender 且打开了项目时，标签页的"把视口放到画布上"按钮为打开的项目运行 `blender.viewport`；被拒绝时在按钮下方显示原因。

视口节点是一个类型为 `blender-viewport` 的 16:9 媒体节点；画布上最多有一个。它的卡片以留边方式显示实时视口，不处理指针输入，所以画布像对待其他节点一样移动、选择、缩放和打开它。双击打开它的编辑器，编辑器放大显示视口。编辑器和 Blender 标签页共用一套视口控件（`controls.tsx`），用来移动 Blender 的视图：

| 输入 | 视图变化 |
| --- | --- |
| 拖动 | `orbit` |
| Shift 拖动或右键拖动 | `pan` |
| 滚轮 | `zoom`，每滚一行一步 |
| 前、后、左、右、顶、底、相机 | `preset` |
| 显示全部、显示所选 | `frame` |

画布自己的移除按钮和 Delete 键把节点从画布上拿下（`canvas.node_remove`）。视图变化需要插件 0.2.0 或更高版本；插件较旧或没有连接 Blender 时，控件不可用，滚轮滚动页面，视口下方的一行文字会说明原因。标准视图是一个与 画布 | 时间线 切换相同样式的分段控件，按钮沿用画布编辑器的样式：描边按钮，或每种状态的主要操作用强调色填充，全部基于 `--dv-*` 主题变量。

-----

<a id="understand-the-implementation"></a>
## 理解实现

标签页正文挂载期间读取一次 `GET /api/dv/blender/status`，并监听视口 WebSocket `/dv/blender/view`。页面上所有挂载的标签页共用一个套接字，断开两秒后重新打开；长时间打开的 HTTP 流会占用浏览器到 harness 为数不多的 HTTP/1.1 连接，使页面的其他请求停滞。标签页只在显示在屏幕上且页面可见时监听。`status` 消息在两种视图之间切换，每一帧用 `createImageBitmap` 解码后画到画布上；一帧正在绘制时，只有期间到达的最新一帧会等待，所以画面不会堆积成图片加载请求。插件下载通过 `fetch` 进行，下载失败时显示其 HTTP 状态。连接步骤和视口不依赖打开的项目，因为一个 Blender 服务整个 harness；只有放置按钮读取打开的项目。标签页、卡片和编辑器各自通过 `useLiveView` 在同一个套接字上监听，并画在自己的画布上。桥接端只在套接字打开和连接变化时发送 `status`，Blender 也只在视图重绘时发送画面，所以加入已打开套接字的视图（例如从卡片打开的编辑器）会立即收到上一次的状态和最新一帧。编辑器收集拖动和滚轮的移动量，每个动画帧最多通过同一个套接字发送一次，以所显示画面的比例表示，每个数限制在 ±10 以内；滚轮监听器是原生的非被动监听器，所以页面不会滚动。版本来自 [`@dv/ui-generation`](../ui-generation/README.zh.md) 的一个 `defineGenerationUi` 声明，节点类型为 `blender`。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | 标签页类型、标签页正文注册、版本，以及视口节点类型及其卡片和编辑器 |
| [`src/client/BlenderPanel.tsx`](src/client/BlenderPanel.tsx) | 面板和它的放置按钮 |
| [`src/client/controls.tsx`](src/client/controls.tsx) | 标签页和编辑器的视口控件、实时画面，以及共用的按钮样式类 |
| [`src/client/controls.module.css`](src/client/controls.module.css) | 控件和按钮的样式 |
| [`src/client/viewer.ts`](src/client/viewer.ts) | `fetch` 调用、`blender.viewport` 的运行、页面共用的视口套接字和视图变化 |
| [`src/client/live-view.ts`](src/client/live-view.ts) | `useLiveView`：在屏幕上时监听，并画出最新一帧 |
| [`src/client/ViewportNode.tsx`](src/client/ViewportNode.tsx) | 视口节点类型、它的卡片和编辑器 |
| [`src/index.ts`](src/index.ts) | 不做任何事的宿主 Loader 入口 |
| [`tests/plugin.client.spec.tsx`](tests/plugin.client.spec.tsx) | 在真实插槽运行时下的注册及其移除，面板在假宿主端上的两种视图和放置按钮，以及视口节点的类型、卡片和编辑器 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md)：连接、路由和插件。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md)：绘制 Blender 版本和视口节点的画布。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；视口画面只给人看，版本和节点显示的 `blender.render`、`blender.animation_render` 和 `blender.viewport` 记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有打开的节点移动视图**：标签页和画布卡片只显示画面，编辑器移动视图，但不向 Blender 发送点击、选择或编辑。
- **每次移动都要等 Blender**：画面在一次到 Blender 的往返和一帧之后才变化，所以拖动的流畅程度取决于推流帧率。
- **引导只在支持第三方面板时列出该标签页**：`@dv/ui-shell` 的右侧栏引导只有在支持第三方面板时，才列出 `@dv/` 以外插件的标签页。
