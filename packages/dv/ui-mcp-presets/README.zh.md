---
description: "DreamVerse 首页 探索 区里的 MCP 工具：Blender 和 ComfyUI 卡片。MCP 插件关闭时提供开启开关，开启后点击即可添加。"
kind: "package-reference"
---

# @dv/ui-mcp-presets

[English](README.md) | 中文

## 概述

使用本包在首页的 探索 区显示 DreamVerse 推荐的 MCP 工具。它在 [`@dv/ui-shell`](../ui-shell/README.zh.md) 的 `dv.explore` 插槽里注册 MCP 标签，标签下有一张 Blender 卡片和一张 ComfyUI 卡片。MCP 插件关闭时，一行提示说明这些工具需要什么，并提供 开启 MCP 按钮，卡片变暗。MCP 插件开启后，点卡片会把对应预设加入 [MCP 服务器列表](../../mcp/mcp-servers/README.zh.md)，点已添加的卡片会打开 MCP 页面。没有本包时，探索 没有 MCP 标签。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠加了 `dsh-web-app` 和 `@dv/ui-shell` 的 profile 中挂载本插件。先构建浏览器端产物：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-mcp-presets
  name: '@dv/ui-mcp-presets'
```

Host 端不注册任何内容。预设本身来自 [`@dv/mcp-presets`](../mcp-presets/README.zh.md) 的 `dv-mcp-presets` 行；每张卡片的名称必须与该行的某个预设一致。

| 操作 | 请求 |
| --- | --- |
| 开启 MCP | `pluginManager.setBundleEnabled('@deepseek-ai/dsh-mcp-bundle', true)`；`mcpServers` Remote 出现后提示行消失。失败或 30 秒内没有结果时，显示 MCP 开启失败。请重试，或到插件页查看。其中 插件页 是链接，错误原文在悬停提示里 |
| 点未添加的卡片 | `mcpServers.addPreset(<name>)`；卡片显示 添加中…，之后显示服务器的连接状态。失败时显示 添加失败，点击重试 |
| 点已添加的卡片 | 打开 MCP 页面 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`followMcpShelf` 通过 `ctx.inject(['remote', 'remote.pluginManager'])` 接上开关，通过 `ctx.inject(['remote', 'remote.mcpServers'])` 跟随服务器列表，所以 MCP 插件的 Remote 挂载时卡片解锁，卸载时卡片重新锁定。页面链接通过 `layout` 服务选择 DSH 主面板。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 端，不注册任何内容 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | 在 `dv.explore` 注册 MCP 标签 |
| [`src/client/shelf.ts`](src/client/shelf.ts) | MCP 插件开关、添加请求和服务器列表数据流 |
| [`src/client/McpShelf.tsx`](src/client/McpShelf.tsx) | 提示行、工具卡片及其中英文文案 |
| [`src/client/McpShelf.module.css`](src/client/McpShelf.module.css) | 提示行和卡片的样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/mcp-presets`](../mcp-presets/README.zh.md) — 本包卡片添加的预设。
- [MCP 服务器列表](../../mcp/mcp-servers/README.zh.md) — 预设如何列出和添加。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 首页及其 `dv.explore` 插槽。

-----

<a id="model-experience"></a>
## 模型体验

无，因为卡片只把服务器加入 MCP 服务器列表，所有面向模型的工具都属于列表里的服务器。

#### KV Cache 影响

没有直接影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **工具列表固定** — 卡片及其文案固定写在 `src/client/McpShelf.tsx` 中；在 `dv-mcp-presets` 行新增的预设，需要在这里加卡片后 探索 才会显示。
