---
description: "MCP 页面上 DreamVerse 推荐的 MCP 服务器：Blender 和 ComfyUI 卡片，点一下即可把对应预设加入 MCP 服务器列表。"
kind: "package-reference"
---

# @dv/ui-mcp-presets

[English](README.md) | 中文

## 概述

使用本包在 MCP 页面显示 DreamVerse 推荐的 MCP 服务器。它在 [MCP 页面](../../client/ui-mcp-servers/README.zh.md) 的 `mcp.page.section` 插槽里加入 DreamVerse 推荐 区块，位于服务器列表上方，有一张 Blender 卡片和一张 ComfyUI 卡片。点卡片会把对应预设加入 [MCP 服务器列表](../../mcp/mcp-servers/README.zh.md)，已添加的卡片显示服务器的连接状态。只有在插件页开启 MCP 插件时才有 MCP 页面，也才有这个区块。没有本包时，MCP 页面不推荐任何服务器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠加了 `dsh-web-app` 的 profile 中挂载本插件；开启 MCP bundle 后区块出现。先构建浏览器端产物：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-mcp-presets
  name: '@dv/ui-mcp-presets'
```

Host 端不注册任何内容。预设本身来自 [`@dv/mcp-presets`](../mcp-presets/README.zh.md) 的 `dv-mcp-presets` 行；每张卡片的名称必须与该行的某个预设一致。

| 操作 | 请求 |
| --- | --- |
| 点未添加的卡片 | `mcpServers.addPreset(<name>)`；卡片显示 添加中…，之后显示服务器的连接状态。失败或 30 秒内没有结果时显示 添加失败，点击重试，错误原文在悬停提示里 |

服务器列表到达前，卡片显示 正在读取…，不能点击；已添加的卡片不能点击。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`followMcpShelf` 通过 `ctx.inject(['remote', 'remote.mcpServers'])` 跟随服务器列表，这个 Remote 和 MCP 页面一样随 MCP 插件挂载。`mcp.page.section` 插槽的类型来自 `@deepseek-ai/dsh-client-ui-mcp-servers/client`，只导入类型。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 端，不注册任何内容 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | 在 `mcp.page.section` 注册区块 |
| [`src/client/shelf.ts`](src/client/shelf.ts) | 添加请求和服务器列表数据流 |
| [`src/client/McpShelf.tsx`](src/client/McpShelf.tsx) | 区块、工具卡片及其中英文文案 |
| [`src/client/McpShelf.module.css`](src/client/McpShelf.module.css) | 区块和卡片的样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/mcp-presets`](../mcp-presets/README.zh.md) — 本包卡片添加的预设。
- [MCP 服务器列表](../../mcp/mcp-servers/README.zh.md) — 预设如何列出和添加。
- [MCP 页面](../../client/ui-mcp-servers/README.zh.md) — 该页面及其 `mcp.page.section` 插槽。

-----

<a id="model-experience"></a>
## 模型体验

无，因为卡片只把服务器加入 MCP 服务器列表，所有面向模型的工具都属于列表里的服务器。

#### KV Cache 影响

没有直接影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **工具列表固定** — 卡片及其文案固定写在 `src/client/McpShelf.tsx` 中；在 `dv-mcp-presets` 行新增的预设，需要在这里加卡片后 MCP 页面才会推荐。
