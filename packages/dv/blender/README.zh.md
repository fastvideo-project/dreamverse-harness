---
description: "可安装的 DreamVerse Blender 套件：把它安装到 DreamVerse 配置中，用 DreamVerse 插件从你的电脑或 harness 所在的机器连接你自己的 Blender，并打包或发布这些包。"
kind: "package-bundle"
---

# @fastvideo/dreamverse-blender

[English](README.md) | 中文

## 概要

使用本套件把你自己的 Blender 连接到 DreamVerse：你在 Blender 标签页中实时查看它的视口，智能体读取场景、在其中运行 Python、查看视口，并把静帧和动画渲染进项目。把它安装到 DreamVerse 配置中会插入三个插件：[`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md)（连接、工具、渲染操作和插件）、[`@fastvideo/dreamverse-ui-blender`](../ui-blender/README.zh.md)（Blender 标签页和版本）以及 [`@fastvideo/dreamverse-workflow-blender`](../workflow-blender/README.zh.md)（`blender-scenes` 技能）。

## 目录

- [使用本包](#use-this-package)
  - [1. 安装套件](#1-install-the-bundle)
  - [2. 连接 Blender](#2-connect-blender)
  - [3. 打包或发布](#3-pack-or-publish-the-packages)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

你需要一个叠加了 [`@dv/bundle`](../../bundle/dv/README.zh.md) 的 DreamVerse 配置，以及你的电脑或 harness 所在机器上的 Blender 4.2 或更高版本（已在 5.3 上测试）。

<a id="1-install-the-bundle"></a>
### 1. 安装套件

从发布它的注册表，或从[第 3 步](#3-pack-or-publish-the-packages)打出的自包含 tarball，把套件安装到 DreamVerse 配置中：

```sh
dsh plugin --profile video-harness add @fastvideo/dreamverse-blender
dsh plugin --profile video-harness add /shared/packs/fastvideo-dreamverse-blender-0.1.0.tgz
```

在源码检出中，用 `node --import tsx/esm apps/cli/src/bin.ts` 代替 `dsh`。插件从运行中的 harness 取得共享的 DreamVerse 和 harness 包，所以安装时 pnpm 的对等依赖警告是预期的。`dsh plugin --profile video-harness remove @fastvideo/dreamverse-blender` 会再次移除这些插件。

<a id="2-connect-blender"></a>
### 2. 连接 Blender

打开右侧栏的 **Blender** 标签页，按它的三步操作：下载插件，在 Blender 中安装（编辑 → 偏好设置 → 获取扩展 → 右上角菜单 → 从磁盘安装），把连接串粘贴到 3D 视图侧栏（N）的 DreamVerse 标签，然后点 **Connect**。之后标签页实时显示视口。

Blender 连接到与浏览器相同的地址：

- **Blender 在你的电脑上，harness 在服务器上**：通过 SSH 隧道打开 harness，例如 `ssh -N -L 18094:127.0.0.1:8094 <server>`，并在浏览器中打开 `http://127.0.0.1:18094`。连接串以 `http://127.0.0.1:18094` 开头，同一台电脑上的 Blender 经由同一条隧道连到 harness；Blender 连接期间要保持隧道打开。
- **Blender 在 harness 所在的机器上**：用 harness 自己的地址打开它；连接串以该地址开头。

插件的偏好设置决定它是否自动重连、智能体是否可以运行 Python，以及视口流的帧率、宽度和 JPEG 质量。连接到本机以外的地址时，必须打开 Blender 的 **允许联网访问**（偏好设置 → 系统）。

<a id="3-pack-or-publish-the-packages"></a>
### 3. 打包或发布

`pnpm run build` 之后，`bash packages/dv/blender/scripts/pack.sh [目标目录]` 打出一个自包含 tarball（默认目录 `dist/packs`），其中包含三个插件以及连接插件自己的依赖 `ws` 和 `fflate`，可以不经注册表用 `dsh plugin add <tarball>` 安装。要发布到 npm，登录 `fastvideo` 组织的账号，然后运行 `pnpm --filter "@fastvideo/dreamverse-blender*" --filter @fastvideo/dreamverse-ui-blender --filter @fastvideo/dreamverse-workflow-blender publish --access public`；pnpm 会把每个 `workspace:*` 范围换成真实版本。

<a id="understand-the-implementation"></a>
## 理解实现

本套件是一个 `dsh.bundle` 包：它的 `cordis.patch.yml` 在 DreamVerse 套件之后插入三个插件，它的 `dependencies` 列出这三个插件。它对 `@dv/bundle` 的对等依赖从 harness 解析。

| 文件 | 内容 |
| --- | --- |
| [`cordis.patch.yml`](cordis.patch.yml) | 插入的三个插件 |
| [`scripts/pack.sh`](scripts/pack.sh) | 自包含 tarball |

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md)：连接、准入和插件。
- [`@dv/mcp-presets`](../mcp-presets/README.zh.md)：Blender MCP 预设，用于不装本插件、Blender 与 harness 在同一台机器上的情况。

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@fastvideo/dreamverse-blender-bridge` 的工具和操作，以及 `@fastvideo/dreamverse-workflow-blender` 的 `blender-scenes` 技能；套件本身不添加模型可见的文本。

#### KV Cache 影响

本身没有；插入的插件各自说明。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **每个 harness 一个 Blender**：harness 的所有对话都使用唯一连接的 Blender。
- **隧道必须保持打开**：Blender 在另一台电脑上时，关闭 SSH 隧道会断开 Blender；隧道恢复后插件会重新连接。
