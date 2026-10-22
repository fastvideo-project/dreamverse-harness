---
description: "video-harness 包组：镜头渲染的实时媒体流。其余 DreamVerse 包位于 `packages/dv/`。"
kind: "package-group"
---

# video-harness/ — 视频智能体 harness

[English](README.md) | 中文

## 概述

本包组只有一个包 `stream`（`@video-harness/stream`），它是一个 Cordis 服务：镜头渲染操作 `shot.render` 渲染一个版本时，该服务通过 WebSocket 路由 `/vh/ws` 把这个版本的 fMP4 分块发给订阅该项目的每个浏览器。DreamVerse 的项目组件、其他组件、模型目录和向其注册模型的提供方插件、对话引用、API、界面插件和浏览器测试位于 `packages/dv/`，入口是 [`@dv/project`](../dv/project/README.zh.md)；bundle 是 [`@dv/bundle`](../bundle/dv/README.zh.md)。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

镜头与时间线页面的[实时渲染流一节](../../docs/dreamverse/subsystems/shots-and-timeline.zh.md#live-render-stream)说明 `shot.render` 如何写入 `stream`，以及浏览器从 `/vh/ws` 路由收到什么。

| 包 | 职责 |
| --- | --- |
| `stream` | `@video-harness/stream`：镜头渲染的实时 fMP4 分块，按 DreamVerse 的媒体帧格式经 WebSocket 路由 `/vh/ws` 发给浏览器 |

<a id="related-documentation"></a>
## 相关文档

- [镜头与时间线](../../docs/dreamverse/subsystems/shots-and-timeline.zh.md) — 分镜计划、渲染及其版本、实时渲染流，以及时间线。
- [`@dv/api`](../dv/api/README.zh.md) — 界面插件读取状态所用的浏览器 API。

<a id="dev-note"></a>
## 开发备注

无。
