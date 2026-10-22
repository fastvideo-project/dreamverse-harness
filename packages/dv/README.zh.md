---
description: "dv 包组：DreamVerse 视频制作的各包，从项目内核到组件、工作流和浏览器 API，再到界面插件。"
kind: "package-group"
---

# dv/ — DreamVerse 视频制作

[English](README.md) | 中文

## 概述

dv 包组包含 DreamVerse 各包，即 DeepSeek Harness 内视频制作的项目层。`@dv/project` 把每个项目存为记录，并把每个操作变成一个智能体工具；各组件拥有项目数据和操作，工作流拥有制作流程，模型目录及其提供方插件提供视频模型。`@dv/api` 和 `@dv/chat-references` 把浏览器和对话接到项目上，`@dv/ui-*` 插件负责绘制。[DreamVerse 文档](../../docs/dreamverse/README.zh.md)负责跨包规则。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包位于 `scripts/dv-architecture.ts` 的 `layerOf` 为它指定的层，包只依赖它下面的层：

| 层 | 包 | 职责 |
|---|---|---|
| kernel | [`project`](project/README.zh.md) | 存储每个项目的记录及其历史列表，运行操作，计算状态，并把每个操作变成一个智能体工具 |
| base | [`models`](models/README.zh.md) | 视频模型目录 `dvModels`，提供方插件向它注册 |
| base | [`generation`](generation/README.zh.md) | `defineGeneration`，把一个生成原语变成带一个操作的服务 |
| base | [`asset-pool`](asset-pool/README.zh.md) | 按内容寻址的素材存储、画布摆放，以及 `asset.*` 操作 |
| base | [`ffmpeg`](ffmpeg/README.zh.md) | 为组件操作运行 ffmpeg 命令和 ffprobe 读取 |
| base | [`reference-kit`](reference-kit/README.zh.md) | `defineReference`，把一个引用名词的声明变成它的服务 |
| provider | [`fastvideo`](fastvideo/README.zh.md) | 把本地 FastVideo 服务器的模型 `fasth3` 按生成任务 `ref2v` 和 `t2v` 注册进模型目录 |
| provider | [`fastvideo-generation-client`](fastvideo-generation-client/README.zh.md) | FastVideo `streaming_v2` 生成后端的客户端 |
| domain | [`character`](character/README.zh.md) | 作为带版本的引用名词的角色 |
| domain | [`location`](location/README.zh.md) | 作为带版本的引用名词的场景 |
| domain | [`style`](style/README.zh.md) | 作为带版本的引用名词的风格 |
| domain | [`shot-plan`](shot-plan/README.zh.md) | 带编号版次的分镜计划和 `plan.*` 操作 |
| domain | [`shot-render`](shot-render/README.zh.md) | 通过 `shot.render` 用模型目录中的模型渲染镜头的一个版本 |
| domain | [`timeline`](timeline/README.zh.md) | 时间线、其片段、`timeline.*` 编辑操作和导出 |
| domain | [`inspector`](inspector/README.zh.md) | 只读操作 `inspect.image` 和 `inspect.asset` |
| workflow-lib | [`workflow-kit`](workflow-kit/README.zh.md) | 工作流读取分镜计划版次并排定其渲染所用的镜头遍历 |
| workflow | [`workflow-story`](workflow-story/README.zh.md) | 预览并批准一个分镜计划版次，渲染它，并把其版本排到时间线上 |
| surface | [`api`](api/README.zh.md) | 浏览器 API：读取状态、以用户身份运行操作、撤销和重做，以及事件流 |
| surface | [`chat-references`](chat-references/README.zh.md) | 展开 `dv:` 提及，并导入用户在对话中附上的文件 |
| surface | [`mcp-presets`](mcp-presets/README.zh.md) | 提供已配置的 MCP 服务器（Blender、ComfyUI），一步添加 |
| ui-core | [`ui-kit`](ui-kit/README.zh.md) | DreamVerse 各视图共用的浏览器代码 |
| ui-core | [`ui-canvas`](ui-canvas/README.zh.md) | 把项目的记录画成按素材流向相连的节点的画布 |
| ui-core | [`ui-history`](ui-history/README.zh.md) | 带撤销、重做和 回到这一步 的历史面板 |
| ui-core | [`ui-shell`](ui-shell/README.zh.md) | DSH web 应用之上的入口页、项目工作区和 对话 / 轨迹 标签 |
| ui-core | [`ui-composer`](ui-composer/README.zh.md) | DreamVerse 为 DSH 对话输入框添加的内容 |
| ui | [`ui-asset-pool`](ui-asset-pool/README.zh.md) | 素材库面板 |
| ui | [`ui-character`](ui-character/README.zh.md) | `character` 的浏览器半部 |
| ui | [`ui-location`](ui-location/README.zh.md) | `location` 的浏览器半部 |
| ui | [`ui-style`](ui-style/README.zh.md) | `style` 的浏览器半部 |
| ui | [`ui-shot-plan`](ui-shot-plan/README.zh.md) | `shot-plan` 的浏览器半部 |
| ui | [`ui-shot-render`](ui-shot-render/README.zh.md) | `shot-render` 的浏览器半部：对话中的渲染卡片 |
| ui | [`ui-timeline`](ui-timeline/README.zh.md) | 时间线编辑器 |
| ui | [`ui-workflow-story`](ui-workflow-story/README.zh.md) | `workflow-story` 的浏览器半部 |
| ui | [`ui-mcp-presets`](ui-mcp-presets/README.zh.md) | `mcp-presets` 的浏览器半部 |
| ui | [`ui-skills`](ui-skills/README.zh.md) | 列出创作者可以启动的 skill 的技能页 |
| — | [`e2e`](e2e/README.zh.md) | 通过 Playwright 驱动已发布 profile 的浏览器故事 |

`packages/bundle/dv/` 下的 bundle [`@dv/bundle`](../bundle/dv/README.zh.md) 是 `bundle` 层：它把这些包组合成 `video-harness` 和 `video-harness-headless` 两个 profile。

<a id="related-documentation"></a>
## 相关文档

- [DreamVerse 文档](../../docs/dreamverse/README.zh.md) — 架构页、子系统页面、cookbook 和术语表的索引。
- [项目子系统](../../docs/dreamverse/subsystems/project.zh.md) — 操作记录、历史规则和项目状态。
- [DreamVerse 插件分层](../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-layers.zh.md) — 这些层及其依赖方向为什么存在。
- [组件模板](COMPONENT-TEMPLATE.md) — 一个组件包的做法。
- [`video-harness/`](../video-harness/README.zh.md) — 镜头渲染的实时媒体流。

<a id="dev-note"></a>
## 开发备注

无。
