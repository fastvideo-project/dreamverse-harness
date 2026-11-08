---
description: "DreamVerse Blender 组件的浏览器端：右侧栏的 Blender 标签页，说明如何用 DreamVerse 插件连接用户的 Blender，连接后实时显示它的视口；以及把 blender.render 和 blender.animation_render 的记录作为画布上的版本。"
kind: "package-reference"
---

# @fastvideo/dreamverse-ui-blender

[English](README.md) | 中文

## 概要

使用本包在 DreamVerse 中显示用户的 Blender。它注册右侧栏的 `dv-blender` 标签页类型。没有连接 Blender 时，标签页显示三个连接步骤：下载插件、安装插件、粘贴连接串。连接后，标签页实时显示它的视口，以及 Blender 的版本和文件。它还把 `blender.render` 和 `blender.animation_render` 的记录作为画布上的 `blender` 版本。它读取的路由属于 [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md)。

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

插件没有配置。右侧栏的引导以 Blender、"连接 Blender，查看它的实时视口" 提供该标签页。连接串是页面自己的源地址、`#` 和配对码；经由 SSH 隧道时，页面的源地址就是隧道的本地地址，同一台电脑上的 Blender 可以连到这里。标签页的按钮可以复制连接串，也可以更换配对码，更换会断开已连接的 Blender。

-----

<a id="understand-the-implementation"></a>
## 理解实现

标签页正文挂载期间读取一次 `GET /api/dv/blender/status`，并用 `EventSource` 打开 `GET /api/dv/blender/view`；`status` 事件在两种视图之间切换，每个 `frame` 事件用其 data URL 替换画面。正文不依赖打开的项目，因为一个 Blender 服务整个 harness。版本来自 [`@dv/ui-generation`](../ui-generation/README.zh.md) 的一个 `defineGenerationUi` 声明，节点类型为 `blender`。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | 标签页类型、标签页正文注册和版本 |
| [`src/client/BlenderPanel.tsx`](src/client/BlenderPanel.tsx) | 面板，以及它通过 `fetch` 和 `EventSource` 访问路由的方式 |
| [`src/index.ts`](src/index.ts) | 不做任何事的宿主 Loader 入口 |
| [`tests/plugin.client.spec.tsx`](tests/plugin.client.spec.tsx) | 在真实插槽运行时下的注册及其移除，以及面板在假宿主端上的两种视图 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md)：连接、路由和插件。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md)：绘制 Blender 版本的画布。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；视口画面只给人看，版本显示的 `blender.render` 和 `blender.animation_render` 记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **视口只能查看**：标签页显示画面；不向 Blender 发送点击或拖动。
- **引导只在支持第三方面板时列出该标签页**：`@dv/ui-shell` 的右侧栏引导只有在支持第三方面板时，才列出 `@dv/` 以外插件的标签页。
